/**
 * Save version 4: the robots section, player.carrying, the v3 → v4 migration and validation.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, type GameState, type Robot } from '../src/core/types';
import { isValidRobotsSection } from '../src/state/robotValidation';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { blockedTile } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, TARGET, must, robotOf, v5Save, withRobots, withTile, type SaveJson } from './testUtils';

const WATER = { tx: 6, tz: 10 };

/** Robots in every state part 1 knows: working, standby, flat, broken in water, repairing, carried. */
function lively(): GameState {
  const base = withTile(BASE, WATER, blockedTile(Blocker.Water), 'farm');
  const robots: Robot[] = [
    robotOf({ id: 1, name: 'Ada', bag: [{ itemId: 'parsnip', quantity: 3, quality: 1 }] }),
    robotOf({ id: 2, name: 'Bolt', power: 'standby', tx: 4, tz: 10 }),
    robotOf({ id: 3, name: 'Cog', power: 'flat', tokens: 0, tx: 3, tz: 10 }),
    robotOf({ id: 4, name: 'Dot', power: 'broken', tx: WATER.tx, tz: WATER.tz, parts: ['wateringHead'], tank: 7 }),
    robotOf({ id: 6, name: 'Echo', power: 'repairing', repairReadyDay: 1, tx: 2, tz: 10 }),
    robotOf({ id: 7, name: 'Fizz', carried: true, nextActMinute: TIME.passOutMinute + 30 }),
    // Mid-wait past midnight: pc is past the wait step and the next act falls after passOut.
    robotOf({
      id: 8,
      name: 'Gus',
      tx: 1,
      tz: 10,
      program: { kind: 'script', steps: [{ kind: 'wait', minutes: 200 }, { kind: 'turn', side: 'left' }], loop: true },
      pc: 1,
      nextActMinute: TIME.passOutMinute + 200,
    }),
  ];
  const state = withRobots(base, robots);
  return {
    ...state,
    player: { ...state.player, carrying: 7 },
    robots: {
      ...state.robots,
      nextId: 10,
      pool: 42,
      lastNightFuel: { wood: 5, tokens: 30 },
      log: {
        nextId: 3,
        entries: [
          { id: 0, day: 0, minute: 364, robotId: 1, tx: TARGET.tx, tz: TARGET.tz, event: { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 3, quality: 1 } }, count: 1 },
          { id: 2, day: 0, minute: 368, robotId: 4, tx: WATER.tx, tz: WATER.tz, event: { kind: 'shortedOut' }, count: 2 },
        ],
      },
    },
  };
}

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } };

