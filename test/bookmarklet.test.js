import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkletSource, parsePasted, PAGE_MARKER } from '../public/lib/bookmarklet.js';
import { extractShipments } from '../public/lib/extract.js';

test('bookmark code is valid JavaScript on one line', () => {
  const src = bookmarkletSource('https://someone.github.io/packtrack/');
  assert.doesNotThrow(() => new Function(src));
  assert.ok(!src.includes('\n'));
  assert.ok(src.includes('"https://someone.github.io/packtrack/"'));
});

test('pasted page text from the iPhone bookmark is recognised', () => {
  const page = parsePasted(`${PAGE_MARKER}https://www.temu.com/bgt_order_detail.html\nOrder details | Temu\nOrder ID: PO-211-01234567890123456\nTracking number: YT2412345678901234`);
  assert.equal(page.url, 'https://www.temu.com/bgt_order_detail.html');
  assert.equal(page.title, 'Order details | Temu');
  const r = extractShipments(page);
  assert.equal(r.store.id, 'temu');
  assert.equal(r.orderNumber, 'PO-211-01234567890123456');
  assert.deepEqual(r.candidates.map((c) => c.trackingNumber), ['YT2412345678901234']);
});

test('ordinary pasted email is not treated as a page', () => {
  assert.equal(parsePasted('Hello\nTracking number: 1Z999AA10123456784'), null);
});
