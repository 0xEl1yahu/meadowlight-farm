/**
 * Robots acting minute by minute (farmclaws part 1 spec §5.1–5.3, part 2 spec §8). Pure.
 */
import { invariant } from '../core/invariant';
import type { GameState, Robot, RobotActionKind, RobotExec, RobotLogEvent } from '../core/types';
import { pushMessage } from '../state/messages';
import { applyBickerPlan, applyRobotPlan, applyTurn, chargeWake, planRobotAction, type RobotPlan } from './execute';
import { logRobotEvent } from './log';
import { decideTurn, type Turn } from './turn';
import { requireRobot, withRobot } from './world';

/** Tile actions two robots can't share in one minute. */
const BICKER_ACTIONS: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['harvest', 'water', 'till', 'plant']);

/** A robot's choice this minute: an action to plan, bicker over and apply, or a block-program turn with no tile action. */
type Choice =
  /**
   * `exec` is the position a block program commits with the action (null for scripts). `events`
   * are logged and `wakeCost` is paid before the action.
   */
  | {
      readonly kind: 'act';
      readonly id: number;
      readonly plan: RobotPlan;
      readonly exec: RobotExec | null;
      readonly wakeCost: number;
      readonly events: readonly RobotLogEvent[];
    }
  | { readonly kind: 'turn'; readonly id: number; readonly turn: Exclude<Turn, { readonly kind: 'act' }> };

function goFlat(state: GameState, robotId: number): GameState {
  const robot = requireRobot(state, robotId);
  const flat = logRobotEvent(withRobot(state, { ...robot, power: 'flat' }), robotId, { kind: 'flat' });
  return pushMessage(flat, `${robot.name} ran out of power.`, 'warn');
}

/**
 * Whether `robot` takes a turn this minute: a working script robot (part 1), or a block-program
 * robot that is working or idle on standby and not off (part 2 spec §7, §8). Never while carried.
 */
function isDue(robot: Robot, minute: number): boolean {
  if (robot.carried || robot.nextActMinute > minute) return false;
  if (robot.program.kind === 'script') return robot.power === 'working';
  return robot.off === null && (robot.power === 'working' || robot.power === 'standby');
}

/**
 * The robot's choice against the start-of-minute state, or null when it can't pay and goes
 * flat. A turn that woke the robot must pay the wake on top of the action (plan R2); a robot
 * that can't commits nothing, so its trigger isn't spent.
 */
function choose(state: GameState, robot: Robot): Choice | null {
  const program = robot.program;
  if (program.kind === 'script') {
    const action = program.steps[robot.pc];
    invariant(action !== undefined, `robot ${robot.id} pc ${robot.pc} outside its script`);
    const plan = planRobotAction(state, robot, action);
    return robot.tokens < plan.cost ? null : { kind: 'act', id: robot.id, plan, exec: null, wakeCost: 0, events: [] };
  }
  const turn = decideTurn(state, robot);
  if (turn.kind === 'act') {
    const plan = planRobotAction(state, robot, turn.action, turn.keep);
    if (robot.tokens < turn.wakeCost + plan.cost) return null;
    return { kind: 'act', id: robot.id, plan, exec: turn.exec, wakeCost: turn.wakeCost, events: turn.events };
  }
  const wake = turn.kind === 'wait' || turn.kind === 'shutDown' ? 0 : turn.wakeCost;
  return robot.tokens < wake ? null : { kind: 'turn', id: robot.id, turn };
}

/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned (with the same kept items) and
 * applied in id order, block-program turns with no tile action among them.
 */
export function runRobotsMinute(state: GameState): GameState {
  const minute = state.time.minuteOfDay;
  const due = state.robots.list.filter((r) => isDue(r, minute));
  if (due.length === 0) return state;

  let next = state;
  const chosen: Choice[] = [];
  for (const robot of due) {
    const choice = choose(state, robot);
    if (choice === null) next = goFlat(next, robot.id);
    else chosen.push(choice);
  }

  const byTile = new Map<string, number[]>();
  for (const choice of chosen) {
    if (choice.kind !== 'act' || !choice.plan.ok || !BICKER_ACTIONS.has(choice.plan.action.kind)) continue;
    const key = `${choice.plan.target.tx},${choice.plan.target.tz}`;
    byTile.set(key, [...(byTile.get(key) ?? []), choice.id]);
  }
  const rivals = new Map<number, readonly number[]>();
  for (const ids of byTile.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) rivals.set(id, ids.filter((other) => other !== id));
  }

  for (const choice of chosen) {
    const id = choice.id;
    if (choice.kind === 'turn') {
      next = applyTurn(next, id, choice.turn);
      continue;
    }
    const { plan, exec, wakeCost, events } = choice;
    for (const event of events) next = logRobotEvent(next, id, event);
    // A block-program robot is awake for its action; a woken one pays the wake first.
    if (exec !== null) next = chargeWake(next, id, wakeCost);
    const others = rivals.get(id);
    if (others !== undefined) {
      next = applyBickerPlan(next, id, plan, others, exec);
      continue;
    }
    next = applyRobotPlan(next, id, planRobotAction(next, requireRobot(next, id), plan.action, plan.keep), exec);
  }
  return next;
}

/** Runs every minute after the current one up to and including `lastMinute`. */
export function runRobotsThrough(state: GameState, lastMinute: number): GameState {
  let next = state;
  for (let minute = state.time.minuteOfDay + 1; minute <= lastMinute; minute++) {
    next = runRobotsMinute({ ...next, time: { ...next.time, minuteOfDay: minute } });
  }
  return next;
}
