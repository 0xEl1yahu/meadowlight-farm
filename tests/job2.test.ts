/**
 * Job 2, show him what it can do (farmclaws part 4c spec §3.2): Cosmo's generator, his field and
 * its morning reset (once a day), Wave on the lane; the program rule (an If and a sensor); the
 * check (every crop ripe at the set-up harvested by Wave today) and its progress line; the
 * reward and its toasts.
 */
import { describe, expect, it } from 'vitest';
import { GENERATORS, INVENTORY, JOBS, ROBOTS, UNLOCKS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, TileState, type BlockProgram, type GameState, type RobotLogEntry, type RobotLogEvent, type TileCoord } from '../src/core/types';
import { isMature } from '../src/farming/crops';
import { growCrop } from '../src/farming/growth';
import { WAVE, cosmoRipeTiles, looksBeforePicking, ripeCropsHarvested, showHimDone, showHimProgress, waveOf } from '../src/jobs/checks';
import { JOBS_TABLE, JOB_PLAYS, jobMorning, jobProgress } from '../src/jobs/jobs';
import { npcActions, npcSpot } from '../src/people/cast';
import { lineFor } from '../src/people/lines';
import { b } from '../src/robots/blocks';
import { programmedRobot } from '../src/robots/edits';
import { withRobot } from '../src/robots/world';
import { actions, type GameAction } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { COSMO_FIELD } from '../src/world/maps/neighbours';
import { SHOW_HIM_REFERENCE } from './jobSolutions';
import { BASE, must, robotOf, tileAt, withPlayer, withRobots, withTile } from './testUtils';

const act = (state: GameState, action: GameAction): GameState => gameReducer(state, action);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);

/** BASE with job 1 done and job 2 offered. */
const OFFERED: GameState = deepFreeze({ ...BASE, jobs: { ...BASE.jobs, status: { spinningRobot: 'done', showHim: 'offered', knowTheLimits: 'locked' } } });

/** `state` with the player in front of Cosmo, facing him. */
function facingCosmo(state: GameState): GameState {
  const { mapId, placement } = npcSpot('cosmo');
  return withPlayer(state, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
}

/** Job 2 taken through Cosmo's job card. */
function take(state: GameState): GameState {
  const chat = act(facingCosmo(state), actions.interact());
  return act(act(chat, actions.npcAct('cosmo', 'job')), actions.takeJob('showHim'));
}

const TAKEN: GameState = deepFreeze(take(OFFERED));
const WAVE_ROBOT = must(waveOf(TAKEN));
const RIPE = cosmoRipeTiles();

/** Every tile of Cosmo's field, row by row. */
function fieldTiles(): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let tz = COSMO_FIELD.z0; tz < COSMO_FIELD.z0 + COSMO_FIELD.depth; tz++) {
    for (let tx = COSMO_FIELD.x0; tx < COSMO_FIELD.x0 + COSMO_FIELD.width; tx++) tiles.push({ tx, tz });
  }
  return tiles;
}

/** The reference solution (spec §6, with the blocks unlocked by job 2): on every tile of Cosmo's field, if the crop is ready, harvest. */
const REFERENCE = SHOW_HIM_REFERENCE;

/** `state` with Wave given `program` now. */
function programmed(state: GameState, program: BlockProgram): GameState {
  const robot = programmedRobot(must(waveOf(state)), program, state.time.minuteOfDay);
  if (typeof robot === 'string') throw new Error(robot);
  return withRobot(state, robot);
}

/** Ticks through the day until `stop` holds or the evening comes. */
function runDay(state: GameState, stop: (s: GameState) => boolean = () => false): GameState {
  let next = state;
  while (!stop(next) && next.time.minuteOfDay < 20 * 60) next = act(next, actions.tick(60));
  return next;
}

const isDone = (state: GameState): boolean => state.jobs.status.showHim === 'done';

const HARVEST: RobotLogEvent = { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 1, quality: 0 } };

/** `state` whose log holds one harvest by robot `robotId` on each of `tiles`, today. */
function withHarvests(state: GameState, tiles: readonly TileCoord[], robotId = WAVE_ROBOT.id): GameState {
  const day = state.time.absoluteDay;
  const entries: RobotLogEntry[] = tiles.map((tile, id) => ({ id, day, minute: 400 + id, robotId, ...tile, event: HARVEST, count: 1 }));
  return { ...state, robots: { ...state.robots, log: { nextId: entries.length, entries } } };
}

