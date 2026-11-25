// Optional local helper for the PackTrack web app.
//
//  - Serves the app itself at http://localhost:3000 (same app as on GitHub Pages)
//  - /email/sync  reads your mailbox over IMAP (browsers can't) and returns the shipments it found
//  - /proxy?url=  forwards calls to the tracking APIs for browsers that block them (CORS)
//
// Your packages stay in the browser. The helper keeps only the IMAP position, in data/helper-state.json.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncMailbox, imapConfigured } from './imap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Tracking APIs the proxy may call. Nothing else.
export const PROXY_HOSTS = new Set(['api.17track.net', 'api.ship24.com', 'api.aftership.com']);
const FORWARD_HEADERS = ['content-type', 'accept', 'authorization', '17token', 'as-api-key', 'aftership-api-key'];

// Web pages allowed to use the helper: the helper's own address plus HELPER_ORIGINS
// (e.g. https://yourname.github.io). Other sites can't read your email results.
export function allowedOrigins() {
  return new Set([
    `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
    ...String(process.env.HELPER_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  ]);
}

export function createApp() {
  const app = express();
  const origins = allowedOrigins();

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !origins.has(origin)) {
      console.warn(`Blocked request from ${origin}. To allow it, add it to HELPER_ORIGINS in .env`);
      return res.status(403).json({ error: `This helper doesn't accept requests from ${origin}. Add it to HELPER_ORIGINS in the helper's .env.` });
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', req.get('access-control-request-headers') || FORWARD_HEADERS.join(', '));
      // Chrome asks before an https page talks to localhost.
      if (req.get('access-control-request-private-network')) res.set('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.get('/status', (req, res) => res.json({ helper: 'packtrack', email: imapConfigured() }));

  app.post('/email/sync', async (req, res) => {
    try {
      res.json(await syncMailbox({ full: req.query.full === '1' }));
    } catch (err) {
      console.error('[mail]', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.all('/proxy', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    let target;
    try { target = new URL(String(req.query.url || '')); } catch { return res.status(400).json({ error: 'Bad url' }); }
    if (target.protocol !== 'https:' || !PROXY_HOSTS.has(target.hostname)) {
      return res.status(403).json({ error: `Proxy only forwards to ${[...PROXY_HOSTS].join(', ')}` });
    }
    const headers = {};
    for (const h of FORWARD_HEADERS) if (req.get(h)) headers[h] = req.get(h);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) || !req.body?.length ? undefined : req.body,
        signal: AbortSignal.timeout(25000),
      });
      res.status(upstream.status);
      res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      res.status(502).json({ error: `Upstream request failed: ${err.message}` });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  createApp().listen(PORT, HOST, () => {
    console.log(`PackTrack helper running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Email sync: ${imapConfigured() ? 'configured' : 'not configured (set IMAP_* in .env)'}`);
    console.log(`Accepting requests from: ${[...allowedOrigins()].join(', ')}`);
  });
}
