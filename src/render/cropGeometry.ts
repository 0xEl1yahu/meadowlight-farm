/**
 * Low-poly geometry builders for CropRenderer.
 *
 * Every exported builder is a pure function: it assembles hand-placed primitives (leaf blades,
 * 5–7 sided stems, icosahedron blobs, lathes) into one fresh BufferGeometry, with no randomness,
 * scene or material access. The caller owns the result and must dispose it.
 *
 * Conventions
 * - Units are world units for a nominal mature plant of the part's form. The renderer scales
 *   every instance uniformly by `visual.height / top-of-mature-foliage`, so foliage reaches the
 *   crop's authored height while attached produce (head, berries, cob) stays exactly where it
 *   was authored on that foliage. Growth then multiplies the scale further.
 * - The stem axis is local +Y and the base sits at y = 0: createSwayMaterial displaces vertices
 *   by height², so roots stay planted. Ground produce (bulb, gourd) may dip a few centimetres
 *   below 0 so it reads as half-buried in the soil.
 * - Output is non-indexed with exactly `position`, `normal` (per-face) and `color`, so parts
 *   merge cleanly and render with `vertexColors: true`. Faces wind counter-clockwise seen from
 *   outside.
 * - Vertex colours are linear-space multipliers of the per-instance colour. White takes the full
 *   instance colour (the foliage or produce colour); accents such as a corn husk or a gourd stem
 *   are darker multipliers of it. A soft vertical shade bakes contact darkening toward the base.
 *   Mushrooms invert this: the instance colour is the pale stem and the cap bakes a darker,
 *   speckled multiplier, so the stem always reads lighter than the cap.
 * - Leaf headings follow Object3D.rotateY: heading 0 points along +X, heading θ points along
 *   (cos θ, 0, −sin θ).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Accent multipliers (sRGB hex; multiplied by the instance colour)
// ---------------------------------------------------------------------------

const WHITE = 0xffffff;
/** Corn husk: over the cob's warm yellow instance colour it reads as pale yellow-green. */
const HUSK_TINT = 0xa6e493;
/** Corn silk: over yellow it reads as a rusty orange-brown. */
const SILK_TINT = 0xd98a5c;
/** Corn tassel: lifts the stalk's green toward straw. */
const TASSEL_TINT = 0xfff0bd;
/** Gourd stem: turns orange into brown and green into a deep green. */
const GOURD_STEM_TINT = 0x7d6b4c;
/** Stalk under a cauliflower curd: over the cream instance colour it reads as pale green. */
const HEAD_STALK_TINT = 0xb9dfa4;
/** Soil clods beside a seed mound, a shade darker than the mound itself. */
const CLOD_TINT = 0xcfc5b8;
/** Wheat straw: lifts the grain's green toward a ripening yellow-green. */
const STRAW_TINT = 0xfff2c4;
/** Every other wheat grain, a touch deeper so the ear reads as separate kernels. */
const GRAIN_SHADE_TINT = 0xf0dfbc;
/** Wheat awns: paler than the grains so the bristles catch the light. */
const AWN_TINT = 0xfff8e6;
/** Mushroom stem: close to the full (pale) instance colour. */
const FUNGUS_STEM_TINT = 0xfff6ec;
/** Mushroom cap: a darker, warmer multiplier of the instance colour. */
const FUNGUS_CAP_TINT = 0xae8670;
/** Pale speckles on the mushroom cap. */
const FUNGUS_SPOT_TINT = 0xf2e4d4;

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * A low-poly leaf blade: a thin bent octahedron (8 faces) with a raised midrib, so flat shading
 * shows a crease down the middle. The inner part of the blade rises at `pitch`; past the widest
 * point it bends a further `droop` radians down (negative droop curls it up).
 */
export interface LeafSpec {
  readonly length: number;
  /** Full width at the widest point. */
  readonly width: number;
  /** Elevation of the inner part of the blade above horizontal (radians). */
  readonly pitch: number;
  /** Extra downward bend of the outer part (radians). Default 0. */
  readonly droop?: number;
  /** Heading around +Y (radians); 0 points along +X. */
  readonly yaw: number;
  /** Height of the midrib ridge above the blade plane. Default width × 0.2. */
  readonly thickness?: number;
  /** Fraction of the length at which the blade is widest. Default 0.45. */
  readonly widest?: number;
  /** Attachment point of the leaf base. Default origin. */
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

/** Sphere-ish blob placement used by the bush builders and the berry cluster. */
export interface BlobSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Circumradius of the icosahedron. */
  readonly r: number;
}

// ---------------------------------------------------------------------------
// Assembly helpers
// ---------------------------------------------------------------------------

type Triangle = readonly [number, number, number];

interface VerticalShade {
  /** Colour multiplier at y = 0. */
  readonly floor: number;
  /** Height at which the multiplier reaches 1. */
  readonly height: number;
}

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** Point at fraction `t` along the segment a → b. */
function along(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  return new THREE.Vector3().lerpVectors(a, b, t);
}

/** Horizontal offset of length `r` along `heading` (see the heading convention above). */
function radial(heading: number, r: number): { readonly x: number; readonly z: number } {
  return { x: Math.cos(heading) * r, z: -Math.sin(heading) * r };
}

