/**
 * One due minute of a block-program robot (farmclaws part 2 spec §6.1 and §7), in the fixed
 * order: DO power down, DO return, then the program (a running stack) or the trigger checks
 * (an idle robot), then the DON'T check on the chosen action. DON'T beats DO beats the program,
 * and nothing else decides. Pure: reads the start-of-minute state and says what should happen;
 * run.ts and execute.ts apply it.
 */
import { invariant } from '../core/invariant';
import type { BlockProgram, GameState, ItemId, MdCard, Robot, RobotAction, RobotExec, RobotLogEvent, TileCoord, Trigger } from '../core/types';
import { weatherWaters } from '../time/weather';
import { startStack, stepProgram, type GaveUp, type Step } from './interpret';
import { dontForbids, dueReturnCard, keptItems, powerDownCard, returnFrameOf, returnTarget } from './md';
import { canEnter, nextRouteAction, planRoute } from './route';
import { bagStacks, wakeCostFor } from './stats';

export type Turn =
  | { readonly kind: 'wait' } // idle, nothing fired: next check one period later, free
  | {
      readonly kind: 'act';
      readonly action: RobotAction;
      readonly exec: RobotExec;
      readonly wakeCost: number;
      readonly keep: ReadonlySet<ItemId>;
      readonly events: readonly RobotLogEvent[];
    }
  | {
      readonly kind: 'skip';
      readonly action: RobotAction;
      readonly card: MdCard;
      readonly exec: RobotExec;
      readonly wakeCost: number;
      readonly events: readonly RobotLogEvent[];
    }
  | { readonly kind: 'finish'; readonly exec: RobotExec; readonly wakeCost: number; readonly events: readonly RobotLogEvent[] }
  | { readonly kind: 'shutDown'; readonly exec: RobotExec; readonly event: RobotLogEvent; readonly events: readonly RobotLogEvent[] }
  | { readonly kind: 'dizzy'; readonly wakeCost: number; readonly events: readonly RobotLogEvent[] };

type Events = readonly RobotLogEvent[];

/** No stack running and no frames: what finishing or powering down leaves. The same exec when already so. */
function stopped(exec: RobotExec): RobotExec {
  return exec.running === null && exec.frames.length === 0 ? exec : { ...exec, running: null, frames: [] };
}

function gaveUpEvents(list: readonly GaveUp[]): Events {
  return list.map((g): RobotLogEvent => ({ kind: 'gaveUp', target: g.target, why: g.why }));
}

/** The DON'T check (spec §6.1 step 4): a forbidden action is skipped, naming the first card that forbade it. */
function checked(state: GameState, robot: Robot, action: RobotAction, exec: RobotExec, wakeCost: number, events: Events): Turn {
  const card = dontForbids(state, robot, action);
  if (card !== null) return { kind: 'skip', action, card, exec, wakeCost, events };
  return { kind: 'act', action, exec, wakeCost, keep: keptItems(robot), events };
}

/**
 * A program step as the robot's turn. A `Power down` block ends the running stack, so the robot
 * is idle on standby and its triggers can wake it again (spec §7).
 */
function fromStep(state: GameState, robot: Robot, step: Step, wakeCost: number, events: Events): Turn {
  switch (step.kind) {
    case 'dizzy':
      return { kind: 'dizzy', wakeCost, events };
    case 'idle':
      return { kind: 'finish', exec: stopped(step.exec), wakeCost, events: [...events, ...gaveUpEvents(step.gaveUp)] };
    case 'act': {
      const exec = step.action.kind === 'powerDown' ? stopped(step.exec) : step.exec;
      return checked(state, robot, step.action, exec, wakeCost, [...events, ...gaveUpEvents(step.gaveUp)]);
    }
  }
}

function withDue(exec: RobotExec, index: number, due: number | null): RobotExec {
  return { ...exec, due: exec.due.map((d, i) => (i === index ? due : d)) };
}

function withFired(exec: RobotExec, index: number): RobotExec {
  return { ...exec, firedToday: exec.firedToday.map((f, i) => i === index || f) };
}

/**
 * The first stack, in program order, whose trigger fires for an idle robot now, started, with
 * its `due` or `firedToday` spent (spec §7). `morning` never fires from idle. Null when none fires.
 */
function fire(state: GameState, robot: Robot, program: BlockProgram, exec: RobotExec): { readonly trigger: Trigger; readonly exec: RobotExec } | null {
  const minute = state.time.minuteOfDay;
  for (let i = 0; i < program.stacks.length; i++) {
    const stack = program.stacks[i];
    invariant(stack !== undefined, `fire: no stack ${i}`);
    const trigger = stack.trigger;
    const due = exec.due[i] ?? null;
    const fired = exec.firedToday[i] ?? false;
    switch (trigger.kind) {
      case 'atTime':
        if (due !== null && due <= minute) return { trigger, exec: startStack(withDue(exec, i, null), i) };
        break;
      case 'every':
        if (due !== null && due <= minute) return { trigger, exec: startStack(withDue(exec, i, minute + trigger.minutes), i) };
        break;
      case 'bagFull':
        if (!fired && robot.bag.length >= bagStacks(robot)) return { trigger, exec: startStack(withFired(exec, i), i) };
        break;
      case 'startsRaining':
        if (!fired && weatherWaters(state.weather)) return { trigger, exec: startStack(withFired(exec, i), i) };
        break;
      case 'morning':
        break;
    }
  }
  return null;
}

