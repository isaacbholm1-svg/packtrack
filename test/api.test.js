import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packtrack-test-'));
process.env.PACKTRACK_DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.TRACKING_PROVIDER = 'mock';

const { default: app } = await import('../server/index.js');
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (p, method = 'GET', body) => {
  const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('add several numbers, dedupe, refresh, edit, delete', async () => {
  const add = await call('/api/shipments', 'POST', { numbers: ['1Z999AA10123456784', 'jjfi 6441 2100 0123 45678', '1Z999AA10123456784'], label: 'Test' });
  assert.equal(add.status, 201);
  assert.equal(add.body.filter((s) => s.created).length, 2);
  assert.equal(add.body[1].carrier, 'posti');

  const list = await call('/api/shipments');
  assert.equal(list.body.length, 2);

  const id = list.body.find((s) => s.carrier === 'ups').id;
  const ref = await call(`/api/shipments/${id}/refresh`, 'POST');
  assert.ok(ref.body.events.length > 0);
  assert.match(ref.body.events[0].description, /demo/);
  assert.equal(ref.body.providerState, undefined);

  const patched = await call(`/api/shipments/${id}`, 'PATCH', { label: 'Renamed', archived: true });
  assert.equal(patched.body.label, 'Renamed');
  assert.equal(patched.body.archived, true);

  assert.equal((await call(`/api/shipments/${id}`, 'DELETE')).status, 204);
  assert.equal((await call('/api/shipments')).body.length, 1);
});

test('order placeholder gets upgraded when the tracking number arrives', async () => {
  const first = await call('/api/shipments', 'POST', { items: [{ store: 'amazon', orderNumber: '302-1111111-2222222', label: 'Cable' }] });
  assert.equal(first.body[0].status, 'awaiting_tracking');

  const second = await call('/api/shipments', 'POST', { items: [{ store: 'amazon', orderNumber: '302-1111111-2222222', trackingNumber: 'TBA123456789012' }] });
  assert.equal(second.body[0].created, false);
  assert.equal(second.body[0].id, first.body[0].id);
  assert.equal(second.body[0].trackingNumber, 'TBA123456789012');
  assert.equal(second.body[0].label, 'Cable');
});

test('parse endpoint does not save anything', async () => {
  const before = (await call('/api/shipments')).body.length;
  const r = await call('/api/import/parse', 'POST', { text: 'Tracking number: LP00512345678901', from: 'AliExpress <x@aliexpress.com>' });
  assert.equal(r.body.store.id, 'aliexpress');
  assert.equal(r.body.candidates[0].carrierName, 'Cainiao');
  assert.equal((await call('/api/shipments')).body.length, before);
});

test('settings never expose secrets', async () => {
  await call('/api/settings', 'PUT', { ship24Key: 'secret-123' });
  const s = await call('/api/settings');
  assert.deepEqual(s.body.ship24Key, { set: true });
  assert.ok(!JSON.stringify(s.body).includes('secret-123'));
});
