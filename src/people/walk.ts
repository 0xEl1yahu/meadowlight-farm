/**
 * The walk (farmclaws part 4d spec §4.2, §4.3, §4.7): once a game minute, after the robots, every
 * walker comes out of their door or exit, takes one step towards their current leg's target on
 * the live map, steps in at home, or turns to their stop's facing. Pure. No path is saved: a
 * walker re-plans every step, so anything placed in the way is routed round at once.
 *
 * Walkers never block each other, so the order they're taken in never changes the outcome. Each
 * walker's world is `state.maps[place.mapId]`.
 */
import { WALK } from '../config';
import {
  DIRECTIONS,
  Direction,
  NPC_IDS,
  TOWNSFOLK_IDS,
  type GameState,
  type MapId,
  type NpcId,
  type TileCoord,
  type TownsfolkId,
  type WalkerId,
  type WalkerPlace,
  type WorldState,
} from '../core/types';
import { isStanding } from '../robots/world';
import { weatherWaters } from '../time/weather';
import { stepTile } from '../world/grid';
import { getMap } from '../world/maps';
import { findPath } from '../world/path';
import { forEachTile, isWalkable } from '../world/tiles';
import { homeFront, targetOf } from './timetable';

const INDOORS: WalkerPlace = { kind: 'indoors' };

/** Every walker, in the order the walk takes them: the characters, then the townsfolk. */
const WALKER_IDS: readonly WalkerId[] = [...NPC_IDS, ...TOWNSFOLK_IDS];

function isTownsfolk(id: WalkerId): id is TownsfolkId {
  return (TOWNSFOLK_IDS as readonly string[]).includes(id);
}

/** A walker's out place: on a map, at a tile, facing one way. */
type OutPlace = Extract<WalkerPlace, { readonly kind: 'out' }>;

/**
 * What's on the maps this minute that a walker can't walk into: the player's tile, and the
 * tiles robots stand on (by map, keyed `tz * width + tx`, and as a key for remembered plans).
 */
interface Obstacles {
  readonly player: { readonly mapId: MapId; readonly tx: number; readonly tz: number };
  readonly robots: ReadonlyMap<MapId, ReadonlySet<number>>;
  readonly robotsKey: ReadonlyMap<MapId, string>;
}

function obstaclesOf(state: GameState): Obstacles {
  const robots = new Map<MapId, Set<number>>();
  for (const robot of state.robots.list) {
    if (!isStanding(robot)) continue;
    const tiles = robots.get(robot.mapId) ?? new Set<number>();
    tiles.add(robot.tz * state.maps[robot.mapId].grid.width + robot.tx);
    robots.set(robot.mapId, tiles);
  }
  const robotsKey = new Map<MapId, string>();
  for (const [mapId, tiles] of robots) robotsKey.set(mapId, [...tiles].sort((a, b) => a - b).join(','));
  const { mapId, tx, tz } = state.player;
  return { player: { mapId, tx, tz }, robots, robotsKey };
}

/**
 * Each world's walkable tiles, keyed `tz * width + tx`: 1 walkable, 0 not. A world is immutable,
 * so its mask never goes stale; a changed map is a new world with a mask of its own. Every step
 * of every search reads it, so it is worked out once per world.
 */
const walkableMasks = new WeakMap<WorldState, Uint8Array>();

function walkableMask(world: WorldState): Uint8Array {
  const known = walkableMasks.get(world);
  if (known !== undefined) return known;
  const mask = new Uint8Array(world.grid.width * world.grid.depth);
  forEachTile(world, (tile, tx, tz) => {
    if (isWalkable(tile)) mask[tz * world.grid.width + tx] = 1;
  });
  walkableMasks.set(world, mask);
  return mask;
}

/**
 * Whether a walker can enter `tile` of `mapId` (spec §4.3): it is walkable and no robot stands on
 * it; nor, unless `ignorePlayer`, the player.
 */
