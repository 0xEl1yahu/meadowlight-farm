/**
 * Save version 7 (farmclaws part 4a spec §6): the v6 → v7 migration, round trips of the part 4a
 * state, and one corrupted field per validation rule. Each part 4a task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { Direction, MAP_IDS, NPC_IDS, SAVE_VERSION, type GameState, type NpcId, type NpcTalk } from '../src/core/types';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import { hasExactKeys, isObj } from '../src/state/validation';
import { MAPS } from '../src/world/maps';
import { EMPTY_TILE } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, atDay, livelySections, must, v6Save, withPlayer, withTile, type SaveJson } from './testUtils';

/** `state` with the given characters' chats replaced. */
function withTalks(state: GameState, talks: Partial<Record<NpcId, NpcTalk>>): GameState {
  return { ...state, npcs: { ...state.npcs, ...talks } };
}

/** BASE with every section filled in far from its defaults, still valid. */
const lively = (): GameState => ({ ...BASE, ...livelySections() });

/**
 * What a v6 save can hold (Review Focus 1): mid-day in town, Bram talked to 12 times and today,
 * and chats with the other three shopkeepers. Sol, Cosmo and Barnaby have none, as version 6 has
 * no such characters.
 */
function chatted(): GameState {
  const state = withTalks(lively(), {
    marigold: { talks: 5, talkedToday: false },
    bram: { talks: 12, talkedToday: true },
    juniper: { talks: 1, talkedToday: true },
    tess: { talks: 30, talkedToday: false },
  });
  return withPlayer(atDay(state, 3, 780), { tx: 10, tz: 16 }, Direction.East, 'town');
}

/** The v6 JSON of `state`, with `edit` applied to it. */
function v6With(state: GameState, edit: (save: SaveJson) => void): SaveJson {
  const save = v6Save(state);
  edit(save);
  return save;
}

const npcsOf = (save: SaveJson) => save.npcs as SaveJson;
/** One saved character's record. */
const npcOf = (save: SaveJson, id: string) => must(npcsOf(save)[id]) as SaveJson;
const questsOf = (save: SaveJson) => save.quests as SaveJson & { board: SaveJson | null };
const festivalOf = (save: SaveJson) => save.festival as SaveJson;

/** Loads raw save JSON as the game would. */
const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

