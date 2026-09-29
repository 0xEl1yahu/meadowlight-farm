/**
 * Save / load (src/state/persistence.ts).
 *
 * A save must round-trip to an equal state (menus closed), and anything corrupted, outdated
 * or structurally impossible must be rejected as a whole (null), never half-loaded. Each
 * corruption case edits one field of a real serialised game by JSON path, and a sweep deletes
 * or retypes every field version 3 brought. Real version-1 and version-2 saves (fixtures)
 * must migrate with the farm intact, the forest and the town generated and the gates carved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY, PLAYER, TIME } from '../src/config';
import {
  Blocker,
  Direction,
  FERTILIZER_KINDS,
  MAP_IDS,
  NPC_IDS,
  PLACED_OBJECT_KINDS,
  SAVE_VERSION,
  TileState,
  UPGRADABLE_TOOLS,
  type ActionKind,
  type GameState,
  type ItemStack,
  type MapId,
  type PlacedObject,
  type Tile,
  type TileCoord,
} from '../src/core/types';
import { actions, type GameAction } from '../src/state/actions';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import {
  ACTION_KINDS,
  SAVE_KEY,
  clearSave,
  deserializeGame,
  isValidGameState,
  loadGame,
  migrateSave,
  saveGame,
  serializeGame,
} from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { locateTile } from '../src/world/grid';
import { MAPS, isReservedTile } from '../src/world/maps';
import { EMPTY_TILE, blockedTile, forEachTile, requireTile } from '../src/world/tiles';
import saveV1Text from './fixtures/save-v1.json?raw';
import saveV2Text from './fixtures/save-v2.json?raw';
import {
  BASE,
  Violations,
  cropOf,
  holding,
  legacySave,
  livelySections,
  matureCrop,
  must,
  soilTile,
  stack,
  tileAt,
  withPlayer,
  withSlots,
  withTile,
  type SaveJson,
} from './testUtils';

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
  state = withTile(state, { tx: 3, tz: 15 }, { state: TileState.Blocked, blocker: Blocker.Rock, blockerHp: 1, crop: null, object: null, fertilizer: null });
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
  return { ...state, ui: { panel: { kind: 'shop' }, paused: true, timeScale: 4 } };
}

function withMenusClosed(state: GameState): GameState {
  return { ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } };
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
    expect(state.maps.farm.chunks.some((chunk) => chunk.revision > 0)).toBe(true);
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
    const bigShipment: GameState = { ...BASE, shipping: { pending: [{ itemId: 'parsnip', quantity: 5000, quality: 2 }], lastPayout: 0 } };
    expect(deserializeGame(serializeGame(bigShipment))).toEqual(bigShipment);
    const exhausted: GameState = { ...BASE, player: { ...BASE.player, energy: 0 }, inventory: { ...BASE.inventory, water: 0 } };
    expect(deserializeGame(serializeGame(exhausted))).toEqual(exhausted);
  });

  it('validates real states', () => {
    expect(isValidGameState(BASE)).toBe(true);
    expect(isValidGameState(richState())).toBe(true);
    expect(SAVE_VERSION).toBe(3);
  });
});

describe('deserializeGame rejects corrupted saves', () => {
  it.each(['', 'not json', '{', 'null', '[]', '42', '"save"', 'true'])('rejects the text %j', (text) => {
    expect(deserializeGame(text)).toBeNull();
  });

  const base = BASE;
  const houseTile = locateTile(base.maps.farm.grid, 2, 2);
  const grassTile = locateTile(base.maps.farm.grid, 6, 12);
  const tilePath = (loc: { readonly chunkIndex: number; readonly localIndex: number }): JsonPath => [
    'maps',
    'farm',
    'chunks',
    loc.chunkIndex,
    'tiles',
    loc.localIndex,
  ];
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    // Header
    ['wrong version', ['version'], 4],
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
    ['chunk size 0', ['maps', 'farm', 'grid', 'chunkSize'], 0],
    ['chunk size that disagrees with the chunk layout', ['maps', 'farm', 'grid', 'chunkSize'], 8],
    ['wrong chunksX', ['maps', 'farm', 'grid', 'chunksX'], 4],
    ['off-centre origin', ['maps', 'farm', 'grid', 'originX'], 0],
    ['zero tile size', ['maps', 'farm', 'grid', 'tileSize'], 0],
    ['negative tile size', ['maps', 'farm', 'grid', 'tileSize'], -1],
    ['string tile size', ['maps', 'farm', 'grid', 'tileSize'], '1'],
    ['width that disagrees with the chunks', ['maps', 'farm', 'grid', 'width'], 49],
    ['a grid with an extra field', ['maps', 'forest', 'grid', 'wrap'], true],
    ['a grid missing a derived field', ['maps', 'town', 'grid', 'originZ'], undefined],
    // Chunks
    ['a null chunk', ['maps', 'farm', 'chunks', 8], null],
    ['no chunks', ['maps', 'farm', 'chunks'], []],
    ['a chunk that is not an object', ['maps', 'farm', 'chunks', 0], 'chunk'],
    ['wrong chunk width', ['maps', 'farm', 'chunks', 2, 'width'], 15],
    ['wrong chunk depth', ['maps', 'farm', 'chunks', 7, 'depth'], 16],
    ['wrong chunk origin', ['maps', 'farm', 'chunks', 4, 'x0'], 0],
    ['wrong chunk coordinate', ['maps', 'farm', 'chunks', 1, 'cx'], 0],
    ['negative revision', ['maps', 'farm', 'chunks', 0, 'revision'], -1],
    ['tiles not an array', ['maps', 'farm', 'chunks', 3, 'tiles'], {}],
    ['a chunk with too few tiles', ['maps', 'farm', 'chunks', 8, 'tiles'], []],
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
    ['blocker hp on the house', [...tilePath(houseTile), 'blockerHp'], 1],
    ['blocker hp on open ground', [...tilePath(grassTile), 'blockerHp'], 2],
    ['missing object field', [...tilePath(grassTile), 'object'], undefined],
    ['missing fertilizer field', [...tilePath(grassTile), 'fertilizer'], undefined],
    ['unknown fertilizer', [...tilePath(grassTile), 'fertilizer'], 'compost'],
    ['fertilizer on grass', [...tilePath(grassTile), 'fertilizer'], 'basic'],
    ['fertilizer on the house', [...tilePath(houseTile), 'fertilizer'], 'basic'],
    ['object that is not an object', [...tilePath(grassTile), 'object'], 'chest'],
    ['unknown object kind', [...tilePath(grassTile), 'object'], { kind: 'statue' }],
    ['object on the house', [...tilePath(houseTile), 'object'], { kind: 'scarecrow' }],
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
    ['unknown map id', ['player', 'mapId'], 'mine'],
    ['missing map id', ['player', 'mapId'], undefined],
    ['player on the forest outside its grid', ['player'], { ...base.player, mapId: 'forest', tx: 40, tz: 5 }],
    ['player in the town on a shop', ['player'], { ...base.player, mapId: 'town', tx: 5, tz: 2 }],
    // Maps
    ['missing maps', ['maps'], undefined],
    ['maps that is not an object', ['maps'], 'farm'],
    ['a missing map', ['maps', 'town'], undefined],
    ['an extra map', ['maps', 'mine'], base.maps.forest],
    ['the farm stored as the forest', ['maps', 'forest'], base.maps.farm],
    ['a town with another size', ['maps', 'town', 'grid', 'width'], 48],
    ['a forest chunk with too few tiles', ['maps', 'forest', 'chunks', 1, 'tiles'], []],
    ['an unknown blocker in the town', ['maps', 'town', 'chunks', 0, 'tiles', 0, 'blocker'], 42],
    // Inventory
    ['empty stack', ['inventory', 'slots', 5, 'quantity'], 0],
    ['stack above maxStack', ['inventory', 'slots', 5, 'quantity'], INVENTORY.maxStack + 1],
    ['two hoes in one slot', ['inventory', 'slots', 0, 'quantity'], 2],
    ['fractional stack', ['inventory', 'slots', 5, 'quantity'], 1.5],
    ['unknown item', ['inventory', 'slots', 5, 'itemId'], 'diamond'],
    ['slot that is not a stack', ['inventory', 'slots', 7], 'hoe'],
    ['no slots', ['inventory', 'slots'], []],
    ['35 slots', ['inventory', 'slots'], Array.from({ length: 35 }, () => null)],
    ['37 slots', ['inventory', 'slots'], Array.from({ length: 37 }, () => null)],
    ['the old 12-slot hotbar', ['inventory', 'slots'], Array.from({ length: 12 }, () => null)],
    ['missing unlockedSlots', ['inventory', 'unlockedSlots'], undefined],
    ['30 unlocked slots', ['inventory', 'unlockedSlots'], 30],
    ['string unlockedSlots', ['inventory', 'unlockedSlots'], '24'],
    ['an item in a locked slot', ['inventory', 'slots', 24], { itemId: 'stone', quantity: 1, quality: 0 }],
    ['an item in the last locked slot', ['inventory', 'slots', 35], { itemId: 'stone', quantity: 1, quality: 0 }],
    ['a stack without quality', ['inventory', 'slots', 5, 'quality'], undefined],
    ['quality 3', ['inventory', 'slots', 5, 'quality'], 3],
    ['negative quality', ['inventory', 'slots', 5, 'quality'], -1],
    ['fractional quality', ['inventory', 'slots', 5, 'quality'], 0.5],
    ['string quality', ['inventory', 'slots', 5, 'quality'], '0'],
    ['silver seeds', ['inventory', 'slots', 5, 'quality'], 1],
    ['a gold hoe', ['inventory', 'slots', 0, 'quality'], 2],
    ['a selection in the backpack', ['inventory', 'selected'], 20],
    ['selection past the hotbar', ['inventory', 'selected'], INVENTORY.hotbarSize],
    ['negative selection', ['inventory', 'selected'], -1],
    ['overfull watering can', ['inventory', 'water'], 41],
    ['zero can capacity', ['inventory', 'waterCapacity'], 0],
    // Shipping
    ['empty pending stack', ['shipping', 'pending'], [{ itemId: 'parsnip', quantity: 0, quality: 0 }]],
    ['unknown pending item', ['shipping', 'pending'], [{ itemId: 'diamond', quantity: 1, quality: 0 }]],
    ['pending stack without quality', ['shipping', 'pending'], [{ itemId: 'parsnip', quantity: 1 }]],
    ['silver stone pending', ['shipping', 'pending'], [{ itemId: 'stone', quantity: 1, quality: 1 }]],
    ['pending quality 5', ['shipping', 'pending'], [{ itemId: 'parsnip', quantity: 1, quality: 5 }]],
    ['pending not an array', ['shipping', 'pending'], { itemId: 'parsnip', quantity: 1 }],
    ['negative last payout', ['shipping', 'lastPayout'], -1],
    // UI & messages
    ['unsupported time scale', ['ui', 'timeScale'], 3],
    ['non-boolean paused', ['ui', 'paused'], 'yes'],
    ['missing panel', ['ui', 'panel'], undefined],
    ['a panel that is not an object', ['ui', 'panel'], 'shop'],
    ['a panel without a kind', ['ui', 'panel'], {}],
    ['a panel with a numeric kind', ['ui', 'panel'], { kind: 3 }],
    ['a panel that is an array', ['ui', 'panel'], ['none']],
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

  it('keeps the key the live version-1 and version-2 games saved under', () => {
    expect(SAVE_KEY).toBe('meadowlight-farm.save.v1');
  });

  it.each(LEGACY_SAVES)('loads a stored version-%i save, and the next save writes version 3 under the same key', (_version, text) => {
    const storage = memoryStorage();
    storage.data.set(SAVE_KEY, text);
    vi.stubGlobal('localStorage', storage);
    const loaded = must(loadGame());
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded).toEqual(deserializeGame(text));
    expect(saveGame(loaded)).toBe(true);
    expect(storage.data.get(SAVE_KEY)).toBe(serializeGame(loaded));
    expect(loadGame()).toEqual(loaded);
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

describe('placed objects and fertiliser in saves', () => {
  const GIANT = { kind: 'giantCrop', cropId: 'pumpkin', anchorTx: 3, anchorTz: 12 } as const;

  /** BASE plus one object of every kind, a fertilised planted tile and a 3×3 giant crop. */
  function furnished(): GameState {
    const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY.chestSlots }, () => null);
    slots[0] = { itemId: 'wood', quantity: 50, quality: 0 };
    slots[1] = { itemId: 'parsnip', quantity: 3, quality: 1 };
    slots[INVENTORY.chestSlots - 1] = { itemId: 'parsnip', quantity: INVENTORY.maxStack, quality: 2 };
    const tiles: readonly (readonly [number, number, Tile])[] = [
      [6, 10, { ...EMPTY_TILE, object: { kind: 'chest', slots } }],
      [7, 10, { ...soilTile(TileState.Watered), object: { kind: 'sprinkler' } }],
      [8, 10, { ...soilTile(TileState.Plowed), object: { kind: 'qualitySprinkler' } }],
      [9, 10, { ...EMPTY_TILE, object: { kind: 'scarecrow' } }],
      [10, 10, { ...EMPTY_TILE, object: { kind: 'woodFence' } }],
      [11, 10, { ...EMPTY_TILE, object: { kind: 'woodPath' } }],
      [12, 10, { ...EMPTY_TILE, object: { kind: 'stonePath' } }],
      [6, 11, { ...EMPTY_TILE, object: { kind: 'forage', itemId: 'chanterelle', spawnDay: 0 } }],
      [7, 11, { ...EMPTY_TILE, object: { kind: 'trophy', festival: 'harvestFair', year: 2 } }],
      [8, 11, { ...EMPTY_TILE, object: { kind: 'decoration', variant: 'flowerArch' } }],
      [9, 11, { ...soilTile(TileState.Plowed, cropOf('parsnip')), fertilizer: 'speedGro' }],
      [10, 11, { ...soilTile(TileState.Watered), fertilizer: 'quality' }],
    ];
    let state = BASE;
    for (const [tx, tz, tile] of tiles) state = withTile(state, { tx, tz }, tile);
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) state = withTile(state, { tx: 3 + dx, tz: 12 + dz }, { ...EMPTY_TILE, object: GIANT });
    }
    return state;
  }
  const tileAtPath = (tx: number, tz: number): JsonPath => {
    const loc = locateTile(BASE.maps.farm.grid, tx, tz);
    return ['maps', 'farm', 'chunks', loc.chunkIndex, 'tiles', loc.localIndex];
  };

  it('round-trips every object kind, fertiliser and a giant crop exactly', () => {
    const state = furnished();
    expect(isValidGameState(state)).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('lets the player stand on a path but not on any other object', () => {
    const state = furnished();
    const onPath = withPlayer(state, { tx: 11, tz: 10 }, Direction.South);
    expect(deserializeGame(serializeGame(onPath))).toEqual(onPath);
    for (const [tx, tz] of [[6, 10], [7, 10], [9, 10], [4, 13]] as const) {
      const onObject: GameState = { ...state, player: { ...state.player, tx, tz } };
      expect(deserializeGame(serializeGame(onObject)), `${tx},${tz}`).toBeNull();
    }
  });

  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    ['a chest with 35 slots', [...tileAtPath(6, 10), 'object', 'slots'], Array.from({ length: 35 }, () => null)],
    ['a chest with 37 slots', [...tileAtPath(6, 10), 'object', 'slots'], Array.from({ length: 37 }, () => null)],
    ['a chest slot that is not a stack', [...tileAtPath(6, 10), 'object', 'slots', 3], 'wood'],
    ['a chest stack above maxStack', [...tileAtPath(6, 10), 'object', 'slots', 35, 'quantity'], INVENTORY.maxStack + 1],
    ['an empty chest stack', [...tileAtPath(6, 10), 'object', 'slots', 0, 'quantity'], 0],
    ['an unknown item in a chest', [...tileAtPath(6, 10), 'object', 'slots', 0, 'itemId'], 'diamond'],
    ['a chest stack without quality', [...tileAtPath(6, 10), 'object', 'slots', 1, 'quality'], undefined],
    ['a chest stack of quality 3', [...tileAtPath(6, 10), 'object', 'slots', 1, 'quality'], 3],
    ['silver wood in a chest', [...tileAtPath(6, 10), 'object', 'slots', 0, 'quality'], 1],
    ['a fractional chest quality', [...tileAtPath(6, 10), 'object', 'slots', 35, 'quality'], 1.5],
    ['a chest without slots', [...tileAtPath(6, 10), 'object', 'slots'], undefined],
    ['an extra field on a sprinkler', [...tileAtPath(7, 10), 'object', 'radius'], 2],
    ['an extra field on a chest', [...tileAtPath(6, 10), 'object', 'owner'], 'bram'],
    ['a forage object of a crop', [...tileAtPath(6, 11), 'object', 'itemId'], 'parsnip'],
    ['a negative forage spawn day', [...tileAtPath(6, 11), 'object', 'spawnDay'], -1],
    ['a fractional forage spawn day', [...tileAtPath(6, 11), 'object', 'spawnDay'], 0.5],
    ['a trophy from year 0', [...tileAtPath(7, 11), 'object', 'year'], 0],
    ['a trophy from an unknown festival', [...tileAtPath(7, 11), 'object', 'festival'], 'mayDay'],
    ['an unknown decoration', [...tileAtPath(8, 11), 'object', 'variant'], 'gnome'],
    ['a decoration without a variant', [...tileAtPath(8, 11), 'object', 'variant'], undefined],
    ['a path on plowed soil', [...tileAtPath(11, 10), 'state'], TileState.Plowed],
    ['fertiliser under a path', [...tileAtPath(11, 10), 'fertilizer'], 'basic'],
    ['fertiliser under a sprinkler', [...tileAtPath(7, 10), 'fertilizer'], 'basic'],
    ['a sprinkler next to a crop', [...tileAtPath(7, 10), 'crop'], cropOf('parsnip')],
    ['a scarecrow on a rock', [...tileAtPath(9, 10)], { ...blockedTile(Blocker.Rock, 2), object: { kind: 'scarecrow' } }],
    ['fertilised soil turned back to grass', [...tileAtPath(10, 11), 'state'], TileState.Unplowed],
    ['a giant crop missing a tile', [...tileAtPath(4, 13), 'object'], null],
    ['a giant crop with a tile of another crop', [...tileAtPath(5, 14), 'object'], { ...GIANT, cropId: 'melon' }],
    ['a giant crop of a crop that never grows giant', [...tileAtPath(3, 12), 'object', 'cropId'], 'parsnip'],
    ['a stray tile naming a giant crop anchor', [...tileAtPath(6, 12), 'object'], GIANT],
    ['a giant crop with a fractional anchor', [...tileAtPath(3, 12), 'object', 'anchorTx'], 3.5],
    ['a giant crop leaving the grid', [...tileAtPath(12, 10), 'object'], { ...GIANT, anchorTx: 46, anchorTz: 38 }],
  ];

  it.each(cases)('rejects %s', (_label, path, value) => {
    const state = furnished();
    const text = corrupt(state, path, value);
    expect(text).not.toBe(serializeGame(state));
    expect(deserializeGame(text)).toBeNull();
    expect(isValidGameState(JSON.parse(text))).toBe(false);
  });
});

