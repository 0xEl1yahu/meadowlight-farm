/**
 * Low-poly geometry builders for TerrainRenderer.
 *
 * Every exported builder is a pure function: it returns a fresh, non-indexed BufferGeometry made
 * from hand-placed primitives plus deterministic jitter (fixed seeds, never Math.random), so the
 * farm looks identical on every boot and after every rebuild. The caller owns the result and must
 * dispose it.
 *
 * Conventions
 * - Authored in tile units around the tile centre: one tile spans x, z ∈ [-0.5, 0.5]. The renderer
 *   scales XZ by GridSpec.tileSize; heights are world units (see HEIGHTS).
 * - Props (tufts, flowers, rocks, stumps, pond stones) have their base at local y = 0 so they can be
 *   dropped onto a HEIGHTS.* surface, and so the sway shader (displacement ∝ height²) keeps roots
 *   planted.
 * - Faces are wound counter-clockwise seen from outside and carry per-face normals (non-indexed),
 *   matching the flat-shaded look.
 * - Vertex colours are linear-space multipliers. Instanced meshes multiply them by the per-instance
 *   colour, so most builders bake only light and shade (ambient-occlusion style gradients) and
 *   leave the hue to the instance. Stumps and flowers bake real palette colours instead.
 */
import * as THREE from 'three';
import { Salt, hashFloat, mulberry32 } from '../core/hash';
import { HEIGHTS } from './constants';
import { PALETTE } from './palette';

/** A point or an RGB triple. */
export type Vec3 = readonly [number, number, number];

/** A per-vertex value: either constant, or computed from the vertex position. */
type VertexValue = Vec3 | ((p: Vec3) => Vec3);

/**
 * Name of the ground slab's packed per-vertex data (vec2): x = how much of the earth side colour
 * replaces the instance colour (0 on top, 1 on the sides), y = a light multiplier (side AO).
 */
export const TERRAIN_ATTRIBUTE = 'terrain';

/**
 * Name of the flower geometry's per-vertex float: 1 where the instance colour tints the vertex
 * (petals), 0 where the baked vertex colour is kept as is (stems, leaves, blossom hearts).
 */
export const TINT_MASK_ATTRIBUTE = 'tintMask';

/** Number of distinct rock shapes produced by createRockGeometry. */
export const ROCK_VARIANT_COUNT = 3;

/** Horizontal inset of the ground slab's top face (the chamfer width). */
export const GROUND_BEVEL = 0.03;
/** How far the chamfer drops below the top face. */
export const GROUND_BEVEL_DROP = 0.02;

const TAU = Math.PI * 2;
const WHITE: Vec3 = [1, 1, 1];

