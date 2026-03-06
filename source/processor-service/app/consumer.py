"""
RabbitMQ consumer — subscribes to the mars.events exchange and processes
incoming sensor events through the rule engine and state cache.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import aio_pika

from app.actuator import send_actuator_command
from app.config import settings
from app.database import get_active_rules
from app.models import EventType, UnifiedEvent
from app.rabbitmq_publisher import publisher
from app.rules import evaluate_rules
from app.state import state_cache

logger = logging.getLogger("processor.consumer")

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_channel: aio_pika.abc.AbstractChannel | None = None

# In-memory rules cache (refreshed on startup + CRUD operations)
_active_rules_cache: list = []


async def refresh_rules_cache() -> None:
    """Reload active rules from the database into memory."""
    global _active_rules_cache
    _active_rules_cache = await get_active_rules()
    logger.info("Rules cache refreshed: %d active rules loaded.", len(_active_rules_cache))


async def connect_and_consume() -> None:
    """Connect to RabbitMQ and start consuming events."""
    global _connection, _channel

    for attempt in range(1, 11):
        try:
            logger.info(
                "Connecting to RabbitMQ (attempt %d/10)...", attempt
            )
            _connection = await aio_pika.connect_robust(
                settings.rabbitmq_url, timeout=10
            )
            _channel = await _connection.channel()
            await _channel.set_qos(prefetch_count=10)

            # Declare the exchange (idempotent)
            exchange = await _channel.declare_exchange(
                settings.RABBITMQ_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )

            # Declare a queue for the processor and bind to all sensor readings
            queue = await _channel.declare_queue(
                "processor.events", durable=True
            )
            await queue.bind(exchange, routing_key="sensor_reading.#")

            logger.info("Connected to RabbitMQ — consuming from 'processor.events'")

            # Start consuming
            async with queue.iterator() as queue_iter:
                async for message in queue_iter:
                    async with message.process():
                        await _handle_message(message)

        except asyncio.CancelledError:
            logger.info("Consumer task cancelled.")
            return
        except Exception as e:
            logger.warning("Consumer error (attempt %d): %s", attempt, e)
            await asyncio.sleep(3)

    logger.error("Failed to connect consumer after 10 attempts.")


async def _handle_message(message: aio_pika.IncomingMessage) -> None:
    """Process a single incoming message."""
    try:
        data = json.loads(message.body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.error("Failed to decode message: %s", e)
        return

    # 1. Update state cache
    state_cache.update(data)

    # 2. Evaluate rules
    triggered = evaluate_rules(data, _active_rules_cache)

    # 3. Execute triggered rule actions
    for rule in triggered:
        action = rule.action
        success = await send_actuator_command(action.actuator, action.state)

        # Publish an actuator_command event for audit trail
        actuator_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": action.actuator,
            "event_type": EventType.ACTUATOR_COMMAND.value,
            "location": data.get("location", "unknown"),
            "payload": {
                "actuator_id": action.actuator,
                "command": action.state,
                "parameters": {},
                "triggered_by": f"rule-{rule.id}",
                "success": success,
            },
            "metadata": {
                "rule_name": rule.name,
                "trigger_source": data.get("source", "unknown"),
            },
        }
        try:
            event = UnifiedEvent(**actuator_event)
            await publisher.publish(event)
        except Exception as e:
            logger.error("Failed to publish actuator event: %s", e)

        # If actuator command failed after all retries, publish an alert event
        if not success:
            alert_event = {
                "event_id": str(uuid.uuid4()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": action.actuator,
                "event_type": EventType.ALERT.value,
                "location": data.get("location", "unknown"),
                "payload": {
                    "severity": "critical",
                    "message": f"Actuator '{action.actuator}' failed to execute command '{action.state}' after retries",
                    "related_source": data.get("source", "unknown"),
                    "threshold_breached": None,
                },
                "metadata": {
                    "rule_name": rule.name,
                    "rule_id": rule.id,
                },
            }
            try:
                alert = UnifiedEvent(**alert_event)
                await publisher.publish(alert)
                logger.warning(
                    "Alert published: actuator '%s' failed for rule '%s'",
                    action.actuator, rule.name,
                )
            except Exception as e:
                logger.error("Failed to publish alert event: %s", e)


async def close_consumer() -> None:
    """Close the RabbitMQ consumer connection."""
    global _connection
    if _connection and not _connection.is_closed:
        await _connection.close()
        logger.info("Consumer connection closed.")
