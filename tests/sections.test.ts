/**
 * Phase 0 foundations: the identifier lists, the later-workstream sections of GameState with
 * their defaults, the hash salts, and how saves carry the sections (validation and migration).
 */
import { describe, expect, it } from 'vitest';
import { APPEARANCE, INVENTORY, LAYOUT, PROFILE, TOOLS, UNLOCKS, WORKBENCH } from '../src/config';
import { Salt, hash32 } from '../src/core/hash';
import {
  Blocker,
  SAVE_VERSION,
  TileState,
  CROP_IDS,
  CRAFTING_RECIPE_IDS,
  DECORATION_IDS,
  DISH_IDS,
  FESTIVAL_IDS,
  FORAGE_IDS,
  GIANT_CROP_IDS,
  MAP_IDS,
  NPC_IDS,
  PLACED_OBJECT_KINDS,
  STORY_QUEST_IDS,
  STRUCTURE_KINDS,
  TOOL_TYPES,
  UPGRADABLE_TOOLS,
  type Animal,
  type GameSections,
  type GameState,
  type ItemStack,
} from '../src/core/types';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import { EMPTY_TILE, blockedTile, forEachTile } from '../src/world/tiles';
import {
  BASE,
  TARGET,
  animal,
  cropOf,
  legacySave,
  livelySections,
  must,
  soilTile,
  stack,
  tileAt,
  withTile,
  type SaveJson,
} from './testUtils';

describe('identifier lists', () => {
  it('holds no duplicates in any list', () => {
    const lists: readonly (readonly (string | number)[])[] = [
      MAP_IDS,
      NPC_IDS,
      FORAGE_IDS,
      DISH_IDS,
      CRAFTING_RECIPE_IDS,
      STORY_QUEST_IDS,
      FESTIVAL_IDS,
      DECORATION_IDS,
      GIANT_CROP_IDS,
      STRUCTURE_KINDS,
      PLACED_OBJECT_KINDS,
      UPGRADABLE_TOOLS,
    ];
    for (const list of lists) expect(new Set(list).size).toBe(list.length);
  });

  it('draws giant crops from the crops and upgradable tools from the tools', () => {
    for (const id of GIANT_CROP_IDS) expect(CROP_IDS).toContain(id);
    for (const tool of UPGRADABLE_TOOLS) expect(TOOL_TYPES).toContain(tool);
    expect(UPGRADABLE_TOOLS).not.toContain('scythe');
  });

  it('appends the new blockers without renumbering the saved ones', () => {
    expect(Blocker).toEqual({ None: 0, Rock: 1, Stump: 2, Water: 3, House: 4, ShippingBin: 5, Tree: 6, Weeds: 7, Building: 8 });
  });

  it('adds the Phase 0 tuning constants', () => {
    expect(TOOLS.treeHits).toBe(4);
    expect(TOOLS.woodFromTree).toBe(4);
    expect(INVENTORY.chestSlots).toBe(36);
    expect(APPEARANCE).toEqual({ skinTones: 5, hairStyles: 3, hairColors: 6, shirtColors: 8, overallsColors: 6, hats: 4 });
    expect(PROFILE).toEqual({ maxNameLength: 24 });
    expect(LAYOUT.plots).toEqual([
      { x0: 20, z0: 3, width: 7, depth: 6 },
      { x0: 30, z0: 3, width: 8, depth: 7 },
    ]);
  });
});

