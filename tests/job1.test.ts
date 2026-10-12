/**
 * Job 1, the spinning robot (farmclaws part 4c spec §3.1): Sprinkle and the bed's placement; the
 * check (the log's waters on every bed tile, Sprinkle's own Power down, tokens left; rain and the
 * player's watering don't count); the progress line; Sol's free pond rescue, once.
 */
import { describe, expect, it } from 'vitest';
import { JOBS, PLAYER, ROBOTS, WORKBENCH } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Blocker, Direction, TileState, type BlockProgram, type GameState, type RobotLogEntry, type RobotLogEvent, type TileCoord } from '../src/core/types';
import { SPRINKLE, bedTiles, bedTilesWatered, spinningRobotDone, spinningRobotProgress, sprinkleOf } from '../src/jobs/checks';
import { JOBS_TABLE, SPRINKLE_KEPT, takeJob } from '../src/jobs/jobs';
import { NO_ROOM_FOR_BED } from '../src/jobs/setup';
import { npcSpot } from '../src/people/cast';
import { b } from '../src/robots/blocks';
import { ROBOT_CAP_RULE } from '../src/robots/create';
import { programmedRobot } from '../src/robots/edits';
import { findFreeBlock, freeSpotNear } from '../src/robots/workbench';
import { withRobot } from '../src/robots/world';
import { actions, type GameAction } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { blockedTile } from '../src/world/tiles';
import { spinningRobotReference, withoutPowerDown } from './jobSolutions';
import { BASE, holding, must, robotOf, soilTile, tileAt, withPlayer, withRobots, withTile, withZones } from './testUtils';

const act = (state: GameState, action: GameAction): GameState => gameReducer(state, action);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);

/** Job 1 taken through Sol's job card. */
function take(state: GameState): GameState {
  const { mapId, placement } = npcSpot('sol');
  const chat = act(withPlayer(state, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId), actions.interact());
  return act(act(chat, actions.npcAct('sol', 'job')), actions.takeJob('spinningRobot'));
}

const TAKEN: GameState = deepFreeze(take(BASE));
const SPRINKLE_ROBOT = must(sprinkleOf(TAKEN));

/** The reference solution (spec §6, with job 1's blocks): round the bed's edge, the middle, then power down. */
const REFERENCE = spinningRobotReference(must(TAKEN.jobs.bed));

/** `state` with Sprinkle given `program` now. */
function programmed(state: GameState, program: BlockProgram): GameState {
  const robot = programmedRobot(must(sprinkleOf(state)), program, state.time.minuteOfDay);
  if (typeof robot === 'string') throw new Error(robot);
  return withRobot(state, robot);
}

/** Ticks through the day until `stop` holds or the evening comes. */
function runDay(state: GameState, stop: (s: GameState) => boolean = () => false): GameState {
  let next = state;
  while (!stop(next) && next.time.minuteOfDay < 20 * 60) next = act(next, actions.tick(60));
  return next;
}

const isDone = (state: GameState): boolean => state.jobs.status.spinningRobot === 'done';

/** `state` whose log holds Sprinkle's `events`, one entry each at the given tile, today. */
function withSprinkleLog(state: GameState, events: readonly (readonly [TileCoord, RobotLogEvent])[], day = state.time.absoluteDay): GameState {
  const entries: RobotLogEntry[] = events.map(([tile, event], id) => ({ id, day, minute: 400 + id, robotId: SPRINKLE_ROBOT.id, ...tile, event, count: 1 }));
  return { ...state, robots: { ...state.robots, log: { nextId: entries.length, entries } } };
}

const WATER: RobotLogEvent = { kind: 'did', action: 'water', detail: { kind: 'tile' } };
const POWERED_DOWN: RobotLogEvent = { kind: 'poweredDown' };
const BED = bedTiles(TAKEN);
const waters = (tiles: readonly TileCoord[] = BED): (readonly [TileCoord, RobotLogEvent])[] => tiles.map((tile) => [tile, WATER] as const);

/** TAKEN with Sprinkle standing by on `tokens` after `events`. */
function logged(events: readonly (readonly [TileCoord, RobotLogEvent])[], tokens = 30): GameState {
  return withRobot(withSprinkleLog(TAKEN, events), { ...SPRINKLE_ROBOT, power: 'standby', tokens });
}