function vertexAt(vertices: readonly THREE.Vector3[], index: number): THREE.Vector3 {
  const vertex = vertices[index];
  if (vertex === undefined) throw new RangeError(`cropGeometry: vertex ${index} out of range`);
  return vertex;
}

/**
 * Normalises a primitive into a mergeable piece: non-indexed, `position` only, plus a uniform
 * `color` attribute holding `tint`. Disposes the source when a copy had to be made.
 */
function piece(source: THREE.BufferGeometry, tint: THREE.ColorRepresentation = WHITE): THREE.BufferGeometry {
  const geometry = source.index !== null ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name);
  }
  geometry.morphAttributes = {};
  geometry.clearGroups();
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color(tint);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Builds a piece from explicit triangles of a closed surface. The winding is made outward-facing
 * by checking the sign of the enclosed volume, so callers only need a consistent winding.
 */
function closedPiece(
  vertices: readonly THREE.Vector3[],
  faces: readonly Triangle[],
  tint: THREE.ColorRepresentation = WHITE,
): THREE.BufferGeometry {
  const cross = new THREE.Vector3();
  let sixVolume = 0;
  for (const [a, b, c] of faces) {
    cross.crossVectors(vertexAt(vertices, b), vertexAt(vertices, c));
    sixVolume += vertexAt(vertices, a).dot(cross);
  }
  const flip = sixVolume < 0;
  const positions = new Float32Array(faces.length * 9);
  let offset = 0;
  for (const [a, b, c] of faces) {
    for (const index of flip ? [a, c, b] : [a, b, c]) {
      const vertex = vertexAt(vertices, index);
      positions[offset++] = vertex.x;
      positions[offset++] = vertex.y;
      positions[offset++] = vertex.z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return piece(geometry, tint);
}

/** Multiplies vertex colours by a smooth ramp from `floor` at y = 0 to 1 at `height`. */
function applyVerticalShade(geometry: THREE.BufferGeometry, shade: VerticalShade): void {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.smoothstep(position.getY(i), 0, shade.height);
    const factor = shade.floor + (1 - shade.floor) * t;
    color.setXYZ(i, color.getX(i) * factor, color.getY(i) * factor, color.getZ(i) * factor);
  }
  color.needsUpdate = true;
}

/**
 * Merges pieces into one part geometry, bakes the vertical shade, computes per-face normals and
 * bounds, and disposes the pieces.
 */
function assemble(pieces: THREE.BufferGeometry[], shade: VerticalShade | null): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false) as THREE.BufferGeometry | null;
  for (const part of pieces) part.dispose();
  if (merged === null) throw new Error('cropGeometry: pieces have mismatched attributes and cannot merge');
  if (shade !== null) applyVerticalShade(merged, shade);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** A tapered prism (5 sides by default) from `from` to `to`. */
function stem(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radiusBottom: number,
  radiusTop: number,
  sides = 5,
  tint: THREE.ColorRepresentation = WHITE,
): THREE.BufferGeometry {
  const axis = new THREE.Vector3().subVectors(to, from);
  const length = axis.length();
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, sides, 1);
  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, axis.normalize()));
  geometry.translate(from.x, from.y, from.z);
  return piece(geometry, tint);
}

interface BlobOptions {
  readonly detail?: number;
  /** Vertical scale factor. Default 1. */
  readonly squash?: number;
  /** Rotation about +Y so neighbouring blobs show different facets. Default 0. */
  readonly spin?: number;
  readonly tint?: THREE.ColorRepresentation;
}

function blob(spec: BlobSpec, options: BlobOptions = {}): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(spec.r, options.detail ?? 0);
  geometry.rotateY(options.spin ?? 0);
  geometry.scale(1, options.squash ?? 1, 1);
  geometry.translate(spec.x, spec.y, spec.z);
  return piece(geometry, options.tint ?? WHITE);
}

/** Faces of the bent-octahedron leaf: two fans (base and tip) around the ring L, U, R, D. */
const LEAF_FACES: readonly Triangle[] = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 4, 3],
  [0, 1, 4],
  [5, 1, 2],
  [5, 2, 3],
  [5, 3, 4],
  [5, 4, 1],
];

function leaf(spec: LeafSpec, tint: THREE.ColorRepresentation = WHITE): THREE.BufferGeometry {
  const widest = spec.widest ?? 0.45;
  const droop = spec.droop ?? 0;
  const thickness = spec.thickness ?? spec.width * 0.2;
  const inner = spec.length * widest;
  const outer = spec.length - inner;
  const innerAngle = spec.pitch;
  const outerAngle = spec.pitch - droop;
  const ridgeAngle = (innerAngle + outerAngle) / 2;

  // Spine in the leaf's vertical plane: d = distance along the heading, h = height.
  const d1 = Math.cos(innerAngle) * inner;
  const h1 = Math.sin(innerAngle) * inner;
  const d2 = d1 + Math.cos(outerAngle) * outer;
  const h2 = h1 + Math.sin(outerAngle) * outer;
  // Unit normal of the spine at the widest point, pointing to the leaf's upper side.
  const nd = -Math.sin(ridgeAngle);
  const nh = Math.cos(ridgeAngle);

  const headingX = Math.cos(spec.yaw);
  const headingZ = -Math.sin(spec.yaw);
  const sideX = Math.sin(spec.yaw);
  const sideZ = Math.cos(spec.yaw);
  const ox = spec.x ?? 0;
  const oy = spec.y ?? 0;
  const oz = spec.z ?? 0;
  const point = (d: number, h: number, side: number): THREE.Vector3 =>
    v(ox + headingX * d + sideX * side, oy + h, oz + headingZ * d + sideZ * side);

  const half = spec.width / 2;
  const vertices = [
    point(0, 0, 0),
    point(d1, h1, -half),
    point(d1 + nd * thickness, h1 + nh * thickness, 0),
    point(d1, h1, half),
    point(d1 - nd * thickness * 0.5, h1 - nh * thickness * 0.5, 0),
    point(d2, h2, 0),
  ];
  return closedPiece(vertices, LEAF_FACES, tint);
}

