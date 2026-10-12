/**
 * Job 3, know the limits (farmclaws part 4c spec §3.3): Barnaby's generator, his field and its
 * morning reset, Zone H and its toast, B-1 to B-4 with their programs and .MD; the check (every
 * crop harvested by his robots before 6:00 pm, at 6 tokens a crop or less) and its progress
 * line; the reward and its toasts.
 */
import { describe, expect, it } from 'vitest';
import { GENERATORS, INVENTORY, JOBS, ROBOTS, UNLOCKS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, TileState, type GameState, type Robot, type RobotLogEntry, type RobotLogEvent, type TileCoord } from '../src/core/types';
import { isMature } from '../src/farming/crops';
import {
  BARNABY_SOWN,
  BARNABY_TEAM,
  barnabyBudget,
  barnabyCropsHarvested,
  barnabyFieldTiles,
  barnabyTokensSpent,
  knowTheLimitsDone,
  knowTheLimitsProgress,
} from '../src/jobs/checks';
import { JOBS_TABLE, JOB_PLAYS, jobProgress } from '../src/jobs/jobs';
import { ZONE_H_TOAST } from '../src/jobs/setup';
import { npcActions, npcSpot } from '../src/people/cast';
import { lineFor } from '../src/people/lines';
import { b } from '../src/robots/blocks';
import { batteryFor } from '../src/robots/stats';
import { withRobot } from '../src/robots/world';
import { actions, type GameAction } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { chebyshevDistance, rectContains } from '../src/world/grid';
import { BARNABY_FENCE, BARNABY_FIELD, NEIGHBOURS_LANE, NEIGHBOURS_MAP } from '../src/world/maps/neighbours';
import { BASE, must, robotOf, tileAt, withPlayer, withRobots, withTile, withZones } from './testUtils';

const act = (state: GameState, action: GameAction): GameState => gameReducer(state, action);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);

/** BASE with jobs 1 and 2 done and job 3 offered. */
const OFFERED: GameState = deepFreeze({ ...BASE, jobs: { ...BASE.jobs, status: { spinningRobot: 'done', showHim: 'done', knowTheLimits: 'offered' } } });

/** `state` with the player on the lane north of Barnaby, facing him (he faces North). */
function facingBarnaby(state: GameState): GameState {
  return withPlayer(state, { tx: 25, tz: 14 }, Direction.South, 'neighbours');
}

/** Job 3 taken through Barnaby's job card. */
function take(state: GameState): GameState {
  const chat = act(facingBarnaby(state), actions.interact());
  return act(act(chat, actions.npcAct('barnaby', 'job')), actions.takeJob('knowTheLimits'));
}

const TAKEN: GameState = deepFreeze(take(OFFERED));
const FIELD = barnabyFieldTiles();

/** Barnaby's robots, by id. */
function team(state: GameState): Robot[] {
  return state.robots.list.filter((robot) => robot.owner === 'barnaby');
}

const TEAM = team(TAKEN);
const B1 = must(TEAM[0]);

const HARVEST: RobotLogEvent = { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 1, quality: 0 } };

/** `state` whose log holds one harvest on each of `tiles` today, shared round `robotIds` in turn. */
function withHarvests(state: GameState, tiles: readonly TileCoord[], robotIds: readonly number[] = TEAM.map((r) => r.id)): GameState {
  const day = state.time.absoluteDay;
  const entries: RobotLogEntry[] = tiles.map((tile, id) => ({ id, day, minute: 400 + id, robotId: must(robotIds[id % robotIds.length]), ...tile, event: HARVEST, count: 1 }));
  return { ...state, robots: { ...state.robots, log: { nextId: entries.length, entries } } };
}

/** `state` with Barnaby's robots having spent `tokens` today between them, all on B-1. */
function withSpent(state: GameState, tokens: number): GameState {
  let next = state;
  for (const robot of team(state)) {
    const today = { ...robot.stats.today, tokens: robot.id === B1.id ? tokens : 0 };
    next = withRobot(next, { ...robot, stats: { today, week: { ...robot.stats.week, tokens: Math.max(robot.stats.week.tokens, today.tokens) } } });
  }
  return next;
}

/** `state` at `minuteOfDay` today. */
const at = (state: GameState, minuteOfDay: number): GameState => ({ ...state, time: { ...state.time, minuteOfDay } });