describe('ACTION_KINDS', () => {
  it('lists every ActionKind exactly once', () => {
    // The Record type makes this test stop compiling when ActionKind gains or loses a kind.
    const every: Readonly<Record<ActionKind, true>> = {
      hoe: true,
      wateringCan: true,
      pickaxe: true,
      axe: true,
      scythe: true,
      plant: true,
      harvest: true,
      ship: true,
      refill: true,
      sleep: true,
      openChest: true,
      none: true,
    };
    expect([...ACTION_KINDS].sort()).toEqual(Object.keys(every).sort());
    expect(new Set(ACTION_KINDS).size).toBe(ACTION_KINDS.length);
  });

  it('accepts a saved last action of every kind and rejects unknown kinds', () => {
    const withLastAction = (kind: string): unknown => ({
      ...BASE,
      player: { ...BASE.player, actionSeq: 1, lastAction: { seq: 1, kind, target: { tx: 2, tz: 6 }, success: true } },
    });
    for (const kind of ACTION_KINDS) expect(isValidGameState(withLastAction(kind)), kind).toBe(true);
    for (const kind of ['dance', 'chop', '']) expect(isValidGameState(withLastAction(kind)), kind).toBe(false);
  });
});

describe('migrating inventory, shipping and UI to version 3', () => {
  /** A state an old save can express: a full hotbar, an empty backpack, a mixed shipment, fast time. */
  function stocked(): GameState {
    const hotbar = [stack('hoe', 1), stack('parsnip', 7), null, stack('stone', 40), stack('wood', INVENTORY.maxStack)];
    const state = withSlots(BASE, hotbar, 3);
    return {
      ...state,
      shipping: { pending: [stack('parsnip', 12), stack('corn_seeds', 2)], lastPayout: 90 },
      ui: { ...state.ui, timeScale: 8 },
    };
  }

  it.each([1, 2] as const)('a version-%i inventory gains 36 slots, 24 unlocked, every stack at normal quality', (version) => {
    const state = stocked();
    const old = legacySave(state, version);
    expect((old.inventory as { slots: unknown[] }).slots).toHaveLength(INVENTORY.hotbarSize);
    expect((old.inventory as SaveJson).unlockedSlots).toBeUndefined();
    const loaded = must(deserializeGame(JSON.stringify(old)));
    expect(loaded.inventory).toEqual(state.inventory);
    expect(loaded.inventory.slots).toHaveLength(INVENTORY.slotCount);
    expect(loaded.inventory.unlockedSlots).toBe(INVENTORY.startingUnlockedSlots);
    expect(loaded.inventory.selected).toBe(3);
    expect(loaded.shipping).toEqual(state.shipping);
    for (const held of [...loaded.inventory.slots, ...loaded.shipping.pending]) if (held !== null) expect(held.quality).toBe(0);
  });

  it('replaces shopOpen with a closed panel and keeps a valid time scale', () => {
    const old = legacySave(stocked(), 2);
    old.ui = { shopOpen: true, paused: true, timeScale: 8 };
    expect((migrateSave(old) as SaveJson).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8 });
    expect(must(deserializeGame(JSON.stringify(old))).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8 });
  });

  it('falls back to time scale 1 when the old one is invalid or missing', () => {
    const old = legacySave(stocked(), 2);
    for (const ui of [{ shopOpen: false, paused: false, timeScale: 3 }, { shopOpen: false, paused: false }, undefined, 'ui']) {
      const save = { ...old, ui };
      expect((migrateSave(save) as SaveJson).ui, JSON.stringify(ui)).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 1 });
      expect(must(deserializeGame(JSON.stringify(save))).ui.timeScale).toBe(1);
    }
  });

  it('pads a longer old inventory as long as nothing sits at or above slot 24', () => {
    const old = legacySave(stocked(), 2);
    const slots = [...((old.inventory as { slots: unknown[] }).slots), ...Array.from({ length: 18 }, () => null)];
    slots[23] = { itemId: 'stone', quantity: 5 };
    const loaded = must(deserializeGame(JSON.stringify({ ...old, inventory: { ...(old.inventory as SaveJson), slots } })));
    expect(loaded.inventory.slots).toHaveLength(INVENTORY.slotCount);
    expect(loaded.inventory.slots[23]).toEqual(stack('stone', 5));
  });

  it('leaves inventories it cannot express untouched, so validation rejects them', () => {
    const old = legacySave(stocked(), 2);
    const oldSlots = (old.inventory as { slots: unknown[] }).slots;
    const beyond = [...oldSlots, ...Array.from({ length: 18 }, () => null)];
    beyond[24] = { itemId: 'stone', quantity: 5 };
    const tooLong = [...oldSlots, ...Array.from({ length: 25 }, () => null)];
    for (const slots of [beyond, tooLong, 'slots']) {
      const save = { ...old, inventory: { ...(old.inventory as SaveJson), slots } };
      expect(migrateSave(save), JSON.stringify(slots).slice(0, 40)).toBe(save);
      expect(deserializeGame(JSON.stringify(save))).toBeNull();
    }
    for (const broken of [{ ...old, inventory: 'bag' }, { ...old, shipping: { pending: 'bin', lastPayout: 0 } }, { ...old, shipping: null }]) {
      expect(migrateSave(broken)).toBe(broken);
      expect(deserializeGame(JSON.stringify(broken))).toBeNull();
    }
  });

  it('gives a malformed old stack a quality but still rejects it', () => {
    const old = legacySave(stocked(), 2);
    const slots = [...(old.inventory as { slots: unknown[] }).slots];
    slots[2] = { itemId: 'stone', quantity: 0 };
    expect(deserializeGame(JSON.stringify({ ...old, inventory: { ...(old.inventory as SaveJson), slots } }))).toBeNull();
    slots[2] = 'stone';
    expect(deserializeGame(JSON.stringify({ ...old, inventory: { ...(old.inventory as SaveJson), slots } }))).toBeNull();
  });
});

