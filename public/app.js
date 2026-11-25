import { db } from './lib/db.js';
import { carrierList, carrierName, detectCarrier, normalizeNumber } from './lib/carriers.js';
import {
  STORES, CATEGORIES, storeValue, storeName, storeLogoSources, storeInitial, storeColor,
} from './lib/stores.js';
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

function toast(msg, ms = 3000, action = null) {
  const t = $('#toast');
  const b = $('#toastAction');
  $('#toastText').textContent = msg;
  b.hidden = !action;
  if (action) {
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); };
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, action ? Math.max(ms, 6000) : ms);
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
        ${s.storeName ? `<span class="store-tag">${logoHtml(s.store)}${esc(s.storeName)}</span>` : ''}
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

// Every store gets a logo: its site icon (Google, then DuckDuckGo), or else a letter badge.
function letterBadge(cls, letter, color) {
  return `<span class="${cls} logo-letter" style="background:${esc(color)}" aria-hidden="true">${esc(letter)}</span>`;
}

function logoHtml(value, cls = 'store-logo') {
  if (!value) return '';
  const [first, next] = storeLogoSources(value);
  if (!first) return letterBadge(cls, storeInitial(value), storeColor(value));
  return `<img class="${cls}" src="${esc(first)}" data-next="${esc(next)}" data-letter="${esc(storeInitial(value))}" data-color="${esc(storeColor(value))}"
    alt="" loading="lazy" referrerpolicy="no-referrer" onload="ptLogoLoad(this)" onerror="ptLogoFail(this)">`;
}

window.ptLogoFail = (img) => {
  const next = img.dataset.next;
  if (next) { img.dataset.next = ''; img.src = next; return; }
  img.outerHTML = letterBadge(img.className, img.dataset.letter, img.dataset.color);
};

// Google answers unknown sites with a tiny generic globe; treat that as "no logo".
window.ptLogoLoad = (img) => {
  if (img.src.includes('google.com/s2/favicons') && img.naturalWidth > 0 && img.naturalWidth <= 16) window.ptLogoFail(img);
};

// Free-text store field: shows the store's logo as soon as it's recognised.
function storeInputHtml(value) {
  return `<span class="store-input">
    <span class="logo-slot">${logoHtml(value)}</span>
    <input name="store" list="storeList" value="${esc(storeName(value) || '')}" placeholder="Type a store…" autocomplete="off" autocapitalize="words">
    <button type="button" class="btn ghost browse-stores" title="Browse stores" aria-label="Browse stores">☰ Stores</button>
  </span>`;
}

function wireStoreInput(root) {
  const input = root.querySelector('input[name=store]');
  const slot = root.querySelector('.store-input .logo-slot');
  input.addEventListener('input', () => {
    const v = storeValue(input.value);
    const show = v && storeLogoSources(v).length ? v : ''; // only recognised stores and web addresses
    if (slot.dataset.v === show) return;
    slot.dataset.v = show;
    slot.innerHTML = logoHtml(show);
  });
}

// ---------- store picker ----------

let pickerTarget = null;