describe('taking job 3', () => {
  it('gives Barnaby the Job button and his hook while the job is offered', () => {
    expect(npcActions(BASE, 'barnaby')).not.toContainEqual({ kind: 'job', label: 'Job' });
    expect(npcActions(OFFERED, 'barnaby')[0]).toEqual({ kind: 'job', label: 'Job' });
    const talked = act(facingBarnaby(OFFERED), actions.interact());
    expect(lineFor(talked, 'barnaby')).toBe('My team needs a manager. Interested?');
  });

  it("is offered by Barnaby once job 2 is done, and says so when it's taken", () => {
    expect(TAKEN.jobs.status).toEqual({ spinningRobot: 'done', showHim: 'done', knowTheLimits: 'active' });
    expect(texts(TAKEN).slice(-2)).toEqual([ZONE_H_TOAST, 'Know the limits: job taken.']);
    expect(ZONE_H_TOAST).toBe('Barnaby marked his field as Zone H.');
    expect(JOBS_TABLE.knowTheLimits.goal).toBe("Harvest Barnaby's whole field by 6:00 pm in one day, at 6 tokens a crop or less.");
    expect(TAKEN.jobs.fieldDay).toBe(TAKEN.time.absoluteDay);
    for (const kind of UNLOCKS.job3.blocks) expect(TAKEN.robots.unlocks.blocks).toContain(kind);
    for (const kind of UNLOCKS.job3.cards) expect(TAKEN.robots.unlocks.cards).toContain(kind);
    expect(TAKEN.robots.unlocks.tabs).toContain('stats');
    expect(isValidGameState(TAKEN)).toBe(true);
  });

  it("puts Barnaby's generator on the lane by his gate: a wood burner with a full hopper", () => {
    const gen = JOBS.generators.barnaby;
    expect(tileAt(TAKEN, gen, 'neighbours').object).toEqual({ kind: 'woodBurner', fuel: GENERATORS.woodBurner.hopper });
    const reach = (tile: TileCoord): number => Math.max(Math.abs(tile.tx - gen.tx), Math.abs(tile.tz - gen.tz));
    expect(rectContains(NEIGHBOURS_LANE, gen.tx, gen.tz)).toBe(true);
    expect(reach(BARNABY_FENCE.gap)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    expect(reach({ tx: BARNABY_FENCE.gap.tx, tz: BARNABY_FIELD.z0 })).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    // Not the gate, the tile in front of it, a character's spot or a reserved tile.
    const { placement } = npcSpot('barnaby');
    for (const tile of [BARNABY_FENCE.gap, { tx: BARNABY_FENCE.gap.tx, tz: BARNABY_FENCE.gap.tz - 1 }, placement, ...NEIGHBOURS_MAP.reserved]) {
      expect({ tx: tile.tx, tz: tile.tz }).not.toEqual(gen);
    }
  });

  it('sets Zone H to his field on the Neighbours map, whatever it was before', () => {
    const elsewhere = take(withZones(OFFERED, { H: { mapId: 'farm', x0: 2, z0: 2, w: 2, d: 2 } }));
    const field = { mapId: 'neighbours', x0: BARNABY_SOWN.x0, z0: BARNABY_SOWN.z0, w: BARNABY_SOWN.width, d: BARNABY_SOWN.depth };
    expect(TAKEN.robots.zones.H).toEqual(field);
    expect(elsewhere.robots.zones.H).toEqual(field);
  });
});

describe("Barnaby's field", () => {
  it('has its first 6 rows, 48 tiles from the gate side, sown with ripe parsnips, and the rest left bare', () => {
    expect(BARNABY_SOWN).toEqual({ ...BARNABY_FIELD, depth: JOBS.barnabyRows });
    expect(JOBS.barnabyRows).toBe(6);
    expect(FIELD).toHaveLength(48);
    for (let tz = BARNABY_SOWN.z0 + BARNABY_SOWN.depth; tz < BARNABY_FIELD.z0 + BARNABY_FIELD.depth; tz++) {
      for (let tx = BARNABY_FIELD.x0; tx < BARNABY_FIELD.x0 + BARNABY_FIELD.width; tx++) expect(tileAt(TAKEN, { tx, tz }, 'neighbours')).toEqual(tileAt(OFFERED, { tx, tz }, 'neighbours'));
    }
    for (const tile of FIELD) {
      const t = tileAt(TAKEN, tile, 'neighbours');
      expect(t.state, `${tile.tx},${tile.tz}`).toBe(TileState.Plowed);
      expect(t.crop?.cropId).toBe('parsnip');
      expect(isMature(must(t.crop)), `${tile.tx},${tile.tz}`).toBe(true);
    }
  });

  it('is set up again every morning while the job is active', () => {
    let picked = TAKEN;
    for (const tile of FIELD) picked = withTile(picked, tile, { ...tileAt(picked, tile, 'neighbours'), crop: null }, 'neighbours');
    const morning = act(picked, actions.sleep());
    expect(morning.jobs.fieldDay).toBe(morning.time.absoluteDay);
    expect(FIELD.every((tile) => isMature(must(tileAt(morning, tile, 'neighbours').crop)))).toBe(true);
    expect(JOB_PLAYS.knowTheLimits.morning).not.toBeNull();
  });

  it('leaves a tile under a placed object alone', () => {
    const corner = { tx: BARNABY_SOWN.x0 + BARNABY_SOWN.width - 1, tz: BARNABY_SOWN.z0 + BARNABY_SOWN.depth - 1 };
    const chest = { ...tileAt(OFFERED, corner, 'neighbours'), object: { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };
    const taken = take(withTile(OFFERED, corner, chest, 'neighbours'));
    expect(tileAt(taken, corner, 'neighbours')).toEqual(chest);
    expect(isValidGameState(taken)).toBe(true);
  });
});

describe("Barnaby's team", () => {
  it('is four Minis with a Claw each, on their tiles, fully charged, with his .MD', () => {
    expect(TEAM.map((r) => r.name)).toEqual([...BARNABY_TEAM]);
    expect(BARNABY_TEAM).toEqual(['B-1', 'B-2', 'B-3', 'B-4']);
    TEAM.forEach((robot, i) => {
      const place = must(JOBS.barnabyRobots[i]);
      expect(robot).toMatchObject({
        size: 'mini',
        parts: ['claw'],
        mapId: 'neighbours',
        owner: 'barnaby',
        tx: place.tx,
        tz: place.tz,
        facing: place.facing,
        tokens: ROBOTS.sizes.mini.battery,
        power: 'working',
        md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 }],
      });
    });
  });

  it('stands in and around the field, far from the generator', () => {
    const near = (tile: TileCoord, x0: number, z0: number, x1: number, z1: number): boolean => tile.tx >= x0 && tile.tx <= x1 && tile.tz >= z0 && tile.tz <= z1;
    const { x0, z0, width, depth } = BARNABY_FIELD;
    for (const place of JOBS.barnabyRobots) {
      expect(near(place, x0 - 2, z0 - 4, x0 + width + 1, z0 + depth + 1), `${place.tx},${place.tz}`).toBe(true);
      expect(Math.max(Math.abs(place.tx - JOBS.generators.barnaby.tx), Math.abs(place.tz - JOBS.generators.barnaby.tz))).toBeGreaterThan(ROBOTS.chargeRadius);
    }
    expect(JOBS.barnabyRobots.some((place) => near(place, x0, z0, x0 + width - 1, z0 + depth - 1))).toBe(true);
    expect(JOBS.barnabyRobots.some((place) => !near(place, x0, z0, x0 + width - 1, z0 + depth - 1))).toBe(true);
  });

  it('runs B-1 on the polling program, and leaves B-2 to B-4 empty', () => {
    expect(B1.program).toEqual(b.program({ stacks: [b.when(b.every(10), b.forEach('H', b.harvest()))] }));
    for (const robot of TEAM.slice(1)) expect(robot.program).toEqual(b.program({ stacks: [b.when(b.morning())] }));
  });

  it("doesn't count towards the player's 12 robots", () => {
    const players = Array.from({ length: ROBOTS.maxRobots }, (_, i) => robotOf({ id: i + 1, name: `R${i + 1}`, tx: 2 + (i % 6) * 2, tz: 10 + Math.floor(i / 6) * 2 }));
    expect(team(take(withRobots(OFFERED, players)))).toHaveLength(4);
  });

  it('puts a Mini whose tile is taken on the nearest free tile', () => {
    const place = must(JOBS.barnabyRobots[0]);
    const wave = robotOf({ id: 1, name: 'Wave', size: 'big', mapId: 'neighbours', owner: 'cosmo', tx: place.tx, tz: place.tz });
    const taken = take(withRobots(OFFERED, [wave]));
    const b1 = must(team(taken)[0]);
    expect({ tx: b1.tx, tz: b1.tz }).not.toEqual({ tx: place.tx, tz: place.tz });
    expect(Math.abs(b1.tx - place.tx) + Math.abs(b1.tz - place.tz)).toBe(1);
    expect(isValidGameState(taken)).toBe(true);
  });
});