/** One tile of a version-1 or version-2 save: no placed object and no fertiliser yet. */
interface OldTile {
  readonly state: number;
  readonly blocker: number;
  readonly blockerHp: number;
  readonly crop: SaveJson | null;
}

/** The parts of a version-1 or version-2 save these tests read. */
interface OldSave {
  readonly version: number;
  readonly seed: number;
  readonly time: SaveJson;
  readonly weather: string;
  readonly world: { readonly grid: SaveJson; readonly chunks: readonly (SaveJson & { readonly tiles: readonly OldTile[] })[] };
  readonly player: SaveJson;
  readonly inventory: { readonly slots: readonly (SaveJson | null)[]; readonly selected: number; readonly water: number; readonly waterCapacity: number };
  readonly shipping: { readonly pending: readonly SaveJson[]; readonly lastPayout: number };
  readonly ui: SaveJson;
  readonly messages: SaveJson;
}

/**
 * Real legacy saves, frozen exactly as the old games wrote them (tests/fixtures/save-v1.json and
 * save-v2.json). Each was built once by hand-transforming a played current state back to the
 * old shape (`legacySave`) and then checked by loading it with the actual version-1 (commit
 * d6cc5fa) and version-2 (commit ae727ab) game code. Seed 0x5eed2024, 14:05 on a stormy day 3
 * of spring: sown, regrowing and dead crops, damaged debris, bumped chunk revisions, potatoes
 * and parsnips in the shipping bin, and the shop open with the game paused at time scale 2.
 * Three of the four farm gate tiles hold debris (a rock on (0, 13), stumps on (1, 13) and
 * (47, 38)); a parsnip grows on the fourth, (46, 38). Only the version-2 save has wild crops.
 */
