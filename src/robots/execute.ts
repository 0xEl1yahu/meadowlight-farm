/**
 * The robot executor (farmclaws part 1 spec §4): plans one robot action against the same tile
 * rules as the player's tools, then applies it and pays for it in tokens. Part 2 adds the .MD's
 * kept items for deposits, the committed exec of block programs, and the turns that take no tile
 * action (part 2 spec §6.1, §7). Pure.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import {
  Blocker,
  TileState,
  type Direction,
  type GameState,
  type ItemId,
  type ItemStack,
  type Robot,
  type RobotAction,
  type RobotActionKind,
  type RobotBlockReason,
  type RobotDidDetail,
  type RobotExec,
  type RobotLogEvent,
  type TileCoord,
} from '../core/types';
import { CROPS, createCropInstance, isInSeason, isMature, seedItemId } from '../farming/crops';
import { harvestedTile } from '../farming/harvest';
import { getItem } from '../items/items';
import { harvestQuality, harvestQuantity } from '../state/intents';
import { mergeStacks } from '../state/inventory';
import { pushMessage } from '../state/messages';
import { stepTile } from '../world/grid';
import { getTile, isSoil, isWalkable, requireTile, setTile } from '../world/tiles';
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, slotsRoom, takeIntoBag } from './bag';
import { logRobotEvent } from './log';
import { canDo } from './parts';
import { actionCost, bagStacks, periodFor } from './stats';
import type { Turn } from './turn';
import { chestSlots, containerOf, requireRobot, withFarm, withRobot } from './world';

/** `keep`: items a deposit leaves in the bag (the .MD's DON'T deposit cards, plan R3). */
export type RobotPlan =
  | { readonly ok: true; readonly action: RobotAction; readonly target: TileCoord; readonly cost: number; readonly keep: ReadonlySet<ItemId> }
  | {
      readonly ok: false;
      readonly action: RobotAction;
      readonly target: TileCoord;
      readonly reason: RobotBlockReason;
      readonly cost: number;
      readonly keep: ReadonlySet<ItemId>;
    };

/** Nothing kept back: scripts, and robots without DON'T deposit cards. */
export const NO_KEEP: ReadonlySet<ItemId> = new Set<ItemId>();

type OkPlan = Extract<RobotPlan, { readonly ok: true }>;

/** Actions that work the tile ahead; the rest work the robot's own tile. */
const AHEAD: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['move', 'refill', 'deposit', 'take']);

function turned(facing: Direction, side: 'left' | 'right'): Direction {
  return ((facing + (side === 'left' ? 3 : 1)) % 4) as Direction;
}

/**
 * What `action` would do for `robot` now, and what it costs. Reads only the farm, time, shipping
 * and the robot. A deposit offers only the bag's stacks whose item isn't in `keep`.
 */
