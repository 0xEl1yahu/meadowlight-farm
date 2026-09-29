/**
 * Build-time geometry parts shared by every structure builder: the farmhouse and shipping bin
 * (structureGeometry.ts), the town buildings and props (townGeometry.ts) and, later, placed
 * objects. Nothing here touches the scene or game state.
 *
 * Conventions
 * - Every part is fresh, non-indexed BufferGeometry with `position` and `normal` attributes and
 *   no UVs or groups, so parts merge cleanly with {@link mergeParts} and render flat-shaded. The
 *   caller owns (and must dispose) what it receives.
 * - "Painted" parts bake linear-space colours into a `color` attribute: render them with a white
 *   material and `vertexColors: true`. {@link shade} bakes a grey instead, which multiplies an
 *   instance colour. Glass parts are unpainted and use the shared glow-glass material.
 * - Buildings are authored facing +Z (the side the camera sees), origin on the ground at the
 *   centre of their wall footprint.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TINT_MASK_ATTRIBUTE } from './materials';
import { PALETTE } from './palette';

/** Local colours (sRGB hex) for structure details the shared palette does not cover. */
export const STRUCTURE_COLORS = {
  stone: 0xd6cdc1,
  brick: 0xd88c72,
  brickDark: 0x9e6c5e,
  roofShade: 0xd5776b,
  roofRidge: 0xc4685d,
  shutter: 0x9ec6d8,
  shutterDark: 0x84adc2,
  doorDark: 0x875c40,
  knob: 0xf2c94c,
  iron: 0x5b4a40,
  doormat: 0xe59c7f,
  leaf: 0x78c06b,
  binPlank: 0xae784c,
  coin: 0xffcc45,
  coinFace: 0xffe596,
  glassDay: 0xc4e2ec,
  windowGlow: 0xffc36a,
  smoke: 0xf4f0ea,
  meadowNear: 0x93c97c,
  meadowFar: 0xa9d1a1,
  meadowHill: 0xbadc9d,
  meadowSun: 0xa9d487,
} as const;

export type Vec2 = readonly [number, number];

/** Rotation (applied X, then Z, then Y) followed by a translation. */
export interface Pose {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

/** Body parts are painted and opaque; glass parts are unpainted and use the glow material. */
export interface PartSet {
  readonly body: THREE.BufferGeometry[];
  readonly glass: THREE.BufferGeometry[];
}

export function createPartSet(): PartSet {
  return { body: [], glass: [] };
}

export function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`index ${index} outside [0, ${list.length})`);
  return value;
}

/** Picks an entry of a non-empty list with a uniform [0, 1) value. */
export function pick<T>(list: readonly T[], unit: number): T {
  const value = list[Math.min(list.length - 1, Math.max(0, Math.floor(unit * list.length)))];
  if (value === undefined) throw new RangeError('pick: list is empty');
  return value;
}

const paintColor = new THREE.Color();
const prismA = new THREE.Vector3();
const prismB = new THREE.Vector3();
const prismC = new THREE.Vector3();
const prismNormal = new THREE.Vector3();
const prismEdge = new THREE.Vector3();
const prismCentroid = new THREE.Vector3();