const LEGACY_SAVES = [
  [1, saveV1Text],
  [2, saveV2Text],
] as const;

/** The gate tiles each fixture holds debris on, and the gate tile with a crop on it. */
const GATE_DEBRIS: readonly TileCoord[] = [
  { tx: 0, tz: 13 },
  { tx: 1, tz: 13 },
  { tx: 47, tz: 38 },
];
const GATE_CROP: TileCoord = { tx: 46, tz: 38 };

/** A tile carved clear by the migration. */
const CARVED: Tile = { state: TileState.Unplowed, blocker: Blocker.None, blockerHp: 0, crop: null, object: null, fertilizer: null };

function oldTileAt(save: OldSave, { tx, tz }: TileCoord): OldTile {
  const loc = locateTile(MAPS.farm.grid, tx, tz);
  return must(save.world.chunks[loc.chunkIndex]?.tiles[loc.localIndex], `old tile (${tx}, ${tz})`);
}

/** Where the tile at (tx, tz) of an old save's world sits in its JSON. */
function oldTilePath({ tx, tz }: TileCoord): JsonPath {
  const loc = locateTile(MAPS.farm.grid, tx, tz);
  return ['world', 'chunks', loc.chunkIndex, 'tiles', loc.localIndex];
}

describe('real legacy saves', () => {
  it.each(LEGACY_SAVES)('the version-%i fixture has the old shape', (version, text) => {
    const save = JSON.parse(text) as OldSave & SaveJson;
    expect(save.version).toBe(version);
    expect(Object.keys(save).sort()).toEqual(['inventory', 'messages', 'player', 'seed', 'shipping', 'time', 'ui', 'version', 'weather', 'world']);
    expect(Object.keys(save.player)).not.toContain('mapId');
    expect(save.inventory.slots).toHaveLength(INVENTORY.hotbarSize);
    expect(Object.keys(save.inventory).sort()).toEqual(['selected', 'slots', 'water', 'waterCapacity']);
    for (const held of [...save.inventory.slots, ...save.shipping.pending]) if (held !== null) expect(Object.keys(held)).toEqual(['itemId', 'quantity']);
    expect(save.ui).toEqual({ shopOpen: true, paused: true, timeScale: 2 });
    let wild = 0;
    for (const chunk of save.world.chunks) {
      for (const tile of chunk.tiles) {
        expect(Object.keys(tile)).toEqual(['state', 'blocker', 'blockerHp', 'crop']);
        if (tile.crop === null) continue;
        expect('wild' in tile.crop).toBe(version === 2);
        if (tile.crop.wild === true) wild++;
      }
    }
    expect(wild > 0).toBe(version === 2);
    for (const gate of GATE_DEBRIS) expect([Blocker.Rock, Blocker.Stump]).toContain(oldTileAt(save, gate).blocker);
    expect(oldTileAt(save, GATE_CROP).crop?.cropId).toBe('parsnip');
    expect(save.world.chunks.some((chunk) => (chunk.revision as number) > 0)).toBe(true);
  });
});

