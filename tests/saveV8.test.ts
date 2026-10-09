/**
 * Save version 8 (farmclaws part 4b spec §9): the v7 → v8 migration, round trips of the part 4b
 * state, and one corrupted field per validation rule. Each part 4b task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, SHOP_STOCK } from '../src/config';
import { Direction, NPC_IDS, SAVE_VERSION, type GameState, type RobotDelivery, type ShopsSoldToday } from '../src/core/types';
import { createDefaultSections } from '../src/state/initialState';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, atDay, livelySections, must, robotOf, v7Save, withPlayer, withRobots, type SaveJson } from './testUtils';

/** `state` with these robots ordered from Juniper's workshop. */
function withDeliveries(state: GameState, deliveries: readonly RobotDelivery[]): GameState {
  return { ...state, robots: { ...state.robots, deliveries } };
}

/** `state` with these shops' sold-today counts changed, the others as they are. */
function withSold(state: GameState, sold: { readonly [K in keyof ShopsSoldToday]?: Partial<ShopsSoldToday[K]> }): GameState {
  const now = state.shopsSoldToday;
  return {
    ...state,
    shopsSoldToday: {
      parts: { ...now.parts, ...sold.parts },
      robots: { ...now.robots, ...sold.robots },
      seeds: { ...now.seeds, ...sold.seeds },
    },
  };
}

/** `count` deliveries of Minis, each with a name of its own. */
const minis = (count: number): RobotDelivery[] => Array.from({ length: count }, (_, i) => ({ size: 'mini', name: `Mini ${i + 1}` }));

/**
 * What a v7 save can hold (Review Focus 3): mid-day in town, chats with Bram and Tess (now
 * Berlioz and Tallulah), a board request from Bram and Tess as the festival gift target.
 */
function chatted(): GameState {
  const lively = { ...BASE, ...livelySections() };
  const state: GameState = {
    ...lively,
    npcs: { ...lively.npcs, berlioz: { talks: 12, talkedToday: true }, tallulah: { talks: 30, talkedToday: false } },
    quests: { ...lively.quests, board: { week: 3, npc: 'berlioz', itemId: 'copperOre', quantity: 5, dueDay: 30, delivered: 2, status: 'active' } },
    festival: { ...lively.festival, giftTarget: 'tallulah' },
  };
  return withPlayer(atDay(state, 3, 780), { tx: 10, tz: 16 }, Direction.East, 'town');
}

/** The shops after a busy morning: some of everything sold, some of it sold out. */
function shopping(): GameState {
  const ordered = withDeliveries(BASE, [
    { size: 'standard', name: 'Clank' },
    { size: 'mini', name: 'Bolt' },
  ]);
  return withSold(ordered, {
    parts: { claw: SHOP_STOCK.partsPerDay, sensorEye: 1 },
    robots: { standard: 1, mini: 1 },
    seeds: { parsnip_seeds: SHOP_STOCK.seedsPerDay, potato_seeds: 5 },
  });
}

const npcsOf = (save: SaveJson) => save.npcs as SaveJson;
const questsOf = (save: SaveJson) => save.quests as SaveJson & { board: SaveJson | null };
const festivalOf = (save: SaveJson) => save.festival as SaveJson;

/** Loads raw save JSON as the game would. */
const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