/** Non-indexed, no UVs, no groups, has normals. Disposes the source when a copy was needed. */
export function normalizePart(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.index === null ? source : source.toNonIndexed();
  if (geometry !== source) source.dispose();
  if (geometry.hasAttribute('uv')) geometry.deleteAttribute('uv');
  geometry.clearGroups();
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

export function pose<T extends THREE.BufferGeometry>(geometry: T, p: Pose): T {
  if (p.rx !== undefined && p.rx !== 0) geometry.rotateX(p.rx);
  if (p.rz !== undefined && p.rz !== 0) geometry.rotateZ(p.rz);
  if (p.ry !== undefined && p.ry !== 0) geometry.rotateY(p.ry);
  geometry.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  return geometry;
}

/** Fills a `color` attribute with one linear-space colour. */
export function paintRgb(source: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const geometry = normalizePart(source);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function paint(source: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  paintColor.set(color);
  return paintRgb(source, paintColor.r, paintColor.g, paintColor.b);
}

/** Grey vertex colour that multiplies an instance tint. */
export function shade(source: THREE.BufferGeometry, value: number): THREE.BufferGeometry {
  return paintRgb(source, value, value, value);
}

/** A painted box of the given size, posed. */
export function box(width: number, height: number, depth: number, p: Pose, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  return paint(pose(new THREE.BoxGeometry(width, height, depth), p), color);
}

/** An unpainted box for the glow-glass mesh. */
export function glassBox(width: number, height: number, depth: number, p: Pose): THREE.BufferGeometry {
  return normalizePart(pose(new THREE.BoxGeometry(width, height, depth), p));
}

/**
 * Merges compatible parts (same attribute set, all non-indexed) into one geometry and disposes
 * the inputs. Throws when the parts are incompatible.
 */
export function mergeParts(parts: readonly THREE.BufferGeometry[], label: string): THREE.BufferGeometry {
  if (parts.length === 0) throw new RangeError(`mergeParts(${label}): nothing to merge`);
  const merged: THREE.BufferGeometry | null = mergeGeometries([...parts], false);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error(`mergeParts(${label}): parts have incompatible attributes`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Applies `matrix` to each part (in place) and appends them to `out`. */
export function transformParts(parts: readonly THREE.BufferGeometry[], matrix: THREE.Matrix4, out: THREE.BufferGeometry[]): void {
  for (const part of parts) out.push(part.applyMatrix4(matrix));
}

/** Adds TINT_MASK_ATTRIBUTE with one value on every vertex. */
export function withTintMask(geometry: THREE.BufferGeometry, value: number): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(TINT_MASK_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count).fill(value), 1));
  return geometry;
}

/**
 * Closed prism extruded along X from a convex profile of (z, y) points. Faces are oriented
 * outward whatever the profile's winding, so the result casts and receives shadows correctly.
 */
export function convexPrismX(profile: readonly Vec2[], x0: number, x1: number): THREE.BufferGeometry {
  const n = profile.length;
  if (n < 3) throw new RangeError('convexPrismX: a profile needs at least three points');
  let sumZ = 0;
  let sumY = 0;
  for (const [z, y] of profile) {
    sumZ += z;
    sumY += y;
  }
  prismCentroid.set((x0 + x1) / 2, sumY / n, sumZ / n);

  const positions: number[] = [];
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    prismNormal.subVectors(b, a).cross(prismEdge.subVectors(c, a));
    const cx = (a.x + b.x + c.x) / 3 - prismCentroid.x;
    const cy = (a.y + b.y + c.y) / 3 - prismCentroid.y;
    const cz = (a.z + b.z + c.z) / 3 - prismCentroid.z;
    const outward = prismNormal.x * cx + prismNormal.y * cy + prismNormal.z * cz >= 0;
    const second = outward ? b : c;
    const third = outward ? c : b;
    positions.push(a.x, a.y, a.z, second.x, second.y, second.z, third.x, third.y, third.z);
  };

  for (let i = 0; i < n; i++) {
    const [pz, py] = at(profile, i);
    const [qz, qy] = at(profile, (i + 1) % n);
    pushTriangle(prismA.set(x0, py, pz), prismB.set(x1, py, pz), prismC.set(x1, qy, qz));
    pushTriangle(prismA.set(x0, py, pz), prismB.set(x1, qy, qz), prismC.set(x0, qy, qz));
  }
  const [fz, fy] = at(profile, 0);
  for (let i = 1; i < n - 1; i++) {
    const [pz, py] = at(profile, i);
    const [qz, qy] = at(profile, i + 1);
    pushTriangle(prismA.set(x0, fy, fz), prismB.set(x0, py, pz), prismC.set(x0, qy, qz));
    pushTriangle(prismA.set(x1, fy, fz), prismB.set(x1, py, pz), prismC.set(x1, qy, qz));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Gabled roofs
// ---------------------------------------------------------------------------

/** A gabled roof over a wall footprint centred on the origin, ridge along X. */
export interface GableRoofSpec {
  /** Half the wall footprint along X and Z. */
  readonly halfW: number;
  readonly halfD: number;
  /** Height of the wall tops (the eaves line before the overhang). */
  readonly wallTop: number;
  /** Roof pitch (radians). */
  readonly pitch: number;
  readonly thickness: number;
  /** Overhang past the front and back walls (along the slope's run) and past the gables. */
  readonly eaveOverhang: number;
  readonly gableOverhang: number;
}

export interface RoofColors {
  readonly roof: THREE.ColorRepresentation;
  /** Shingle rows across each slope. */
  readonly shingle: THREE.ColorRepresentation;
  readonly ridge: THREE.ColorRepresentation;
  /** Barge boards along the gable edges. */
  readonly barge: THREE.ColorRepresentation;
}

export interface GableRoofFrame {
  readonly slope: number;
  /** Gable height above the wall tops. */
  readonly rise: number;
  /** Vertical thickness of the roof panels. */
  readonly roofVertical: number;
  readonly ridgeTop: number;
}

export function gableRoofFrame(spec: GableRoofSpec): GableRoofFrame {
  const slope = Math.tan(spec.pitch);
  const rise = spec.halfD * slope;
  const roofVertical = spec.thickness / Math.cos(spec.pitch);
  return { slope, rise, roofVertical, ridgeTop: spec.wallTop + rise + roofVertical };
}

/** The triangular gable ends under a {@link gableRoofParts} roof, painted in the wall colour. */
export function gableWallPart(spec: GableRoofSpec, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const { rise } = gableRoofFrame(spec);
  const gable: Vec2[] = [
    [-spec.halfD, spec.wallTop],
    [spec.halfD, spec.wallTop],
    [0, spec.wallTop + rise],
  ];
  return paint(convexPrismX(gable, -spec.halfW, spec.halfW), color);
}

/** Two sloped panels with overhang, shingle rows, barge boards and a ridge cap. */
export function gableRoofParts(spec: GableRoofSpec, colors: RoofColors, out: PartSet): void {
  const f = gableRoofFrame(spec);
  const halfLength = spec.halfW + spec.gableOverhang;
  const eaveZ = spec.halfD + spec.eaveOverhang;
  const eaveBottom = spec.wallTop - spec.eaveOverhang * f.slope;
  const ridgeBottom = spec.wallTop + f.rise;
  const cos = Math.cos(spec.pitch);
  const sin = Math.sin(spec.pitch);
  const slopeLength = eaveZ / cos;

  for (const side of [1, -1]) {
    const panel: Vec2[] = [
      [0, f.ridgeTop],
      [side * eaveZ, eaveBottom + f.roofVertical],
      [side * eaveZ, eaveBottom],
      [0, ridgeBottom],
    ];
    out.body.push(paint(convexPrismX(panel, -halfLength, halfLength), colors.roof));

    // Outward normal of this slope and a point on its top surface `s` units down from the ridge.
    const normalY = cos;
    const normalZ = side * sin;
    const surfaceZ = (s: number): number => side * s * cos;
    const surfaceY = (s: number): number => f.ridgeTop - s * sin;

    const stripThickness = 0.035;
    for (const fraction of [0.3, 0.55, 0.8]) {
      const s = slopeLength * fraction;
      out.body.push(
        box(
          halfLength * 2,
          stripThickness,
          0.09,
          {
            y: surfaceY(s) + (normalY * stripThickness) / 2,
            z: surfaceZ(s) + (normalZ * stripThickness) / 2,
            rx: side * spec.pitch,
          },
          colors.shingle,
        ),
      );
    }

    const boardHeight = spec.thickness + 0.1;
    const mid = slopeLength / 2;
    const inset = spec.thickness / 2 + 0.03;
    for (const end of [-1, 1]) {
      out.body.push(
        box(
          0.06,
          boardHeight,
          slopeLength,
          {
            x: end * (halfLength + 0.03),
            y: surfaceY(mid) - normalY * inset,
            z: surfaceZ(mid) - normalZ * inset,
            rx: side * spec.pitch,
          },
          colors.barge,
        ),
      );
    }
  }

  out.body.push(box(halfLength * 2 + 0.1, 0.13, 0.13, { y: f.ridgeTop, rx: Math.PI / 4 }, colors.ridge));
}

// ---------------------------------------------------------------------------
// Windows, doors, lanterns
// ---------------------------------------------------------------------------

export interface WindowOptions {
  readonly width: number;
  readonly height: number;
  readonly shutters: boolean;
  readonly planter: boolean;
}

/** Frame and shutter proportions and colours of a building's windows. */
export interface WindowStyle {
  readonly frameWidth: number;
  readonly shutterWidth: number;
  readonly trim: THREE.ColorRepresentation;
  readonly shutter: THREE.ColorRepresentation;
  readonly shutterDark: THREE.ColorRepresentation;
}

/**
 * A window authored on a wall at z = 0 facing +Z, centred on the origin: frame, recessed pane
 * (glass), muntins, sill, optional shutters and an optional flower box. `placement` moves it onto
 * a wall.
 */
export function windowParts(options: WindowOptions, style: WindowStyle, placement: THREE.Matrix4, out: PartSet): void {
  const fw = style.frameWidth;
  const w = options.width;
  const h = options.height;
  const trim = style.trim;
  const local = createPartSet();

  local.body.push(box(w + 2 * fw, fw, 0.09, { y: h / 2 + fw / 2, z: 0.045 }, trim));
  local.body.push(box(w + 2 * fw, fw, 0.09, { y: -h / 2 - fw / 2, z: 0.045 }, trim));
  local.body.push(box(fw, h, 0.09, { x: -w / 2 - fw / 2, z: 0.045 }, trim));
  local.body.push(box(fw, h, 0.09, { x: w / 2 + fw / 2, z: 0.045 }, trim));
  local.glass.push(glassBox(w, h, 0.02, { z: 0.02 }));
  local.body.push(box(0.035, h, 0.03, { z: 0.05 }, trim));
  local.body.push(box(w, 0.035, 0.03, { z: 0.05 }, trim));
  local.body.push(box(w + 2 * fw + 0.12, 0.06, 0.16, { y: -h / 2 - fw - 0.03, z: 0.08 }, trim));

  if (options.shutters) {
    for (const side of [-1, 1]) {
      const sx = side * (w / 2 + fw + style.shutterWidth / 2 + 0.01);
      local.body.push(box(style.shutterWidth, h + 2 * fw, 0.04, { x: sx, z: 0.02 }, style.shutter));
      for (const sy of [-0.26, 0.26]) {
        local.body.push(box(style.shutterWidth * 0.72, 0.035, 0.016, { x: sx, y: sy * h, z: 0.047 }, style.shutterDark));
      }
    }
  }

  if (options.planter) {
    const top = -h / 2 - fw - 0.07;
    const planterWidth = w + 2 * fw + 0.06;
    local.body.push(box(planterWidth, 0.2, 0.22, { y: top - 0.1, z: 0.12 }, PALETTE.binWood));
    local.body.push(box(planterWidth - 0.08, 0.02, 0.15, { y: top, z: 0.12 }, PALETTE.soilWatered));
    const blooms = 5;
    for (let i = 0; i < blooms; i++) {
      const fx = -planterWidth / 2 + 0.1 + (i / (blooms - 1)) * (planterWidth - 0.2);
      local.body.push(
        paint(pose(new THREE.TetrahedronGeometry(0.08, 0), { x: fx + 0.04, y: top + 0.04, z: 0.11, ry: i * 1.3 }), STRUCTURE_COLORS.leaf),
      );
      local.body.push(
        paint(
          pose(new THREE.OctahedronGeometry(0.06, 0), { x: fx, y: top + 0.1 + (i % 2) * 0.03, z: 0.13, ry: i * 0.7 }),
          pick(PALETTE.flower, (i % 3) / 3),
        ),
      );
    }
  }

  transformParts(local.body, placement, out.body);
  transformParts(local.glass, placement, out.glass);
}

/** A front door on the +Z wall face. */
export interface DoorSpec {
  /** Door centre along X. */
  readonly x: number;
  /** Z of the wall face the door sits on. */
  readonly front: number;
  /** Height of the floor (foundation top) the door opens onto. */
  readonly base: number;
  readonly width: number;
  readonly height: number;
  /** Depth of the stone step in front of the wall. */
  readonly stepDepth: number;
}

export interface DoorColors {
  readonly trim: THREE.ColorRepresentation;
  readonly door: THREE.ColorRepresentation;
  readonly doorDark: THREE.ColorRepresentation;
  readonly awning: THREE.ColorRepresentation;
}

/** Door with frame, planks, a small window (glass), knob, awning, stone step and doormat. */
export function doorParts(spec: DoorSpec, colors: DoorColors, out: PartSet): void {
  const { x, front, base, width, height } = spec;
  const frameHalf = width / 2 + 0.1;
  const frameHeight = height + 0.12;

  out.body.push(box(frameHalf * 2, frameHeight, 0.08, { x, y: base + frameHeight / 2, z: front + 0.03 }, colors.trim));
  out.body.push(box(width, height, 0.06, { x, y: base + height / 2, z: front + 0.08 }, colors.door));
  for (const sx of [-1, 1]) {
    out.body.push(box(0.025, height - 0.54, 0.012, { x: x + sx * 0.14, y: base + (height - 0.38) / 2, z: front + 0.114 }, colors.doorDark));
  }

  const paneY = base + height - 0.3;
  out.glass.push(glassBox(0.3, 0.2, 0.02, { x, y: paneY, z: front + 0.115 }));
  out.body.push(box(0.022, 0.2, 0.02, { x, y: paneY, z: front + 0.128 }, colors.doorDark));
  out.body.push(box(0.3, 0.022, 0.02, { x, y: paneY, z: front + 0.128 }, colors.doorDark));
  out.body.push(
    paint(pose(new THREE.IcosahedronGeometry(0.045, 0), { x: x + width / 2 - 0.12, y: base + height / 2, z: front + 0.13 }), STRUCTURE_COLORS.knob),
  );

  // Little shed awning over the door, held by two diagonal brackets.
  const awningTilt = 0.42;
  const awningDepth = 0.5;
  out.body.push(
    box(
      frameHalf * 2 + 0.24,
      0.06,
      awningDepth,
      { x, y: base + frameHeight + 0.2, z: front + (awningDepth / 2) * Math.cos(awningTilt), rx: awningTilt },
      colors.awning,
    ),
  );
  for (const sx of [-1, 1]) {
    out.body.push(box(0.05, 0.05, 0.3, { x: x + sx * (frameHalf + 0.02), y: base + frameHeight + 0.05, z: front + 0.1, rx: -0.8 }, colors.trim));
  }

  const stepDepth = Math.max(0.2, spec.stepDepth);
  out.body.push(box(width + 0.52, 0.12, stepDepth, { x, y: 0.04, z: front + stepDepth / 2 }, STRUCTURE_COLORS.stone));
  const matDepth = Math.min(0.32, stepDepth - 0.12);
  out.body.push(box(width - 0.08, 0.02, matDepth, { x, y: 0.11, z: front + stepDepth / 2 + 0.03 }, STRUCTURE_COLORS.doormat));
}

/** Wall lantern hanging from a bracket on the +Z wall face at `front`; its glass glows with the windows. */
export function wallLanternParts(x: number, y: number, front: number, out: PartSet): void {
  const z = front + 0.16;
  out.body.push(box(0.04, 0.04, 0.17, { x, y: y + 0.19, z: front + 0.085 }, STRUCTURE_COLORS.iron));
  out.body.push(paint(pose(new THREE.ConeGeometry(0.105, 0.09, 4), { x, y: y + 0.145, z, ry: Math.PI / 4 }), STRUCTURE_COLORS.iron));
  out.body.push(box(0.15, 0.03, 0.15, { x, y: y - 0.075, z }, STRUCTURE_COLORS.iron));
  out.glass.push(glassBox(0.12, 0.16, 0.12, { x, y: y + 0.02, z }));
}
