# Mars Habitat Automation — Input Specification

## 1. Unified Event Schema

All data flowing through the system is normalized into this canonical JSON schema before being published to the message broker. This applies to polled REST sensor readings, actuator commands, and system alerts.

### Schema Definition

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-05T22:05:33.123Z",
  "source": "sensor-temp-greenhouse-01",
  "event_type": "sensor_reading",
  "location": "greenhouse",
  "payload": {
    "metric": "temperature",
    "value": 22.5,
    "unit": "°C",
    "status": "nominal"
  },
  "metadata": {
    "ingestion_method": "rest_polling",
    "polling_interval_ms": 5000,
    "raw_endpoint": "/api/sensors/temp-greenhouse-01"
  }
}
```

### Field Specifications

| Field | Type | Required | Description |
|---|---|---|---|
| `event_id` | `string (UUID v4)` | ✅ | Unique identifier for this event instance |
| `timestamp` | `string (ISO 8601)` | ✅ | UTC timestamp of when the reading was taken or event generated |
| `source` | `string` | ✅ | Identifier of the originating sensor, subsystem, or actuator (e.g., `sensor-temp-greenhouse-01`, `actuator-hvac-main`) |
| `event_type` | `string (enum)` | ✅ | One of: `sensor_reading`, `actuator_command`, `alert` |
| `location` | `string` | ✅ | Habitat zone: `greenhouse`, `airlock`, `reactor`, `crew_quarters`, `medbay`, `comms`, `storage`, `external` |
| `payload` | `object` | ✅ | Type-specific data (see below) |
| `metadata` | `object` | ❌ | Optional context: ingestion method, raw endpoint, polling interval, etc. |

### Payload Variants by `event_type`

**`sensor_reading`** — Polled from REST endpoints:
```json
{
  "metric": "temperature",
  "value": 22.5,
  "unit": "°C",
  "status": "nominal"
}
```

**`actuator_command`** — Outbound command to the simulator:
```json
{
  "actuator_id": "actuator-hvac-main",
  "command": "set_temperature",
  "parameters": { "target": 23.0, "mode": "auto" },
  "triggered_by": "rule-005"
}
```

**`alert`** — System-generated threshold breach or failure:
```json
{
  "severity": "critical",
  "message": "O2 level below safe threshold in airlock",
  "related_source": "sensor-o2-airlock-01",
  "threshold_breached": { "metric": "o2_level", "threshold": 19.5, "actual": 18.2, "unit": "%" }
}
```

### `status` Values

| Status | Meaning |
|---|---|
| `nominal` | Value within normal operating range |
| `warning` | Value approaching threshold — attention needed |
| `critical` | Value beyond safe limits — immediate action required |
| `offline` | Sensor not responding or disconnected |
| `unknown` | Status cannot be determined |

---

## 2. User Stories

### Ingestion Service

#### US-01: Poll REST Sensor Endpoints
**As** the Ingestion Service,  
**I want to** periodically poll all REST sensor endpoints exposed by the simulator,  
**So that** I can capture the latest sensor readings at a configurable interval.

**Acceptance Criteria:**
- The service polls each REST endpoint at a configurable interval (default: 5 seconds).
- If a sensor endpoint returns an error or times out, the service logs the failure and continues polling other sensors.
- Each successful response is transformed into the Unified Event Schema.
- The polling interval can be adjusted without restarting the service (via environment variable).

---

#### US-02: Normalize and Validate Sensor Data
**As** the Ingestion Service,  
**I want to** transform all REST responses into the Unified Event Schema and validate them,  
**So that** downstream services consume a single consistent format.

**Acceptance Criteria:**
- Every event published to the broker conforms to the Unified Event Schema.
- The `source` field uniquely identifies the originating sensor.
- Validation (via Pydantic models) rejects malformed data and logs the error.
- The `event_type` is set to `sensor_reading` for all polled data.

---

#### US-03: Publish Events to RabbitMQ
**As** the Ingestion Service,  
**I want to** publish each normalized event to the RabbitMQ exchange with a topic routing key,  
**So that** downstream consumers (Rule Engine, State Manager) can subscribe by topic.

**Acceptance Criteria:**
- Events are published to a topic exchange named `mars.events`.
- Routing keys follow the pattern: `{event_type}.{location}.{metric}` (e.g., `sensor_reading.greenhouse.temperature`).
- Messages are published with `content_type: application/json`.
- If RabbitMQ is unreachable, events are buffered in-memory and retried.

---

### Rule Engine Service

#### US-04: Consume Events and Evaluate IF-THEN Rules
**As** the Rule Engine Service,  
**I want to** consume events from RabbitMQ and evaluate them against persisted IF-THEN rules,  
**So that** matching rules trigger the appropriate actuator commands.

**Acceptance Criteria:**
- The service subscribes to configurable routing key patterns (e.g., `sensor_reading.#`).
- Rules are loaded from SQLite into memory on startup and refreshed on CRUD operations.
- Each rule has a condition (IF) checking event fields (e.g., `payload.value > 30 AND location == "greenhouse"`).
- Each rule has an action (THEN) specifying an actuator command to send.
- Multiple rules can match a single event; all matching actions are executed.

