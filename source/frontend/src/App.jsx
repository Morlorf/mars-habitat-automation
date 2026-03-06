import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8003'
  : '';
const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:8003/ws'
  : `ws://${window.location.host}/ws`;

// ── Hook: WebSocket ─────────────────────────────────────────

function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    let reconnectTimer;
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try { setLastEvent(JSON.parse(e.data)); } catch { }
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  return { connected, lastEvent };
}

// ── Hook: Fetch State ───────────────────────────────────────

function useApiState() {
  const [sensors, setSensors] = useState({});
  const [rules, setRules] = useState([]);
  const [actuators, setActuators] = useState({});

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, rulesRes, actRes] = await Promise.all([
        fetch(`${API_BASE}/api/state`),
        fetch(`${API_BASE}/api/rules`),
        fetch(`${API_BASE}/api/actuators`),
      ]);
      if (stateRes.ok) setSensors(await stateRes.json());
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (actRes.ok) {
        const data = await actRes.json();
        setActuators(data.actuators || data);
      }
    } catch (e) { console.error('Fetch error:', e); }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  return { sensors, setSensors, rules, setRules, actuators, setActuators, fetchState };
}

// ── Sensor Card ─────────────────────────────────────────────

function SensorCard({ source, event }) {
  const p = event.payload || {};
  const status = p.status || 'unknown';
  const ago = event._cached_at
    ? `${Math.round((Date.now() - new Date(event._cached_at).getTime()) / 1000)}s ago`
    : '';

  return (
    <div className={`sensor-card ${status}`}>
      <div className="sensor-header">
        <span className="sensor-name">{source.replace(/_/g, ' ')}</span>
        <span className="sensor-location">{event.location}</span>
      </div>
      <div className="sensor-value">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value ?? '—'}</div>
      <div className="sensor-unit">{p.unit || ''}</div>
      <div className="sensor-metric">{p.metric}</div>
      <div className="sensor-footer">
        <span className={`sensor-status ${status}`}>● {status}</span>
        <span className="sensor-time">{ago}</span>
      </div>
    </div>
  );
}

// ── Actuator Card ───────────────────────────────────────────

function ActuatorCard({ name, state, onToggle }) {
  const isOn = state === 'ON';
  return (
    <div className="actuator-card">
      <div className="actuator-name">{name.replace(/_/g, ' ')}</div>
      <div className={`actuator-state ${isOn ? 'on' : 'off'}`}>{state}</div>
      <button
        className={`actuator-btn ${isOn ? 'turn-off' : 'turn-on'}`}
        onClick={() => onToggle(name, isOn ? 'OFF' : 'ON')}
      >
        Turn {isOn ? 'OFF' : 'ON'}
      </button>
    </div>
  );
}

// ── Rule Form Modal ─────────────────────────────────────────

const SENSORS = [
  { id: 'greenhouse_temperature', label: 'Greenhouse Temperature', unit: '°C' },
  { id: 'entrance_humidity', label: 'Entrance Humidity', unit: '%' },
  { id: 'co2_hall', label: 'CO₂ Hall', unit: 'ppm' },
  { id: 'hydroponic_ph', label: 'Hydroponic pH', unit: 'pH' },
  { id: 'water_tank_level', label: 'Water Tank Level', unit: '%' },
  { id: 'corridor_pressure', label: 'Corridor Pressure', unit: 'kPa' },
  { id: 'air_quality_pm25', label: 'Air Quality PM2.5', unit: 'µg/m³' },
  { id: 'air_quality_voc', label: 'Air Quality VOC', unit: 'idx' },
];

const OPERATORS = ['<', '<=', '==', '>', '>='];
const OPERATOR_LABELS = { '<': '<', '<=': '≤', '==': '=', '>': '>', '>=': '≥' };

const ACTUATOR_IDS = ['cooling_fan', 'entrance_humidifier', 'hall_ventilation', 'habitat_heater'];

/** Extract sensor / operator / value from stored rule conditions for editing */
function parseRuleForEdit(initial) {
  if (!initial) return {};
  const conds = initial.condition?.conditions || [];
  const sourceCond = conds.find((c) => c.field === 'source');
  const valueCond = conds.find((c) => c.field === 'payload.value');
  return {
    sensor: sourceCond?.value || '',
    operator: valueCond?.operator || '>',
    value: valueCond?.value ?? '',
  };
}

