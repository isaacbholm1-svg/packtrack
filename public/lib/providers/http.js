import { getSettings } from '../settings.js';

// Calls a tracking API. With a proxy configured the request goes through it
// (needed when the API doesn't allow calls straight from a browser).
export async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const proxy = getSettings().proxyUrl;
  const target = proxy ? proxyTarget(proxy, url) : url;
  let res;
  try {
    res = await fetch(target, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('Request timed out');
    throw new Error(proxy
      ? `Could not reach the proxy (${err.message})`
      : 'The browser blocked the request (the API does not allow direct browser calls). Set up a proxy in Settings.');
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.message || json?.meta?.message || json?.errors?.[0]?.message || json?.error || text.slice(0, 200) || res.statusText;
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// "https://proxy/?url=" → append the encoded URL; "https://proxy" → add ?url=…
export function proxyTarget(proxy, url) {
  if (/[?&]url=$/.test(proxy)) return proxy + encodeURIComponent(url);
  return `${proxy.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`;
}

export function iso(t) {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function sortEvents(events) {
  return events
    .filter((e) => e.description || e.status)
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}