// ---------------------------------------------------------------------------
// Small vector / colour helpers
// ---------------------------------------------------------------------------

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`terrainGeometry: index ${index} outside [0, ${list.length})`);
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Linear-space RGB of an sRGB hex colour (THREE.Color converts on construction). */
function rgb(hex: number): Vec3 {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

function scaleRgb(color: Vec3, k: number): Vec3 {
  return [color[0] * k, color[1] * k, color[2] * k];
}

function mixRgb(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function grey(k: number): Vec3 {
  return [k, k, k];
}

function centroid(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = Math.max(1, points.length);
  return [x / n, y / n, z / n];
}

/** Y component of the unit normal of triangle (a, b, c); 0 for degenerate triangles. */
function faceNormalY(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0 ? ny / length : 0;
}

// ---------------------------------------------------------------------------
// Triangle soup
// ---------------------------------------------------------------------------

interface BuildOptions {
  /** Name of the per-vertex colour/data attribute, or null to omit it. Default 'color'. */
  readonly colorAttribute?: string | null;
  /** Component count of that attribute: 3 for colours, 2 for packed data. Default 3. */
  readonly colorItemSize?: 2 | 3;
  /** Name of the per-vertex float attribute, or null to omit it. Default null. */
  readonly extraAttribute?: string | null;
}

/**
 * Accumulates non-indexed triangles with a per-vertex RGB (or packed data) value and a per-vertex
 * float, then emits a BufferGeometry with face normals.
 */
class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly extras: number[] = [];

  /** Adds one triangle exactly as given (a → b → c counter-clockwise seen from its front). */
  triangle(a: Vec3, b: Vec3, c: Vec3, color: VertexValue = WHITE, extra = 0): void {
    this.vertex(a, color, extra);
    this.vertex(b, color, extra);
    this.vertex(c, color, extra);
  }

  /**
   * Fan-triangulates a convex (possibly slightly non-planar) polygon given in either winding.
   * The polygon is oriented so its front face points away from `inside`, using Newell's normal,
   * which stays robust when the first three points happen to be nearly collinear.
   */
  polygon(points: readonly Vec3[], inside: Vec3, color: VertexValue = WHITE, extra = 0): void {
    if (points.length < 3) throw new RangeError(`TriangleSoup.polygon: needs ≥ 3 points, got ${points.length}`);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < points.length; i++) {
      const p = at(points, i);
      const q = at(points, (i + 1) % points.length);
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const center = centroid(points);
    const facing = (center[0] - inside[0]) * nx + (center[1] - inside[1]) * ny + (center[2] - inside[2]) * nz;
    const flip = facing < 0;
    const first = at(points, 0);
    for (let i = 1; i < points.length - 1; i++) {
      const b = at(points, i);
      const c = at(points, i + 1);
      if (flip) this.triangle(first, c, b, color, extra);
      else this.triangle(first, b, c, color, extra);
    }
  }

  build(options: BuildOptions = {}): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    const colorName = options.colorAttribute === undefined ? 'color' : options.colorAttribute;
    if (colorName !== null) {
      const itemSize = options.colorItemSize ?? 3;
      const data = itemSize === 3 ? this.colors : this.colors.filter((_value, index) => index % 3 !== 2);
      geometry.setAttribute(colorName, new THREE.Float32BufferAttribute(data, itemSize));
    }
    const extraName = options.extraAttribute ?? null;
    if (extraName !== null) {
      geometry.setAttribute(extraName, new THREE.Float32BufferAttribute(this.extras, 1));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private vertex(p: Vec3, color: VertexValue, extra: number): void {
    this.positions.push(p[0], p[1], p[2]);
    const c = typeof color === 'function' ? color(p) : color;
    this.colors.push(c[0], c[1], c[2]);
    this.extras.push(extra);
  }
}

// ---------------------------------------------------------------------------
// Ground slab
// ---------------------------------------------------------------------------

/** Light multiplier of the chamfer (a touch darker than the top so tiles read softly). */
const BEVEL_SHADE = 0.95;
/** Light multiplier at the top / bottom of the earth side walls (fake ambient occlusion). */
const SIDE_TOP_SHADE = 0.96;
const SIDE_BOTTOM_SHADE = 0.58;

/**
 * One ground tile: a 1 × thickness × 1 slab whose top face sits at local y = 0, with a small
 * chamfer around the top edge. Neighbouring slabs meet edge to edge without gaps; the chamfer only
 * leaves a faint V between them that catches the light differently. The bottom face is omitted
 * (never visible).
 *
 * Carries TERRAIN_ATTRIBUTE (vec2): x = earth-side mix (0 top and chamfer, 1 side walls),
 * y = light multiplier (side walls darken toward the bottom).
 */
export function createGroundSlabGeometry(
  thickness: number = HEIGHTS.tileThickness,
  bevel: number = GROUND_BEVEL,
  bevelDrop: number = GROUND_BEVEL_DROP,
): THREE.BufferGeometry {
  if (!(bevel >= 0 && bevel < 0.5)) throw new RangeError(`createGroundSlabGeometry: bevel ${bevel} outside [0, 0.5)`);
  if (!(bevelDrop >= 0 && thickness > bevelDrop)) {
    throw new RangeError(`createGroundSlabGeometry: need 0 ≤ bevelDrop (${bevelDrop}) < thickness (${thickness})`);
  }
  const outer = 0.5;
  const inner = outer - bevel;
  const edgeY = -bevelDrop;
  const bottomY = -thickness;
  const inside: Vec3 = [0, bottomY / 2, 0];
  const corners: readonly (readonly [number, number])[] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const innerRing = corners.map(([sx, sz]): Vec3 => [sx * inner, 0, sz * inner]);
  const edgeRing = corners.map(([sx, sz]): Vec3 => [sx * outer, edgeY, sz * outer]);
  const bottomRing = corners.map(([sx, sz]): Vec3 => [sx * outer, bottomY, sz * outer]);

  const topData: Vec3 = [0, 1, 0];
  const bevelData: Vec3 = [0, BEVEL_SHADE, 0];
  const sideData = (p: Vec3): Vec3 => {
    const depth = clamp01((edgeY - p[1]) / (edgeY - bottomY));
    return [1, SIDE_TOP_SHADE + (SIDE_BOTTOM_SHADE - SIDE_TOP_SHADE) * depth, 0];
  };

  const soup = new TriangleSoup();
  soup.polygon(innerRing, inside, topData);
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4;
    if (bevel > 0 || bevelDrop > 0) {
      soup.polygon([at(innerRing, k), at(innerRing, next), at(edgeRing, next), at(edgeRing, k)], inside, bevelData);
    }
    soup.polygon([at(edgeRing, k), at(edgeRing, next), at(bottomRing, next), at(bottomRing, k)], inside, sideData);
  }
  return soup.build({ colorAttribute: TERRAIN_ATTRIBUTE, colorItemSize: 2 });
}

// ---------------------------------------------------------------------------
// Soil furrows
// ---------------------------------------------------------------------------

/** X positions of the three ridges across the tile. */
const FURROW_RIDGE_X: readonly number[] = [-0.29, 0, 0.29];

interface FurrowStation {
  readonly z: number;
  readonly height: number;
  readonly halfTop: number;
  readonly halfBottom: number;
  /** 0 at the tapered ends (kept straight), 1 in the middle (free to wobble). */
  readonly wobble: number;
}

/** Cross-sections along a ridge; the ends taper down so each ridge reads as a mound of soil. */
const FURROW_STATIONS: readonly FurrowStation[] = [
  { z: -0.42, height: 0.022, halfTop: 0.025, halfBottom: 0.07, wobble: 0 },
  { z: -0.32, height: 0.064, halfTop: 0.034, halfBottom: 0.112, wobble: 1 },
  { z: 0, height: 0.074, halfTop: 0.04, halfBottom: 0.12, wobble: 1 },
  { z: 0.32, height: 0.064, halfTop: 0.034, halfBottom: 0.112, wobble: 1 },
  { z: 0.42, height: 0.022, halfTop: 0.025, halfBottom: 0.07, wobble: 0 },
];

/** Tallest ridge point, used to normalise the base-to-crest shading. */
export const FURROW_RIDGE_HEIGHT = 0.08;

/**
 * Three parallel soil ridges running along local Z, base at y = 0 (place on HEIGHTS.soilTop).
 * Each ridge is a trapezoidal mound with tapered ends and a slight hand-dug wobble; vertex colours
 * shade the troughs a little darker than the crests.
 */
export function createFurrowGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(0x7f4a7c15);
  const shade = (p: Vec3): Vec3 => grey(0.8 + 0.2 * clamp01(p[1] / FURROW_RIDGE_HEIGHT));
  const soup = new TriangleSoup();

  for (const ridgeX of FURROW_RIDGE_X) {
    const profiles: (readonly [Vec3, Vec3, Vec3, Vec3])[] = FURROW_STATIONS.map((station) => {
      const x = ridgeX + (rand() * 2 - 1) * 0.012 * station.wobble;
      const h = station.height + (rand() * 2 - 1) * 0.006 * station.wobble;
      return [
        [x - station.halfBottom, 0, station.z],
        [x - station.halfTop, h, station.z],
        [x + station.halfTop, h, station.z],
        [x + station.halfBottom, 0, station.z],
      ];
    });

    for (let s = 0; s < profiles.length - 1; s++) {
      const a = at(profiles, s);
      const b = at(profiles, s + 1);
      const inside: Vec3 = [ridgeX, -0.05, (a[0][2] + b[0][2]) / 2];
      soup.polygon([a[0], a[1], b[1], b[0]], inside, shade);
      soup.polygon([a[1], a[2], b[2], b[1]], inside, shade);
      soup.polygon([a[2], a[3], b[3], b[2]], inside, shade);
    }

    const head = at(profiles, 0);
    const tail = at(profiles, profiles.length - 1);
    soup.polygon([...head], [ridgeX, 0, head[0][2] + 0.1], shade);
    soup.polygon([...tail], [ridgeX, 0, tail[0][2] - 0.1], shade);
  }
  return soup.build();
}

