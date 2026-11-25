import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractShipments } from '../public/lib/extract.js';

const numbers = (r) => r.candidates.map((c) => c.trackingNumber);

test('Amazon shipping email with order number and Amazon Logistics number', () => {
  const r = extractShipments({
    from: 'Amazon.de <versandbestaetigung@amazon.de>',
    subject: 'Ihre Amazon.de Bestellung von "Anker USB-C Kabel" wurde versandt',
    text: `Hallo,
Ihre Bestellung #302-1234567-7654321 wurde versandt.
Sendungsverfolgung: TBA123456789012
Zustellung voraussichtlich: Donnerstag`,
  });
  assert.equal(r.store.id, 'amazon');
  assert.equal(r.orderNumber, '302-1234567-7654321');
  assert.deepEqual(numbers(r), ['TBA123456789012']);
  assert.equal(r.candidates[0].carrier, 'amazon');
  assert.match(r.label, /Anker/);
});

test('Amazon email that only has a "track package" link yields no false positives', () => {
  const r = extractShipments({
    from: 'shipment-tracking@amazon.com',
    subject: 'Your Amazon.com order has shipped',
    html: `<p>Order #112-1234567-1234567</p>
      <a href="https://www.amazon.com/gp/your-account/ship-track?ie=UTF8&orderId=112-1234567-1234567&shipmentId=Dx7kQ2mN9&packageIndex=0">Track package</a>`,
  });
  assert.equal(r.store.id, 'amazon');
  assert.equal(r.orderNumber, '112-1234567-1234567');
  assert.deepEqual(numbers(r), []);
});

test('Temu email with carrier and tracking number', () => {
  const r = extractShipments({
    from: 'Temu <transaction@order.temu.com>',
    subject: 'Your package has shipped!',
    text: `Order ID: PO-211-01234567890123456
Your items are on the way.
Carrier: YunExpress
Tracking number: YT2412345678901234
Track: https://www.temu.com/bgt_order_detail.html?parent_order_sn=PO-211-01234567890123456`,
  });
  assert.equal(r.store.id, 'temu');
  assert.equal(r.orderNumber, 'PO-211-01234567890123456');
  assert.deepEqual(numbers(r), ['YT2412345678901234']);
  assert.equal(r.candidates[0].carrier, 'yunexpress');
});

test('Bambu Lab (Shopify) shipping confirmation with DHL link', () => {
  const r = extractShipments({
    from: 'Bambu Lab <no-reply@eu.store.bambulab.com>',
    subject: 'A shipment from order #EU1234567 is on the way',
    html: `<h2>Your order is on the way</h2>
      <p>DHL Express tracking number: <a href="https://www.dhl.com/en/express/tracking.html?AWB=1234567890&brand=DHL">1234567890</a></p>
      <p>Bambu Lab P1S Combo x 1</p>`,
  });
  assert.equal(r.store.id, 'bambulab');
  assert.equal(r.orderNumber, 'EU1234567');
  assert.deepEqual(numbers(r), ['1234567890']);
  assert.equal(r.candidates[0].carrier, 'dhl');
  assert.equal(r.candidates[0].confidence, 'high');
});

test('Verkkokauppa.com Finnish email with Posti tracking', () => {
  const r = extractShipments({
    from: 'Verkkokauppa.com <asiakaspalvelu@verkkokauppa.com>',
    subject: 'Tilauksesi 12345678 on lähetetty',
    text: `Hei!
Tilausnumero: 12345678
Tilauksesi on lähetetty Postin kautta.
Seurantakoodi: JJFI64412100012345678
Voit seurata lähetystä osoitteessa https://www.posti.fi/fi/seuranta#/lahetys/JJFI64412100012345678`,
  });
  assert.equal(r.store.id, 'verkkokauppa');
  assert.equal(r.orderNumber, '12345678');
  assert.deepEqual(numbers(r), ['JJFI64412100012345678']);
  assert.equal(r.candidates[0].carrier, 'posti');
});

test('Matkahuolto link with plain numeric code', () => {
  const r = extractShipments({
    text: 'Lähetyksesi on matkalla. Seuraa: https://www.matkahuolto.fi/seuranta?parcelNumber=6412345678901',
  });
  assert.deepEqual(numbers(r), ['6412345678901']);
  assert.equal(r.candidates[0].carrier, 'matkahuolto');
});

test('AliExpress email with Cainiao number and multiple packages', () => {
  const r = extractShipments({
    from: 'AliExpress <transaction@notice.aliexpress.com>',
    subject: 'Order 8181234567890123 has been shipped',
    text: `Your order 8181234567890123 has shipped in 2 packages.
Package 1 tracking number: LP00512345678901
Package 2 tracking number: RR123456785FI`,
  });
  assert.equal(r.store.id, 'aliexpress');
  assert.equal(r.orderNumber, '8181234567890123');
  assert.deepEqual(numbers(r).sort(), ['LP00512345678901', 'RR123456785FI']);
});

test('page text from the browser button (store detected by URL)', () => {
  const r = extractShipments({
    url: 'https://www.verkkokauppa.com/fi/account/orders/87654321',
    title: 'Tilaus 87654321 | Verkkokauppa.com',
    text: `Tilaus 87654321
Toimitustapa: Matkahuolto Lähellä-paketti
Seurantatunnus MH123456789012
https://www.matkahuolto.fi/seuranta?parcelNumber=MH123456789012`,
  });
  assert.equal(r.store.id, 'verkkokauppa');
  assert.deepEqual(numbers(r), ['MH123456789012']);
  assert.equal(r.candidates[0].carrier, 'matkahuolto');
});

test('UPS number written with spaces next to keyword', () => {
  const r = extractShipments({ text: 'Your tracking number is 1Z 999 AA1 01 2345 6784.' });
  assert.deepEqual(numbers(r), ['1Z999AA10123456784']);
});

test('ignores random long digit strings that are not near a tracking keyword', () => {
  const r = extractShipments({ text: 'Call us at 0401234567 or quote invoice 123456789012. Total 1299.00 EUR' });
  assert.deepEqual(numbers(r), []);
});

test('unwraps redirect links from mail trackers', () => {
  const r = extractShipments({
    html: '<a href="https://click.mailer.example.com/r?url=https%3A%2F%2Ft.17track.net%2Fen%23nums%3DLP00512345678901">Track</a>',
  });
  assert.deepEqual(numbers(r), ['LP00512345678901']);
});
