// Online stores PackTrack recognises in emails and order pages.
// `domains` matches the sender address / page URL; `names` matches brand mentions in text;
// `order` holds store-specific order-number formats (tried before the generic keyword search).

export const STORES = [
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
    domains: ['aliexpress.com', 'aliexpress.us', 'aliexpress.ru', 'alibaba.com'],
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

export const STORE_BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s]));

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

  for (const s of STORES) {
    for (const d of s.domains) {
      if (fromDomain && hostMatches(fromDomain, d)) add(s.id, 10);
      if (pageHost && hostMatches(pageHost, d)) add(s.id, 10);
      // domain mentioned in the body (e.g. "Thanks for shopping at verkkokauppa.com")
      const re = new RegExp(`\\b${d.replace(/\./g, '\\.')}\\b`, 'i');
      if (re.test(text)) add(s.id, 2);
    }
    for (const name of s.names) {
      const re = new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
      if (re.test(from)) add(s.id, 6);
      if (re.test(text)) add(s.id, 1);
    }
  }
  let best = null;
  for (const [id, score] of scores) if (!best || score > best.score) best = { id, score };
  return best && best.score >= 2 ? STORE_BY_ID[best.id] : null;
}
