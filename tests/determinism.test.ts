/**
 * End-to-end determinism and purity.
 *
 * A long pseudo-random session (moves, tools, slot changes, ticks, sleeps, shop visits,
 * pauses) is generated with mulberry32 and played twice through a freezing store with an
 * action recorder. Both runs must end in identical states, replaying the recorded log must
 * reproduce that state, the deep-frozen states must never be mutated, and every transition
 * must honour the render contract (unchanged chunks and tiles keep their identity) on every
 * map. A second, state-aware "traveller" session keeps walking to the gates, so warps between
 * every map are replayed and checked the same way. Also covers the seeded hash primitives everything stochastic is built on.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TIME } from '../src/config';
import { hash32, hashFloat, hashRange, mulberry32, Salt } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import {
  CROP_IDS,
  DIRECTIONS,
  MAP_IDS,
  TileState,
  type Direction,
  type GameState,
  type MapId,
  type SlotRef,
  type Tile,
  type TileCoord,
  type WorldState,
} from '../src/core/types';
import { seedItemId } from '../src/farming/crops';
import { npcAt } from '../src/people/cast';
import { actions, type GameAction } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { selectActiveWorld } from '../src/state/selectors';
import { stepTile } from '../src/world/grid';
import { MAPS, type Warp } from '../src/world/maps';
import { countTiles, getTile, isWalkable } from '../src/world/tiles';
import { HEAVY_TEST_TIMEOUT_MS, must } from './testUtils';

function pick<T>(rng: () => number, values: readonly T[]): T {
  return must(values[Math.floor(rng() * values.length)]);
}

/** One action of a plausible, busy play session: mostly walking and tool use, with days passing. */
function randomAction(rng: () => number): GameAction {
  const roll = rng();
  if (roll < 0.34) return actions.move(pick(rng, DIRECTIONS));
  if (roll < 0.38) return actions.face(pick(rng, DIRECTIONS));
  if (roll < 0.6) return actions.useTool();
  if (roll < 0.68) return actions.interact();
  if (roll < 0.75) return actions.selectSlot(Math.floor(rng() * (INVENTORY.hotbarSize + 2)) - 1);
  if (roll < 0.78) return actions.cycleSlot(pick(rng, [-1, 1, 3, -13]));
  if (roll < 0.87) return actions.tick(1 + Math.floor(rng() * 60));
  if (roll < 0.885) return actions.sleep();
  if (roll < 0.905) return actions.setShopOpen(rng() < 0.6);
  if (roll < 0.93) return actions.buy(seedItemId(pick(rng, CROP_IDS)), 1 + Math.floor(rng() * 5));
  if (roll < 0.945) return actions.setPaused(rng() < 0.4);
  if (roll < 0.955) return actions.setTimeScale(pick(rng, [1, 2, 3, 4, 8, 16]));
  return actions.tick(TIME.maxTickMinutes);
}

/**
 * `randomAction` plus the backpack: opening the inventory screen, closing panels, and hotbar ↔
 * backpack moves (including locked and out-of-range slots and odd quantities).
 */
function randomActionWithMoves(rng: () => number): GameAction {
  const roll = rng();
  // Panels freeze the game, so they close more often than they open.
  if (roll < 0.06) return rng() < 0.3 ? actions.setInventoryOpen(true) : actions.closePanel();
  if (roll < 0.3) {
    const from: SlotRef = { container: 'player', index: Math.floor(rng() * 26) - 1 };
    const to: SlotRef = { container: 'player', index: Math.floor(rng() * 26) - 1 };
    return actions.moveItem(from, to, rng() < 0.5 ? null : Math.floor(rng() * 20) - 1);
  }
  return randomAction(rng);
}

/** A random session, fixed up front. Its random walk may reach a gate and warp. */
function randomSession(seed: number, length: number): GameAction[] {
  const rng = mulberry32(seed);
  return Array.from({ length }, () => randomAction(rng));
}

/**
 * Walking distance from every tile of `world` (map `mapId`) to `goal` over walkable tiles where no
 * character stands, as the player walks (-1: unreachable).
 */
