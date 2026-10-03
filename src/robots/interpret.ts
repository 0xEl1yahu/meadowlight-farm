/**
 * The interpreter (farmclaws part 2 spec §5.1): walks a robot's saved frame stack until it
 * reaches one action, without changing the state. Pure.
 *
 * Step budget: each statement passed that isn't an action costs one step, and so does each
 * further iteration a loop starts (passing the loop statement starts its first iteration).
 * Expressions, route planning and finishing a route are free. Reaching ROBOTS.stepBudget
 * steps without an action makes the robot dizzy.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import type {
  ActionBlock,
  BlockProgram,
  Frame,
  GameState,
  ListRef,
  LoopState,
  Robot,
  RobotAction,
  RobotExec,
  Statement,
  TileCoord,
  Value,
} from '../core/types';
import { manhattanDistance } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import { clampNumber, evaluate, type EvalContext } from './eval';
import { resolveList } from './program';
import { canEnter, nextRouteAction, planRoute } from './route';
import { snakeTiles, zoneOf } from './zones';

/** A route the interpreter abandoned this turn, for the caller to log as `gaveUp`. */
export interface GaveUp {
  readonly target: TileCoord;
  readonly why: 'goTo' | 'forEach' | 'doReturn';
}

export type Step =
  | { readonly kind: 'act'; readonly action: RobotAction; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'idle'; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'dizzy' };

type ListFrame = Extract<Frame, { readonly kind: 'list' }>;
type RouteFrame = Extract<Frame, { readonly kind: 'route' }>;

/** Starts trigger stack `index`: running = index, frames = [list frame on the stack body]. */
export function startStack(exec: RobotExec, index: number): RobotExec {
  return { ...exec, running: index, frames: [{ kind: 'list', list: { root: 'stack', index, path: [] }, next: 0, loop: null }] };
}

function listOf(program: BlockProgram, ref: ListRef): readonly Statement[] {
  const list = resolveList(program, ref);
  invariant(list !== null, `frame list ${JSON.stringify(ref)} doesn't resolve`);
  return list;
}

function bodyFrame(parent: ListRef, statement: number, branch: 'body' | 'then' | 'else', loop: LoopState | null): ListFrame {
  return { kind: 'list', list: { root: parent.root, index: parent.index, path: [...parent.path, [statement, branch]] }, next: 0, loop };
}

function routeFrame(target: TileCoord, why: RouteFrame['why']): RouteFrame {
  return { kind: 'route', target, path: [], why };
}

/** The loop statement whose body the frame at `ref` walks. */
function loopStatement(program: BlockProgram, ref: ListRef): Statement {
  const last = ref.path[ref.path.length - 1];
  invariant(last !== undefined, 'a loop frame walks a loop body');
  const statement = listOf(program, { ...ref, path: ref.path.slice(0, -1) })[last[0]];
  invariant(statement !== undefined, 'a loop frame has a loop statement');
  return statement;
}

/** Index of the first tile at or after `from` a robot can stand on now, or -1. */
function nextStandable(state: GameState, tiles: readonly TileCoord[], from: number): number {
  for (let i = from; i < tiles.length; i++) {
    const coord = tiles[i];
    const tile = coord === undefined ? null : getTile(state.maps.farm, coord.tx, coord.tz);
    if (tile !== null && isWalkable(tile)) return i;
  }
  return -1;
}

function numberOf(value: Value): number {
  invariant(value.type === 'number', `expected a number, got ${value.type}`);
  return value.value;
}

function yesNoOf(value: Value): boolean {
  invariant(value.type === 'yesNo', `expected a yes/no, got ${value.type}`);
  return value.value;
}