/** `count` blobs evenly spaced on a horizontal ring. */
function blobRing(count: number, radius: number, y: number, r: number, phase: number): BlobSpec[] {
  const ring: BlobSpec[] = [];
  for (let i = 0; i < count; i++) {
    const heading = phase + (i * TAU) / count;
    const offset = radial(heading, radius);
    ring.push({ x: offset.x, y, z: offset.z, r });
  }
  return ring;
}

// ---------------------------------------------------------------------------
// Shared layouts
// ---------------------------------------------------------------------------

/** Vertical squash applied to every bush blob (keeps the canopy soft and rounded). */
const BUSH_SQUASH = 0.9;

/** Mature bush canopy: a crown blob, a ring of five low blobs and three upper blobs. */
export const BUSH_MATURE_BLOBS: readonly BlobSpec[] = [
  { x: 0, y: 0.4, z: 0, r: 0.18 },
  ...blobRing(5, 0.14, 0.2, 0.15, 0.3),
  ...blobRing(3, 0.1, 0.43, 0.12, 0.9),
];

/** Young bush: a crown blob over a ring of three. */
const BUSH_GROWING_BLOBS: readonly BlobSpec[] = [
  { x: 0, y: 0.3, z: 0, r: 0.15 },
  ...blobRing(3, 0.1, 0.15, 0.125, 0.5),
];

/** Radius of one berry in the mature-bush cluster. */
export const BERRY_RADIUS = 0.055;

/** Height of the corn stalk prism in the mature stalk (tassel excluded). */
const STALK_HEIGHT = 1;

/** Unit vector tilted `lean` radians away from +Y toward `heading`. */
function leanDirection(heading: number, lean: number): THREE.Vector3 {
  const out = radial(heading, Math.sin(lean));
  return v(out.x, Math.cos(lean), out.z);
}

/** One straight, slightly leaning wheat straw of the mature grain clump. */
interface Culm {
  readonly base: THREE.Vector3;
  readonly tip: THREE.Vector3;
  /** Axis of the ear: the head nods a little further out than the straw. */
  readonly nod: THREE.Vector3;
}

/** Straws of the mature grain clump, fanning out from the root (tips 0.74–0.9 high). */
const GRAIN_CULMS: readonly Culm[] = Array.from({ length: 6 }, (_, i): Culm => {
  const heading = 0.4 + i * GOLDEN_ANGLE;
  const foot = radial(heading, 0.022 + 0.01 * (i % 3));
  const lean = 0.09 + 0.05 * (i % 3);
  const length = 0.9 - 0.035 * ((i * 2) % 5);
  const base = v(foot.x, 0, foot.z);
  return {
    base,
    tip: base.clone().addScaledVector(leanDirection(heading, lean), length),
    nod: leanDirection(heading, lean + 0.22),
  };
});

/** Wheat ear layout: grain rows up the rachis and the size of one grain. */
const EAR = {
  rows: 4,
  rowSpacing: 0.03,
  firstRow: 0.02,
  grainLength: 0.034,
  grainWidth: 0.017,
  grainDepth: 0.013,
  /** Outward tilt of each grain from the rachis (radians). */
  grainTilt: 0.38,
} as const;

// ---------------------------------------------------------------------------
// Builders: generic
// ---------------------------------------------------------------------------

/** One stand-alone leaf blade (see LeafSpec). */
export function createLeafBlade(spec: LeafSpec): THREE.BufferGeometry {
  return assemble([leaf(spec)], null);
}

// ---------------------------------------------------------------------------
// Builders: seed and seedling stages (shared by every crop)
// ---------------------------------------------------------------------------

/**
 * Stage-0 soil mound: a seven-sided lathe dome (0.34 wide, 0.07 high) with three clods of
 * earth around it. Tinted with the soil colour of the tile.
 */
export function createSoilMoundGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.17, 0),
    new THREE.Vector2(0.14, 0.032),
    new THREE.Vector2(0.085, 0.058),
    new THREE.Vector2(0.03, 0.07),
    new THREE.Vector2(0, 0.072),
  ];
  const pieces = [piece(new THREE.LatheGeometry(profile, 7))];
  const clodHeadings = [0.5, 2.6, 4.5];
  clodHeadings.forEach((heading, i) => {
    const offset = radial(heading, 0.18);
    pieces.push(blob({ x: offset.x, y: 0.012, z: offset.z, r: 0.026 + i * 0.005 }, { spin: heading, tint: CLOD_TINT }));
  });
  return assemble(pieces, { floor: 0.82, height: 0.07 });
}

