/**
 * Per-map scenery around the grid, as pure layout plus a few painted builders: where every warp
 * opens (a gap in the fence or wall, a clear corridor through the woodland and a painted trail
 * leading off the grid), each scenery style's planting profile and meadow tones, and the town's
 * low stone wall. StructureRenderer turns a {@link SceneryPlan} into meshes.
 *
 * Every placement here keeps the occlusion rule (wouldOccludeFarm, or wouldBoxOccludeFarm for
 * wall blocks) against the map's own grid: nothing outside the grid may hide a playable edge tile.
 */
import * as THREE from 'three';
import { Salt, hashFloat } from '../core/hash';
import { Direction } from '../core/types';
import { tileMinX, tileMinZ, worldRect, type WorldRect } from '../world/grid';
import type { MapDefinition, SceneryStyle } from '../world/maps';
import { HEIGHTS } from './constants';
import { box } from './geometryParts';
import { PALETTE } from './palette';
import {
  BUSH_TINTS,
  FARM_DENSITIES,
  boundaryRuns,
  FARM_MEADOW_TONES,
  isBackSide,
  wouldBoxOccludeFarm,
  type BoundaryGap,
  type CosmeticOffset,
  type MeadowSpec,
  type MeadowTones,
  type PlateauSide,
  type ScatterSpec,
  type SceneryDensities,
} from './structureGeometry';

/**
 * Meadow ring around the plateau. At CAMERA.maxViewHeight the view spans roughly 60 × 34 world
 * units (wider on ultrawide screens), i.e. up to ~50 units from the focus to a screen corner on
 * the ground, and the focus can sit on the plateau edge — an 80-unit margin always covers it.
 */
export const MEADOW = { margin: 80, cellSize: 4, drop: 0.06, holeInset: 0.5 } as const;

/** Warp openings, in tiles. */
export const OPENING = {
  /** A fence or wall gap reaches this far past the opening on both sides. */
  gapMargin: 0.2,
  /** The clear corridor reaches this far past the opening on both sides… */
  corridorMargin: 1.2,
  /** …and this far out from the grid edge (past every scatter reach). */
  corridorReach: 40,
  /** Length of the painted trail off the grid; it stays on the flat meadow ring. */
  trailLength: 13,
} as const;

/** Where a warp leaves the grid: a run of edge tiles on one side. */
export interface WarpOpening {
  readonly side: PlateauSide;
  /** First and one-past-last tile along the side (tz on the west and east sides, tx on north and south). */
  readonly start: number;
  readonly end: number;
  /** Ground painted on the trail that leads off the grid. */
  readonly surface: 'dirt' | 'cobble';
}

export function sideOfExit(exit: Direction): PlateauSide {
  switch (exit) {
    case Direction.North:
      return 'north';
    case Direction.South:
      return 'south';
    case Direction.West:
      return 'west';
    default:
      return 'east';
  }
}

function alongZ(side: PlateauSide): boolean {
  return side === 'west' || side === 'east';
}

/**
 * One opening per warp. A warp on a road or trail opens as wide as that road where it meets the
 * edge (the run of edge tiles with the warp tile's surface); a warp on grass opens one tile wide
 * and gets a dirt trail.
 */
export function warpOpenings(def: MapDefinition): WarpOpening[] {
  return def.warps.map((warp) => {
    const side = sideOfExit(warp.exit);
    const vertical = alongZ(side);
    const surfaceAlong = (t: number): string => (vertical ? def.surfaceAt(warp.from.tx, t) : def.surfaceAt(t, warp.from.tz));
    const limit = vertical ? def.grid.depth : def.grid.width;
    const at = vertical ? warp.from.tz : warp.from.tx;
    const surface = def.surfaceAt(warp.from.tx, warp.from.tz);
    let start = at;
    let end = at + 1;
    if (surface !== 'grass') {
      while (start > 0 && surfaceAlong(start - 1) === surface) start--;
      while (end < limit && surfaceAlong(end) === surface) end++;
    }
    return { side, start, end, surface: surface === 'cobble' ? 'cobble' : 'dirt' };
  });
}

