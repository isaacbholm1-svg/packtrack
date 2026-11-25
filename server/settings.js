// Settings: values saved from the UI override environment variables.

import { db } from './db.js';

const DEFINITIONS = {
  provider: { env: 'TRACKING_PROVIDER', default: 'auto' }, // auto | 17track | ship24 | aftership | mock | none
  seventeenTrackKey: { env: 'SEVENTEENTRACK_API_KEY', secret: true },
  ship24Key: { env: 'SHIP24_API_KEY', secret: true },
  aftershipKey: { env: 'AFTERSHIP_API_KEY', secret: true },
  pollMinutes: { env: 'POLL_MINUTES', default: 60, number: true },
  imapHost: { env: 'IMAP_HOST' },
  imapPort: { env: 'IMAP_PORT', default: 993, number: true },
  imapUser: { env: 'IMAP_USER' },
  imapPass: { env: 'IMAP_PASS', secret: true },
  imapMailbox: { env: 'IMAP_MAILBOX', default: 'INBOX' },
  imapSinceDays: { env: 'IMAP_SINCE_DAYS', default: 30, number: true },
  imapMinutes: { env: 'IMAP_MINUTES', default: 15, number: true },
};

export function getSettings() {
  const saved = db.getSettings();
  const out = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    let v = saved[key];
    if (v === undefined || v === null || v === '') v = process.env[def.env];
    if (v === undefined || v === null || v === '') v = def.default ?? '';
    if (def.number) v = Number(v) || def.default || 0;
    out[key] = v;
  }
  return out;
}

// Safe to send to the browser: secrets are replaced by a "is set" flag.
export function publicSettings() {
  const s = getSettings();
  const out = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    out[key] = def.secret ? { set: Boolean(s[key]) } : s[key];
  }
  return out;
}

export function updateSettings(patch) {
  const clean = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    if (!(key in patch)) continue;
    let v = patch[key];
    // Secrets: empty string leaves the saved value alone, null clears it.
    if (def.secret && v === '') continue;
    if (def.number && v !== null) v = Number(v);
    clean[key] = v;
  }
  db.setSettings(clean);
  return publicSettings();
}