describe('loading the real legacy saves', () => {
  const load = (text: string): GameState => must(deserializeGame(text), 'the legacy save did not load');

  it.each(LEGACY_SAVES)('version %i: keeps every farm tile exactly, apart from the carved gate debris', (version, text) => {
    const save = JSON.parse(text) as OldSave;
    const farm = load(text).maps.farm;
    expect(farm.grid).toEqual(save.world.grid);
    const carved: string[] = [];
    farm.chunks.forEach((chunk, ci) => {
      const old = must(save.world.chunks[ci]);
      const { tiles: _tiles, ...geometry } = chunk;
      const { tiles: _oldTiles, ...oldGeometry } = old;
      // Chunk layout and revision survive unchanged.
      expect(geometry).toEqual(oldGeometry);
      chunk.tiles.forEach((tile, i) => {
        const oldTile = must(old.tiles[i]);
        const tx = chunk.x0 + (i % chunk.width);
        const tz = chunk.z0 + Math.floor(i / chunk.width);
        if (isReservedTile(MAPS.farm, tx, tz) && (oldTile.blocker === Blocker.Rock || oldTile.blocker === Blocker.Stump)) {
          carved.push(`${tx},${tz}`);
          expect(tile).toEqual(CARVED);
          return;
        }
        // Version 1 predates wild crops: each of its crops was sown, so it gains wild: false.
        const crop = oldTile.crop === null || version === 2 ? oldTile.crop : { ...oldTile.crop, wild: false };
        expect(tile, `${tx},${tz}`).toEqual({ ...oldTile, crop, object: null, fertilizer: null });
      });
    });
    expect(carved.sort()).toEqual(GATE_DEBRIS.map(({ tx, tz }) => `${tx},${tz}`).sort());
    // Soil and a crop on a gate tile are walkable, so they stay.
    expect(tileAt(load(text), GATE_CROP, 'farm')).toEqual({ ...oldTileAt(save, GATE_CROP), object: null, fertilizer: null, crop: { ...must(oldTileAt(save, GATE_CROP).crop), wild: false } });
  });

  it.each(LEGACY_SAVES)('version %i: generates the forest and the town from the save seed', (_version, text) => {
    const loaded = load(text);
    expect(loaded.seed).toBe(0x5eed2024);
    expect(loaded.maps.forest).toEqual(MAPS.forest.generate(loaded.seed));
    expect(loaded.maps.town).toEqual(MAPS.town.generate(loaded.seed));
    // The forest depends on the seed; the town is the same for every seed.
    expect(loaded.maps.forest).not.toEqual(BASE.maps.forest);
    expect(loaded.maps.town).toEqual(BASE.maps.town);
  });

  it.each(LEGACY_SAVES)('version %i: carries the rest of the save over and adds the new sections', (_version, text) => {
    const save = JSON.parse(text) as OldSave;
    const loaded = load(text);
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(BASE).sort());
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.time).toEqual(save.time);
    expect(loaded.weather).toBe(save.weather);
    expect(loaded.messages).toEqual(save.messages);
    expect(loaded.player).toEqual({ ...save.player, mapId: 'farm' });
    expect(loaded.inventory).toEqual({
      slots: Array.from({ length: INVENTORY.slotCount }, (_, i) => {
        const held = save.inventory.slots[i];
        return held === undefined || held === null ? null : { ...held, quality: 0 };
      }),
      unlockedSlots: INVENTORY.startingUnlockedSlots,
      selected: save.inventory.selected,
      water: save.inventory.water,
      waterCapacity: save.inventory.waterCapacity,
    });
    expect(loaded.shipping).toEqual({ pending: save.shipping.pending.map((held) => ({ ...held, quality: 0 })), lastPayout: save.shipping.lastPayout });
    // The open shop and the pause are dropped; the time scale is kept.
    expect(loaded.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 2 });
    const sections = createDefaultSections();
    for (const key of Object.keys(sections) as (keyof typeof sections)[]) expect(loaded[key], key).toEqual(sections[key]);
  });

  it.each(LEGACY_SAVES)('version %i: the migrated state round-trips exactly and idempotently', (_version, text) => {
    const loaded = load(text);
    const once = serializeGame(loaded);
    const again = load(once);
    expect(again).toEqual(loaded);
    expect(serializeGame(again)).toBe(once);
    // A version-3 save is never migrated again.
    const parsed: unknown = JSON.parse(once);
    expect(migrateSave(parsed)).toBe(parsed);
  });

  it.each(LEGACY_SAVES)('version %i: plays on through both carved gates', (_version, text) => {
    const loaded = load(text);
    const walk = (state: GameState, direction: Direction): GameState =>
      [actions.move(direction), actions.move(direction)].reduce(gameReducer, state);
    const west = walk(withPlayer(loaded, { tx: 1, tz: 13 }, Direction.West, 'farm'), Direction.West);
    expect(west.player.mapId).toBe('forest');
    const east = walk(withPlayer(loaded, GATE_CROP, Direction.East, 'farm'), Direction.East);
    expect(east.player.mapId).toBe('town');
    expect(isValidGameState(west) && isValidGameState(east)).toBe(true);
  });
});

