# Mars Habitat Automation — Architecture Documentation

## 1. System Overview

This project implements a **microservices, event-driven** automation stack for a simulated Mars habitat. The system polls IoT sensors from a Mars IoT simulator, normalizes heterogeneous data into a unified schema, routes events through a message broker, evaluates automation rules in real-time, and provides a live dashboard for monitoring and control.

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Microservices + Event-Driven | Decoupled services, independent scaling, fault isolation |
| Message Broker | RabbitMQ (Topic Exchange) | Flexible routing by event type/location/metric |
| Data Input | REST Polling (5s interval) | Team of 2 — telemetry streams omitted per scope reduction |
| Rule Engine | Structured JSON conditions | Safe evaluation (no `eval()`), supports AND/OR logic with dot-path field access |
| State Management | In-memory dict | No historical persistence required; latest values only |
| Rule Persistence | SQLite (aiosqlite) | Lightweight, zero-config, sufficient for rule CRUD |
| Frontend | React + Vite + nginx | Modern SPA with hot-reload dev experience |
| Inter-service Comms | RabbitMQ (async) + REST (sync) | Events flow async; CRUD/actuators use synchronous HTTP |

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DOCKER COMPOSE NETWORK                        │
│                                                                      │
│  ┌──────────────┐     ┌────────────┐     ┌────────────────────────┐  │
│  │  Simulator   │◄────│  Ingestion │────►│      RabbitMQ          │  │
│  │  (provided)  │poll │  Service   │pub  │  (mars.events exchange)│  │
│  │  :8080       │     │  :8001     │     │  :5672 / :15672        │  │
│  └──────┬───────┘     └────────────┘     └──────┬──────┬──────────┘  │
│         │                                       │      │             │
│         │ REST POST                        sub  │      │ sub         │
│         │ (actuators)                           │      │             │
│  ┌──────▼───────────────────────────────────────▼──┐   │             │
│  │              Processor Service                  │   │             │
│  │  • RabbitMQ Consumer (processor.events queue)   │   │             │
│  │  • In-Memory State Cache (8 sensors)            │   │             │
│  │  • Rule Engine (IF-THEN evaluation)             │   │             │
│  │  • Actuator Client (REST POST → Simulator)      │   │             │
│  │  • SQLite DB (rules CRUD)                       │   │             │
│  │  • REST API (:8002)                             │   │             │
│  └──────────────────────┬──────────────────────────┘   │             │
│                         │ HTTP proxy                   │             │
│  ┌──────────────────────▼──────────────────────────────▼──┐          │
│  │                   API Gateway                          │          │
│  │  • WebSocket /ws (broadcasts all RabbitMQ events)      │          │
│  │  • REST proxy → Processor (state, rules)               │          │
│  │  • REST proxy → Simulator (actuators)                  │          │
│  │  • CORS enabled (:8003)                                │          │
│  └──────────────────────┬─────────────────────────────────┘          │
│                         │ nginx proxy                                │
│  ┌──────────────────────▼─────────────────────────────────┐          │
│  │                    Frontend                            │          │
│  │  • React SPA (Vite build)                              │          │
│  │  • nginx serves static + proxies /api & /ws            │          │
│  │  • Live sensor cards, rule CRUD, actuator controls     │          │
│  │  • :3000                                               │          │
│  └────────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Unified Event Schema

All data flowing through the system is normalized into this canonical JSON format:

```json
{
  "event_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "source": "sensor_id | actuator_id",
  "event_type": "sensor_reading | actuator_command | alert",
  "location": "greenhouse | entrance | hall | habitat | storage | corridor",
  "payload": {
    "metric": "temperature_c | humidity_pct | ...",
    "value": 23.5,
    "unit": "C | % | ppm | ...",
    "status": "nominal | warning | critical"
  },
  "metadata": {
    "ingestion_method": "rest_polling",
    "schema_id": "rest.scalar.v1 | rest.chemistry.v1 | ..."
  }
}
```

The Ingestion Service normalizes 4 distinct simulator response schemas into this format:

| Schema ID | Sensors | Key Fields |
|---|---|---|
| `rest.scalar.v1` | temperature, humidity, pressure | `value`, `unit` |
| `rest.chemistry.v1` | CO₂, VOC | `co2e_ppm` or `tvoc_ppb`, compounds |
| `rest.level.v1` | water tank | `current_liters`, `capacity` |
| `rest.particulate.v1` | PM2.5 | `pm25_ug_m3`, `pm10_ug_m3` |

---

## 4. Service Details

### 4.1 Ingestion Service (`source/ingestion-service/`)

**Purpose**: Polls REST sensors from the simulator, normalizes data, publishes to RabbitMQ.

| Module | Responsibility |
|---|---|
| `config.py` | Loads settings via `pydantic-settings` (env vars) |
| `models.py` | Unified Event Schema + 4 normalizer functions |
| `poller.py` | Async sensor discovery + concurrent polling loop |
| `rabbitmq.py` | `aio_pika` publisher with retry logic |
| `main.py` | FastAPI app with lifespan manager |

**Data Flow**: `GET /api/discovery` → discover 8 sensors → `GET /api/sensors/{id}` every 5s → normalize → publish to `mars.events` exchange with routing key `sensor_reading.{location}.{metric}`.