/**
 * The first movement DON'T card (in .MD order) that stands between the robot and a DO return's
 * goal: removing it alone lets a route through. When it takes more than one card, the first of
 * them. Null when the goal is out of reach even without them (spec §6.1 step 2, `conflict`).
 */
function blockingDont(state: GameState, robot: Robot, card: MdCard): MdCard | null {
  const reachable = (md: readonly MdCard[]): boolean => {
    const free = { ...robot, md };
    const target = returnTarget(state, free, card);
    return target !== null && planRoute(state, free, target) !== null;
  };
  const movement: readonly MdCard[] = robot.md.filter((c) => c.kind === 'dontLeave' || c.kind === 'dontGoIntoWater');
  if (movement.length === 0 || !reachable(robot.md.filter((c) => !movement.includes(c)))) return null;
  return movement.find((c) => reachable(robot.md.filter((other) => other !== c))) ?? movement[0] ?? null;
}

/** A DO return that can't go on: the robot powers down where it stands for the day. */
function failReturn(state: GameState, robot: Robot, exec: RobotExec, card: MdCard, events: Events): Turn {
  const dont = blockingDont(state, robot, card);
  const conflict: Events = dont === null ? [] : [{ kind: 'conflict', doCard: card, dontCard: dont }];
  return { kind: 'shutDown', exec: stopped(exec), event: { kind: 'doReturn', card, phase: 'failed' }, events: [...events, ...conflict] };
}

/** Whether the saved path's next tile is beside the robot and can still be entered (Task 6's route rule). */
function usableNext(state: GameState, robot: Robot, tile: TileCoord): boolean {
  const here: TileCoord = { tx: robot.tx, tz: robot.tz };
  return Math.abs(tile.tx - robot.tx) + Math.abs(tile.tz - robot.tz) === 1 && canEnter(state, robot, here, tile);
}

/**
 * One minute of a DO return whose route frame is `exec`'s only frame: arrive (standby, done for
 * the day, card in doneCards), fail, or take the next move or turn. The path is re-planned when
 * it is empty, or its next tile isn't beside the robot (it was blocked, or carried somewhere) or
 * can no longer be entered, so a route move is never skipped.
 */
function walkReturn(state: GameState, robot: Robot, exec: RobotExec, card: { readonly card: MdCard; readonly index: number }, events: Events): Turn {
  const frame = returnFrameOf(exec);
  invariant(frame !== null, `walkReturn: robot ${robot.id} is not returning`);
  if (robot.tx === frame.target.tx && robot.tz === frame.target.tz) {
    const done = { ...stopped(exec), doneCards: [...exec.doneCards, card.index] };
    return { kind: 'shutDown', exec: done, event: { kind: 'doReturn', card: card.card, phase: 'arrived' }, events };
  }
  const first = frame.path[0];
  const path = first !== undefined && usableNext(state, robot, first) ? frame.path : planRoute(state, robot, frame.target);
  const next = path?.[0];
  if (path === null || next === undefined) return failReturn(state, robot, exec, card.card, events);
  const action = nextRouteAction(robot, next);
  const rest = action.kind === 'move' ? path.slice(1) : path;
  return checked(state, robot, action, { ...exec, frames: [{ ...frame, path: rest }] }, 0, events);
}

/** A DO return card has come due: it replaces the frames with its route and logs `started`, or fails at once. */
function startReturn(state: GameState, robot: Robot, exec: RobotExec, card: { readonly card: MdCard; readonly index: number }): Turn {
  const target = returnTarget(state, robot, card.card);
  const path = target === null ? null : planRoute(state, robot, target);
  if (target === null || path === null) return failReturn(state, robot, exec, card.card, []);
  const started: RobotExec = { ...exec, running: null, frames: [{ kind: 'route', target, path, why: 'doReturn' }] };
  return walkReturn(state, robot, started, card, [{ kind: 'doReturn', card: card.card, phase: 'started' }]);
}

/**
 * What a due, non-off, uncarried block-program robot (working or idle) does this minute
 * (spec §6.1, §7). `events` are logged before the outcome, in order.
 */
export function decideTurn(state: GameState, robot: Robot): Turn {
  const program = robot.program;
  const exec = robot.exec;
  invariant(program.kind === 'blocks' && exec !== null, `decideTurn: robot ${robot.id} has no block program`);
  invariant(robot.off === null && !robot.carried, `decideTurn: robot ${robot.id} is off or carried`);

  const powerDown = powerDownCard(state, robot);
  if (powerDown !== null) return { kind: 'shutDown', exec: stopped(exec), event: { kind: 'doPowerDown', card: powerDown }, events: [] };

  const due = dueReturnCard(state, robot);
  if (due !== null) return startReturn(state, robot, exec, due);
  if (returnFrameOf(exec) !== null) {
    // The card under way is the first due one not yet done; it is missing only if the .MD was edited mid-return.
    const card = dueReturnCard(state, { ...robot, exec: stopped(exec) });
    if (card === null) return { kind: 'finish', exec: stopped(exec), wakeCost: 0, events: [] };
    return walkReturn(state, robot, exec, card, []);
  }

  if (exec.running !== null) return fromStep(state, robot, stepProgram(state, robot), 0, []);
  const woken = fire(state, robot, program, exec);
  if (woken === null) return { kind: 'wait' };
  const events: Events = [{ kind: 'woke', trigger: woken.trigger }];
  return fromStep(state, robot, stepProgram(state, { ...robot, exec: woken.exec }), wakeCostFor(robot), events);
}