function distanceField(world: WorldState, mapId: MapId, goal: TileCoord): Int32Array {
  const { width } = world.grid;
  const dist = new Int32Array(width * world.grid.depth).fill(-1);
  dist[goal.tz * width + goal.tx] = 0;
  const queue: TileCoord[] = [goal];
  for (let head = 0; head < queue.length; head++) {
    const current = must(queue[head]);
    const d = must(dist[current.tz * width + current.tx]);
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      const tile = getTile(world, next.tx, next.tz);
      if (tile === null || !isWalkable(tile) || npcAt(mapId, next.tx, next.tz) !== null || dist[next.tz * width + next.tx] !== -1) continue;
      dist[next.tz * width + next.tx] = d + 1;
      queue.push(next);
    }
  }
  return dist;
}

/** The step that brings `from` one tile closer to the field's goal, or null when the goal is unreachable. */
function stepDown(world: WorldState, dist: Int32Array, from: TileCoord): Direction | null {
  const { width } = world.grid;
  const here = dist[from.tz * width + from.tx] ?? -1;
  if (here <= 0) return null;
  for (const direction of DIRECTIONS) {
    const next = stepTile(from, direction);
    if (getTile(world, next.tx, next.tz) !== null && dist[next.tz * width + next.tx] === here - 1) return direction;
  }
  return null;
}

/**
 * A traveller: like a random session, but most of its actions close any open menu, walk the
 * shortest path to one of the active map's warps and take it, so the session keeps crossing
 * between maps. It looks at the state to pick each action; the recorder captures its choices.
 */
function traveller(seed: number): (state: GameState) => GameAction {
  const rng = mulberry32(seed);
  let goal: { readonly mapId: MapId; readonly warp: Warp } | null = null;
  /** The distance field to the goal, rebuilt whenever the goal or the active world changes. */
  let field: { readonly world: WorldState; readonly warp: Warp; readonly dist: Int32Array } | null = null;
  return (state) => {
    if (rng() >= 0.7) return randomAction(rng);
    // A traveller doesn't wait for menus: it closes them and walks on.
    if (state.ui.paused) return actions.setPaused(false);
    if (state.ui.panel.kind !== 'none') return actions.closePanel();
    const { player } = state;
    if (goal === null || goal.mapId !== player.mapId) goal = { mapId: player.mapId, warp: pick(rng, MAPS[player.mapId].warps) };
    const { warp } = goal;
    if (player.tx === warp.from.tx && player.tz === warp.from.tz) return actions.move(warp.exit);
    const world = selectActiveWorld(state);
    if (field === null || field.world !== world || field.warp !== warp) field = { world, warp, dist: distanceField(world, player.mapId, warp.from) };
    return actions.move(stepDown(world, field.dist, player) ?? pick(rng, DIRECTIONS));
  };
}

function sameTileContent(a: Tile, b: Tile): boolean {
  return a.state === b.state && a.blocker === b.blocker && a.blockerHp === b.blockerHp && JSON.stringify(a.crop) === JSON.stringify(b.crop);
}

/** Violations of the structural-sharing contract between two consecutive states, map by map. */
function sharingViolations(next: GameState, prev: GameState): string[] {
  const problems: string[] = [];
  if (next.maps === prev.maps) return problems;
  for (const id of MAP_IDS) problems.push(...worldSharingViolations(id, next.maps[id], prev.maps[id]));
  return problems;
}

function worldSharingViolations(id: MapId, next: WorldState, prev: WorldState): string[] {
  const problems: string[] = [];
  if (next === prev) return problems;
  if (next.grid !== prev.grid) problems.push(`${id}: grid replaced`);
  if (next.chunks.every((chunk, ci) => chunk === prev.chunks[ci])) problems.push(`${id}: world replaced with no changed chunk`);
  next.chunks.forEach((chunk, ci) => {
    const before = prev.chunks[ci];
    if (before === undefined) {
      problems.push(`${id}: chunk ${ci} appeared`);
      return;
    }
    if (chunk === before) return;
    if (chunk.revision <= before.revision) problems.push(`${id}: chunk ${ci} replaced without a revision bump`);
    let changed = 0;
    chunk.tiles.forEach((tile, i) => {
      const old = before.tiles[i];
      if (old === undefined || tile === old) return;
      changed++;
      if (sameTileContent(tile, old)) problems.push(`${id}: chunk ${ci} tile ${i} replaced by an identical copy`);
    });
    if (changed === 0) problems.push(`${id}: chunk ${ci} replaced with no changed tile`);
  });
  return problems;
}