function renderStoreGrid() {
  const q = $('#storeSearch').value.trim().toLowerCase();
  const hits = STORES.filter((st) => !q || st.name.toLowerCase().includes(q) || st.domains.some((d) => d.includes(q)));
  const groups = Object.entries(CATEGORIES)
    .map(([cat, title]) => [title, hits.filter((st) => st.category === cat).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length);
  $('#storeGrid').innerHTML = groups.length
    ? groups.map(([title, list]) => `<h3>${esc(title)} <span class="count">${list.length}</span></h3>
        <div class="tiles">${list.map((st) => `<button type="button" class="store-tile" data-store="${esc(st.id)}">
          ${logoHtml(st.id, 'tile-logo')}<span>${esc(st.name)}</span></button>`).join('')}</div>`).join('')
    : `<p class="muted">No store called “${esc(q)}” in the list. Just type it in the store box, it works for any shop.</p>`;
}

function openStorePicker(input) {
  pickerTarget = input;
  $('#storeSearch').value = '';
  renderStoreGrid();
  $('#storePicker').showModal();
  $('#storeGrid').scrollTop = 0;
}

function initStorePicker() {
  $('#storeSearch').placeholder = `Search ${STORES.length} stores…`;
  $('#storeSearch').oninput = renderStoreGrid;
  $('#storePickerClose').onclick = () => $('#storePicker').close();
  $('#storeGrid').onclick = (e) => {
    const tile = e.target.closest('.store-tile');
    if (!tile || !pickerTarget) return;
    pickerTarget.value = storeName(tile.dataset.store);
    pickerTarget.dispatchEvent(new Event('input', { bubbles: true }));
    $('#storePicker').close();
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.browse-stores');
    if (b) openStorePicker(b.parentElement.querySelector('input[name=store]'));
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
      ${s.storeName ? `<dt>Store</dt><dd class="store-dd">${logoHtml(s.store)}${esc(s.storeName)}</dd>` : ''}
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
  chip.textContent = p ? `Live: ${p.name}` : 'Live tracking off';
  chip.className = `chip ${p ? 'on' : 'off'}`;
  $('#setupBanner').hidden = Boolean(p) || getSettings().provider === 'none';
}

// ---------- quick add: one box for numbers or whole emails ----------

const looksLikeNumber = (line) => /^[A-Za-z0-9][A-Za-z0-9 .-]{5,40}$/.test(line) && /\d{4,}/.test(line) && normalizeNumber(line).length >= 8;

function finishQuickAdd(results, storeLabel) {
  const created = results.filter((r) => r.created);
  $('#quickText').value = '';
  state.filter = 'active';
  render();
  if (!created.length) { toast('Already tracking that'); return; }
  const msg = `Added ${created.length} package${created.length > 1 ? 's' : ''}${storeLabel ? ` from ${storeLabel}` : ''}`;
  toast(msg, 6000, { label: 'Undo', run: () => { for (const r of created) db.deleteShipment(r.shipment.id); } });
}

function quickAdd(raw) {
  const text = String(raw || '').trim();
  if (!text) { toast('Paste a tracking number or an email first'); $('#quickText').focus(); return; }
  const page = parsePasted(text);
  const lines = text.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
  try {
    if (!page && lines.length <= 50 && lines.every(looksLikeNumber)) {
      finishQuickAdd(addAndTrack(lines.map((trackingNumber) => ({ trackingNumber })), 'manual'));
      return;
    }
    const isHtml = /<\/?(html|body|div|table|a)\b/i.test(text);
    const payload = page || { text: isHtml ? '' : text, html: isHtml ? text : '' };
    const r = extractShipments(payload);
    const sure = r.candidates.filter((c) => c.confidence === 'high');
    if (sure.length) {
      finishQuickAdd(addAndTrack(sure.map((c) => ({
        trackingNumber: c.trackingNumber, carrier: c.carrier, store: r.store?.id || null,
        orderNumber: r.orderNumber, label: r.label, sourceUrl: payload.url || null,
      })), page ? 'browser' : 'paste'), r.store?.name);
      return;
    }
    if (r.candidates.length || r.orderNumber) {
      // Not sure enough to add on its own: let the user pick.
      showImportTab('paste');
      $('#importDialog').showModal();
      $('#impText').value = text;
      parseAndPreview(payload);
      $('#quickText').value = '';
      return;
    }
    toast("Couldn't find a tracking number in that.", 4000);
  } catch (err) { toast(err.message); }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) return text;
  } catch { /* not allowed */ }
  return null;
}

