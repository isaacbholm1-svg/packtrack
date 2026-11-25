import { getSettings } from '../settings.js';
import { createSeventeenTrack } from './seventeentrack.js';
import { createShip24 } from './ship24.js';
import { createAfterShip } from './aftership.js';
import mock from './mock.js';

// Returns the active provider, or null if live tracking isn't configured.
export function getProvider() {
  const s = getSettings();
  const wanted = s.provider || 'auto';
  const make = {
    '17track': () => s.seventeenTrackKey && createSeventeenTrack(s.seventeenTrackKey),
    ship24: () => s.ship24Key && createShip24(s.ship24Key),
    aftership: () => s.aftershipKey && createAfterShip(s.aftershipKey),
    mock: () => mock,
  };
  if (wanted === 'none') return null;
  if (wanted !== 'auto') return make[wanted]?.() || null;
  return make['17track']() || make.ship24() || make.aftership() || null;
}
