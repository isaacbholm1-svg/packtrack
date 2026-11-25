import { db } from './lib/db.js';
import { carrierList, carrierName, detectCarrier, normalizeNumber } from './lib/carriers.js';
import { STORES, storeValue, storeName, storeLogoUrl } from './lib/stores.js';
import { gmailState, startSignIn, finishSignIn, syncGmail, disconnectGmail } from './lib/gmail.js';
import { extractShipments } from './lib/extract.js';
import { bookmarkletSource, parsePasted } from './lib/bookmarklet.js';
import { getSettings, updateSettings } from './lib/settings.js';
import { getProvider } from './lib/providers/index.js';
import {
  view, addMany, editShipment, refreshShipment, refreshAll, startPoller, syncEmailViaHelper,
} from './lib/tracker.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CARRIERS = carrierList();

const state = {
  shipments: [],
  filter: (() => { try { return localStorage.getItem('pt.filter') || 'active'; } catch { return 'active'; } })(),
  store: '',
  q: '',
  openId: null,
};

const PROGRESS = {
  awaiting_tracking: 3, pending: 5, not_found: 8, info_received: 15, in_transit: 50, failed_attempt: 75,
  exception: 60, out_for_delivery: 85, available_for_pickup: 92, delivered: 100, expired: 100, unknown: 10,
};

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, withTime
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
        ${s.storeName ? `<span class="store-tag">${logoImg(s.storeLogo)}${esc(s.storeName)}</span>` : ''}
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

function logoImg(url, cls = 'store-logo') {
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">` : '';
}

// Free-text store field: shows the store's logo as soon as it's recognised.
function storeInputHtml(value) {
  const logo = storeLogoUrl(value);
  return `<span class="store-input">
    <img class="store-logo" alt="" referrerpolicy="no-referrer" ${logo ? `src="${esc(logo)}"` : 'hidden'} onerror="this.hidden=true">
    <input name="store" list="storeList" value="${esc(storeName(value) || '')}" placeholder="Type a store…" autocomplete="off" autocapitalize="words">
  </span>`;
}

function wireStoreInput(root) {
  const input = root.querySelector('input[name=store]');
  const img = root.querySelector('.store-input .store-logo');
  input.addEventListener('input', () => {
    const url = storeLogoUrl(storeValue(input.value));
    if (!url) { img.hidden = true; img.removeAttribute('src'); return; }
    if (img.getAttribute('src') !== url) img.src = url;
    img.hidden = false;
  });
}

// Store suggestions and the store filter include stores you typed yourself.
function knownStores() {
  const out = new Map(STORES.map((st) => [st.id, st.name]));
  for (const sh of db.listShipments()) if (sh.store && !out.has(sh.store)) out.set(sh.store, sh.store);
  return out;
}