describe('hash salts', () => {
  it('gives every Salt a distinct value', () => {
    const values = Object.values(Salt);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps the existing salts and adds the Phase 0 ones', () => {
    expect(Salt).toMatchObject({
      Debris: 0x1b873593,
      Weather: 0x2c1b3c6d,
      Untill: 0x297a2d39,
      Yield: 0x7ed55d16,
      Cosmetic: 0x165667b1,
      Wild: 0x5bd1e995,
      WildPick: 0x3c6ef372,
      MapForest: 0x68e31da4,
      MapTown: 0xb5297a4d,
      ForestGen: 0x1b56c4e9,
      TownGen: 0x7fb5d329,
      Quality: 0x2545f491,
      Weeds: 0x9e3779b9,
      Festival: 0xbf58476d,
      Gift: 0xa0761d65,
      Crow: 0x85ebca6b,
      GiantCrop: 0xc2b2ae35,
      Sap: 0x27d4eb2f,
      CopperOre: 0xd35a2d97,
      Forage: 0x4cf5ad43,
      NoticeBoard: 0x94d049bb,
      AnimalProduct: 0x632be5ab,
    });
    expect(Object.keys(Salt)).toHaveLength(22);
  });

  it('hashes salts at or above 2^31 as unsigned 32-bit values, distinctly', () => {
    const big = Object.values(Salt).filter((salt) => salt >= 2 ** 31);
    expect(big.length).toBeGreaterThan(0);
    const hashes = new Set<number>();
    for (const salt of big) {
      const h = hash32(1, 2, 3, salt);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
      expect(hash32(1, 2, 3, salt)).toBe(h);
      // Passing the salt as its signed 32-bit twin gives the same hash: inputs are taken mod 2^32.
      expect(hash32(1, 2, 3, salt | 0)).toBe(h);
      hashes.add(h);
    }
    expect(hashes.size).toBe(big.length);
  });
});

