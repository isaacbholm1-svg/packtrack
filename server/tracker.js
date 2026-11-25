// Shipment service: add/merge shipments, refresh them through the tracking provider, poll.

import { db } from './db.js';
import { detectCarrier, normalizeNumber } from './carriers.js';
import { getProvider } from './providers/index.js';
import { getSettings } from './settings.js';
import { isActive } from './status.js';

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

export async function refreshShipment(id) {
  const s = db.getShipment(id);
  if (!s) throw new Error('Shipment not found');
  if (!s.trackingNumber) return s;
  const provider = getProvider();
  if (!provider) {
    return db.updateShipment(id, { error: 'No tracking provider configured – add an API key in Settings, or use the carrier link.' });
  }
  try {
    const r = await provider.track(s);
    const changed = r.status !== s.status || (r.events?.length || 0) !== (s.events?.length || 0);
    return db.updateShipment(id, {
      status: r.status,
      statusText: r.statusText ?? null,
      eta: r.eta ?? null,
      events: r.events?.length ? r.events : s.events,
      providerState: { ...s.providerState, ...(r.providerState || {}), provider: provider.id },
      lastCheckedAt: new Date().toISOString(),
      ...(changed ? { lastChangeAt: new Date().toISOString() } : {}),
      error: null,
    });
  } catch (err) {
    return db.updateShipment(id, { error: `${provider.name}: ${err.message}`, lastCheckedAt: new Date().toISOString() });
  }
}

let refreshing = null;

// Refresh all active shipments one at a time (gentle on free API tiers).
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

export function startPoller() {
  const tick = async () => {
    if (getProvider() && getSettings().pollMinutes > 0) {
      try {
        const n = await refreshAll({ onlyStale: true });
        if (n) console.log(`[poll] refreshed ${n} shipment(s)`);
      } catch (err) {
        console.error('[poll]', err.message);
      }
    }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 5 * 60e3); // check every 5 min which shipments are due
}