/** Stage-0 seedling: a pair of cotyledons on a short stem, poking out of the soil mound. */
export function createSeedlingGeometry(): THREE.BufferGeometry {
  const crown = v(0.006, 0.11, 0);
  const cotyledon = { length: 0.08, width: 0.052, pitch: 0.45, droop: 0.35, x: crown.x, y: crown.y, z: crown.z };
  return assemble(
    [
      stem(v(0, 0, 0), crown, 0.013, 0.01),
      leaf({ ...cotyledon, yaw: 0.3 }),
      leaf({ ...cotyledon, yaw: 0.3 + Math.PI }),
    ],
    { floor: 0.8, height: 0.12 },
  );
}

/** Stage-1 sprout: low cotyledons, a pair of true leaves and a furled bud on a taller stem. */
export function createSproutGeometry(): THREE.BufferGeometry {
  const base = v(0, 0, 0);
  const crown = v(0.012, 0.2, -0.006);
  const low = along(base, crown, 0.35);
  const mid = along(base, crown, 0.8);
  const cotyledon = { length: 0.065, width: 0.045, pitch: 0.2, droop: 0.25, x: low.x, y: low.y, z: low.z };
  const trueLeaf = { length: 0.15, width: 0.08, pitch: 0.6, droop: 0.5, x: mid.x, y: mid.y, z: mid.z };
  const bud = { length: 0.075, width: 0.04, pitch: 1.15, droop: 0.2, x: crown.x, y: crown.y, z: crown.z };
  return assemble(
    [
      stem(base, crown, 0.016, 0.011),
      leaf({ ...cotyledon, yaw: 1.9 }),
      leaf({ ...cotyledon, yaw: 1.9 + Math.PI }),
      leaf({ ...trueLeaf, yaw: 0.35 }),
      leaf({ ...trueLeaf, yaw: 0.35 + Math.PI }),
      leaf({ ...bud, yaw: 1.9 }),
      leaf({ ...bud, yaw: 1.9 + Math.PI }),
    ],
    { floor: 0.78, height: 0.2 },
  );
}

// ---------------------------------------------------------------------------
// Builders: foliage by form
// ---------------------------------------------------------------------------

/** Young rosette: six blades, alternately upright and splayed, around a small core. */
export function createLeafyGrowingGeometry(): THREE.BufferGeometry {
  const pieces = [piece(new THREE.ConeGeometry(0.035, 0.09, 5).translate(0, 0.045, 0))];
  for (let i = 0; i < 6; i++) {
    const yaw = i * GOLDEN_ANGLE;
    const upright = i % 2 === 0;
    pieces.push(
      leaf({
        length: upright ? 0.46 : 0.34,
        width: upright ? 0.085 : 0.1,
        pitch: upright ? 1.3 : 0.95,
        droop: upright ? 0.3 : 0.5,
        yaw,
        ...radial(yaw, 0.03),
      }),
    );
  }
  return assemble(pieces, { floor: 0.72, height: 0.3 });
}

/**
 * Mature rosette: a low skirt of seven broad blades and an inner vase of five tall ones around
 * an open centre, where a cauliflower head or a parsnip crown shows through.
 */
export function createLeafyMatureGeometry(): THREE.BufferGeometry {
  const pieces = [piece(new THREE.ConeGeometry(0.05, 0.12, 6).translate(0, 0.06, 0))];
  for (let i = 0; i < 7; i++) {
    const yaw = 0.2 + (i * TAU) / 7;
    pieces.push(leaf({ length: 0.26, width: 0.11, pitch: 0.7, droop: 0.55, yaw, ...radial(yaw, 0.07) }));
  }
  for (let i = 0; i < 5; i++) {
    const yaw = 0.65 + (i * TAU) / 5;
    pieces.push(leaf({ length: 0.52, width: 0.1, pitch: 1.2, droop: 0.35, yaw, ...radial(yaw, 0.08) }));
  }
  return assemble(pieces, { floor: 0.7, height: 0.4 });
}

function bushGeometry(blobs: readonly BlobSpec[], stemTop: number, skirt: number, skirtRadius: number): THREE.BufferGeometry {
  const pieces = blobs.map((spec, i) => blob(spec, { squash: BUSH_SQUASH, spin: i * 1.3 }));
  pieces.push(stem(v(0, 0, 0), v(0, stemTop, 0), 0.03, 0.024));
  for (let i = 0; i < skirt; i++) {
    const yaw = 0.93 + (i * TAU) / skirt;
    pieces.push(
      leaf({ length: 0.15, width: 0.085, pitch: 0.35, droop: 0.45, yaw, y: 0.03, ...radial(yaw, skirtRadius) }),
    );
  }
  return assemble(pieces, { floor: 0.68, height: 0.45 });
}

/** Young bush: three low blobs under a crown blob, with a skirt of three leaves. */
export function createBushGrowingGeometry(): THREE.BufferGeometry {
  return bushGeometry(BUSH_GROWING_BLOBS, 0.16, 3, 0.12);
}