---

#### US-05: Trigger Actuator Commands
**As** the Rule Engine Service,  
**I want to** send REST POST requests to the simulator's actuator endpoints when a rule triggers,  
**So that** the habitat systems respond automatically to sensor conditions.

**Acceptance Criteria:**
- The actuator command is sent as a REST POST to the simulator endpoint.
- A corresponding `actuator_command` event is published to RabbitMQ for audit and dashboard display.
- Failed actuator calls are retried up to 3 times with exponential backoff.
- Failures after retries generate an `alert` event.

---

#### US-06: CRUD Automation Rules
**As** a Habitat Operator (via API),  
**I want to** create, read, update, and delete automation rules,  
**So that** I can dynamically adjust the habitat's automated responses.

**Acceptance Criteria:**
- Rules are persisted in SQLite with fields: `id`, `name`, `description`, `condition`, `action`, `is_active`, `priority`, `created_at`, `updated_at`.
- Creating/updating a rule validates the condition syntax before saving.
- Disabling a rule (`is_active = false`) stops it from being evaluated without deleting it.
- The in-memory rule cache is refreshed immediately after any CRUD operation.
- The API returns appropriate HTTP status codes (201, 200, 204, 404, 422).

---

### State Management

#### US-07: Maintain In-Memory Sensor State Cache
**As** the Processor Service,  
**I want to** keep an in-memory dictionary of the latest reading for each sensor,  
**So that** the dashboard can query the current state of the habitat.

**Acceptance Criteria:**
- The cache is a key-value store keyed by `source` identifier.
- Each entry stores the full latest event for that source.
- The cache is updated on each incoming event.
- `GET /api/state` returns the full state dictionary as JSON.
- `GET /api/state/{source}` returns the latest event for a specific sensor.

---

### Dashboard & Frontend

#### US-08: Display Real-Time Sensor Data
**As** a Habitat Operator,  
**I want to** see live sensor readings on the dashboard, updating in real-time,  
**So that** I can monitor the habitat's status without refreshing the page.

**Acceptance Criteria:**
- The dashboard connects to the API Gateway via WebSocket.
- Sensor values update live as new events arrive (< 1 second latency).
- Each sensor displays: metric name, current value, unit, status indicator (color-coded), and last update timestamp.
- Sensors are organized by habitat zone (location).

---

#### US-09: Manage Automation Rules via UI
**As** a Habitat Operator,  
**I want to** view, create, edit, enable/disable, and delete automation rules from the dashboard,  
**So that** I can manage the habitat's automation without using the API directly.

**Acceptance Criteria:**
- A dedicated "Rules" page lists all rules with their name, condition, action, status, and priority.
- A form allows creating new rules with validation feedback.
- Rules can be toggled active/inactive with a single click.
- Deleting a rule requires confirmation.
- Changes are reflected immediately in the rule list.

---

### Infrastructure & Deployment

#### US-10: Single-Command Deployment
**As** a Developer / Evaluator,  
**I want to** start the entire system with a single `docker-compose up` command,  
**So that** the deployment is reproducible and requires no manual setup.

**Acceptance Criteria:**
- `docker-compose.yml` defines all services: Simulator, RabbitMQ, Ingestion Service, Processor Service, API Gateway, Frontend.
- All services start in the correct dependency order (broker before services, services before frontend).
- Health checks ensure services wait for dependencies to be ready.
- Environment variables are centralized in a `.env` file.
- The system is fully operational within 60 seconds of `docker-compose up`.