function canEnter(state: GameState, obstacles: Obstacles, mapId: MapId, tile: TileCoord, ignorePlayer: boolean): boolean {
  const world = state.maps[mapId];
  const { width, depth } = world.grid;
  if (tile.tx < 0 || tile.tz < 0 || tile.tx >= width || tile.tz >= depth) return false;
  const index = tile.tz * width + tile.tx;
  if (walkableMask(world)[index] !== 1) return false;
  if (obstacles.robots.get(mapId)?.has(index) === true) return false;
  const { player } = obstacles;
  return ignorePlayer || player.mapId !== mapId || player.tx !== tile.tx || player.tz !== tile.tz;
}

/** One minute's move towards a tile: a step to take, a wait for the player to move, or stuck. */
type Move = { readonly kind: 'step'; readonly to: TileCoord } | { readonly kind: 'wait' } | { readonly kind: 'stuck' };

/**
 * Moves already planned, per world. A plan is a pure function of the world, the tiles blocked on
 * it and its two ends, so a remembered plan is exactly the plan the search would make again:
 * remembering never changes a walk, it only spares the search on the routes walked every day.
 */
const plannedMoves = new WeakMap<WorldState, Map<string, Move>>();

/** `planMove`, remembered per world under its ends and what blocks the map (WALK.plansPerWorld at most). */
function rememberedMove(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): Move {
  const world = state.maps[mapId];
  const { player } = obstacles;
  const playerAt = player.mapId === mapId ? `${player.tx},${player.tz}` : '';
  const key = `${from.tx},${from.tz}>${to.tx},${to.tz}|${playerAt}|${obstacles.robotsKey.get(mapId) ?? ''}`;
  let plans = plannedMoves.get(world);
  const known = plans?.get(key);
  if (known !== undefined) return known;
  if (plans === undefined || plans.size >= WALK.plansPerWorld) {
    plans = new Map<string, Move>();
    plannedMoves.set(world, plans);
  }
  const move = planMove(state, obstacles, mapId, from, to);
  plans.set(key, move);
  return move;
}

/**
 * The two plans of spec §4.3 from `from` to `to` on `mapId`: first with the player's tile
 * blocked, taking that route's first step; then, if there's none, ignoring the player, where the
 * player is the only thing in the way. That route's first step is taken too, up to the player:
 * only a step onto the player's tile waits.
 */
function planMove(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): Move {
  const { grid } = state.maps[mapId];
  const first = findPath(grid, from, to, (_, next) => canEnter(state, obstacles, mapId, next, false))?.[0];
  if (first !== undefined) return { kind: 'step', to: first };
  // Without the player on this map the second plan is the first one again.
  const { player } = obstacles;
  if (player.mapId !== mapId) return { kind: 'stuck' };
  const around = findPath(grid, from, to, (_, next) => canEnter(state, obstacles, mapId, next, true));
  if (around === null) return { kind: 'stuck' };
  const next = around[0];
  if (next === undefined || (next.tx === player.tx && next.tz === player.tz)) return { kind: 'wait' };
  return { kind: 'step', to: next };
}

/** The way from a tile to the adjacent tile `to`. */
function directionTo(from: TileCoord, to: TileCoord): Direction {
  const way = DIRECTIONS.find((d) => {
    const next = stepTile(from, d);
    return next.tx === to.tx && next.tz === to.tz;
  });
  if (way === undefined) throw new RangeError(`directionTo: (${to.tx}, ${to.tz}) is not next to (${from.tx}, ${from.tz})`);
  return way;
}

/**
 * One step towards `tile` of `mapId` (spec §4.3), turning to face it. When the target is on the
 * other map, the route goes to the gate tile that leads there, and from the gate tile the step
 * goes through the warp to the other side's arrival tile, facing the warp's way. Waiting and being
 * stuck both stay put.
 */