describe('Sprinkle', () => {
  it("is Sol's Mini with a watering head and the spinning program, the player's, fully charged by the workbench", () => {
    const at = freeSpotNear(BASE.maps.farm, WORKBENCH.home, [PLAYER.spawn]);
    expect(SPRINKLE_ROBOT).toMatchObject({
      name: SPRINKLE,
      size: 'mini',
      parts: ['wateringHead'],
      mapId: 'farm',
      owner: 'player',
      tx: at.tx,
      tz: at.tz,
      facing: Direction.South,
      tokens: ROBOTS.sizes.mini.battery,
      tank: ROBOTS.tankCapacity,
      power: 'working',
      program: b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] }),
    });
    expect(isValidGameState(TAKEN)).toBe(true);
  });

  it('counts towards the 12 robots: a full farm refuses the job and keeps the card open', () => {
    const full = withRobots(BASE, Array.from({ length: ROBOTS.maxRobots }, (_, i) => robotOf({ id: i + 1, name: `R${i + 1}`, tx: 20 + (i % 6), tz: 12 + Math.floor(i / 6) })));
    const refused = take(full);
    expect(texts(refused).at(-1)).toBe(ROBOT_CAP_RULE);
    expect(refused.jobs.status.spinningRobot).toBe('offered');
    expect(refused.ui.panel).toMatchObject({ kind: 'talk', npc: 'sol', card: 'job' });
  });
});

describe('scrapping Sprinkle', () => {
  /** `state` with Sprinkle on the workbench and its robot screen open there. */
  const benched = (state: GameState): GameState => {
    const sprinkle = must(sprinkleOf(state));
    const onBench = withRobot(state, { ...sprinkle, onBench: true, tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz });
    return { ...onBench, ui: { ...onBench.ui, panel: { kind: 'robot', robotId: sprinkle.id, mode: 'bench' } } };
  };

  it('is refused while job 1 is active: Sol wants it back whole', () => {
    const before = benched(TAKEN);
    const refused = act(before, actions.scrapRobot(SPRINKLE_ROBOT.id));
    expect(texts(refused).at(-1)).toBe('Sol wants Sprinkle back in one piece.');
    expect(SPRINKLE_KEPT).toBe('Sol wants Sprinkle back in one piece.');
    expect(sprinkleOf(refused)).toEqual(sprinkleOf(before));
    expect(refused.player.gold).toBe(before.player.gold);
  });

  it('goes ahead once job 1 is done, like any robot', () => {
    const done = benched({ ...TAKEN, jobs: { ...TAKEN.jobs, status: { ...TAKEN.jobs.status, spinningRobot: 'done', showHim: 'offered' } } });
    const scrapped = act(done, actions.scrapRobot(SPRINKLE_ROBOT.id));
    expect(sprinkleOf(scrapped)).toBeNull();
    expect(texts(scrapped).at(-1)).toMatch(/^Scrapped Sprinkle for \d+g\.$/);
  });

  it("doesn't refuse another robot while job 1 is active", () => {
    const other = { ...robotOf({ id: TAKEN.robots.nextId, name: 'Bolt' }), onBench: true, tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz };
    const state = withRobots(TAKEN, [SPRINKLE_ROBOT, other]);
    const scrapped = act({ ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: other.id, mode: 'bench' } } }, actions.scrapRobot(other.id));
    expect(scrapped.robots.list.map((r) => r.name)).toEqual([SPRINKLE]);
  });
});