describe('taking job 2', () => {
  it('gives Cosmo the Job button and his hook while the job is offered', () => {
    expect(npcActions(BASE, 'cosmo')).not.toContainEqual({ kind: 'job', label: 'Job' });
    expect(npcActions(OFFERED, 'cosmo')[0]).toEqual({ kind: 'job', label: 'Job' });
    const talked = act(facingCosmo(OFFERED), actions.interact());
    expect(lineFor(talked, 'cosmo')).toBe('My robot could do more, I bet. Want a job?');
  });

  it("is offered by Cosmo once job 1 is done, and says so when it's taken", () => {
    expect(TAKEN.jobs.status).toEqual({ spinningRobot: 'done', showHim: 'active', knowTheLimits: 'locked' });
    expect(texts(TAKEN).at(-1)).toBe('Show him what it can do: job taken.');
    expect(TAKEN.jobs.fieldDay).toBe(TAKEN.time.absoluteDay);
    for (const kind of UNLOCKS.job2.blocks) expect(TAKEN.robots.unlocks.blocks).toContain(kind);
    expect(isValidGameState(TAKEN)).toBe(true);
  });

  it("puts Cosmo's generator on the lane: a wood burner with a full hopper", () => {
    expect(tileAt(TAKEN, JOBS.generators.cosmo, 'neighbours').object).toEqual({ kind: 'woodBurner', fuel: GENERATORS.woodBurner.hopper });
    expect(tileAt(TAKEN, JOBS.generators.barnaby, 'neighbours').object).toBeNull();
  });

  it("puts Cosmo's Big Wave on the lane, facing North, with the hello-chickens program", () => {
    expect(WAVE_ROBOT).toMatchObject({
      name: WAVE,
      size: 'big',
      parts: ['claw', 'basket', 'sensorEye'],
      mapId: 'neighbours',
      owner: 'cosmo',
      ...JOBS.waveAt,
      facing: Direction.North,
      tokens: ROBOTS.sizes.big.battery,
      power: 'working',
      program: b.program({ stacks: [b.when(b.morning(), b.forever(b.say('hello chickens')))] }),
    });
  });

  it("doesn't count Wave towards the player's 12 robots", () => {
    const players = Array.from({ length: ROBOTS.maxRobots }, (_, i) => robotOf({ id: i + 1, name: `R${i + 1}`, tx: 2 + (i % 6) * 2, tz: 10 + Math.floor(i / 6) * 2 }));
    expect(waveOf(take(withRobots(OFFERED, players)))).not.toBeNull();
  });
});

describe("Cosmo's field", () => {
  it('becomes tilled soil with parsnips in a checkerboard: ripe on even tiles, two days from ripe on odd ones', () => {
    expect(RIPE).toHaveLength(18);
    for (const tile of fieldTiles()) {
      const t = tileAt(TAKEN, tile, 'neighbours');
      const crop = must(t.crop);
      expect(t.state, `${tile.tx},${tile.tz}`).toBe(TileState.Plowed);
      expect(crop.cropId).toBe('parsnip');
      if ((tile.tx + tile.tz) % 2 === 0) {
        expect(isMature(crop), `${tile.tx},${tile.tz}`).toBe(true);
      } else {
        expect(isMature(crop)).toBe(false);
        // Two watered days bring it to ripe.
        const once = growCrop(crop, true);
        expect(isMature(once)).toBe(false);
        expect(isMature(growCrop(once, true))).toBe(true);
      }
    }
  });

  it('is set up the same way again every morning while the job is active, once a day', () => {
    // Harvest every tile by hand: the morning brings the field back.
    let picked = TAKEN;
    for (const tile of fieldTiles()) picked = withTile(picked, tile, { ...tileAt(picked, tile, 'neighbours'), crop: null }, 'neighbours');
    const morning = act(picked, actions.sleep());
    expect(morning.jobs.fieldDay).toBe(morning.time.absoluteDay);
    for (const tile of fieldTiles()) expect(tileAt(morning, tile, 'neighbours').crop?.cropId).toBe('parsnip');
    expect(RIPE.every((tile) => isMature(must(tileAt(morning, tile, 'neighbours').crop)))).toBe(true);
    // Later that day the reset has already run: a picked field stays picked.
    const ripe = must(RIPE[0]);
    const later = withTile(morning, ripe, { ...tileAt(morning, ripe, 'neighbours'), crop: null }, 'neighbours');
    expect(jobMorning(later)).toBe(later);
    expect(jobMorning(morning)).toBe(morning);
    // A day not set up yet is.
    const stale: GameState = { ...later, jobs: { ...later.jobs, fieldDay: later.time.absoluteDay - 1 } };
    expect(tileAt(jobMorning(stale), ripe, 'neighbours').crop?.cropId).toBe('parsnip');
    expect(JOB_PLAYS.showHim.morning).not.toBeNull();
  });

  it('leaves a tile under a placed object alone', () => {
    const corner = { tx: COSMO_FIELD.x0, tz: COSMO_FIELD.z0 };
    const chest = { ...tileAt(OFFERED, corner, 'neighbours'), object: { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };
    const taken = take(withTile(OFFERED, corner, chest, 'neighbours'));
    expect(tileAt(taken, corner, 'neighbours')).toEqual(chest);
    expect(isValidGameState(taken)).toBe(true);
  });

  it("keeps its last state once the job is done, and isn't set up again", () => {
    const ready = withHarvests(programmed(TAKEN, REFERENCE), RIPE);
    const done = act(ready, actions.tick(1));
    expect(isDone(done)).toBe(true);
    const ripe = must(RIPE[0]);
    const picked = withTile(done, ripe, { ...tileAt(done, ripe, 'neighbours'), crop: null }, 'neighbours');
    expect(tileAt(act(picked, actions.sleep()), ripe, 'neighbours').crop).toBeNull();
  });
});

describe("Cosmo's generator", () => {
  it("never runs out, and charges Wave overnight for free", () => {
    const tired = withRobot(TAKEN, { ...WAVE_ROBOT, tokens: 5 });
    const morning = act(tired, actions.sleep());
    expect(tileAt(morning, JOBS.generators.cosmo, 'neighbours').object).toEqual({ kind: 'woodBurner', fuel: GENERATORS.woodBurner.hopper });
    expect(must(waveOf(morning)).tokens).toBe(ROBOTS.sizes.big.battery);
    expect(morning.robots.pool).toBe(tired.robots.pool);
  });
});

describe('the program rule', () => {
  it('needs an If and a sensor block, anywhere in a block program', () => {
    expect(looksBeforePicking(REFERENCE)).toBe(true);
    expect(looksBeforePicking(b.program({ stacks: [b.when(b.morning(), b.forever(b.if(b.not(b.bagIsFull()), [b.harvest(), b.move()])))] }))).toBe(true);
    expect(looksBeforePicking(b.program({ stacks: [b.when(b.morning(), b.forEach('H', b.harvest()))] }))).toBe(false);
    // An If without a sensor, and a sensor without an If.
    expect(looksBeforePicking(b.program({ stacks: [b.when(b.morning(), b.if(b.lt(b.tokensLeft(), 50), [b.powerDown()]), b.harvest())] }))).toBe(false);
    expect(looksBeforePicking(b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.cropIsReady(), b.move()), b.harvest())] }))).toBe(false);
    expect(looksBeforePicking({ kind: 'script', steps: [{ kind: 'harvest' }], loop: true })).toBe(false);
  });
});