// ---------------------------------------------------------------------------
// Grass tufts
// ---------------------------------------------------------------------------

interface ClumpSpec {
  readonly cx: number;
  readonly cz: number;
  readonly blades: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Radius over which blade roots are scattered. */
  readonly spread: number;
  /** Radius of each blade's triangular base. */
  readonly bladeWidth: number;
}

const TUFT_CLUMPS: readonly ClumpSpec[] = [
  { cx: 0, cz: 0, blades: 6, minHeight: 0.18, maxHeight: 0.3, spread: 0.05, bladeWidth: 0.034 },
  { cx: 0.17, cz: 0.1, blades: 4, minHeight: 0.1, maxHeight: 0.18, spread: 0.035, bladeWidth: 0.028 },
];

/** Height used to normalise the root-to-tip gradient of the blades. */
const TUFT_MAX_HEIGHT = 0.3;
const TUFT_ROOT_SHADE = 0.72;
const TUFT_TIP_SHADE = 1.1;

/**
 * A grass tuft: a main clump of six leaning blades plus a small side clump of four. Each blade is
 * a slender three-sided pyramid rooted at y = 0 that leans outward. Vertex colours run from a
 * shaded root to a bright tip; the hue comes from the instance colour.
 */
export function createGrassTuftGeometry(seed = 0x2f6b1d): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const shade = (p: Vec3): Vec3 =>
    grey(TUFT_ROOT_SHADE + (TUFT_TIP_SHADE - TUFT_ROOT_SHADE) * clamp01(p[1] / TUFT_MAX_HEIGHT));
  const soup = new TriangleSoup();

  for (const clump of TUFT_CLUMPS) {
    for (let i = 0; i < clump.blades; i++) {
      const angle = (i / clump.blades) * TAU + (rand() - 0.5) * 0.8;
      const radial = clump.spread * (0.35 + 0.65 * rand());
      const bx = clump.cx + Math.cos(angle) * radial;
      const bz = clump.cz + Math.sin(angle) * radial;
      const height = clump.minHeight + (clump.maxHeight - clump.minHeight) * rand();
      const lean = height * (0.18 + 0.3 * rand());
      const tip: Vec3 = [bx + Math.cos(angle) * lean, height, bz + Math.sin(angle) * lean];
      const spin = rand() * TAU;
      const base: Vec3[] = [];
      for (let k = 0; k < 3; k++) {
        const a = spin + (k * TAU) / 3;
        base.push([bx + Math.cos(a) * clump.bladeWidth, 0, bz + Math.sin(a) * clump.bladeWidth]);
      }
      const inside = centroid([...base, tip]);
      for (let k = 0; k < 3; k++) {
        soup.polygon([at(base, k), at(base, (k + 1) % 3), tip], inside, shade);
      }
    }
  }
  return soup.build();
}