function RuleFormModal({ onClose, onSave, initial }) {
  const parsed = parseRuleForEdit(initial);
  const [name, setName] = useState(initial?.name || '');
  const [desc, setDesc] = useState(initial?.description || '');
  const [sensor, setSensor] = useState(parsed.sensor || '');
  const [op, setOp] = useState(parsed.operator || '>');
  const [val, setVal] = useState(parsed.value ?? '');
  const [actuator, setActuator] = useState(initial?.action?.actuator || '');
  const [actState, setActState] = useState(initial?.action?.state || 'ON');

  const selectedSensor = SENSORS.find((s) => s.id === sensor) || {};

  const handleSubmit = (e) => {
    e.preventDefault();
    const rule = {
      name,
      description: desc,
      condition: {
        logic: 'AND',
        conditions: [
          { field: 'source', operator: '==', value: sensor },
          { field: 'payload.value', operator: op, value: Number(val) },
        ],
      },
      action: { actuator, state: actState },
      is_active: initial?.is_active ?? true,
      priority: 0,
    };
    onSave(rule);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? 'Edit Rule' : 'Create New Rule'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Rule Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cool Greenhouse" required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional description" />
          </div>

          <h3 className="form-section-label">IF (Condition)</h3>
          <div className="rule-sentence">
            <select value={sensor} onChange={(e) => setSensor(e.target.value)} className="select-sensor" required>
              <option value="" disabled>Select sensor...</option>
              {SENSORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={op} onChange={(e) => setOp(e.target.value)} className="select-operator">
              {OPERATORS.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
            </select>
            <input
              type="number"
              step="any"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="value"
              className="input-value"
              required
            />
            <span className="unit-label">{selectedSensor.unit || ''}</span>
          </div>

          <h3 className="form-section-label">THEN (Action)</h3>
          <div className="rule-sentence">
            <select value={actuator} onChange={(e) => setActuator(e.target.value)} className="select-actuator" required>
              <option value="" disabled>Select actuator...</option>
              {ACTUATOR_IDS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
            <span className="to-label">to</span>
            <select value={actState} onChange={(e) => setActState(e.target.value)} className="select-state">
              <option value="ON">ON</option>
              <option value="OFF">OFF</option>
            </select>
          </div>

          <div className="rule-preview">
            <div className="preview-title">Preview</div>
            <div className="preview-content">
              IF {sensor ? selectedSensor.label.toLowerCase() : '[sensor]'} {OPERATOR_LABELS[op]} {val || '?'}{selectedSensor.unit || ''} → set {actuator ? actuator.replace(/_/g, ' ') : '[actuator]'} to {actState}
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!sensor || !actuator || val === ''}>
              {initial ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────

export default function App() {
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deletingRuleId, setDeletingRuleId] = useState(null);
  const { connected, lastEvent } = useWebSocket();
  const { sensors, setSensors, rules, setRules, actuators, setActuators, fetchState } = useApiState();

  // Live update sensors from WebSocket events
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event_type === 'sensor_reading') {
      setSensors((prev) => ({
        ...prev,
        [lastEvent.source]: { ...lastEvent, _cached_at: new Date().toISOString() },
      }));
    }
    if (lastEvent.event_type === 'actuator_command') {
      const act = lastEvent.payload?.actuator_id;
      const cmd = lastEvent.payload?.command;
      if (act && cmd) {
        setActuators((prev) => ({ ...prev, [act]: cmd }));
      }
    }
  }, [lastEvent, setSensors, setActuators]);

  // ── Handlers ──────────────────────────────────────────────

  const handleToggleActuator = async (name, state) => {
    try {
      await fetch(`${API_BASE}/api/actuators/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      setActuators((prev) => ({ ...prev, [name]: state }));
    } catch (e) { console.error('Actuator error:', e); }
  };

  const handleCreateRule = async (rule) => {
    try {
      const res = await fetch(`${API_BASE}/api/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        const created = await res.json();
        setRules((prev) => [...prev, created]);
        setShowModal(false);
      }
    } catch (e) { console.error('Create rule error:', e); }
  };

  const handleEditRule = async (rule) => {
    if (!editingRule) return;
    try {
      const res = await fetch(`${API_BASE}/api/rules/${editingRule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        const updated = await res.json();
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        setEditingRule(null);
        setShowModal(false);
      }
    } catch (e) { console.error('Edit rule error:', e); }
  };

  const handleToggleRule = async (rule) => {
    try {
      const res = await fetch(`${API_BASE}/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      }
    } catch (e) { console.error('Toggle rule error:', e); }
  };

  const confirmDelete = async (ruleId) => {
    try {
      await fetch(`${API_BASE}/api/rules/${ruleId}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setDeletingRuleId(null);
    } catch (e) { console.error('Delete rule error:', e); }
  };

  // ── Render Helpers ────────────────────────────────────────

  const formatCondition = (c) => {
    if (!c?.conditions) return '';
    const sourceCond = c.conditions.find((x) => x.field === 'source');
    const valueCond = c.conditions.find((x) => x.field === 'payload.value');
    if (sourceCond && valueCond) {
      const sensorInfo = SENSORS.find((s) => s.id === sourceCond.value);
      const opLabel = OPERATOR_LABELS[valueCond.operator] || valueCond.operator;
      const unit = sensorInfo ? sensorInfo.unit : '';
      return `${sourceCond.value} ${opLabel} ${valueCond.value}${unit}`;
    }
    return c.conditions.map((x) => `${x.field} ${x.operator} ${x.value}`).join(` ${c.logic} `);
  };

  const sensorGroups = {};
  Object.entries(sensors).forEach(([source, event]) => {
    const loc = event.location || 'unknown';
    if (!sensorGroups[loc]) sensorGroups[loc] = [];
    sensorGroups[loc].push([source, event]);
  });
  const sortedLocations = Object.keys(sensorGroups).sort();

  return (
    <>
      <header className="header">
        <div className="header-brand">
          <div>
            <h1>🔴 MARS HABITAT</h1>
            <div className="subtitle">Automation Control Center</div>
          </div>
        </div>
        <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
      </header>

      <main className="dashboard-layout">
        <section className="dashboard-panel sensors-panel">
          <div className="panel-header">
            <h2>📡 Telemetry Stream</h2>
          </div>
          <div className="panel-content">
            {sortedLocations.length === 0 && (
              <div className="empty-state">
                <p>Waiting for sensor data...</p>
              </div>
            )}
            {sortedLocations.map((loc) => (
              <div key={loc} className="location-group">
                <h3 className="location-header">{loc.replace(/_/g, ' ').toUpperCase()}</h3>
                <div className="sensor-grid">
                  {sensorGroups[loc].map(([source, event]) => (
                    <SensorCard key={source} source={source} event={event} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="dashboard-sidebar">
          <section className="dashboard-panel actuators-panel">
            <div className="panel-header">
              <h2>⚡ Actuators</h2>
            </div>
            <div className="panel-content">
              <div className="actuator-grid">
                {Object.entries(actuators).map(([name, state]) => (
                  <ActuatorCard key={name} name={name} state={state} onToggle={handleToggleActuator} />
                ))}
                {Object.keys(actuators).length === 0 && (
                  <div className="empty-state">
                    <p>Loading actuators...</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="dashboard-panel rules-panel">
            <div className="panel-header">
              <h2>🧠 Automation Logic</h2>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingRule(null); setShowModal(true); }}>
                + New
              </button>
            </div>
            <div className="panel-content">
              <div className="rules-list">
                {rules.map((rule) => (
                  <div key={rule.id} className={`rule-card ${rule.is_active ? '' : 'inactive'}`}>
                    <div className="rule-info">
                      <div className="rule-title-row">
                        <h3>{rule.name}</h3>
                        <span className="priority-badge">P{rule.priority}</span>
                      </div>
                      <div className="rule-detail">
                        IF {formatCondition(rule.condition)} → {rule.action.actuator} = {rule.action.state}
                      </div>
                    </div>
                    <div className="rule-actions">
                      <div
                        className={`toggle ${rule.is_active ? 'active' : ''}`}
                        onClick={() => handleToggleRule(rule)}
                      ></div>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditingRule(rule); setShowModal(true); }}>
                        Edit
                      </button>
                      {deletingRuleId === rule.id ? (
                        <div className="delete-confirm">
                          <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(rule.id)}>Confirm</button>
                        </div>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => setDeletingRuleId(rule.id)}>
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {rules.length === 0 && (
                  <div className="empty-state">
                    <p>No active rules</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {showModal && (
        <RuleFormModal
          onClose={() => { setShowModal(false); setEditingRule(null); }}
          onSave={editingRule ? handleEditRule : handleCreateRule}
          initial={editingRule}
        />
      )}
    </>
  );
}