/** World span of an opening along its side's axis. */
export function openingSpan(def: MapDefinition, opening: WarpOpening): { readonly min: number; readonly max: number } {
  const edge = alongZ(opening.side) ? tileMinZ : tileMinX;
  return { min: edge(def.grid, opening.start), max: edge(def.grid, opening.end) };
}

/** The fence or wall gap at an opening. */
export function openingGap(def: MapDefinition, opening: WarpOpening): BoundaryGap {
  const span = openingSpan(def, opening);
  const margin = OPENING.gapMargin * def.grid.tileSize;
  return { side: opening.side, min: span.min - margin, max: span.max + margin };
}

/** A rectangle outside `bounds` on `side`, spanning [min, max] along the side and `reach` outward. */
function outsideRect(bounds: WorldRect, side: PlateauSide, min: number, max: number, reach: number): WorldRect {
  switch (side) {
    case 'west':
      return { minX: bounds.minX - reach, maxX: bounds.minX, minZ: min, maxZ: max };
    case 'east':
      return { minX: bounds.maxX, maxX: bounds.maxX + reach, minZ: min, maxZ: max };
    case 'north':
      return { minX: min, maxX: max, minZ: bounds.minZ - reach, maxZ: bounds.minZ };
    default:
      return { minX: min, maxX: max, minZ: bounds.maxZ, maxZ: bounds.maxZ + reach };
  }
}

/** The clear corridor at an opening: no tree, bush or flower footprint touches it. */
export function openingCorridor(def: MapDefinition, opening: WarpOpening): WorldRect {
  const span = openingSpan(def, opening);
  const unit = def.grid.tileSize;
  const margin = OPENING.corridorMargin * unit;
  return outsideRect(worldRect(def.grid), opening.side, span.min - margin, span.max + margin, OPENING.corridorReach * unit);
}

// ---------------------------------------------------------------------------
// Style profiles
// ---------------------------------------------------------------------------

/** Hedge greens for the town's trimmed shrubs. */
export const HEDGE_TINTS = [0x5c9e5a, 0x66a860, 0x579455, 0x6bae62] as const;

/**
 * Mossy Woods: dense woodland right up to the back edges (−X / −Z) with undergrowth, the farm's
 * sparse front planting (shrunk so it never hides a tile), few flowers, on a darker meadow.
 */
export const FOREST_DENSITIES: SceneryDensities = {
  tree: (d, front) => {
    if (front) return FARM_DENSITIES.tree(d, front);
    if (d < 0.6) return 0;
    if (d <= 10) return 0.92;
    if (d <= 22) return 0.6;
    return d <= 36 ? 0.35 : 0;
  },
  bush: (d, front) => {
    if (d > 22) return 0;
    if (front) return d >= 1.5 ? 0.06 : 0;
    return d >= 0.6 && d <= 4 ? 0.4 : d > 4 ? 0.15 : 0;
  },
  flower: (d, front) => {
    if (d > 15) return 0;
    if (front) return d >= 0.7 ? 0.07 : 0;
    return d >= 0.55 ? 0.06 : 0;
  },
  pineShare: { back: 0.6, front: 0.4 },
  bushTints: BUSH_TINTS,
};

/** Brookhollow: a few trees behind the wall and fewer in front, clipped hedges, a sprinkle of flowers. */
export const TOWN_DENSITIES: SceneryDensities = {
  tree: (d, front) => {
    if (front) {
      if (d < 5) return 0;
      if (d < 14) return 0.07;
      return d < 26 ? 0.04 : 0;
    }
    if (d < 2.5) return 0;
    if (d <= 10) return 0.22;
    if (d <= 22) return 0.14;
    return d <= 34 ? 0.1 : 0;
  },
  bush: (d, front) => {
    if (d > 22) return 0;
    if (front) return d >= 1.5 ? 0.04 : 0;
    // A hedge row just behind the wall (its outer face is 0.67 out; bushes reach ≤ 0.7 from their centre).
    return d >= 1.4 && d <= 2.4 ? 0.45 : d > 2.4 ? 0.05 : 0;
  },
  flower: (d, front) => {
    if (d > 15) return 0;
    if (front) return d >= 0.7 ? 0.06 : 0;
    return d >= 1.2 ? 0.08 : 0;
  },
  pineShare: { back: 0.35, front: 0.25 },
  bushTints: HEDGE_TINTS,
};