describe('createDefaultSections', () => {
  const idle = { points: 0, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 0 };
  const expected: GameSections = {
    profile: {
      playerName: 'Farmer',
      farmName: 'Meadowlight',
      appearance: { skinTone: 0, hairStyle: 0, hairColor: 0, shirtColor: 0, overallsColor: 0, hat: 0 },
    },
    tools: { levels: { hoe: 0, wateringCan: 0, pickaxe: 0, axe: 0 }, upgrade: null },
    crafting: { known: ['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'basicFertilizer'] },
    cooking: { known: ['friedMushrooms', 'veggieStew'], kitchenLevel: 0 },
    buildings: [],
    nextEntityId: 1,
    npcs: { marigold: idle, bram: idle, juniper: idle, tess: idle, fennick: idle, pip: idle },
    quests: { completed: [], board: null },
    stats: {
      parsnipsShipped: 0,
      debrisCleared: 0,
      forageFound: 0,
      totalEarned: 0,
      visitedTown: false,
      craftedChest: false,
      builtCoop: false,
    },
    festival: { activeDay: -1, eggsFound: 0, lanternReleased: false, display: [], giftTarget: null, giftGiven: false },
    robots: {
      nextId: 1,
      list: [],
      pool: 0,
      log: { nextId: 0, entries: [] },
      lastNightFuel: { wood: 0, tokens: 0 },
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      unlocks: UNLOCKS.job1,
      pendingMarker: false,
    },
  };

  it('matches the spec exactly', () => {
    expect(createDefaultSections()).toEqual(expected);
  });

  it('is what every new game starts with, for any seed', () => {
    for (const seed of [0, 7, 0xffffffff]) {
      const state = createInitialState(seed);
      for (const key of Object.keys(expected) as (keyof GameSections)[]) expect(state[key], key).toEqual(expected[key]);
    }
  });

  it('lists known recipes and dishes in canonical order', () => {
    const { crafting, cooking } = createDefaultSections();
    const order = (list: readonly string[], ids: readonly string[]): number[] => list.map((id) => ids.indexOf(id));
    expect(order(crafting.known, CRAFTING_RECIPE_IDS)).toEqual([...order(crafting.known, CRAFTING_RECIPE_IDS)].sort((a, b) => a - b));
    expect(order(cooking.known, DISH_IDS)).toEqual([0, 1]);
  });

  it('builds fresh objects on every call, so no two states share section data', () => {
    const a = createDefaultSections();
    const b = createDefaultSections();
    expect(a).toEqual(b);
    expect(a.npcs).not.toBe(b.npcs);
    expect(a.npcs.bram).not.toBe(b.npcs.bram);
    expect(a.profile).not.toBe(b.profile);
    expect(a.festival.display).not.toBe(b.festival.display);
  });

  it('passes validation and survives a save round trip', () => {
    expect(isValidGameState(BASE)).toBe(true);
    const restored: GameState | null = deserializeGame(serializeGame(BASE));
    expect(restored).toEqual(BASE);
  });
});

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

/** BASE with every section filled in far from its defaults, still valid. */
function lively(): GameState {
  return { ...BASE, ...livelySections() };
}

describe('saved sections', () => {
  it('accept and round-trip values far from the defaults', () => {
    const state = lively();
    // The cow's name is exactly as long as a name may be.
    expect(state.buildings[1]?.animals[0]?.name).toHaveLength(PROFILE.maxNameLength);
    expect(isValidGameState(state)).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('accept a building without animals, one still under construction, and an empty display', () => {
    const state: GameState = {
      ...lively(),
      buildings: [{ id: 5, kind: 'barn', plot: 1, readyDay: 400, troughWheat: 0, animals: [] }],
      nextEntityId: 6,
      festival: { ...BASE.festival, activeDay: 0 },
    };
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('saved sections reject', () => {
  const long = 'x'.repeat(PROFILE.maxNameLength + 1);
  const chickens = (ids: readonly number[]): Animal[] => ids.map((id) => animal(id, 'chicken', `Hen ${id}`));
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    // Profile
    ['a missing profile', ['profile'], undefined],
    ['an empty player name', ['profile', 'playerName'], ''],
    ['a blank player name', ['profile', 'playerName'], '   '],
    ['an untrimmed player name', ['profile', 'playerName'], ' Eli'],
    ['a player name that is too long', ['profile', 'playerName'], long],
    ['a farm name that is not a string', ['profile', 'farmName'], 5],
    ['an untrimmed farm name', ['profile', 'farmName'], 'Sunny Acres\n'],
    ['a skin tone past the palette', ['profile', 'appearance', 'skinTone'], APPEARANCE.skinTones],
    ['a negative hair style', ['profile', 'appearance', 'hairStyle'], -1],
    ['a hair colour past the palette', ['profile', 'appearance', 'hairColor'], APPEARANCE.hairColors],
    ['a fractional shirt colour', ['profile', 'appearance', 'shirtColor'], 1.5],
    ['an overalls colour past the palette', ['profile', 'appearance', 'overallsColor'], APPEARANCE.overallsColors],
    ['a hat past the list', ['profile', 'appearance', 'hat'], APPEARANCE.hats],
    ['a missing appearance', ['profile', 'appearance'], undefined],
    // Tools
    ['a tool level above steel', ['tools', 'levels', 'hoe'], 3],
    ['a missing tool level', ['tools', 'levels', 'axe'], undefined],
    ['a level for the scythe', ['tools', 'levels', 'scythe'], 0],
    ['an upgrade to level 0', ['tools', 'upgrade', 'level'], 0],
    ['an upgrade to level 3', ['tools', 'upgrade', 'level'], 3],
    ['an upgrade of the scythe', ['tools', 'upgrade', 'tool'], 'scythe'],
    ['an upgrade ready on day -1', ['tools', 'upgrade', 'readyDay'], -1],
    ['an upgrade that is not an object', ['tools', 'upgrade'], 'pickaxe'],
    // Crafting and cooking
    ['an unknown recipe', ['crafting', 'known'], ['chest', 'rocket']],
    ['a repeated recipe', ['crafting', 'known'], ['chest', 'chest']],
    ['recipes out of order', ['crafting', 'known'], ['woodFence', 'chest']],
    ['recipes that are not a list', ['crafting', 'known'], 'chest'],
    ['kitchen level 2', ['cooking', 'kitchenLevel'], 2],
    ['dishes out of order', ['cooking', 'known'], ['berryTart', 'friedMushrooms']],
    ['an unknown dish', ['cooking', 'known'], ['friedMushrooms', 'cake']],
    ['a repeated dish', ['cooking', 'known'], ['veggieStew', 'veggieStew']],
    // Buildings and the shared entity-id counter
    ['nextEntityId 0', ['nextEntityId'], 0],
    ['a building id of 0', ['buildings', 0, 'id'], 0],
    ['an animal id at nextEntityId', ['nextEntityId'], 7],
    ['a building id at nextEntityId', ['buildings', 1, 'id'], 8],
    ['two buildings sharing an id', ['buildings', 1, 'id'], 1],
    ['an animal sharing an id with a building', ['buildings', 0, 'animals', 2, 'id'], 2],
    ['an animal sharing an id with its own building', ['buildings', 1, 'animals', 0, 'id'], 2],
    ['animals in different buildings sharing an id', ['buildings', 1, 'animals', 0, 'id'], 3],
    ['animals in one building sharing an id', ['buildings', 0, 'animals', 1, 'id'], 3],
    ['a fractional animal id', ['buildings', 0, 'animals', 0, 'id'], 3.5],
    ['a plot past the layout', ['buildings', 1, 'plot'], LAYOUT.plots.length],
    ['a negative plot', ['buildings', 0, 'plot'], -1],
    ['two buildings on one plot', ['buildings', 1], { id: 2, kind: 'coop', plot: 0, readyDay: 9, troughWheat: 0, animals: [] }],
    ['the barn moved onto the occupied coop plot', ['buildings', 1, 'plot'], 0],
    ['a barn on the coop plot', ['buildings', 0], { id: 1, kind: 'barn', plot: 0, readyDay: 5, troughWheat: 0, animals: [] }],
    ['a coop on the barn plot', ['buildings', 1], { id: 2, kind: 'coop', plot: 1, readyDay: 9, troughWheat: 0, animals: [] }],
    ['an unknown building kind', ['buildings', 0, 'kind'], 'silo'],
    ['a fractional ready day', ['buildings', 0, 'readyDay'], 5.5],
    ['negative trough wheat', ['buildings', 0, 'troughWheat'], -1],
    ['animals that are not a list', ['buildings', 0, 'animals'], {}],
    ['five animals in a coop', ['buildings', 0, 'animals'], chickens([3, 4, 5, 6, 8])],
    ['a cow in the coop', ['buildings', 0, 'animals', 0, 'kind'], 'cow'],
    ['a chicken in the barn', ['buildings', 1, 'animals', 0, 'kind'], 'chicken'],
    ['an unknown animal kind', ['buildings', 1, 'animals', 0, 'kind'], 'goat'],
    ['happiness above 255', ['buildings', 0, 'animals', 1, 'happiness'], 256],
    ['negative happiness', ['buildings', 0, 'animals', 1, 'happiness'], -1],
    ['an empty animal name', ['buildings', 0, 'animals', 2, 'name'], ''],
    ['an animal name that is too long', ['buildings', 1, 'animals', 0, 'name'], long],
    ['a non-boolean fedToday', ['buildings', 0, 'animals', 0, 'fedToday'], 1],
    ['a missing hasProduct', ['buildings', 0, 'animals', 0, 'hasProduct'], undefined],
    ['a negative birth day', ['buildings', 0, 'animals', 0, 'bornDay'], -1],
    ['buildings that are not a list', ['buildings'], { 0: 'coop' }],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = lively();
    const text = corrupt(state, path, value);
    expect(text).not.toBe(serializeGame(state));
    expect(deserializeGame(text)).toBeNull();
    expect(isValidGameState(JSON.parse(text))).toBe(false);
  });
});

describe('saved NPCs, quests, stats and festival reject', () => {
  // Valid stacks, so the only fault in 'ten display stacks' is the tenth stack.
  const stacks = (count: number): ItemStack[] => Array.from({ length: count }, () => stack('wood', 1));
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    // NPCs
    ['a missing NPC', ['npcs', 'pip'], undefined],
    ['an unknown NPC', ['npcs', 'gus'], BASE.npcs.pip],
    ['npcs that are not an object', ['npcs'], []],
    ['friendship above 10 hearts', ['npcs', 'bram', 'points'], 2501],
    ['negative friendship', ['npcs', 'marigold', 'points'], -1],
    ['two gifts in one day', ['npcs', 'bram', 'giftsToday'], 2],
    ['three gifts in one week', ['npcs', 'bram', 'giftsThisWeek'], 3],
    ['heart events out of order', ['npcs', 'bram', 'heartEventsSeen'], [4, 2]],
    ['a repeated heart event', ['npcs', 'bram', 'heartEventsSeen'], [2, 2]],
    ['an unknown heart event level', ['npcs', 'tess', 'heartEventsSeen'], [3]],
    ['negative talks', ['npcs', 'juniper', 'talks'], -1],
    ['a non-boolean talkedToday', ['npcs', 'fennick', 'talkedToday'], 'yes'],
    ['an NPC that is not an object', ['npcs', 'tess'], 1000],
    // Quests
    ['an unknown story quest', ['quests', 'completed'], ['shipParsnips', 'slayDragon']],
    ['a repeated story quest', ['quests', 'completed'], ['visitTown', 'visitTown']],
    ['story quests out of order', ['quests', 'completed'], ['visitTown', 'shipParsnips']],
    ['a board request from an unknown NPC', ['quests', 'board', 'npc'], 'gus'],
    ['a board request for an unknown item', ['quests', 'board', 'itemId'], 'diamond'],
    ['a board request for nothing', ['quests', 'board', 'quantity'], 0],
    ['more delivered than requested', ['quests', 'board', 'delivered'], 6],
    ['a negative delivery', ['quests', 'board', 'delivered'], -1],
    ['an unknown board status', ['quests', 'board', 'status'], 'failed'],
    ['a negative board week', ['quests', 'board', 'week'], -1],
    ['a fractional due day', ['quests', 'board', 'dueDay'], 1.5],
    ['a board request that is not an object', ['quests', 'board'], 'potato'],
    // Stats
    ['negative parsnips shipped', ['stats', 'parsnipsShipped'], -1],
    ['negative debris cleared', ['stats', 'debrisCleared'], -3],
    ['a missing forage count', ['stats', 'forageFound'], undefined],
    ['fractional total earnings', ['stats', 'totalEarned'], 10.5],
    ['a numeric visitedTown', ['stats', 'visitedTown'], 1],
    ['a missing craftedChest', ['stats', 'craftedChest'], undefined],
    ['a string builtCoop', ['stats', 'builtCoop'], 'true'],
    // Festival
    ['a festival day before -1', ['festival', 'activeDay'], -2],
    ['a fractional festival day', ['festival', 'activeDay'], 1.5],
    ['a thirteenth egg', ['festival', 'eggsFound'], 4096],
    ['a negative egg mask', ['festival', 'eggsFound'], -1],
    ['a non-boolean lantern', ['festival', 'lanternReleased'], 'no'],
    ['ten display stacks', ['festival', 'display'], stacks(10)],
    ['an empty display stack', ['festival', 'display', 0, 'quantity'], 0],
    ['a display stack above maxStack', ['festival', 'display', 0, 'quantity'], INVENTORY.maxStack + 1],
    ['an unknown display item', ['festival', 'display', 1, 'itemId'], 'diamond'],
    ['a display stack without quality', ['festival', 'display', 0, 'quality'], undefined],
    ['a display quality of 3', ['festival', 'display', 0, 'quality'], 3],
    ['silver wood on display', ['festival', 'display', 1, 'quality'], 1],
    ['a gift target who is not an NPC', ['festival', 'giftTarget'], 'gus'],
    ['a missing giftGiven', ['festival', 'giftGiven'], undefined],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = lively();
    const text = corrupt(state, path, value);
    expect(text).not.toBe(serializeGame(state));
    expect(deserializeGame(text)).toBeNull();
    expect(isValidGameState(JSON.parse(text))).toBe(false);
  });

  it('a save missing any section', () => {
    for (const key of Object.keys(createDefaultSections())) {
      expect(deserializeGame(corrupt(lively(), [key], undefined)), key).toBeNull();
    }
  });
});

describe('migrating older saves to the current version', () => {
  /** A played state an old save can express: sown and wild crops, damaged debris, bumped revisions. */
  function played(): GameState {
    let state = withTile(BASE, TARGET, soilTile(TileState.Watered, cropOf('parsnip', { stage: 2 })));
    state = withTile(state, { tx: 8, tz: 12 }, blockedTile(Blocker.Rock, 1));
    state = withTile(state, { tx: 0, tz: 20 }, { ...EMPTY_TILE, crop: cropOf('mushroom', { wild: true }) });
    return { ...state, player: { ...state.player, gold: 1234 } };
  }

  it('turns a version-2 save into exactly the state it was taken from', () => {
    const state = played();
    const v2 = legacySave(state, 2);
    expect(v2.profile).toBeUndefined();
    const migrated = migrateSave(v2) as SaveJson;
    expect(migrated.version).toBe(SAVE_VERSION);
    const loaded = must(deserializeGame(JSON.stringify(v2)));
    expect(loaded).toEqual(state);
    expect(loaded.maps.farm.chunks.map((chunk) => chunk.revision)).toEqual(state.maps.farm.chunks.map((chunk) => chunk.revision));
    expect(loaded.maps.farm.chunks.some((chunk) => chunk.revision > 0)).toBe(true);
  });

  it('gives a version-2 save the section defaults and plain tiles', () => {
    const loaded = must(deserializeGame(JSON.stringify(legacySave(played(), 2))));
    for (const [key, value] of Object.entries(createDefaultSections())) expect(loaded[key as keyof GameSections], key).toEqual(value);
    forEachTile(loaded.maps.farm, (tile, tx, tz) => {
      expect(tile.object).toEqual(tx === WORKBENCH.home.tx && tz === WORKBENCH.home.tz ? { kind: 'workbench' } : null);
      expect(tile.fertilizer).toBeNull();
    });
  });

  it('replaces section-like leftovers in a version-2 save with the defaults', () => {
    const v2 = { ...legacySave(played(), 2), profile: { playerName: '' }, nextEntityId: -4 };
    const loaded = must(deserializeGame(JSON.stringify(v2)));
    expect(loaded.profile).toEqual(createDefaultSections().profile);
    expect(loaded.nextEntityId).toBe(1);
  });

  it('chains a version-1 save through version 2 to the current version', () => {
    const state = played();
    const v1 = legacySave(state, 1);
    const loaded = must(deserializeGame(JSON.stringify(v1)));
    expect(loaded.version).toBe(SAVE_VERSION);
    // Version 1 had no wild crops, so the mushrooms are gone; every other tile survives as it was.
    expect(tileAt(loaded, { tx: 0, tz: 20 })).toEqual(EMPTY_TILE);
    expect(tileAt(loaded, TARGET)).toEqual(tileAt(state, TARGET));
    expect(tileAt(loaded, TARGET).crop?.wild).toBe(false);
    forEachTile(state.maps.farm, (tile, tx, tz) => {
      const expected = tile.crop?.wild === true ? { ...tile, crop: null } : tile;
      expect(tileAt(loaded, { tx, tz }), `${tx},${tz}`).toEqual(expected);
    });
    expect({ ...loaded, maps: { ...loaded.maps, farm: null } }).toEqual({ ...state, maps: { ...state.maps, farm: null } });
    for (const [key, value] of Object.entries(createDefaultSections())) expect(loaded[key as keyof GameSections], key).toEqual(value);
  });

  it('leaves malformed old saves untouched, so validation rejects them', () => {
    const badSeed = { ...legacySave(played(), 2), seed: -1 };
    expect((migrateSave(badSeed) as SaveJson).version).toBe(2);
    expect(deserializeGame(JSON.stringify(badSeed))).toBeNull();
    const noWorld = legacySave(played(), 2);
    delete noWorld.world;
    expect(migrateSave(noWorld)).toBe(noWorld);
    expect(deserializeGame(JSON.stringify(noWorld))).toBeNull();
    const badTile = legacySave(played(), 1);
    (badTile.world as { chunks: { tiles: unknown[] }[] }).chunks[0]!.tiles[0] = 'grass';
    expect(deserializeGame(JSON.stringify(badTile))).toBeNull();
    for (const version of [0, 4, '2', null]) {
      const other = { ...legacySave(played(), 2), version };
      expect(migrateSave(other)).toBe(other);
      expect(deserializeGame(JSON.stringify(other))).toBeNull();
    }
  });
});