/** Mature bush: nine faceted blobs forming a dome (~0.56 tall, ~0.6 wide) over a leaf skirt. */
export function createBushMatureGeometry(): THREE.BufferGeometry {
  return bushGeometry(BUSH_MATURE_BLOBS, 0.2, 5, 0.17);
}

interface StalkSpec {
  readonly height: number;
  readonly leaves: number;
  readonly firstLeaf: number;
  readonly leafSpacing: number;
  readonly leafLength: number;
  readonly leafTaper: number;
  readonly pitch: number;
  readonly droop: number;
}

function stalkPieces(spec: StalkSpec): THREE.BufferGeometry[] {
  const pieces = [
    piece(new THREE.CylinderGeometry(0.028, 0.048, spec.height, 5, 2).translate(0, spec.height / 2, 0)),
  ];
  for (let i = 0; i < spec.leaves; i++) {
    // Alternate sides with a slow twist so the leaves spiral up the stalk.
    const yaw = (i % 2) * Math.PI + i * 0.42;
    pieces.push(
      leaf({
        length: spec.leafLength - i * spec.leafTaper,
        width: 0.075,
        pitch: spec.pitch - i * 0.03,
        droop: spec.droop,
        yaw,
        y: spec.firstLeaf + i * spec.leafSpacing,
        ...radial(yaw, 0.03),
      }),
    );
  }
  return pieces;
}

/** Young stalk: a 0.62 tall pentagonal prism, five arching leaves and a furled top. */
export function createStalkGrowingGeometry(): THREE.BufferGeometry {
  const height = 0.62;
  const pieces = stalkPieces({
    height,
    leaves: 5,
    firstLeaf: 0.08,
    leafSpacing: 0.11,
    leafLength: 0.4,
    leafTaper: 0.035,
    pitch: 0.95,
    droop: 0.8,
  });
  const furl = { length: 0.17, width: 0.05, pitch: 1.3, droop: 0.15, y: height - 0.02 };
  pieces.push(leaf({ ...furl, yaw: 0.4 }), leaf({ ...furl, yaw: 0.4 + Math.PI }));
  return assemble(pieces, { floor: 0.72, height: 0.35 });
}

/** Mature corn stalk: a 1.0 tall prism, seven long arching leaves and a straw tassel on top. */
export function createStalkMatureGeometry(): THREE.BufferGeometry {
  const pieces = stalkPieces({
    height: STALK_HEIGHT,
    leaves: 7,
    firstLeaf: 0.1,
    leafSpacing: 0.125,
    leafLength: 0.44,
    leafTaper: 0.03,
    pitch: 0.8,
    droop: 0.95,
  });
  pieces.push(piece(new THREE.ConeGeometry(0.014, 0.17, 5).translate(0, STALK_HEIGHT + 0.085, 0), TASSEL_TINT));
  for (let j = 0; j < 4; j++) {
    const heading = 0.4 + (j * TAU) / 4;
    const offset = radial(heading, 0.07);
    pieces.push(stem(v(0, STALK_HEIGHT - 0.01, 0), v(offset.x, STALK_HEIGHT + 0.09, offset.z), 0.009, 0.004, 4, TASSEL_TINT));
  }
  return assemble(pieces, { floor: 0.7, height: 0.5 });
}

interface VineLeafSpot {
  readonly heading: number;
  readonly radius: number;
  /** Petiole height: where the leaf blade sits. */
  readonly height: number;
}

function vineGeometry(runners: readonly number[], runnerLength: number, spots: readonly VineLeafSpot[], leafLength: number): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (const heading of runners) {
    const tip = radial(heading, runnerLength);
    pieces.push(stem(v(0, 0.02, 0), v(tip.x, 0.012, tip.z), 0.014, 0.009, 4));
  }
  spots.forEach((spot, i) => {
    const foot = radial(spot.heading, spot.radius);
    const bottom = v(foot.x, 0.015, foot.z);
    const top = v(foot.x, spot.height, foot.z);
    pieces.push(stem(bottom, top, 0.01, 0.007, 4));
    // Blades face sideways off the runner so the canopy overlaps like a real vine.
    const yaw = spot.heading + (i % 2 === 0 ? -0.7 : 0.9);
    pieces.push(
      leaf({ length: leafLength, width: leafLength * 0.9, pitch: 0.3, droop: 0.55, widest: 0.55, yaw, x: top.x, y: top.y, z: top.z }),
    );
  });
  return assemble(pieces, { floor: 0.72, height: 0.26 });
}

/** Young vine: two short runners and four broad leaves on petioles. */
export function createVineGrowingGeometry(): THREE.BufferGeometry {
  return vineGeometry(
    [0.6, 3.5],
    0.18,
    [
      { heading: 0.6, radius: 0.1, height: 0.18 },
      { heading: 3.5, radius: 0.08, height: 0.22 },
      { heading: 2.0, radius: 0.04, height: 0.26 },
      { heading: 5.0, radius: 0.12, height: 0.16 },
    ],
    0.17,
  );
}

