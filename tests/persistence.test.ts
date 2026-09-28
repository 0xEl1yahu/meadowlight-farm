/**
 * Save / load (src/state/persistence.ts).
 *
 * A save must round-trip to an equal state (menus closed), and anything corrupted, outdated
 * or structurally impossible must be rejected as a whole (null), never half-loaded. Each
 * corruption case edits one field of a real serialised game by JSON path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY, PLAYER, TIME } from '../src/config';
import { Blocker, Direction, SAVE_VERSION, TileState, type GameState } from '../src/core/types';
import { actions, type GameAction } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import {
  SAVE_KEY,
  clearSave,
  deserializeGame,
  isValidGameState,
  loadGame,
  saveGame,
  serializeGame,
} from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { locateTile } from '../src/world/grid';
import { BASE, holding, matureCrop, soilTile, withPlayer, withTile } from './testUtils';

type JsonPath = readonly (string | number)[];

/** Serialises `state`, replaces the value at `path` (undefined deletes it) and re-serialises. */
function corrupt(state: GameState, path: JsonPath, value: unknown): string {
  const root: unknown = JSON.parse(serializeGame(state));
  let node: unknown = root;
  for (const key of path.slice(0, -1)) node = (node as Record<string | number, unknown>)[key];
  const last = path[path.length - 1];
  if (last === undefined) throw new Error('empty path');
  (node as Record<string | number, unknown>)[last] = value;
  return JSON.stringify(root);
}

/** A mid-game state touching every part of the save: crops, debris damage, shipping, messages. */
function richState(): GameState {
  let state = withTile(BASE, { tx: 8, tz: 12 }, soilTile(TileState.Watered, matureCrop('strawberry', { harvestCount: 2, regrowing: true })));
  state = withTile(state, { tx: 3, tz: 15 }, { state: TileState.Blocked, blocker: Blocker.Rock, blockerHp: 1, crop: null });
  const script: readonly GameAction[] = [
    actions.move(Direction.South),
    actions.move(Direction.South),
    actions.useTool(),
    actions.selectSlot(5),
    actions.useTool(),
    actions.selectSlot(1),
    actions.useTool(),
    actions.tick(95),
    actions.setShopOpen(true),
    actions.buy('potato_seeds', 3),
    actions.setShopOpen(false),
    actions.sleep(),
    actions.move(Direction.South),
    actions.move(Direction.South),
    actions.useTool(),
    actions.tick(30),
  ];
  state = script.reduce(gameReducer, state);
  state = gameReducer(holding(withPlayer(state, { tx: 9, tz: 6 }, Direction.North), 'parsnip_seeds', 4), actions.interact());
  return { ...state, ui: { shopOpen: true, paused: true, timeScale: 4 } };
}

function withMenusClosed(state: GameState): GameState {
  return { ...state, ui: { ...state.ui, shopOpen: false, paused: false } };
}

describe('serializeGame / deserializeGame round trip', () => {
  it('restores a fresh game exactly', () => {
    for (const seed of [0, 1, 0xffffffff]) {
      const state = createInitialState(seed);
      expect(deserializeGame(serializeGame(state))).toEqual(state);
    }
  });

  it('restores a mid-game state exactly, except that menus are closed', () => {
    const state = richState();
    expect(state.shipping.pending.length).toBeGreaterThan(0);
    expect(state.player.lastAction).not.toBeNull();
    expect(state.world.chunks.some((chunk) => chunk.revision > 0)).toBe(true);
    const restored = deserializeGame(serializeGame(state));
    expect(restored).toEqual(withMenusClosed(state));
    expect(restored?.ui.timeScale).toBe(4);
  });

  it('is stable: serialise → deserialise → serialise gives the same text', () => {
    const state = withMenusClosed(richState());
    const once = serializeGame(state);
    const restored = deserializeGame(once);
    expect(restored).not.toBeNull();
    if (restored !== null) expect(serializeGame(restored)).toBe(once);
  });

  it('plays on identically from a restored save', () => {
    const state = withMenusClosed(richState());
    const restored = deserializeGame(serializeGame(state));
    expect(restored).not.toBeNull();
    if (restored === null) return;
    const script: readonly GameAction[] = [actions.useTool(), actions.move(Direction.East), actions.sleep(), actions.tick(600), actions.interact()];
    expect(script.reduce(gameReducer, restored)).toEqual(script.reduce(gameReducer, state));
  });

  it('accepts what the game can legitimately produce at the edges', () => {
    const lateNight = { ...BASE, time: { ...BASE.time, minuteOfDay: TIME.passOutMinute } };
    expect(deserializeGame(serializeGame(lateNight))).toEqual(lateNight);
    // The shipping bin has no stack limit.
    const bigShipment: GameState = { ...BASE, shipping: { pending: [{ itemId: 'parsnip', quantity: 5000 }], lastPayout: 0 } };
    expect(deserializeGame(serializeGame(bigShipment))).toEqual(bigShipment);
    const exhausted: GameState = { ...BASE, player: { ...BASE.player, energy: 0 }, inventory: { ...BASE.inventory, water: 0 } };
    expect(deserializeGame(serializeGame(exhausted))).toEqual(exhausted);
  });

  it('validates real states', () => {
    expect(isValidGameState(BASE)).toBe(true);
    expect(isValidGameState(richState())).toBe(true);
    expect(SAVE_VERSION).toBe(1);
  });
});

