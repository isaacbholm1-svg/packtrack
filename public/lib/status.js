// Normalised shipment statuses shared by every provider and the UI.

export const STATUSES = {
  awaiting_tracking: { label: 'Awaiting tracking number', active: true },
  pending: { label: 'Not checked yet', active: true },
  not_found: { label: 'Not found yet', active: true },
  info_received: { label: 'Label created', active: true },
  in_transit: { label: 'In transit', active: true },
  out_for_delivery: { label: 'Out for delivery', active: true },
  available_for_pickup: { label: 'Ready for pickup', active: true },
  failed_attempt: { label: 'Delivery attempt failed', active: true },
  exception: { label: 'Problem / exception', active: true },
  delivered: { label: 'Delivered', active: false },
  expired: { label: 'Tracking expired', active: false },
  unknown: { label: 'Unknown', active: true },
};

export function isActive(shipment) {
  return !shipment.archived && (STATUSES[shipment.status]?.active ?? true);
}