### 4.2 Processor Service (`source/processor-service/`)

**Purpose**: Consumes events, maintains state, evaluates rules, dispatches actuator commands.

| Module | Responsibility |
|---|---|
| `state.py` | In-memory cache (dict of latest event per sensor) |
| `database.py` | SQLite CRUD for rules via `aiosqlite` |
| `rules.py` | Safe rule evaluator with dot-path field resolution |
| `actuator.py` | HTTP POST client for simulator actuators |
| `consumer.py` | RabbitMQ consumer → state update → rule eval → actuate |
| `rabbitmq_publisher.py` | Publishes `actuator_command` events for audit trail |
| `routes.py` | REST API: `/api/rules` (CRUD), `/api/state` (query) |
| `main.py` | FastAPI app orchestrating all components |

**Rule Format** (structured JSON, no `eval()`):
```json
{
  "condition": {
    "logic": "AND",
    "conditions": [
      { "field": "source", "operator": "==", "value": "greenhouse_temperature" },
      { "field": "payload.value", "operator": ">", "value": 24 }
    ]
  },
  "action": { "actuator": "cooling_fan", "state": "ON" }
}
```

### 4.3 API Gateway (`source/api-gateway/`)

**Purpose**: Single entry point for the frontend. WebSocket broadcasting + REST proxy.

| Module | Responsibility |
|---|---|
| `ws_manager.py` | Consumes from RabbitMQ (exclusive queue), broadcasts to WebSocket clients |
| `main.py` | FastAPI app with CORS, WebSocket endpoint, REST proxies |

**Endpoints**:
- `GET /ws` — WebSocket (real-time event stream)
- `GET/POST/PUT/DELETE /api/rules/*` — proxied to Processor
- `GET /api/state/*` — proxied to Processor
- `GET/POST /api/actuators/*` — proxied to Simulator

### 4.4 Frontend (`source/frontend/`)

**Purpose**: React SPA dashboard for monitoring and control.

| File | Responsibility |
|---|---|
| `src/App.jsx` | Main component: sensor grid, rule CRUD modal, actuator toggles |
| `src/index.css` | Mars-themed dark design system |
| `nginx.conf` | Serves SPA + proxies `/api` and `/ws` to API Gateway |
| `Dockerfile` | Multi-stage: Node build → nginx serve |

**Features**: Live-updating sensor cards via WebSocket, rule creation form (IF condition THEN actuator action), manual actuator ON/OFF toggle, connection status indicator.

---

## 5. Message Broker Topology

```
Exchange: mars.events (topic, durable)
│
├── Queue: processor.events (durable)
│   Binding: sensor_reading.#
│   Consumer: Processor Service
│
└── Queue: (exclusive, auto-delete)
    Binding: #
    Consumer: API Gateway (→ WebSocket broadcast)
```

**Routing Key Format**: `{event_type}.{location}.{metric}`

Examples:
- `sensor_reading.greenhouse.temperature_c`
- `actuator_command.greenhouse.cooling_fan`

---

## 6. Deployment

### Prerequisites
- Docker & Docker Compose
- The `mars-iot-simulator:multiarch_v1` image loaded: `docker load -i mars-iot-simulator-oci.tar`

### Start
```bash
docker-compose up --build -d
```

### Services & Ports

| Service | Container | Port |
|---|---|---|
| Simulator | `mars-simulator` | `8080` |
| RabbitMQ | `mars-rabbitmq` | `5672` (AMQP), `15672` (Management UI) |
| Ingestion Service | `mars-ingestion` | `8001` |
| Processor Service | `mars-processor` | `8002` |
| API Gateway | `mars-gateway` | `8003` |
| **Frontend Dashboard** | `mars-frontend` | **`3000`** |

### Stop
```bash
docker-compose down
```

---

## 7. User Stories Coverage

| US | Title | Status |
|---|---|---|
| US-01 | Ingest REST Sensor Data | ✅ 8 sensors polled at 5s intervals |
| US-02 | Normalize Sensor Data | ✅ 4 schema normalizers |
| US-03 | Publish to Message Broker | ✅ RabbitMQ topic exchange |
| US-04 | View Live Sensor Dashboard | ✅ WebSocket real-time updates |
| US-05 | In-Memory Sensor State | ✅ State cache with `/api/state` endpoint |
| US-06 | CRUD Automation Rules | ✅ Full REST API + UI form |
| US-07 | Evaluate Rules on Events | ✅ Safe IF-THEN engine |
| US-08 | Trigger Actuator Actions | ✅ REST POST to simulator |
| US-09 | Manual Actuator Control | ✅ Dashboard toggle buttons |
| US-10 | Single-Command Deployment | ✅ `docker-compose up` |

---

## 8. Tech Stack Summary

| Layer | Technology |
|---|---|
| Language | Python 3.11, JavaScript (React) |
| Web Framework | FastAPI + Uvicorn |
| Async HTTP | aiohttp |
| Message Broker | RabbitMQ 3 (Management) + aio-pika |
| Database | SQLite + aiosqlite |
| Frontend | React 19 + Vite |
| Web Server | nginx (SPA + reverse proxy) |
| Containerization | Docker + Docker Compose |
