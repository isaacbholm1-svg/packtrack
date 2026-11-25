// Shipment service: add/merge shipments, refresh them through the tracking provider, poll.

import { db } from './db.js';
import { detectCarrier, normalizeNumber, carrierName, trackingUrl, universalTrackingUrl } from './carriers.js';
import { STORE_BY_ID } from './stores.js';
import { STATUSES, isActive } from './status.js';
import { getProvider } from './providers/index.js';
import { getSettings } from './settings.js';

// Shipment plus display fields for the UI.
export function view(s) {
  return {
    ...s,
    carrierName: s.carrier ? carrierName(s.carrier) : null,
    storeName: s.store ? STORE_BY_ID[s.store]?.name || s.store : null,
    statusLabel: STATUSES[s.status]?.label || s.status,
    trackingUrl: s.trackingNumber ? trackingUrl(s.carrier, s.trackingNumber) : null,
    universalUrl: s.trackingNumber ? universalTrackingUrl(s.trackingNumber) : null,
  };
}

// Adds a shipment, or merges into an existing one:
//  - same tracking number → fill in missing store/order/label
//  - no tracking number yet but same store + order → upgrade that placeholder
// Returns { shipment, created }.
export function addShipment(input, source = 'manual') {
  const trackingNumber = input.trackingNumber ? normalizeNumber(input.trackingNumber) : null;
  const fields = {
    carrier: input.carrier || (trackingNumber ? detectCarrier(trackingNumber)?.carrier || 'other' : null),
    label: input.label?.trim() || null,
    store: input.store || null,
    orderNumber: input.orderNumber?.trim() || null,
    sourceUrl: input.sourceUrl || null,
  };

  if (trackingNumber) {
    const existing = db.findByTracking(trackingNumber);
    if (existing) {
      const patch = {};
      for (const k of ['label', 'store', 'orderNumber', 'sourceUrl']) if (!existing[k] && fields[k]) patch[k] = fields[k];
      return { shipment: Object.keys(patch).length ? db.updateShipment(existing.id, patch) : existing, created: false };
    }
    const placeholder = db.findPlaceholder(fields.store, fields.orderNumber);
    if (placeholder) {
      const patch = { trackingNumber, carrier: fields.carrier, status: 'pending' };
      if (!placeholder.label && fields.label) patch.label = fields.label;
      return { shipment: db.updateShipment(placeholder.id, patch), created: false };
    }
    return { shipment: db.insertShipment({ ...fields, trackingNumber, source }), created: true };
  }

  // No tracking number: keep an "awaiting tracking" placeholder for the order (one per order).
  if (!fields.orderNumber && !fields.label) throw new Error('Give a tracking number, or at least an order number or name');
  const existing = db.findPlaceholder(fields.store, fields.orderNumber)
    || (fields.orderNumber && db.listShipments().find((s) => s.store === fields.store && s.orderNumber === fields.orderNumber));
  if (existing) return { shipment: existing, created: false };
  return { shipment: db.insertShipment({ ...fields, status: 'awaiting_tracking', source }), created: true };
}

export function addMany(items, source) {
  const out = [];
  for (const item of items) {
    if (item.trackingNumber !== undefined && item.trackingNumber !== null && !normalizeNumber(item.trackingNumber)) continue;
    out.push(addShipment(item, item.source || source));
  }
  return out;
}

// Edit from the detail view. Changing the tracking number resets the tracking history.
export function editShipment(id, patch) {
  const cur = db.getShipment(id);
  if (!cur) throw new Error('Shipment not found');
  const clean = {};
  for (const k of ['label', 'carrier', 'store', 'orderNumber', 'archived', 'trackingNumber']) if (k in patch) clean[k] = patch[k];
  if ('trackingNumber' in clean) {
    clean.trackingNumber = normalizeNumber(clean.trackingNumber) || null;
    if (clean.trackingNumber !== cur.trackingNumber) {
      Object.assign(clean, { status: clean.trackingNumber ? 'pending' : 'awaiting_tracking', events: [], statusText: null, eta: null, providerState: {}, error: null });
      if (!clean.carrier || clean.carrier === cur.carrier) clean.carrier = clean.trackingNumber ? detectCarrier(clean.trackingNumber)?.carrier || 'other' : null;
    }
  }
  return db.updateShipment(id, clean);
}

export async function refreshShipment(id) {
  const s = db.getShipment(id);
  if (!s) throw new Error('Shipment not found');
  if (!s.trackingNumber) return s;
  const provider = getProvider();
  if (!provider) {
    return db.updateShipment(id, { error: 'No live tracking set up. Add an API key in Settings, or use the carrier link.' });
  }
  try {
    const r = await provider.track(s);
    return db.updateShipment(id, {
      status: r.status,
      statusText: r.statusText ?? null,
      eta: r.eta ?? null,
      events: r.events?.length ? r.events : s.events,
      providerState: { ...s.providerState, ...(r.providerState || {}), provider: provider.id },
      lastCheckedAt: new Date().toISOString(),
      error: null,
    });
  } catch (err) {
    return db.updateShipment(id, { error: `${provider.name}: ${err.message}`, lastCheckedAt: new Date().toISOString() });
  }
}

let refreshing = null;

// Refresh active shipments one at a time (gentle on free API tiers).
export function refreshAll({ onlyStale = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const pollMs = getSettings().pollMinutes * 60e3;
    const due = db.listShipments().filter((s) => s.trackingNumber && isActive(s)
      && (!onlyStale || !s.lastCheckedAt || Date.now() - new Date(s.lastCheckedAt).getTime() > pollMs * 0.9));
    for (const s of due) {
      await refreshShipment(s.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    return due.length;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function isRefreshing() {
  return Boolean(refreshing);
}

// Checks every few minutes (while the page is open) which shipments are due.
export function startPoller() {
  const tick = () => {
    if (getProvider() && getSettings().pollMinutes > 0) refreshAll({ onlyStale: true }).catch(() => {});
  };
  setTimeout(tick, 2000);
  return setInterval(tick, 5 * 60e3);
}

// Optional local helper (helper/ in the repo) reads the mailbox, which a static page can't.
export async function syncEmailViaHelper() {
  const base = getSettings().helperUrl.replace(/\/+$/, '');
  if (!base) throw new Error('Set the helper address in Settings first');
  let res;
  try {
    res = await fetch(`${base}/email/sync`, { method: 'POST' });
  } catch {
    throw new Error(`Could not reach the helper at ${base}. Is it running (npm start)?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  let added = 0;
  let updated = 0;
  for (const r of addMany(data.items || [], 'email')) r.created ? added++ : updated++;
  return { scanned: data.scanned || 0, added, updated };
}
