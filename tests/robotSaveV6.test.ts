/**
 * Save version 6 (farmclaws part 3 spec §9): the v5 → v6 migration, round trips of the part 3
 * state, and one corrupted field per validation rule. Each part 3 task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, UNLOCKS, WORKBENCH } from '../src/config';
import { Blocker, Direction, SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { freeSpotNear } from '../src/robots/workbench';
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { locateTile } from '../src/world/grid';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, TARGET, benchedRobotOf, must, robotOf, stack, v5Save, withPlayer, withRobots, withSlots, withTile, withZones, type SaveJson } from './testUtils';

const WALK = b.program({ stacks: [b.when(b.morning(), b.move())] });

/** What a v5 save can hold: a script robot, an idle block robot with an .MD, and a zone. */
function v5Farm(): GameState {
  const robots = [
    robotOf({ id: 1 }),
    robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK), md: [{ kind: 'dontGoIntoWater' }] }),
  ];
  return withZones(withRobots(BASE, robots), { A: { x0: 3, z0: 9, w: 4, d: 3 } });
}

/** `state` as deserializeGame returns it: no panel open, unpaused. */
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[] };
/** The first saved robot. */
const firstRobot = (save: SaveJson): SaveJson => must(robotsOf(save).list[0]);

describe('save version 6', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(6);
    expect(BASE.version).toBe(6);
  });

  it('round-trips a farm with robots and zones', () => {
    const state = v5Farm();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });
});

describe('v5 → v6', () => {
  it('writes version 6', () => {
    expect((migrateSave(v5Save(v5Farm())) as SaveJson).version).toBe(6);
  });

  it('loads a v5 save as the state it was taken from', () => {
    const state = v5Farm();
    expect(must(deserializeGame(JSON.stringify(v5Save(state))))).toEqual(state);
  });

  it('migrates the version-2 fixture through every version to 6', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(6);
    expect(loaded.robots.list).toEqual([]);
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v5Save(BASE), version: 7 };
    expect(migrateSave(save)).toBe(save);
    expect(deserializeGame(JSON.stringify(save))).toBeNull();
  });
});