/** A part 1 action from an action block, its sockets evaluated (spec §5.1 `do`). */
function toAction(block: ActionBlock, ctx: EvalContext): RobotAction {
  switch (block.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return { kind: block.kind };
    case 'turn':
      return { kind: 'turn', side: block.side };
    case 'plant':
      return { kind: 'plant', cropId: block.cropId };
    case 'take': {
      const item = evaluate(block.item, ctx);
      invariant(item.type === 'item', `take needs an item, got ${item.type}`);
      return { kind: 'take', itemId: item.value };
    }
    case 'say': {
      const text = evaluate(block.text, ctx);
      invariant(text.type === 'text', `say needs text, got ${text.type}`);
      const cut = Array.from(text.value.trim()).slice(0, ROBOTS.sayMaxLength).join('').trim();
      return { kind: 'say', text: cut === '' ? '…' : cut };
    }
    case 'wait': {
      const minutes = numberOf(evaluate(block.minutes, ctx));
      return { kind: 'wait', minutes: Math.max(1, Math.min(ROBOTS.maxWaitMinutes, minutes)) };
    }
  }
}

type RouteStep =
  | { readonly kind: 'arrived' }
  | { readonly kind: 'noRoute' }
  | { readonly kind: 'act'; readonly action: RobotAction; readonly frame: RouteFrame };

/**
 * One minute of a route. It re-plans when it has no path, or when the next path tile is no
 * longer next to the robot (it was blocked, or picked up and put down) or can no longer be
 * entered. A move drops the tile it heads for from the saved path.
 */
function stepRoute(state: GameState, robot: Robot, frame: RouteFrame): RouteStep {
  const here: TileCoord = { tx: robot.tx, tz: robot.tz };
  if (here.tx === frame.target.tx && here.tz === frame.target.tz) return { kind: 'arrived' };
  const next = frame.path[0];
  const usable = next !== undefined && manhattanDistance(here, next) === 1 && canEnter(state, robot, here, next);
  const path = usable ? frame.path : planRoute(state, robot, frame.target);
  if (path === null) return { kind: 'noRoute' };
  const first = path[0];
  invariant(first !== undefined, 'a route away from its target has a next tile');
  const action = nextRouteAction(robot, first);
  return { kind: 'act', action, frame: { ...frame, path: action.kind === 'move' ? path.slice(1) : path } };
}

/**
 * Walks `robot.exec` until it reaches an action (`act`), the running stack ends (`idle`), or
 * the step budget runs out (`dizzy`). Reads `state` and the robot as they are at the start of
 * the minute and changes neither; the returned exec is committed only when the turn resolves.
 */