interface Run {
  readonly state: GameState;
  readonly recorded: readonly GameAction[];
  readonly notifications: number;
  readonly violations: readonly string[];
  readonly maxPlowed: number;
  /** Warps taken: teleports within a day (sleeping and passing out teleport too, but start a new day). */
  readonly warps: number;
  /** Every map the player stood on at some point. */
  readonly visited: ReadonlySet<MapId>;
}

/** Plays a fixed session, or `length` actions chosen by a state-aware policy. */
function play(session: readonly GameAction[] | { readonly policy: (state: GameState) => GameAction; readonly length: number }, freeze: boolean, worldSeed?: number): Run {
  const recorder = createActionRecorder<GameState, GameAction>();
  const store = createStore(gameReducer, createInitialState(worldSeed), { middleware: [recorder.middleware], freeze });
  let notifications = 0;
  let maxPlowed = 0;
  let warps = 0;
  const visited = new Set<MapId>([store.getState().player.mapId]);
  const violations: string[] = [];
  store.subscribe((next, prev) => {
    notifications++;
    if (next === prev) violations.push('notified without a change');
    violations.push(...sharingViolations(next, prev));
    visited.add(next.player.mapId);
    if (next.player.teleportSeq !== prev.player.teleportSeq && next.time.absoluteDay === prev.time.absoluteDay) {
      warps++;
      if (next.player.mapId === prev.player.mapId) violations.push('a warp that stayed on the same map');
      if (next.maps !== prev.maps) violations.push('a warp that changed a world');
    }
    if (next.maps.farm !== prev.maps.farm) {
      maxPlowed = Math.max(maxPlowed, countTiles(next.maps.farm, (tile) => tile.state === TileState.Plowed || tile.state === TileState.Watered));
    }
  });
  if ('policy' in session) {
    for (let i = 0; i < session.length; i++) store.dispatch(session.policy(store.getState()));
  } else {
    for (const action of session) store.dispatch(action);
  }
  return { state: store.getState(), recorded: [...recorder.actions], notifications, violations, maxPlowed, warps, visited };
}

