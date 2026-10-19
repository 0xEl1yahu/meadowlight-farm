/**
 * The walk (farmclaws part 4d spec §4.2, §4.3, §4.7): once a game minute, after the robots, every
 * walker comes out of their door or exit, takes one step towards their current leg's target on
 * the live map, steps in at home, or turns to their stop's facing. Pure. No path is saved: a
 * walker re-plans every step, so anything placed in the way is routed round at once. The world
 * finds walkers by their saved places (`walkerAt`), asks the same plans whether one is stuck
 * (`isStuck`, spec §4.4), and moves them off a job's generator tile (`nudgeWalkersOff`, §4.5).
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
import { freeSpotNear } from '../robots/workbench';
import { isStanding } from '../robots/world';
import { weatherWaters } from '../time/weather';
import { manhattanDistance, stepTile } from '../world/grid';
import { getMap } from '../world/maps';
import { findPath, searchFrom } from '../world/path';
import { forEachTile, isWalkable } from '../world/tiles';
import { homeFront, targetOf, type Target } from './timetable';

const INDOORS: WalkerPlace = { kind: 'indoors' };

/** Every walker, in the order the walk takes them: the characters, then the townsfolk. */
const WALKER_IDS: readonly WalkerId[] = [...NPC_IDS, ...TOWNSFOLK_IDS];

