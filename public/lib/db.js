// Browser storage: everything lives in localStorage on this device.
// Falls back to memory when localStorage is unavailable (private mode, tests).

const KEY = 'packtrack.v1';
const EMPTY = () => ({ shipments: [], settings: {} });

let storage = null;
try {
  storage = globalThis.localStorage || null;
  storage?.getItem(KEY);
} catch {
  storage = null;
}

let state = null;
const listeners = new Set();

function load() {
  if (state) return state;
  try {
    const raw = storage?.getItem(KEY);
    state = { ...EMPTY(), ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    state = EMPTY();
  }
  return state;
}

function save() {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save to browser storage', err);
  }
  for (const fn of listeners) fn();
}

const uuid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// Another tab changed the data → reload it.
globalThis.addEventListener?.('storage', (e) => {
  if (e.key !== KEY) return;
  state = null;
  for (const fn of listeners) fn();
});

export const db = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  persistent: Boolean(storage),

  listShipments() { return load().shipments; },
  getShipment(id) { return load().shipments.find((s) => s.id === id) || null; },
  findByTracking(n) { return load().shipments.find((s) => s.trackingNumber && s.trackingNumber === n) || null; },
  findPlaceholder(storeId, orderNumber) {
    if (!storeId || !orderNumber) return null;
    return load().shipments.find((s) => !s.trackingNumber && s.store === storeId && s.orderNumber === orderNumber) || null;
  },

  insertShipment(fields) {
    const now = new Date().toISOString();
    const s = {
      id: uuid(),
      trackingNumber: null, carrier: null, label: null, store: null, orderNumber: null,
      status: 'pending', statusText: null, eta: null, events: [], archived: false,
      source: 'manual', sourceUrl: null, error: null, providerState: {},
      createdAt: now, updatedAt: now, lastCheckedAt: null,
      ...fields,
    };
    load().shipments.unshift(s);
    save();
    return s;
  },

  updateShipment(id, patch) {
    const s = this.getShipment(id);
    if (!s) return null;
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    save();
    return s;
  },

  deleteShipment(id) {
    const st = load();
    const before = st.shipments.length;
    st.shipments = st.shipments.filter((s) => s.id !== id);
    save();
    return st.shipments.length !== before;
  },

  getSettings() { return load().settings; },
  setSettings(patch) {
    const st = load();
    st.settings = { ...st.settings, ...patch };
    save();
    return st.settings;
  },

  // Backup: { shipments: [...] } – also accepts a data/db.json from the old server version.
  exportData() {
    return { app: 'packtrack', version: 1, exportedAt: new Date().toISOString(), shipments: load().shipments };
  },
  importData(data) {
    const incoming = Array.isArray(data?.shipments) ? data.shipments : null;
    if (!incoming) throw new Error('Not a PackTrack backup file');
    const st = load();
    const known = new Set(st.shipments.map((s) => s.id));
    const knownNumbers = new Set(st.shipments.map((s) => s.trackingNumber).filter(Boolean));
    let added = 0;
    for (const s of incoming) {
      if (!s || typeof s !== 'object' || known.has(s.id) || (s.trackingNumber && knownNumbers.has(s.trackingNumber))) continue;
      st.shipments.push({ ...s, id: s.id || uuid(), events: Array.isArray(s.events) ? s.events : [] });
      added++;
    }
    save();
    return added;
  },

  // Tests only.
  _reset() { state = EMPTY(); save(); },
};
