// 17TRACK Tracking API v2.2 — https://api.17track.net (free tier available, 2,000+ carriers).
// A number must be registered once, then results are fetched with gettrackinfo.

import { requestJson, iso, sortEvents } from './http.js';

const BASE = 'https://api.17track.net/track/v2.2';

const STATUS_MAP = {
  NotFound: 'not_found',
  InfoReceived: 'info_received',
  InTransit: 'in_transit',
  Expired: 'expired',
  AvailableForPickup: 'available_for_pickup',
  OutForDelivery: 'out_for_delivery',
  DeliveryFailure: 'failed_attempt',
  Delivered: 'delivered',
  Exception: 'exception',
};

function locationOf(e) {
  if (typeof e.location === 'string') return e.location;
  const a = e.address || {};
  return [a.city, a.state, a.country].filter(Boolean).join(', ') || null;
}

export function createSeventeenTrack(apiKey) {
  const headers = { '17token': apiKey };
  return {
    id: '17track',
    name: '17TRACK',
    async track(shipment) {
      const number = shipment.trackingNumber;
      const state = { ...shipment.providerState };
      if (!state.registered17) {
        const reg = await requestJson(`${BASE}/register`, { method: 'POST', headers, body: [{ number }] });
        const rejected = reg?.data?.rejected?.[0];
        // -18019901 = already registered; anything else is a real error.
        if (rejected && rejected.error?.code !== -18019901) {
          throw new Error(`17TRACK: ${rejected.error?.message || 'number rejected'}`);
        }
        state.registered17 = true;
      }

      const res = await requestJson(`${BASE}/gettrackinfo`, { method: 'POST', headers, body: [{ number }] });
      const item = res?.data?.accepted?.[0];
      if (!item) {
        const rej = res?.data?.rejected?.[0];
        return { status: 'not_found', statusText: rej?.error?.message || 'No tracking data yet', events: [], providerState: state };
      }
      const info = item.track_info || {};
      const events = sortEvents((info.tracking?.providers || []).flatMap((p) => (p.events || []).map((e) => ({
        time: iso(e.time_iso || e.time_utc),
        description: e.description,
        location: locationOf(e),
        status: STATUS_MAP[e.stage] || null,
      }))));
      const latest = info.latest_status?.status;
      const eta = info.time_metrics?.estimated_delivery_date;
      return {
        status: STATUS_MAP[latest] || (events.length ? 'in_transit' : 'not_found'),
        statusText: info.latest_event?.description || events[0]?.description || null,
        eta: iso(eta?.to || eta?.from),
        events,
        providerState: state,
      };
    },
  };
}
