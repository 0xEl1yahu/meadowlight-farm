/**
 * The jobs framework (farmclaws part 4c spec §2): the order (offered, active, done, the next one
 * offered); the Job button and the job card in the chat box; taking a job (its unlocks, its
 * set-up, the toast); the giver's hook; the check after every minute and when talking to the
 * giver; the reward and the toasts.
 */
import { describe, expect, it } from 'vitest';
import { UNLOCKS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, type GameState, type NpcId } from '../src/core/types';
import { sprinkleOf } from '../src/jobs/checks';
import { JOBS_TABLE, JOB_PLAYS, activeJob, giverJob, jobMorning } from '../src/jobs/jobs';
import { npcActions, npcSpot } from '../src/people/cast';
import { LINE_BANKS, lineFor } from '../src/people/lines';
import { b } from '../src/robots/blocks';
import { programmedRobot } from '../src/robots/edits';
import { withRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { chatBoxView } from '../src/ui/chatBoxView';
import { BASE, must, robotOf, withPlayer, withRobots } from './testUtils';

const SOL_JOB = JOBS_TABLE.spinningRobot;

/** `state` with the player in front of `npc`, facing them (every character faces South). */
function facing(state: GameState, npc: NpcId): GameState {
  const { mapId, placement } = npcSpot(npc);
  return withPlayer(state, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
}

const talk = (state: GameState, npc: NpcId): GameState => gameReducer(facing(state, npc), actions.interact());
const act = (state: GameState, action: Parameters<typeof gameReducer>[1]): GameState => gameReducer(state, action);
/** Sol's chat with his job card open. */
const solCard = (state: GameState): GameState => act(talk(state, 'sol'), actions.npcAct('sol', 'job'));
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);

/** `state` with Sprinkle given `program` now. */
function programmed(state: GameState, program: ReturnType<typeof b.program>): GameState {
  const robot = programmedRobot(must(sprinkleOf(state)), program, state.time.minuteOfDay);
  if (typeof robot === 'string') throw new Error(robot);
  return withRobot(state, robot);
}

/** BASE with job 1 taken through Sol's job card. */
const TAKEN: GameState = deepFreeze(act(solCard(BASE), actions.takeJob('spinningRobot')));

/** TAKEN with Sprinkle's log showing every bed tile watered today, then its own Power down, with tokens left. */
function finished(state: GameState = TAKEN): GameState {
  const sprinkle = must(sprinkleOf(state));
  const bed = must(state.jobs.bed);
  const day = state.time.absoluteDay;
  const entries = [];
  for (let i = 0; i < 9; i++) {
    const tile = { tx: bed.tx + (i % 3), tz: bed.tz + Math.floor(i / 3) };
    entries.push({ id: entries.length, day, minute: 400 + i, robotId: sprinkle.id, ...tile, event: { kind: 'did', action: 'water', detail: { kind: 'tile' } } as const, count: 1 });
  }
  entries.push({ id: entries.length, day, minute: 420, robotId: sprinkle.id, tx: bed.tx, tz: bed.tz, event: { kind: 'poweredDown' } as const, count: 1 });
  const robots = { ...state.robots, log: { nextId: entries.length, entries } };
  return withRobot({ ...state, robots }, { ...sprinkle, power: 'standby', tokens: 30 });
}

describe('the order', () => {
  it('starts with job 1 offered and the others locked', () => {
    expect(BASE.jobs.status).toEqual({ spinningRobot: 'offered', showHim: 'locked', knowTheLimits: 'locked' });
    expect(activeJob(BASE)).toBeNull();
  });

  it('makes a taken job active, and a finished one done with the next one offered', () => {
    expect(TAKEN.jobs.status).toEqual({ spinningRobot: 'active', showHim: 'locked', knowTheLimits: 'locked' });
    expect(activeJob(TAKEN)).toBe('spinningRobot');
    const done = act(finished(), actions.tick(1));
    expect(done.jobs.status).toEqual({ spinningRobot: 'done', showHim: 'offered', knowTheLimits: 'locked' });
    expect(activeJob(done)).toBeNull();
    expect(done.jobs.fieldDay).toBe(-1);
  });

  it('gives each job its giver, reward and the unlocks it adds when taken (spec §3, §4.1)', () => {
    expect([SOL_JOB.giver, JOBS_TABLE.showHim.giver, JOBS_TABLE.knowTheLimits.giver]).toEqual(['sol', 'cosmo', 'barnaby']);
    expect([SOL_JOB.reward, JOBS_TABLE.showHim.reward, JOBS_TABLE.knowTheLimits.reward]).toEqual([500, 1000, 2000]);
    expect(SOL_JOB.unlocksOnTake).toBe(UNLOCKS.job1);
    expect(JOBS_TABLE.showHim.unlocksOnTake).toBe(UNLOCKS.job2);
    expect(JOBS_TABLE.knowTheLimits.unlocksOnTake).toBe(UNLOCKS.job3);
    expect([...UNLOCKS.job2.blocks].sort()).toEqual(
      ['harvest', 'deposit', 'take', 'if', 'bagFull', 'cropIsReady', 'soilIsDry', 'tileIsTilled', 'cropIs', 'bagIsFull', 'bagHas', 'atEdgeOf', 'tileAheadIs', 'itIsRaining', 'timeIsAfter', 'and', 'or', 'not'].sort(),
    );
    expect(UNLOCKS.job2.cards).toEqual(['dontHarvest', 'dontDeposit']);
    expect(UNLOCKS.job2.tabs).toEqual([]);
    expect([...UNLOCKS.job3.blocks].sort()).toEqual(['forEachTile', 'every', 'startsRaining', 'till', 'plant', 'tokensBelow', 'countInBag', 'arith'].sort());
    expect(UNLOCKS.job3.cards).toEqual(['doReturn', 'doPowerDown']);
    expect(UNLOCKS.job3.tabs).toEqual(['stats']);
  });
});

describe('the Job button', () => {
  it("is in the giver's chat while their job is offered or active, and gone once it's done", () => {
    const job = { kind: 'job', label: 'Job' };
    expect(npcActions(BASE, 'sol')[0]).toEqual(job);
    expect(npcActions(TAKEN, 'sol')[0]).toEqual(job);
    expect(npcActions(act(finished(), actions.tick(1)), 'sol')).not.toContainEqual(job);
    for (const npc of ['marigold', 'berlioz', 'juniper', 'tallulah'] as const) expect(npcActions(BASE, npc), npc).not.toContainEqual(job);
    expect(giverJob(BASE, 'sol')).toBe('spinningRobot');
    expect(giverJob(BASE, 'cosmo')).toBeNull();
  });

  it('shows the job card in place of the line, and does nothing for a character without a job', () => {
    const chat = talk(BASE, 'sol');
    expect(chat.ui.panel).toMatchObject({ kind: 'talk', npc: 'sol', card: 'line' });
    const card = act(chat, actions.npcAct('sol', 'job'));
    expect(card.ui.panel).toEqual({ ...chat.ui.panel, card: 'job' });
    expect(act(card, actions.npcAct('sol', 'job'))).toBe(card);
    const marigold = talk(BASE, 'marigold');
    expect(act(marigold, actions.npcAct('marigold', 'job'))).toBe(marigold);
  });
});

describe('the job card', () => {
  it("shows an offered job's title, offer and goal, with Take the job and Not now", () => {
    const view = must(chatBoxView(solCard(BASE)));
    expect(view.job).toEqual({
      job: 'spinningRobot',
      title: 'The spinning robot',
      offer:
        "Here's your first robot: a Mini with a watering head. Its program just spins. Rewrite it to water the bed by your workbench, then power down with tokens to spare.",
      goal: 'Water every tile of the bed, then power down with tokens left.',
      progress: null,
    });
    expect(view.buttons).toEqual([
      { label: 'Take the job', action: actions.takeJob('spinningRobot'), primary: true },
      { label: 'Not now', action: actions.closePanel(), primary: false },
    ]);
    expect(act(solCard(BASE), actions.closePanel()).ui.panel).toEqual({ kind: 'none' });
  });

  it("shows an active job's goal and progress line, with Close", () => {
    const view = must(chatBoxView(solCard(TAKEN)));
    expect(view.job?.goal).toBe(SOL_JOB.goal);
    expect(view.job?.progress).toBe('0 / 9 bed tiles watered today.');
    expect(view.buttons).toEqual([{ label: 'Close', action: actions.closePanel(), primary: false }]);
  });

  it('keeps the line and the action buttons while the card is closed', () => {
    const view = must(chatBoxView(talk(BASE, 'sol')));
    expect(view.job).toBeNull();
    expect(view.buttons.map((button) => button.label)).toEqual(['Job', 'Shop']);
  });
});

describe('taking a job', () => {
  it('sets the job up, closes the chat and says so', () => {
    expect(TAKEN.ui.panel).toEqual({ kind: 'none' });
    expect(texts(TAKEN).at(-1)).toBe('The spinning robot: job taken.');
    expect(sprinkleOf(TAKEN)).not.toBeNull();
    expect(TAKEN.jobs.bed).not.toBeNull();
    expect(TAKEN.jobs.fieldDay).toBe(TAKEN.time.absoluteDay);
  });

  it('adds the unlocks the job needs', () => {
    const fewer: GameState = { ...BASE, robots: { ...BASE.robots, unlocks: { ...UNLOCKS.job1, blocks: UNLOCKS.job1.blocks.filter((k) => k !== 'water') } } };
    const taken = act(solCard(fewer), actions.takeJob('spinningRobot'));
    expect(taken.robots.unlocks.blocks).toEqual(UNLOCKS.job1.blocks);
  });

  it("acts only from the job's own card, unpaused, while the job is offered", () => {
    const line = talk(BASE, 'sol');
    expect(act(line, actions.takeJob('spinningRobot'))).toBe(line);
    const card = solCard(BASE);
    const paused: GameState = { ...card, ui: { ...card.ui, paused: true } };
    expect(act(paused, actions.takeJob('spinningRobot'))).toBe(paused);
    const otherJob = act(card, actions.takeJob('showHim'));
    expect(otherJob).toBe(card);
    const again = solCard(TAKEN);
    expect(act(again, actions.takeJob('spinningRobot'))).toBe(again);
  });
});

describe("the giver's hook", () => {
  it('is their reactive line, before every other, while their job is offered', () => {
    const talked = talk(BASE, 'sol');
    expect(must(chatBoxView(talked)).line).toBe(LINE_BANKS.sol.introduction);
    expect(lineFor(talked, 'sol')).toBe("I've got a robot that needs a home. Ask me about the job.");
    const ruined = withRobots(talked, [robotOf({ power: 'ruined' })]);
    expect(lineFor(ruined, 'sol')).toBe(SOL_JOB.hook);
  });

  it('gives way to their usual lines once the job is taken, and once it is done', () => {
    const active: GameState = { ...TAKEN, npcs: talk(TAKEN, 'sol').npcs };
    expect(lineFor(active, 'sol')).not.toBe(SOL_JOB.hook);
    const done = act(finished(active), actions.tick(1));
    expect(lineFor(done, 'sol')).not.toBe(SOL_JOB.hook);
  });
});

describe('the check', () => {
  it('runs after the minute the robots act in, and pays the reward with its toasts', () => {
    const ready = finished();
    const done = act(ready, actions.tick(1));
    expect(done.player.gold).toBe(ready.player.gold + 500);
    expect(texts(done).slice(-2)).toEqual(['Job done: The spinning robot. Sol paid you 500g.', "Juniper's workshop is open."]);
    expect(done.messages.entries.at(-1)?.minute).toBe(ready.time.minuteOfDay + 1);
  });

  it('finishes a job in the minute it passes, however many minutes a tick carries', () => {
    const reference = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.water()), b.powerDown())] });
    const sprinkle = must(sprinkleOf(TAKEN));
    let state = act(programmed(TAKEN, reference), actions.sleep());
    while (state.jobs.status.spinningRobot === 'active' && state.time.minuteOfDay < 20 * 60) state = act(state, actions.tick(120));
    expect(state.jobs.status.spinningRobot).toBe('done');
    const poweredDown = state.robots.log.entries.filter((e) => e.robotId === sprinkle.id && e.event.kind === 'poweredDown').at(-1);
    const paid = state.messages.entries.find((m) => m.text.startsWith('Job done'));
    expect(paid?.minute).toBe(poweredDown?.minute);
  });

  it("runs once more when the player talks to the giver, before the line is picked", () => {
    const ready = finished();
    const chat = talk(ready, 'sol');
    expect(chat.jobs.status.spinningRobot).toBe('done');
    expect(texts(chat)).toContain('Job done: The spinning robot. Sol paid you 500g.');
    expect(chatBoxView(chat)?.line).not.toBe(SOL_JOB.hook);
    expect(talk(ready, 'marigold').jobs).toBe(ready.jobs);
  });

  it("doesn't finish a job whose check fails", () => {
    const later = act(TAKEN, actions.tick(60));
    expect(later.jobs).toBe(TAKEN.jobs);
    expect(later.player.gold).toBe(TAKEN.player.gold);
  });
});

describe('the morning reset', () => {
  it("leaves a job set up once (job 1's bed) as it is", () => {
    expect(JOB_PLAYS.spinningRobot.morning).toBeNull();
    expect(jobMorning(TAKEN)).toBe(TAKEN);
    const morning = act(TAKEN, actions.sleep());
    expect(morning.jobs.fieldDay).toBe(TAKEN.jobs.fieldDay);
  });
});
