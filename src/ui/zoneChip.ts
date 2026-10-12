/**
 * The zone marker's HUD chip (farmclaws part 3 spec §8): the letter the marker paints, that
 * zone's size, and whether a first corner is down. A zone on another map than the player's reads
 * as not set (part 4c spec §5.3). Pure, so it is tested without a DOM.
 */
import type { GameState } from '../core/types';
import { zoneOnMap } from '../robots/zones';
import { isZoneMarkerSelected, selectActiveRobotMapId } from '../state/selectors';

/** "Zone A · 3×3" or "Zone A · not set", plus " · corner set" during a draft; null unless the marker is selected. */
export function zoneChipText(state: GameState): string | null {
  if (!isZoneMarkerSelected(state)) return null;
  const letter = state.ui.zoneLetter;
  const mapId = selectActiveRobotMapId(state);
  const rect = mapId === null ? null : zoneOnMap(state.robots.zones[letter], mapId);
  const size = rect === null ? 'not set' : `${rect.w}×${rect.d}`;
  return `Zone ${letter} · ${size}${state.ui.zoneDraft === null ? '' : ' · corner set'}`;
}
