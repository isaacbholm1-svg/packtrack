// Read-only mailbox scan: finds shipping notifications and returns what was found.
// The browser app decides what to store. Never deletes, moves or marks messages as read.

import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { extractShipments } from '../public/lib/extract.js';

const DATA_DIR = process.env.PACKTRACK_DATA_DIR || path.resolve('data');
const STATE_FILE = path.join(DATA_DIR, 'helper-state.json');

// Only messages that look like order/shipping mail are parsed.
const SHIPPING_HINT = /track|shipped|shipment|dispatch|deliver|parcel|package|order|seuranta|lähetys|toimitus|paketti|tilaus|versand|sendung|bestell|levering|leverans|försändelse|forsendelse|pakke/i;

function config() {
  return {
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT) || 993,
    user: process.env.IMAP_USER,
    pass: process.env.IMAP_PASS,
    mailbox: process.env.IMAP_MAILBOX || 'INBOX',
    sinceDays: Number(process.env.IMAP_SINCE_DAYS) || 30,
  };
}

export function imapConfigured() {
  const c = config();
  return Boolean(c.host && c.user && c.pass);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// Turns one parsed email into items for the app.
export function itemsFromMail({ from, subject, text, html }) {
  const r = extractShipments({ from, subject, text, html });
  if (!r.store && !r.candidates.length) return [];
  const base = { store: r.store?.id || null, orderNumber: r.orderNumber, label: r.label };
  const tracked = r.candidates.filter((c) => c.confidence === 'high' || (r.store && c.confidence === 'medium'));
  if (tracked.length) return tracked.map((c) => ({ ...base, trackingNumber: c.trackingNumber, carrier: c.carrier }));
  if (r.store && r.orderNumber) return [base];
  return [];
}

let running = null;

// Returns { scanned, items }. `full: true` rescans the last IMAP_SINCE_DAYS days.
export function syncMailbox({ full = false } = {}) {
  if (running) return running;
  running = doSync(full).finally(() => { running = null; });
  return running;
}

async function doSync(full) {
  const c = config();
  if (!imapConfigured()) throw new Error('Email sync is not configured on the helper (set IMAP_HOST, IMAP_USER and IMAP_PASS in .env)');
  const client = new ImapFlow({ host: c.host, port: c.port, secure: c.port === 993, auth: { user: c.user, pass: c.pass }, logger: false });
  const items = [];
  let scanned = 0;
  await client.connect();
  const lock = await client.getMailboxLock(c.mailbox, { readOnly: true });
  try {
    const mailbox = client.mailbox;
    const st = readState();
    const sameBox = !full && st.uidValidity && String(st.uidValidity) === String(mailbox.uidValidity) && st.mailbox === c.mailbox;
    const query = sameBox && st.lastUid ? { uid: `${st.lastUid + 1}:*` } : { since: new Date(Date.now() - c.sinceDays * 86400e3) };
    let maxUid = sameBox ? st.lastUid : 0;

    for await (const msg of client.fetch(query, { uid: true, envelope: true, source: true }, { uid: true })) {
      if (sameBox && msg.uid <= st.lastUid) continue; // "N:*" always returns the newest message
      maxUid = Math.max(maxUid, msg.uid);
      scanned++;
      const subject = msg.envelope?.subject || '';
      if (!SHIPPING_HINT.test(subject)) continue;
      const from = (msg.envelope?.from || []).map((a) => `${a.name || ''} <${a.address}>`).join(', ');
      const mail = await simpleParser(msg.source);
      items.push(...itemsFromMail({ from, subject, text: mail.text || '', html: mail.html || '' }));
    }
    writeState({ lastUid: maxUid, uidValidity: String(mailbox.uidValidity), mailbox: c.mailbox, lastSyncAt: new Date().toISOString() });
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { scanned, items };
}
