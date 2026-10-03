/**
 * The zone marker's HUD chip (farmclaws part 3 spec §8): the letter the marker paints, that
 * zone's size, and whether a first corner is down. Pure, so it is tested without a DOM.
 */
import type { GameState } from '../core/types';
import { isZoneMarkerSelected } from '../state/selectors';

/** "Zone A · 3×3" or "Zone A · not set", plus " · corner set" during a draft; null unless the marker is selected. */
export function zoneChipText(state: GameState): string | null {
  if (!isZoneMarkerSelected(state)) return null;
  const letter = state.ui.zoneLetter;
  const rect = state.robots.zones[letter];
  const size = rect === null ? 'not set' : `${rect.w}×${rect.d}`;
  return `Zone ${letter} · ${size}${state.ui.zoneDraft === null ? '' : ' · corner set'}`;
}
