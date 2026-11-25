// AfterShip Tracking API — https://www.aftership.com/tracking-api (1,200+ carriers).
// Creates the tracking once, then reads it back by id.

import { requestJson, iso, sortEvents } from './http.js';

const BASE = 'https://api.aftership.com/tracking/2024-10';

const TAGS = {
  Pending: 'not_found',
  InfoReceived: 'info_received',
  InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  AttemptFail: 'failed_attempt',
  AvailableForPickup: 'available_for_pickup',
  Delivered: 'delivered',
  Exception: 'exception',
  Expired: 'expired',
};

// Newer API versions return the tracking as `data`, older ones as `data.tracking`.
const unwrap = (res) => res?.data?.tracking || res?.data || {};

export function createAfterShip(apiKey) {
  const headers = { 'as-api-key': apiKey };
  return {
    id: 'aftership',
    name: 'AfterShip',
    async track(shipment) {
      const state = { ...shipment.providerState };
      let t;
      if (state.aftershipId) {
        t = unwrap(await requestJson(`${BASE}/trackings/${state.aftershipId}`, { headers }));
      } else {
        try {
          t = unwrap(await requestJson(`${BASE}/trackings`, {
            method: 'POST', headers, body: { tracking_number: shipment.trackingNumber },
          }));
        } catch (err) {
          // Already exists → look it up by number.
          if (err.status !== 400 && err.status !== 409 && err.status !== 4003) throw err;
          const list = await requestJson(`${BASE}/trackings?tracking_numbers=${encodeURIComponent(shipment.trackingNumber)}`, { headers });
          t = list?.data?.trackings?.[0] || {};
        }
        if (t.id) state.aftershipId = t.id;
      }
      const events = sortEvents((t.checkpoints || []).map((c) => ({
        time: iso(c.checkpoint_time),
        description: c.message || c.subtag_message,
        location: c.location || [c.city, c.state, c.country_region || c.country_iso3].filter(Boolean).join(', ') || null,
        status: TAGS[c.tag] || null,
      })));
      const eta = t.courier_estimated_delivery_date?.estimated_delivery_date
        || t.aftership_estimated_delivery_date?.estimated_delivery_date
        || t.expected_delivery;
      return {
        status: TAGS[t.tag] || (events.length ? 'in_transit' : 'not_found'),
        statusText: t.subtag_message || events[0]?.description || null,
        eta: iso(eta),
        events,
        providerState: state,
      };
    },
  };
}