/** Darker, mossier meadow for the forest. */
export const FOREST_MEADOW_TONES: MeadowTones = { near: 0x7fb86e, far: 0x94bf8e, hill: 0xa3c78f, sun: 0x8fc477 };

interface StyleProfile {
  readonly tones: MeadowTones;
  readonly density: SceneryDensities;
  /** Wooden fence all round (farm). */
  readonly fence: boolean;
  /** Low stone wall on the back sides (town). */
  readonly wall: boolean;
}

export const STYLE_PROFILES: Readonly<Record<SceneryStyle, StyleProfile>> = {
  farm: { tones: FARM_MEADOW_TONES, density: FARM_DENSITIES, fence: true, wall: false },
  forest: { tones: FOREST_MEADOW_TONES, density: FOREST_DENSITIES, fence: false, wall: false },
  town: { tones: FARM_MEADOW_TONES, density: TOWN_DENSITIES, fence: false, wall: true },
};

/** Everything StructureRenderer builds around one map's grid. */
export interface SceneryPlan {
  readonly meadow: MeadowSpec;
  readonly scatter: ScatterSpec;
  readonly openings: readonly WarpOpening[];
  /** One boundary gap per opening, for the fence or wall. */
  readonly gaps: readonly BoundaryGap[];
  readonly fence: boolean;
  readonly wall: boolean;
}

export function planScenery(def: MapDefinition): SceneryPlan {
  const profile = STYLE_PROFILES[def.scenery];
  const meadow: MeadowSpec = {
    bounds: worldRect(def.grid),
    margin: MEADOW.margin,
    cellSize: MEADOW.cellSize,
    topY: HEIGHTS.grassTop - MEADOW.drop,
    holeInset: MEADOW.holeInset,
    offset: def.cosmeticOffset,
    tones: profile.tones,
  };
  const openings = warpOpenings(def);
  return {
    meadow,
    scatter: {
      meadow,
      unit: def.grid.tileSize,
      density: profile.density,
      corridors: openings.map((opening) => openingCorridor(def, opening)),
    },
    openings,
    gaps: openings.map((opening) => openingGap(def, opening)),
    fence: profile.fence,
    wall: profile.wall,
  };
}

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

/** Per-feature salts, combined with Salt.Cosmetic (structureGeometry uses 11–61). */
const FEATURE = { trail: 71, wall: 81 } as const;

function cosmetic(offset: CosmeticOffset, feature: number, a: number, b: number, k: number): number {
  return hashFloat(Salt.Cosmetic, feature, a + offset.x, b + offset.z, k);
}

const TRAIL = {
  /** Length of one strip quad (tiles). */
  segment: 0.8,
  /** Height above the meadow, so the strip never z-fights with it. */
  lift: 0.018,
  /** The strip is this much narrower than the opening on each side (tiles). */
  inset: 0.08,
  edgeJitter: 0.12,
  /** The last stretch (tiles) narrows to `taperTo` of the full width. */
  taper: 4,
  taperTo: 0.35,
} as const;

const trailA = new THREE.Vector3();
const trailB = new THREE.Vector3();
const trailC = new THREE.Vector3();

/**
 * Painted strip leading off the grid at an opening: it starts under the plateau rim and runs
 * OPENING.trailLength tiles out across the flat meadow ring, a little narrower than the opening,
 * with ragged edges and a tapering end — packed dirt, or cobbles where a road leaves. It has the
 * meadow's attributes (position, normal, colour), so it merges into the meadow mesh.
 */
