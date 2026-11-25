// Read-only mailbox sync: scans recent mail for shipping notifications and adds shipments.
// Never deletes, moves or marks messages as read.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getSettings } from '../settings.js';
import { db } from '../db.js';
import { extractShipments } from './extract.js';
import { addShipment } from '../tracker.js';

// Only messages that look like order/shipping mail are parsed; anything from a known store is too.
const SHIPPING_HINT = /track|shipped|shipment|dispatch|deliver|parcel|package|order|seuranta|lähetys|toimitus|paketti|tilaus|versand|sendung|bestell|levering|leverans|försändelse|forsendelse|pakke/i;

export function imapConfigured() {
  const s = getSettings();
  return Boolean(s.imapHost && s.imapUser && s.imapPass);
}

let running = null;

export function syncMailbox() {
  if (running) return running;
  running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const s = getSettings();
  if (!imapConfigured()) throw new Error('Email sync is not configured (IMAP host, user and password needed)');
  const client = new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapPort === 993,
    auth: { user: s.imapUser, pass: s.imapPass },
    logger: false,
  });
  const result = { scanned: 0, matched: 0, added: 0, updated: 0 };
  await client.connect();
  const lock = await client.getMailboxLock(s.imapMailbox || 'INBOX', { readOnly: true });
  try {
    const mailbox = client.mailbox;
    const imap = db.getImapState();
    const sameBox = imap.uidValidity && String(imap.uidValidity) === String(mailbox.uidValidity) && imap.mailbox === s.imapMailbox;
    const since = new Date(Date.now() - s.imapSinceDays * 86400e3);
    const query = sameBox && imap.lastUid ? { uid: `${imap.lastUid + 1}:*` } : { since };
    let maxUid = sameBox ? imap.lastUid : 0;

    for await (const msg of client.fetch(query, { uid: true, envelope: true, source: true }, { uid: true })) {
      if (sameBox && msg.uid <= imap.lastUid) continue; // "N:*" always returns the last message
      maxUid = Math.max(maxUid, msg.uid);
      result.scanned++;
      const subject = msg.envelope?.subject || '';
      const from = (msg.envelope?.from || []).map((a) => `${a.name || ''} <${a.address}>`).join(', ');
      if (!SHIPPING_HINT.test(subject)) continue;

      const mail = await simpleParser(msg.source);
      const r = extractShipments({ from, subject, text: mail.text || '', html: mail.html || '' });
      if (!r.store && !r.candidates.length) continue;
      result.matched++;

      const base = { store: r.store?.id, orderNumber: r.orderNumber, label: r.label };
      const tracked = r.candidates.filter((c) => c.confidence === 'high' || (r.store && c.confidence === 'medium'));
      if (tracked.length) {
        for (const c of tracked) {
          const { created } = addShipment({ ...base, trackingNumber: c.trackingNumber, carrier: c.carrier }, 'email');
          created ? result.added++ : result.updated++;
        }
      } else if (r.store && r.orderNumber) {
        const { created } = addShipment(base, 'email');
        if (created) result.added++;
      }
    }
    db.setImapState({ lastUid: maxUid, uidValidity: String(mailbox.uidValidity), mailbox: s.imapMailbox, lastSyncAt: new Date().toISOString(), lastError: null, lastResult: result });
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return result;
}

export function startMailPoller() {
  const tick = async () => {
    if (!imapConfigured()) return;
    const mins = getSettings().imapMinutes;
    const last = db.getImapState().lastSyncAt;
    if (!mins || (last && Date.now() - new Date(last).getTime() < mins * 60e3 * 0.9)) return;
    try {
      const r = await syncMailbox();
      if (r.added || r.updated) console.log(`[mail] ${r.added} added, ${r.updated} updated from ${r.scanned} message(s)`);
    } catch (err) {
      console.error('[mail]', err.message);
      db.setImapState({ lastError: err.message, lastSyncAt: new Date().toISOString() });
    }
  };
  setTimeout(tick, 8000);
  return setInterval(tick, 60e3);
}
