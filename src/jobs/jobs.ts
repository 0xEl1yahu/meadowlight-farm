/**
 * The jobs (farmclaws part 4c spec §2, §3): three jobs in a fixed order, each with a giver, its
 * text, a reward and the blocks it unlocks, and the play that runs it: a set-up, an optional
 * morning reset, a pure success check and a progress line. Pure; the reducer adds the chat box
 * and the toasts.
 */
import { JOBS, UNLOCKS } from '../config';
import { JOB_IDS, type GameState, type JobId, type JobStatus, type JobsState, type NpcId, type Robot, type RobotSize, type RobotUnlocks } from '../core/types';
import { withUnlocks } from '../robots/unlocks';
import { knowTheLimitsDone, knowTheLimitsProgress, showHimDone, showHimProgress, spinningRobotDone, spinningRobotProgress } from './checks';
import { setUpBarnabyField, setUpCosmoField, setUpKnowTheLimits, setUpShowHim, setUpSpinningRobot } from './setup';

/** What a job says and pays, verbatim from spec §3 and §4. */
export interface JobDef {
  readonly title: string;
  readonly giver: NpcId;
  /** The job card's offer text. */
  readonly offer: string;
  /** The job card's goal text. */
  readonly goal: string;
  /** The giver's reactive line, before every other, while the job is offered (spec §2.2). */
  readonly hook: string;
  /** Gold paid when it's done. */
  readonly reward: number;
  /** Added through withUnlocks when the job is taken, because the job needs them (spec §4.1). */
  readonly unlocksOnTake: Partial<RobotUnlocks>;
  /** Toasted, one each, after "Job done" (spec §4.2's unlock lines). */
  readonly doneLines: readonly string[];
}

/** How a job runs in the world (spec §2.1). */
export interface JobPlay {
  /** Taking the job puts this into the world, or the sentence saying why it can't. */
  readonly setup: (state: GameState) => GameState | string;
  /** Run once each morning while the job is active, or null for a job set up once. */
  readonly morning: ((state: GameState) => GameState) | null;
  /** True once the job is done. Pure. */
  readonly check: (state: GameState) => boolean;
  /** The job card's progress line while the job is active. */
  readonly progress: (state: GameState) => string;
}

export const JOBS_TABLE: Readonly<Record<JobId, JobDef>> = {
  spinningRobot: {
    title: 'The spinning robot',
    giver: 'sol',
    offer:
      "Here's your first robot: a Mini with a watering head. Its program just spins. Rewrite it to water the bed by your workbench, then power down with tokens to spare.",
    goal: 'Water every tile of the bed, then power down with tokens left.',
    hook: "I've got a robot that needs a home. Ask me about the job.",
    reward: JOBS.rewards.spinningRobot,
    unlocksOnTake: UNLOCKS.job1,
    doneLines: ["Juniper's workshop is open."],
  },
  showHim: {
    title: 'Show him what it can do',
    giver: 'cosmo',
    offer: "My robot just says hello to the chickens. Could you teach it to harvest my field? It'll have to look before it picks.",
    goal: "Harvest every ripe crop in Cosmo's field, with a program that uses a sensor and an If.",
    hook: 'My robot could do more, I bet. Want a job?',
    reward: JOBS.rewards.showHim,
    unlocksOnTake: UNLOCKS.job2,
    doneLines: ["Sol's parts shop is open."],
  },
  knowTheLimits: {
    title: 'Know the limits',
    giver: 'barnaby',
    offer: 'Four robots, one field, zero effort. It just never gets finished. Sort my team out?',
    goal: "Harvest Barnaby's whole field by 6:00 pm in one day, at 5 tokens a crop or less.",
    hook: 'My team needs a manager. Interested?',
    reward: JOBS.rewards.knowTheLimits,
    unlocksOnTake: UNLOCKS.job3,
    doneLines: ['Juniper now builds Standard and Big robots.'],
  },
};

/** How each job runs. */
export const JOB_PLAYS: Readonly<Record<JobId, JobPlay>> = {
  spinningRobot: { setup: setUpSpinningRobot, morning: null, check: spinningRobotDone, progress: spinningRobotProgress },
  showHim: { setup: setUpShowHim, morning: setUpCosmoField, check: showHimDone, progress: showHimProgress },
  knowTheLimits: { setup: setUpKnowTheLimits, morning: setUpBarnabyField, check: knowTheLimitsDone, progress: knowTheLimitsProgress },
};

