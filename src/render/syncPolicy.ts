/**
 * How main.ts fans one store change out to the scene, the render systems and the HUD.
 *
 * - A `game/load` replaces the whole state: every system and the HUD rebuild from scratch
 *   (`prev = null`), the scene switches to the loaded map's grid and the camera snaps.
 * - A map change (the player's `mapId` differs) is a full rebuild for the render systems, which
 *   only ever diff the active map's world, and switches the scene grid. The HUD keeps `prev`,
 *   so toasts, the day wipe and the gold tween carry on across the warp.
 * - A new `teleportSeq` (sleep, a warp, a load) snaps the camera instead of easing it across
 *   the world.
 *
 * Pure: it reads only the two states and the action type.
 */
import type { GameState } from '../core/types';
import type { GameAction } from '../state/actions';
import { selectActiveMapId } from '../state/selectors';

export interface SyncPlan {
  /** `'null'` asks every render system for a full rebuild; `'prev'` lets it diff. */
  readonly systemsPrev: 'null' | 'prev';
  /** `'null'` rebuilds the HUD; `'prev'` lets it diff (it keeps `prev` across map changes). */
  readonly hudPrev: 'null' | 'prev';
  /** Switch the scene (and the camera bounds) to the active map's grid before syncing. */
  readonly setGrid: boolean;
  /** Jump the camera to the player after syncing instead of easing there. */
  readonly snapCamera: boolean;
}

export function classifySync(state: GameState, prev: GameState, action: Pick<GameAction, 'type'>): SyncPlan {
  const load = action.type === 'game/load';
  const mapChanged = selectActiveMapId(state) !== selectActiveMapId(prev);
  const rebuild = load || mapChanged;
  return {
    systemsPrev: rebuild ? 'null' : 'prev',
    hudPrev: load ? 'null' : 'prev',
    setGrid: rebuild,
    snapCamera: load || state.player.teleportSeq !== prev.player.teleportSeq,
  };
}
