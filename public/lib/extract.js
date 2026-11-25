// Pull tracking numbers, carrier, store and order number out of an email or a web page.
//
// Input: { text, html, from, subject, url, title }
// Output: { store, orderNumber, label, candidates: [{ trackingNumber, carrier, confidence, reason }] }

import {
  detectCarrier, normalizeNumber, strengthRank, carrierFromHost, AGGREGATOR_HOSTS,
} from './carriers.js';
import { detectStore } from './stores.js';

// "Tracking number" in the languages PackTrack users are likely to receive mail in.
const TRACKING_KEYWORDS = [
  'tracking\\s*(?:number|no\\.?|nr\\.?|#|code|id|ID)', 'track(?:ing)?\\s*(?:&|and)\\s*trace', 'tracking',
  'waybill(?:\\s*(?:number|no\\.?))?', 'AWB', 'consignment\\s*(?:number|no\\.?)', 'parcel\\s*(?:number|no\\.?|id)',
  'shipment\\s*(?:number|id|tracking)', 'package\\s*tracking',
  // Finnish
  'seurantakoodi', 'seurantatunnus', 'seurantanumero', 'lähetystunnus', 'lähetysnumero', 'kollitunnus', 'pakettitunnus', 'seuranta',
  // Swedish / Norwegian / Danish
  'spårningsnummer', 'kollinummer', 'kolli-id', 'sporingsnummer', 'forsendelsesnummer', 'sändningsnummer',
  // German
  'sendungsnummer', 'sendungsverfolgung', 'paketnummer', 'trackingnummer',
  // French / Spanish / Italian / Dutch
  'numéro\\s*de\\s*suivi', 'número\\s*de\\s*seguimiento', 'numero\\s*di\\s*tracciamento', 'track\\s*&\\s*trace\\s*code', 'zendingnummer',
  // Chinese
  '运单号', '物流单号', '跟踪号',
];
const KEYWORD_RE = new RegExp(`(?:${TRACKING_KEYWORDS.join('|')})`, 'giu');

const ORDER_KEYWORDS = [
  'order\\s*(?:number|no\\.?|nr\\.?|id|#)', 'order', 'tilausnumero', 'tilausnro', 'tilaus', 'bestellnummer', 'bestellung',
  'ordernummer', 'ordrenummer', 'ordernr', 'numéro\\s*de\\s*commande', 'número\\s*de\\s*pedido', '订单号',
];
const ORDER_RE = new RegExp(`(?:${ORDER_KEYWORDS.join('|')})\\s*[:#.]?\\s*#?\\s*([A-Z0-9][A-Z0-9-]{3,30})`, 'giu');

// Query parameter names that typically carry a tracking number in carrier/aggregator links.
const PARAM_RE = /^(?:track(?:ing)?[_-]?(?:num(?:ber)?s?|nbr|no|id|code)?|tracknum(?:ber)?s?|trknbr|tlabels|qtc_tlabels1|awb|piececode|idc|parcel(?:number|nr|no)?|shipment(?:id|number)?|refnumber|match|barcodes?|mailnolist|nums|id|tracking-id|search|searchfor|inquirynumber1)$/i;

// Text that is clearly not a tracking number even if it matches a weak pattern.
function looksLikeNoise(n) {
  return /^(?:19|20)\d{6}$/.test(n) // dates
    || /^0{6,}/.test(n)
    || /^(\d)\1{7,}$/.test(n);
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

export function extractUrls(text, html) {
  const urls = new Set();
  const decode = (u) => u.replace(/&amp;/g, '&').replace(/[)\].,;'"]+$/, '');
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) urls.add(decode(m[1]));
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"']+/gi)) urls.add(decode(m[0]));
  return [...urls];
}