/** Mature vine: three ground runners and seven broad leaves spreading ~0.7 wide, ~0.34 high. */
export function createVineMatureGeometry(): THREE.BufferGeometry {
  return vineGeometry(
    [0.3, 2.4, 4.4],
    0.3,
    [
      { heading: 0.3, radius: 0.1, height: 0.2 },
      { heading: 0.3, radius: 0.19, height: 0.12 },
      { heading: 2.4, radius: 0.12, height: 0.26 },
      { heading: 2.4, radius: 0.2, height: 0.1 },
      { heading: 4.4, radius: 0.1, height: 0.22 },
      { heading: 4.4, radius: 0.18, height: 0.14 },
      { heading: 1.35, radius: 0.05, height: 0.28 },
    ],
    0.17,
  );
}

/** Young wheat: a clump of eight thin, tapered grass blades (~0.58 tall) around a short sheath. */
export function createGrainGrowingGeometry(): THREE.BufferGeometry {
  const pieces = [piece(new THREE.ConeGeometry(0.028, 0.08, 5).translate(0, 0.04, 0))];
  for (let i = 0; i < 8; i++) {
    const yaw = 0.2 + i * GOLDEN_ANGLE;
    pieces.push(
      leaf({
        length: 0.62 - 0.04 * (i % 4),
        width: 0.048,
        pitch: 1.34 - 0.08 * (i % 3),
        droop: 0.28 + 0.12 * (i % 2),
        widest: 0.28,
        thickness: 0.012,
        yaw,
        ...radial(yaw, 0.02),
      }),
    );
  }
  return assemble(pieces, { floor: 0.72, height: 0.3 });
}

/**
 * Mature wheat: six straw-tinted culms (tips 0.74–0.9 high, see GRAIN_CULMS) over five low
 * arching blades. The ears (createEarsGeometry) sit exactly on the culm tips.
 */
export function createGrainMatureGeometry(): THREE.BufferGeometry {
  const pieces = [piece(new THREE.ConeGeometry(0.034, 0.1, 5).translate(0, 0.05, 0))];
  for (const culm of GRAIN_CULMS) pieces.push(stem(culm.base, culm.tip, 0.011, 0.007, 4, STRAW_TINT));
  for (let i = 0; i < 5; i++) {
    const yaw = 1.1 + (i * TAU) / 5;
    pieces.push(
      leaf({
        length: 0.38 - 0.03 * (i % 2),
        width: 0.05,
        pitch: 0.95,
        droop: 0.65,
        widest: 0.3,
        thickness: 0.012,
        yaw,
        y: 0.05 + 0.03 * (i % 3),
        ...radial(yaw, 0.022),
      }),
    );
  }
  return assemble(pieces, { floor: 0.7, height: 0.35 });
}

interface MushroomSpec {
  /** Foot of the stem on the ground. */
  readonly x: number;
  readonly z: number;
  readonly stemHeight: number;
  readonly stemRadius: number;
  readonly capRadius: number;
  readonly capHeight: number;
  /** Lean of the whole mushroom away from vertical (radians), toward `heading`. */
  readonly tilt: number;
  readonly heading: number;
}

/**
 * Recolours scattered faces on the upper part of a cap with `tint` (every `stride`-th face
 * above `minY`, offset by `phase`), so flat shading shows a few pale speckles.
 */
function speckle(geometry: THREE.BufferGeometry, tint: THREE.ColorRepresentation, minY: number, stride: number, phase: number): void {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const spot = new THREE.Color(tint);
  let upper = 0;
  for (let face = 0; face * 3 < position.count; face++) {
    const i = face * 3;
    const centroidY = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    if (centroidY < minY) continue;
    if ((upper++ + phase) % stride !== 0) continue;
    for (let k = 0; k < 3; k++) color.setXYZ(i + k, spot.r, spot.g, spot.b);
  }
  color.needsUpdate = true;
}

/**
 * One mushroom: a six-sided tapered stem (FUNGUS_STEM_TINT) under a closed seven-sided domed
 * cap (FUNGUS_CAP_TINT with pale speckles), both leaning along the spec's tilt.
 */
function mushroomPieces(spec: MushroomSpec, phase: number): THREE.BufferGeometry[] {
  const axis = leanDirection(spec.heading, spec.tilt);
  const foot = v(spec.x, 0, spec.z);
  const top = foot.clone().addScaledVector(axis, spec.stemHeight);
  const r = spec.capRadius;
  const h = spec.capHeight;
  const profile = [
    new THREE.Vector2(0, h * 0.12),
    new THREE.Vector2(r * 0.9, 0),
    new THREE.Vector2(r, h * 0.2),
    new THREE.Vector2(r * 0.86, h * 0.6),
    new THREE.Vector2(r * 0.48, h * 0.92),
    new THREE.Vector2(0, h),
  ];
  const cap = piece(new THREE.LatheGeometry(profile, 7), FUNGUS_CAP_TINT);
  speckle(cap, FUNGUS_SPOT_TINT, h * 0.45, 4, phase);
  cap.rotateY(spec.heading);
  cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, axis));
  // Sink the cap onto the stem so the gills hide the stem's top.
  const seat = top.clone().addScaledVector(axis, -h * 0.1);
  cap.translate(seat.x, seat.y, seat.z);
  return [stem(foot, top, spec.stemRadius * 1.12, spec.stemRadius * 0.85, 6, FUNGUS_STEM_TINT), cap];
}