describe('save version 7', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(7);
    expect(BASE.version).toBe(7);
  });

  it('starts every character at no chats', () => {
    expect(Object.keys(BASE.npcs)).toEqual(['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']);
    for (const id of NPC_IDS) expect(BASE.npcs[id]).toEqual({ talks: 0, talkedToday: false });
  });

  it('round-trips a farm with lively sections', () => {
    const state = lively();
    expect(state.npcs.bram).toEqual({ talks: 40, talkedToday: true });
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('round-trips a game standing in town with chats on record', () => {
    const state = chatted();
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('v6 → v7', () => {
  it('writes version 7', () => {
    expect((migrateSave(v6Save(chatted())) as SaveJson).version).toBe(7);
  });

  it('loads a v6 save as the state it was taken from', () => {
    const state = chatted();
    expect(must(load(v6Save(state)))).toEqual(state);
  });

  it("keeps the shopkeepers' chats, starts Sol, Cosmo and Barnaby at none, and drops Fennick, Pip and friendship", () => {
    const state = chatted();
    const save = v6With(state, (s) => {
      const npcs = npcsOf(s);
      npcs.bram = { ...npcOf(s, 'bram'), points: 2500, giftsToday: 1, giftsThisWeek: 2, heartEventsSeen: [2, 4, 6] };
      npcs.fennick = { points: 1500, talkedToday: true, giftsToday: 0, giftsThisWeek: 1, heartEventsSeen: [2], talks: 9 };
      npcs.pip = { points: 250, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 2 };
    });
    expect(Object.keys(npcsOf(save))).toEqual(['marigold', 'bram', 'juniper', 'tess', 'fennick', 'pip']);
    const migrated = migrateSave(save) as SaveJson;
    expect(npcsOf(migrated)).toEqual({
      sol: { talks: 0, talkedToday: false },
      cosmo: { talks: 0, talkedToday: false },
      barnaby: { talks: 0, talkedToday: false },
      marigold: { talks: 5, talkedToday: false },
      bram: { talks: 12, talkedToday: true },
      juniper: { talks: 1, talkedToday: true },
      tess: { talks: 30, talkedToday: false },
    });
    for (const id of NPC_IDS) expect(hasExactKeys(npcOf(migrated, id), ['talks', 'talkedToday']), id).toBe(true);
    const loaded = must(load(save));
    expect(loaded).toEqual(state);
    expect(loaded.player.mapId).toBe('town');
  });

  it('drops a board request from Fennick or Pip, and keeps one from Juniper', () => {
    const state = chatted();
    expect(state.quests.board?.npc).toBe('juniper');
    expect(must(load(v6Save(state))).quests).toEqual(state.quests);
    for (const npc of ['fennick', 'pip']) {
      const save = v6With(state, (s) => void (must(questsOf(s).board).npc = npc));
      expect(questsOf(migrateSave(save) as SaveJson).board, npc).toBeNull();
      expect(must(load(save))).toEqual({ ...state, quests: { ...state.quests, board: null } });
    }
  });

  it('drops a festival gift target of Fennick or Pip, and keeps Tess', () => {
    const state = chatted();
    expect(state.festival.giftTarget).toBe('tess');
    expect(must(load(v6Save(state))).festival).toEqual(state.festival);
    for (const npc of ['fennick', 'pip']) {
      const save = v6With(state, (s) => void (festivalOf(s).giftTarget = npc));
      expect(festivalOf(migrateSave(save) as SaveJson).giftTarget, npc).toBeNull();
      expect(must(load(save))).toEqual({ ...state, festival: { ...state.festival, giftTarget: null } });
    }
  });

  it('accepts a v6 save whose npcs already have the v7 shape', () => {
    const state = chatted();
    const save = v6With(state, (s) => void (s.npcs = JSON.parse(JSON.stringify(state.npcs)) as SaveJson));
    expect(must(load(save))).toEqual(state);
  });

  it('migrates the version-2 fixture through every version to 7', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(7);
    expect(loaded.npcs).toEqual(BASE.npcs);
    expect(loaded.quests.board).toBeNull();
    expect(loaded.festival.giftTarget).toBeNull();
  });

  it('leaves a v6 save whose npcs are not an object for the validator to reject', () => {
    const save = v6With(BASE, (s) => void (s.npcs = 'everyone'));
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });

  it('copies a corrupt shopkeeper as found, so the validator still rejects it', () => {
    const corrupt: readonly [string, (save: SaveJson) => void][] = [
      ['negative talks', (s) => void (npcOf(s, 'bram').talks = -1)],
      ['a non-boolean talkedToday', (s) => void (npcOf(s, 'tess').talkedToday = 'yes')],
      ['a missing shopkeeper', (s) => void delete npcsOf(s).marigold],
      ['a shopkeeper that is not an object', (s) => void (npcsOf(s).juniper = 7)],
    ];
    for (const [label, edit] of corrupt) {
      const save = v6With(chatted(), edit);
      expect((migrateSave(save) as SaveJson).version, label).toBe(7);
      expect(load(save), label).toBeNull();
    }
  });

  it('v6Save refuses chats with Sol, Cosmo or Barnaby', () => {
    for (const id of ['sol', 'cosmo', 'barnaby'] as const) {
      expect(() => v6Save(withTalks(BASE, { [id]: { talks: 1, talkedToday: false } })), id).toThrow('v6Save');
      expect(() => v6Save(withTalks(BASE, { [id]: { talks: 0, talkedToday: true } })), id).toThrow('v6Save');
    }
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v6Save(BASE), version: 8 };
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });
});

describe('save version 7 rejects', () => {
  type JsonPath = readonly string[];
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    ['a missing character', ['npcs', 'cosmo'], undefined],
    ['a removed character', ['npcs', 'fennick'], { talks: 0, talkedToday: false }],
    ['an unknown character', ['npcs', 'gus'], { talks: 0, talkedToday: false }],
    ['a friendship field', ['npcs', 'bram', 'points'], 0],
    ['an extra field', ['npcs', 'sol', 'mood'], 'happy'],
    ['a missing talks', ['npcs', 'barnaby', 'talks'], undefined],
    ['negative talks', ['npcs', 'juniper', 'talks'], -1],
    ['fractional talks', ['npcs', 'tess', 'talks'], 2.5],
    ['talks that are not a number', ['npcs', 'marigold', 'talks'], '3'],
    ['a missing talkedToday', ['npcs', 'bram', 'talkedToday'], undefined],
    ['a non-boolean talkedToday', ['npcs', 'barnaby', 'talkedToday'], 'yes'],
    ['a character that is not an object', ['npcs', 'sol'], 0],
    ['a board request from Fennick', ['quests', 'board', 'npc'], 'fennick'],
    ['a board request from Pip', ['quests', 'board', 'npc'], 'pip'],
    ['Fennick as the gift target', ['festival', 'giftTarget'], 'fennick'],
    ['Pip as the gift target', ['festival', 'giftTarget'], 'pip'],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = lively();
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    let node: SaveJson = save;
    for (const key of path.slice(0, -1)) {
      const next = node[key];
      if (!isObj(next)) throw new Error(`no object at ${key}`);
      node = next;
    }
    const last = must(path[path.length - 1]);
    if (value === undefined) delete node[last];
    else node[last] = value;
    expect(JSON.stringify(save)).not.toBe(serializeGame(state));
    expect(isValidGameState(save)).toBe(false);
    expect(load(save)).toBeNull();
  });
});