// ---------------------------------------------------------------------------
// Flowers
// ---------------------------------------------------------------------------

interface BlossomSpec {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number;
  readonly spin: number;
}

const BLOSSOMS: readonly BlossomSpec[] = [
  { x: 0, z: 0, height: 0.17, radius: 0.058, spin: 0.2 },
  { x: 0.075, z: 0.045, height: 0.115, radius: 0.048, spin: 1.1 },
  { x: -0.05, z: 0.07, height: 0.09, radius: 0.042, spin: 2.3 },
];

interface LeafSpec {
  readonly angle: number;
  readonly length: number;
}

const FLOWER_LEAVES: readonly LeafSpec[] = [
  { angle: 0.6, length: 0.12 },
  { angle: 3.4, length: 0.1 },
];

const PETALS_PER_BLOSSOM = 5;
/** Warm heart of each blossom (not tinted by the instance colour). */
const FLOWER_HEART = 0xf7c85c;
const STEM_RADIUS = 0.012;

/**
 * A little cluster of three five-petal blossoms on slim stems with two leaves at the base, rooted
 * at y = 0. Baked colours: green stems and leaves, warm yellow hearts, white petals. The
 * TINT_MASK_ATTRIBUTE marks the petals (1) so the flower material can tint only them with the
 * instance colour.
 */