describe('robot stats in save version 6', () => {
  const STATS: RobotStats = { today: { tokens: 5, actions: 2, crops: 1 }, week: { tokens: 40, actions: 9, crops: 3 } };
  const counted = (): GameState => withRobots(BASE, [robotOf({ stats: STATS })]);
  const statsJson = (save: SaveJson) => firstRobot(save).stats as { today: SaveJson; week: SaveJson };

  it("round-trips today's and this week's counters", () => {
    const state = counted();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it("turns a v5 robot's tokensToday into today's and this week's tokens", () => {
    const state = withRobots(BASE, [robotOf({ stats: { today: { tokens: 12, actions: 0, crops: 0 }, week: { tokens: 12, actions: 0, crops: 0 } } })]);
    const save = v5Save(state);
    expect(firstRobot(save).tokensToday).toBe(12);
    expect(firstRobot(save)).not.toHaveProperty('stats');
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(state);
  });

  it('cannot write counters a v5 save has no room for', () => {
    expect(() => v5Save(counted())).toThrow('v5Save');
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['a negative count', (s) => void (statsJson(s).today.tokens = -1)],
    ['a fractional count', (s) => void (statsJson(s).week.actions = 1.5)],
    ['more tokens today than this week', (s) => void (statsJson(s).today.tokens = 41)],
    ['more actions today than this week', (s) => void (statsJson(s).today.actions = 10)],
    ['more crops today than this week', (s) => void (statsJson(s).today.crops = 4)],
    ['a missing counter', (s) => void delete statsJson(s).week.crops],
    ['an unknown counter', (s) => void (statsJson(s).today.coins = 1)],
    ['stats without a week', (s) => void delete (firstRobot(s).stats as SaveJson).week],
    ['a leftover tokensToday', (s) => void (firstRobot(s).tokensToday = 5)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(counted(), edit)).toBeNull();
  });
});

describe('unlocks in save version 6', () => {
  it("gives a v5 save job 1's unlocks", () => {
    const save = v5Save(BASE);
    expect(robotsOf(save)).not.toHaveProperty('unlocks');
    expect(robotsOf(migrateSave(save) as SaveJson).unlocks).toEqual(UNLOCKS.job1);
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('round-trips every unlock', () => {
    const state = withUnlocks(BASE, ALL_UNLOCKS);
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('cannot write unlocks beyond job 1 to a v5 save', () => {
    expect(() => v5Save(withUnlocks(BASE, { tabs: ['stats'] }))).toThrow('v5Save');
  });
});

describe('the workbench in save version 6', () => {
  const HOME = WORKBENCH.home;
  const AT_BENCH = { tx: HOME.tx, tz: HOME.tz + 1 };
  const chest = { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) };
  const benchTile = { ...EMPTY_TILE, object: { kind: 'workbench' as const } };
  const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

  /** The saved farm tile at (tx, tz). */
  function farmTile(save: SaveJson, tx: number, tz: number): SaveJson {
    const farm = (save.maps as SaveJson).farm as { chunks: { tiles: SaveJson[] }[] };
    const at = locateTile(BASE.maps.farm.grid, tx, tz);
    return must(must(farm.chunks[at.chunkIndex]).tiles[at.localIndex]);
  }
  const savedRobot = (save: SaveJson, index: number): SaveJson => must(robotsOf(save).list[index]);

  /** Sprocket switched off on the bench, Bolt working in the field. */
  const BENCHED: GameState = withRobots(BASE, [benchedRobotOf({ off: 'player' }), robotOf({ id: 2, name: 'Bolt' })]);

  /** Sprocket carried to the bench and put on it through the reducer: its screen is open. */
  const carryToBench = (): GameState => {
    const carrying = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    return gameReducer(withPlayer(carrying, AT_BENCH, Direction.North), actions.interact());
  };

  it('round-trips robots on and around the bench in every state the game makes', () => {
    const real = carryToBench();
    expect(real.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    const lifted = gameReducer(real, actions.liftOffBench(1));
    const states = [
      BENCHED,
      real,
      lifted,
      withRobots(BASE, [benchedRobotOf({ power: 'broken' })]),
      withRobots(BASE, [benchedRobotOf({ power: 'flat', tokens: 0, off: 'player' })]),
      withRobots(BASE, [robotOf({ power: 'repairing', repairReadyDay: 1, tx: HOME.tx, tz: HOME.tz })]),
    ];
    for (const state of states) expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates a v5 save: the workbench goes home and no robot is on it', () => {
    const state = withRobots(BASE, [robotOf(), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10 })]);
    const v5 = v5Save(state);
    expect(farmTile(v5, HOME.tx, HOME.tz).object).toBeNull();
    const migrated = migrateSave(v5) as SaveJson;
    expect(farmTile(migrated, HOME.tx, HOME.tz).object).toEqual({ kind: 'workbench' });
    expect([savedRobot(migrated, 0).onBench, savedRobot(migrated, 1).onBench]).toEqual([false, false]);
    expect(load(v5)).toEqual(state);
  });

  it('puts the workbench on the nearest free tile when home is built on, past robots and the player', () => {
    // In v5 the player built a chest at home; a robot stands north of it and the player east of it.
    let state = withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm');
    state = withTile(state, AT_BENCH, benchTile, 'farm');
    state = withPlayer(withRobots(state, [robotOf({ tx: HOME.tx, tz: HOME.tz - 1 })]), { tx: HOME.tx + 1, tz: HOME.tz }, Direction.West);
    const v5 = v5Save(state);
    expect(farmTile(v5, AT_BENCH.tx, AT_BENCH.tz).object).toBeNull();
    expect(farmTile(migrateSave(v5) as SaveJson, AT_BENCH.tx, AT_BENCH.tz).object).toEqual({ kind: 'workbench' });
    expect(load(v5)).toEqual(state);
  });

  it('never puts the migrated workbench on the spawn tile, even when it is the nearest free tile', () => {
    // The player stands off the spawn tile, so only the migration's own rule keeps the bench off it.
    const away = { tx: PLAYER.spawn.tx + 1, tz: PLAYER.spawn.tz };
    // Home is built on too (a chest replaces the bench, as in a v5 farm, which has none).
    let state = withPlayer(withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm'), away, Direction.South);
    // Build a chest on each nearest free tile in turn until the spawn tile is the nearest free one left.
    for (let built = 0; built < 100; built++) {
      const spot = freeSpotNear(state.maps.farm, HOME, [away]);
      if (spot.tx === PLAYER.spawn.tx && spot.tz === PLAYER.spawn.tz) break;
      state = withTile(state, spot, { ...EMPTY_TILE, object: chest }, 'farm');
    }
    expect(freeSpotNear(state.maps.farm, HOME, [away])).toEqual(PLAYER.spawn);
    const migrated = migrateSave(v5Save(state)) as SaveJson;
    expect(farmTile(migrated, PLAYER.spawn.tx, PLAYER.spawn.tz).object).toBeNull();
    expect(load(v5Save(state))).not.toBeNull();
  });

  it('counts a robot standing on home as built on, but not a carried robot that left from it', () => {
    let standing = withTile(BASE, HOME, EMPTY_TILE, 'farm');
    standing = withTile(standing, { tx: HOME.tx, tz: HOME.tz - 1 }, benchTile, 'farm');
    standing = withRobots(standing, [robotOf({ tx: HOME.tx, tz: HOME.tz })]);
    expect(load(v5Save(standing))).toEqual(standing);
    const lifted = gameReducer(carryToBench(), actions.liftOffBench(1));
    expect(requireRobot(lifted, 1)).toMatchObject({ carried: true, tx: HOME.tx, tz: HOME.tz });
    expect(load(v5Save(lifted))).toEqual(lifted);
  });

  it('cannot write a robot on the bench or switched off to a v5 save', () => {
    expect(() => v5Save(BENCHED)).toThrow('v5Save');
    expect(() => v5Save(withRobots(BASE, [robotOf({ off: 'player' })]))).toThrow('v5Save');
  });

  it('rejects a workbench off the farm', () => {
    const forest = { tx: 10, tz: 10 };
    expect(deserializeGame(serializeGame(withTile(BASE, forest, { ...EMPTY_TILE, object: chest }, 'forest')))).not.toBeNull();
    expect(deserializeGame(serializeGame(withTile(BASE, forest, benchTile, 'forest')))).toBeNull();
  });

  const rejections: readonly [string, GameState, (save: SaveJson) => void][] = [
    ['no workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = null)],
    ['a second workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx + 2, HOME.tz).object = { kind: 'workbench' })],
    ['a workbench with a field', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = { kind: 'workbench', level: 1 })],
    ['a robot on the bench off the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).tx = HOME.tx + 1)],
    ['a carried robot on the bench', BENCHED, (s) => void (Object.assign(savedRobot(s, 0), { carried: true }), ((s.player as SaveJson).carrying = 1))],
    ['a robot on the bench away for repairs', BENCHED, (s) => void Object.assign(savedRobot(s, 0), { power: 'repairing', repairReadyDay: 1, off: null })],
    ['two robots on the bench', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { onBench: true, tx: HOME.tx, tz: HOME.tz })],
    ['a robot off the bench on the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).onBench = false)],
    ['a missing onBench', BENCHED, (s) => void delete savedRobot(s, 1).onBench],
    ['an onBench that is not a boolean', BENCHED, (s) => void (savedRobot(s, 1).onBench = 0)],
    ['an unknown off reason', BENCHED, (s) => void (savedRobot(s, 0).off = 'sleepy')],
    ['a broken robot switched off', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { power: 'broken', off: 'player' })],
  ];

  it.each(rejections)('rejects %s', (_label, state, edit) => {
    expect(deserializeGame(serializeGame(state))).not.toBeNull();
    expect(corrupt(state, edit)).toBeNull();
  });
});

describe('save version 6: ruin and paint', () => {
  const POND = { tx: 6, tz: 12 };
  const ROCK = { tx: 8, tz: 12 };

  /** Sprocket ruined in the pond (painted Rose), Bolt ruined on land, Cog painted Cream, and a crashed and a ruined entry. */
  function ruinedAndPainted(): GameState {
    const ground = withTile(withTile(BASE, POND, blockedTile(Blocker.Water), 'farm'), ROCK, blockedTile(Blocker.Rock, 2), 'farm');
    const state = withRobots(ground, [
      robotOf({ id: 1, power: 'ruined', tx: POND.tx, tz: POND.tz, paint: 4 }),
      robotOf({ id: 2, name: 'Bolt', power: 'ruined', tx: 4, tz: 12 }),
      robotOf({ id: 3, name: 'Cog', tx: 3, tz: 12, paint: 15 }),
    ]);
    const entries = [
      { id: 0, day: 0, minute: 380, robotId: 3, tx: 3, tz: 12, event: { kind: 'crashed' as const, withId: 2, forgot: { kind: 'atTime' as const, minute: 840 } }, count: 1 },
      { id: 1, day: 0, minute: 380, robotId: 1, tx: POND.tx, tz: POND.tz, event: { kind: 'ruined' as const }, count: 1 },
    ];
    return { ...state, robots: { ...state.robots, log: { nextId: 2, entries } } };
  }

  /** Serialises `state`, lets `edit` change the saved robots section, and loads it again. */
  function edited(edit: (robots: SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } }) => void): GameState | null {
    const save = JSON.parse(serializeGame(ruinedAndPainted())) as SaveJson;
    edit(save.robots as SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } });
    return deserializeGame(JSON.stringify(save));
  }

  it('round-trips ruined robots in the water and on land, paint, and the crashed and ruined events', () => {
    const state = ruinedAndPainted();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates every robot to paint 0, and v5Save refuses a ruined robot', () => {
    const save = v5Save(withRobots(BASE, [robotOf({ paint: 9 })]));
    expect(((save.robots as SaveJson).list as SaveJson[]).map((r) => 'paint' in r)).toEqual([false]);
    expect(must(deserializeGame(JSON.stringify(save))).robots.list.map((r) => r.paint)).toEqual([0]);
    expect(() => v5Save(ruinedAndPainted())).toThrow('version 5 has no ruined robots');
  });

  it('v5Save refuses the version 6 crashed and ruined log events', () => {
    const entries = ruinedAndPainted().robots.log.entries;
    const logged = (index: number): GameState => {
      const state = withRobots(BASE, [robotOf()]);
      return { ...state, robots: { ...state.robots, log: { nextId: 1, entries: [{ ...entries[index]!, id: 0, robotId: 1 }] } } };
    };
    expect(() => v5Save(logged(0))).toThrow('version 5 has no crashed log events');
    expect(() => v5Save(logged(1))).toThrow('version 5 has no ruined log events');
  });

  const rejections: readonly [string, (robots: SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } }) => void][] = [
    ['a paint past the 16 colours', (s) => void (s.list[2]!.paint = 16)],
    ['a negative paint', (s) => void (s.list[2]!.paint = -1)],
    ['a fractional paint', (s) => void (s.list[2]!.paint = 1.5)],
    ['a paint that is not a number', (s) => void (s.list[2]!.paint = '3')],
    ['a robot without paint', (s) => void delete s.list[2]!.paint],
    ['a ruined robot on a rock', (s) => void Object.assign(s.list[1]!, { tx: ROCK.tx, tz: ROCK.tz })],
    ['a ruined robot that is off', (s) => void (s.list[1]!.off = 'dizzy')],
    ['a ruined robot with a repair day', (s) => void (s.list[1]!.repairReadyDay = 3)],
    ['an unknown power', (s) => void (s.list[1]!.power = 'rusty')],
    ['a ruined event with a field', (s) => void ((s.log.entries[1]!.event as SaveJson).withId = 2)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(edited(edit)).toBeNull();
  });
});