export function planRobotAction(state: GameState, robot: Robot, action: RobotAction, keep: ReadonlySet<ItemId> = NO_KEEP): RobotPlan {
  const own: TileCoord = { tx: robot.tx, tz: robot.tz };
  const target = AHEAD.has(action.kind) ? stepTile(own, robot.facing) : own;
  const cost = actionCost(robot, action.kind);
  const ok: RobotPlan = { ok: true, action, target, cost, keep };
  const no = (reason: RobotBlockReason): RobotPlan => ({ ok: false, action, target, reason, cost: reason === 'noPart' ? 0 : cost, keep });
  if (!canDo(robot, action.kind)) return no('noPart');
  const tile = getTile(state.maps.farm, target.tx, target.tz);

  switch (action.kind) {
    case 'move':
      if (tile === null) return no('farmEdge');
      return tile.blocker === Blocker.Water || isWalkable(tile) ? ok : no('bumped');
    case 'turn':
    case 'say':
    case 'wait':
    case 'powerDown':
      return ok;
    case 'water':
      if (robot.tank <= 0) return no('tankEmpty');
      return tile !== null && tile.state === TileState.Plowed ? ok : no('notWaterable');
    case 'harvest': {
      const crop = tile?.crop ?? null;
      if (crop === null || crop.dead || !isMature(crop)) return no('nothingToHarvest');
      const quantity = harvestQuantity(state, target, crop, 'farm');
      const quality = harvestQuality(state, target, crop, 'farm');
      return bagRoom(robot.bag, bagStacks(robot), crop.cropId, quality) >= quantity ? ok : no('bagFull');
    }
    case 'till':
      return tile !== null && tile.state === TileState.Unplowed && tile.object === null && tile.crop === null ? ok : no('notTillable');
    case 'plant': {
      if (bagCount(robot.bag, seedItemId(action.cropId)) === 0) return no('noSeed');
      const def = CROPS[action.cropId];
      if (!isInSeason(def, state.time.season)) return no('outOfSeason');
      const plantable = tile !== null && def.habitat === 'field' && isSoil(tile) && tile.crop === null && tile.object === null;
      return plantable ? ok : no('cannotPlant');
    }
    case 'refill':
      if (tile === null || tile.blocker !== Blocker.Water) return no('noWaterAhead');
      return robot.tank < ROBOTS.tankCapacity ? ok : no('tankFull');
    case 'deposit': {
      const kind = containerOf(tile);
      if (kind === null) return no('nothingAhead');
      const offered = robot.bag.filter((s) => !keep.has(s.itemId));
      if (offered.length === 0) return no('bagEmpty');
      const slots = chestSlots(tile);
      const fits =
        kind === 'bin'
          ? offered.some((s) => getItem(s.itemId).sellPrice !== null)
          : offered.some((s) => slotsRoom(slots, s.itemId, s.quality) > 0);
      return fits ? ok : no('containerFull');
    }
    case 'take': {
      if (containerOf(tile) !== 'chest') return no('nothingAhead');
      const slots = chestSlots(tile);
      if (!slots.some((s) => s !== null && s.itemId === action.itemId)) return no('itemNotFound');
      return takeIntoBag(slots, robot.bag, bagStacks(robot), action.itemId).moved > 0 ? ok : no('bagFull');
    }
  }
}

/**
 * Finishes a robot's turn: a script advances pc (a non-looping script past its end goes to
 * standby and logs 'finished'); a block program leaves pc at 0 and takes `exec`, the position its
 * turn committed (part 2 spec §5.2). Then it schedules the next action and records lastAction
 * for the renderer.
 */
function settle(state: GameState, robotId: number, action: RobotAction, success: boolean, bickered: boolean, exec: RobotExec | null): GameState {
  const robot = requireRobot(state, robotId);
  const program = robot.program;
  const seq = robot.actionSeq + 1;
  let pc = robot.pc;
  let power = robot.power;
  let finished = false;
  if (program.kind === 'script') {
    pc = robot.pc + 1;
    if (pc >= program.steps.length) {
      pc = 0;
      if (!program.loop && power === 'working') {
        power = 'standby';
        finished = true;
      }
    }
  }
  const minute = state.time.minuteOfDay;
  const next = withRobot(state, {
    ...robot,
    pc,
    power,
    exec: exec ?? robot.exec,
    nextActMinute: minute + (action.kind === 'wait' ? action.minutes : periodFor(robot)),
    actionSeq: seq,
    lastAction: { seq, kind: action.kind, success, bickered },
  });
  return finished ? logRobotEvent(next, robotId, { kind: 'finished' }) : next;
}

function pay(state: GameState, robotId: number, cost: number): { readonly state: GameState; readonly robot: Robot } {
  const before = requireRobot(state, robotId);
  invariant(before.tokens >= cost, `robot ${robotId} can't afford ${cost} tokens`);
  const robot = { ...before, tokens: before.tokens - cost, tokensToday: before.tokensToday + cost };
  return { state: withRobot(state, robot), robot };
}

/**
 * Pays for `plan`, carries it out (or logs why not) and settles the robot's turn. A block
 * program passes the exec its turn committed.
 */
export function applyRobotPlan(state: GameState, robotId: number, plan: RobotPlan, exec: RobotExec | null = null): GameState {
  const paid = pay(state, robotId, plan.cost);
  if (!plan.ok) {
    const logged = logRobotEvent(paid.state, robotId, { kind: 'blocked', action: plan.action.kind, reason: plan.reason });
    return settle(logged, robotId, plan.action, false, false, exec);
  }
  const { next, event } = perform(paid.state, paid.robot, plan);
  return settle(logRobotEvent(next, robotId, event), robotId, plan.action, true, false, exec);
}