export function stepProgram(state: GameState, robot: Robot): Step {
  const program = robot.program;
  const exec = robot.exec;
  invariant(program.kind === 'blocks' && exec !== null, `robot ${robot.id} has no block program to step`);
  const frames: Frame[] = exec.frames.slice();
  let vars = exec.vars;
  const gaveUp: GaveUp[] = [];
  let steps = 0;

  const ctx = (): EvalContext => ({ state, robot, program, vars });
  const snapshot = (): RobotExec => ({ ...exec, running: frames.length === 0 ? null : exec.running, frames: frames.slice(), vars });
  const spend = (): boolean => {
    steps++;
    return steps >= ROBOTS.stepBudget;
  };
  const setVar = (name: string, value: Value): void => {
    const index = program.vars.findIndex((decl) => decl.name === name);
    invariant(index !== -1, `unknown variable ${name}`);
    const next = vars.slice();
    next[index] = value.type === 'number' ? { type: 'number', value: clampNumber(value.value) } : value;
    vars = next;
  };

  for (;;) {
    const top = frames[frames.length - 1];
    if (top === undefined) return { kind: 'idle', exec: snapshot(), gaveUp };
    const at = frames.length - 1;

    if (top.kind === 'route') {
      const route = stepRoute(state, robot, top);
      if (route.kind === 'act') {
        frames[at] = route.frame;
        return { kind: 'act', action: route.action, exec: snapshot(), gaveUp };
      }
      frames.pop();
      if (route.kind === 'noRoute') {
        gaveUp.push({ target: top.target, why: top.why });
        const body = frames[frames.length - 1];
        // A `For each tile` skips the tile it couldn't reach: its body ends for that tile.
        if (top.why === 'forEach' && body !== undefined && body.kind === 'list') {
          frames[frames.length - 1] = { ...body, next: listOf(program, body.list).length };
        }
      }
      continue;
    }

    const list = listOf(program, top.list);
    const statement = list[top.next];

    if (statement === undefined) {
      const loop = top.loop;
      if (loop === null) {
        frames.pop();
        continue;
      }
      let again: LoopState | null;
      switch (loop.kind) {
        case 'times':
          again = loop.left > 0 ? { kind: 'times', left: loop.left - 1 } : null;
          break;
        case 'until': {
          const repeat = loopStatement(program, top.list);
          invariant(repeat.kind === 'repeatUntil', 'an until frame walks a Repeat until body');
          again = yesNoOf(evaluate(repeat.until, ctx())) ? null : loop;
          break;
        }
        case 'forever':
          again = loop;
          break;
        case 'forEach': {
          const i = nextStandable(state, loop.tiles, loop.i + 1);
          again = i === -1 ? null : { kind: 'forEach', tiles: loop.tiles, i };
          break;
        }
      }
      if (again === null) {
        frames.pop();
        continue;
      }
      if (spend()) return { kind: 'dizzy' };
      frames[at] = { ...top, next: 0, loop: again };
      if (again.kind === 'forEach') {
        const tile = again.tiles[again.i];
        invariant(tile !== undefined, 'a For each iteration has a tile');
        frames.push(routeFrame(tile, 'forEach'));
      }
      continue;
    }

    frames[at] = { ...top, next: top.next + 1 };
    if (statement.kind === 'do') return { kind: 'act', action: toAction(statement.action, ctx()), exec: snapshot(), gaveUp };
    if (spend()) return { kind: 'dizzy' };

    switch (statement.kind) {
      case 'repeatTimes': {
        const times = Math.max(0, Math.min(ROBOTS.maxRepeatTimes, numberOf(evaluate(statement.times, ctx()))));
        if (times > 0) frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'times', left: times - 1 }));
        break;
      }
      case 'repeatUntil':
        if (!yesNoOf(evaluate(statement.until, ctx()))) frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'until' }));
        break;
      case 'repeatForever':
        frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'forever' }));
        break;
      case 'if':
        if (yesNoOf(evaluate(statement.cond, ctx()))) frames.push(bodyFrame(top.list, top.next, 'then', null));
        else if (statement.else !== null) frames.push(bodyFrame(top.list, top.next, 'else', null));
        break;
      case 'forEachTile': {
        const rect = zoneOf(state, statement.zone);
        const tiles = rect === null ? [] : snakeTiles(rect);
        const i = nextStandable(state, tiles, 0);
        const first = tiles[i];
        if (first !== undefined) {
          frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'forEach', tiles, i }));
          frames.push(routeFrame(first, 'forEach'));
        }
        break;
      }
      case 'goTo': {
        const tile = evaluate(statement.tile, ctx());
        invariant(tile.type === 'tile', `Go to needs a tile, got ${tile.type}`);
        frames.push(routeFrame(tile.value, 'goTo'));
        break;
      }
      case 'set':
        setVar(statement.name, evaluate(statement.value, ctx()));
        break;
      case 'change': {
        const index = program.vars.findIndex((decl) => decl.name === statement.name);
        const current = vars[index];
        invariant(current !== undefined, `unknown variable ${statement.name}`);
        setVar(statement.name, { type: 'number', value: numberOf(current) + numberOf(evaluate(statement.by, ctx())) });
        break;
      }
      case 'runHelper': {
        const index = program.helpers.findIndex((helper) => helper.name === statement.name);
        invariant(index !== -1, `unknown helper ${statement.name}`);
        frames.push({ kind: 'list', list: { root: 'helper', index, path: [] }, next: 0, loop: null });
        break;
      }
    }
  }
}
