// Gmail sync that runs entirely in the browser (works on phones).
//
// Sign-in uses Google's OAuth "client-side web app" flow: the page sends you to Google,
// Google sends you back with a short-lived (1 hour) read-only access token in the URL
// fragment. Mail is read straight from Gmail's API by this page; nothing passes through
// any other server. Needs a Google OAuth client ID that you create once (see the app).

import { db } from './db.js';
import { getSettings } from './settings.js';
import { itemsFromMail } from './mail.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MESSAGES = 100;
const MAX_SEEN = 3000;

// Gmail search for order and shipping mail (several languages). {a b} means a OR b.
const KEYWORDS = [
  'tracking', '"track your"', 'shipped', 'dispatched', '"on its way"', '"on the way"', '"out for delivery"', 'shipment',
  'seuranta', 'seurantakoodi', 'lähetetty', 'lähetys', 'toimitus', 'noutopiste',
  'sendungsnummer', 'versandt', 'skickad', 'spårning', 'sporing', 'sendt',
];

export function gmailQuery(lastSyncAt, firstDays = 30) {
  const since = lastSyncAt
    ? `after:${Math.floor((new Date(lastSyncAt).getTime() - 2 * 86400e3) / 1000)}`
    : `newer_than:${firstDays}d`;
  return `${since} {${KEYWORDS.join(' ')}} -in:spam -in:trash`;
}

// ---- sign-in ----

export function gmailState() {
  const s = getSettings();
  return {
    configured: Boolean(s.googleClientId),
    connected: Boolean(s.gmailConnected),
    tokenValid: Boolean(s.gmailToken && s.gmailTokenExpires && Date.now() < s.gmailTokenExpires - 60e3),
    lastSyncAt: s.gmailLastSync || null,
    lastError: s.gmailLastError || null,
  };
}

export function authUrl(clientId, redirectUri, state) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Sends the browser to Google. Comes back to redirectUri with #access_token=…
export function startSignIn(redirectUri) {
  const { googleClientId } = getSettings();
  if (!googleClientId) throw new Error('Add your Google client ID in Settings first');
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.setSettings({ gmailOAuthState: state });
  location.href = authUrl(googleClientId, redirectUri, state);
}

// Handles the return from Google. Returns 'ok', 'error:<reason>' or null (nothing to do).
export function finishSignIn(hash) {
  if (!/(^|[#&])(access_token|error)=/.test(hash || '')) return null;
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const expected = getSettings().gmailOAuthState;
  db.setSettings({ gmailOAuthState: null });
  if (!expected || p.get('state') !== expected) return 'error:sign-in check failed, please try again';
  if (p.get('error')) return `error:${p.get('error')}`;
  if (!String(p.get('scope') || '').includes('gmail.readonly')) return 'error:Gmail access was not allowed';
  db.setSettings({
    gmailToken: p.get('access_token'),
    gmailTokenExpires: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
    gmailConnected: true,
    gmailLastError: null,
  });
  return 'ok';
}

export function disconnectGmail() {
  const token = getSettings().gmailToken;
  db.setSettings({ gmailToken: null, gmailTokenExpires: null, gmailConnected: false, gmailSeen: [], gmailLastSync: null, gmailLastError: null });
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

// ---- reading mail ----

export function decodeBase64Url(data) {
  const b64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// Collects text/plain and text/html bodies from a Gmail message payload (any nesting).
export function messageContent(message) {
  const out = { from: '', subject: '', text: '', html: '' };
  for (const h of message?.payload?.headers || []) {
    const name = h.name.toLowerCase();
    if (name === 'from') out.from = h.value;
    if (name === 'subject') out.subject = h.value;
  }
  const walk = (part) => {
    if (!part) return;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') out.text += decodeBase64Url(part.body.data) + '\n';
      else if (part.mimeType === 'text/html') out.html += decodeBase64Url(part.body.data) + '\n';
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(message?.payload);
  if (!out.text && !out.html && message?.snippet) out.text = message.snippet;
  return out;
}

async function gmailGet(path, token, fetchImpl) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    db.setSettings({ gmailToken: null, gmailTokenExpires: null });
    const err = new Error('Gmail sign-in expired');
    err.needsSignIn = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Gmail: ${body.error?.message || res.statusText}`);
  }
  return res.json();
}

let running = null;

// Reads new shipping mail and returns { scanned, items }. Throws { needsSignIn } when a new sign-in is needed.
export function syncGmail({ fetchImpl = fetch } = {}) {
  if (running) return running;
  running = doSync(fetchImpl).finally(() => { running = null; });
  return running;
}

async function doSync(fetchImpl) {
  const s = getSettings();
  if (!gmailState().tokenValid) {
    const err = new Error('Sign in to Gmail');
    err.needsSignIn = true;
    throw err;
  }
  const token = s.gmailToken;
  const seen = new Set(s.gmailSeen || []);
  const ids = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ q: gmailQuery(s.gmailLastSync), maxResults: '50' });
    if (pageToken) q.set('pageToken', pageToken);
    const list = await gmailGet(`/messages?${q}`, token, fetchImpl);
    for (const m of list.messages || []) if (!seen.has(m.id)) ids.push(m.id);
    pageToken = list.nextPageToken || '';
  } while (pageToken && ids.length < MAX_MESSAGES);

  const items = [];
  let scanned = 0;
  for (const id of ids.slice(0, MAX_MESSAGES)) {
    const msg = await gmailGet(`/messages/${id}?format=full`, token, fetchImpl);
    scanned++;
    seen.add(id);
    items.push(...itemsFromMail(messageContent(msg)));
  }
  db.setSettings({
    gmailSeen: [...seen].slice(-MAX_SEEN),
    gmailLastSync: new Date().toISOString(),
    gmailLastError: null,
  });
  return { scanned, items };
}