// Many mailers wrap links in redirectors (?url=…, ?u=…). Unwrap one level.
function unwrap(u) {
  try {
    const url = new URL(u);
    for (const [k, v] of url.searchParams) {
      if (/^(url|u|target|redirect|link|dest|destination|r)$/i.test(k) && /^https?:\/\//i.test(v)) return v;
    }
  } catch { /* ignore */ }
  return u;
}

function fromUrl(rawUrl) {
  const out = [];
  let url;
  try { url = new URL(unwrap(rawUrl)); } catch { return out; }
  const host = url.hostname.toLowerCase();
  const hostCarrier = carrierFromHost(host);
  const isAggregator = AGGREGATOR_HOSTS.test(host);
  const trackingish = hostCarrier || isAggregator || /track|seuranta|sendung|parcel|shipment|lahetys/i.test(url.pathname + url.hash);
  if (!trackingish) return out;

  const values = [];
  for (const [k, v] of url.searchParams) if (PARAM_RE.test(k)) values.push(...v.split(/[,;|\s]+/));
  // Hash-router query strings, e.g. 17track "#nums=…"
  const hashQuery = url.hash.includes('=') ? new URLSearchParams(url.hash.replace(/^#\/?/, '').replace(/^[^?]*\?/, '')) : null;
  if (hashQuery) for (const [k, v] of hashQuery) if (PARAM_RE.test(k)) values.push(...v.split(/[,;|\s]+/));
  // Path segments for carriers that put the number in the path (posti …/lahetys/X, dpd …/parcel/X, amazon /tracking/X…)
  if (hostCarrier || isAggregator) {
    const segs = (url.pathname + '/' + url.hash.replace(/^#/, '')).split(/[/?&=]/).filter(Boolean);
    values.push(...segs.slice(-3));
  }

  for (const v of values) {
    const n = normalizeNumber(decodeURIComponent(v));
    const det = detectCarrier(n);
    if (!det || looksLikeNoise(n)) continue;
    // On store pages (e.g. Amazon "track package" links) only trust distinctive formats –
    // their ids (shipmentId, orderId…) are not carrier tracking numbers.
    if (!hostCarrier && !isAggregator && det.strength === 'weak') continue;
    let carrier = det.carrier;
    // The link's host is better evidence than a weak format guess.
    if (hostCarrier && det.strength !== 'strong') carrier = hostCarrier;
    out.push({ trackingNumber: n, carrier, confidence: 'high', reason: `link to ${host}` });
  }
  return out;
}

function nearKeywords(text) {
  const out = [];
  KEYWORD_RE.lastIndex = 0;
  let m;
  while ((m = KEYWORD_RE.exec(text))) {
    const windowText = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    // Tokens right after the keyword; allow numbers printed with spaces ("1Z 999 AA1 …") by also trying joined groups.
    const tokens = windowText.match(/[A-Z0-9][A-Z0-9-]{5,40}/gi) || [];
    // Numbers printed in groups: join runs of short words and keep strong/medium hits.
    const words = windowText.split(/[\s:]+/).filter(Boolean).slice(0, 10);
    const spaced = [];
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 3; j <= Math.min(words.length, i + 8); j++) {
        const joined = words.slice(i, j).join('').replace(/[.,;)]+$/, '');
        const det = /^[A-Z0-9]+$/i.test(joined) && detectCarrier(joined);
        if (det && det.strength !== 'weak') spaced.push(joined);
      }
    }
    for (const t of [...tokens.slice(0, 3), ...spaced.sort((a, b) => b.length - a.length).slice(0, 1)]) {
      const n = normalizeNumber(t);
      const det = detectCarrier(n);
      if (!det || looksLikeNoise(n)) continue;
      out.push({ trackingNumber: n, carrier: det.carrier, confidence: det.strength === 'weak' ? 'medium' : 'high', reason: `next to “${m[0].trim()}”` });
    }
  }
  return out;
}

function scanTokens(text) {
  const out = [];
  for (const t of text.match(/\b[A-Z0-9]{10,34}\b/gi) || []) {
    const n = normalizeNumber(t);
    const det = detectCarrier(n);
    if (!det || det.strength === 'weak') continue;
    out.push({ trackingNumber: n, carrier: det.carrier, confidence: det.strength === 'strong' ? 'high' : 'medium', reason: 'recognised format' });
  }
  return out;
}

function findOrderNumber(text, store) {
  for (const re of store?.order || []) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  ORDER_RE.lastIndex = 0;
  let m;
  while ((m = ORDER_RE.exec(text))) {
    const v = m[1].replace(/-$/, '');
    if (/\d{3,}/.test(v)) return v;
  }
  return null;
}

function cleanSubject(subject) {
  return String(subject || '')
    .replace(/^\s*((re|fw|fwd|vs|sv|aw|wg)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

export function extractShipments(input = {}) {
  const { from = '', subject = '', url = '', title = '' } = input;
  const html = input.html || '';
  const text = [subject, input.text || '', html ? htmlToText(html) : ''].join('\n');

  const store = detectStore({ from, url, text });
  const orderNumber = findOrderNumber(text, store);

  const found = [
    ...extractUrls(input.text, html).flatMap(fromUrl),
    ...nearKeywords(text),
    ...scanTokens(text),
  ];

  // Deduplicate, keep the most confident sighting, drop the order number itself.
  const byNumber = new Map();
  for (const c of found) {
    if (orderNumber && normalizeNumber(orderNumber) === c.trackingNumber) continue;
    const prev = byNumber.get(c.trackingNumber);
    const better = !prev
      || CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[prev.confidence]
      || (CONFIDENCE_RANK[c.confidence] === CONFIDENCE_RANK[prev.confidence]
        && strengthRank(detectCarrier(c.trackingNumber)?.strength) > strengthRank(detectCarrier(prev.trackingNumber)?.strength));
    if (better) byNumber.set(c.trackingNumber, c);
  }
  // A number that is a substring of a longer found number is usually a fragment (e.g. inside an SSCC).
  const nums = [...byNumber.keys()];
  for (const n of nums) {
    if (nums.some((o) => o !== n && o.includes(n)) && byNumber.get(n).confidence !== 'high') byNumber.delete(n);
  }

  const candidates = [...byNumber.values()].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]);
  return {
    store: store ? { id: store.id, name: store.name } : null,
    orderNumber,
    label: cleanSubject(subject) || cleanSubject(String(title || '').replace(/\s+[|–—-]\s+[^|–—-]+$/, '')) || null,
    candidates,
  };
}