/** A bicker: the robot pays, the world doesn't change, and the clash is logged with the other robots' ids. */
export function applyBickerPlan(state: GameState, robotId: number, plan: RobotPlan, withIds: readonly number[], exec: RobotExec | null = null): GameState {
  const paid = pay(state, robotId, plan.cost);
  const logged = logRobotEvent(paid.state, robotId, { kind: 'bickered', action: plan.action.kind, withIds });
  return settle(logged, robotId, plan.action, false, true, exec);
}

/**
 * Pays `cost` tokens to wake (part 2 spec §7) and marks the robot working: a block robot taking a
 * turn is awake for it. With cost 0 on a working robot the state is unchanged.
 */
export function chargeWake(state: GameState, robotId: number, cost: number): GameState {
  const paid = pay(state, robotId, cost);
  return paid.robot.power === 'working' ? paid.state : withRobot(paid.state, { ...paid.robot, power: 'working' });
}

/**
 * Applies a block-program turn that takes no tile action (part 2 spec §6.1, §7). `wait`: the idle
 * robot checks again one period later, free, on standby. Otherwise the turn's events are logged
 * first, then the wake is paid (the caller made sure the robot can), then:
 * - skip: the forbidden action costs nothing, exec moves past it and the turn is taken
 * - finish: the stack ended; standby, logged 'finished', the next check one period later
 * - shutDown: standby and off until morning, with the deciding event
 * - dizzy: off until morning, power unchanged, logged and toasted
 */
export function applyTurn(state: GameState, robotId: number, turn: Exclude<Turn, { readonly kind: 'act' }>): GameState {
  const minute = state.time.minuteOfDay;
  if (turn.kind === 'wait') {
    const robot = requireRobot(state, robotId);
    return withRobot(state, { ...robot, power: 'standby', nextActMinute: minute + periodFor(robot) });
  }
  let next = state;
  for (const event of turn.events) next = logRobotEvent(next, robotId, event);
  if (turn.kind === 'shutDown') {
    const robot = requireRobot(next, robotId);
    return logRobotEvent(withRobot(next, { ...robot, power: 'standby', off: 'done', exec: turn.exec }), robotId, turn.event);
  }
  next = chargeWake(next, robotId, turn.wakeCost);
  const robot = requireRobot(next, robotId);
  switch (turn.kind) {
    case 'skip': {
      const skipped = logRobotEvent(next, robotId, { kind: 'skipped', action: turn.action.kind, card: turn.card });
      return settle(skipped, robotId, turn.action, false, false, turn.exec);
    }
    case 'finish': {
      const standby = withRobot(next, { ...robot, power: 'standby', exec: turn.exec, nextActMinute: minute + periodFor(robot) });
      return logRobotEvent(standby, robotId, { kind: 'finished' });
    }
    case 'dizzy': {
      const dizzy = logRobotEvent(withRobot(next, { ...robot, off: 'dizzy' }), robotId, { kind: 'dizzy' });
      return pushMessage(dizzy, `${robot.name} got dizzy going round in circles.`, 'warn');
    }
  }
}