function initQuickAdd() {
  $('#quickAdd').onclick = () => quickAdd($('#quickText').value);
  $('#quickPaste').onclick = async () => {
    const text = await pasteFromClipboard();
    if (!text) { toast('Long-press the box and tap Paste', 4000); $('#quickText').focus(); return; }
    $('#quickText').value = text;
    quickAdd(text);
  };
  $('#quickText').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const v = e.target.value;
    // Ctrl/Cmd+Enter always adds; plain Enter adds when the box holds a single tracking number.
    if (e.metaKey || e.ctrlKey || (!v.includes('\n') && looksLikeNumber(v.trim()))) { e.preventDefault(); quickAdd(v); }
  });
  $('#demoBtn').onclick = () => {
    updateSettings({ provider: 'mock' });
    renderProvider();
    refreshAll();
    toast('Demo is on: the progress is made up. Turn on real tracking in Settings.', 5000);
  };
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
      const slot = form.querySelector('.logo-slot');
      slot.innerHTML = '';
      slot.dataset.v = '';
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
    ? '<b>Gmail isn\'t set up yet.</b> Do the steps below once, then PackTrack finds your packages by itself.'
    : !g.connected ? 'Almost there: tap <b>Connect Gmail</b> and sign in.'
      : `✓ Gmail connected${g.lastSyncAt ? ` · last checked ${esc(relTime(g.lastSyncAt))}` : ''}${g.lastError ? `<div class="err">${esc(g.lastError)}</div>` : ''}`;
  $('#gmailSyncBtn').textContent = !g.connected ? 'Connect Gmail' : 'Check Gmail now';
  $('#gmailSyncBtn').hidden = !g.configured;
  $('#gmailDisconnect').hidden = !g.connected;
  $('#gmailOrigin').textContent = location.origin;
  $('#gmailRedirect').textContent = redirectUrl();
  renderWizard();
}