export function createFlowerGeometry(): THREE.BufferGeometry {
  const stem = rgb(PALETTE.grassTuft);
  const leaf = scaleRgb(stem, 0.92);
  const heart = rgb(FLOWER_HEART);
  const soup = new TriangleSoup();

  for (const blossom of BLOSSOMS) {
    const center: Vec3 = [blossom.x, blossom.height, blossom.z];

    // Stem: a slim three-sided spike from the ground to the blossom.
    const root: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = blossom.spin + (k * TAU) / 3;
      root.push([blossom.x * 0.6 + Math.cos(a) * STEM_RADIUS, 0, blossom.z * 0.6 + Math.sin(a) * STEM_RADIUS]);
    }
    const stemInside = centroid([...root, center]);
    for (let k = 0; k < 3; k++) {
      soup.polygon([at(root, k), at(root, (k + 1) % 3), center], stemInside, stem, 0);
    }

    // Petals: slightly cupped kites around the centre, facing up.
    const below: Vec3 = [blossom.x, blossom.height - 1, blossom.z];
    const r = blossom.radius;
    for (let p = 0; p < PETALS_PER_BLOSSOM; p++) {
      const phi = blossom.spin + (p * TAU) / PETALS_PER_BLOSSOM;
      const tip: Vec3 = [blossom.x + Math.cos(phi) * r, blossom.height + r * 0.3, blossom.z + Math.sin(phi) * r];
      const left: Vec3 = [
        blossom.x + Math.cos(phi - 0.55) * r * 0.55,
        blossom.height + r * 0.12,
        blossom.z + Math.sin(phi - 0.55) * r * 0.55,
      ];
      const right: Vec3 = [
        blossom.x + Math.cos(phi + 0.55) * r * 0.55,
        blossom.height + r * 0.12,
        blossom.z + Math.sin(phi + 0.55) * r * 0.55,
      ];
      soup.polygon([center, left, tip, right], below, WHITE, 1);
    }

    // Heart: a tiny raised pyramid.
    const apex: Vec3 = [blossom.x, blossom.height + r * 0.5, blossom.z];
    const ring: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = blossom.spin + 0.5 + (k * TAU) / 3;
      ring.push([blossom.x + Math.cos(a) * r * 0.32, blossom.height + r * 0.14, blossom.z + Math.sin(a) * r * 0.32]);
    }
    const heartInside = centroid([...ring, center]);
    for (let k = 0; k < 3; k++) {
      soup.polygon([at(ring, k), at(ring, (k + 1) % 3), apex], heartInside, heart, 0);
    }
  }

  for (const spec of FLOWER_LEAVES) {
    const dx = Math.cos(spec.angle);
    const dz = Math.sin(spec.angle);
    const base: Vec3 = [dx * 0.01, 0.005, dz * 0.01];
    const tip: Vec3 = [dx * spec.length, 0.045, dz * spec.length];
    const mid = spec.length * 0.5;
    const sideA: Vec3 = [dx * mid - dz * 0.03, 0.035, dz * mid + dx * 0.03];
    const sideB: Vec3 = [dx * mid + dz * 0.03, 0.035, dz * mid - dx * 0.03];
    soup.polygon([base, sideA, tip, sideB], [dx * mid, -1, dz * mid], leaf, 0);
  }

  return soup.build({ extraAttribute: TINT_MASK_ATTRIBUTE });
}

// ---------------------------------------------------------------------------
// Stones (rocks and pond pebbles)
// ---------------------------------------------------------------------------

interface StonePiece {
  readonly radius: number;
  /** IcosahedronGeometry detail (0 or 1). */
  readonly detail: number;
  readonly offsetX: number;
  readonly offsetZ: number;
  /** Non-uniform squash applied after jitter. */
  readonly scale: Vec3;
  /** Radial jitter as a fraction of the radius. */
  readonly jitter: number;
}

const ROCK_VARIANTS: readonly (readonly StonePiece[])[] = [
  // 0: a broad, squat boulder.
  [{ radius: 0.33, detail: 0, offsetX: 0, offsetZ: 0, scale: [1.12, 0.66, 0.94], jitter: 0.16 }],
  // 1: a rounder, more faceted stone.
  [{ radius: 0.3, detail: 1, offsetX: 0, offsetZ: 0, scale: [1, 0.74, 1.08], jitter: 0.12 }],
  // 2: a boulder with two smaller companions.
  [
    { radius: 0.26, detail: 0, offsetX: -0.07, offsetZ: 0.02, scale: [1.05, 0.82, 0.95], jitter: 0.15 },
    { radius: 0.15, detail: 0, offsetX: 0.2, offsetZ: -0.1, scale: [1, 0.7, 1.05], jitter: 0.14 },
    { radius: 0.1, detail: 0, offsetX: 0.09, offsetZ: 0.21, scale: [1.1, 0.65, 1], jitter: 0.12 },
  ],
];

const POND_STONE: StonePiece = { radius: 0.12, detail: 0, offsetX: 0, offsetZ: 0, scale: [1.25, 0.6, 1], jitter: 0.16 };