describe('migrating corrupt legacy saves', () => {
  it.each(LEGACY_SAVES)('version %i: corrupt debris on a gate tile is rejected, not carved into grass', (_version, text) => {
    const gate = must(GATE_DEBRIS[0]);
    const corruptGate = (tile: SaveJson): string => corruptJson(JSON.parse(text) as SaveJson, oldTilePath(gate), tile);
    const rock = { state: TileState.Blocked, blocker: Blocker.Rock, blockerHp: 1, crop: null };
    // The well-formed rock is carved away...
    expect(tileAt(must(deserializeGame(corruptGate(rock))), gate, 'farm')).toEqual(CARVED);
    // ...but a rock on open ground, absurd damage or a crop under it is a corrupt save.
    for (const tile of [
      { ...rock, state: TileState.Unplowed },
      { ...rock, blockerHp: 101 },
      { ...rock, blockerHp: -1 },
      { ...rock, crop: matureCrop('parsnip') },
      { ...rock, crop: 'parsnip' },
      { state: TileState.Blocked, blocker: Blocker.Stump, blockerHp: 1.5, crop: null },
    ]) {
      expect(deserializeGame(corruptGate(tile)), JSON.stringify(tile)).toBeNull();
    }
  });

  it.each(LEGACY_SAVES)('version %i: a corrupt field anywhere in the old save is still rejected after migration', (_version, text) => {
    const save = JSON.parse(text) as SaveJson;
    const cases: readonly (readonly [JsonPath, unknown])[] = [
      [['seed'], 2 ** 32],
      [['time', 'dayOfSeason'], 4],
      [['weather'], 'hail'],
      [['world', 'grid', 'width'], 40],
      [['world', 'chunks', 0, 'revision'], -1],
      [[...oldTilePath(GATE_CROP), 'crop', 'stage'], 99],
      [['player', 'tx'], 48],
      [['player', 'energy'], 101],
      [['player', 'lastAction', 'kind'], 'dance'],
      [['inventory', 'selected'], INVENTORY.hotbarSize],
      [['inventory', 'water'], 41],
      [['inventory', 'slots', 0, 'quantity'], 2],
      [['inventory', 'slots', 5, 'itemId'], 'diamond'],
      [['shipping', 'pending', 0, 'quantity'], 0],
      [['shipping', 'lastPayout'], -1],
      [['messages', 'entries', 0, 'tone'], 'loud'],
    ];
    for (const [path, value] of cases) expect(deserializeGame(corruptJson(save, path, value)), path.join('.')).toBeNull();
  });
});

/** Stringifies a copy of `root` with the value at `path` replaced (undefined deletes it). */
function corruptJson(root: SaveJson, path: JsonPath, value: unknown): string {
  const copy = JSON.parse(JSON.stringify(root)) as unknown;
  let node: unknown = copy;
  for (const key of path.slice(0, -1)) node = (node as Record<string | number, unknown>)[key];
  (node as Record<string | number, unknown>)[must(path[path.length - 1])] = value;
  return JSON.stringify(copy);
}

