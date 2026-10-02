/**
 * Robots acting minute by minute (farmclaws part 1 spec §5.1–5.3). Pure.
 */
import { invariant } from '../core/invariant';
import type { GameState, RobotActionKind } from '../core/types';
import { pushMessage } from '../state/messages';
import { applyBickerPlan, applyRobotPlan, planRobotAction, type RobotPlan } from './execute';
import { logRobotEvent } from './log';
import { requireRobot, withRobot } from './world';

/** Tile actions two robots can't share in one minute. */
const BICKER_ACTIONS: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['harvest', 'water', 'till', 'plant']);

function goFlat(state: GameState, robotId: number): GameState {
  const robot = requireRobot(state, robotId);
  const flat = logRobotEvent(withRobot(state, { ...robot, power: 'flat' }), robotId, { kind: 'flat' });
  return pushMessage(flat, `${robot.name} ran out of power.`, 'warn');
}

/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned and applied in id order.
 * Due robots are working script robots that aren't carried; a script robot chooses `steps[pc]`.
 */
export function runRobotsMinute(state: GameState): GameState {
  const minute = state.time.minuteOfDay;
  const due = state.robots.list.filter(
    (r) => r.program.kind === 'script' && !r.carried && r.power === 'working' && r.nextActMinute <= minute,
  );
  if (due.length === 0) return state;

  let next = state;
  const chosen: { readonly id: number; readonly plan: RobotPlan }[] = [];
  for (const robot of due) {
    const program = robot.program;
    invariant(program.kind === 'script', `robot ${robot.id} is due without a script`);
    const action = program.steps[robot.pc];
    invariant(action !== undefined, `robot ${robot.id} pc ${robot.pc} outside its script`);
    const plan = planRobotAction(state, robot, action);
    if (robot.tokens < plan.cost) next = goFlat(next, robot.id);
    else chosen.push({ id: robot.id, plan });
  }

  const byTile = new Map<string, number[]>();
  for (const { id, plan } of chosen) {
    if (!plan.ok || !BICKER_ACTIONS.has(plan.action.kind)) continue;
    const key = `${plan.target.tx},${plan.target.tz}`;
    byTile.set(key, [...(byTile.get(key) ?? []), id]);
  }
  const rivals = new Map<number, readonly number[]>();
  for (const ids of byTile.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) rivals.set(id, ids.filter((other) => other !== id));
  }

  for (const { id, plan } of chosen) {
    const others = rivals.get(id);
    if (others !== undefined) {
      next = applyBickerPlan(next, id, plan, others);
      continue;
    }
    next = applyRobotPlan(next, id, planRobotAction(next, requireRobot(next, id), plan.action));
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
