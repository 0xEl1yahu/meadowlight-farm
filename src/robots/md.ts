/**
 * The Managing Directive (farmclaws part 2 spec §6). What each DON'T card forbids (§6.2), then
 * the DO cards (§6.1) and card text (§11). Pure.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import { Blocker, type Frame, type GameState, type ItemId, type MdCard, type Robot, type RobotAction, type RobotExec, type TileCoord } from '../core/types';
import { CROPS } from '../farming/crops';
import { getItem } from '../items/items';
import { formatClock } from '../time/clock';
import { weatherWaters } from '../time/weather';
import { chebyshevDistance } from '../world/grid';
import { forEachTile, getTile } from '../world/tiles';
import { reachableInOrder } from './route';
import { bagStacks } from './stats';
import { inZone, tileAheadOf, zoneOf } from './zones';

/** The first card that forbids one step from `from` to `to` (`dontLeave`, `dontGoIntoWater`), or null. */
export function moveForbiddenBy(robot: Robot, from: TileCoord, to: TileCoord, state: GameState): MdCard | null {
  for (const card of robot.md) {
    if (card.kind === 'dontLeave') {
      const rect = zoneOf(state, card.zone);
      if (rect !== null && inZone(rect, from.tx, from.tz) && !inZone(rect, to.tx, to.tz)) return card;
    } else if (card.kind === 'dontGoIntoWater') {
      if (getTile(state.maps.farm, to.tx, to.tz)?.blocker === Blocker.Water) return card;
    }
  }
  return null;
}

/** Items the robot's `dontDeposit` cards keep in its bag. */
export function keptItems(robot: Robot): ReadonlySet<ItemId> {
  const kept = new Set<ItemId>();
  for (const card of robot.md) if (card.kind === 'dontDeposit') kept.add(card.itemId);
  return kept;
}

/**
 * The first card that forbids `action` for `robot` now, or null (spec §6.2). A deposit is
 * forbidden only when every stack in a non-empty bag is kept; then the first `dontDeposit` card
 * naming an item in the bag is the one that forbade it.
 */
export function dontForbids(state: GameState, robot: Robot, action: RobotAction): MdCard | null {
  switch (action.kind) {
    case 'move':
      return moveForbiddenBy(robot, { tx: robot.tx, tz: robot.tz }, tileAheadOf(robot), state);
    case 'harvest': {
      const crop = getTile(state.maps.farm, robot.tx, robot.tz)?.crop ?? null;
      if (crop === null) return null;
      return robot.md.find((card) => card.kind === 'dontHarvest' && card.cropId === crop.cropId) ?? null;
    }
    case 'deposit': {
      const kept = keptItems(robot);
      if (robot.bag.length === 0 || !robot.bag.every((s) => kept.has(s.itemId))) return null;
      return robot.md.find((card) => card.kind === 'dontDeposit' && robot.bag.some((s) => s.itemId === card.itemId)) ?? null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// DO cards (farmclaws part 2 spec §6.1 steps 1 and 2) and card text (§11)
// ---------------------------------------------------------------------------

type RouteFrame = Extract<Frame, { readonly kind: 'route' }>;

/** The DO return under way, or null. During a return no stack runs and the only frame is its route (plan R1). */
export function returnFrameOf(exec: RobotExec): RouteFrame | null {
  const frame = exec.frames[0];
  if (exec.running !== null || exec.frames.length !== 1 || frame === undefined || frame.kind !== 'route') return null;
  return frame.why === 'doReturn' ? frame : null;
}

/** The first DO power-down card whose condition holds now (spec §6.1 step 1). */
export function powerDownCard(state: GameState, robot: Robot): MdCard | null {
  for (const card of robot.md) {
    if (card.kind !== 'doPowerDown') continue;
    const when = card.when;
    if (when.kind === 'bagFull' && robot.bag.length >= bagStacks(robot)) return card;
    if (when.kind === 'tokensBelow' && robot.tokens < when.n) return card;
    if (when.kind === 'raining' && weatherWaters(state.weather)) return card;
  }
  return null;
}

/**
 * The DO return card to carry out: among those whose minute has come and that weren't carried
 * out today, the earliest minute, ties by .MD order, with its index in the .MD (spec §6.1 step 2). Null while a return is already under way.
 */
export function dueReturnCard(state: GameState, robot: Robot): { readonly card: MdCard; readonly index: number } | null {
  const exec = robot.exec;
  if (exec === null || returnFrameOf(exec) !== null) return null;
  let best: { readonly card: MdCard; readonly index: number; readonly minute: number } | null = null;
  for (let index = 0; index < robot.md.length; index++) {
    const card = robot.md[index];
    if (card === undefined || card.kind !== 'doReturn') continue;
    if (card.minute > state.time.minuteOfDay || exec.doneCards.includes(index)) continue;
    if (best === null || card.minute < best.minute) best = { card, index, minute: card.minute };
  }
  return best === null ? null : { card: best.card, index: best.index };
}

/** The farm's wood burners in tile order: by row (tz), then column (tx). */
function burnerTiles(state: GameState): readonly TileCoord[] {
  const burners: TileCoord[] = [];
  forEachTile(state.maps.farm, (tile, tx, tz) => {
    if (tile.object?.kind === 'woodBurner') burners.push({ tx, tz });
  });
  return burners.sort((a, b) => a.tz - b.tz || a.tx - b.tx);
}

/**
 * Where a DO return card sends the robot (spec §6.1 step 2): its tile, or for `generator` the
 * first tile within ROBOTS.chargeRadius of the wood burner nearest by route length (ties: the
 * burner first in tile order). Null when the farm has no burner or none can be reached.
 */
export function returnTarget(state: GameState, robot: Robot, card: MdCard): TileCoord | null {
  invariant(card.kind === 'doReturn', `returnTarget: a ${card.kind} card is not a DO return`);
  if (card.to.kind === 'tile') return { tx: card.to.tx, tz: card.to.tz };
  const burners = burnerTiles(state);
  if (burners.length === 0) return null;
  const reached = reachableInOrder(state, robot);
  let best: { readonly tile: TileCoord; readonly steps: number } | null = null;
  for (const burner of burners) {
    const near = reached.find((r) => chebyshevDistance(r.tile, burner) <= ROBOTS.chargeRadius);
    if (near !== undefined && (best === null || near.steps < best.steps)) best = near;
  }
  return best === null ? null : best.tile;
}

/**
 * The card's dropdown sentence (spec §11): "leave Zone A", "go into water", "return to the
 * nearest generator at 6:00 pm". A DON'T card's text follows "don't"; a DO card's stands alone.
 */
export function mdCardText(card: MdCard): string {
  switch (card.kind) {
    case 'dontLeave':
      return `leave Zone ${card.zone}`;
    case 'dontGoIntoWater':
      return 'go into water';
    case 'dontHarvest':
      return `harvest ${CROPS[card.cropId].name}`;
    case 'dontDeposit':
      return `deposit ${getItem(card.itemId).name}`;
    case 'doReturn': {
      const where = card.to.kind === 'generator' ? 'the nearest generator' : `(${card.to.tx}, ${card.to.tz})`;
      return `return to ${where} at ${formatClock(card.minute, 1)}`;
    }
    case 'doPowerDown': {
      const when = card.when;
      if (when.kind === 'tokensBelow') return `power down when I have fewer than ${when.n} tokens`;
      return when.kind === 'bagFull' ? 'power down when my bag is full' : 'power down when it rains';
    }
  }
}
