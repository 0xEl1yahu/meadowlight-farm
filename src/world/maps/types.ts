/**
 * Static map definitions. Every map is a fixed-size grid with its own generator, warps to the
 * other maps, reserved tiles (warps and arrivals, always kept clear), structures, shade and
 * ground surfaces. Definitions are data plus pure lookups; the mutable part of a map lives in
 * `GameState.maps[id]` as a WorldState.
 */
import type { FarmLayout } from '../../config';
import type {
  Direction,
  GridSpec,
  MapId,
  StructureKind,
  TileCoord,
  TileRect,
  WorldState,
} from '../../core/types';

export interface Warp {
  /** An edge tile of this map. */
  readonly from: TileCoord;
  /** Stepping this way from `from` would leave the grid → warp. */
  readonly exit: Direction;
  readonly to: { readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction };
}

export type Surface = 'grass' | 'dirt' | 'cobble';
export type SceneryStyle = 'farm' | 'forest' | 'town';

export interface StructurePlacement {
  readonly kind: StructureKind;
  readonly rect: TileRect;
  readonly door: TileCoord | null;
}

export interface WildTuning {
  /** Nightly chance that an empty shaded grass tile sprouts a wild crop by itself. */
  readonly sproutChance: number;
  /** Extra nightly chance per orthogonal neighbour holding a mature wild crop. */
  readonly spreadChancePerNeighbor: number;
  /** Upper bound on wild crops on the map. */
  readonly maxWild: number;
  /** Share of eligible tiles that hold a wild crop on a freshly generated map. */
  readonly initialDensity: number;
}

export interface MapDefinition {
  readonly id: MapId;
  /** 'Meadowlight Farm' | 'Mossy Woods' | 'Brookhollow' */
  readonly name: string;
  /** createGridSpec(w, d, WORLD.chunkSize, WORLD.tileSize) */
  readonly grid: GridSpec;
  /** Hoe till and seed scatter work only where true (the farm). */
  readonly allowsTilling: boolean;
  readonly warps: readonly Warp[];
  /** Warp tiles + arrival tiles. Never hold debris, wild crops, weeds, objects or forage (generators and later workstreams check this). */
  readonly reserved: readonly TileCoord[];
  /** Blocker.Building footprints (town). */
  readonly structures: readonly StructurePlacement[];
  /** null → no wild crops on this map. */
  readonly wild: WildTuning | null;
  /** Farm only: house, door, bin, pond, clear zones, densities, plots. */
  readonly farmstead: FarmLayout | null;
  /** Render: what surrounds the grid. */
  readonly scenery: SceneryStyle;
  /** Render: meadow density on grass. */
  readonly decor: { readonly tuftChance: number; readonly flowerChance: number };
  /** Added to tile coords in render-only cosmetic hashes; (0,0) for the farm so it looks exactly as before. */
  readonly cosmeticOffset: { readonly x: number; readonly z: number };
  /** Pure, precomputed into a Uint8Array at module load. False out of bounds. */
  isShaded(tx: number, tz: number): boolean;
  /** Pure, precomputed. 'grass' out of bounds. */
  surfaceAt(tx: number, tz: number): Surface;
  /** `seed` is the save seed; the generator derives mapSeed internally. */
  generate(seed: number): WorldState;
}