function perform(state: GameState, robot: Robot, plan: OkPlan): { readonly next: GameState; readonly event: RobotLogEvent } {
  const { action, target } = plan;
  const farm = state.maps.farm;
  const did = (detail: RobotDidDetail): RobotLogEvent => ({ kind: 'did', action: action.kind, detail });
  const none = did({ kind: 'none' });

  switch (action.kind) {
    case 'move': {
      const moved: Robot = { ...robot, tx: target.tx, tz: target.tz, moveSeq: robot.moveSeq + 1 };
      if (requireTile(farm, target.tx, target.tz).blocker === Blocker.Water) {
        const broken = withRobot(state, { ...moved, power: 'broken' });
        return { next: pushMessage(broken, `${robot.name} drove into the water and shorted out.`, 'warn'), event: { kind: 'shortedOut' } };
      }
      return { next: withRobot(state, moved), event: none };
    }
    case 'turn':
      return { next: withRobot(state, { ...robot, facing: turned(robot.facing, action.side) }), event: none };
    case 'water': {
      const tile = requireTile(farm, target.tx, target.tz);
      const wet = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, state: TileState.Watered }));
      return { next: withRobot(wet, { ...robot, tank: robot.tank - 1 }), event: did({ kind: 'tile' }) };
    }
    case 'harvest': {
      const tile = requireTile(farm, target.tx, target.tz);
      const crop = tile.crop;
      invariant(crop !== null, 'harvest plan without a crop');
      const quantity = harvestQuantity(state, target, crop, 'farm');
      const quality = harvestQuality(state, target, crop, 'farm');
      const { bag } = addToBag(robot.bag, bagStacks(robot), crop.cropId, quantity, quality);
      const next = withRobot(withFarm(state, setTile(farm, target.tx, target.tz, harvestedTile(tile))), { ...robot, bag });
      return { next, event: did({ kind: 'crop', cropId: crop.cropId, quantity, quality }) };
    }
    case 'till': {
      const tile = requireTile(farm, target.tx, target.tz);
      return { next: withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, state: TileState.Plowed })), event: did({ kind: 'tile' }) };
    }
    case 'plant': {
      const tile = requireTile(farm, target.tx, target.tz);
      const crop = createCropInstance(action.cropId, state.time.absoluteDay);
      const planted = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, crop }));
      const bag = removeFromBag(robot.bag, seedItemId(action.cropId), 1);
      return { next: withRobot(planted, { ...robot, bag }), event: did({ kind: 'planted', cropId: action.cropId }) };
    }
    case 'refill':
      return { next: withRobot(state, { ...robot, tank: ROBOTS.tankCapacity }), event: none };
    case 'deposit':
      return deposit(state, robot, target, plan.keep);
    case 'take': {
      const tile = requireTile(farm, target.tx, target.tz);
      const taken = takeIntoBag(chestSlots(tile), robot.bag, bagStacks(robot), action.itemId);
      const chest = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, object: { kind: 'chest', slots: taken.slots } }));
      return {
        next: withRobot(chest, { ...robot, bag: taken.bag }),
        event: did({ kind: 'items', into: 'bag', stacks: taken.stacks, quantity: taken.moved }),
      };
    }
    case 'say':
    case 'wait':
      return { next: state, event: none };
    case 'powerDown':
      return { next: withRobot(state, { ...robot, power: 'standby' }), event: { kind: 'poweredDown' } };
  }
}

/** Empties the bag into the bin or chest ahead, leaving the `keep` items (and whatever didn't fit) in the bag. */
function deposit(state: GameState, robot: Robot, target: TileCoord, keep: ReadonlySet<ItemId>): { readonly next: GameState; readonly event: RobotLogEvent } {
  const farm = state.maps.farm;
  const tile = requireTile(farm, target.tx, target.tz);
  const kept: ItemStack[] = [];
  let stacks = 0;
  let quantity = 0;
  if (containerOf(tile) === 'bin') {
    let pending = state.shipping.pending;
    for (const s of robot.bag) {
      if (keep.has(s.itemId) || getItem(s.itemId).sellPrice === null) {
        kept.push(s);
        continue;
      }
      pending = mergeStacks(pending, s);
      stacks++;
      quantity += s.quantity;
    }
    const next = withRobot({ ...state, shipping: { ...state.shipping, pending } }, { ...robot, bag: kept });
    return { next, event: { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'bin', stacks, quantity } } };
  }
  let slots = chestSlots(tile);
  for (const s of robot.bag) {
    if (keep.has(s.itemId)) {
      kept.push(s);
      continue;
    }
    const result = addToSlots(slots, s);
    slots = result.slots;
    if (result.added > 0) {
      stacks++;
      quantity += result.added;
    }
    if (result.added < s.quantity) kept.push({ ...s, quantity: s.quantity - result.added });
  }
  const chest = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, object: { kind: 'chest', slots } }));
  return {
    next: withRobot(chest, { ...robot, bag: kept }),
    event: { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks, quantity } },
  };
}
