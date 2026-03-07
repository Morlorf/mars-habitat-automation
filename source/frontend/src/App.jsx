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
        try {
          const data = JSON.parse(e.data);
          data._receivedAt = Date.now();
          setLastEvent(data);
        } catch { }
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
   const [activeConflicts, setActiveConflicts] = useState({});

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, rulesRes, actRes, conflictsRes] = await Promise.all([
        fetch(`${API_BASE}/api/state`),
        fetch(`${API_BASE}/api/rules`),
        fetch(`${API_BASE}/api/actuators`),
        fetch(`${API_BASE}/api/conflicts`),
      ]);
      if (stateRes.ok) setSensors(await stateRes.json());
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (actRes.ok) {
        const data = await actRes.json();
        setActuators(data.actuators || data);
      }
      if (conflictsRes.ok) {
        const data = await conflictsRes.json();
        setActiveConflicts(data || {});
      }
    } catch (e) { console.error('Fetch error:', e); }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  return { sensors, setSensors, rules, setRules, actuators, setActuators, activeConflicts, setActiveConflicts, fetchState };
}

// ── Mini SVG Chart ──────────────────────────────────────────

const MAX_HISTORY = 60;

function MiniChart({ data, unit }) {
  if (!data || data.length < 2) {
    return <div className="chart-empty">Collecting data…</div>;
  }
  const W = 300, H = 100, PAD = 4;
  const vals = data.map(d => d.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  // gradient area
  const firstX = PAD;
  const lastX = PAD + ((vals.length - 1) / (vals.length - 1)) * (W - PAD * 2);
  const areaPoints = `${firstX},${H - PAD} ${points} ${lastX},${H - PAD}`;

  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--mars-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--mars-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#chartGrad)" />
        <polyline points={points} fill="none" stroke="var(--mars-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="chart-labels">
        <span>{min.toFixed(1)}{unit}</span>
        <span>{max.toFixed(1)}{unit}</span>
      </div>
    </div>
  );
}

// ── Sensor Card ─────────────────────────────────────────────

function SensorCard({ source, event, listView, expanded, onToggleExpand, history }) {
  const p = event.payload || {};
  const status = p.status || 'unknown';
  const ago = event._cached_at
    ? `${Math.round((Date.now() - new Date(event._cached_at).getTime()) / 1000)}s ago`
    : '';

  if (listView) {
    return (
      <div className={`sensor-row ${status}`}>
        <span className="sensor-row-name">{source.replace(/_/g, ' ')}</span>
        <span className="sensor-row-value">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value ?? '—'} <small>{p.unit || ''}</small></span>
        <span className={`sensor-status ${status}`}>● {status}</span>
        <span className="sensor-row-time">Last update: {ago}</span>
      </div>
    );
  }

  return (
    <div className={`sensor-card ${status}`}>
      <div className="sensor-card-main">
        <div className="sensor-header">
          <span className="sensor-name">{source.replace(/_/g, ' ')}</span>
          <span className="sensor-location">{event.location}</span>
        </div>
        <div className="sensor-value">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value ?? '—'}</div>
        <div className="sensor-unit">{p.unit || ''}</div>
        <div className="sensor-footer">
          <span className={`sensor-status ${status}`}>● {status}</span>
          <span className="sensor-time">Last update: {ago}</span>
        </div>
      </div>
      <div className="sensor-chart-panel">
        <MiniChart data={history} unit={p.unit || ''} />
      </div>
    </div>
  );
}

// ── Actuator Card ───────────────────────────────────────────

