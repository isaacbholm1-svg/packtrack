// Turns one email into shipment items for the app. Used by Gmail sync (in the browser)
// and the computer helper (IMAP).

import { extractShipments } from './extract.js';

export function itemsFromMail({ from, subject, text, html }) {
  const r = extractShipments({ from, subject, text, html });
  if (!r.store && !r.candidates.length) return [];
  const base = { store: r.store?.id || null, orderNumber: r.orderNumber, label: r.label };
  const tracked = r.candidates.filter((c) => c.confidence === 'high' || (r.store && c.confidence === 'medium'));
  if (tracked.length) return tracked.map((c) => ({ ...base, trackingNumber: c.trackingNumber, carrier: c.carrier }));
  if (r.store && r.orderNumber) return [base];
  return [];
}