describe('deserializeGame rejects corrupted saves', () => {
  it.each(['', 'not json', '{', 'null', '[]', '42', '"save"', 'true'])('rejects the text %j', (text) => {
    expect(deserializeGame(text)).toBeNull();
  });

  const base = BASE;
  const houseTile = locateTile(base.world.grid, 5, 5);
  const grassTile = locateTile(base.world.grid, 6, 12);
  const tilePath = (loc: { readonly chunkIndex: number; readonly localIndex: number }): JsonPath => [
    'world',
    'chunks',
    loc.chunkIndex,
    'tiles',
    loc.localIndex,
  ];
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    // Header
    ['wrong version', ['version'], 2],
    ['string version', ['version'], '1'],
    ['missing version', ['version'], undefined],
    ['negative seed', ['seed'], -1],
    ['fractional seed', ['seed'], 1.5],
    ['seed above 32 bits', ['seed'], 2 ** 32],
    ['string seed', ['seed'], '5'],
    // Time & weather
    ['clock before 6:00', ['time', 'minuteOfDay'], TIME.dayStartMinute - 1],
    ['clock after 26:00', ['time', 'minuteOfDay'], TIME.passOutMinute + 1],
    ['fractional clock', ['time', 'minuteOfDay'], 400.5],
    ['day of season 0', ['time', 'dayOfSeason'], 0],
    ['day of season 29', ['time', 'dayOfSeason'], 29],
    ['season 4', ['time', 'season'], 4],
    ['year 0', ['time', 'year'], 0],
    ['negative absolute day', ['time', 'absoluteDay'], -1],
    ['missing time', ['time'], undefined],
    ['unknown weather', ['weather'], 'hail'],
    ['null weather', ['weather'], null],
    // Grid
    ['chunk size 0', ['world', 'grid', 'chunkSize'], 0],
    ['chunk size that disagrees with the chunk layout', ['world', 'grid', 'chunkSize'], 8],
    ['wrong chunksX', ['world', 'grid', 'chunksX'], 4],
    ['off-centre origin', ['world', 'grid', 'originX'], 0],
    ['zero tile size', ['world', 'grid', 'tileSize'], 0],
    ['negative tile size', ['world', 'grid', 'tileSize'], -1],
    ['string tile size', ['world', 'grid', 'tileSize'], '1'],
    ['width that disagrees with the chunks', ['world', 'grid', 'width'], 49],
    // Chunks
    ['a null chunk', ['world', 'chunks', 8], null],
    ['no chunks', ['world', 'chunks'], []],
    ['a chunk that is not an object', ['world', 'chunks', 0], 'chunk'],
    ['wrong chunk width', ['world', 'chunks', 2, 'width'], 15],
    ['wrong chunk depth', ['world', 'chunks', 7, 'depth'], 16],
    ['wrong chunk origin', ['world', 'chunks', 4, 'x0'], 0],
    ['wrong chunk coordinate', ['world', 'chunks', 1, 'cx'], 0],
    ['negative revision', ['world', 'chunks', 0, 'revision'], -1],
    ['tiles not an array', ['world', 'chunks', 3, 'tiles'], {}],
    ['a chunk with too few tiles', ['world', 'chunks', 8, 'tiles'], []],
    // Tiles
    ['unknown tile state', [...tilePath(grassTile), 'state'], 7],
    ['unknown blocker', [...tilePath(grassTile), 'blocker'], 9],
    ['Blocked tile without blocker', [...tilePath(grassTile), 'state'], TileState.Blocked],
    ['open ground with a rock', [...tilePath(grassTile), 'blocker'], Blocker.Rock],
    ['absurd blocker hp', [...tilePath(grassTile), 'blockerHp'], 101],
    ['negative blocker hp', [...tilePath(grassTile), 'blockerHp'], -1],
    ['crop on grass', [...tilePath(grassTile), 'crop'], { ...matureCrop('parsnip') }],
    ['crop on the house', [...tilePath(houseTile), 'crop'], { ...matureCrop('parsnip') }],
    ['null tile', [...tilePath(grassTile)], null],
    ['missing crop field', [...tilePath(grassTile), 'crop'], undefined],
    // Player
    ['player inside the house', ['player', 'tz'], PLAYER.spawn.tz - 1],
    ['player outside the grid', ['player', 'tx'], 48],
    ['fractional player position', ['player', 'tx'], 5.5],
    ['facing 4', ['player', 'facing'], 4],
    ['energy above max', ['player', 'energy'], PLAYER.maxEnergy + 1],
    ['negative energy', ['player', 'energy'], -1],
    ['zero max energy', ['player', 'maxEnergy'], 0],
    ['negative gold', ['player', 'gold'], -1],
    ['fractional gold', ['player', 'gold'], 1.5],
    ['negative moveSeq', ['player', 'moveSeq'], -1],
    ['non-object lastAction', ['player', 'lastAction'], 5],
    ['missing lastAction', ['player', 'lastAction'], undefined],
    // Inventory
    ['empty stack', ['inventory', 'slots', 5, 'quantity'], 0],
    ['stack above maxStack', ['inventory', 'slots', 5, 'quantity'], INVENTORY.maxStack + 1],
    ['two hoes in one slot', ['inventory', 'slots', 0, 'quantity'], 2],
    ['fractional stack', ['inventory', 'slots', 5, 'quantity'], 1.5],
    ['unknown item', ['inventory', 'slots', 5, 'itemId'], 'diamond'],
    ['slot that is not a stack', ['inventory', 'slots', 7], 'hoe'],
    ['no slots', ['inventory', 'slots'], []],
    ['selection past the hotbar', ['inventory', 'selected'], INVENTORY.hotbarSize],
    ['negative selection', ['inventory', 'selected'], -1],
    ['overfull watering can', ['inventory', 'water'], 41],
    ['zero can capacity', ['inventory', 'waterCapacity'], 0],
    // Shipping
    ['empty pending stack', ['shipping', 'pending'], [{ itemId: 'parsnip', quantity: 0 }]],
    ['unknown pending item', ['shipping', 'pending'], [{ itemId: 'diamond', quantity: 1 }]],
    ['pending not an array', ['shipping', 'pending'], { itemId: 'parsnip', quantity: 1 }],
    ['negative last payout', ['shipping', 'lastPayout'], -1],
    // UI & messages
    ['unsupported time scale', ['ui', 'timeScale'], 3],
    ['non-boolean shopOpen', ['ui', 'shopOpen'], 'yes'],
    ['missing ui', ['ui'], undefined],
    ['unknown message tone', ['messages', 'entries', 0, 'tone'], 'loud'],
    ['non-string message text', ['messages', 'entries', 1, 'text'], 5],
    ['negative nextId', ['messages', 'nextId'], -1],
    ['entries not an array', ['messages', 'entries'], 'hello'],
  ];

  it.each(cases)('rejects a save with %s', (_label, path, value) => {
    const text = corrupt(base, path, value);
    expect(text).not.toBe(serializeGame(base));
    expect(deserializeGame(text)).toBeNull();
    expect(isValidGameState(JSON.parse(text))).toBe(false);
  });

  it('rejects an infinite tile size smuggled in through JSON (1e999)', () => {
    const text = serializeGame(BASE).replace('"tileSize":1', '"tileSize":1e999');
    expect(text).toContain('1e999');
    expect(deserializeGame(text)).toBeNull();
  });

  // isValidGameState is documented as a structural validator for untrusted values (a type
  // guard), but a non-finite tileSize reaches createGridSpec, which throws a RangeError.
  // JSON.parse('1e999') === Infinity, so parsed JSON can trigger it. deserializeGame only
  // survives because of its surrounding try/catch.
  it('isValidGameState returns false (rather than throwing) for a non-finite tileSize', () => {
    const parsed: unknown = JSON.parse(serializeGame(BASE).replace('"tileSize":1', '"tileSize":1e999'));
    expect(isValidGameState(parsed)).toBe(false);
  });

  // The module promises a strict structural validator ("a corrupted save is rejected, never
  // half-loaded"), but player.lastAction is only checked to be an object, so an ActionEvent
  // with nonsense fields passes the GameState type guard and reaches the renderers / HUD.
  it('rejects a structurally invalid player.lastAction', () => {
    const text = corrupt(BASE, ['player', 'lastAction'], { seq: 'x', kind: 42, target: 'nowhere', success: 'maybe' });
    expect(deserializeGame(text)).toBeNull();
  });

  it('rejects non-objects outright', () => {
    for (const value of [null, undefined, 0, 'save', [], true]) expect(isValidGameState(value)).toBe(false);
  });
});

describe('saveGame / loadGame / clearSave', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { readonly data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
  }

  it('round-trips through localStorage under SAVE_KEY', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const state = richState();
    expect(saveGame(state)).toBe(true);
    expect(storage.data.get(SAVE_KEY)).toBe(serializeGame(state));
    expect(loadGame()).toEqual(withMenusClosed(state));
    clearSave();
    expect(storage.data.has(SAVE_KEY)).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('returns null for a corrupted stored save', () => {
    const storage = memoryStorage();
    storage.data.set(SAVE_KEY, corrupt(BASE, ['player', 'energy'], -5));
    vi.stubGlobal('localStorage', storage);
    expect(loadGame()).toBeNull();
  });

  it('degrades gracefully when storage is missing or throws', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(saveGame(BASE)).toBe(false);
    expect(loadGame()).toBeNull();
    expect(() => clearSave()).not.toThrow();

    const failing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', failing);
    expect(saveGame(BASE)).toBe(false);
    expect(loadGame()).toBeNull();
    expect(() => clearSave()).not.toThrow();
  });
});
