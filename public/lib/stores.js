// Online stores PackTrack recognises in emails and order pages.
// `domains` matches the sender address / page URL; `names` matches brand mentions in text;
// `order` holds store-specific order-number formats (tried before the generic keyword search).
// The detailed stores are below; the long list of other stores is in store-list.js.

import { STORE_LIST, CATEGORIES, DETAILED_CATEGORY } from './store-list.js';

export { CATEGORIES };

const DETAILED = [
  {
    id: 'amazon', name: 'Amazon',
    domains: ['amazon.com', 'amazon.de', 'amazon.co.uk', 'amazon.se', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.pl', 'amazon.ca', 'amazon.com.au', 'amazon.co.jp', 'amazon.com.be', 'amazon.com.tr'],
    names: ['Amazon'],
    order: [/\b(\d{3}-\d{7}-\d{7})\b/],
  },
  {
    id: 'temu', name: 'Temu',
    domains: ['temu.com'],
    names: ['Temu'],
    order: [/\b(PO-\d{3}-\d{8,22})\b/i],
  },
  {
    id: 'bambulab', name: 'Bambu Lab',
    domains: ['bambulab.com', 'store.bambulab.com', 'eu.store.bambulab.com', 'us.store.bambulab.com', 'uk.store.bambulab.com', 'au.store.bambulab.com'],
    names: ['Bambu Lab', 'BambuLab', 'Bambu Store'],
    order: [/order\s*#\s*([A-Z]{0,3}\d{4,12})\b/i],
  },
  {
    id: 'verkkokauppa', name: 'Verkkokauppa.com',
    domains: ['verkkokauppa.com'],
    names: ['Verkkokauppa.com', 'Verkkokauppa'],
    order: [/tilaus(?:numero|nro)?\s*[:#]?\s*(\d{6,12})\b/i],
  },
  {
    id: 'aliexpress', name: 'AliExpress',
    domains: ['aliexpress.com', 'aliexpress.us', 'aliexpress.ru'],
    names: ['AliExpress'],
    order: [/order\s*(?:number|no\.?|id)?\s*[:#]?\s*(\d{15,20})\b/i],
  },
  { id: 'ebay', name: 'eBay', domains: ['ebay.com', 'ebay.de', 'ebay.co.uk', 'ebay.fr', 'ebay.it', 'ebay.es'], names: ['eBay'], order: [/\b(\d{2}-\d{5}-\d{5})\b/] },
  { id: 'shein', name: 'SHEIN', domains: ['shein.com', 'sheinemail.com'], names: ['SHEIN'], order: [/\b(GS[A-Z0-9]{8,16})\b/] },
  { id: 'etsy', name: 'Etsy', domains: ['etsy.com'], names: ['Etsy'], order: [] },
  { id: 'wish', name: 'Wish', domains: ['wish.com'], names: [], order: [] },
  { id: 'banggood', name: 'Banggood', domains: ['banggood.com'], names: ['Banggood'], order: [] },
  { id: 'gigantti', name: 'Gigantti / Elgiganten', domains: ['gigantti.fi', 'elgiganten.se', 'elgiganten.dk', 'elkjop.no'], names: ['Gigantti', 'Elgiganten', 'Elkjøp'], order: [] },
  { id: 'power', name: 'Power', domains: ['power.fi', 'power.no', 'power.dk', 'power.se'], names: ['POWER'], order: [] },
  { id: 'jimms', name: "Jimm's PC-Store", domains: ['jimms.fi'], names: ["Jimm's"], order: [] },
  { id: 'proshop', name: 'Proshop', domains: ['proshop.fi', 'proshop.dk', 'proshop.se', 'proshop.no', 'proshop.de'], names: ['Proshop'], order: [] },
  { id: 'komplett', name: 'Komplett', domains: ['komplett.no', 'komplett.se', 'komplett.dk'], names: ['Komplett'], order: [] },
  { id: 'cdon', name: 'CDON', domains: ['cdon.fi', 'cdon.se', 'cdon.com'], names: ['CDON'], order: [] },
  { id: 'zalando', name: 'Zalando', domains: ['zalando.fi', 'zalando.de', 'zalando.se', 'zalando.com', 'zalando.co.uk'], names: ['Zalando'], order: [] },
  { id: 'boozt', name: 'Boozt', domains: ['boozt.com'], names: ['Boozt'], order: [] },
  { id: 'clasohlson', name: 'Clas Ohlson', domains: ['clasohlson.com'], names: ['Clas Ohlson'], order: [] },
  { id: 'motonet', name: 'Motonet', domains: ['motonet.fi'], names: ['Motonet'], order: [] },
  { id: 'tokmanni', name: 'Tokmanni', domains: ['tokmanni.fi'], names: ['Tokmanni'], order: [] },
  { id: 'xxl', name: 'XXL', domains: ['xxl.fi', 'xxl.se', 'xxl.no'], names: [], order: [] },
  { id: 'varusteleka', name: 'Varusteleka', domains: ['varusteleka.com', 'varusteleka.fi'], names: ['Varusteleka'], order: [] },
  { id: 'ikea', name: 'IKEA', domains: ['ikea.com'], names: ['IKEA'], order: [] },
  { id: 'apple', name: 'Apple', domains: ['apple.com'], names: ['Apple Store'], order: [/\b(W\d{9,10})\b/] },
  { id: 'prusa', name: 'Prusa Research', domains: ['prusa3d.com'], names: ['Prusa'], order: [] },
  { id: 'creality', name: 'Creality', domains: ['creality.com', 'store.creality.com'], names: ['Creality'], order: [] },
  { id: 'elegoo', name: 'Elegoo', domains: ['elegoo.com'], names: ['Elegoo'], order: [] },
  { id: 'walmart', name: 'Walmart', domains: ['walmart.com'], names: ['Walmart'], order: [] },
  { id: 'bestbuy', name: 'Best Buy', domains: ['bestbuy.com'], names: ['Best Buy'], order: [/\b(BBY01-\d{12})\b/] },
  { id: 'target', name: 'Target', domains: ['target.com'], names: [], order: [] },
  { id: 'dhgate', name: 'DHgate', domains: ['dhgate.com'], names: ['DHgate'], order: [] },
];

export const STORES = [
  ...DETAILED.map((st) => ({ ...st, category: DETAILED_CATEGORY[st.id] || 'marketplace' })),
  ...STORE_LIST.map(([id, name, domains, category, names]) => ({
    id, name, domains: domains.split(/\s+/), category, names: names ?? [name], order: [],
  })),
];

export const STORE_BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s]));

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Built once: patterns for a store's domains and names appearing in text.
let matchers = null;
function storeMatchers() {
  if (matchers) return matchers;
  matchers = STORES.map((st) => ({
    st,
    domainRe: new RegExp(`\\b(?:${st.domains.map(escapeRe).join('|')})\\b`, 'i'),
    nameRe: st.names.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(?:${st.names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null,
  }));
  return matchers;
}

function hostMatches(host, domain) {
  host = host.toLowerCase();
  return host === domain || host.endsWith('.' + domain);
}

// Shopify / generic shipping-notification mailers carry the store name in the From display name.
export function detectStore({ from = '', url = '', text = '' } = {}) {
  const scores = new Map();
  const add = (id, n) => scores.set(id, (scores.get(id) || 0) + n);

  const fromDomain = (/@([a-z0-9.-]+)/i.exec(from) || [])[1] || '';
  let pageHost = '';
  try { pageHost = url ? new URL(url).hostname : ''; } catch { /* ignore */ }

  for (const { st, domainRe, nameRe } of storeMatchers()) {
    for (const d of st.domains) {
      if (fromDomain && hostMatches(fromDomain, d)) { add(st.id, 10); break; }
    }
    for (const d of st.domains) {
      if (pageHost && hostMatches(pageHost, d)) { add(st.id, 10); break; }
    }
    // domain mentioned in the body (e.g. "Thanks for shopping at verkkokauppa.com")
    if (domainRe.test(text)) add(st.id, 2);
    if (nameRe) {
      if (nameRe.test(from)) add(st.id, 6);
      if (nameRe.test(text)) add(st.id, 1);
    }
  }
  let best = null;
  for (const [id, score] of scores) if (!best || score > best.score) best = { id, score };
  return best && best.score >= 2 ? STORE_BY_ID[best.id] : null;
}

// ---- Typed store names ----

const squash = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Looks like a web address ("jimms.fi", "https://shop.example.com/x")?
export function domainFromText(text) {
  const t = String(text || '').trim().toLowerCase();
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#]|$)/.exec(t);
  return m ? m[1] : null;
}

// Recognise what the user typed: "amazon", "Amazon.de", "bambu lab", "verkkokauppa.com", "store.bambulab.com"…
export function matchStore(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (STORE_BY_ID[raw]) return STORE_BY_ID[raw];
  const domain = domainFromText(raw);
  if (domain) {
    for (const s of STORES) if (s.domains.some((d) => hostMatches(domain, d))) return s;
  }
  const q = squash(raw);
  if (q.length < 2) return null;
  for (const s of STORES) {
    const keys = [s.id, s.name, ...s.names, ...s.domains, ...s.domains.map((d) => d.split('.')[0])].map(squash);
    if (keys.includes(q)) return s;
  }
  return null;
}

// Store value to save: a known store's id, or the typed text as a custom store.
export function storeValue(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  return matchStore(raw)?.id || raw;
}

export function storeName(value) {
  if (!value) return null;
  return STORE_BY_ID[value]?.name || value;
}

// Domain used for the store's logo (a known store's main site, or a typed web address).
export function storeDomain(value) {
  if (!value) return null;
  const s = STORE_BY_ID[value] || matchStore(value);
  if (s) return s.domains[0];
  return domainFromText(value);
}

// The store's own site icon, via Google's favicon service.
export function storeLogoUrl(value) {
  const d = storeDomain(value);
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : null;
}