describe('the check', () => {
  it("passes when Wave harvested every crop ripe at the set-up today, with a program that looks before it picks", () => {
    const ready = withHarvests(programmed(TAKEN, REFERENCE), RIPE);
    expect(showHimDone(ready)).toBe(true);
    expect(showHimDone(withHarvests(programmed(TAKEN, REFERENCE), RIPE.slice(1)))).toBe(false);
  });

  it("fails a program without an If and a sensor, even with every crop harvested", () => {
    const blind = b.program({ stacks: [b.when(b.morning(), b.forEach('H', b.harvest()))] });
    expect(showHimDone(withHarvests(programmed(TAKEN, blind), RIPE))).toBe(false);
    expect(showHimDone(withHarvests(TAKEN, RIPE))).toBe(false);
  });

  it("counts only Wave's harvests today on the ripe tiles: not another robot's, not yesterday's, not the unripe ones'", () => {
    const reference = programmed(TAKEN, REFERENCE);
    expect(ripeCropsHarvested(withHarvests(reference, RIPE, WAVE_ROBOT.id + 1))).toBe(0);
    const yesterday = withHarvests(reference, RIPE);
    const old = { ...yesterday, robots: { ...yesterday.robots, log: { ...yesterday.robots.log, entries: yesterday.robots.log.entries.map((e) => ({ ...e, day: e.day - 1 })) } } };
    expect(ripeCropsHarvested(old)).toBe(0);
    const odd = fieldTiles().filter((tile) => (tile.tx + tile.tz) % 2 === 1);
    expect(ripeCropsHarvested(withHarvests(reference, odd))).toBe(0);
  });

  it('passes with the reference program on its first day, and pays 1,000g with the toasts', () => {
    const ready = act(programmed(TAKEN, REFERENCE), actions.sleep());
    const done = runDay(ready, isDone);
    expect(isDone(done)).toBe(true);
    expect(done.time.absoluteDay).toBe(ready.time.absoluteDay);
    expect(done.player.gold).toBe(ready.player.gold + JOBS_TABLE.showHim.reward);
    expect(texts(done).slice(-2)).toEqual(['Job done: Show him what it can do. Cosmo paid you 1000g.', "Sol's parts shop is open."]);
    expect(done.jobs.status).toEqual({ spinningRobot: 'done', showHim: 'done', knowTheLimits: 'offered' });
    expect(isValidGameState(done)).toBe(true);
  });

  it("isn't passed by the hello-chickens program", () => {
    const day = runDay(act(TAKEN, actions.sleep()));
    expect(day.jobs.status.showHim).toBe('active');
    expect(ripeCropsHarvested(day)).toBe(0);
  });
});

describe('the progress line', () => {
  it('counts the ripe crops Wave harvested today', () => {
    expect(showHimProgress(TAKEN)).toBe('0 / 18 ripe crops harvested today.');
    expect(jobProgress(withHarvests(TAKEN, RIPE.slice(0, 5)), 'showHim')).toBe('5 / 18 ripe crops harvested today.');
  });
});