describe('v6: the zone marker and the zone draft', () => {
  /** Every unlocked slot full: no room for the marker. */
  const FULL = withSlots(BASE, Array.from({ length: INVENTORY.startingUnlockedSlots }, (_, i) => stack(i % 2 === 0 ? 'stone' : 'wood', 5)));
  const MARKER = stack('zoneMarker', 1);
  const corrupt = (edit: (save: SaveJson) => void): SaveJson => {
    const save = JSON.parse(serializeGame(BASE)) as SaveJson;
    edit(save);
    return save;
  };

  it('gives a migrated save the marker in its first free slot', () => {
    const save = v5Save(BASE);
    expect(JSON.stringify(save)).not.toContain('zoneMarker');
    const loaded = must(deserializeGame(JSON.stringify(save)));
    expect(loaded.inventory.slots[INVENTORY.starting.length]).toEqual(MARKER);
    expect(loaded.robots.pendingMarker).toBe(false);
    expect(loaded.ui.zoneDraft).toBeNull();
    expect(loaded.ui.zoneLetter).toBe('A');
    expect(loaded).toEqual(BASE);
  });

  it('owes the marker to a migrated save whose backpack is full', () => {
    const save = v5Save(FULL);
    expect((migrateSave(save) as { robots: SaveJson }).robots.pendingMarker).toBe(true);
    const loaded = must(deserializeGame(JSON.stringify(save)));
    expect(countItem(loaded.inventory, 'zoneMarker')).toBe(0);
    expect(loaded).toEqual({ ...FULL, robots: { ...FULL.robots, pendingMarker: true } });
  });

  it('never hands out a second marker', () => {
    const save = { ...v5Save(BASE), inventory: (JSON.parse(serializeGame(BASE)) as SaveJson).inventory };
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('round-trips a pending marker', () => {
    const pending: GameState = { ...FULL, robots: { ...FULL.robots, pendingMarker: true } };
    expect(deserializeGame(serializeGame(pending))).toEqual(loadedFrom(pending));
  });

  it('saves a zone draft and letter but loads with no draft and Zone A', () => {
    const drafting: GameState = { ...BASE, ui: { ...BASE.ui, zoneDraft: { zone: 'C', corner: { tx: 5, tz: 10 } }, zoneLetter: 'C' } };
    expect(isValidGameState(JSON.parse(serializeGame(drafting)))).toBe(true);
    expect(must(deserializeGame(serializeGame(drafting))).ui).toEqual(BASE.ui);
  });

  it('accepts the marker in a chest, but never two markers', () => {
    const chestWith = (state: GameState): GameState =>
      withTile(state, TARGET, { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, (_, i) => (i === 0 ? MARKER : null)) } });
    const moved = chestWith(withSlots(BASE, BASE.inventory.slots.map((slot) => (slot !== null && slot.itemId === 'zoneMarker' ? null : slot))));
    expect(isValidGameState(JSON.parse(serializeGame(moved)))).toBe(true);
    expect(isValidGameState(JSON.parse(serializeGame(chestWith(BASE))))).toBe(false);
  });

  const rejected: readonly [string, (save: SaveJson) => void][] = [
    ['pendingMarker while a marker is held', (s) => void ((s.robots as SaveJson).pendingMarker = true)],
    ['a pendingMarker that is not a boolean', (s) => void ((s.robots as SaveJson).pendingMarker = 1)],
    ['a missing pendingMarker', (s) => void delete (s.robots as SaveJson).pendingMarker],
    ['two markers in the inventory', (s) => void ((s.inventory as { slots: unknown[] }).slots[7] = { itemId: 'zoneMarker', quantity: 1, quality: 0 })],
    ['a draft on an unknown zone', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'Z', corner: { tx: 5, tz: 10 } })],
    ['a draft corner off the farm', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 999, tz: 0 } })],
    ['a draft corner that is not a whole tile', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 5.5, tz: 10 } })],
    ['a draft with an extra key', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 5, tz: 10 }, w: 3 })],
    ['an unknown zone letter', (s) => void ((s.ui as SaveJson).zoneLetter = 'I')],
    ['a missing zone letter', (s) => void delete (s.ui as SaveJson).zoneLetter],
  ];

  it.each(rejected)('rejects %s', (_label, edit) => {
    const save = corrupt(edit);
    expect(isValidGameState(save)).toBe(false);
    expect(deserializeGame(JSON.stringify(save))).toBeNull();
  });
});
