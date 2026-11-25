// PackTrack CORS proxy for Cloudflare Workers (free plan is plenty).
//
// Lets the PackTrack web app on GitHub Pages call tracking APIs that don't accept requests
// straight from a browser. It forwards only to the three tracking APIs below, and stores
// nothing: your API key travels with each request from your browser.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker →
// Edit code → paste this file → Deploy. Then in PackTrack Settings set
// Proxy URL to https://<your-worker>.<you>.workers.dev
//
// Optional: set the variable ALLOWED_ORIGIN (e.g. https://yourname.github.io) so only
// your PackTrack page can use the proxy.

const HOSTS = new Set(['api.17track.net', 'api.ship24.com', 'api.aftership.com']);
const FORWARD = ['content-type', 'accept', 'authorization', '17token', 'as-api-key', 'aftership-api-key'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()) : null;
    if (allowed && origin && !allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });

    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || FORWARD.join(', '),
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url') || ''); } catch {
      return new Response('Missing or bad ?url=', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)) {
      return new Response('Only tracking APIs are allowed', { status: 403, headers: cors });
    }
    const headers = {};
    for (const h of FORWARD) if (request.headers.get(h)) headers[h] = request.headers.get(h);
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    });
    const out = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
