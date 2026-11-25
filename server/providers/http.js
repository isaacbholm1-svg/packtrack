export async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.message || json?.meta?.message || json?.errors?.[0]?.message || text.slice(0, 200) || res.statusText;
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
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
