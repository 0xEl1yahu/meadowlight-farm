/**
 * Pure render rules for walkers (farmclaws part 4a spec §2.3, part 4d spec §4.6): who gets a model
 * on the active map, whether a new place glides or snaps, how walkers sharing a tile spread, where
 * the dog and the cart sit, the idle sway and whose nameplate shows. WalkerRenderer applies them.
 *
 * - A walker glides only when their new tile is next to their last one on the same map. A map
 *   change, coming out of a door or exit, a first showing, or a jump of several tiles in one store
 *   update (a big tick at a high time scale) snaps.
 * - A glide lasts as long as a robot's lerp would if the robot stepped every minute, as walkers do
 *   (robotLayout.glideSeconds), so it lands before the next step at every time scale.
 * - Walkers sharing a tile use the robots' sharedTileOffsets, in walker order.
 */
import { NPC_LOOKS } from '../config';
import type { GameState, GridSpec, MapId, WalkerId, WalkerPlace } from '../core/types';
import { WALKER_IDS, walkerAt, walkerPlace } from '../people/walk';
import { selectIsFrozen, selectTargetTile } from '../state/selectors';
import { manhattanDistance, tileCenterX, tileCenterZ } from '../world/grid';
import { glideSeconds, sharedTileOffsets } from './robotLayout';

/** A walker's out place: on a map, at a tile, facing one way. */
export type OutPlace = Extract<WalkerPlace, { readonly kind: 'out' }>;

/** A walker drawn on the active map. */
export interface ShownWalker {
  readonly id: WalkerId;
  readonly place: OutPlace;
  /** Position in WALKER_IDS: the sway's phase. */
  readonly index: number;
}

/** Walkers step once every this many game minutes (part 4d spec §4.2). */
const STEP_MINUTES = 1;

/** The walkers out on `mapId`, characters then townsfolk. A walker indoors or on another map gets no model. */
export function shownWalkers(state: GameState, mapId: MapId): readonly ShownWalker[] {
  const shown: ShownWalker[] = [];
  WALKER_IDS.forEach((id, index) => {
    const place = walkerPlace(state, id);
    if (place.kind === 'out' && place.mapId === mapId) shown.push({ id, place, index });
  });
  return shown;
}

/** How long a walker's glide to the next tile lasts at `timeScale` (real seconds). */
export function walkerGlideSeconds(timeScale: number): number {
  return glideSeconds(STEP_MINUTES, timeScale);
}

/** Where a walker's model heads: the tile centre (x, z), gliding over `seconds`, or snapping there when `seconds` is 0. */
export interface WalkerMotion {
  readonly x: number;
  readonly z: number;
  readonly seconds: number;
}

/**
 * How a walker's model gets from `from`, the place it was last drawn at (undefined when it wasn't
 * shown), to `to` on `grid`: a glide to an adjacent tile on the same map, a snap for anything else,
 * or null when the tile is unchanged (only the facing turned).
 */
export function walkerMotion(grid: GridSpec, from: WalkerPlace | undefined, to: OutPlace, timeScale: number): WalkerMotion | null {
  const sameMap = from !== undefined && from.kind === 'out' && from.mapId === to.mapId;
  const steps = sameMap ? manhattanDistance(from, to) : -1;
  if (steps === 0) return null;
  return { x: tileCenterX(grid, to.tx), z: tileCenterZ(grid, to.tz), seconds: steps === 1 ? walkerGlideSeconds(timeScale) : 0 };
}

/** Sideways offset per shown walker: walkers sharing a tile spread like robots, in walker order. */
export function walkerOffsets(shown: readonly ShownWalker[]): ReadonlyMap<WalkerId, number> {
  return sharedTileOffsets(shown.map(({ id, place }) => ({ id, tx: place.tx, tz: place.tz })));
}

/** Things drawn on the ground beside a townsperson: never on a tile, never in the way, never saved (spec §3.1, §4.6). */
export const GROUND_PROPS = ['dog', 'cart', 'hat'] as const;
export type GroundProp = (typeof GROUND_PROPS)[number];

/**
 * Who has a ground prop and how far ahead of them it sits along their facing, in tiles: the dog one
 * tile behind the dog walker, the cart one tile in front of the courier, the busker's hat at his side
 * (buildGroundHat lays it there, clear of the well he faces).
 */
export const WALKER_GROUND_PROPS: Readonly<Partial<Record<WalkerId, { readonly prop: GroundProp; readonly ahead: number }>>> = {
  dogWalker: { prop: 'dog', ahead: -1 },
  courier: { prop: 'cart', ahead: 1 },
  busker: { prop: 'hat', ahead: 0 },
};

/**
 * A walker's idle lean (radians, positive toward its right) `elapsedSeconds` into the sway:
 * NPC_LOOKS.swayDegrees each way over NPC_LOOKS.swaySeconds, its phase set by the walker's
 * WALKER_IDS index so neighbours never sway in step.
 */
export function swayAngle(elapsedSeconds: number, walkerIndex: number): number {
  const turns = elapsedSeconds / NPC_LOOKS.swaySeconds + walkerIndex / WALKER_IDS.length;
  return ((NPC_LOOKS.swayDegrees * Math.PI) / 180) * Math.sin(2 * Math.PI * turns);
}

/** The walker on the tile ahead of the player, whose nameplate shows; null while the game is frozen. */
export function nameplateFor(state: GameState): WalkerId | null {
  if (selectIsFrozen(state)) return null;
  const target = selectTargetTile(state);
  return target === null ? null : walkerAt(state, state.player.mapId, target.tx, target.tz);
}