describe('the bed', () => {
  it('is the 3 × 3 block of free grass nearest JOBS.bedSearchFrom, tilled and sown with parsnips', () => {
    expect(TAKEN.jobs.bed).toEqual(JOBS.bedSearchFrom);
    expect(BED).toHaveLength(9);
    for (const tile of BED) {
      const t = tileAt(TAKEN, tile, 'farm');
      expect(t.state, `${tile.tx},${tile.tz}`).toBe(TileState.Plowed);
      expect(t.crop).toMatchObject({ cropId: 'parsnip', stage: 0, plantedDay: TAKEN.time.absoluteDay });
    }
  });

  it('becomes Zone A when Zone A is empty, and leaves a set Zone A alone', () => {
    expect(TAKEN.robots.zones.A).toEqual({ mapId: 'farm', x0: JOBS.bedSearchFrom.tx, z0: JOBS.bedSearchFrom.tz, w: 3, d: 3 });
    const zone = { mapId: 'farm', x0: 20, z0: 12, w: 2, d: 2 } as const;
    expect(take(withZones(BASE, { A: zone })).robots.zones.A).toEqual(zone);
  });

  it('skips blocks with a rock, tilled soil, a crop or a robot in them', () => {
    const corner = JOBS.bedSearchFrom;
    const middle = { tx: corner.tx + 1, tz: corner.tz + 1 };
    const rocky = withTile(BASE, middle, blockedTile(Blocker.Rock, 2), 'farm');
    const tilled = withTile(BASE, middle, soilTile(TileState.Plowed), 'farm');
    const robot = withRobots(BASE, [robotOf({ tx: middle.tx, tz: middle.tz })]);
    for (const state of [rocky, tilled, robot]) {
      const bed = must(take(state).jobs.bed);
      expect(bed).not.toEqual(corner);
      const covers = bed.tx <= middle.tx && middle.tx < bed.tx + 3 && bed.tz <= middle.tz && middle.tz < bed.tz + 3;
      expect(covers).toBe(false);
    }
    expect(findFreeBlock(BASE.maps.farm, corner, 3, [])).toEqual(corner);
    expect(findFreeBlock(BASE.maps.farm, corner, 3, [middle])).not.toEqual(corner);
  });

  it('refuses the job when no block of grass is free', () => {
    const dug = { ...BASE, maps: { ...BASE.maps, farm: { ...BASE.maps.farm, chunks: BASE.maps.farm.chunks.map((c) => ({ ...c, tiles: c.tiles.map((t) => ({ ...t, state: TileState.Plowed })) })) } } };
    expect(takeJob(dug, 'spinningRobot')).toBe(NO_ROOM_FOR_BED);
    expect(NO_ROOM_FOR_BED).toBe('Your farm has no free 3 × 3 patch of grass for the bed.');
  });
});

describe('the check', () => {
  it('passes for the reference program on the first full day, with tokens left', () => {
    const day1 = act(programmed(TAKEN, REFERENCE), actions.sleep());
    const end = runDay(day1, isDone);
    expect(isDone(end)).toBe(true);
    expect(end.time.absoluteDay).toBe(day1.time.absoluteDay);
    expect(must(sprinkleOf(end)).tokens).toBeGreaterThan(0);
    expect(end.player.gold).toBe(day1.player.gold + JOBS_TABLE.spinningRobot.reward);
  });

  it('fails for the spinning program and for a program without Power down', () => {
    const spinning = runDay(act(TAKEN, actions.sleep()));
    expect(isDone(spinning)).toBe(false);
    const watered = runDay(act(programmed(TAKEN, withoutPowerDown(REFERENCE)), actions.sleep()));
    expect(bedTilesWatered(watered)).toBe(9);
    expect(isDone(watered)).toBe(false);
  });

  it("doesn't count rain or the player's watering", () => {
    const rained = BED.reduce((s, tile) => withTile(s, tile, { ...tileAt(s, tile, 'farm'), state: TileState.Watered }, 'farm'), TAKEN);
    const powerDown = b.program({ stacks: [b.when(b.morning(), b.powerDown())] });
    const day = runDay(programmed(rained, powerDown));
    expect(isDone(day)).toBe(false);
    expect(bedTilesWatered(day)).toBe(0);

    let player = holding(TAKEN, 'wateringCan');
    for (const tile of BED) player = act(withPlayer(player, { tx: tile.tx, tz: tile.tz - 1 }, Direction.South, 'farm'), actions.useTool());
    expect(BED.every((tile) => tileAt(player, tile, 'farm').state === TileState.Watered)).toBe(true);
    expect(spinningRobotDone(withRobot(player, { ...SPRINKLE_ROBOT, power: 'standby' }))).toBe(false);
  });

  it("needs every bed tile, today, then Sprinkle's own Power down with tokens above 0", () => {
    expect(spinningRobotDone(logged([...waters(), [BED[0]!, POWERED_DOWN]]))).toBe(true);
    expect(spinningRobotDone(logged([...waters(BED.slice(1)), [BED[0]!, POWERED_DOWN]]))).toBe(false);
    expect(spinningRobotDone(logged([...waters(), [BED[0]!, POWERED_DOWN]], 0))).toBe(false);
    expect(spinningRobotDone(logged([...waters(), [BED[0]!, { kind: 'doPowerDown', card: { kind: 'doPowerDown', when: { kind: 'raining' } } }]]))).toBe(false);
    expect(spinningRobotDone(logged([[BED[0]!, POWERED_DOWN], ...waters()]))).toBe(false);
    const yesterday = withRobot(withSprinkleLog(TAKEN, [...waters(), [BED[0]!, POWERED_DOWN]], TAKEN.time.absoluteDay - 1), { ...SPRINKLE_ROBOT, power: 'standby' });
    expect(spinningRobotDone(yesterday)).toBe(false);
    const woken = withRobot(logged([...waters(), [BED[0]!, POWERED_DOWN]]), { ...SPRINKLE_ROBOT, power: 'working', tokens: 30 });
    expect(spinningRobotDone(woken)).toBe(false);
  });

  it("reads only Sprinkle's log, not another robot's", () => {
    const other = robotOf({ id: 2, name: 'Bolt', tx: 20, tz: 12 });
    const state = withRobots(logged([...waters(), [BED[0]!, POWERED_DOWN]]), [{ ...SPRINKLE_ROBOT, power: 'standby', tokens: 30 }, other]);
    const moved = { ...state, robots: { ...state.robots, log: { ...state.robots.log, entries: state.robots.log.entries.map((e) => ({ ...e, robotId: 2 })) } } };
    expect(spinningRobotDone(state)).toBe(true);
    expect(spinningRobotDone(moved)).toBe(false);
  });
});