/** The first open grass tile (no blocker, crop or object) of `mapId` at or beyond `from`, off the reserved tiles. */
function openTile(mapId: MapId, from: TileCoord): TileCoord {
  const world = BASE.maps[mapId];
  for (let tz = from.tz; tz < world.grid.depth; tz++) {
    for (let tx = from.tx; tx < world.grid.width; tx++) {
      const tile = requireTile(world, tx, tz);
      const open = tile.state === TileState.Unplowed && tile.blocker === Blocker.None && tile.crop === null && tile.object === null;
      if (open && !isReservedTile(MAPS[mapId], tx, tz)) return { tx, tz };
    }
  }
  throw new Error(`no open tile on ${mapId}`);
}

/** A chest holding `stacks` at the given slot indices. */
function chestOf(stacks: readonly (readonly [number, ItemStack])[]): PlacedObject {
  const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY.chestSlots }, () => null);
  for (const [index, held] of stacks) slots[index] = held;
  return { kind: 'chest', slots };
}

/**
 * A version-3 state that uses every field the version brought: every placed-object kind and
 * fertiliser on the farm, a chest and a path in the forest (the player stands on the path), a
 * decoration and a path in the town, silver and gold stacks in the backpack, the bin and the
 * chests, the full 36-slot backpack unlocked, an open panel, and every later-workstream section
 * far from its defaults with no optional field left null or empty.
 */
function everything(): GameState {
  const giant: PlacedObject = { kind: 'giantCrop', cropId: 'melon', anchorTx: 3, anchorTz: 12 };
  const farm: readonly (readonly [number, number, Tile])[] = [
    [6, 10, { ...EMPTY_TILE, object: chestOf([[0, stack('wood', 50)], [1, stack('parsnip', 3, 1)], [35, stack('pumpkin', INVENTORY.maxStack, 2)]]) }],
    [7, 10, { ...soilTile(TileState.Watered), object: { kind: 'sprinkler' } }],
    [8, 10, { ...soilTile(TileState.Plowed), object: { kind: 'qualitySprinkler' } }],
    [9, 10, { ...EMPTY_TILE, object: { kind: 'scarecrow' } }],
    [10, 10, { ...EMPTY_TILE, object: { kind: 'woodFence' } }],
    [11, 10, { ...EMPTY_TILE, object: { kind: 'woodPath' } }],
    [12, 10, { ...EMPTY_TILE, object: { kind: 'stonePath' } }],
    [6, 11, { ...EMPTY_TILE, object: { kind: 'forage', itemId: 'hazelnut', spawnDay: 3 } }],
    [7, 11, { ...EMPTY_TILE, object: { kind: 'trophy', festival: 'lanternNight', year: 1 } }],
    [8, 11, { ...EMPTY_TILE, object: { kind: 'decoration', variant: 'paperLantern' } }],
    [9, 11, { ...soilTile(TileState.Plowed, cropOf('parsnip')), fertilizer: 'speedGro' }],
    [10, 11, { ...soilTile(TileState.Watered), fertilizer: 'quality' }],
    [11, 11, { ...soilTile(TileState.Watered, cropOf('potato', { stage: 2 })), fertilizer: 'basic' }],
  ];
  let state: GameState = { ...BASE, ...livelySections() };
  for (const [tx, tz, tile] of farm) state = withTile(state, { tx, tz }, tile, 'farm');
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) state = withTile(state, { tx: 3 + dx, tz: 12 + dz }, { ...EMPTY_TILE, object: giant }, 'farm');
  }
  const forestChest = openTile('forest', { tx: 18, tz: 8 });
  state = withTile(state, forestChest, { ...EMPTY_TILE, object: chestOf([[12, stack('blackberry', 4, 2)]]) }, 'forest');
  const forestPath = openTile('forest', { tx: forestChest.tx + 1, tz: forestChest.tz });
  state = withTile(state, forestPath, { ...EMPTY_TILE, object: { kind: 'woodPath' } }, 'forest');
  const townLantern = openTile('town', { tx: 12, tz: 10 });
  state = withTile(state, townLantern, { ...EMPTY_TILE, object: { kind: 'decoration', variant: 'stoneLantern' } }, 'town');
  state = withTile(state, openTile('town', { tx: townLantern.tx + 1, tz: townLantern.tz }), { ...EMPTY_TILE, object: { kind: 'stonePath' } }, 'town');
  state = withPlayer(state, forestPath, Direction.North, 'forest');
  const slots: (ItemStack | null)[] = [...BASE.inventory.slots];
  slots[12] = stack('parsnip', 10, 2);
  slots[30] = stack('wood', 5);
  slots[35] = stack('potato', 3, 1);
  state = withSlots(state, slots, 3);
  return {
    ...state,
    inventory: { ...state.inventory, unlockedSlots: 36 },
    shipping: { pending: [stack('parsnip', 4), stack('parsnip', 1, 2), stack('pumpkin', 2, 1)], lastPayout: 777 },
    ui: { panel: { kind: 'inventory' }, paused: true, timeScale: 16 },
  };
}

describe('version-3 saves', () => {
  it('the everything state is valid and uses every placed-object kind and fertiliser', () => {
    const state = everything();
    expect(isValidGameState(state)).toBe(true);
    const kinds = new Set<string>();
    const fertilizers = new Set<string>();
    for (const id of MAP_IDS) {
      forEachTile(state.maps[id], (tile) => {
        if (tile.object !== null) kinds.add(tile.object.kind);
        if (tile.fertilizer !== null) fertilizers.add(tile.fertilizer);
      });
    }
    expect([...kinds].sort()).toEqual([...PLACED_OBJECT_KINDS].sort());
    expect([...fertilizers].sort()).toEqual([...FERTILIZER_KINDS].sort());
    expect(state.player.mapId).toBe('forest');
  });

  it('serialize → deserialize is idempotent', () => {
    for (const state of [BASE, createInitialState(0xffffffff), richState(), everything()]) {
      const text = serializeGame(state);
      const once = must(deserializeGame(text));
      expect(once).toEqual(withMenusClosed(state));
      const again = serializeGame(once);
      expect(again).toBe(serializeGame(withMenusClosed(state)));
      expect(must(deserializeGame(again))).toEqual(once);
      expect(serializeGame(must(deserializeGame(again)))).toBe(again);
      const parsed: unknown = JSON.parse(text);
      expect(migrateSave(parsed)).toBe(parsed);
    }
  });

  it('a restored everything state plays on identically', () => {
    const state = withMenusClosed(everything());
    const restored = must(deserializeGame(serializeGame(state)));
    const script: readonly GameAction[] = [actions.move(Direction.South), actions.useTool(), actions.selectSlot(1), actions.sleep(), actions.tick(300)];
    expect(script.reduce(gameReducer, restored)).toEqual(script.reduce(gameReducer, state));
  });
});

