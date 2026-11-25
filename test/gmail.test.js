import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../public/lib/db.js';
import { updateSettings } from '../public/lib/settings.js';
import {
  authUrl, finishSignIn, gmailState, gmailQuery, messageContent, decodeBase64Url, syncGmail,
} from '../public/lib/gmail.js';

const b64url = (str) => Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const verkkokauppaMail = {
  id: 'm1',
  payload: {
    headers: [
      { name: 'From', value: 'Verkkokauppa.com <asiakaspalvelu@verkkokauppa.com>' },
      { name: 'Subject', value: 'Tilauksesi 12345678 on lähetetty' },
    ],
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('Hei! Tilausnumero: 12345678\nSeurantakoodi: JJFI64412100012345678\nKiitos että valitsit meidät') } },
        { mimeType: 'text/html', body: { data: b64url('<p>Seurantakoodi: <a href="https://www.posti.fi/fi/seuranta#/lahetys/JJFI64412100012345678">JJFI64412100012345678</a></p>') } },
      ],
    }],
  },
};
const newsletter = {
  id: 'm2',
  payload: { headers: [{ name: 'From', value: 'News <news@example.com>' }, { name: 'Subject', value: 'Black Friday deals shipped to your inbox' }], mimeType: 'text/plain', body: { data: b64url('Big sale!') } },
};

function fakeGmail(messages, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.Authorization });
    if (status !== 200) return new Response('{}', { status });
    const u = new URL(url);
    if (u.pathname.endsWith('/messages')) {
      return Response.json({ messages: messages.map((m) => ({ id: m.id })) });
    }
    const id = u.pathname.split('/').pop();
    return Response.json(messages.find((m) => m.id === id));
  };
  return { fetchImpl, calls };
}

function signedIn() {
  updateSettings({ googleClientId: 'abc.apps.googleusercontent.com' });
  db.setSettings({ gmailOAuthState: 'xyz' });
  return finishSignIn('#access_token=tok123&token_type=Bearer&expires_in=3599&scope=https://www.googleapis.com/auth/gmail.readonly&state=xyz');
}

beforeEach(() => db._reset());

test('sign-in URL asks only for read-only Gmail access', () => {
  const u = new URL(authUrl('abc.apps.googleusercontent.com', 'https://me.github.io/packtrack/', 's1'));
  assert.equal(u.hostname, 'accounts.google.com');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://me.github.io/packtrack/');
});

test('return from Google: token stored only when the state matches', () => {
  assert.equal(finishSignIn('#import=abc'), null);
  db.setSettings({ gmailOAuthState: 'xyz' });
  assert.match(finishSignIn('#access_token=t&expires_in=3600&scope=gmail.readonly&state=WRONG'), /^error:/);
  assert.equal(gmailState().tokenValid, false);
  assert.equal(signedIn(), 'ok');
  assert.equal(gmailState().tokenValid, true);
  assert.equal(gmailState().connected, true);
});

test('return from Google with an error', () => {
  db.setSettings({ gmailOAuthState: 's' });
  assert.equal(finishSignIn('#error=access_denied&state=s'), 'error:access_denied');
});

test('decodes UTF-8 bodies from nested parts', () => {
  assert.equal(decodeBase64Url(b64url('lähetys ✓')), 'lähetys ✓');
  const c = messageContent(verkkokauppaMail);
  assert.equal(c.subject, 'Tilauksesi 12345678 on lähetetty');
  assert.match(c.text, /Kiitos että/);
  assert.match(c.html, /posti\.fi/);
});

test('search query: last 30 days first time, then since last sync', () => {
  assert.match(gmailQuery(null), /^newer_than:30d \{/);
  assert.match(gmailQuery('2026-11-20T00:00:00Z'), /^after:\d+ /);
});

test('sync finds packages, skips non-shipping mail and already-read messages', async () => {
  signedIn();
  const { fetchImpl, calls } = fakeGmail([verkkokauppaMail, newsletter]);
  const r = await syncGmail({ fetchImpl });
  assert.equal(r.scanned, 2);
  assert.deepEqual(r.items, [{ store: 'verkkokauppa', orderNumber: '12345678', label: 'Tilauksesi 12345678 on lähetetty', trackingNumber: 'JJFI64412100012345678', carrier: 'posti' }]);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok123'));
  assert.ok(calls.every((c) => c.url.startsWith('https://gmail.googleapis.com/')));

  const again = await syncGmail({ fetchImpl });
  assert.equal(again.scanned, 0);
});

test('expired sign-in asks to sign in again', async () => {
  signedIn();
  const { fetchImpl } = fakeGmail([], { status: 401 });
  await assert.rejects(syncGmail({ fetchImpl }), (err) => err.needsSignIn === true);
  assert.equal(gmailState().tokenValid, false);
});

test('not signed in', async () => {
  await assert.rejects(syncGmail({ fetchImpl: async () => { throw new Error('should not fetch'); } }), (err) => err.needsSignIn === true);
});
