// Settings, stored in this browser alongside the shipments.

import { db } from './db.js';

const DEFAULTS = {
  provider: 'auto', // auto | 17track | ship24 | aftership | mock | none
  seventeenTrackKey: '',
  ship24Key: '',
  aftershipKey: '',
  proxyUrl: '', // optional CORS proxy prefix, e.g. https://packtrack-proxy.you.workers.dev/?url=
  pollMinutes: 60,
  helperUrl: '', // optional local helper for email sync, e.g. http://localhost:3000
};

const NUMBERS = new Set(['pollMinutes']);

export function getSettings() {
  return { ...DEFAULTS, ...db.getSettings() };
}

export function updateSettings(patch) {
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in patch)) continue;
    let v = patch[key];
    if (NUMBERS.has(key)) v = Number(v) || 0;
    else v = String(v ?? '').trim();
    clean[key] = v;
  }
  db.setSettings(clean);
  return getSettings();
}
