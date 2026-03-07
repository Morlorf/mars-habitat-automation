import asyncio
import json
import uuid
from datetime import datetime, timezone
import aio_pika

async def send_conflict():
    connection = await aio_pika.connect_robust("amqp://guest:guest@mars-rabbitmq:5672/")
    async with connection:
        channel = await connection.channel()
        exchange = await channel.declare_exchange('mars.events', aio_pika.ExchangeType.TOPIC, durable=True)
        
        event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "Habitat Heater",
            "event_type": "rule_conflict",
            "location": "unknown",
            "payload": {
                "actuator_id": "habitat_heater",
                "rule_ids": [1, 2],
                "resolved": False,
            },
            "metadata": {}
        }
        
        message = aio_pika.Message(
            body=json.dumps(event).encode(),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT
        )
        
        await exchange.publish(message, routing_key="rule_conflict.unknown.test")
        print("Test conflict sent.")

if __name__ == "__main__":
    asyncio.run(send_conflict())
