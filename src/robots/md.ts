/**
 * The Managing Directive (farmclaws part 2 spec §6). This half: what each DON'T card forbids
 * (§6.2). Pure.
 */
import { Blocker, type GameState, type ItemId, type MdCard, type Robot, type RobotAction, type TileCoord } from '../core/types';
import { getTile } from '../world/tiles';
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
