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

const OPERATORS = ['==', '!=', '>', '>=', '<', '<='];
const SENSOR_IDS = [
  'greenhouse_temperature', 'entrance_humidity', 'co2_hall',
  'hydroponic_ph', 'water_tank_level', 'corridor_pressure',
  'air_quality_pm25', 'air_quality_voc',
];
const ACTUATOR_IDS = ['cooling_fan', 'entrance_humidifier', 'hall_ventilation', 'habitat_heater'];

function RuleFormModal({ onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || '');
  const [desc, setDesc] = useState(initial?.description || '');
  const [field, setField] = useState(initial?.condition?.conditions?.[0]?.field || 'source');
  const [op, setOp] = useState(initial?.condition?.conditions?.[0]?.operator || '==');
  const [val, setVal] = useState(initial?.condition?.conditions?.[0]?.value ?? '');
  const [field2, setField2] = useState(initial?.condition?.conditions?.[1]?.field || 'payload.value');
  const [op2, setOp2] = useState(initial?.condition?.conditions?.[1]?.operator || '>');
  const [val2, setVal2] = useState(initial?.condition?.conditions?.[1]?.value ?? '');
  const [actuator, setActuator] = useState(initial?.action?.actuator || ACTUATOR_IDS[0]);
  const [actState, setActState] = useState(initial?.action?.state || 'ON');
  const [priority, setPriority] = useState(initial?.priority ?? 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const rule = {
      name,
      description: desc,
      condition: {
        logic: 'AND',
        conditions: [
          { field, operator: op, value: isNaN(val) ? val : Number(val) },
          ...(field2 && val2 !== '' ? [{ field: field2, operator: op2, value: isNaN(val2) ? val2 : Number(val2) }] : []),
        ],
      },
      action: { actuator, state: actState },
      is_active: true,
      priority: Number(priority),
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

          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '20px 0 12px' }}>IF (Condition 1)</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Field</label>
              <select value={field} onChange={(e) => setField(e.target.value)}>
                <option value="source">source</option>
                <option value="location">location</option>
                <option value="payload.metric">payload.metric</option>
                <option value="payload.value">payload.value</option>
                <option value="payload.status">payload.status</option>
              </select>
            </div>
            <div className="form-group">
              <label>Operator</label>
              <select value={op} onChange={(e) => setOp(e.target.value)}>
                {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Value</label>
            <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. greenhouse_temperature or 24" required />
          </div>

          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '20px 0 12px' }}>AND (Condition 2 — optional)</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Field</label>
              <select value={field2} onChange={(e) => setField2(e.target.value)}>
                <option value="">None</option>
                <option value="source">source</option>
                <option value="location">location</option>
                <option value="payload.metric">payload.metric</option>
                <option value="payload.value">payload.value</option>
                <option value="payload.status">payload.status</option>
              </select>
            </div>
            <div className="form-group">
              <label>Operator</label>
              <select value={op2} onChange={(e) => setOp2(e.target.value)}>
                {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          {field2 && (
            <div className="form-group">
              <label>Value</label>
              <input value={val2} onChange={(e) => setVal2(e.target.value)} placeholder="e.g. 30" />
            </div>
          )}

          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '20px 0 12px' }}>THEN (Action)</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Actuator</label>
              <select value={actuator} onChange={(e) => setActuator(e.target.value)}>
                {ACTUATOR_IDS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>State</label>
              <select value={actState} onChange={(e) => setActState(e.target.value)}>
                <option value="ON">ON</option>
                <option value="OFF">OFF</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Priority (higher = more important)</label>
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
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
  const [tab, setTab] = useState('sensors');
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
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

  const handleDeleteRule = async (ruleId) => {
    if (!confirm('Delete this rule?')) return;
    try {
      await fetch(`${API_BASE}/api/rules/${ruleId}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (e) { console.error('Delete rule error:', e); }
  };

  // ── Render ────────────────────────────────────────────────

  const formatCondition = (c) => {
    if (!c?.conditions) return '';
    return c.conditions.map((x) => `${x.field} ${x.operator} ${x.value}`).join(` ${c.logic} `);
  };

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

      <nav className="tabs">
        <button className={`tab ${tab === 'sensors' ? 'active' : ''}`} onClick={() => setTab('sensors')}>
          Sensors
        </button>
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
          Rules
        </button>
        <button className={`tab ${tab === 'actuators' ? 'active' : ''}`} onClick={() => setTab('actuators')}>
          Actuators
        </button>
      </nav>

      <main className="main">
        {/* ── Sensors Tab ─────────────────────────── */}
        {tab === 'sensors' && (() => {
          const groups = {};
          Object.entries(sensors).forEach(([source, event]) => {
            const loc = event.location || 'unknown';
            if (!groups[loc]) groups[loc] = [];
            groups[loc].push([source, event]);
          });
          const sortedLocations = Object.keys(groups).sort();
          return (
            <div>
              {sortedLocations.length === 0 && (
                <div className="empty-state">
                  <p>Waiting for sensor data...</p>
                  <span>Connect to the API Gateway to start receiving events.</span>
                </div>
              )}
              {sortedLocations.map((loc) => (
                <div key={loc} className="location-group">
                  <h2 className="location-header">{loc.replace(/_/g, ' ').toUpperCase()}</h2>
                  <div className="sensor-grid">
                    {groups[loc].map(([source, event]) => (
                      <SensorCard key={source} source={source} event={event} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Rules Tab ──────────────────────────── */}
        {tab === 'rules' && (
          <>
            <div className="rules-header">
              <h2>Automation Rules ({rules.length})</h2>
              <button className="btn btn-primary" onClick={() => { setEditingRule(null); setShowModal(true); }}>
                + New Rule
              </button>
            </div>
            <div className="rules-list">
              {rules.map((rule) => (
                <div key={rule.id} className={`rule-card ${rule.is_active ? '' : 'inactive'}`}>
                  <div className="rule-info">
                    <div className="rule-title-row">
                      <h3>{rule.name}</h3>
                      <span className="priority-badge">P{rule.priority}</span>
                    </div>
                    {rule.description && <p>{rule.description}</p>}
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
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(rule.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <div className="empty-state">
                  <p>No rules yet</p>
                  <span>Create your first automation rule to get started.</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Actuators Tab ──────────────────────── */}
        {tab === 'actuators' && (
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
        )}
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