/** Young fungus: one button mushroom (~0.13 tall) with a round cap nearly closed over its stem. */
export function createFungusGrowingGeometry(): THREE.BufferGeometry {
  return assemble(
    mushroomPieces({ x: 0, z: 0, stemHeight: 0.06, stemRadius: 0.028, capRadius: 0.064, capHeight: 0.072, tilt: 0, heading: 0 }, 0),
    { floor: 0.8, height: 0.05 },
  );
}

/**
 * Mature fungus: a cluster of three mushrooms (large, medium, small; ~0.23 tall, ~0.4 wide),
 * the smaller two leaning out from under the large cap.
 */
export function createFungusMatureGeometry(): THREE.BufferGeometry {
  const medium = radial(0.35, 0.13);
  const small = radial(4.3, 0.12);
  return assemble(
    [
      ...mushroomPieces(
        { x: -0.02, z: 0.01, stemHeight: 0.15, stemRadius: 0.03, capRadius: 0.11, capHeight: 0.075, tilt: 0.06, heading: 2.4 },
        0,
      ),
      ...mushroomPieces(
        { ...medium, stemHeight: 0.09, stemRadius: 0.022, capRadius: 0.074, capHeight: 0.055, tilt: 0.24, heading: 0.35 },
        1,
      ),
      ...mushroomPieces(
        { ...small, stemHeight: 0.05, stemRadius: 0.016, capRadius: 0.05, capHeight: 0.042, tilt: 0.3, heading: 4.3 },
        2,
      ),
    ],
    { floor: 0.8, height: 0.06 },
  );
}

// ---------------------------------------------------------------------------
// Builders: produce
// ---------------------------------------------------------------------------

/**
 * Root-vegetable crown poking out of the soil: a closed seven-sided lathe with rounded shoulders
 * (0.18 wide, 0.087 above ground) tapering into a short buried root.
 */
export function createBulbGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -0.06),
    new THREE.Vector2(0.05, -0.045),
    new THREE.Vector2(0.088, 0),
    new THREE.Vector2(0.086, 0.04),
    new THREE.Vector2(0.058, 0.07),
    new THREE.Vector2(0.022, 0.085),
    new THREE.Vector2(0, 0.087),
  ];
  return assemble([piece(new THREE.LatheGeometry(profile, 7))], { floor: 0.78, height: 0.08 });
}

/**
 * Cauliflower curd: a clustered dome of icosahedrons (~0.32 wide) raised on a short pale stalk,
 * so it crowns the leafy rosette's open centre (top ≈ 0.3).
 */
export function createHeadGeometry(): THREE.BufferGeometry {
  const pieces = [
    stem(v(0, 0, 0), v(0, 0.14, 0), 0.055, 0.05, 6, HEAD_STALK_TINT),
    blob({ x: 0, y: 0.2, z: 0, r: 0.105 }, { detail: 1, squash: 0.82 }),
  ];
  for (let i = 0; i < 6; i++) {
    const heading = 0.2 + (i * TAU) / 6;
    const offset = radial(heading, 0.09);
    pieces.push(blob({ x: offset.x, y: 0.17, z: offset.z, r: 0.072 }, { squash: 0.85, spin: heading }));
  }
  for (let i = 0; i < 3; i++) {
    const heading = 0.9 + (i * TAU) / 3;
    const offset = radial(heading, 0.045);
    pieces.push(blob({ x: offset.x, y: 0.25, z: offset.z, r: 0.06 }, { squash: 0.85, spin: heading * 2 }));
  }
  return assemble(pieces, { floor: 0.8, height: 0.24 });
}

/** Berry sites per mature-bush blob: [heading offset from the blob's own heading, elevation]. */
function berrySites(blobIndex: number, spec: BlobSpec): readonly (readonly [number, number])[] {
  if (blobIndex === 0) {
    return [
      [0.8, 0.65],
      [3.6, 0.5],
    ];
  }
  return spec.y < 0.3
    ? [
        [0.45, 0.2],
        [-0.5, -0.15],
      ]
    : [[0.2, 0.55]];
}

/**
 * Fifteen small icosahedron berries seated half-way out of the mature bush's blobs
 * (BUSH_MATURE_BLOBS), so the cluster lines up with createBushMatureGeometry at any scale.
 */
export function createBerryClusterGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  BUSH_MATURE_BLOBS.forEach((spec, blobIndex) => {
    const blobHeading = Math.atan2(-spec.z, spec.x);
    for (const [headingOffset, elevation] of berrySites(blobIndex, spec)) {
      const heading = blobHeading + headingOffset;
      const reach = spec.r * 0.92;
      const out = radial(heading, Math.cos(elevation) * reach);
      pieces.push(
        blob(
          {
            x: spec.x + out.x,
            y: spec.y + Math.sin(elevation) * reach * BUSH_SQUASH,
            z: spec.z + out.z,
            r: BERRY_RADIUS,
          },
          { spin: heading * 3 },
        ),
      );
    }
  });
  return assemble(pieces, { floor: 0.8, height: 0.4 });
}

/**
 * Corn cob on the mature stalk's +X side at mid height: an elongated octahedron of kernels
 * leaning out from the stalk, wrapped by three husk blades, with a tuft of silk at the tip.
 */
