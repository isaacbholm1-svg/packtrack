import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.HELPER_ORIGINS = 'https://someone.github.io';
const { createApp } = await import('../helper/index.js');
const { itemsFromMail } = await import('../helper/imap.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('serves the app', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /PackTrack/);
});

test('allows the configured Pages origin, including private-network preflight', async () => {
  const res = await fetch(base + '/status', {
    method: 'OPTIONS',
    headers: { Origin: 'https://someone.github.io', 'Access-Control-Request-Private-Network': 'true', 'Access-Control-Request-Headers': '17token' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://someone.github.io');
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});

test('rejects other websites', async () => {
  const res = await fetch(base + '/email/sync', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('proxy only forwards to tracking APIs', async () => {
  const res = await fetch(base + '/proxy?url=' + encodeURIComponent('https://example.com/'));
  assert.equal(res.status, 403);
});

test('email sync explains missing configuration', async () => {
  const res = await fetch(base + '/email/sync', { method: 'POST' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /IMAP_HOST/);
});

test('turns a shipping email into items', () => {
  const items = itemsFromMail({
    from: 'Verkkokauppa.com <asiakaspalvelu@verkkokauppa.com>',
    subject: 'Tilauksesi 12345678 on lähetetty',
    text: 'Tilausnumero: 12345678\nSeurantakoodi: JJFI64412100012345678',
  });
  assert.deepEqual(items, [{ store: 'verkkokauppa', orderNumber: '12345678', label: 'Tilauksesi 12345678 on lähetetty', trackingNumber: 'JJFI64412100012345678', carrier: 'posti' }]);
  assert.deepEqual(itemsFromMail({ from: 'friend@example.com', subject: 'Order lunch?', text: 'pizza at 12' }), []);
});
