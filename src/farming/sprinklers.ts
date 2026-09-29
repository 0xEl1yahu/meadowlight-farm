/**
 * Sprinklers water the tilled soil around them overnight. The pipeline runs this before the
 * crops grow (so the night counts) and again after (so the soil is wet in the morning).
 */
import { TileState, type PlacedObject, type TileCoord, type WorldState } from '../core/types';
import { forEachTile, getTile, setTiles, type TileEdit } from '../world/tiles';

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const SURROUNDING: readonly (readonly [number, number])[] = [
  ...ORTHOGONAL,
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export type SprinklerKind = 'sprinkler' | 'qualitySprinkler';

export function isSprinklerKind(kind: PlacedObject['kind'] | string): kind is SprinklerKind {
  return kind === 'sprinkler' || kind === 'qualitySprinkler';
}

/** The tiles a sprinkler of `kind` at (tx, tz) covers: the 4 beside it, or the 8 around it. */
export function sprinklerCoverage(kind: SprinklerKind, tx: number, tz: number): readonly TileCoord[] {
  const offsets = kind === 'sprinkler' ? ORTHOGONAL : SURROUNDING;
  return offsets.map(([dx, dz]) => ({ tx: tx + dx, tz: tz + dz }));
}

/** Every plowed tile covered by a sprinkler becomes Watered. Returns `world` when nothing changes. */
export function runSprinklers(world: WorldState): WorldState {
  const edits: TileEdit[] = [];
  forEachTile(world, (tile, tx, tz) => {
    const object = tile.object;
    if (object === null || !isSprinklerKind(object.kind)) return;
    for (const c of sprinklerCoverage(object.kind, tx, tz)) {
      const covered = getTile(world, c.tx, c.tz);
      if (covered !== null && covered.state === TileState.Plowed) {
        edits.push({ tx: c.tx, tz: c.tz, tile: { ...covered, state: TileState.Watered } });
      }
    }
  });
  return edits.length === 0 ? world : setTiles(world, edits);
}
