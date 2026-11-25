const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  meta: null,
  shipments: [],
  filter: localStorage.getItem('pt.filter') || 'active',
  store: '',
  q: '',
  openId: null,
};

const PROGRESS = {
  awaiting_tracking: 3, pending: 5, not_found: 8, info_received: 15, in_transit: 50, failed_attempt: 75,
  exception: 60, out_for_delivery: 85, available_for_pickup: 92, delivered: 100, expired: 100, unknown: 10,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
}

function relTime(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const isDelivered = (s) => s.status === 'delivered';
function matchesFilter(s) {
  if (state.filter === 'archived') return s.archived;
  if (state.filter === 'all') return true;
  if (s.archived) return false;
  return state.filter === 'delivered' ? isDelivered(s) : !isDelivered(s) && s.status !== 'expired';
}

// ---------- rendering ----------

function render() {
  const q = state.q.toLowerCase();
  const visible = state.shipments.filter((s) => matchesFilter(s)
    && (!state.store || s.store === state.store)
    && (!q || [s.label, s.trackingNumber, s.orderNumber, s.storeName, s.carrierName, s.statusText].some((v) => v && v.toLowerCase().includes(q))));

  const counts = { active: 0, delivered: 0, archived: 0, all: state.shipments.length };
  for (const s of state.shipments) {
    if (s.archived) counts.archived++;
    else if (isDelivered(s)) counts.delivered++;
    else if (s.status !== 'expired') counts.active++;
  }
  for (const el of $$('[data-count]')) el.textContent = counts[el.dataset.count] || '';
  for (const t of $$('.toolbar .tab')) t.classList.toggle('active', t.dataset.filter === state.filter);

  $('#list').innerHTML = visible.map(cardHtml).join('');
  $('#empty').hidden = state.shipments.length > 0;
  if (state.shipments.length && !visible.length) {
    $('#list').innerHTML = '<p class="muted center">Nothing matches this filter.</p>';
  }
  if (state.openId) renderDrawer();
}

function cardHtml(s) {
  const title = s.label || s.trackingNumber || `Order ${s.orderNumber}`;
  const pct = PROGRESS[s.status] ?? 10;
  const cls = s.status === 'delivered' ? 'done' : ['exception', 'failed_attempt', 'expired'].includes(s.status) ? 'bad' : '';
  const last = s.events?.[0];
  const lastLine = s.error ? `<span class="err">${esc(s.error)}</span>`
    : last ? `${esc(last.description)}${last.location ? ' · ' + esc(last.location) : ''} · ${esc(relTime(last.time))}`
      : s.status === 'awaiting_tracking' ? 'Waiting for the store to send a tracking number'
        : s.lastCheckedAt ? 'No events yet' : 'Not checked yet';
  return `<button class="card" data-id="${esc(s.id)}">
    <div>
      <div class="title">${esc(title)}</div>
      <div class="meta">
        ${s.storeName ? `<span class="store-tag">${esc(s.storeName)}</span>` : ''}
        ${s.carrierName ? `<span>${esc(s.carrierName)}</span>` : ''}
        ${s.trackingNumber && s.label ? `<span class="mono">${esc(s.trackingNumber)}</span>` : ''}
        ${s.orderNumber ? `<span>Order ${esc(s.orderNumber)}</span>` : ''}
      </div>
    </div>
    <div class="right">
      <span class="pill ${esc(s.status)}">${esc(s.statusLabel)}</span>
      ${s.eta && s.status !== 'delivered' ? `<span class="eta">ETA ${esc(fmtDate(s.eta, false))}</span>` : ''}
    </div>
    <div class="last">${lastLine}</div>
    <div class="progress ${cls}"><div style="width:${pct}%"></div></div>
  </button>`;
}

function optionList(items, selected, empty) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '')
    + items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function renderDrawer() {
  const s = state.shipments.find((x) => x.id === state.openId);
  if (!s) { closeDrawer(); return; }
  const title = s.label || s.trackingNumber || `Order ${s.orderNumber}`;
  $('#drawerBody').innerHTML = `
    <h2>${esc(title)}</h2>
    <span class="pill ${esc(s.status)}">${esc(s.statusLabel)}</span>
    ${s.statusText && s.statusText !== s.events?.[0]?.description ? `<p class="muted">${esc(s.statusText)}</p>` : ''}
    ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
    <dl class="kv">
      ${s.trackingNumber ? `<dt>Tracking</dt><dd class="mono">${esc(s.trackingNumber)}</dd>` : ''}
      ${s.carrierName ? `<dt>Carrier</dt><dd>${esc(s.carrierName)}</dd>` : ''}
      ${s.storeName ? `<dt>Store</dt><dd>${esc(s.storeName)}</dd>` : ''}
      ${s.orderNumber ? `<dt>Order</dt><dd>${esc(s.orderNumber)}</dd>` : ''}
      ${s.eta ? `<dt>Estimated</dt><dd>${esc(fmtDate(s.eta, false))}</dd>` : ''}
      <dt>Added</dt><dd>${esc(fmtDate(s.createdAt))} · ${esc(s.source)}</dd>
      ${s.lastCheckedAt ? `<dt>Checked</dt><dd>${esc(relTime(s.lastCheckedAt))}</dd>` : ''}
    </dl>
    <div class="row">
      ${s.trackingUrl ? `<a class="btn" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Open on carrier site ↗</a>` : ''}
      ${s.universalUrl ? `<a class="btn ghost" href="${esc(s.universalUrl)}" target="_blank" rel="noopener">17TRACK ↗</a>` : ''}
      ${s.sourceUrl ? `<a class="btn ghost" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">Order page ↗</a>` : ''}
    </div>

    <h3>History</h3>
    ${s.events?.length ? `<ol class="timeline">${s.events.map((e) => `<li>
        <div>${esc(e.description)}</div>
        <div class="when">${esc(fmtDate(e.time))}${e.location ? ' · ' + esc(e.location) : ''}</div>
      </li>`).join('')}</ol>` : '<p class="muted">No tracking events yet.</p>'}

    <h3>Edit</h3>
    <form id="editForm">
      <div class="edit-grid">
        <label>Name <input name="label" value="${esc(s.label || '')}"></label>
        <label>Tracking number <input name="trackingNumber" value="${esc(s.trackingNumber || '')}"></label>
        <label>Carrier <select name="carrier">${optionList(state.meta.carriers, s.carrier, '—')}</select></label>
        <label>Store <select name="store">${optionList(state.meta.stores, s.store, '—')}</select></label>
        <label>Order number <input name="orderNumber" value="${esc(s.orderNumber || '')}"></label>
      </div>
      <div class="row">
        <button class="btn primary">Save</button>
        <span class="spacer"></span>
        <button type="button" class="btn" id="archiveBtn">${s.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="btn danger" id="deleteBtn">Delete</button>
      </div>
    </form>`;

  $('#editForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(f)) if (f[k] === '') f[k] = null;
    await api(`/api/shipments/${s.id}`, { method: 'PATCH', body: f });
    toast('Saved');
    await load();
    if (f.trackingNumber && f.trackingNumber !== s.trackingNumber) refreshOne(s.id);
  };
  $('#archiveBtn').onclick = async () => {
    await api(`/api/shipments/${s.id}`, { method: 'PATCH', body: { archived: !s.archived } });
    await load();
  };
  $('#deleteBtn').onclick = async () => {
    if (!confirm('Delete this package?')) return;
    await api(`/api/shipments/${s.id}`, { method: 'DELETE' });
    closeDrawer();
    await load();
  };
}

function openDrawer(id) {
  state.openId = id;
  $('#drawer').hidden = false;
  renderDrawer();
}
function closeDrawer() {
  state.openId = null;
  $('#drawer').hidden = true;
}

function renderProvider() {
  const chip = $('#providerChip');
  const p = state.meta.provider;
  chip.textContent = p ? `Live: ${p.name}` : 'No live tracking – add API key';
  chip.className = `chip ${p ? 'on' : 'off'}`;
}

// ---------- data ----------

let previous = new Map();
async function load() {
  const [meta, shipments] = await Promise.all([api('/api/meta'), api('/api/shipments')]);
  state.meta = meta;
  notifyChanges(shipments);
  state.shipments = shipments;
  renderProvider();
  render();
}

function notifyChanges(shipments) {
  const next = new Map(shipments.map((s) => [s.id, s.status]));
  if (previous.size && 'Notification' in window && Notification.permission === 'granted') {
    for (const s of shipments) {
      const before = previous.get(s.id);
      if (before && before !== s.status && !['pending', 'not_found'].includes(s.status)) {
        new Notification(`${s.label || s.trackingNumber}: ${s.statusLabel}`, { body: s.events?.[0]?.description || '', tag: s.id });
      }
    }
  }
  previous = next;
}

async function refreshOne(id) {
  await api(`/api/shipments/${id}/refresh`, { method: 'POST' });
  await load();
}

// ---------- add ----------

function initAdd() {
  const form = $('#addForm');
  const dlg = $('#addDialog');
  form.carrier.innerHTML = optionList(state.meta.carriers, '', 'Detect automatically');
  form.store.innerHTML = optionList(state.meta.stores, '', '—');

  let timer;
  form.numbers.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const lines = form.numbers.value.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
      const res = await Promise.all(lines.map((n) => api(`/api/detect?n=${encodeURIComponent(n)}`)));
      $('#detectPreview').innerHTML = res.map((r) => r.carrier
        ? `<div><span class="mono">${esc(r.trackingNumber)}</span> → ${esc(r.carrierName)}${r.strength === 'weak' ? ' (guess)' : ''}</div>`
        : `<div class="bad"><span class="mono">${esc(r.trackingNumber)}</span> → unknown format, will still be tracked</div>`).join('');
    }, 250);
  };

  dlg.addEventListener('close', async () => {
    const action = dlg.returnValue;
    dlg.returnValue = ''; // Esc keeps the previous value otherwise
    if (action !== 'add') return;
    const f = Object.fromEntries(new FormData(form));
    const numbers = f.numbers.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);
    try {
      const out = await api('/api/shipments', { method: 'POST', body: { numbers, label: f.label || null, carrier: f.carrier || null, store: f.store || null, orderNumber: f.orderNumber || null } });
      const created = out.filter((s) => s.created).length;
      toast(`${created} added${out.length - created ? `, ${out.length - created} already tracked` : ''}`);
      form.reset();
      $('#detectPreview').innerHTML = '';
      state.filter = 'active';
      await load();
      setTimeout(load, 4000); // first status arrives in the background
    } catch (err) { toast(err.message); }
  });
}

// ---------- import ----------

function showImportTab(name) {
  for (const t of $$('#importDialog [data-itab]')) t.classList.toggle('active', t.dataset.itab === name);
  for (const p of $$('#importDialog [data-ipane]')) p.hidden = p.dataset.ipane !== name;
  $('#impResult').innerHTML = '';
  if (name === 'email') renderEmailStatus();
}

function renderEmailStatus() {
  const e = state.meta.email;
  $('#emailStatus').innerHTML = !e.configured ? 'Not configured yet.'
    : `Connected${e.mailbox ? ` · folder ${esc(e.mailbox)}` : ''}${e.lastSyncAt ? ` · last checked ${esc(relTime(e.lastSyncAt))}` : ' · not checked yet'}
       ${e.lastError ? `<div class="err">${esc(e.lastError)}</div>` : ''}`;
  $('#emailSyncBtn').disabled = !e.configured;
}

async function parseAndPreview(payload) {
  const out = $('#impResult');
  out.innerHTML = '<p class="muted">Looking for packages…</p>';
  let r;
  try { r = await api('/api/import/parse', { method: 'POST', body: payload }); } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }

  const header = `<div class="card-lite">
      Store: <b>${esc(r.store?.name || 'not recognised')}</b>
      ${r.orderNumber ? ` · Order <b>${esc(r.orderNumber)}</b>` : ''}
    </div>
    <label>Name for these packages <input id="impLabel" value="${esc(r.label || '')}"></label>`;

  if (!r.candidates.length) {
    out.innerHTML = header + `<p class="muted">No tracking numbers found.${r.orderNumber ? ' You can add the order now and the tracking number will be filled in when a shipping email arrives (with email sync) or when you add it.' : ''}</p>
      ${r.orderNumber ? '<div class="row end"><button class="btn primary" id="impAddOrder">Add order as “awaiting tracking”</button></div>' : ''}`;
    const b = $('#impAddOrder');
    if (b) b.onclick = () => commit([{ store: r.store?.id, orderNumber: r.orderNumber, label: $('#impLabel').value || null, sourceUrl: payload.url || null }]);
    return;
  }

  out.innerHTML = header + r.candidates.map((c, i) => `<div class="cand">
      <input type="checkbox" data-i="${i}" ${c.confidence === 'high' && !c.exists ? 'checked' : ''} aria-label="Import ${esc(c.trackingNumber)}">
      <div class="grow">
        <div class="mono">${esc(c.trackingNumber)} ${c.exists ? '<span class="badge">already tracked</span>' : ''}</div>
        <div class="muted small"><span class="badge ${esc(c.confidence)}">${esc(c.confidence)}</span> ${esc(c.reason)}</div>
      </div>
      <select data-carrier="${i}" aria-label="Carrier">${optionList(state.meta.carriers, c.carrier)}</select>
    </div>`).join('') + '<div class="row end"><button class="btn primary" id="impCommit">Add selected</button></div>';

  $('#impCommit').onclick = () => {
    const items = $$('#impResult input[type=checkbox]:checked').map((cb) => {
      const c = r.candidates[cb.dataset.i];
      return {
        trackingNumber: c.trackingNumber,
        carrier: $(`[data-carrier="${cb.dataset.i}"]`).value,
        store: r.store?.id || null,
        orderNumber: r.orderNumber,
        label: $('#impLabel').value || null,
        sourceUrl: payload.url || null,
      };
    });
    if (!items.length) { toast('Select at least one'); return; }
    commit(items, payload.url ? 'browser' : 'paste');
  };
}

async function commit(items, source = 'paste') {
  try {
    const out = await api('/api/shipments', { method: 'POST', body: { items, source } });
    toast(`${out.filter((s) => s.created).length} added`);
    $('#importDialog').close();
    $('#impText').value = '';
    $('#impResult').innerHTML = '';
    await load();
    setTimeout(load, 4000);
  } catch (err) { toast(err.message); }
}

function bookmarkletCode() {
  const origin = location.origin;
  // Collects page text + tracking-looking links and opens PackTrack with them in the URL fragment
  // (fragments never leave the browser, and window.open isn't blocked by the shop's CSP).
  const src = `(()=>{const L=[...document.links].map(a=>a.href).filter(h=>/track|seuranta|sendung|parcel|shipment|lahetys|17track|aftership|parcelsapp/i.test(h)).slice(0,150);const p={url:location.href,title:document.title,text:(document.body.innerText||'').slice(0,60000)+'\\n'+L.join('\\n')};window.open(${JSON.stringify(origin)}+'/#import='+encodeURIComponent(JSON.stringify(p)),'_blank');})()`;
  return 'javascript:' + encodeURIComponent(src);
}

function initImport() {
  const dlg = $('#importDialog');
  for (const t of $$('#importDialog [data-itab]')) t.onclick = () => showImportTab(t.dataset.itab);
  $('#impParse').onclick = () => {
    const text = $('#impText').value.trim();
    if (!text) { toast('Paste an email or page first'); return; }
    // Pasted HTML source works too.
    const isHtml = /<\/?(html|body|div|table|a)\b/i.test(text);
    parseAndPreview({ text: isHtml ? '' : text, html: isHtml ? text : '', from: $('#impFrom').value, subject: $('#impSubject').value });
  };
  $('#bookmarklet').href = bookmarkletCode();
  $('#bookmarklet').onclick = (e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar'); };
  $('#emailSyncBtn').onclick = async () => {
    const b = $('#emailSyncBtn');
    b.disabled = true;
    b.textContent = 'Checking…';
    try {
      const r = await api('/api/email/sync', { method: 'POST' });
      $('#impResult').innerHTML = `<div class="card-lite">Scanned ${r.scanned} new message(s): ${r.added} package(s) added, ${r.updated} updated.</div>`;
      await load();
    } catch (err) {
      $('#impResult').innerHTML = `<p class="err">${esc(err.message)}</p>`;
    } finally {
      b.disabled = false;
      b.textContent = 'Check mailbox now';
      renderEmailStatus();
    }
  };
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
}

// Data handed over by the bookmarklet arrives in the URL fragment.
function handleIncomingImport() {
  const m = /^#import=(.*)$/s.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  let payload;
  try { payload = JSON.parse(decodeURIComponent(m[1])); } catch { toast('Could not read the page data'); return; }
  showImportTab('paste');
  $('#importDialog').showModal();
  $('#impText').value = '';
  parseAndPreview({ text: String(payload.text || ''), url: String(payload.url || ''), title: String(payload.title || '') });
}

// ---------- settings ----------

async function openSettings() {
  const s = await api('/api/settings');
  const form = $('#settingsForm');
  for (const el of form.elements) {
    if (!el.name || !(el.name in s)) continue;
    const v = s[el.name];
    if (v && typeof v === 'object') { el.value = ''; el.placeholder = v.set ? '•••••••• (saved)' : 'not set'; } else el.value = v;
  }
  updateNotifyBtn();
  $('#settingsDialog').showModal();
}

function updateNotifyBtn() {
  const b = $('#notifyBtn');
  if (!('Notification' in window)) { b.disabled = true; b.textContent = 'Notifications not supported'; return; }
  b.textContent = Notification.permission === 'granted' ? 'Notifications enabled ✓' : 'Enable browser notifications';
  b.disabled = Notification.permission !== 'default';
}

function initSettings() {
  const dlg = $('#settingsDialog');
  dlg.addEventListener('close', async () => {
    const action = dlg.returnValue;
    dlg.returnValue = '';
    if (action !== 'save') return;
    const body = Object.fromEntries(new FormData($('#settingsForm')));
    try {
      await api('/api/settings', { method: 'PUT', body });
      toast('Settings saved');
      await load();
      api('/api/refresh', { method: 'POST' }).then(() => setTimeout(load, 5000));
    } catch (err) { toast(err.message); }
  });
  $('#notifyBtn').onclick = async () => { await Notification.requestPermission(); updateNotifyBtn(); };
}

// ---------- wiring ----------

async function main() {
  await load();
  $('#storeFilter').innerHTML = optionList(state.meta.stores, '', 'All stores');
  initAdd();
  initImport();
  initSettings();

  for (const t of $$('.toolbar .tab')) t.onclick = () => { state.filter = t.dataset.filter; localStorage.setItem('pt.filter', state.filter); render(); };
  $('#search').oninput = (e) => { state.q = e.target.value; render(); };
  $('#storeFilter').onchange = (e) => { state.store = e.target.value; render(); };
  $('#list').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDrawer(c.dataset.id); };
  $('#drawerClose').onclick = closeDrawer;
  $('#drawerRefresh').onclick = async () => { if (state.openId) { toast('Refreshing…', 1500); await refreshOne(state.openId); } };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden && !document.querySelector('dialog[open]')) closeDrawer(); });

  $('#addBtn').onclick = () => $('#addDialog').showModal();
  $('#importBtn').onclick = () => { showImportTab('paste'); $('#importDialog').showModal(); };
  $('#settingsBtn').onclick = openSettings;
  $('#providerChip').onclick = openSettings;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (!t) return;
    e.preventDefault();
    for (const d of $$('dialog[open]')) d.close();
    if (t.dataset.open === 'settingsDialog') openSettings();
    else { if (t.dataset.open === 'importDialog') showImportTab('paste'); $(`#${t.dataset.open}`).showModal(); }
  });
  $('#refreshAllBtn').onclick = async () => {
    if (!state.meta.provider) { openSettings(); return; }
    await api('/api/refresh', { method: 'POST' });
    toast('Refreshing all active packages…');
    setTimeout(load, 3000);
    setTimeout(load, 10000);
  };

  handleIncomingImport();
  window.addEventListener('hashchange', handleIncomingImport);
  setInterval(load, 60e3);
}

main().catch((err) => { document.body.insertAdjacentHTML('beforeend', `<p class="err center">Failed to start: ${esc(err.message)}</p>`); });
