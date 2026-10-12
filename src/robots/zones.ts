/**
 * Zones A–H: named rectangles on the farm or the Neighbours map (farmclaws part 2 spec §2.1, part
 * 4c spec §5.3), and the tile ahead of a robot. Pure.
 */
import type { GameState, Robot, RobotMapId, TileCoord, ZoneId, ZoneRect } from '../core/types';
import { stepTile } from '../world/grid';

/**
 * The zone's rectangle on `mapId`, or null when the zone is empty or on the other map: seen from
 * one map, a zone on the other counts as empty (part 4c spec §5.3).
 */
export function zoneOf(state: GameState, id: ZoneId, mapId: RobotMapId): ZoneRect | null {
  return zoneOnMap(state.robots.zones[id], mapId);
}

/** `rect` when it lies on `mapId`, else null. */
export function zoneOnMap(rect: ZoneRect | null, mapId: RobotMapId): ZoneRect | null {
  return rect !== null && rect.mapId === mapId ? rect : null;
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

/** The rectangle on `mapId` with corners `a` and `b`, both included, whichever is given first (part 3 spec §8). */
export function zoneRectBetween(mapId: RobotMapId, a: TileCoord, b: TileCoord): ZoneRect {
  return {
    mapId,
    x0: Math.min(a.tx, b.tx),
    z0: Math.min(a.tz, b.tz),
    w: Math.abs(a.tx - b.tx) + 1,
    d: Math.abs(a.tz - b.tz) + 1,
  };
}

/** The tile one step ahead of the robot (it may be off the farm). */
export function tileAheadOf(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>): TileCoord {
  return stepTile({ tx: robot.tx, tz: robot.tz }, robot.facing);
}
