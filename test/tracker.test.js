import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../public/lib/db.js';
import { addShipment, addMany, editShipment, refreshShipment, view } from '../public/lib/tracker.js';
import { updateSettings } from '../public/lib/settings.js';
import { proxyTarget } from '../public/lib/providers/http.js';

beforeEach(() => db._reset());

test('add several numbers, dedupe and detect carriers', () => {
  const out = addMany(['1Z999AA10123456784', 'jjfi 6441 2100 0123 45678', '1Z999AA10123456784'].map((trackingNumber) => ({ trackingNumber, label: 'Test' })));
  assert.equal(out.filter((r) => r.created).length, 2);
  assert.equal(out[1].shipment.carrier, 'posti');
  assert.equal(db.listShipments().length, 2);
  assert.equal(view(out[0].shipment).carrierName, 'UPS');
});

test('order placeholder gets upgraded when the tracking number arrives', () => {
  const first = addShipment({ store: 'amazon', orderNumber: '302-1111111-2222222', label: 'Cable' });
  assert.equal(first.shipment.status, 'awaiting_tracking');
  const second = addShipment({ store: 'amazon', orderNumber: '302-1111111-2222222', trackingNumber: 'TBA123456789012' });
  assert.equal(second.created, false);
  assert.equal(second.shipment.id, first.shipment.id);
  assert.equal(second.shipment.trackingNumber, 'TBA123456789012');
  assert.equal(second.shipment.carrier, 'amazon');
  assert.equal(second.shipment.label, 'Cable');
});

test('editing the tracking number resets history and re-detects carrier', () => {
  const { shipment } = addShipment({ trackingNumber: '1Z999AA10123456784' });
  db.updateShipment(shipment.id, { events: [{ description: 'x' }], status: 'in_transit' });
  const s = editShipment(shipment.id, { trackingNumber: 'LP00512345678901', carrier: 'ups' });
  assert.equal(s.carrier, 'cainiao');
  assert.equal(s.status, 'pending');
  assert.deepEqual(s.events, []);
});

test('refresh with the demo provider produces events', async () => {
  updateSettings({ provider: 'mock' });
  const { shipment } = addShipment({ trackingNumber: '1Z999AA10123456784' });
  const s = await refreshShipment(shipment.id);
  assert.ok(s.events.length > 0);
  assert.match(s.events[0].description, /demo/);
  assert.equal(s.error, null);
});

test('refresh without a provider explains what to do', async () => {
  updateSettings({ provider: 'none' });
  const { shipment } = addShipment({ trackingNumber: '1Z999AA10123456784' });
  const s = await refreshShipment(shipment.id);
  assert.match(s.error, /Settings/);
});

test('backup export and restore skips duplicates', () => {
  addShipment({ trackingNumber: '1Z999AA10123456784' });
  const backup = db.exportData();
  db._reset();
  addShipment({ trackingNumber: '1Z999AA10123456784' }); // same number, different id
  assert.equal(db.importData(backup), 0);
  assert.equal(db.importData({ shipments: [{ id: 'x', trackingNumber: 'LP00512345678901', events: [] }] }), 1);
  assert.throws(() => db.importData({ nope: 1 }));
});

test('proxy URL forms', () => {
  assert.equal(proxyTarget('https://p.example.workers.dev', 'https://api.ship24.com/a?b=1'), 'https://p.example.workers.dev/?url=https%3A%2F%2Fapi.ship24.com%2Fa%3Fb%3D1');
  assert.equal(proxyTarget('http://localhost:3000/proxy?url=', 'https://api.17track.net/x'), 'http://localhost:3000/proxy?url=https%3A%2F%2Fapi.17track.net%2Fx');
});
