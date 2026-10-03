/**
 * Zones A–H: named farm rectangles (farmclaws part 2 spec §2.1), and the tile ahead of a robot. Pure.
 */
import type { GameState, Robot, TileCoord, ZoneId, ZoneRect } from '../core/types';
import { stepTile } from '../world/grid';

/** The zone's rectangle, or null when the zone is empty. */
export function zoneOf(state: GameState, id: ZoneId): ZoneRect | null {
  return state.robots.zones[id];
}

export function inZone(rect: ZoneRect, tx: number, tz: number): boolean {
  return tx >= rect.x0 && tx < rect.x0 + rect.w && tz >= rect.z0 && tz < rect.z0 + rect.d;
}

/**
 * Every tile of `rect` in snake order (spec §5.1): rows by ascending z; even rows (counting from
 * z0) by ascending x, odd rows by descending x. No walkability filter.
 */
export function snakeTiles(rect: ZoneRect): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let row = 0; row < rect.d; row++) {
    for (let col = 0; col < rect.w; col++) {
      const tx = row % 2 === 0 ? rect.x0 + col : rect.x0 + rect.w - 1 - col;
      tiles.push({ tx, tz: rect.z0 + row });
    }
  }
  return tiles;
}

/** The tile one step ahead of the robot (it may be off the farm). */
export function tileAheadOf(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>): TileCoord {
  return stepTile({ tx: robot.tx, tz: robot.tz }, robot.facing);
}
