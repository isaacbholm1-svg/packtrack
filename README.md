# PackTrack

Track all your packages in one place, whichever carrier and store they come from. It runs entirely in your browser and is hosted free on GitHub Pages. You can add it to your phone's home screen.

- **Many carriers:** recognises tracking-number formats for UPS, USPS, FedEx, DHL (Express, Paket, eCommerce), Amazon Logistics, Posti, Matkahuolto, PostNord, Budbee, DB Schenker, GLS, DPD, Bring, Omniva, PostNL, Deutsche Post, Royal Mail, Canada Post, Australia Post, China Post, Cainiao, YunExpress, 4PX, SF Express and any UPU postal number (`RR123456785FI`, …).
- **Live status** through a tracking aggregator (17TRACK, Ship24 or AfterShip), which covers 1,000+ carriers with one API key.
- **Import from stores:** Amazon, Temu, Bambu Lab, Verkkokauppa.com, AliExpress, eBay, SHEIN, Etsy, Gigantti/Elgiganten, Power, Jimm's, Proshop, Zalando, IKEA, Prusa, Creality and more:
  - **paste** a shipping email or order page,
  - a **browser button** (bookmarklet) that sends the order page you're looking at to PackTrack,
  - **email sync** through the optional helper you run on your computer.
- Orders without a tracking number yet are kept as **“awaiting tracking”**, and filled in when the tracking number arrives.
- Search, store filter, archive, notifications while open, dark mode, backup export/restore.

## Publish on GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the tests and publishes the `public/` folder whenever `main` changes.

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions** (one time).
2. Merge to `main` (or run the workflow from the **Actions** tab).
3. The app is at `https://<your-username>.github.io/packtrack/`.

### Your data

- Packages, settings and API keys are stored **in the browser on each device** (localStorage). Nothing is sent to GitHub, and other visitors to the page can't see your data. Each visitor gets their own empty copy.
- Data doesn't sync between devices or browsers. Use **Settings → Export backup / Restore backup** to move it.
- Tracking numbers and your API key are sent only to the tracking service you choose (through your proxy, if you set one).

### On iPhone / Android

Open the page in Safari (or Chrome) and choose **Share → Add to Home Screen**. It opens full-screen with its own icon.

- On iPhone, the home-screen app keeps **its own storage, separate from Safari**. Add your packages from the home-screen app (or move them with Export/Restore).
- The **Send to PackTrack** bookmark works on iPhone too. On a shop's order page it copies the order details, and you paste them in the app with **Take from email → Paste from clipboard**. Setup steps are in the app under **Take from email → Bookmark**.
- Status is checked while the app is open; it doesn't send push notifications when closed.

## Live tracking

Get a free API key from one of these, and paste it in **Settings**:

| Provider | Where to get a key |
|---|---|
| 17TRACK | <https://api.17track.net> |
| Ship24 | <https://www.ship24.com/tracking-api> |
| AfterShip | <https://www.aftership.com/tracking-api> |

If a card shows *“The browser blocked the request”*, that API doesn't accept calls straight from a web page (CORS). Set up a free proxy:

- **Cloudflare Worker** (works from any device, including your phone): create a Worker at dash.cloudflare.com, paste in [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js), deploy, and put its URL (`https://….workers.dev`) in **Settings → Proxy URL**. Optionally set the Worker variable `ALLOWED_ORIGIN` to `https://<your-username>.github.io`. The proxy only forwards to the three tracking APIs and stores nothing.
- **Local helper** (computer only): see below, then use `http://localhost:3000/proxy?url=` as the proxy URL.

Without any key you can still keep a list of packages; each one links to the carrier's own tracking page and to 17TRACK. To try the app first, pick **Settings → Provider → Demo data** (fake progress, marked “(demo)”).

## Optional helper: email sync

A web page can't read your mailbox, so email sync runs in a small helper on your computer. It opens the mailbox **read-only** and returns the shipments it finds to the page, which stores them.

```bash
npm install
cp .env.example .env   # fill in IMAP_* and HELPER_ORIGINS=https://<your-username>.github.io
npm start              # http://localhost:3000 (also serves the app itself)
```

Then put `http://localhost:3000` in **Settings → Helper address** and use **Take from email → Email sync**.

- Gmail: turn on 2-step verification and create an *app password*. Host `imap.gmail.com`, port 993.
- Outlook / Hotmail: host `outlook.office365.com`, port 993.
- The helper only answers requests from its own address and from the origins in `HELPER_ORIGINS`, so other websites can't read your results.

## How store import works

`public/lib/extract.js` looks for tracking numbers in this order:

1. **Links** to carrier or tracking sites (e.g. `posti.fi/…/lahetys/JJFI…`, `dhl.com/…?AWB=…`, `matkahuolto.fi/seuranta?parcelNumber=…`). Mailer redirect links are unwrapped.
2. Numbers next to a **“tracking number” keyword** in English, Finnish, Swedish, Norwegian, Danish, German, French, Spanish, Italian, Dutch or Chinese (*seurantakoodi, lähetystunnus, Sendungsnummer, spårningsnummer…*).
3. **Distinctive formats** anywhere in the text (1Z…, TBA…, JJFI…, LP…, YT…, UPU numbers with a valid check digit).

Plain digit runs (which could be FedEx, DHL Express or DPD numbers) are only accepted in the first two cases, so phone and invoice numbers aren't picked up. The store comes from the sender address or page URL, and the order number from store formats (Amazon `123-1234567-1234567`, Temu `PO-…`) or *order number / tilausnumero / Bestellnummer* keywords.

Adding a store: `public/lib/stores.js`. Adding a carrier: `public/lib/carriers.js`.

## Project layout

```
public/            the app (what GitHub Pages serves)
  lib/             carriers, stores, extraction, storage, tracking providers
helper/            optional local helper: email sync + CORS proxy
proxy/             Cloudflare Worker CORS proxy
test/              node --test
```

## Development

```bash
npm test          # carrier detection, email parsing, storage/tracking logic, helper
npm start         # helper + app at http://localhost:3000
```

The 17TRACK, Ship24 and AfterShip clients (`public/lib/providers/`) were written against those APIs' documented formats, but **have not yet been run against live accounts**. If a provider replies with something unexpected, the error appears on the package card.
