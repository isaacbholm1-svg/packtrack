// Ship24 — https://www.ship24.com/tracking-api (1,500+ carriers, free tier available).
// "Create tracker and get results" is idempotent, so we call it every refresh.

import { requestJson, iso, sortEvents } from './http.js';

const URL_TRACK = 'https://api.ship24.com/public/v1/trackers/track';

const MILESTONES = {
  pending: 'not_found',
  info_received: 'info_received',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  failed_attempt: 'failed_attempt',
  available_for_pickup: 'available_for_pickup',
  delivered: 'delivered',
  exception: 'exception',
};

export function createShip24(apiKey) {
  return {
    id: 'ship24',
    name: 'Ship24',
    async track(shipment) {
      const res = await requestJson(URL_TRACK, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { trackingNumber: shipment.trackingNumber },
      });
      const t = res?.data?.trackings?.[0] || {};
      const events = sortEvents((t.events || []).map((e) => ({
        time: iso(e.occurrenceDatetime || e.datetime),
        description: e.status,
        location: e.location || null,
        status: MILESTONES[e.statusMilestone] || null,
      })));
      const milestone = t.shipment?.statusMilestone;
      return {
        status: MILESTONES[milestone] || (events.length ? 'in_transit' : 'not_found'),
        statusText: events[0]?.description || null,
        eta: iso(t.shipment?.delivery?.estimatedDeliveryDate),
        events,
      };
    },
  };
}