function renderStoreLists() {
  const all = knownStores();
  $('#storeList').innerHTML = [...all.values()].map((n) => `<option value="${esc(n)}">`).join('');
  const used = [...new Set(state.shipments.map((s) => s.store).filter(Boolean))]
    .map((id) => ({ id, name: all.get(id) || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const html = optionList(used, state.store, 'All stores');
  if ($('#storeFilter').innerHTML !== html) $('#storeFilter').innerHTML = html;
  $('#storeFilter').hidden = used.length < 2;
}

function renderDrawer() {
  const s = state.shipments.find((x) => x.id === state.openId);
  if (!s) { closeDrawer(); return; }
  if ($('#drawerBody').contains(document.activeElement) && document.activeElement.matches('input, select')) return; // don't wipe edits in progress
  const title = s.label || s.trackingNumber || `Order ${s.orderNumber}`;
  $('#drawerBody').innerHTML = `
    <h2>${esc(title)}</h2>
    <span class="pill ${esc(s.status)}">${esc(s.statusLabel)}</span>
    ${s.statusText && s.statusText !== s.events?.[0]?.description ? `<p class="muted">${esc(s.statusText)}</p>` : ''}
    ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
    <dl class="kv">
      ${s.trackingNumber ? `<dt>Tracking</dt><dd class="mono">${esc(s.trackingNumber)}</dd>` : ''}
      ${s.carrierName ? `<dt>Carrier</dt><dd>${esc(s.carrierName)}</dd>` : ''}
      ${s.storeName ? `<dt>Store</dt><dd class="store-dd">${logoImg(s.storeLogo)}${esc(s.storeName)}</dd>` : ''}
      ${s.orderNumber ? `<dt>Order</dt><dd>${esc(s.orderNumber)}</dd>` : ''}
      ${s.eta ? `<dt>Estimated</dt><dd>${esc(fmtDate(s.eta, false))}</dd>` : ''}
      <dt>Added</dt><dd>${esc(fmtDate(s.createdAt))} · ${esc(s.source)}</dd>
      ${s.lastCheckedAt ? `<dt>Checked</dt><dd>${esc(relTime(s.lastCheckedAt))}</dd>` : ''}
    </dl>
    <div class="row">
      ${s.trackingUrl ? `<a class="btn" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Open on carrier site ↗</a>` : ''}
      ${s.universalUrl ? `<a class="btn ghost" href="${esc(s.universalUrl)}" target="_blank" rel="noopener">17TRACK ↗</a>` : ''}
      ${/^https?:\/\//i.test(s.sourceUrl || '') ? `<a class="btn ghost" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">Order page ↗</a>` : ''}
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
        <label>Carrier <select name="carrier">${optionList(CARRIERS, s.carrier, '—')}</select></label>
        <label>Store ${storeInputHtml(s.store)}</label>
        <label>Order number <input name="orderNumber" value="${esc(s.orderNumber || '')}"></label>
      </div>
      <div class="row">
        <button class="btn primary">Save</button>
        <span class="spacer"></span>
        <button type="button" class="btn" id="archiveBtn">${s.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="btn danger" id="deleteBtn">Delete</button>
      </div>
    </form>`;

  $('#editForm').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(f)) if (f[k] === '') f[k] = null;
    f.store = storeValue(f.store);
    const before = s.trackingNumber;
    const updated = editShipment(s.id, f);
    toast('Saved');
    if (updated.trackingNumber && updated.trackingNumber !== before) refreshShipment(s.id);
  };
  wireStoreInput($('#editForm'));
  $('#archiveBtn').onclick = () => editShipment(s.id, { archived: !s.archived });
  $('#deleteBtn').onclick = () => {
    if (!confirm('Delete this package?')) return;
    db.deleteShipment(s.id);
    closeDrawer();
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
  const p = getProvider();
  chip.textContent = p ? `Live: ${p.name}` : 'No live tracking – add API key';
  chip.className = `chip ${p ? 'on' : 'off'}`;
}

// ---------- data ----------

let previous = new Map();
function load() {
  const shipments = db.listShipments().map(view);
  notifyChanges(shipments);
  state.shipments = shipments;
  renderProvider();
  renderStoreLists();
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

// Add items, then fetch status for the new ones.
function addAndTrack(items, source) {
  const results = addMany(items, source);
  for (const r of results) if (r.created && r.shipment.trackingNumber) refreshShipment(r.shipment.id);
  return results;
}

// ---------- add ----------

function initAdd() {
  const form = $('#addForm');
  const dlg = $('#addDialog');
  form.carrier.innerHTML = optionList(CARRIERS, '', 'Detect automatically');
  wireStoreInput(form);

  form.numbers.oninput = () => {
    const lines = form.numbers.value.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
    $('#detectPreview').innerHTML = lines.map((line) => {
      const n = normalizeNumber(line);
      const d = detectCarrier(n);
      return d
        ? `<div><span class="mono">${esc(n)}</span> → ${esc(carrierName(d.carrier))}${d.strength === 'weak' ? ' (guess)' : ''}</div>`
        : `<div class="bad"><span class="mono">${esc(n)}</span> → unknown format, will still be tracked</div>`;
    }).join('');
  };

  dlg.addEventListener('close', () => {
    const action = dlg.returnValue;
    dlg.returnValue = ''; // Esc keeps the previous value otherwise
    if (action !== 'add') return;
    const f = Object.fromEntries(new FormData(form));
    const numbers = f.numbers.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);
    try {
      const out = addAndTrack(numbers.map((trackingNumber) => ({
        trackingNumber, label: f.label || null, carrier: f.carrier || null, store: storeValue(f.store), orderNumber: f.orderNumber || null,
      })), 'manual');
      const created = out.filter((r) => r.created).length;
      toast(`${created} added${out.length - created ? `, ${out.length - created} already tracked` : ''}`);
      form.reset();
      form.querySelector('.store-logo').hidden = true;
      $('#detectPreview').innerHTML = '';
      state.filter = 'active';
      render();
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
  const url = getSettings().helperUrl;
  $('#emailStatus').innerHTML = url
    ? `Helper: <code>${esc(url)}</code>`
    : 'No helper set up. Add its address in Settings.';
  $('#emailSyncBtn').disabled = !url;

  const g = gmailState();
  $('#gmailStatus').innerHTML = !g.configured
    ? 'Not set up yet. Follow the one-time setup below.'
    : !g.connected ? 'Ready. Tap <b>Connect Gmail</b> to sign in.'
      : `Connected${g.lastSyncAt ? ` · last checked ${esc(relTime(g.lastSyncAt))}` : ''}${g.lastError ? `<div class="err">${esc(g.lastError)}</div>` : ''}`;
  $('#gmailSyncBtn').textContent = !g.connected ? 'Connect Gmail' : 'Check Gmail now';
  $('#gmailSyncBtn').disabled = !g.configured;
  $('#gmailDisconnect').hidden = !g.connected;
  $('#gmailSetup').open = !g.configured;
  $('#gmailOrigin').textContent = location.origin;
  $('#gmailRedirect').textContent = redirectUrl();
}

// The address Google sends you back to; must match the one in your Google client.
function redirectUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function runGmailSync({ quiet = false } = {}) {
  try {
    const r = await syncGmail();
    const out = addAndTrack(r.items, 'email');
    const added = out.filter((x) => x.created).length;
    const msg = `Checked ${r.scanned} new email(s): ${added} package(s) added${out.length - added ? `, ${out.length - added} updated` : ''}.`;
    if (!quiet || added) toast(msg, 4000);
    if (!quiet) $('#impResult').innerHTML = `<div class="card-lite">${esc(msg)}</div>`;
  } catch (err) {
    if (err.needsSignIn) {
      if (!quiet) startSignIn(redirectUrl());
      return;
    }
    db.setSettings({ gmailLastError: err.message });
    if (!quiet) toast(err.message, 5000);
  } finally {
    if (!$('#importDialog [data-ipane=email]').hidden) renderEmailStatus();
  }
}

// Checks Gmail in the background while the app is open and the sign-in is still valid (1 hour).
function startGmailAutoSync() {
  const tick = () => {
    const g = gmailState();
    if (g.tokenValid && (!g.lastSyncAt || Date.now() - new Date(g.lastSyncAt).getTime() > 15 * 60e3)) runGmailSync({ quiet: true });
  };
  setTimeout(tick, 1500);
  setInterval(tick, 5 * 60e3);
}

// Coming back from Google's sign-in page.
function handleGmailReturn() {
  const res = finishSignIn(location.hash);
  if (!res) return;
  history.replaceState(null, '', location.pathname + location.search);
  showImportTab('email');
  $('#importDialog').showModal();
  if (res === 'ok') runGmailSync();
  else toast(`Gmail: ${res.slice(6)}`, 5000);
}

function parseAndPreview(payload) {
  const out = $('#impResult');
  let r;
  try { r = extractShipments(payload); } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }

  const header = `<div class="card-lite">
      Store: ${r.store ? logoImg(storeLogoUrl(r.store.id)) : ''}<b>${esc(r.store?.name || 'not recognised')}</b>
      ${r.orderNumber ? ` · Order <b>${esc(r.orderNumber)}</b>` : ''}
    </div>
    <label>Name for these packages <input id="impLabel" value="${esc(r.label || '')}"></label>`;

  if (!r.candidates.length) {
    out.innerHTML = header + `<p class="muted">No tracking numbers found.${r.orderNumber ? ' You can add the order now and fill in the tracking number when the shipping email arrives.' : ''}</p>
      ${r.orderNumber ? '<div class="row end"><button class="btn primary" id="impAddOrder">Add order as “awaiting tracking”</button></div>' : ''}`;
    const b = $('#impAddOrder');
    if (b) b.onclick = () => commit([{ store: r.store?.id, orderNumber: r.orderNumber, label: $('#impLabel').value || null, sourceUrl: payload.url || null }]);
    return;
  }

  out.innerHTML = header + r.candidates.map((c, i) => {
    const exists = Boolean(db.findByTracking(c.trackingNumber));
    return `<div class="cand">
      <input type="checkbox" data-i="${i}" ${c.confidence === 'high' && !exists ? 'checked' : ''} aria-label="Import ${esc(c.trackingNumber)}">
      <div class="grow">
        <div class="mono">${esc(c.trackingNumber)} ${exists ? '<span class="badge">already tracked</span>' : ''}</div>
        <div class="muted small"><span class="badge ${esc(c.confidence)}">${esc(c.confidence)}</span> ${esc(c.reason)}</div>
      </div>
      <select data-carrier="${i}" aria-label="Carrier">${optionList(CARRIERS, c.carrier)}</select>
    </div>`;
  }).join('') + '<div class="row end"><button class="btn primary" id="impCommit">Add selected</button></div>';

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

function commit(items, source = 'paste') {
  try {
    const out = addAndTrack(items, source);
    toast(`${out.filter((r) => r.created).length} added`);
    $('#importDialog').close();
    $('#impText').value = '';
    $('#impResult').innerHTML = '';
  } catch (err) { toast(err.message); }
}

function appUrl() {
  return location.href.replace(/#.*$/, '').replace(/index\.html$/, '');
}

function bookmarkletCode() {
  return 'javascript:' + encodeURIComponent(bookmarkletSource(appUrl()));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const x = document.createElement('textarea');
    x.value = text;
    document.body.appendChild(x);
    x.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    x.remove();
    return ok;
  }
}

function initImport() {
  const dlg = $('#importDialog');
  for (const t of $$('#importDialog [data-itab]')) t.onclick = () => showImportTab(t.dataset.itab);
  $('#impParse').onclick = () => {
    const text = $('#impText').value.trim();
    if (!text) { toast('Paste an email or page first'); return; }
    const page = parsePasted(text);
    if (page) { parseAndPreview(page); return; }
    const isHtml = /<\/?(html|body|div|table|a)\b/i.test(text); // pasted HTML source works too
    parseAndPreview({ text: isHtml ? '' : text, html: isHtml ? text : '', from: $('#impFrom').value, subject: $('#impSubject').value });
  };
  $('#bookmarklet').href = bookmarkletCode();
  $('#bookmarklet').onclick = (e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar'); };
  $('#copyBookmarklet').onclick = async () => {
    toast(await copyText(bookmarkletCode()) ? 'Bookmark code copied' : 'Could not copy – long-press the computer button below and copy its link instead', 4000);
  };
  $('#impPasteClip').onclick = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* not allowed */ }
    if (!text.trim()) { toast('Nothing to paste. Long-press the box and choose Paste instead.', 4000); $('#impText').focus(); return; }
    $('#impText').value = text;
    $('#impParse').click();
  };
  $('#emailSyncBtn').onclick = async () => {
    const b = $('#emailSyncBtn');
    b.disabled = true;
    b.textContent = 'Checking…';
    try {
      const r = await syncEmailViaHelper();
      $('#impResult').innerHTML = `<div class="card-lite">Scanned ${r.scanned} new message(s): ${r.added} package(s) added, ${r.updated} updated.</div>`;
    } catch (err) {
      $('#impResult').innerHTML = `<p class="err">${esc(err.message)}</p>`;
    } finally {
      b.disabled = false;
      b.textContent = 'Check mailbox now';
    }
  };
  $('#gmailSyncBtn').onclick = () => {
    const g = gmailState();
    if (!g.configured) { toast('Add your Google client ID in Settings first'); return; }
    if (!g.tokenValid) { startSignIn(redirectUrl()); return; }
    $('#gmailSyncBtn').disabled = true;
    $('#gmailSyncBtn').textContent = 'Checking…';
    runGmailSync();
  };
  $('#gmailDisconnect').onclick = () => {
    if (!confirm('Disconnect Gmail from PackTrack on this device?')) return;
    disconnectGmail();
    renderEmailStatus();
  };
  for (const b of $$('[data-copy]')) {
    b.onclick = async () => toast(await copyText($(b.dataset.copy).textContent) ? 'Copied' : 'Could not copy');
  }
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
}

// Data handed over by the bookmarklet arrives in the URL fragment.
function handleIncomingImport() {
  const m = /^#import=(.*)$/s.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let payload;
  try { payload = JSON.parse(decodeURIComponent(m[1])); } catch { toast('Could not read the page data'); return; }
  showImportTab('paste');
  $('#importDialog').showModal();
  $('#impText').value = '';
  parseAndPreview({ text: String(payload.text || ''), url: String(payload.url || ''), title: String(payload.title || '') });
}

// ---------- settings ----------

function openSettings() {
  const s = getSettings();
  const form = $('#settingsForm');
  for (const el of form.elements) if (el.name && el.name in s) el.value = s[el.name];
  updateNotifyBtn();
  $('#storageNote').textContent = db.persistent
    ? 'Your packages and settings are saved in this browser on this device. Use Export to back them up or move them to another device.'
    : 'This browser is not allowing storage (private mode?), so nothing will be kept after you close the page.';
  $('#settingsDialog').showModal();
}

function updateNotifyBtn() {
  const b = $('#notifyBtn');
  if (!('Notification' in window)) { b.disabled = true; b.textContent = 'Notifications not supported'; return; }
  b.textContent = Notification.permission === 'granted' ? 'Notifications enabled ✓' : 'Enable browser notifications';
  b.disabled = Notification.permission !== 'default';
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(db.exportData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `packtrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function initSettings() {
  const dlg = $('#settingsDialog');
  dlg.addEventListener('close', () => {
    const action = dlg.returnValue;
    dlg.returnValue = '';
    if (action !== 'save') return;
    updateSettings(Object.fromEntries(new FormData($('#settingsForm'))));
    toast('Settings saved');
    renderProvider();
    refreshAll({ onlyStale: true });
  });
  $('#notifyBtn').onclick = async () => { await Notification.requestPermission(); updateNotifyBtn(); };
  $('#exportBtn').onclick = exportBackup;
  $('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const n = db.importData(JSON.parse(await file.text()));
      toast(`${n} package(s) restored`);
    } catch (err) { toast(err.message); }
    e.target.value = '';
  };
}

// ---------- wiring ----------

function main() {
  initAdd();
  initImport();
  initSettings();
  load();
  db.onChange(load);

  for (const t of $$('.toolbar .tab')) {
    t.onclick = () => {
      state.filter = t.dataset.filter;
      try { localStorage.setItem('pt.filter', state.filter); } catch { /* ignore */ }
      render();
    };
  }
  $('#search').oninput = (e) => { state.q = e.target.value; render(); };
  $('#storeFilter').onchange = (e) => { state.store = e.target.value; render(); };
  $('#list').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDrawer(c.dataset.id); };
  $('#drawerClose').onclick = closeDrawer;
  $('#drawerRefresh').onclick = async () => { if (state.openId) { toast('Refreshing…', 1500); await refreshShipment(state.openId); } };
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
  $('#refreshAllBtn').onclick = () => {
    if (!getProvider()) { openSettings(); return; }
    toast('Refreshing all active packages…');
    refreshAll();
  };

  handleGmailReturn();
  handleIncomingImport();
  window.addEventListener('hashchange', handleIncomingImport);
  startGmailAutoSync();
  setInterval(render, 60e3); // keep "x min ago" fresh
  startPoller();
}

try {
  main();
} catch (err) {
  document.body.insertAdjacentHTML('beforeend', `<p class="err center">Failed to start: ${esc(err.message)}</p>`);
}
