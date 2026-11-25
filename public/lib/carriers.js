// Carrier registry and tracking-number detection.
//
// Detection works on three levels of confidence:
//   strong – format is unique enough to accept anywhere in a text (e.g. 1Z…, TBA…, S10 with valid checksum)
//   medium – fairly distinctive, accepted anywhere but ranked below strong
//   weak   – plain digit runs (FedEx, DHL Express, DPD…) – only accepted when found next to a
//            "tracking number" keyword or inside a tracking link, never from a blind text scan.

const UNIVERSAL_URL = 'https://t.17track.net/en#nums={n}';

export const CARRIERS = {
  ups: { name: 'UPS', url: 'https://www.ups.com/track?tracknum={n}' },
  usps: { name: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}' },
  fedex: { name: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr={n}' },
  dhl: { name: 'DHL Express', url: 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}' },
  dhl_paket: { name: 'DHL Paket / Parcel', url: 'https://www.dhl.com/global-en/home/tracking/tracking-parcel.html?submit=1&tracking-id={n}' },
  dhl_ecommerce: { name: 'DHL eCommerce', url: 'https://www.dhl.com/global-en/home/tracking/tracking-ecommerce.html?submit=1&tracking-id={n}' },
  amazon: { name: 'Amazon Logistics', url: 'https://track.amazon.com/tracking/{n}' },
  posti: { name: 'Posti (Finland)', url: 'https://www.posti.fi/fi/seuranta#/lahetys/{n}' },
  matkahuolto: { name: 'Matkahuolto', url: 'https://www.matkahuolto.fi/seuranta?parcelNumber={n}' },
  postnord: { name: 'PostNord', url: 'https://tracking.postnord.com/tracking.html?id={n}' },
  budbee: { name: 'Budbee', url: UNIVERSAL_URL },
  dbschenker: { name: 'DB Schenker', url: 'https://www.dbschenker.com/app/tracking-public/?refNumber={n}' },
  gls: { name: 'GLS', url: 'https://gls-group.com/EU/en/parcel-tracking?match={n}' },
  dpd: { name: 'DPD', url: 'https://tracking.dpd.de/status/en_US/parcel/{n}' },
  bring: { name: 'Posten / Bring', url: 'https://tracking.bring.com/tracking/{n}' },
  omniva: { name: 'Omniva', url: 'https://www.omniva.ee/private/track_and_trace?barcode={n}' },
  postnl: { name: 'PostNL', url: 'https://postnl.post/tracktrace?barcodes={n}' },
  deutschepost: { name: 'Deutsche Post', url: 'https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode={n}' },
  royalmail: { name: 'Royal Mail', url: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}' },
  canadapost: { name: 'Canada Post', url: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={n}' },
  auspost: { name: 'Australia Post', url: 'https://auspost.com.au/mypost/track/#/details/{n}' },
  chinapost: { name: 'China Post', url: UNIVERSAL_URL },
  cainiao: { name: 'Cainiao', url: 'https://global.cainiao.com/newDetail.htm?mailNoList={n}' },
  yunexpress: { name: 'YunExpress', url: 'https://www.yuntrack.com/parcelTracking?id={n}' },
  '4px': { name: '4PX', url: 'https://track.4px.com/#/result/0/{n}' },
  yanwen: { name: 'Yanwen', url: UNIVERSAL_URL },
  sfexpress: { name: 'SF Express', url: 'https://www.sf-international.com/us/en/dynamic_function/waybill/#search/bill-number/{n}' },
  upu: { name: 'Postal service', url: UNIVERSAL_URL },
  other: { name: 'Other / unknown', url: UNIVERSAL_URL },
};

// UPU S10 country code → national postal carrier.
const S10_COUNTRY = {
  FI: 'posti', SE: 'postnord', DK: 'postnord', NO: 'bring', EE: 'omniva', LV: 'omniva', LT: 'omniva',
  DE: 'deutschepost', NL: 'postnl', GB: 'royalmail', US: 'usps', CA: 'canadapost', AU: 'auspost', CN: 'chinapost',
};

// Ordered most-specific first.
const PATTERNS = [
  { carrier: 'ups', re: /^1Z[0-9A-Z]{16}$/, strength: 'strong' },
  { carrier: 'amazon', re: /^TBA\d{12}$/, strength: 'strong' },
  { carrier: 'posti', re: /^JJFI\d{10,20}$/, strength: 'strong' },
  { carrier: 'dhl_paket', re: /^JJD\d{16,22}$/, strength: 'strong' },
  { carrier: 'dhl_ecommerce', re: /^GM\d{16,22}$/, strength: 'strong' },
  { carrier: 'cainiao', re: /^LP\d{12,16}$/, strength: 'strong' },
  { carrier: 'cainiao', re: /^(?:UUS|CNG|CNFI|CNSE|CNDE|CNUS)[0-9A-Z]{10,20}$/, strength: 'medium' },
  { carrier: 'yunexpress', re: /^YT\d{16}$/, strength: 'strong' },
  { carrier: '4px', re: /^4PX\d{10,20}(?:CN)?$/, strength: 'strong' },
  { carrier: 'sfexpress', re: /^SF\d{12,15}$/, strength: 'medium' },
  { carrier: 'matkahuolto', re: /^MH\d{8,16}$/, strength: 'medium' },
  { carrier: 'usps', re: /^(?:420\d{5,9})?9[2-5]\d{20}$/, strength: 'strong' },
  { carrier: 'fedex', re: /^96\d{20}$/, strength: 'medium' },
  { carrier: 'postnord', re: /^00370\d{13,15}$/, strength: 'medium' }, // SSCC with PostNord prefix
  { carrier: 'other', re: /^00\d{16,18}$/, strength: 'weak' }, // generic SSCC (DB Schenker, freight…)
  { carrier: 'fedex', re: /^(?:\d{12}|\d{15})$/, strength: 'weak' },
  { carrier: 'dpd', re: /^\d{14}$/, strength: 'weak' },
  { carrier: 'gls', re: /^\d{11}$/, strength: 'weak' },
  { carrier: 'dhl', re: /^\d{10}$/, strength: 'weak' },
  { carrier: 'other', re: /^[A-Z0-9]{8,30}$/, strength: 'weak' },
];

const STRENGTH_RANK = { strong: 3, medium: 2, weak: 1 };

export function normalizeNumber(raw) {
  return String(raw || '').toUpperCase().replace(/[\s\-.]/g, '');
}

// UPU S10 check digit (e.g. RR123456785FI).
export function isValidS10(n) {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(n);
  if (!m) return false;
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = [...m[1]].reduce((s, d, i) => s + Number(d) * w[i], 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return check === Number(m[2]);
}

// Returns { carrier, strength } or null if the string can't be a tracking number.
export function detectCarrier(raw) {
  const n = normalizeNumber(raw);
  if (n.length < 8 || n.length > 34) return null;
  // Pure letters or obvious non-tracking strings are rejected.
  if (!/\d{4,}/.test(n)) return null;

  const s10 = /^[A-Z]{2}\d{9}([A-Z]{2})$/.exec(n);
  if (s10) {
    const country = s10[1];
    const valid = isValidS10(n);
    return { carrier: S10_COUNTRY[country] || 'upu', strength: valid ? 'strong' : 'weak', country };
  }
  for (const p of PATTERNS) {
    if (p.re.test(n)) return { carrier: p.carrier, strength: p.strength };
  }
  return null;
}

export function strengthRank(s) {
  return STRENGTH_RANK[s] || 0;
}

export function carrierName(id) {
  return (CARRIERS[id] || CARRIERS.other).name;
}

export function trackingUrl(carrier, number) {
  const c = CARRIERS[carrier] || CARRIERS.other;
  return c.url.replace('{n}', encodeURIComponent(number));
}

export function universalTrackingUrl(number) {
  return UNIVERSAL_URL.replace('{n}', encodeURIComponent(number));
}

// Host → carrier mapping used when a tracking number is pulled out of a link.
const HOST_CARRIER = [
  [/(^|\.)ups\.com$/, 'ups'],
  [/(^|\.)usps\.com$/, 'usps'],
  [/(^|\.)fedex\.com$/, 'fedex'],
  [/(^|\.)dhl\.(de)$/, 'dhl_paket'],
  [/(^|\.)dhl\.[a-z.]+$/, 'dhl'],
  [/(^|\.)posti\.fi$/, 'posti'],
  [/(^|\.)matkahuolto\.fi$/, 'matkahuolto'],
  [/(^|\.)postnord\.[a-z.]+$/, 'postnord'],
  [/(^|\.)budbee\.com$/, 'budbee'],
  [/(^|\.)dbschenker\.com$/, 'dbschenker'],
  [/(^|\.)gls-[a-z]+\.[a-z.]+$|(^|\.)gls-group\.(eu|com)$/, 'gls'],
  [/(^|\.)dpd\.[a-z.]+$/, 'dpd'],
  [/(^|\.)bring\.[a-z.]+$|(^|\.)posten\.no$/, 'bring'],
  [/(^|\.)omniva\.[a-z.]+$/, 'omniva'],
  [/(^|\.)postnl\.[a-z.]+$/, 'postnl'],
  [/(^|\.)deutschepost\.de$/, 'deutschepost'],
  [/(^|\.)royalmail\.com$/, 'royalmail'],
  [/(^|\.)canadapost[a-z-]*\.ca$/, 'canadapost'],
  [/(^|\.)auspost\.com\.au$/, 'auspost'],
  [/(^|\.)cainiao\.com$/, 'cainiao'],
  [/(^|\.)yuntrack\.com$|(^|\.)yunexpress\.[a-z.]+$/, 'yunexpress'],
  [/(^|\.)4px\.com$/, '4px'],
  [/(^|\.)track\.amazon\.[a-z.]+$/, 'amazon'],
];

export function carrierFromHost(host) {
  const h = String(host || '').toLowerCase();
  for (const [re, id] of HOST_CARRIER) if (re.test(h)) return id;
  return null;
}

// Hosts that are generic multi-carrier trackers (carrier unknown from host alone).
export const AGGREGATOR_HOSTS = /(^|\.)(17track\.net|parcelsapp\.com|aftership\.com|ship24\.com|parcelpanel\.com|trackingmore\.com|track123\.com|route\.com|narvar\.com|parcellab\.com)$/i;

// Human-readable list for the UI.
export function carrierList() {
  return Object.entries(CARRIERS).map(([id, c]) => ({ id, name: c.name }));
}