describe('deterministic replay', () => {
  const session = randomSession(0xc0ffee, 6000);
  let cached: Run | null = null;
  /** The reference run (freezing store), computed once and shared by the tests below. */
  const reference = (): Run => {
    cached ??= play(session, true);
    return cached;
  };

  it(
    'plays the same session to identical states, and replaying the log reproduces it',
    () => {
      const first = reference();
      const second = play(session, true);

      expect(first.recorded).toEqual(session);
      expect(second.state).toEqual(first.state);
      expect(serializeGame(second.state)).toBe(serializeGame(first.state));
      expect(second.notifications).toBe(first.notifications);

      const replayed = first.recorded.reduce(gameReducer, createInitialState());
      expect(replayed).toEqual(first.state);

      // Without freezing the result is the same, i.e. freezing never changes behaviour.
      expect(play(session, false).state).toEqual(first.state);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'exercises real gameplay (not a trivially idle session)',
    () => {
      const { state, notifications, maxPlowed, warps } = reference();
      expect(notifications).toBeGreaterThan(2000);
      expect(state.time.absoluteDay).toBeGreaterThanOrEqual(5);
      expect(state.player.moveSeq).toBeGreaterThan(200);
      expect(state.player.actionSeq).toBeGreaterThan(200);
      // One teleport per morning, plus one per warp taken.
      expect(state.player.teleportSeq).toBe(state.time.absoluteDay + warps);
      expect(maxPlowed).toBeGreaterThan(3);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'never mutates state (the freezing store would throw) and keeps unchanged chunks and tiles shared',
    () => {
      // reference() ran every action through a deep-freezing store: reaching here means no
      // reducer ever wrote to a frozen object.
      expect(reference().violations).toEqual([]);
      const initial = createInitialState();
      const snapshot = serializeGame(initial);
      session.reduce(gameReducer, initial);
      expect(serializeGame(initial)).toBe(snapshot);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'diverges for different sessions and for different world seeds',
    () => {
      const base = reference().state;
      expect(play(randomSession(0xbeef, 6000), false).state).not.toEqual(base);
      const other = play(session, false, 12345).state;
      for (const id of ['farm', 'forest'] as const) expect(other.maps[id], id).not.toEqual(base.maps[id]);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'is reproducible for many short sessions',
    () => {
      for (let seed = 1; seed <= 25; seed++) {
        const short = randomSession(seed, 400);
        expect(play(short, true).state).toEqual(short.reduce(gameReducer, createInitialState()));
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe('deterministic replay across maps', () => {
  let cached: Run | null = null;
  /** A traveller's run through a freezing store, computed once. */
  const travel = (): Run => {
    cached ??= play({ policy: traveller(0x7a11), length: 5000 }, true);
    return cached;
  };

  it(
    'keeps warping between every map, one teleport per warp or morning',
    () => {
      const { state, warps, visited } = travel();
      expect(warps).toBeGreaterThan(20);
      expect([...visited].sort()).toEqual([...MAP_IDS].sort());
      expect(state.player.teleportSeq).toBe(state.time.absoluteDay + warps);
      expect(state.stats.visitedTown).toBe(true);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it(
    'replays its recorded log to the same state, never mutates state and keeps every map shared',
    () => {
      const first = travel();
      expect(first.violations).toEqual([]);
      const replayed = first.recorded.reduce(gameReducer, createInitialState());
      expect(replayed).toEqual(first.state);
      expect(serializeGame(replayed)).toBe(serializeGame(first.state));
      // Replaying the log through a non-freezing store gives the same result.
      expect(play(first.recorded, false).state).toEqual(first.state);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe('deterministic replay with the backpack', () => {
  it(
    'replays sessions full of inventory moves and panels identically, sharing what is unchanged',
    () => {
      const rng = mulberry32(0xbac7);
      const session = Array.from({ length: 4000 }, () => randomActionWithMoves(rng));
      const first = play(session, true);
      const second = play(session, false);
      expect(second.state).toEqual(first.state);
      expect(session.reduce(gameReducer, createInitialState())).toEqual(first.state);
      expect(first.violations).toEqual([]);
      const { inventory } = first.state;
      expect(inventory.slots).toHaveLength(INVENTORY.slotCount);
      expect(inventory.slots.slice(inventory.unlockedSlots).every((slot) => slot === null)).toBe(true);
      expect(inventory.selected).toBeLessThan(INVENTORY.hotbarSize);
      // Moves really happened: something reached the backpack at some point.
      const everInBackpack = session.reduce<{ state: GameState; seen: boolean }>(
        (acc, action) => {
          const state = gameReducer(acc.state, action);
          const seen = acc.seen || state.inventory.slots.slice(INVENTORY.hotbarSize).some((slot) => slot !== null);
          return { state, seen };
        },
        { state: createInitialState(), seen: false },
      ).seen;
      expect(everInBackpack).toBe(true);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe('seeded hashing', () => {
  it('hash32 is a deterministic unsigned 32-bit function of all its inputs, in order', () => {
    let bad = 0;
    for (let i = 0; i < 1000; i++) {
      const h = hash32(i, i * 7, Salt.Weather);
      if (h !== hash32(i, i * 7, Salt.Weather) || !Number.isInteger(h) || h < 0 || h >= 2 ** 32) bad++;
    }
    expect(bad).toBe(0);
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
    expect(hash32(1)).not.toBe(hash32(1, 0));
    expect(hash32(5, Salt.Debris)).not.toBe(hash32(5, Salt.Weather));
    // Non-integers are truncated toward zero.
    expect(hash32(1.7, 2)).toBe(hash32(1, 2));
    expect(hash32(-1.7, 2)).toBe(hash32(-1, 2));
  });

  it('hashFloat is uniform on [0, 1)', () => {
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    let sum = 0;
    let outOfRange = 0;
    for (let i = 0; i < n; i++) {
      const f = hashFloat(i, 99, Salt.Cosmetic);
      if (!(f >= 0 && f < 1)) outOfRange++;
      sum += f;
      const bucket = Math.floor(f * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    expect(outOfRange).toBe(0);
    expect(sum / n).toBeCloseTo(0.5, 2);
    for (const count of buckets) expect(Math.abs(count / n - 0.1)).toBeLessThan(0.006);
  });

  it('hashRange is inclusive on both ends and rejects inverted ranges', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(hashRange(3, 7, i, Salt.Yield));
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    expect(hashRange(4, 4, 123)).toBe(4);
    expect(() => hashRange(5, 4, 1)).toThrow(RangeError);
  });

  it('mulberry32 is a reproducible stream in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    let differs = 0;
    let bad = 0;
    for (let i = 0; i < 1000; i++) {
      const x = a();
      if (b() !== x || !(x >= 0 && x < 1)) bad++;
      if (c() !== x) differs++;
    }
    expect(bad).toBe(0);
    expect(differs).toBeGreaterThan(990);
  });
});