/** The value at `path` in parsed JSON. */
function valueAt(root: unknown, path: JsonPath): unknown {
  let node = root;
  for (const key of path) node = (node as Record<string | number, unknown>)[key];
  return node;
}

/** `path` and every path below it in parsed JSON, parents before children. */
function pathsBelow(root: unknown, path: JsonPath): JsonPath[] {
  const node = valueAt(root, path);
  const paths: JsonPath[] = [path];
  if (Array.isArray(node)) node.forEach((_, i) => paths.push(...pathsBelow(root, [...path, i])));
  else if (typeof node === 'object' && node !== null) for (const key of Object.keys(node)) paths.push(...pathsBelow(root, [...path, key]));
  return paths;
}

/**
 * Every path the version-3 corruption sweep mutates: the whole of each later-workstream section,
 * the player, inventory, shipping and UI; each map; every tile holding a placed object or
 * fertiliser (with all of its contents); and the `object` and `fertilizer` fields of one plain
 * tile per map.
 */
function sweptPaths(save: SaveJson): JsonPath[] {
  const paths: JsonPath[] = [];
  for (const key of [...Object.keys(createDefaultSections()), 'player', 'inventory', 'shipping', 'ui']) paths.push(...pathsBelow(save, [key]));
  for (const id of MAP_IDS) {
    paths.push(['maps', id]);
    let plain = false;
    (valueAt(save, ['maps', id, 'chunks']) as readonly { readonly tiles: readonly Tile[] }[]).forEach((chunk, ci) => {
      chunk.tiles.forEach((tile, ti) => {
        const tilePath: JsonPath = ['maps', id, 'chunks', ci, 'tiles', ti];
        if (tile.object !== null || tile.fertilizer !== null) {
          paths.push(...pathsBelow(save, tilePath));
        } else if (!plain) {
          plain = true;
          paths.push([...tilePath, 'object'], [...tilePath, 'fertilizer']);
        }
      });
    });
  }
  return paths;
}

/**
 * Every field version 3 brought, by name. The sweep must reach each one, so a field added to
 * the save without a corruption case (or without validation) fails here.
 */
const NEW_FIELDS: readonly string[] = [
  ...MAP_IDS,
  'mapId',
  'unlockedSlots',
  'quality',
  'panel',
  'kind',
  'object',
  'fertilizer',
  'slots',
  'cropId',
  'anchorTx',
  'anchorTz',
  'itemId',
  'spawnDay',
  'festival',
  'year',
  'variant',
  ...Object.keys(createDefaultSections()),
  'playerName',
  'farmName',
  'appearance',
  'skinTone',
  'hairStyle',
  'hairColor',
  'shirtColor',
  'overallsColor',
  'hat',
  'levels',
  ...UPGRADABLE_TOOLS,
  'upgrade',
  'tool',
  'level',
  'readyDay',
  'known',
  'kitchenLevel',
  'id',
  'plot',
  'troughWheat',
  'animals',
  'name',
  'bornDay',
  'fedToday',
  'pettedToday',
  'happiness',
  'hasProduct',
  ...NPC_IDS,
  'points',
  'talkedToday',
  'giftsToday',
  'giftsThisWeek',
  'heartEventsSeen',
  'talks',
  'completed',
  'board',
  'week',
  'npc',
  'quantity',
  'dueDay',
  'delivered',
  'status',
  'parsnipsShipped',
  'debrisCleared',
  'forageFound',
  'totalEarned',
  'visitedTown',
  'craftedChest',
  'builtCoop',
  'activeDay',
  'eggsFound',
  'lanternReleased',
  'display',
  'giftTarget',
  'giftGiven',
];

/** A value of the wrong type for `value`: a string becomes a number, anything else a string no id list holds. */
const wrongType = (value: unknown): unknown => (typeof value === 'string' ? 7 : '§');

describe('every version-3 field rejects corruption', () => {
  const save = JSON.parse(serializeGame(everything())) as SaveJson;
  const paths = sweptPaths(save);

  it('the sweep reaches every field version 3 brought', () => {
    const reached = new Set(paths.map((path) => path[path.length - 1]));
    expect(NEW_FIELDS.filter((field) => !reached.has(field))).toEqual([]);
    expect(paths.length).toBeGreaterThan(500);
  });

  it('rejects each swept field deleted or given a value of the wrong type', () => {
    expect(isValidGameState(save)).toBe(true);
    const problems = new Violations();
    let mutations = 0;
    for (const path of paths) {
      const parent = valueAt(save, path.slice(0, -1)) as Record<string | number, unknown>;
      const key = must(path[path.length - 1]);
      const original = parent[key];
      // Deleting an array element would leave a hole, which JSON writes as null: wrong type covers it.
      const edits: readonly (readonly ['deleted' | 'retyped', () => void])[] = [
        ['retyped', () => (parent[key] = wrongType(original))],
        ...(typeof key === 'string' ? [['deleted', () => delete parent[key]] as const] : []),
      ];
      for (const [label, edit] of edits) {
        edit();
        mutations++;
        try {
          problems.check(!isValidGameState(save), () => `${label} ${path.join('.')} was accepted`);
        } catch (error) {
          problems.check(false, `${label} ${path.join('.')} threw ${String(error)}`);
        }
        parent[key] = original;
      }
    }
    expect(problems.head()).toEqual([]);
    expect(mutations).toBeGreaterThan(paths.length);
    // Every edit was undone.
    expect(isValidGameState(save)).toBe(true);
  });

  it('rejects an unknown extra field on a placed object of every kind', () => {
    const rejected = new Set<string>();
    const problems = new Violations();
    for (const id of MAP_IDS) {
      for (const chunk of valueAt(save, ['maps', id, 'chunks']) as readonly { readonly tiles: readonly SaveJson[] }[]) {
        for (const tile of chunk.tiles) {
          if (tile.object === null) continue;
          const object = tile.object as SaveJson;
          object.extra = 1;
          problems.check(!isValidGameState(save), () => `an extra field on a ${String(object.kind)} on the ${id} was accepted`);
          delete object.extra;
          rejected.add(String(object.kind));
        }
      }
    }
    expect(problems.head()).toEqual([]);
    expect([...rejected].sort()).toEqual([...PLACED_OBJECT_KINDS].sort());
    expect(isValidGameState(save)).toBe(true);
  });
});