export function createCobGeometry(): THREE.BufferGeometry {
  const lean = 0.42;
  const halfLength = 0.13;
  const base = v(0.038, 0.52, 0);
  const axis = v(Math.sin(lean), Math.cos(lean), 0);
  const centre = base.clone().addScaledVector(axis, halfLength + 0.02);
  const tip = base.clone().addScaledVector(axis, 2 * halfLength + 0.02);

  const kernels = new THREE.OctahedronGeometry(1, 1);
  kernels.scale(0.052, halfLength, 0.052);
  kernels.rotateZ(-lean);
  kernels.translate(centre.x, centre.y, centre.z);

  const elevation = Math.PI / 2 - lean;
  const husk = { length: 0.2, width: 0.065, pitch: elevation - 0.05, droop: -0.12, widest: 0.4 };
  const silkTip = tip.clone().addScaledVector(axis, 0.05).add(v(0.02, 0, 0));
  return assemble(
    [
      piece(kernels),
      stem(v(0.012, 0.5, 0), base.clone().addScaledVector(axis, 0.035), 0.02, 0.024, 5, HUSK_TINT),
      stem(tip.clone().addScaledVector(axis, -0.012), silkTip, 0.012, 0.004, 4, SILK_TINT),
      leaf({ ...husk, yaw: 0.22, x: base.x, y: base.y, z: base.z - 0.035 }, HUSK_TINT),
      leaf({ ...husk, yaw: -0.22, x: base.x, y: base.y, z: base.z + 0.035 }, HUSK_TINT),
      leaf({ ...husk, yaw: 0, x: base.x + 0.03, y: base.y - 0.01, z: base.z, pitch: elevation - 0.15 }, HUSK_TINT),
    ],
    null,
  );
}

/**
 * Large ribbed gourd resting on the ground: a flattened low-poly sphere whose alternate
 * meridians are pulled in to make five lobes, with a dimpled top and a short curved stem.
 */
export function createGourdGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 6);
  const position = body.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // 10 meridians sampled at 36° steps: cos(5·azimuth) alternates ±1 → five lobes.
    const rib = 1 - 0.12 * (0.5 - 0.5 * Math.cos(Math.atan2(z, x) * 5));
    const yScale = y > 0.95 ? 0.82 : y < -0.95 ? 0.85 : 1;
    position.setXYZ(i, x * rib, y * yScale, z * rib);
  }
  body.scale(0.2, 0.13, 0.2);
  body.translate(0, 0.115, 0);
  return assemble(
    [piece(body), stem(v(0, 0.2, 0), v(0.028, 0.285, 0.012), 0.022, 0.014, 5, GOURD_STEM_TINT)],
    { floor: 0.8, height: 0.2 },
  );
}

/**
 * Golden wheat heads: on every culm tip of the mature grain clump (GRAIN_CULMS) an ear of nine
 * faceted, elongated grains (four alternating pairs up the rachis and one at the tip) with two
 * pale awns, nodding slightly further out than the straw. Aligns with
 * createGrainMatureGeometry at any scale.
 */
export function createEarsGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const orient = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  GRAIN_CULMS.forEach((culm, c) => {
    quaternion.setFromUnitVectors(UP, culm.nod);
    const start = culm.tip.clone().addScaledVector(culm.nod, -0.012);
    orient.compose(start, quaternion, unit);
    const ear: THREE.BufferGeometry[] = [];
    for (let row = 0; row < EAR.rows; row++) {
      for (let side = 0; side < 2; side++) {
        const grain = new THREE.OctahedronGeometry(1, 0);
        grain.scale(EAR.grainWidth, EAR.grainLength, EAR.grainDepth);
        grain.rotateZ(-EAR.grainTilt);
        grain.translate(EAR.grainWidth * 0.8, EAR.firstRow + row * EAR.rowSpacing + EAR.grainLength * 0.5, 0);
        grain.rotateY(c * 0.7 + row * (Math.PI / 2) + side * Math.PI);
        ear.push(piece(grain, (row + side) % 2 === 0 ? WHITE : GRAIN_SHADE_TINT));
      }
    }
    const crownY = EAR.firstRow + EAR.rows * EAR.rowSpacing;
    const crown = new THREE.OctahedronGeometry(1, 0);
    crown.scale(EAR.grainWidth * 0.85, EAR.grainLength, EAR.grainDepth * 0.85);
    crown.translate(0, crownY + EAR.grainLength * 0.45, 0);
    ear.push(piece(crown));
    for (const splay of [-1, 1]) {
      const awnTip = v(splay * 0.024, crownY + 0.08, splay * 0.01);
      ear.push(stem(v(0, crownY + 0.02, 0), awnTip, 0.0035, 0.001, 3, AWN_TINT));
    }
    for (const part of ear) pieces.push(part.applyMatrix4(orient));
  });
  return assemble(pieces, null);
}

// ---------------------------------------------------------------------------
// Builders: indicators
// ---------------------------------------------------------------------------

/**
 * Thirst indicator: an octahedron water droplet centred on the origin, stretched into a point
 * on top (≈0.17 tall, 0.12 wide). The renderer bobs and spins it in the vertex shader.
 */
export function createThirstDropletGeometry(): THREE.BufferGeometry {
  const droplet = new THREE.OctahedronGeometry(0.058, 0);
  const position = droplet.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    position.setY(i, y > 0 ? y * 1.85 : y * 1.05);
  }
  return assemble([piece(droplet)], null);
}
