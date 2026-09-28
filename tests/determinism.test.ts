/**
 * End-to-end determinism and purity.
 *
 * A long pseudo-random session (moves, tools, slot changes, ticks, sleeps, shop visits,
 * pauses) is generated with mulberry32 and played twice through a freezing store with an
 * action recorder. Both runs must end in identical states, replaying the recorded log must
 * reproduce that state, the deep-frozen states must never be mutated, and every transition
 * must honour the render contract (unchanged chunks and tiles keep their identity).
 * Also covers the seeded hash primitives everything stochastic is built on.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TIME } from '../src/config';
import { hash32, hashFloat, hashRange, mulberry32, Salt } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import { CROP_IDS, DIRECTIONS, TileState, type GameState, type Tile } from '../src/core/types';
import { seedItemId } from '../src/farming/crops';
import { actions, type GameAction } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { countTiles } from '../src/world/tiles';
import { HEAVY_TEST_TIMEOUT_MS, must } from './testUtils';

function pick<T>(rng: () => number, values: readonly T[]): T {
  return must(values[Math.floor(rng() * values.length)]);
}

/** A plausible, busy play session: mostly walking and tool use, with days passing. */
function randomSession(seed: number, length: number): GameAction[] {
  const rng = mulberry32(seed);
  const session: GameAction[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng();
    if (roll < 0.34) session.push(actions.move(pick(rng, DIRECTIONS)));
    else if (roll < 0.38) session.push(actions.face(pick(rng, DIRECTIONS)));
    else if (roll < 0.6) session.push(actions.useTool());
    else if (roll < 0.68) session.push(actions.interact());
    else if (roll < 0.75) session.push(actions.selectSlot(Math.floor(rng() * (INVENTORY.hotbarSize + 2)) - 1));
    else if (roll < 0.78) session.push(actions.cycleSlot(pick(rng, [-1, 1, 3, -13])));
    else if (roll < 0.87) session.push(actions.tick(1 + Math.floor(rng() * 60)));
    else if (roll < 0.885) session.push(actions.sleep());
    else if (roll < 0.905) session.push(actions.setShopOpen(rng() < 0.6));
    else if (roll < 0.93) session.push(actions.buy(seedItemId(pick(rng, CROP_IDS)), 1 + Math.floor(rng() * 5)));
    else if (roll < 0.945) session.push(actions.setPaused(rng() < 0.4));
    else if (roll < 0.955) session.push(actions.setTimeScale(pick(rng, [1, 2, 3, 4, 8, 16])));
    else session.push(actions.tick(TIME.maxTickMinutes));
  }
  return session;
}

function sameTileContent(a: Tile, b: Tile): boolean {
  return a.state === b.state && a.blocker === b.blocker && a.blockerHp === b.blockerHp && JSON.stringify(a.crop) === JSON.stringify(b.crop);
}

/** Violations of the structural-sharing contract between two consecutive states. */
function sharingViolations(next: GameState, prev: GameState): string[] {
  const problems: string[] = [];
  if (next.world === prev.world) return problems;
  if (next.world.grid !== prev.world.grid) problems.push('grid replaced');
  next.world.chunks.forEach((chunk, ci) => {
    const before = prev.world.chunks[ci];
    if (before === undefined) {
      problems.push(`chunk ${ci} appeared`);
      return;
    }
    if (chunk === before) return;
    if (chunk.revision <= before.revision) problems.push(`chunk ${ci} replaced without a revision bump`);
    let changed = 0;
    chunk.tiles.forEach((tile, i) => {
      const old = before.tiles[i];
      if (old === undefined || tile === old) return;
      changed++;
      if (sameTileContent(tile, old)) problems.push(`chunk ${ci} tile ${i} replaced by an identical copy`);
    });
    if (changed === 0) problems.push(`chunk ${ci} replaced with no changed tile`);
  });
  return problems;
}

interface Run {
  readonly state: GameState;
  readonly recorded: readonly GameAction[];
  readonly notifications: number;
  readonly violations: readonly string[];
  readonly maxPlowed: number;
}

function play(session: readonly GameAction[], freeze: boolean, worldSeed?: number): Run {
  const recorder = createActionRecorder<GameState, GameAction>();
  const store = createStore(gameReducer, createInitialState(worldSeed), { middleware: [recorder.middleware], freeze });
  let notifications = 0;
  let maxPlowed = 0;
  const violations: string[] = [];
  store.subscribe((next, prev) => {
    notifications++;
    if (next === prev) violations.push('notified without a change');
    violations.push(...sharingViolations(next, prev));
    if (next.world !== prev.world) {
      maxPlowed = Math.max(maxPlowed, countTiles(next.world, (tile) => tile.state === TileState.Plowed || tile.state === TileState.Watered));
    }
  });
  for (const action of session) store.dispatch(action);
  return { state: store.getState(), recorded: [...recorder.actions], notifications, violations, maxPlowed };
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
      const { state, notifications, maxPlowed } = reference();
      expect(notifications).toBeGreaterThan(2000);
      expect(state.time.absoluteDay).toBeGreaterThanOrEqual(5);
      expect(state.player.moveSeq).toBeGreaterThan(200);
      expect(state.player.actionSeq).toBeGreaterThan(200);
      expect(state.player.teleportSeq).toBe(state.time.absoluteDay);
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
      expect(play(session, false, 12345).state.world).not.toEqual(base.world);
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
