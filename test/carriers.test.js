import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCarrier, isValidS10, normalizeNumber, carrierFromHost, trackingUrl } from '../public/lib/carriers.js';

test('normalizes spaces, dashes and case', () => {
  assert.equal(normalizeNumber(' 1z 999 aa1-01234 56784 '), '1Z999AA10123456784');
});

test('S10 checksum', () => {
  assert.ok(isValidS10('RR123456785FI'));
  assert.ok(!isValidS10('RR123456784FI'));
});

test('detects carriers by format', () => {
  const cases = {
    '1Z999AA10123456784': ['ups', 'strong'],
    TBA123456789012: ['amazon', 'strong'],
    JJFI64412100012345678: ['posti', 'strong'],
    RR123456785FI: ['posti', 'strong'],
    CP111222332SE: ['postnord', 'strong'],
    LX987654326CN: ['chinapost', 'strong'],
    RB001122337GB: ['royalmail', 'strong'],
    LP00512345678901: ['cainiao', 'strong'],
    YT2412345678901234: ['yunexpress', 'strong'],
    '9400111899223197428490': ['usps', 'strong'],
    JJD000390012345678901: ['dhl_paket', 'strong'],
    MH123456789012: ['matkahuolto', 'medium'],
    '123456789012': ['fedex', 'weak'],
    '1234567890': ['dhl', 'weak'],
  };
  for (const [n, [carrier, strength]] of Object.entries(cases)) {
    const d = detectCarrier(n);
    assert.equal(d?.carrier, carrier, n);
    assert.equal(d?.strength, strength, n);
  }
});

test('S10 with bad checksum is only a weak match', () => {
  assert.equal(detectCarrier('RR123456784FI').strength, 'weak');
});

test('rejects things that are not tracking numbers', () => {
  for (const n of ['hello', 'ABCDEFGHIJ', '1234', 'SHIPPED-TODAY']) assert.equal(detectCarrier(n), null, n);
});

test('carrier from link host', () => {
  assert.equal(carrierFromHost('www.posti.fi'), 'posti');
  assert.equal(carrierFromHost('www.matkahuolto.fi'), 'matkahuolto');
  assert.equal(carrierFromHost('www.dhl.de'), 'dhl_paket');
  assert.equal(carrierFromHost('www.dhl.com'), 'dhl');
  assert.equal(carrierFromHost('tracking.budbee.com'), 'budbee');
  assert.equal(carrierFromHost('example.com'), null);
});

test('tracking URLs', () => {
  assert.equal(trackingUrl('ups', '1Z999AA10123456784'), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  assert.match(trackingUrl('nope', 'X1'), /17track/);
});

import { matchStore, storeValue, storeLogoUrl, storeName } from '../public/lib/stores.js';

test('typed store names are recognised', () => {
  for (const [typed, id] of [['amazon', 'amazon'], ['Amazon.de', 'amazon'], ['bambu lab', 'bambulab'], ['BambuLab', 'bambulab'],
    ['verkkokauppa', 'verkkokauppa'], ['Verkkokauppa.com', 'verkkokauppa'], ['TEMU', 'temu'], ['jimms.fi', 'jimms'], ['Elgiganten', 'gigantti']]) {
    assert.equal(matchStore(typed)?.id, id, typed);
  }
  assert.equal(matchStore('My local shop'), null);
  assert.equal(matchStore('a'), null);
});

test('custom stores are kept as typed; logos for known stores and web addresses', () => {
  assert.equal(storeValue('  Amazon  '), 'amazon');
  assert.equal(storeValue('My local shop'), 'My local shop');
  assert.equal(storeValue(''), null);
  assert.equal(storeName('amazon'), 'Amazon');
  assert.equal(storeName('My local shop'), 'My local shop');
  assert.match(storeLogoUrl('bambulab'), /domain=bambulab\.com/);
  assert.match(storeLogoUrl('shop.example.fi'), /domain=shop\.example\.fi/);
  assert.equal(storeLogoUrl('My local shop'), null);
});

import { storeLogoSources, storeInitial, storeColor } from '../public/lib/stores.js';

test('every store has a logo source or a letter badge', () => {
  assert.equal(storeLogoSources('temu').length, 2);
  assert.match(storeLogoSources('temu')[1], /duckduckgo\.com\/ip3\/temu\.com\.ico/);
  assert.deepEqual(storeLogoSources('My local shop'), []);
  assert.equal(storeInitial('My local shop'), 'M');
  assert.equal(storeInitial('3djake'), '3');
  assert.equal(storeInitial('ahlens'), 'Å');
  assert.equal(storeColor('amazon'), storeColor('amazon'));
});