export function createTrailGeometry(def: MapDefinition, opening: WarpOpening, groundY: number): THREE.BufferGeometry {
  const unit = def.grid.tileSize;
  const bounds = worldRect(def.grid);
  const span = openingSpan(def, opening);
  const vertical = alongZ(opening.side);
  const outward = opening.side === 'west' || opening.side === 'north' ? -1 : 1;
  const edge = { west: bounds.minX, east: bounds.maxX, north: bounds.minZ, south: bounds.maxZ }[opening.side];
  const centre = (span.min + span.max) / 2;
  const halfWidth = (span.max - span.min) / 2 - TRAIL.inset * unit;
  const length = OPENING.trailLength * unit + MEADOW.holeInset;
  const rings = Math.max(2, Math.ceil(length / (TRAIL.segment * unit)) + 1);
  const y = groundY + TRAIL.lift;
  const offset = def.cosmeticOffset;
  const key = opening.start * 4 + ['north', 'south', 'west', 'east'].indexOf(opening.side);

  /** World point `u` out from the rim (negative: under the plateau) and `v` along the side from the centre. */
  const point = (target: THREE.Vector3, u: number, v: number): THREE.Vector3 => {
    const across = edge + outward * u;
    const along = centre + v;
    return vertical ? target.set(across, y, along) : target.set(along, y, across);
  };
  const ringU: number[] = [];
  const ringLeft: number[] = [];
  const ringRight: number[] = [];
  for (let r = 0; r < rings; r++) {
    const u = -MEADOW.holeInset + (length * r) / (rings - 1);
    const toEnd = length - MEADOW.holeInset - u;
    const taper = toEnd >= TRAIL.taper * unit ? 1 : TRAIL.taperTo + (1 - TRAIL.taperTo) * (toEnd / (TRAIL.taper * unit));
    const jitter = u <= 0 ? 0 : TRAIL.edgeJitter * unit;
    ringU.push(u);
    ringLeft.push(-halfWidth * taper + (cosmetic(offset, FEATURE.trail, key, r, 0) - 0.5) * jitter);
    ringRight.push(halfWidth * taper + (cosmetic(offset, FEATURE.trail, key, r, 1) - 0.5) * jitter);
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const warm = new THREE.Color(PALETTE.cobbleWarm);
  const cool = new THREE.Color(PALETTE.cobbleCool);
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    // Counter-clockwise seen from +Y, so the face is not culled from above.
    const upward = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
    for (const p of upward ? [a, b, c] : [a, c, b]) {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let r = 0; r < rings - 1; r++) {
    const tone = cosmetic(offset, FEATURE.trail, key, r, 2);
    if (opening.surface === 'cobble') color.set(PALETTE.cobble).lerp(tone < 0.5 ? warm : cool, 0.25 + 0.3 * Math.abs(tone - 0.5));
    else color.set(PALETTE.dirt).multiplyScalar(0.93 + 0.09 * tone);
    const u0 = ringU[r] ?? 0;
    const u1 = ringU[r + 1] ?? u0;
    point(trailA, u0, ringLeft[r] ?? 0);
    point(trailB, u0, ringRight[r] ?? 0);
    point(trailC, u1, ringRight[r + 1] ?? 0);
    pushTriangle(trailA, trailB, trailC);
    point(trailB, u1, ringLeft[r + 1] ?? 0);
    pushTriangle(trailA, trailC, trailB);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

// ---------------------------------------------------------------------------
// Town wall
// ---------------------------------------------------------------------------

/** Low dry-stone wall on the town's back sides (tiles, world units at tileSize 1). */
export const WALL_SHAPE = {
  /** Distance of the wall's centre line outside the plateau edge. */
  offset: 0.5,
  height: 0.6,
  thickness: 0.34,
  /** Approximate length of one stone course block. */
  block: 1.25,
  capHeight: 0.08,
  pillar: 0.5,
  pillarHeight: 0.95,
} as const;

const WALL_STONES = [0xcfc6ba, 0xc3bbb0, 0xd9d0c4, 0xbab3aa] as const;

/** One painted box of the wall, centred at (x, z), standing on y. */
export interface WallBlock {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Extent along X and Z. */
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: number;
}

/**
 * The town wall: stone blocks with a cap course along the north (−Z) and west (−X) sides, broken
 * at every gap, with a pillar at each run end. Every block passes {@link wouldBoxOccludeFarm}
 * against the grid (on the back sides nothing can hide a tile, so none is ever dropped).
 */
export function layoutWall(bounds: WorldRect, groundY: number, gaps: readonly BoundaryGap[], offset: CosmeticOffset): WallBlock[] {
  const W = WALL_SHAPE;
  const x0 = bounds.minX - W.offset;
  const x1 = bounds.maxX + W.offset;
  const z0 = bounds.minZ - W.offset;
  const z1 = bounds.maxZ + W.offset;
  const blocks: WallBlock[] = [];
  const add = (block: WallBlock): void => {
    if (!wouldBoxOccludeFarm(bounds, block.x, block.z, block.width / 2, block.depth / 2, block.y + block.height)) blocks.push(block);
  };
  const stone = (a: number, b: number, k: number): number => {
    const index = Math.floor(cosmetic(offset, FEATURE.wall, a, b, k) * WALL_STONES.length);
    return WALL_STONES[Math.min(WALL_STONES.length - 1, index)] ?? WALL_STONES[0];
  };

  const pillars = new Set<string>();
  const sides = [
    { side: 'north', start: x0, end: x1, fixed: z0 },
    { side: 'west', start: z0, end: z1, fixed: x0 },
  ] as const;
  for (const side of sides) {
    if (!isBackSide(side.side)) continue;
    const vertical = side.side === 'west';
    const place = (along: number, length: number, thickness: number, y: number, height: number, color: number): WallBlock => ({
      x: vertical ? side.fixed : along,
      y,
      z: vertical ? along : side.fixed,
      width: vertical ? thickness : length,
      depth: vertical ? length : thickness,
      height,
      color,
    });
    for (const [r0, r1] of boundaryRuns(side.start, side.end, gaps.filter((gap) => gap.side === side.side))) {
      const count = Math.max(1, Math.round((r1 - r0) / W.block));
      const step = (r1 - r0) / count;
      for (let i = 0; i < count; i++) {
        const mid = r0 + step * (i + 0.5);
        const key = Math.round(mid * 4);
        const rise = (cosmetic(offset, FEATURE.wall, key, vertical ? 1 : 0, 0) - 0.5) * 0.06;
        add(place(mid, step - 0.03, W.thickness, groundY, W.height + rise, stone(key, vertical ? 1 : 0, 1)));
        add(place(mid, step + 0.01, W.thickness + 0.06, groundY + W.height + rise, W.capHeight, stone(key, vertical ? 1 : 0, 2)));
      }
      const capHalf = (W.pillar + 0.08) / 2;
      // Corner pillars sit on the corner; gap pillars step back into the run, so the opening stays clear.
      const ends = [r0 === side.start ? r0 : r0 + capHalf, r1 === side.end ? r1 : r1 - capHalf];
      for (const end of ends) {
        // The north and west runs meet at the back corner: one pillar there, not two z-fighting ones.
        const at = vertical ? `${side.fixed},${end}` : `${end},${side.fixed}`;
        if (pillars.has(at)) continue;
        pillars.add(at);
        const key = Math.round(end * 4);
        add(place(end, W.pillar, W.pillar, groundY, W.pillarHeight, stone(key, 7, 1)));
        add(place(end, capHalf * 2, capHalf * 2, groundY + W.pillarHeight, W.capHeight, stone(key, 7, 2)));
      }
    }
  }
  return blocks;
}

/** Painted wall blocks, for merging into a painted body mesh. */
export function wallParts(blocks: readonly WallBlock[], out: THREE.BufferGeometry[]): void {
  for (const b of blocks) out.push(box(b.width, b.height, b.depth, { x: b.x, y: b.y + b.height / 2, z: b.z }, b.color));
}