/** Whether `id` is one of the townsfolk rather than a character. */
export function isTownsfolk(id: WalkerId): id is TownsfolkId {
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

/**
 * One minute's move: a step to an adjacent tile, a crossing through a gate onto the other map, or
 * staying put (waiting for the player, or with nowhere nearer to go).
 */
type Move = { readonly kind: 'step'; readonly to: TileCoord } | { readonly kind: 'cross'; readonly to: OutPlace } | { readonly kind: 'stay' };

/**
 * A minute's plan: the move, and whether the walker is stuck (spec §4.4), their target out of
 * reach even ignoring the player.
 */
interface Plan {
  readonly move: Move;
  readonly stuck: boolean;
}

const STAY: Move = { kind: 'stay' };

/**
 * Plans already made, per world. A plan is a pure function of the world, the tiles blocked on it
 * and its two ends, so a remembered plan is exactly the plan the search would make again:
 * remembering never changes a walk, it only spares the search on the routes walked every day.
 */
const plannedMoves = new WeakMap<WorldState, Map<string, Plan>>();

/** `planMove`, remembered per world under its ends and what blocks the map (WALK.plansPerWorld at most). */
function rememberedMove(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): Plan {
  const world = state.maps[mapId];
  const { player } = obstacles;
  const playerAt = player.mapId === mapId ? `${player.tx},${player.tz}` : '';
  const key = `${from.tx},${from.tz}>${to.tx},${to.tz}|${playerAt}|${obstacles.robotsKey.get(mapId) ?? ''}`;
  let plans = plannedMoves.get(world);
  const known = plans?.get(key);
  if (known !== undefined) return known;
  if (plans === undefined || plans.size >= WALK.plansPerWorld) {
    plans = new Map<string, Plan>();
    plannedMoves.set(world, plans);
  }
  const plan = planMove(state, obstacles, mapId, from, to);
  plans.set(key, plan);
  return plan;
}

/**
 * The two plans of spec §4.3 from `from` to `to` on `mapId`: first with the player's tile
 * blocked, taking that route's first step; then, if there's none, ignoring the player, where the
 * player is the only thing in the way. That route's first step is taken too, up to the player:
 * only a step onto the player's tile waits. Null when there's no route even ignoring the player.
 */
function routeStep(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): Move | null {
  const { grid } = state.maps[mapId];
  const first = findPath(grid, from, to, (_, next) => canEnter(state, obstacles, mapId, next, false))?.[0];
  if (first !== undefined) return { kind: 'step', to: first };
  // Without the player on this map the second plan is the first one again.
  const { player } = obstacles;
  if (player.mapId !== mapId) return null;
  const around = findPath(grid, from, to, (_, next) => canEnter(state, obstacles, mapId, next, true));
  if (around === null) return null;
  const next = around[0];
  if (next === undefined || (next.tx === player.tx && next.tz === player.tz)) return STAY;
  return { kind: 'step', to: next };
}

/**
 * The tile reachable from `from` on `mapId`, ignoring the player, with the fewest Manhattan steps
 * to `to`; ties go to the first the breadth-first search visits, so `from` itself wins any tie and
 * a walker who has arrived stays there.
 */
function nearestReachable(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): TileCoord {
  const { order } = searchFrom(state.maps[mapId].grid, from, (_, next) => canEnter(state, obstacles, mapId, next, true));
  let nearest = from;
  let best = manhattanDistance(from, to);
  for (const { tile } of order) {
    const distance = manhattanDistance(tile, to);
    if (distance < best) {
      nearest = tile;
      best = distance;
    }
  }
  return nearest;
}

/**
 * This minute's plan from `from` towards `to` on `mapId` (spec §4.3). With a route, even one only
 * the player is in the way of, the walker follows it. Without one they're stuck: they head for
 * the reachable tile nearest `to` by the same two plans and stay there, so a walker blocked from
 * their stop waits as close to it as they can get, and never paces back and forth.
 */
function planMove(state: GameState, obstacles: Obstacles, mapId: MapId, from: TileCoord, to: TileCoord): Plan {
  const routed = routeStep(state, obstacles, mapId, from, to);
  if (routed !== null) return { move: routed, stuck: false };
  const nearest = nearestReachable(state, obstacles, mapId, from, to);
  if (nearest.tx === from.tx && nearest.tz === from.tz) return { move: STAY, stuck: true };
  return { move: routeStep(state, obstacles, mapId, from, nearest) ?? STAY, stuck: true };
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
 * This minute's plan from `place` towards `tile` of `mapId` (spec §4.3). When the target is on the
 * other map, the route goes to the gate tile that leads there, and from the gate tile the move
 * goes through the warp to the other side's arrival tile, facing the warp's way: a wait while only
 * the player stands on it, stuck while anything else does.
 */
function moveTowards(state: GameState, obstacles: Obstacles, place: OutPlace, mapId: MapId, tile: TileCoord): Plan {
  let to = tile;
  if (mapId !== place.mapId) {
    const warp = getMap(place.mapId).warps.find((w) => w.to.mapId === mapId);
    // The timetables' startup check makes sure every walker's other map has a gate from home.
    if (warp === undefined) return { move: STAY, stuck: true };
    if (place.tx === warp.from.tx && place.tz === warp.from.tz) {
      const arrival = { tx: warp.to.tx, tz: warp.to.tz };
      if (canEnter(state, obstacles, warp.to.mapId, arrival, false)) {
        const across: OutPlace = { kind: 'out', mapId: warp.to.mapId, tx: arrival.tx, tz: arrival.tz, facing: warp.to.facing };
        return { move: { kind: 'cross', to: across }, stuck: false };
      }
      return { move: STAY, stuck: !canEnter(state, obstacles, warp.to.mapId, arrival, true) };
    }
    to = warp.from;
  }
  return rememberedMove(state, obstacles, place.mapId, { tx: place.tx, tz: place.tz }, to);
}

/** The tile `id` walks to for `target` (spec §4.2): the target's tile, or their home front for `home`. */
function goalOf(id: WalkerId, target: Target): { readonly mapId: MapId; readonly tile: TileCoord; readonly facing: Direction | null } {
  return target === 'home' ? { ...homeFront(id), facing: null } : target;
}

/** Whether `place` is on `tile` of `mapId`. */
function isAt(place: OutPlace, mapId: MapId, tile: TileCoord): boolean {
  return place.mapId === mapId && place.tx === tile.tx && place.tz === tile.tz;
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
  const goal = goalOf(id, target);
  if (isAt(place, goal.mapId, goal.tile)) {
    if (target === 'home') return INDOORS;
    return goal.facing === null || goal.facing === place.facing ? place : { ...place, facing: goal.facing };
  }
  const { move } = moveTowards(state, obstacles, place, goal.mapId, goal.tile);
  if (move.kind === 'cross') return move.to;
  if (move.kind === 'stay') return place;
  const from = { tx: place.tx, tz: place.tz };
  return { kind: 'out', mapId: place.mapId, tx: move.to.tx, tz: move.to.tz, facing: directionTo(from, move.to) };
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

/**
 * The walker on (tx, tz) of `mapId` (spec §4.1), reading the saved places, or null. When walkers
 * share the tile it's the first in the walk's order: the characters, then the townsfolk.
 */
export function walkerAt(state: GameState, mapId: MapId, tx: number, tz: number): WalkerId | null {
  for (const id of WALKER_IDS) {
    const place = walkerPlace(state, id);
    if (place.kind === 'out' && isAt(place, mapId, { tx, tz })) return id;
  }
  return null;
}

/**
 * Whether `id` is stuck (spec §4.4): out, not at their target, and with no route to it even
 * ignoring the player, whether still heading for the nearest tile they can reach or standing on
 * it. The same plan as their step (spec §4.3), so the chat and the walk agree. A walker waiting
 * for the player isn't stuck. Worked out when the chat opens; nothing is saved.
 */
export function isStuck(state: GameState, id: WalkerId): boolean {
  const place = walkerPlace(state, id);
  if (place.kind === 'indoors') return false;
  const goal = goalOf(id, targetOf(id, state.time.minuteOfDay, weatherWaters(state.weather)));
  if (isAt(place, goal.mapId, goal.tile)) return false;
  return moveTowards(state, obstaclesOf(state), place, goal.mapId, goal.tile).stuck;
}

/**
 * `state` with every walker standing on `tile` of `mapId` moved to the nearest free walkable tile
 * (spec §4.5): the same search as the save migration's (`freeSpotNear`), never onto `tile`, the
 * player, a standing robot or another walker. Called before a job's generator goes on `tile`, so a
 * saved place is never inside one. `state` itself when nobody stands there.
 */
export function nudgeWalkersOff(state: GameState, mapId: MapId, tile: TileCoord): GameState {
  const taken: TileCoord[] = [tile];
  if (state.player.mapId === mapId) taken.push(state.player);
  for (const robot of state.robots.list) if (robot.mapId === mapId && isStanding(robot)) taken.push(robot);
  for (const id of WALKER_IDS) {
    const place = walkerPlace(state, id);
    if (place.kind === 'out' && place.mapId === mapId) taken.push(place);
  }
  let next = state;
  for (const id of WALKER_IDS) {
    const place = walkerPlace(next, id);
    if (place.kind !== 'out' || !isAt(place, mapId, tile)) continue;
    const spot = freeSpotNear(next.maps[mapId], tile, taken, mapId);
    taken.push(spot);
    next = withWalkerPlace(next, id, { ...place, tx: spot.tx, tz: spot.tz });
  }
  return next;
}
