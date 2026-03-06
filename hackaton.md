# Laboratory of Advanced Programming 2025/2026: Hackathon Exam 
**Institution:** STVDIVM VRBIS Sapienza Università di Roma, MSc in Engineering in Computer Science and Artificial Intelligence.
**Date:** 5 March 2026.

### 1. Mission Briefing: "Welcome to Mars. Please Don't Die." 
We are in 2036. After a 12-hour shift of questionable architectural decisions at SpaceY, you are "promoted" to Mars Operations by being accidentally shipped to Mars while sleeping at your desk. You wake up in a fragile habitat whose automation stack is partially destroyed, where devices speak incompatible dialects. Some stream telemetry, others respond only to polling, and actuators are reachable if invoked correctly.

**Your mission:** Rebuild a distributed automation platform capable of ingesting heterogeneous sensor data, normalizing it into a unified internal representation, evaluating simple automation rules, and providing a real-time dashboard for habitat monitoring. Failure means thermodynamic consequences.

### 2. General Information
* **Duration:** 5 days.
* **Team size:** 2 to 5 students.
* **Submission deadline:** 10 March 2026, 23:59.
* **Final discussion:** In-person presentation + demo (~20 minutes total per group), requiring all members to attend.

**Suggested Internal Milestones:** 
* Day 1: Short pitch + user stories draft.
* Day 2: Architecture defined and event schema defined.
* Day 4: Full end-to-end system running via docker compose.
* Day 5: Documentation and slides finalized.

### 3. Provided Materials & Simulator
You are provided with a Docker container simulating a heterogeneous IoT environment, which you must not modify. It includes REST-based devices (must be polled) and Publish-based devices (emitting telemetry asynchronously to topics).

**Running the Simulator:**
* Load the image: `docker load -i mars-iot-simulator-oci.tar`.
* Run the container: `docker run --rm -p 8080:8080 mars-iot-simulator:multiarch_v1`.
* All endpoints are served from `http://localhost:8080`.

**Sensors & Telemetry:**
* REST sensors include greenhouse_temperature, entrance_humidity, co2_hall, hydroponic_ph, water_tank_level, corridor_pressure, air_quality_pm25, and air_quality_voc.
* Telemetry streams (consumed via SSE or WebSocket) include solar_array, radiation, life_support, thermal_loop, power_bus, power_consumption, and airlock. The default publish interval is 5 seconds.
* Actuators include cooling_fan, entrance_humidifier, hall_ventilation, and habitat_heater. They are controlled exclusively via REST by POSTing a JSON payload.

### 4. What You Must Deliver
You must design and implement a distributed automation platform that: 
1. Collects data from simulated devices.
2. Normalizes heterogeneous payloads into a standard internal event format, documented in an `input.md` file.
3. Uses an event-driven architecture internally (a message broker is required).
4. Evaluates simple event-triggered automation rules.
5. Maintains and exposes the latest state of each sensor via in-memory caching.
6. Provides a real-time dashboard.

**Additional Constraints:**
* **Persistence:** Historical sensor data persistence is not required. However, automation rules must be persisted (using SQL, NoSQL, or embedded DBs) so they survive service restarts.
* **Authentication:** Not required; the platform is single-tenant and all sensors are globally visible.
* **Automation Engine:** Must support simple IF-THEN rules (e.g., `IF greenhouse_temperature > 28 °C THEN set cooling_fan to ON`).
* **Dashboard:** Must provide real-time monitoring, a rule management interface, and updates via WebSocket or SSE.
* **Architecture:** Must use multiple backend services, avoid a single monolithic service, and separate ingestion, processing, and presentation. Tight coupling is strongly discouraged.

### 5. Tasks by Group Size 
* **Groups of 5:** Deliver full system and implement ~25 user stories.
* **Groups of 4:** Deliver full system and implement ~20 user stories.
* **Groups of 3:** Deliver full system and implement ~15 user stories.
* **Groups of 2:** May omit telemetry stream handling (REST polling only) and implement ~10 user stories.

### 6. Deliverables & Submission 
Submit a public GitHub repository named `<MATRICOLA>_<PROJECT>` (where MATRICOLA is the group leader's INFOSTUD ID).

**Repository Structure:** 
* `input.md`: System overview, user stories, standard event schema, and rule model.
* `Student_doc.md`: Specifics of the deployed system.
* `source/`: All source code, config files, Dockerfiles, and `docker-compose.yml`. The system must start with `docker compose up` with no manual setup.
* `booklets/`: Slides, LoFi mockups (Balsamiq, Figma, etc.), and images.