function ActuatorCard({ name, state, onToggle }) {
  const isOn = state === 'ON';
  return (
    <div className={`actuator-card ${isOn ? 'actuator-on' : 'actuator-off'}`} onClick={() => onToggle(name, isOn ? 'OFF' : 'ON')}>
      <div className="actuator-name">{name.replace(/_/g, ' ')}</div>
      <div className={`actuator-indicator ${isOn ? 'on' : 'off'}`}>{isOn ? '●' : '○'}</div>
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

const GROUP_NAMES = [
  "MLPG",
  "Members of Laboratory of Programming Group",
  "Mecella Lassace Passà, per Grazia"
];

export default function App() {
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deletingRuleId, setDeletingRuleId] = useState(null);
  const [sensorListView, setSensorListView] = useState(false);
  const [expandedSensor, setExpandedSensor] = useState(null);
  const [groupNameStep, setGroupNameStep] = useState(0);
  const { connected, lastEvent } = useWebSocket();
  const {
    sensors,
    setSensors,
    rules,
    setRules,
    actuators,
    setActuators,
    activeConflicts,
    setActiveConflicts,
    fetchState,
  } = useApiState();
  const sensorHistoryRef = useRef({});
  const [sensorHistory, setSensorHistory] = useState({});

  // Live update sensors from WebSocket events + accumulate history
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.event_type === 'sensor_reading') {
      const src = lastEvent.source;
      const val = lastEvent.payload?.value;
      setSensors((prev) => ({
        ...prev,
        [src]: { ...lastEvent, _cached_at: new Date().toISOString() },
      }));
      // Append to history
      if (typeof val === 'number') {
        const prev = sensorHistoryRef.current[src] || [];
        const next = [...prev, { t: Date.now(), v: val }].slice(-MAX_HISTORY);
        sensorHistoryRef.current[src] = next;
        setSensorHistory((h) => ({ ...h, [src]: next }));
      }
    }
    if (lastEvent.event_type === 'actuator_command') {
      const act = lastEvent.payload?.actuator_id;
      const cmd = lastEvent.payload?.command;
      if (act && cmd) {
        setActuators((prev) => ({ ...prev, [act]: cmd }));
      }
    }
    if (lastEvent.event_type === 'rule_conflict') {
      const act = lastEvent.payload?.actuator_id;
      const ruleIds = lastEvent.payload?.rule_ids || [];
      const resolved = lastEvent.payload?.resolved;
      if (act) {
        setActiveConflicts((prev) => {
          if (resolved) {
            const next = { ...prev };
            delete next[act];
            return next;
          }
          return { ...prev, [act]: ruleIds };
        });
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

        // If this rule was part of an active conflict and we just disabled it,
        // optimistically update the conflict state so the UI clears immediately.
        if (rule.is_active && !updated.is_active) {
          const actuator = rule.action?.actuator;
          if (actuator) {
            setActiveConflicts((prev) => {
              const next = { ...prev };
              const existing = next[actuator] || [];
              const filtered = existing.filter((id) => String(id) !== String(rule.id));

              // A conflict requires at least two rules; if we drop below that,
              // remove the conflict entry for this actuator.
              if (filtered.length < 2) {
                delete next[actuator];
              } else {
                next[actuator] = filtered;
              }
              return next;
            });
          }
        }
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
      const sensorLabel = sensorInfo ? sensorInfo.label.toLowerCase() : sourceCond.value.replace(/_/g, ' ');
      return `${sensorLabel} ${opLabel} ${valueCond.value}${unit}`;
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
            <div className="title-row">
              <h1>🔴 MARS HABITAT</h1>
            </div>
            <div className="subtitle">Automation Control Center</div>
            <span className="group-name-label" onClick={() => setGroupNameStep(p => (p + 1) % GROUP_NAMES.length)}>
              {GROUP_NAMES[groupNameStep]}
            </span>
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
            <div className="view-toggle">
              <button className={`view-btn ${!sensorListView ? 'active' : ''}`} onClick={() => setSensorListView(false)} title="Grid view">▦</button>
              <button className={`view-btn ${sensorListView ? 'active' : ''}`} onClick={() => setSensorListView(true)} title="List view">☰</button>
            </div>
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
                <div className={sensorListView ? 'sensor-list' : 'sensor-grid'}>
                  {sensorGroups[loc].map(([source, event]) => (
                    <SensorCard
                      key={source}
                      source={source}
                      event={event}
                      listView={sensorListView}
                      expanded={expandedSensor === source}
                      onToggleExpand={() => setExpandedSensor(expandedSensor === source ? null : source)}
                      history={sensorHistory[source] || []}
                    />
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
                {rules.map((rule) => {
                  const actLabel = rule.action.actuator.replace(/_/g, ' ');
                  const conflictRuleIds = Object.values(activeConflicts).flat().map(id => String(id));
                  const inConflict = conflictRuleIds.includes(String(rule.id));
                  return (
                    <div key={rule.id} className={`rule-card ${rule.is_active ? '' : 'inactive'} ${inConflict ? 'conflict-glow' : ''}`}>
                      <div className="rule-info">
                        <h3>
                          {rule.name}
                          {inConflict && (
                            <span className="conflict-warning" title="Conflict Detected: Multiple rules trying to set different states for this actuator">
                              ⚠️
                            </span>
                          )}
                        </h3>
                        <div className="rule-detail">
                          IF {formatCondition(rule.condition)} → set {actLabel} to {rule.action.state}
                        </div>
                      </div>
                      <div className="rule-actions">
                        <div
                          className={`toggle ${rule.is_active ? 'active' : ''}`}
                          onClick={() => handleToggleRule(rule)}
                        ></div>
                        <div className="rule-actions-right">
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditingRule(rule); setShowModal(true); }}>
                            Edit
                          </button>
                          {deletingRuleId === rule.id ? (
                            <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(rule.id)}>Confirm</button>
                          ) : (
                            <button className="btn btn-danger btn-sm" onClick={() => setDeletingRuleId(rule.id)}>
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
