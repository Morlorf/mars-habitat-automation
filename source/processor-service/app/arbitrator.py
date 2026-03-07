"""
Arbitrator for actuator commands.

Queues incoming commands within a time window, applying Safe-State logic
and deterministic tie-breaking for conflicting commands.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from app.actuator import send_actuator_command
from app.models import EventType, RuleResponse, UnifiedEvent
from app.rabbitmq_publisher import publisher

logger = logging.getLogger("processor.arbitrator")

class Arbitrator:
    def __init__(self, window_seconds: float = 0.5):
        self.window_seconds = window_seconds
        # Maps actuator_name -> list of (rule, state, event_data)
        self._queues: dict[str, list[tuple[RuleResponse, str, dict]]] = {}
        # Tracks active asyncio tasks for process windows
        self._tasks: dict[str, asyncio.Task] = {}
        # Tracks active UI conflict state for actuators (True if currently in conflict)
        self._active_conflicts: dict[str, bool] = {}

    async def submit_command(self, rule: RuleResponse, actuator: str, state: str, event_data: dict) -> None:
        """Submit a command to the arbitrator queue."""
        if actuator not in self._queues:
            self._queues[actuator] = []
        
        self._queues[actuator].append((rule, state, event_data))

        # Start the processing window if not already active
        if actuator not in self._tasks or self._tasks[actuator].done():
            task = asyncio.create_task(self._process_window(actuator))
            self._tasks[actuator] = task
            # Fire and forget; the task will clear itself from _tasks when it finishes

    async def _process_window(self, actuator: str) -> None:
        """Wait for the window to close, then resolve and commit."""
        await asyncio.sleep(self.window_seconds)

        commands = self._queues.pop(actuator, [])
        if not commands:
            return

        # Check for conflicts
        requested_states = {cmd[1].upper() for cmd in commands}
        has_conflict = len(requested_states) > 1
        
        rule_ids = [cmd[0].id for cmd in commands]
        original_event = commands[0][2]  # Reference the first event that triggered this

        # Broadcast conflict status if it changed
        currently_in_conflict = self._active_conflicts.get(actuator, False)
        
        if has_conflict and not currently_in_conflict:
            self._active_conflicts[actuator] = True
            await self._broadcast_conflict(actuator, rule_ids, resolved=False, event_data=original_event)
        elif not has_conflict and currently_in_conflict:
            self._active_conflicts[actuator] = False
            await self._broadcast_conflict(actuator, [], resolved=True, event_data=original_event)

        # Resolve state
        final_state, winner_rule = self._resolve(commands)

        logger.info(
            "Arbitrator resolved %d commands for %s -> %s (Winner Rule: %d)",
            len(commands), actuator, final_state, winner_rule.id
        )

        # Commit
        success = await send_actuator_command(actuator, final_state)

        # Publish Actuator Command Audit Event
        await self._publish_actuator_event(actuator, final_state, winner_rule, original_event, success)

        # Alert if failure
        if not success:
            await self._publish_alert(actuator, final_state, winner_rule, original_event)

        # Clear the task token so the next event starts a new window
        self._tasks.pop(actuator, None)

    def _resolve(self, commands: list[tuple[RuleResponse, str, dict]]) -> tuple[str, RuleResponse]:
        """
        Resolve conflicting commands.
        1. Safe State Dominance: OFF always wins.
        2. Deterministic Tie-Breaker: Lower Rule ID wins.
        """
        # If any command is OFF, OFF wins. Filter commands to only those proposing the winning state.
        has_off = any(cmd[1].upper() == "OFF" for cmd in commands)
        winning_state = "OFF" if has_off else "ON"

        # Tie-breaker among those proposing the winning state: Lower Rule ID
        candidates = [cmd for cmd in commands if cmd[1].upper() == winning_state]
        winner = min(candidates, key=lambda x: x[0].id)
        
        return winning_state, winner[0]

    async def _broadcast_conflict(self, actuator: str, rule_ids: list[int], resolved: bool, event_data: dict) -> None:
        """Publish a rule_conflict event so the UI can update."""
        conflict_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": actuator,
            "event_type": EventType.RULE_CONFLICT.value,
            "location": event_data.get("location", "unknown"),
            "payload": {
                "actuator_id": actuator,
                "rule_ids": rule_ids,
                "resolved": resolved,
            },
            "metadata": {
                "trigger_source": event_data.get("source", "unknown"),
            },
        }
        try:
            event = UnifiedEvent(**conflict_event)
            await publisher.publish(event)
            logger.info("Broadcast conflict event for %s (resolved=%s)", actuator, resolved)
        except Exception as e:
            logger.error("Failed to publish conflict event: %s", e)

    async def _publish_actuator_event(self, actuator: str, state: str, rule: RuleResponse, event_data: dict, success: bool) -> None:
        """Publish an actuator_command event for audit trail."""
        actuator_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": actuator,
            "event_type": EventType.ACTUATOR_COMMAND.value,
            "location": event_data.get("location", "unknown"),
            "payload": {
                "actuator_id": actuator,
                "command": state,
                "parameters": {},
                "triggered_by": f"rule-{rule.id}",
                "success": success,
            },
            "metadata": {
                "rule_name": rule.name,
                "trigger_source": event_data.get("source", "unknown"),
            },
        }
        try:
            event = UnifiedEvent(**actuator_event)
            await publisher.publish(event)
        except Exception as e:
            logger.error("Failed to publish actuator event: %s", e)

    async def _publish_alert(self, actuator: str, state: str, rule: RuleResponse, event_data: dict) -> None:
        """Publish an alert if the actuator command failed."""
        alert_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": actuator,
            "event_type": EventType.ALERT.value,
            "location": event_data.get("location", "unknown"),
            "payload": {
                "severity": "critical",
                "message": f"Actuator '{actuator}' failed to execute command '{state}' after retries",
                "related_source": event_data.get("source", "unknown"),
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
        except Exception as e:
            logger.error("Failed to publish alert event: %s", e)

# Singleton instance for the app
arbitrator = Arbitrator(window_seconds=0.5)