/** Fraction of the squashed radius below the centre where the stone is cut flat. */
const STONE_FLOOR_FRACTION = 0.5;
const STONE_BASE_SHADE = 0.78;
/** Vertex tint of mossy top faces (multiplies the grey instance colour toward green). */
const MOSS_TINT: Vec3 = [0.8, 1.02, 0.74];

/**
 * Icosahedron triangles with deterministic jitter. Coincident vertices (shared by neighbouring
 * faces in the non-indexed source) are welded first so every copy moves identically and the
 * surface stays closed.
 */
function jitteredSphereTriangles(radius: number, detail: number, jitter: number, seed: number): Vec3[] {
  const source = new THREE.IcosahedronGeometry(radius, detail);
  const geometry = source.index === null ? source : source.toNonIndexed();
  const position = geometry.getAttribute('position');
  const welded: Vec3[] = [];
  const ids: number[] = [];
  const epsilonSq = (radius * 1e-4) ** 2;
  for (let i = 0; i < position.count; i++) {
    const p: Vec3 = [position.getX(i), position.getY(i), position.getZ(i)];
    let id = welded.findIndex((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 <= epsilonSq);
    if (id < 0) {
      id = welded.length;
      welded.push(p);
    }
    ids.push(id);
  }
  if (geometry !== source) geometry.dispose();
  source.dispose();

  const tangential = jitter * radius * 0.3;
  const displaced = welded.map((p, id): Vec3 => {
    const radial = 1 + (hashFloat(seed, id, 0, Salt.Cosmetic) * 2 - 1) * jitter;
    return [
      p[0] * radial + (hashFloat(seed, id, 1, Salt.Cosmetic) * 2 - 1) * tangential,
      p[1] * radial + (hashFloat(seed, id, 2, Salt.Cosmetic) * 2 - 1) * tangential,
      p[2] * radial + (hashFloat(seed, id, 3, Salt.Cosmetic) * 2 - 1) * tangential,
    ];
  });
  return ids.map((id) => at(displaced, id));
}

/**
 * Adds one jittered, squashed stone whose flattened base rests on y = 0. Faces get a small
 * deterministic brightness variation; upward faces may get a mossy tint.
 */
function addStonePiece(soup: TriangleSoup, piece: StonePiece, seed: number, mossChance: number): void {
  const triangles = jitteredSphereTriangles(piece.radius, piece.detail, piece.jitter, seed);
  const [sx, sy, sz] = piece.scale;
  const floor = -piece.radius * sy * STONE_FLOOR_FRACTION;
  const place = (v: Vec3): Vec3 => [v[0] * sx + piece.offsetX, Math.max(v[1] * sy, floor) - floor, v[2] * sz + piece.offsetZ];
  const placed = triangles.map(place);
  let height = 0;
  for (const p of placed) height = Math.max(height, p[1]);
  const safeHeight = height > 0 ? height : 1;

  for (let i = 0; i + 2 < placed.length; i += 3) {
    const a = at(placed, i);
    const b = at(placed, i + 1);
    const c = at(placed, i + 2);
    const face = i / 3;
    const faceShade = 0.93 + 0.12 * hashFloat(seed, face, 4, Salt.Cosmetic);
    const mossy = faceNormalY(a, b, c) > 0.78 && hashFloat(seed, face, 5, Salt.Cosmetic) < mossChance;
    const tint = mossy ? MOSS_TINT : WHITE;
    const color = (p: Vec3): Vec3 =>
      scaleRgb(tint, (STONE_BASE_SHADE + (1 - STONE_BASE_SHADE) * clamp01(p[1] / safeHeight)) * faceShade);
    soup.triangle(a, b, c, color);
  }
}

/**
 * Rock variant `variant` ∈ [0, ROCK_VARIANT_COUNT): jittered low-poly icosahedra, squashed and cut
 * flat so the base rests on y = 0 (place on HEIGHTS.grassTop). Vertex colours carry face shading,
 * a darker base and occasional moss; the stone hue comes from the instance colour.
 */
export function createRockGeometry(variant: number): THREE.BufferGeometry {
  if (!Number.isInteger(variant) || variant < 0 || variant >= ROCK_VARIANT_COUNT) {
    throw new RangeError(`createRockGeometry: variant ${variant} outside [0, ${ROCK_VARIANT_COUNT})`);
  }
  const soup = new TriangleSoup();
  const pieces = at(ROCK_VARIANTS, variant);
  pieces.forEach((piece, index) => addStonePiece(soup, piece, 0x51c0 + variant * 31 + index * 7, 0.3));
  return soup.build();
}

/**
 * A small rounded pebble for the pond rim: one jittered icosahedron, strongly squashed, base at
 * y = 0. Shading as for rocks.
 */
export function createPondStoneGeometry(): THREE.BufferGeometry {
  const soup = new TriangleSoup();
  addStonePiece(soup, POND_STONE, 0x9e3779, 0.45);
  return soup.build();
}

// ---------------------------------------------------------------------------
// Tree stump
// ---------------------------------------------------------------------------

const STUMP_SIDES = 7;
const STUMP_HEIGHT = 0.3;
const STUMP_BOTTOM_RADIUS = 0.3;
const STUMP_TOP_RADIUS = 0.245;
/** Slope of the axe-cut top along X (and 40 % of it along Z). */
const STUMP_SLANT = 0.1;
/** Radii of the top rings as fractions of the top radius: bark rim, sapwood, growth ring. */
const STUMP_RING_FRACTIONS = [0.82, 0.52, 0.28] as const;
const STUMP_ROOT_ANGLES: readonly number[] = [0.35, 2.45, 4.3];
const STUMP_ROOT_LENGTH = 0.17;
const STUMP_SPROUT_ANGLE = 1.35;

/**
 * A tree stump: a seven-sided tapered trunk with a slanted axe-cut top (bark rim, light wood,
 * one darker growth ring), three root nubs spreading onto the ground and a tiny leafy sprout.
 * Base at y = 0. Colours are baked (PALETTE.stumpBark / stumpTop), so the material uses
 * vertexColors with a white base; instance colours only vary brightness.
 */
export function createStumpGeometry(): THREE.BufferGeometry {
  const bark = rgb(PALETTE.stumpBark);
  const barkRim = scaleRgb(bark, 1.1);
  const wood = rgb(PALETTE.stumpTop);
  const growthRing = mixRgb(wood, bark, 0.32);
  const leaf = rgb(PALETTE.treeCanopy[0]);
  const rand = mulberry32(0x57a3f1);
  const topY = (x: number, z: number): number => STUMP_HEIGHT + STUMP_SLANT * x + STUMP_SLANT * 0.4 * z;
  const barkShade = (stripe: number) => (p: Vec3): Vec3 =>
    scaleRgb(bark, (0.74 + 0.26 * clamp01(p[1] / STUMP_HEIGHT)) * stripe);

  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  const rings: Vec3[][] = STUMP_RING_FRACTIONS.map(() => []);
  for (let k = 0; k < STUMP_SIDES; k++) {
    const angle = (k / STUMP_SIDES) * TAU + 0.25;
    const wobble = 1 + (rand() - 0.5) * 0.12;
    const cos = Math.cos(angle) * wobble;
    const sin = Math.sin(angle) * wobble;
    bottom.push([cos * STUMP_BOTTOM_RADIUS, 0, sin * STUMP_BOTTOM_RADIUS]);
    const tx = cos * STUMP_TOP_RADIUS;
    const tz = sin * STUMP_TOP_RADIUS;
    top.push([tx, topY(tx, tz), tz]);
    STUMP_RING_FRACTIONS.forEach((fraction, index) => {
      const rx = tx * fraction;
      const rz = tz * fraction;
      at(rings, index).push([rx, topY(rx, rz), rz]);
    });
  }

  const soup = new TriangleSoup();
  const trunkInside: Vec3 = [0, STUMP_HEIGHT / 2, 0];
  const below: Vec3 = [0, -1, 0];
  const ringColors: readonly Vec3[] = [barkRim, wood, growthRing];
  for (let k = 0; k < STUMP_SIDES; k++) {
    const next = (k + 1) % STUMP_SIDES;
    soup.polygon([at(bottom, k), at(bottom, next), at(top, next), at(top, k)], trunkInside, barkShade(k % 2 === 0 ? 1 : 0.88));
    let outerRing = top;
    rings.forEach((ring, index) => {
      soup.polygon([at(outerRing, k), at(outerRing, next), at(ring, next), at(ring, k)], below, at(ringColors, index));
      outerRing = ring;
    });
  }
  soup.polygon(at(rings, rings.length - 1), below, wood);

  // Root nubs: square-based wedges emerging from the trunk and tapering onto the ground.
  for (const angle of STUMP_ROOT_ANGLES) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const tx = -dz;
    const tz = dx;
    const baseR = STUMP_BOTTOM_RADIUS * 0.85;
    const cx = dx * baseR;
    const cz = dz * baseR;
    const halfWidth = 0.055;
    const base: Vec3[] = [
      [cx + tx * halfWidth, 0.115, cz + tz * halfWidth],
      [cx - tx * halfWidth, 0.115, cz - tz * halfWidth],
      [cx - tx * halfWidth, 0.01, cz - tz * halfWidth],
      [cx + tx * halfWidth, 0.01, cz + tz * halfWidth],
    ];
    const tip: Vec3 = [dx * (STUMP_BOTTOM_RADIUS + STUMP_ROOT_LENGTH), -0.005, dz * (STUMP_BOTTOM_RADIUS + STUMP_ROOT_LENGTH)];
    const inside = centroid([...base, tip]);
    for (let k = 0; k < 4; k++) {
      soup.polygon([at(base, k), at(base, (k + 1) % 4), tip], inside, barkShade(0.95));
    }
  }

  // Sprout: a slim twig from the upper bark with two leaves.
  const sdx = Math.cos(STUMP_SPROUT_ANGLE);
  const sdz = Math.sin(STUMP_SPROUT_ANGLE);
  const sproutR = (STUMP_BOTTOM_RADIUS + STUMP_TOP_RADIUS) / 2 - 0.01;
  const sproutBase: Vec3 = [sdx * sproutR, STUMP_HEIGHT * 0.62, sdz * sproutR];
  const sproutTip: Vec3 = [sdx * (sproutR + 0.07), STUMP_HEIGHT * 0.62 + 0.1, sdz * (sproutR + 0.07)];
  const twig: Vec3[] = [];
  for (let k = 0; k < 3; k++) {
    const a = STUMP_SPROUT_ANGLE + (k * TAU) / 3;
    twig.push([sproutBase[0] + Math.cos(a) * 0.014, sproutBase[1], sproutBase[2] + Math.sin(a) * 0.014]);
  }
  const twigInside = centroid([...twig, sproutTip]);
  for (let k = 0; k < 3; k++) {
    soup.polygon([at(twig, k), at(twig, (k + 1) % 3), sproutTip], twigInside, bark);
  }
  for (const side of [-1, 1]) {
    const px = -sdz * side;
    const pz = sdx * side;
    const leafTip: Vec3 = [sproutTip[0] + px * 0.09 + sdx * 0.02, sproutTip[1] + 0.025, sproutTip[2] + pz * 0.09 + sdz * 0.02];
    const midX = (sproutTip[0] + leafTip[0]) / 2;
    const midZ = (sproutTip[2] + leafTip[2]) / 2;
    const edgeA: Vec3 = [midX + sdx * 0.025, sproutTip[1] + 0.03, midZ + sdz * 0.025];
    const edgeB: Vec3 = [midX - sdx * 0.025, sproutTip[1] + 0.005, midZ - sdz * 0.025];
    soup.polygon([sproutTip, edgeA, leafTip, edgeB], [midX, sproutTip[1] - 1, midZ], leaf);
  }

  return soup.build();
}