describe('save version 4', () => {
  it('round-trips robots in every state', () => {
    const state = lively();
    expect(deserializeGame(serializeGame(state))).toEqual({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });
  });

  it('migrates a version-3 save to an empty robots section', () => {
    const save = v5Save(BASE);
    delete save.robots;
    delete (save.player as SaveJson).carrying;
    save.version = 3;
    const migrated = migrateSave(save) as SaveJson;
    expect(migrated.version).toBe(7);
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('migrates the version-2 fixture all the way to 7', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(7);
    expect(loaded.robots.list).toEqual([]);
    expect(loaded.player.carrying).toBeNull();
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['a blank name', (s) => void (robotsOf(s).list[0]!.name = ' ')],
    ['too many parts for a Mini', (s) => void (robotsOf(s).list[0]!.parts = ['claw', 'basket'])],
    ['parts out of canonical order', (s) => void Object.assign(robotsOf(s).list[1]!, { size: 'standard', parts: ['basket', 'claw'] })],
    ['a repeated part', (s) => void Object.assign(robotsOf(s).list[1]!, { size: 'standard', parts: ['claw', 'claw'] })],
    ['an unknown part', (s) => void (robotsOf(s).list[0]!.parts = ['jetpack'])],
    ['an unknown size', (s) => void (robotsOf(s).list[0]!.size = 'huge')],
    ['more robots than the cap', (s) => {
      const r = robotsOf(s);
      r.list = Array.from({ length: 13 }, (_, i) => ({ ...r.list[1]!, id: i + 1, tx: 2 + i, tz: 11 }));
      r.nextId = 14;
      (s.player as SaveJson).carrying = null;
    }],
    ['a tile outside the farm', (s) => void (robotsOf(s).list[0]!.tx = 10_000)],
    ['a fractional tile', (s) => void (robotsOf(s).list[0]!.tz = 1.5)],
    ['an invalid facing', (s) => void (robotsOf(s).list[0]!.facing = 4)],
    ['a repairing robot without a repair day', (s) => void (robotsOf(s).list[4]!.repairReadyDay = null)],
    ['a broken robot with a repair day', (s) => void (robotsOf(s).list[3]!.repairReadyDay = 2)],
    ['two carried robots', (s) => void (robotsOf(s).list[0]!.carried = true)],
    ['a non-boolean carried flag', (s) => void (robotsOf(s).list[0]!.carried = 'yes')],
    ['a bag stack with no items', (s) => void (robotsOf(s).list[0]!.bag = [{ itemId: 'parsnip', quantity: 0, quality: 0 }])],
    ['a tank above capacity', (s) => void (robotsOf(s).list[3]!.tank = 21)],
    ['a negative token count', (s) => void (robotsOf(s).list[0]!.tokens = -1)],
    ['a negative stats count', (s) => void (((robotsOf(s).list[0]!.stats as SaveJson).today as SaveJson).tokens = -1)],
    ['an empty script', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [])],
    ['an oversized script', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = Array.from({ length: 81 }, () => ({ kind: 'move' })))],
    ['an unknown crop in a plant step', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'plant', cropId: 'kale' }])],
    ['an unknown item in a take step', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'take', itemId: 'gizmo' }])],
    ['nextActMinute before the day starts', (s) => void (robotsOf(s).list[0]!.nextActMinute = TIME.dayStartMinute - 1)],
    ['a negative move counter', (s) => void (robotsOf(s).list[0]!.moveSeq = -1)],
    ['a lastAction whose seq is not actionSeq', (s) => void (robotsOf(s).list[0]!.lastAction = { seq: 2, kind: 'move', success: true, bickered: false })],
    ['an unknown key on a robot', (s) => void (robotsOf(s).list[0]!.extra = 1)],
    ['a duplicate id', (s) => void (robotsOf(s).list[1]!.id = 1)],
    ['a nextId of 0', (s) => void (robotsOf(s).nextId = 0)],
    ['a log entry id at or above log.nextId', (s) => void (robotsOf(s).log.nextId = 2)],
    ['log ids out of order', (s) => void robotsOf(s).log.entries.reverse()],
    ['a log entry outside the farm', (s) => void (robotsOf(s).log.entries[0]!.tx = -1)],
    ['a log entry with an unknown event kind', (s) => void (robotsOf(s).log.entries[0]!.event = { kind: 'exploded' })],
    ['a log entry with an unknown action', (s) => void (robotsOf(s).log.entries[0]!.event = { kind: 'blocked', action: 'fly', reason: 'noTarget' })],
    ['a log entry with empty withIds', (s) => void (robotsOf(s).log.entries[0]!.event = { kind: 'bickered', action: 'move', withIds: [] })],
    ['a log with more entries than its capacity', (s) => {
      const l = robotsOf(s).log;
      l.nextId = 401;
      l.entries = Array.from({ length: 401 }, (_, i) => ({ ...l.entries[0]!, id: i }));
    }],
    ['a negative lastNightFuel', (s) => void ((robotsOf(s).lastNightFuel as SaveJson).wood = -1)],
    ['a fractional pool', (s) => void (robotsOf(s).pool = 1.5)],
    ['a bag over its stack limit', (s) => void (robotsOf(s).list[0]!.bag = [{ itemId: 'wood', quantity: 1, quality: 0 }, { itemId: 'stone', quantity: 1, quality: 0 }])],
    ['water in a tank without a watering head', (s) => void (robotsOf(s).list[0]!.tank = 3)],
    ['more tokens than the battery holds', (s) => void (robotsOf(s).list[0]!.tokens = 81)],
    ['an unknown power', (s) => void (robotsOf(s).list[0]!.power = 'sleeping')],
    ['pc outside the script', (s) => void (robotsOf(s).list[0]!.pc = 1)],
    ['a working robot on a water tile', (s) => void Object.assign(robotsOf(s).list[0]!, { tx: WATER.tx, tz: WATER.tz })],
    ['a repair day on a working robot', (s) => void (robotsOf(s).list[0]!.repairReadyDay = 3)],
    ['a carried robot the player is not carrying', (s) => void ((s.player as SaveJson).carrying = null)],
    ['the player carrying a robot that is not carried', (s) => void (robotsOf(s).list[5]!.carried = false)],
    ['ids out of order', (s) => void robotsOf(s).list.reverse()],
    ['an id at or above nextId', (s) => void (robotsOf(s).nextId = 7)],
    ['a log entry with an unknown reason', (s) => void (robotsOf(s).log.entries[0]!.event = { kind: 'blocked', action: 'move', reason: 'tired' })],
    ['a log entry with count 0', (s) => void (robotsOf(s).log.entries[0]!.count = 0)],
    ['nextActMinute far past midnight', (s) => void (robotsOf(s).list[0]!.nextActMinute = TIME.passOutMinute + 241)],
    ['an invalid script step', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'wait', minutes: 0 }])],
    ['a negative pool', (s) => void (robotsOf(s).pool = -1)],
    ['a say step with leading or trailing spaces', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'say', text: ' hi ' }])],
    ['a say step longer than the limit', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'say', text: 'a'.repeat(ROBOTS.sayMaxLength + 1) }])],
    ['a wait step above the upper bound', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'wait', minutes: ROBOTS.maxWaitMinutes + 1 }])],
    ['a turn step with an invalid side', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'turn', side: 'up' }])],
    ['a non-boolean loop flag', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).loop = 'yes')],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(lively(), edit)).toBeNull();
  });

  it('round-trips the clock past midnight with a robot mid-wait', () => {
    const state = lively();
    const late = { ...state, time: { ...state.time, minuteOfDay: TIME.passOutMinute - 30 } };
    expect(deserializeGame(serializeGame(late))).toEqual({ ...late, ui: { ...late.ui, panel: { kind: 'none' }, paused: false } });
  });

  it('rejects a repairing robot that is carried', () => {
    const state = lively();
    const list = state.robots.list.map((r) => (r.id === 6 ? { ...r, carried: true } : r.id === 7 ? { ...r, carried: false } : r));
    const robots = { ...state.robots, list };
    expect(isValidRobotsSection(robots, state.maps, { ...state.player, carrying: 6 })).toBe(false);
    const fixed = list.map((r) => (r.id === 6 ? { ...r, power: 'working' as const, repairReadyDay: null } : r));
    expect(isValidRobotsSection({ ...robots, list: fixed }, state.maps, { ...state.player, carrying: 6 })).toBe(true);
  });

  it('rejects a carried robot while the player is off the farm', () => {
    const state = lively();
    expect(isValidRobotsSection(state.robots, state.maps, state.player)).toBe(true);
    expect(isValidRobotsSection(state.robots, state.maps, { ...state.player, mapId: 'town' })).toBe(false);
  });

  it('keeps the robot a player carries facing any way', () => {
    const state = lively();
    const turned = { ...state, robots: { ...state.robots, list: state.robots.list.map((r) => (r.carried ? { ...r, facing: Direction.West } : r)) } };
    expect(deserializeGame(serializeGame(turned))).not.toBeNull();
  });
});