describe('save version 8', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(8);
    expect(BASE.version).toBe(8);
  });

  it('starts a new game with no deliveries, nothing sold and the renamed cast', () => {
    expect(BASE.robots.deliveries).toEqual([]);
    const { parts, robots, seeds } = BASE.shopsSoldToday;
    expect(parts).toEqual({ claw: 0, wateringHead: 0, tiller: 0, seeder: 0, basket: 0, sensorEye: 0 });
    expect(robots).toEqual({ mini: 0, standard: 0, big: 0 });
    expect(Object.keys(seeds)).toContain('parsnip_seeds');
    expect(Object.values(seeds).every((count) => count === 0)).toBe(true);
    expect(NPC_IDS).toEqual(['sol', 'cosmo', 'barnaby', 'marigold', 'berlioz', 'juniper', 'tallulah']);
    expect(Object.keys(BASE.npcs)).toEqual([...NPC_IDS]);
  });

  it('round-trips two deliveries due and stock sold', () => {
    const state = shopping();
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('round-trips a farm of robots and deliveries at the cap', () => {
    const state = withDeliveries(withRobots(BASE, [robotOf()]), minis(ROBOTS.maxRobots - 1));
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('round-trips the renamed cast with a board request and a gift target', () => {
    const state = chatted();
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('v7 → v8', () => {
  it('writes version 8', () => {
    expect((migrateSave(v7Save(chatted())) as SaveJson).version).toBe(8);
  });

  it('loads a v7 save as the state it was taken from', () => {
    const state = chatted();
    expect(must(load(v7Save(state)))).toEqual(state);
  });

  it('gives a v7 save no deliveries and nothing sold today', () => {
    const save = v7Save(chatted());
    expect('deliveries' in (save.robots as SaveJson)).toBe(false);
    expect('shopsSoldToday' in save).toBe(false);
    const migrated = migrateSave(save) as SaveJson;
    expect((migrated.robots as SaveJson).deliveries).toEqual([]);
    expect(migrated.shopsSoldToday).toEqual(createDefaultSections().shopsSoldToday);
  });

  it("moves Bram's and Tess's chats to Berlioz and Tallulah unchanged, and keeps everyone else's", () => {
    const state = chatted();
    const save = v7Save(state);
    expect(Object.keys(npcsOf(save))).toEqual(['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']);
    const migrated = migrateSave(save) as SaveJson;
    expect(Object.keys(npcsOf(migrated))).toEqual([...NPC_IDS]);
    expect(npcsOf(migrated)).toEqual(state.npcs);
    expect(must(load(save)).npcs.berlioz).toEqual({ talks: 12, talkedToday: true });
  });

  it('moves a board request from Bram and a gift target of Tess with them', () => {
    const save = v7Save(chatted());
    expect(must(questsOf(save).board).npc).toBe('bram');
    expect(festivalOf(save).giftTarget).toBe('tess');
    const migrated = migrateSave(save) as SaveJson;
    expect(must(questsOf(migrated).board).npc).toBe('berlioz');
    expect(festivalOf(migrated).giftTarget).toBe('tallulah');
  });

  it('leaves a board request, a gift target or no target naming anyone else as it was', () => {
    const state = chatted();
    const others: GameState = {
      ...state,
      quests: { ...state.quests, board: { ...must(state.quests.board), npc: 'juniper' } },
      festival: { ...state.festival, giftTarget: 'sol' },
    };
    expect(must(load(v7Save(others)))).toEqual(others);
    const none: GameState = { ...state, quests: { ...state.quests, board: null }, festival: { ...state.festival, giftTarget: null } };
    expect(must(load(v7Save(none)))).toEqual(none);
  });

  it('migrates the version-2 fixture through every version to 8', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(8);
    expect(loaded.npcs).toEqual(BASE.npcs);
    expect(loaded.robots.deliveries).toEqual([]);
    expect(loaded.shopsSoldToday).toEqual(BASE.shopsSoldToday);
  });

  it('rejects a v7 save holding both Bram and Berlioz', () => {
    const save = v7Save(chatted());
    npcsOf(save).berlioz = { talks: 1, talkedToday: false };
    expect(Object.keys(npcsOf(migrateSave(save) as SaveJson))).toContain('bram');
    expect(load(save)).toBeNull();
  });

  it('leaves a v7 save whose npcs or robots are not objects for the validator to reject', () => {
    for (const key of ['npcs', 'robots']) {
      const save = { ...v7Save(BASE), [key]: 'everyone' };
      expect(migrateSave(save), key).toBe(save);
      expect(load(save), key).toBeNull();
    }
  });

  it('v7Save refuses deliveries due or stock sold', () => {
    expect(() => v7Save(withDeliveries(BASE, minis(1)))).toThrow('v7Save');
    expect(() => v7Save(withSold(BASE, { parts: { tiller: 1 } }))).toThrow('v7Save');
    expect(() => v7Save(withSold(BASE, { robots: { big: 1 } }))).toThrow('v7Save');
    expect(() => v7Save(withSold(BASE, { seeds: { corn_seeds: 1 } }))).toThrow('v7Save');
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v7Save(BASE), version: 9 };
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });
});

describe('save version 8 rejects', () => {
  type JsonPath = readonly (string | number)[];
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    ['missing deliveries', ['robots', 'deliveries'], undefined],
    ['deliveries that are not an array', ['robots', 'deliveries'], { size: 'mini', name: 'Clank' }],
    ['a delivery that is not an object', ['robots', 'deliveries', 0], 'mini'],
    ['a delivery without a size', ['robots', 'deliveries', 0, 'size'], undefined],
    ['a delivery without a name', ['robots', 'deliveries', 0, 'name'], undefined],
    ['an extra field on a delivery', ['robots', 'deliveries', 0, 'program'], null],
    ['a delivery of an unknown size', ['robots', 'deliveries', 0, 'size'], 'huge'],
    ['a delivery with an empty name', ['robots', 'deliveries', 1, 'name'], ''],
    ['a delivery with a name too long', ['robots', 'deliveries', 1, 'name'], 'A'.repeat(25)],
    ['a delivery with a padded name', ['robots', 'deliveries', 1, 'name'], ' Bolt'],
    ['missing stock counts', ['shopsSoldToday'], undefined],
    ['stock counts that are not an object', ['shopsSoldToday'], 0],
    ['a missing shop', ['shopsSoldToday', 'robots'], undefined],
    ['an extra shop', ['shopsSoldToday', 'tools'], {}],
    ['a missing part', ['shopsSoldToday', 'parts', 'basket'], undefined],
    ['an antenna on sale', ['shopsSoldToday', 'parts', 'antenna'], 0],
    ['a missing size', ['shopsSoldToday', 'robots', 'big'], undefined],
    ['a missing seed', ['shopsSoldToday', 'seeds', 'potato_seeds'], undefined],
    ['an unknown seed', ['shopsSoldToday', 'seeds', 'stone_seeds'], 0],
    ['more parts sold than Sol stocks', ['shopsSoldToday', 'parts', 'claw'], SHOP_STOCK.partsPerDay + 1],
    ['more robots sold than Juniper builds', ['shopsSoldToday', 'robots', 'mini'], SHOP_STOCK.robotsPerSizePerDay + 1],
    ['more seeds sold than Marigold stocks', ['shopsSoldToday', 'seeds', 'parsnip_seeds'], SHOP_STOCK.seedsPerDay + 1],
    ['a negative count', ['shopsSoldToday', 'parts', 'tiller'], -1],
    ['a fractional count', ['shopsSoldToday', 'seeds', 'potato_seeds'], 2.5],
    ['a count that is not a number', ['shopsSoldToday', 'robots', 'big'], '0'],
    ['Bram by his old id', ['npcs', 'bram'], { talks: 0, talkedToday: false }],
    ['Tess by her old id', ['npcs', 'tess'], { talks: 0, talkedToday: false }],
    ['a missing Berlioz', ['npcs', 'berlioz'], undefined],
    ['a board request from Bram', ['quests', 'board', 'npc'], 'bram'],
    ['Tess as the gift target', ['festival', 'giftTarget'], 'tess'],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = { ...shopping(), quests: chatted().quests, festival: chatted().festival };
    expect(isValidGameState(JSON.parse(serializeGame(state)))).toBe(true);
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    let node: SaveJson = save;
    for (const key of path.slice(0, -1)) {
      const next = (node as Record<string | number, unknown>)[key];
      if (typeof next !== 'object' || next === null) throw new Error(`no object at ${key}`);
      node = next as SaveJson;
    }
    const last = must(path[path.length - 1]);
    if (value === undefined) delete (node as Record<string | number, unknown>)[last];
    else (node as Record<string | number, unknown>)[last] = value;
    expect(JSON.stringify(save)).not.toBe(serializeGame(state));
    expect(isValidGameState(save)).toBe(false);
    expect(load(save)).toBeNull();
  });

  it('rejects more robots and deliveries together than the farm holds', () => {
    const valid = (state: GameState): boolean => isValidGameState(JSON.parse(serializeGame(state)));
    const oneRobot = withRobots(BASE, [robotOf()]);
    expect(valid(withDeliveries(oneRobot, minis(ROBOTS.maxRobots - 1)))).toBe(true);
    expect(valid(withDeliveries(oneRobot, minis(ROBOTS.maxRobots)))).toBe(false);
    expect(valid(withDeliveries(BASE, minis(ROBOTS.maxRobots)))).toBe(true);
    expect(valid(withDeliveries(BASE, minis(ROBOTS.maxRobots + 1)))).toBe(false);
  });

  it("accepts every count up to its shop's daily stock", () => {
    const full = withSold(BASE, {
      parts: { claw: SHOP_STOCK.partsPerDay, basket: SHOP_STOCK.partsPerDay },
      robots: { big: SHOP_STOCK.robotsPerSizePerDay },
      seeds: { wheat_seeds: SHOP_STOCK.seedsPerDay },
    });
    expect(deserializeGame(serializeGame(full))).toEqual(full);
  });
});
