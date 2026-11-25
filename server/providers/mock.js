// Demo provider: deterministic fake progress so the app can be tried without an API key.
// Every event is labelled "(demo)" so it can't be confused with real tracking data.

import crypto from 'node:crypto';

const STEPS = [
  { status: 'info_received', text: 'Shipping label created', loc: 'Origin facility' },
  { status: 'in_transit', text: 'Picked up by carrier', loc: 'Origin facility' },
  { status: 'in_transit', text: 'Departed sorting centre', loc: 'Hub' },
  { status: 'in_transit', text: 'Arrived in destination country', loc: 'Import hub' },
  { status: 'out_for_delivery', text: 'Out for delivery', loc: 'Local depot' },
  { status: 'delivered', text: 'Delivered', loc: 'Destination' },
];

export default {
  id: 'mock',
  name: 'Demo data (no API key)',
  async track(shipment) {
    const h = crypto.createHash('sha1').update(shipment.trackingNumber).digest();
    const start = new Date(shipment.createdAt).getTime() - (h[0] % 72) * 3600e3;
    const hoursPerStep = 6 + (h[1] % 18);
    const elapsed = (Date.now() - start) / 3600e3;
    const reached = Math.min(STEPS.length, 1 + Math.floor(elapsed / hoursPerStep));
    const events = STEPS.slice(0, reached).map((s, i) => ({
      time: new Date(start + i * hoursPerStep * 3600e3).toISOString(),
      status: s.status,
      description: `${s.text} (demo)`,
      location: s.loc,
    })).reverse();
    const latest = events[0];
    return {
      status: latest.status,
      statusText: latest.description,
      eta: latest.status === 'delivered' ? null : new Date(start + (STEPS.length - 1) * hoursPerStep * 3600e3).toISOString(),
      events,
    };
  },
};
