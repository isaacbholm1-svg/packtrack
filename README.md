# PackTrack

Track all your packages in one place, whichever carrier and store they come from.

- **Many carriers:** recognises tracking-number formats for UPS, USPS, FedEx, DHL (Express, Paket, eCommerce), Amazon Logistics, Posti, Matkahuolto, PostNord, Budbee, DB Schenker, GLS, DPD, Bring, Omniva, PostNL, Deutsche Post, Royal Mail, Canada Post, Australia Post, China Post, Cainiao, YunExpress, 4PX, SF Express and any UPU postal number (`RR123456785FI`, …).
- **Live status** through a tracking aggregator (17TRACK, Ship24 or AfterShip), which covers 1,000+ carriers with one API key.
- **Import from stores:** Amazon, Temu, Bambu Lab, Verkkokauppa.com, AliExpress, eBay, SHEIN, Etsy, Gigantti/Elgiganten, Power, Jimm's, Proshop, Zalando, IKEA, Prusa, Creality and more, from
  - **shipping emails**, pasted in or read automatically from your mailbox (IMAP), and
  - **order pages**, sent with a one-click browser button (bookmarklet) while you're logged in to the store.
- Orders without a tracking number yet are kept as **“awaiting tracking”**, and filled in when the shipping email arrives.
- Background polling, browser notifications on status changes, search, store filter, archive, dark mode, mobile layout.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 22.9 or newer. Data is stored in `data/db.json`.

To try the app without an API key, open **Settings → Provider → Demo data**. This shows fake progress, and every demo event is marked “(demo)”.

## Live tracking: get an API key

Store websites need your login and carriers each have their own API, so PackTrack gets live tracking data from an aggregator. Pick one; all three have a free tier:

| Provider | Where to get a key | Notes |
|---|---|---|
| 17TRACK | <https://api.17track.net> | Large carrier coverage, including Chinese carriers used by Temu/AliExpress. Each number is registered once. |
| Ship24 | <https://www.ship24.com/tracking-api> | Simple single-call API. |
| AfterShip | <https://www.aftership.com/tracking-api> | |

Paste the key in **Settings** in the app, or put it in `.env` (see `.env.example`). With *Automatic*, the first provider that has a key is used.

Without a key you can still store packages, and each one has a link to the carrier's own tracking page and to 17TRACK.

## Importing from stores

PackTrack doesn't log in to store websites (that would mean storing your store passwords and breaking whenever a site changes). It reads what the stores already send you.

1. **Paste:** **Import → Paste email / page**, paste a shipping email (or its HTML source) or the text of an order page. You get a preview of what was found, then pick what to add.
2. **Browser button:** **Import → Browser button**, then drag **📦 Send to PackTrack** to your bookmarks bar. On any order or “track package” page (Amazon, Temu, Bambu Lab, Verkkokauppa.com…), click it. PackTrack opens with the packages from that page for you to confirm. The page text goes to your local PackTrack only, inside the URL fragment, which is never sent to any server.
3. **Email sync:** enter IMAP details in **Settings**. PackTrack checks the mailbox every 15 minutes (configurable). It only looks at messages that look like order or shipping mail, and adds packages it is confident about. It opens the mailbox read-only and never deletes, moves or marks mail as read.
   - Gmail: enable 2-step verification, create an *app password*, host `imap.gmail.com`, port 993.
   - Outlook / Hotmail: host `outlook.office365.com`, port 993.

How detection works (`server/import/extract.js`):
- **Links** to carrier or tracking sites are the strongest signal (e.g. `posti.fi/…/lahetys/JJFI…`, `dhl.com/…?AWB=…`, `matkahuolto.fi/seuranta?parcelNumber=…`). Mailer redirect links are unwrapped.
- Numbers right after a **“tracking number” keyword** in English, Finnish, Swedish, Norwegian, Danish, German, French, Spanish, Italian, Dutch or Chinese (*seurantakoodi, lähetystunnus, Sendungsnummer, spårningsnummer…*).
- **Distinctive formats** anywhere in the text (1Z…, TBA…, JJFI…, LP…, YT…, UPU numbers with a valid check digit).
- Plain digit runs (which could be FedEx, DHL Express, DPD and so on) are only accepted next to a keyword or in a tracking link, so phone numbers and invoice numbers aren't picked up.
- The **store** comes from the sender address or page URL (then from brand mentions), and the **order number** from store-specific formats (Amazon `123-1234567-1234567`, Temu `PO-…`, …) or *order number / tilausnumero / Bestellnummer* keywords.

Adding a store: add an entry to `server/import/stores.js` (domains, names, optional order-number regex). Adding a carrier: add it to `CARRIERS`, `PATTERNS` and/or `HOST_CARRIER` in `server/carriers.js`.

## Configuration

Everything can be set in the app's **Settings**. Values saved there override environment variables. See `.env.example` for the environment variables.

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Set `HOST=0.0.0.0` to reach it from other devices on your network (there's no login, so only do this on a trusted network). |
| `TRACKING_PROVIDER` | `auto` | `auto`, `17track`, `ship24`, `aftership`, `mock`, `none` |
| `POLL_MINUTES` | `60` | How often active packages are re-checked (0 = off) |
| `PACKTRACK_DATA_DIR` | `./data` | |

API keys and the IMAP password are stored in plain text in `data/db.json`, so keep that file private.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/shipments` | List |
| POST | `/api/shipments` | `{ trackingNumber }`, `{ numbers: [...] }` or `{ items: [{ trackingNumber?, carrier?, label?, store?, orderNumber? }] }` |
| PATCH | `/api/shipments/:id` | `label`, `carrier`, `store`, `orderNumber`, `trackingNumber`, `archived` |
| DELETE | `/api/shipments/:id` | |
| POST | `/api/shipments/:id/refresh` | Refresh one now |
| POST | `/api/refresh` | Refresh all active packages in the background |
| POST | `/api/import/parse` | `{ text?, html?, from?, subject?, url?, title? }` returns detected packages without saving anything |
| POST | `/api/email/sync` | Check the mailbox now |
| GET | `/api/detect?n=…` | Detect the carrier for a number |
| GET/PUT | `/api/settings` | Secrets are never returned |

## Development

```bash
npm run dev   # restart on change
npm test      # carrier detection, email parsing (Amazon, Temu, Bambu Lab, Verkkokauppa, AliExpress…), API
```

### Status of the provider integrations

The 17TRACK, Ship24 and AfterShip clients (`server/providers/`) were written against those APIs' documented request and response formats, but **have not yet been run against live accounts**. If a provider returns something unexpected, the error appears on the package card. The mapping code for each provider is short and kept in one file.