/**
 * The shop gates (spec §4.2): Juniper's workshop, Sol's parts shop, and Standard and Big robots at
 * Juniper's. Each opens when its job is done.
 */
export const SHOP_GATES = ['workshop', 'partsShop', 'bigRobots'] as const;
export type ShopGate = (typeof SHOP_GATES)[number];

const GATE_JOBS: Readonly<Record<ShopGate, JobId>> = { workshop: 'spinningRobot', partsShop: 'showHim', bigRobots: 'knowTheLimits' };

/** True once `gate`'s job is done. */
export function isGateOpen(state: GameState, gate: ShopGate): boolean {
  return state.jobs.status[GATE_JOBS[gate]] === 'done';
}

/** The gate a robot of `size` waits behind at Juniper's: the workshop's for a Mini, job 3's for the others. */
export function sizeGate(size: RobotSize): ShopGate {
  return size === 'mini' ? 'workshop' : 'bigRobots';
}

/** The active job, or null (at most one is active). */
export function activeJob(state: GameState): JobId | null {
  return JOB_IDS.find((id) => state.jobs.status[id] === 'active') ?? null;
}

/**
 * True when the player may work on `robot` where it stands (spec §5.2): it's a neighbour's robot
 * and its owner's job is active.
 */
export function isJobRobot(state: GameState, robot: Robot): boolean {
  const id = activeJob(state);
  return robot.owner !== 'player' && id !== null && JOBS_TABLE[id].giver === robot.owner;
}

/** `npc`'s job while it's offered or active, or null: what the Job button opens. */
export function giverJob(state: GameState, npc: NpcId): JobId | null {
  for (const id of JOB_IDS) {
    const status = state.jobs.status[id];
    if (JOBS_TABLE[id].giver === npc && (status === 'offered' || status === 'active')) return id;
  }
  return null;
}

/** The progress line of job `id` while it's active, else null. */
export function jobProgress(state: GameState, id: JobId): string | null {
  return state.jobs.status[id] !== 'active' ? null : JOB_PLAYS[id].progress(state);
}

/**
 * Takes the offered job `id` (spec §2.1): its unlocks are added, its set-up runs and it becomes
 * active, with today as its field day. Returns the set-up's refusal, with nothing changed; a job
 * that isn't offered leaves the state as it is.
 */
export function takeJob(state: GameState, id: JobId): GameState | string {
  if (state.jobs.status[id] !== 'offered') return state;
  const set = JOB_PLAYS[id].setup(withUnlocks(state, JOBS_TABLE[id].unlocksOnTake));
  if (typeof set === 'string') return set;
  return { ...set, jobs: { ...set.jobs, status: withStatus(set.jobs.status, id, 'active'), fieldDay: set.time.absoluteDay } };
}

/** Finishes job `id`: done, the next job offered, the reward paid, no field day. Toasts are the caller's. */
export function finishJob(state: GameState, id: JobId): GameState {
  const nextId = JOB_IDS[JOB_IDS.indexOf(id) + 1];
  const done = withStatus(state.jobs.status, id, 'done');
  const status = nextId === undefined ? done : withStatus(done, nextId, 'offered');
  return {
    ...state,
    player: { ...state.player, gold: state.player.gold + JOBS_TABLE[id].reward },
    jobs: { ...state.jobs, status, fieldDay: -1 },
  };
}

function withStatus(status: JobsState['status'], id: JobId, to: JobStatus): JobsState['status'] {
  return { ...status, [id]: to };
}

/** The active job whose check passes, or null. */
export function passedJob(state: GameState): JobId | null {
  const id = activeJob(state);
  return id !== null && JOB_PLAYS[id].check(state) ? id : null;
}

/** The active job's morning reset, once per day (`jobs.fieldDay`); the same state without one. */
export function jobMorning(state: GameState): GameState {
  const id = activeJob(state);
  const morning = id === null ? null : JOB_PLAYS[id].morning;
  const day = state.time.absoluteDay;
  if (morning === null || state.jobs.fieldDay === day) return state;
  const next = morning(state);
  return { ...next, jobs: { ...next.jobs, fieldDay: day } };
}
