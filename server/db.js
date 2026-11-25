// Tiny JSON-file database. One file, written atomically; fine for thousands of shipments.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.PACKTRACK_DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { shipments: [], settings: {}, imap: { lastUid: 0, uidValidity: null } };

let state = null;
let writeTimer = null;

function load() {
  if (state) return state;
  try {
    state = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${FILE}:`, err.message);
    state = structuredClone(EMPTY);
  }
  return state;
}

function flush() {
  clearTimeout(writeTimer);
  writeTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (!writeTimer) writeTimer = setTimeout(flush, 50);
}

process.on('exit', () => { if (writeTimer) flush(); });

export const db = {
  get data() { return load(); },

  listShipments() {
    return load().shipments;
  },

  getShipment(id) {
    return load().shipments.find((s) => s.id === id) || null;
  },

  findByTracking(trackingNumber) {
    return load().shipments.find((s) => s.trackingNumber && s.trackingNumber === trackingNumber) || null;
  },

  findPlaceholder(storeId, orderNumber) {
    if (!storeId || !orderNumber) return null;
    return load().shipments.find((s) => !s.trackingNumber && s.store === storeId && s.orderNumber === orderNumber) || null;
  },

  insertShipment(fields) {
    const now = new Date().toISOString();
    const s = {
      id: crypto.randomUUID(),
      trackingNumber: null,
      carrier: null,
      label: null,
      store: null,
      orderNumber: null,
      status: 'pending',
      statusText: null,
      eta: null,
      events: [],
      archived: false,
      source: 'manual',
      sourceUrl: null,
      error: null,
      providerState: {},
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
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

  getSettings() {
    return load().settings;
  },

  setSettings(patch) {
    const st = load();
    st.settings = { ...st.settings, ...patch };
    save();
    return st.settings;
  },

  getImapState() {
    return load().imap;
  },

  setImapState(patch) {
    const st = load();
    st.imap = { ...st.imap, ...patch };
    save();
  },

  flush,
};