function stepTowards(state: GameState, obstacles: Obstacles, place: OutPlace, mapId: MapId, tile: TileCoord): WalkerPlace {
  let to = tile;
  if (mapId !== place.mapId) {
    const warp = getMap(place.mapId).warps.find((w) => w.to.mapId === mapId);
    // The timetables' startup check makes sure every walker's other map has a gate from home.
    if (warp === undefined) return place;
    if (place.tx === warp.from.tx && place.tz === warp.from.tz) {
      const arrival = { tx: warp.to.tx, tz: warp.to.tz };
      if (!canEnter(state, obstacles, warp.to.mapId, arrival, false)) return place;
      return { kind: 'out', mapId: warp.to.mapId, tx: arrival.tx, tz: arrival.tz, facing: warp.to.facing };
    }
    to = warp.from;
  }
  const from = { tx: place.tx, tz: place.tz };
  const move = rememberedMove(state, obstacles, place.mapId, from, to);
  if (move.kind !== 'step') return place;
  return { kind: 'out', mapId: place.mapId, tx: move.to.tx, tz: move.to.tz, facing: directionTo(from, move.to) };
}

/** Where `id` is after this minute (spec §4.2), from `place`; `place` itself when they don't move or turn. */
function stepWalker(state: GameState, obstacles: Obstacles, id: WalkerId, place: WalkerPlace, wet: boolean): WalkerPlace {
  const target = targetOf(id, state.time.minuteOfDay, wet);
  if (place.kind === 'indoors') {
    if (target === 'home') return place;
    // Out of the door onto its front, facing South; or in by the exit, facing North into town.
    const front = homeFront(id);
    if (!canEnter(state, obstacles, front.mapId, front.tile, false)) return place;
    const facing = isTownsfolk(id) ? Direction.North : Direction.South;
    return { kind: 'out', mapId: front.mapId, tx: front.tile.tx, tz: front.tile.tz, facing };
  }
  const goal = target === 'home' ? { ...homeFront(id), facing: null } : target;
  if (place.mapId === goal.mapId && place.tx === goal.tile.tx && place.tz === goal.tile.tz) {
    if (target === 'home') return INDOORS;
    return goal.facing === null || goal.facing === place.facing ? place : { ...place, facing: goal.facing };
  }
  return stepTowards(state, obstacles, place, goal.mapId, goal.tile);
}

function samePlace(a: WalkerPlace, b: WalkerPlace): boolean {
  if (a === b) return true;
  if (a.kind === 'indoors' || b.kind === 'indoors') return a.kind === b.kind;
  return a.mapId === b.mapId && a.tx === b.tx && a.tz === b.tz && a.facing === b.facing;
}

/** Where `id` is: a character's place in `npcs`, a townsperson's in `townsfolk`. */
export function walkerPlace(state: GameState, id: WalkerId): WalkerPlace {
  return isTownsfolk(id) ? state.townsfolk[id].place : state.npcs[id].place;
}

/** `state` with `id`'s place replaced; `state` itself when the place is the same. */
export function withWalkerPlace(state: GameState, id: WalkerId, place: WalkerPlace): GameState {
  if (samePlace(walkerPlace(state, id), place)) return state;
  if (isTownsfolk(id)) return { ...state, townsfolk: { ...state.townsfolk, [id]: { place } } };
  const npc: NpcId = id;
  return { ...state, npcs: { ...state.npcs, [npc]: { ...state.npcs[npc], place } } };
}

/**
 * One game minute of walking (spec §4.2): every walker, characters then townsfolk, against the
 * state after this minute's robots (`state.time.minuteOfDay` is the minute). A walker who doesn't
 * move or turn keeps their place, and a minute where nobody does returns `state`.
 */
export function runWalkersMinute(state: GameState): GameState {
  const wet = weatherWaters(state.weather);
  const obstacles = obstaclesOf(state);
  let next = state;
  for (const id of WALKER_IDS) {
    const place = walkerPlace(state, id);
    next = withWalkerPlace(next, id, stepWalker(state, obstacles, id, place, wet));
  }
  return next;
}

/** The morning (spec §4.7): every walker indoors, so nobody's day carries over; `state` itself when they all are. */
export function walkersIndoors(state: GameState): GameState {
  let next = state;
  for (const id of WALKER_IDS) next = withWalkerPlace(next, id, INDOORS);
  return next;
}