describe('the check', () => {
  it("passes before 6:00 pm once Barnaby's robots harvested every tile today within the budget", () => {
    expect(barnabyBudget()).toBe(288);
    const ready = withSpent(withHarvests(at(TAKEN, 17 * 60 + 59), FIELD), 288);
    expect(knowTheLimitsDone(ready)).toBe(true);
  });

  it('fails at 6:00 pm, over the budget or with a tile left', () => {
    const harvested = withHarvests(TAKEN, FIELD);
    expect(knowTheLimitsDone(at(withSpent(harvested, 100), 18 * 60))).toBe(false);
    expect(knowTheLimitsDone(at(withSpent(harvested, 289), 12 * 60))).toBe(false);
    expect(knowTheLimitsDone(at(withSpent(withHarvests(TAKEN, FIELD.slice(1)), 100), 12 * 60))).toBe(false);
  });

  it("counts only his robots' harvests today: not another robot's, not yesterday's", () => {
    expect(barnabyCropsHarvested(withHarvests(TAKEN, FIELD, [TAKEN.robots.nextId]))).toBe(0);
    const today = withHarvests(TAKEN, FIELD);
    const old = { ...today, robots: { ...today.robots, log: { ...today.robots.log, entries: today.robots.log.entries.map((e) => ({ ...e, day: e.day - 1 })) } } };
    expect(barnabyCropsHarvested(old)).toBe(0);
    expect(barnabyCropsHarvested(today)).toBe(48);
  });

  it('adds up the tokens his robots spent today', () => {
    let spent = TAKEN;
    for (const [i, robot] of team(TAKEN).entries()) spent = withRobot(spent, { ...robot, stats: { ...robot.stats, today: { ...robot.stats.today, tokens: 10 * (i + 1) } } });
    expect(barnabyTokensSpent(spent)).toBe(100);
  });

  it('pays 2,000g with the toasts when it passes after a minute', () => {
    const ready = withSpent(withHarvests(at(TAKEN, 12 * 60), FIELD), 200);
    const done = act(ready, actions.tick(1));
    expect(done.jobs.status).toEqual({ spinningRobot: 'done', showHim: 'done', knowTheLimits: 'done' });
    expect(done.player.gold).toBe(ready.player.gold + JOBS_TABLE.knowTheLimits.reward);
    expect(texts(done).slice(-2)).toEqual(['Job done: Know the limits. Barnaby paid you 2000g.', 'Juniper now builds Standard and Big robots.']);
    expect(npcActions(done, 'barnaby')).not.toContainEqual({ kind: 'job', label: 'Job' });
    expect(isValidGameState(done)).toBe(true);
  });

  it("isn't passed in a day by B-1's polling program", () => {
    let day = act(TAKEN, actions.sleep());
    while (day.time.minuteOfDay < 20 * 60) day = act(day, actions.tick(60));
    expect(day.jobs.status.knowTheLimits).toBe('active');
  });

  it('gets B-1 back to work the next day after its polling runs it flat out of reach: Barnaby drags it to his generator', () => {
    let day = act(TAKEN, actions.sleep());
    while (day.time.minuteOfDay < 20 * 60) day = act(day, actions.tick(60));
    const flat = must(team(day).find((robot) => robot.name === 'B-1'));
    expect(flat.power).toBe('flat');
    expect(chebyshevDistance(flat, JOBS.generators.barnaby)).toBeGreaterThan(ROBOTS.chargeRadius);

    const morning = act(day, actions.sleep());
    const b1 = must(team(morning).find((robot) => robot.id === flat.id));
    expect(chebyshevDistance(b1, JOBS.generators.barnaby)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    expect(b1).toMatchObject({ tokens: batteryFor(b1.size), program: flat.program, md: flat.md });
    expect(b1.power).not.toBe('flat');
    expect(texts(morning)).toContain('Barnaby dragged B-1 back to the generator.');
    expect(isValidGameState(morning)).toBe(true);

    const later = act(morning, actions.tick(120));
    expect(must(team(later).find((robot) => robot.id === flat.id)).stats.today.tokens).toBeGreaterThan(0);
    expect(barnabyCropsHarvested(later)).toBeGreaterThan(0);
  });
});

describe('the progress line', () => {
  it("counts the crops his robots harvested today and the tokens they spent", () => {
    expect(knowTheLimitsProgress(TAKEN)).toBe('0 / 48 crops harvested today · 0 tokens spent.');
    expect(jobProgress(withSpent(withHarvests(TAKEN, FIELD.slice(0, 10)), 37), 'knowTheLimits')).toBe('10 / 48 crops harvested today · 37 tokens spent.');
  });
});