describe('the progress line', () => {
  it('counts the bed tiles Sprinkle watered today', () => {
    expect(spinningRobotProgress(TAKEN)).toBe('0 / 9 bed tiles watered today.');
    expect(spinningRobotProgress(logged(waters(BED.slice(0, 4))))).toBe('4 / 9 bed tiles watered today.');
    expect(spinningRobotProgress(logged([...waters(BED.slice(0, 2)), ...waters(BED.slice(0, 2))]))).toBe('2 / 9 bed tiles watered today.');
  });
});

describe("Sol's pond rescue", () => {
  const POND = { tx: 39, tz: 31 };
  /** `state` with Sprinkle broken in the pond at the end of the day. */
  const sunk = (state: GameState): GameState => withRobot(state, { ...must(sprinkleOf(state)), tx: POND.tx, tz: POND.tz, power: 'broken', tokens: 3 });

  it('fishes Sprinkle out overnight for free, the first time, while job 1 is active', () => {
    expect(tileAt(TAKEN, POND, 'farm').blocker).toBe(Blocker.Water);
    const before = sunk(TAKEN);
    const morning = act(before, actions.sleep());
    const back = must(sprinkleOf(morning));
    const others = [PLAYER.spawn];
    expect({ tx: back.tx, tz: back.tz }).toEqual(freeSpotNear(morning.maps.farm, WORKBENCH.home, others));
    expect(back.power).toBe('working');
    expect(back.tokens).toBe(ROBOTS.sizes.mini.battery);
    expect(morning.player.gold).toBe(before.player.gold);
    expect(morning.jobs.rescued).toBe(true);
    expect(texts(morning)).toContain('Sol fished Sprinkle out of the pond, free this once. A DON\'T card can keep it out: Go into water.');
    expect(texts(morning).some((t) => t.includes('ruined') || t.includes('away from a generator'))).toBe(false);
    expect(isValidGameState(morning)).toBe(true);
  });

  it('is once only: the next night in the water ruins it', () => {
    const rescued = act(sunk(TAKEN), actions.sleep());
    const again = act(sunk(rescued), actions.sleep());
    expect(must(sprinkleOf(again)).power).toBe('ruined');
  });

  it("doesn't happen unless job 1 is active", () => {
    const offered = act(sunk({ ...TAKEN, jobs: { ...TAKEN.jobs, status: { ...TAKEN.jobs.status, spinningRobot: 'done', showHim: 'offered' } } }), actions.sleep());
    expect(must(sprinkleOf(offered)).power).toBe('ruined');
    expect(offered.jobs.rescued).toBe(false);
  });
});