describe('the Neighbours map in saves', () => {
  const onTheLane = (): GameState => withPlayer(BASE, { tx: 1, tz: 14 }, Direction.East, 'neighbours');

  it('round-trips a game standing on the Neighbours map', () => {
    const state = onTheLane();
    expect(must(deserializeGame(serializeGame(state)))).toEqual(state);
  });

  it('adds the Neighbours map to a v6 save made in town, and leaves the player in town', () => {
    const state = chatted();
    const save = v6Save(state);
    expect(Object.keys(save.maps as SaveJson)).toEqual(['farm', 'forest', 'town']);
    expect(Object.keys((migrateSave(save) as SaveJson).maps as SaveJson)).toEqual([...MAP_IDS]);
    const loaded = must(load(save));
    expect(loaded.maps.neighbours).toEqual(MAPS.neighbours.generate(state.seed));
    expect(loaded.maps.town).toEqual(state.maps.town);
    expect(loaded.player).toEqual(state.player);
  });

  it('leaves a v6 save with a malformed seed without the map, for the validator to reject', () => {
    const save = { ...v6Save(BASE), seed: -1 };
    expect('neighbours' in ((migrateSave(save) as SaveJson).maps as SaveJson)).toBe(false);
    expect(load(save)).toBeNull();
  });

  it('v6Save refuses a player on the Neighbours map, or a Neighbours map that changed', () => {
    expect(() => v6Save(onTheLane())).toThrow('v6Save');
    const changed = withTile(BASE, { tx: 15, tz: 8 }, { ...EMPTY_TILE, object: { kind: 'woodPath' } }, 'neighbours');
    expect(() => v6Save(changed)).toThrow('v6Save');
  });

  it('rejects a Neighbours map that is missing, the wrong size or another map, and a player standing on a fence', () => {
    const save = JSON.parse(serializeGame(onTheLane())) as SaveJson;
    const maps = (copy: SaveJson): SaveJson => copy.maps as SaveJson;
    const corrupt = (edit: (copy: SaveJson) => void): SaveJson => {
      const copy = JSON.parse(JSON.stringify(save)) as SaveJson;
      edit(copy);
      return copy;
    };
    expect(load(save)).not.toBeNull();
    const broken = [
      corrupt((c) => {
        delete maps(c).neighbours;
      }),
      corrupt((c) => {
        (maps(c).neighbours as { grid: SaveJson }).grid.width = 48;
      }),
      corrupt((c) => {
        maps(c).neighbours = maps(c).town;
      }),
      corrupt((c) => {
        Object.assign(c.player as SaveJson, { tx: 3, tz: 8 });
      }),
    ];
    for (const bad of broken) {
      expect(isValidGameState(bad)).toBe(false);
      expect(load(bad)).toBeNull();
    }
  });
});