// ---- Gmail setup checklist ----
const WIZ_KEY = 'pt.gmailSteps';
function wizardDone() {
  try { return new Set(JSON.parse(localStorage.getItem(WIZ_KEY) || '[]')); } catch { return new Set(); }
}
function setStepDone(step, done) {
  const set = wizardDone();
  if (done) set.add(step); else set.delete(step);
  try { localStorage.setItem(WIZ_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
  renderWizard();
}
function renderWizard() {
  const g = gmailState();
  const done = wizardDone();
  if (g.configured) done.add('6');
  const steps = $$('#gmailWizard li[data-step]');
  for (const li of steps) {
    const on = done.has(li.dataset.step);
    li.classList.toggle('done', on);
    li.querySelector('input[type=checkbox]').checked = on;
  }
  const next = steps.find((li) => !done.has(li.dataset.step));
  for (const li of steps) li.classList.toggle('next', li === next);
  $('#wizardProgress').textContent = `${steps.filter((li) => done.has(li.dataset.step)).length} of ${steps.length} done`;
  $('#gmailWizard').hidden = g.connected;
  if (document.activeElement !== $('#wizardClientId')) $('#wizardClientId').value = getSettings().googleClientId || '';
}
function initWizard() {
  for (const li of $$('#gmailWizard li[data-step]')) {
    const step = li.dataset.step;
    li.querySelector('input[type=checkbox]').onchange = (e) => setStepDone(step, e.target.checked);
    const link = li.querySelector('a.btn');
    if (link) link.addEventListener('click', () => setTimeout(() => setStepDone(step, true), 300));
  }
  $('#wizardConnect').onclick = () => {
    const id = $('#wizardClientId').value.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
      toast('That doesn\'t look right. The Client ID ends in .apps.googleusercontent.com', 5000);
      return;
    }
    updateSettings({ googleClientId: id });
    startSignIn(redirectUrl());
  };
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
      Store: ${r.store ? logoHtml(r.store.id) : ''}<b>${esc(r.store?.name || 'not recognised')}</b>
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
    toast(await copyText(bookmarkletCode()) ? 'Copied! Now do step 2.' : 'Could not copy', 4000);
  };
  // Show the bookmark steps for this device first; the other device's steps go in "On another device?".
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const other = $(`[data-device="${ios ? 'desktop' : 'ios'}"]`);
  $('#otherDevice').appendChild(other);
  $('#otherDeviceLabel').textContent = ios ? 'On a computer?' : 'On iPhone or iPad?';
  $('#impPasteClip').onclick = async () => {
    const text = await pasteFromClipboard();
    if (!text) { toast('Long-press the box and tap Paste', 4000); $('#impText').focus(); return; }
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
    if (!g.configured) { toast('Do the setup steps first'); return; }
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

const KEY_FIELD = { '17track': 'seventeenTrackKey', ship24: 'ship24Key', aftership: 'aftershipKey' };
const SERVICE_HELP = {
  '17track': 'Free key: sign up at <a href="https://api.17track.net" target="_blank" rel="noopener">api.17track.net</a>, then copy the API key from your dashboard and paste it above.',
  ship24: 'Free key: sign up at <a href="https://www.ship24.com/tracking-api" target="_blank" rel="noopener">ship24.com</a>, then copy the API key from your dashboard and paste it above.',
  aftership: 'Free key: sign up at <a href="https://www.aftership.com/tracking-api" target="_blank" rel="noopener">aftership.com</a>, then copy an API key from Settings → API keys and paste it above.',
  mock: 'Shows made-up progress so you can try PackTrack. Not real tracking.',
  none: 'Packages are still saved, and each one has a link to the carrier\'s own tracking page.',
};
let pendingKeys = {};

function updateServiceUi() {
  const form = $('#settingsForm');
  const choice = form.serviceChoice.value;
  form.serviceKey.closest('label').hidden = !KEY_FIELD[choice];
  $('#serviceHelp').innerHTML = SERVICE_HELP[choice] || '';
}

function openSettings() {
  const s = getSettings();
  const form = $('#settingsForm');
  for (const el of form.elements) if (el.name && el.name in s) el.value = s[el.name];
  pendingKeys = Object.fromEntries(Object.entries(KEY_FIELD).map(([svc, field]) => [svc, s[field] || '']));
  const choice = KEY_FIELD[s.provider] || ['mock', 'none'].includes(s.provider) ? s.provider
    : Object.keys(KEY_FIELD).find((svc) => pendingKeys[svc]) || '17track';
  form.serviceChoice.value = choice;
  form.serviceKey.value = pendingKeys[choice] || '';
  form.serviceChoice.dataset.prev = choice;
  updateServiceUi();
  updateNotifyBtn();
  $('#storageNote').textContent = db.persistent
    ? 'Your packages and settings are saved in this browser on this device. Use Export to back them up or move them to another device.'
    : 'This browser is not allowing storage (private mode?), so nothing will be kept after you close the page.';
  $('#settingsDialog').showModal();
}

function updateNotifyBtn() {
  const b = $('#notifyBtn');
  if (!('Notification' in window)) { b.disabled = true; b.textContent = 'Notifications not supported'; return; }
  b.textContent = Notification.permission === 'granted' ? 'Notifications on ✓' : 'Enable notifications';
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
    const f = Object.fromEntries(new FormData($('#settingsForm')));
    const patch = {
      provider: f.serviceChoice, pollMinutes: f.pollMinutes, proxyUrl: f.proxyUrl, googleClientId: f.googleClientId, helperUrl: f.helperUrl,
    };
    if (KEY_FIELD[f.serviceChoice]) pendingKeys[f.serviceChoice] = f.serviceKey || '';
    for (const [svc, field] of Object.entries(KEY_FIELD)) patch[field] = pendingKeys[svc] || '';
    updateSettings(patch);
    toast(KEY_FIELD[f.serviceChoice] && !f.serviceKey ? 'Saved. Paste a key to turn on live tracking.' : 'Settings saved', 4000);
    renderProvider();
    refreshAll({ onlyStale: true });
  });
  $('#notifyBtn').onclick = async () => { await Notification.requestPermission(); updateNotifyBtn(); };
  const form = $('#settingsForm');
  form.serviceChoice.onchange = () => {
    const prev = form.serviceChoice.dataset.prev;
    if (KEY_FIELD[prev]) pendingKeys[prev] = form.serviceKey.value;
    form.serviceKey.value = pendingKeys[form.serviceChoice.value] || '';
    form.serviceChoice.dataset.prev = form.serviceChoice.value;
    updateServiceUi();
  };
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
  initStorePicker();
  initQuickAdd();
  initWizard();
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
    const tab = e.target.closest('[data-open-tab]');
    if (tab) {
      showImportTab(tab.dataset.openTab);
      $('#importDialog').showModal();
      return;
    }
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
