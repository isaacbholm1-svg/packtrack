import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { carrierList, trackingUrl, universalTrackingUrl, carrierName, detectCarrier, normalizeNumber } from './carriers.js';
import { STORES, STORE_BY_ID } from './import/stores.js';
import { STATUSES } from './status.js';
import { extractShipments } from './import/extract.js';
import { syncMailbox, imapConfigured, startMailPoller } from './import/imap.js';
import { addShipment, refreshShipment, refreshAll, isRefreshing, startPoller } from './tracker.js';
import { getProvider } from './providers/index.js';
import { publicSettings, updateSettings } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function view(s) {
  return {
    ...s,
    providerState: undefined,
    carrierName: s.carrier ? carrierName(s.carrier) : null,
    storeName: s.store ? STORE_BY_ID[s.store]?.name || s.store : null,
    statusLabel: STATUSES[s.status]?.label || s.status,
    trackingUrl: s.trackingNumber ? trackingUrl(s.carrier, s.trackingNumber) : null,
    universalUrl: s.trackingNumber ? universalTrackingUrl(s.trackingNumber) : null,
  };
}

app.get('/api/meta', (req, res) => {
  const provider = getProvider();
  res.json({
    carriers: carrierList(),
    stores: STORES.map((s) => ({ id: s.id, name: s.name })),
    statuses: STATUSES,
    provider: provider ? { id: provider.id, name: provider.name } : null,
    email: { configured: imapConfigured(), ...db.getImapState(), uidValidity: undefined, lastUid: undefined },
    refreshing: isRefreshing(),
  });
});

app.get('/api/shipments', (req, res) => {
  res.json(db.listShipments().map(view));
});

app.get('/api/detect', (req, res) => {
  const n = normalizeNumber(req.query.n);
  const d = detectCarrier(n);
  res.json({ trackingNumber: n, ...(d || {}), carrierName: d ? carrierName(d.carrier) : null });
});

// Add one or many. Body: { trackingNumber | numbers: [...], carrier?, label?, store?, orderNumber? }
app.post('/api/shipments', wrap(async (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.items) ? b.items
    : Array.isArray(b.numbers) ? b.numbers.map((n) => ({ ...b, numbers: undefined, trackingNumber: n }))
      : [b];
  const out = [];
  for (const item of list) {
    if (item.trackingNumber !== undefined && !normalizeNumber(item.trackingNumber)) continue;
    const { shipment, created } = addShipment(item, b.source || item.source || 'manual');
    out.push({ ...view(shipment), created });
  }
  res.status(201).json(out);
  // Fetch status for new ones in the background.
  for (const s of out) if (s.created && s.trackingNumber) refreshShipment(s.id).catch(() => {});
}));

app.patch('/api/shipments/:id', (req, res) => {
  const allowed = ['label', 'carrier', 'store', 'orderNumber', 'archived', 'trackingNumber'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  if ('trackingNumber' in patch) {
    patch.trackingNumber = normalizeNumber(patch.trackingNumber) || null;
    const cur = db.getShipment(req.params.id);
    if (cur && patch.trackingNumber !== cur.trackingNumber) {
      Object.assign(patch, { status: patch.trackingNumber ? 'pending' : 'awaiting_tracking', events: [], statusText: null, eta: null, providerState: {} });
      if (!('carrier' in patch)) patch.carrier = patch.trackingNumber ? detectCarrier(patch.trackingNumber)?.carrier || 'other' : null;
    }
  }
  const s = db.updateShipment(req.params.id, patch);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(view(s));
});

app.delete('/api/shipments/:id', (req, res) => {
  res.status(db.deleteShipment(req.params.id) ? 204 : 404).end();
});

app.post('/api/shipments/:id/refresh', wrap(async (req, res) => {
  res.json(view(await refreshShipment(req.params.id)));
}));

app.post('/api/refresh', (req, res) => {
  refreshAll().catch((err) => console.error(err));
  res.status(202).json({ started: true });
});

// Parse pasted email / page text without saving anything.
app.post('/api/import/parse', (req, res) => {
  const { text = '', html = '', from = '', subject = '', url = '', title = '' } = req.body || {};
  if (!text && !html) return res.status(400).json({ error: 'Nothing to parse' });
  const r = extractShipments({ text, html, from, subject, url, title });
  res.json({
    ...r,
    candidates: r.candidates.map((c) => ({ ...c, carrierName: carrierName(c.carrier), exists: Boolean(db.findByTracking(c.trackingNumber)) })),
  });
});

app.post('/api/email/sync', wrap(async (req, res) => {
  res.json(await syncMailbox());
}));

app.get('/api/settings', (req, res) => res.json(publicSettings()));
app.put('/api/settings', (req, res) => res.json(updateSettings(req.body || {})));

app.use((err, req, res, _next) => {
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`);
  res.status(400).json({ error: err.message });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    const p = getProvider();
    console.log(`PackTrack running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(p ? `Tracking provider: ${p.name}` : 'No tracking provider configured yet — open Settings in the app to add an API key.');
    startPoller();
    startMailPoller();
  });
  const shutdown = () => { db.flush(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