// ---------------------------------------------------------------------------
// Water surface
// ---------------------------------------------------------------------------

/**
 * A flat, upward-facing 1 × 1 quad at y = 0 subdivided into `segments` × `segments` cells with
 * alternating diagonals, so a vertex-shader wave produces lively faceted ripples. Corner vertices
 * of neighbouring tiles coincide, so a wave evaluated in world space keeps the surface seamless.
 */
export function createWaterSurfaceGeometry(segments = 2): THREE.BufferGeometry {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError(`createWaterSurfaceGeometry: segments must be a positive integer, got ${segments}`);
  }
  const soup = new TriangleSoup();
  const step = 1 / segments;
  const below: Vec3 = [0, -1, 0];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const x0 = -0.5 + i * step;
      const x1 = x0 + step;
      const z0 = -0.5 + j * step;
      const z1 = z0 + step;
      const a: Vec3 = [x0, 0, z0];
      const b: Vec3 = [x1, 0, z0];
      const c: Vec3 = [x1, 0, z1];
      const d: Vec3 = [x0, 0, z1];
      if ((i + j) % 2 === 0) {
        soup.polygon([a, b, c], below);
        soup.polygon([a, c, d], below);
      } else {
        soup.polygon([a, b, d], below);
        soup.polygon([b, c, d], below);
      }
    }
  }
  return soup.build({ colorAttribute: null });
}
