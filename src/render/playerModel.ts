/**
 * The farmer: a low-poly character rig, the props it can hold, and the pose vocabulary the
 * PlayerRenderer animates it with.
 *
 * Model
 * - Authored facing +Z with the soles of the boots at local y = 0 and a total height of ~1.1
 *   units (hat included), so `directionYaw` from world/grid.ts turns it correctly.
 * - A small hierarchy of pivot groups ("bones"): root → body → hips → torso → head / arms, with
 *   the legs hanging from the body so they can stay planted while the upper body crouches.
 * - Every segment is ONE merged BufferGeometry with baked per-vertex colours, all sharing a
 *   single flat-shaded vertex-colour material. The whole farmer is nine draw calls; left and
 *   right limbs share their geometry.
 *
 * Looks (farmclaws part 4a refinement R14)
 * - The constructor takes an Appearance: skin, hair, shirt and overalls colours come from
 *   APPEARANCE_PALETTES, plus a hair style (HAIR_STYLES) and a hat (HAT_STYLES). Index 0 of
 *   each is the player's original look, so `new PlayerModel()` builds today's farmer: short
 *   hair under the straw hat, in PALETTE.player's colours. NpcRenderer builds the cast with it.
 *
 * Held items
 * - Hoe, watering can, pickaxe, axe, scythe and zone marker are merged vertex-coloured props. A seed pouch
 *   and a gem-like "item" are tinted at runtime with the held item's colour.
 * - Every prop is authored with its grip at the origin, its handle along +Y and its working
 *   edge (blade, spout, pick) toward +Z, and is parented to the right wrist.
 *
 * Pose conventions (radians / world units), applied by `applyPose`
 * - `*Swing`: positive swings a limb forward and up (a swing of π points the arm straight up).
 * - `*Spread`: positive moves an arm outward, away from the body.
 * - `*Yaw`: arm rotation about the vertical after pitching; positive turns toward the
 *   character's left (+X when facing +Z).
 * - `twist`: upper-body yaw, positive toward the character's left. `lean`: positive forward.
 *   `tilt`: upper-body roll, positive leans toward the character's right (−X).
 * - `wristPitch` rotates the held prop about the forearm's side axis; `wristTwist` spins it
 *   about its own handle; `wristRoll` leans it sideways (positive toward the character's
 *   right, i.e. away from the body for the right hand).
 * - `crouch` lowers the hips (the legs are squashed to stay planted), `hop` lifts the whole body.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Appearance, ToolType } from '../core/types';
import { at } from './geometryParts';
import { createFlatMaterial } from './materials';
import { APPEARANCE_PALETTES, PALETTE } from './palette';

// ---------------------------------------------------------------------------
// Dimensions & colours
// ---------------------------------------------------------------------------

/** Joint layout of the rig (world units, model space). */
export const PLAYER_RIG = {
  /** Hip joint height when standing; equals the leg length so the soles touch y = 0. */
  hipHeight: 0.36,
  legLength: 0.36,
  /** Half the distance between the legs. */
  legOffsetX: 0.075,
  /** Shoulder joint, relative to the torso pivot (the waist). */
  shoulderX: 0.19,
  shoulderY: 0.29,
  /** Distance from the shoulder joint to the grip point in the hand. */
  armLength: 0.28,
  /** Neck pivot, relative to the torso pivot. */
  neckY: 0.33,
  /** Eye line, relative to the neck pivot. */
  eyeY: 0.15,
} as const;

/** Share of the upper-body twist taken by the pelvis (the rest is applied by the torso). */
const HIP_TWIST_SHARE = 0.3;
/** Limits of the leg squash/stretch that keeps the soles planted while crouching. */
const LEG_SCALE_MIN = 0.55;
const LEG_SCALE_MAX = 1.15;
/** Opacity of the contact shadow while standing on the ground. */
const BLOB_OPACITY = 0.2;

const HAT = PALETTE.player.hat;
const BOOTS = PALETTE.player.boots;
const EYE = 0x3a2a2a;
const CHEEK = 0xf6a6a0;
const HAT_BAND = PALETTE.houseRoof;
/** The other hats (HAT_STYLES): a red cap, and a mustard knitted hat with a cream pompom. */
const CAP = 0xd8634e;
const KNIT = 0xe0a84a;
const KNIT_POMPOM = 0xfff4e0;
const BRASS = 0xf2c46b;

const WOOD = 0xcfa574;
const METAL = 0xaab2c6;
const METAL_DARK = 0x858da3;
const EDGE = 0xeef2f8;
const CAN_BODY = 0x7fb8e6;
const CAN_TRIM = 0x5f93c6;
const CAN_RIM = 0xb4d8f4;

/** Accent wrap on each tool handle, so tools read apart at a glance. */
const TOOL_WRAP: Readonly<Record<Exclude<ToolType, 'wateringCan'>, number>> = {
  hoe: 0x9ccf7a,
  pickaxe: 0xb8a4e8,
  axe: 0xef8f80,
  scythe: 0xf2c46b,
  zoneMarker: 0xf2c46b,
};

/** The zone marker's pennant (farmclaws part 3 spec §8). */
const PENNANT = 0xe2563f;

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** Appearance.hairStyle values, APPEARANCE.hairStyles of them; 0 is the original look. */
export const HAIR_STYLES = { short: 0, ponytail: 1, bob: 2 } as const;

/** Appearance.hat values, APPEARANCE.hats of them; 0, the straw hat, is the original look. */
export const HAT_STYLES = { straw: 0, none: 1, cap: 2, knit: 3 } as const;

/** The player's original look: index 0 of every palette, short hair and the straw hat. */
export const DEFAULT_APPEARANCE: Appearance = {
  skinTone: 0,
  hairStyle: HAIR_STYLES.short,
  hairColor: 0,
  shirtColor: 0,
  overallsColor: 0,
  hat: HAT_STYLES.straw,
};

/** The four colours an Appearance picks from APPEARANCE_PALETTES. */
interface BodyColors {
  readonly skin: number;
  readonly hair: number;
  readonly shirt: number;
  readonly overalls: number;
}

/** Throws a RangeError for an index outside its palette. */
function appearanceColors(appearance: Appearance): BodyColors {
  return {
    skin: at(APPEARANCE_PALETTES.skin, appearance.skinTone),
    hair: at(APPEARANCE_PALETTES.hair, appearance.hairColor),
    shirt: at(APPEARANCE_PALETTES.shirt, appearance.shirtColor),
    overalls: at(APPEARANCE_PALETTES.overalls, appearance.overallsColor),
  };
}

// ---------------------------------------------------------------------------
// Geometry baking
// ---------------------------------------------------------------------------

type Vec3Tuple = readonly [number, number, number];

/** One primitive of a merged prop: a geometry, a flat colour and a placement. */
export interface Part {
  readonly geometry: THREE.BufferGeometry;
  readonly color: number;
  /** Brightness multiplier applied to `color` (1 = unchanged). */
  readonly shade?: number;
  readonly position?: Vec3Tuple;
  readonly rotation?: Vec3Tuple;
  readonly scale?: Vec3Tuple;
}

const ORIGIN: Vec3Tuple = [0, 0, 0];
const UNIT: Vec3Tuple = [1, 1, 1];

const bakeMatrix = new THREE.Matrix4();
const bakeEuler = new THREE.Euler();
const bakeQuaternion = new THREE.Quaternion();
const bakePosition = new THREE.Vector3();
const bakeScale = new THREE.Vector3();
const bakeColor = new THREE.Color();

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth);
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
}

function ico(radius: number, detail: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(radius, detail);
}

function cone(radius: number, height: number, segments: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(radius, height, segments);
}

/**
 * Merges primitives into one non-indexed geometry with a baked `color` attribute. Inputs are
 * converted to non-indexed and stripped to position + normal so every piece has identical
 * attributes; the source geometries are disposed. npcProps.ts bakes the cast's props with it.
 */
export function bakeParts(parts: readonly Part[]): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (const part of parts) {
    const source = part.geometry;
    const piece = source.index !== null ? source.toNonIndexed() : source.clone();
    source.dispose();
    for (const name of Object.keys(piece.attributes)) {
      if (name !== 'position' && name !== 'normal') piece.deleteAttribute(name);
    }

    const [px, py, pz] = part.position ?? ORIGIN;
    const [rx, ry, rz] = part.rotation ?? ORIGIN;
    const [sx, sy, sz] = part.scale ?? UNIT;
    bakeMatrix.compose(
      bakePosition.set(px, py, pz),
      bakeQuaternion.setFromEuler(bakeEuler.set(rx, ry, rz)),
      bakeScale.set(sx, sy, sz),
    );
    piece.applyMatrix4(bakeMatrix);

    bakeColor.setHex(part.color).multiplyScalar(part.shade ?? 1);
    const count = piece.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = bakeColor.r;
      colors[i * 3 + 1] = bakeColor.g;
      colors[i * 3 + 2] = bakeColor.b;
    }
    piece.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(piece);
  }

  const merged: THREE.BufferGeometry | null = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (merged === null) throw new Error('playerModel: failed to merge part geometries');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Body segments
// ---------------------------------------------------------------------------

/** The hair over the scalp, plus a ponytail or a bob; `style` is a HAIR_STYLES value. */
function hairParts(hair: number, style: number): Part[] {
  const scalp = (): Part => ({ geometry: ico(0.178, 1), color: hair, position: [0, 0.178, -0.032], scale: [1.03, 0.95, 1] });
  switch (style) {
    case HAIR_STYLES.short:
      return [scalp()];
    case HAIR_STYLES.ponytail:
      // A band at the back of the head and a tail hanging from it.
      return [
        scalp(),
        { geometry: cylinder(0.036, 0.036, 0.03, 6), color: hair, shade: 0.75, position: [0, 0.2, -0.2], rotation: [Math.PI / 2, 0, 0] },
        { geometry: ico(0.06, 0), color: hair, position: [0, 0.115, -0.225], scale: [0.8, 1.6, 0.8] },
      ];
    case HAIR_STYLES.bob:
      // Hair down to the neck at the back, and a lock over each ear.
      return [
        scalp(),
        { geometry: box(0.32, 0.18, 0.1), color: hair, position: [0, 0.11, -0.135] },
        { geometry: box(0.05, 0.17, 0.15), color: hair, position: [0.165, 0.12, -0.03] },
        { geometry: box(0.05, 0.17, 0.15), color: hair, position: [-0.165, 0.12, -0.03] },
      ];
    default:
      throw new RangeError(`playerModel: no hair style ${style}`);
  }
}

/** The hat over the hair; `hat` is a HAT_STYLES value. */
function hatParts(hat: number): Part[] {
  switch (hat) {
    case HAT_STYLES.straw:
      // Straw hat: wide brim, crown and a coral ribbon.
      return [
        { geometry: cylinder(0.27, 0.27, 0.024, 10), color: HAT, position: [0, 0.27, 0.01], rotation: [0.05, 0, 0] },
        { geometry: cylinder(0.125, 0.15, 0.11, 8), color: HAT, shade: 1.04, position: [0, 0.335, 0] },
        { geometry: cylinder(0.153, 0.153, 0.032, 8), color: HAT_BAND, position: [0, 0.3, 0] },
        { geometry: cylinder(0.1, 0.125, 0.012, 8), color: HAT, shade: 0.9, position: [0, 0.395, 0] },
      ];
    case HAT_STYLES.none:
      return [];
    case HAT_STYLES.cap:
      // Cap: a rounded crown, a peak over the eyes and a button on top.
      return [
        { geometry: cylinder(0.15, 0.182, 0.1, 8), color: CAP, position: [0, 0.31, 0] },
        { geometry: box(0.2, 0.018, 0.13), color: CAP, shade: 0.85, position: [0, 0.27, 0.2], rotation: [0.12, 0, 0] },
        { geometry: cylinder(0.024, 0.024, 0.016, 6), color: CAP, shade: 0.8, position: [0, 0.368, 0] },
      ];
    case HAT_STYLES.knit:
      // Knitted hat: a tapering body, a ribbed cuff and a pompom.
      return [
        { geometry: cylinder(0.13, 0.186, 0.13, 8), color: KNIT, position: [0, 0.32, -0.005] },
        { geometry: cylinder(0.192, 0.192, 0.05, 8), color: KNIT, shade: 0.85, position: [0, 0.272, -0.005] },
        { geometry: ico(0.048, 0), color: KNIT_POMPOM, position: [0, 0.405, -0.005] },
      ];
    default:
      throw new RangeError(`playerModel: no hat ${hat}`);
  }
}

/** Head, hair and hat, relative to the neck pivot. The eyes are a separate mesh. */
function buildHeadGeometry(colors: BodyColors, hairStyle: number, hat: number): THREE.BufferGeometry {
  return bakeParts([
    { geometry: ico(0.17, 1), color: colors.skin, position: [0, 0.16, 0], scale: [1, 0.94, 0.96] },
    ...hairParts(colors.hair, hairStyle),
    { geometry: box(0.03, 0.03, 0.03), color: colors.skin, shade: 0.9, position: [0, 0.118, 0.172] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [0.096, 0.104, 0.128] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [-0.096, 0.104, 0.128] },
    ...hatParts(hat),
  ]);
}

/** Both eyes, centred on the eye line so they can blink by scaling Y. */
function buildEyesGeometry(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.032, 0.05, 0.03), color: EYE, position: [0.062, 0, 0.155] },
    { geometry: box(0.032, 0.05, 0.03), color: EYE, position: [-0.062, 0, 0.155] },
  ]);
}

/** Shirt, overall bib and straps, relative to the torso pivot (the waist). */
function buildTorsoGeometry(colors: BodyColors): THREE.BufferGeometry {
  const strapX = 0.07;
  const { skin, shirt, overalls } = colors;
  return bakeParts([
    { geometry: box(0.3, 0.27, 0.2), color: shirt, position: [0, 0.195, 0] },
    { geometry: cylinder(0.055, 0.062, 0.07, 6), color: skin, position: [0, 0.33, 0] },
    { geometry: box(0.2, 0.15, 0.025), color: overalls, position: [0, 0.13, 0.103] },
    { geometry: box(0.08, 0.05, 0.012), color: overalls, shade: 0.82, position: [0, 0.145, 0.121] },
    { geometry: box(0.045, 0.14, 0.025), color: overalls, position: [strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.14, 0.025), color: overalls, position: [-strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.025, 0.21), color: overalls, position: [strapX, 0.335, 0] },
    { geometry: box(0.045, 0.025, 0.21), color: overalls, position: [-strapX, 0.335, 0] },
    { geometry: box(0.045, 0.27, 0.025), color: overalls, position: [strapX, 0.2, -0.103] },
    { geometry: box(0.045, 0.27, 0.025), color: overalls, position: [-strapX, 0.2, -0.103] },
    { geometry: box(0.03, 0.03, 0.02), color: BRASS, position: [strapX, 0.196, 0.121] },
    { geometry: box(0.03, 0.03, 0.02), color: BRASS, position: [-strapX, 0.196, 0.121] },
  ]);
}

/** Overall seat, relative to the hip pivot. */
function buildPelvisGeometry(colors: BodyColors): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.29, 0.14, 0.2), color: colors.overalls, position: [0, 0.005, 0] },
    { geometry: box(0.3, 0.03, 0.21), color: colors.overalls, shade: 0.85, position: [0, 0.06, 0] },
  ]);
}

/** One leg with a rolled cuff and a boot, hanging from the hip joint (sole at y = -legLength). */
function buildLegGeometry(colors: BodyColors): THREE.BufferGeometry {
  const sole = -PLAYER_RIG.legLength;
  return bakeParts([
    { geometry: box(0.12, 0.26, 0.13), color: colors.overalls, position: [0, -0.13, 0] },
    { geometry: box(0.135, 0.04, 0.145), color: colors.overalls, shade: 0.82, position: [0, -0.245, 0] },
    { geometry: box(0.13, 0.085, 0.19), color: BOOTS, position: [0, sole + 0.0575, 0.025] },
    { geometry: box(0.14, 0.025, 0.2), color: BOOTS, shade: 0.72, position: [0, sole + 0.0125, 0.025] },
  ]);
}

/** One arm: short sleeve, forearm and hand, hanging from the shoulder joint. */
function buildArmGeometry(colors: BodyColors): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.1, 0.13, 0.1), color: colors.shirt, position: [0, -0.055, 0] },
    { geometry: box(0.075, 0.14, 0.075), color: colors.skin, position: [0, -0.18, 0] },
    { geometry: ico(0.052, 0), color: colors.skin, position: [0, -PLAYER_RIG.armLength, 0.005] },
  ]);
}

// ---------------------------------------------------------------------------
// Held props (grip at the origin, handle +Y, working edge +Z)
// ---------------------------------------------------------------------------

function buildHoeGeometry(): THREE.BufferGeometry {
  // A short neck juts forward from the top of the handle; the blade hangs from it angled
  // down and forward, giving the classic "7" silhouette.
  const topY = 0.45;
  const neckLength = 0.07;
  const bladeTilt = 0.6;
  const bladeLength = 0.12;
  const dirY = -Math.sin(bladeTilt);
  const dirZ = Math.cos(bladeTilt);
  const edgeReach = bladeLength + 0.01;
  return bakeParts([
    { geometry: cylinder(0.02, 0.023, 0.6, 6), color: WOOD, position: [0, 0.16, 0] },
    { geometry: cylinder(0.027, 0.027, 0.08, 6), color: TOOL_WRAP.hoe, position: [0, -0.095, 0] },
    { geometry: box(0.045, 0.05, 0.045), color: METAL_DARK, position: [0, topY, 0] },
    { geometry: box(0.03, 0.03, neckLength), color: METAL_DARK, position: [0, topY, neckLength / 2] },
    {
      geometry: box(0.15, 0.02, bladeLength),
      color: METAL,
      position: [0, topY + (dirY * bladeLength) / 2, neckLength + (dirZ * bladeLength) / 2],
      rotation: [bladeTilt, 0, 0],
    },
    {
      geometry: box(0.155, 0.024, 0.022),
      color: EDGE,
      position: [0, topY + dirY * edgeReach, neckLength + dirZ * edgeReach],
      rotation: [bladeTilt, 0, 0],
    },
  ]);
}

function buildPickaxeGeometry(): THREE.BufferGeometry {
  const droop = 0.22;
  const reach = 0.13;
  const headY = 0.45;
  return bakeParts([
    { geometry: cylinder(0.02, 0.023, 0.58, 6), color: WOOD, position: [0, 0.17, 0] },
    { geometry: cylinder(0.027, 0.027, 0.07, 6), color: TOOL_WRAP.pickaxe, position: [0, -0.085, 0] },
    { geometry: box(0.065, 0.065, 0.075), color: METAL_DARK, position: [0, headY, 0] },
    {
      geometry: cone(0.034, 0.2, 5),
      color: METAL,
      position: [0, headY - Math.sin(droop) * reach, Math.cos(droop) * reach],
      rotation: [Math.PI / 2 + droop, 0, 0],
    },
    {
      geometry: cone(0.034, 0.2, 5),
      color: METAL,
      position: [0, headY - Math.sin(droop) * reach, -Math.cos(droop) * reach],
      rotation: [-(Math.PI / 2 + droop), 0, 0],
    },
  ]);
}

function buildAxeGeometry(): THREE.BufferGeometry {
  const headY = 0.39;
  return bakeParts([
    { geometry: cylinder(0.02, 0.024, 0.56, 6), color: WOOD, position: [0, 0.16, 0] },
    { geometry: cylinder(0.027, 0.027, 0.075, 6), color: TOOL_WRAP.axe, position: [0, -0.085, 0] },
    { geometry: box(0.05, 0.11, 0.075), color: METAL_DARK, position: [0, headY, 0.035] },
    { geometry: box(0.03, 0.17, 0.07), color: METAL, position: [0, headY, 0.1] },
    { geometry: box(0.032, 0.18, 0.02), color: EDGE, position: [0, headY, 0.14] },
    { geometry: box(0.045, 0.07, 0.04), color: METAL_DARK, shade: 0.9, position: [0, headY, -0.03] },
  ]);
}

function buildScytheGeometry(): THREE.BufferGeometry {
  const topY = 0.49;
  // Three blade segments curving away from the snath along -X and hooking back toward the grip.
  const seg1Length = 0.13;
  const seg2Length = 0.12;
  const seg3Length = 0.1;
  const seg2Angle = 0.3;
  const seg3Angle = 0.65;
  const seg2StartX = -0.005 - seg1Length;
  const seg2EndX = seg2StartX - Math.cos(seg2Angle) * seg2Length;
  const seg2EndY = topY - Math.sin(seg2Angle) * seg2Length;
  return bakeParts([
    { geometry: cylinder(0.018, 0.022, 0.72, 6), color: WOOD, position: [0, 0.14, 0] },
    { geometry: cylinder(0.026, 0.026, 0.08, 6), color: TOOL_WRAP.scythe, position: [0, -0.18, 0] },
    { geometry: box(0.1, 0.024, 0.024), color: WOOD, shade: 0.85, position: [0.045, 0.22, 0] },
    { geometry: box(0.045, 0.05, 0.04), color: METAL_DARK, position: [0, topY, 0] },
    { geometry: box(seg1Length, 0.046, 0.014), color: METAL, position: [-0.005 - seg1Length / 2, topY, 0] },
    {
      geometry: box(seg2Length, 0.04, 0.014),
      color: EDGE,
      position: [
        seg2StartX - (Math.cos(seg2Angle) * seg2Length) / 2,
        topY - (Math.sin(seg2Angle) * seg2Length) / 2,
        0,
      ],
      rotation: [0, 0, seg2Angle],
    },
    {
      geometry: box(seg3Length, 0.032, 0.014),
      color: EDGE,
      position: [seg2EndX - (Math.cos(seg3Angle) * seg3Length) / 2, seg2EndY - (Math.sin(seg3Angle) * seg3Length) / 2, 0],
      rotation: [0, 0, seg3Angle],
    },
  ]);
}

function buildWateringCanGeometry(): THREE.BufferGeometry {
  const spoutAngle = 0.927; // rotates +Y onto (0, 0.6, 0.8)
  const spoutBaseY = -0.14;
  const spoutBaseZ = 0.08;
  const spoutLength = 0.17;
  const dirY = Math.cos(spoutAngle);
  const dirZ = Math.sin(spoutAngle);
  return bakeParts([
    { geometry: cylinder(0.085, 0.095, 0.15, 8), color: CAN_BODY, position: [0, -0.115, 0] },
    { geometry: cylinder(0.07, 0.085, 0.02, 8), color: CAN_RIM, position: [0, -0.03, 0] },
    { geometry: cylinder(0.098, 0.098, 0.026, 8), color: CAN_TRIM, position: [0, -0.172, 0] },
    { geometry: box(0.026, 0.026, 0.13), color: CAN_TRIM, position: [0, 0, -0.02] },
    { geometry: box(0.026, 0.045, 0.026), color: CAN_TRIM, position: [0, -0.02, -0.075] },
    { geometry: box(0.026, 0.045, 0.026), color: CAN_TRIM, position: [0, -0.02, 0.035] },
    {
      geometry: cylinder(0.014, 0.02, spoutLength, 6),
      color: CAN_BODY,
      position: [0, spoutBaseY + (dirY * spoutLength) / 2, spoutBaseZ + (dirZ * spoutLength) / 2],
      rotation: [spoutAngle, 0, 0],
    },
    {
      geometry: cylinder(0.032, 0.018, 0.036, 7),
      color: EDGE,
      position: [0, spoutBaseY + dirY * (spoutLength + 0.018), spoutBaseZ + dirZ * (spoutLength + 0.018)],
      rotation: [spoutAngle, 0, 0],
    },
  ]);
}

/** Seed pouch; white parts take the runtime tint, grey parts become a darker shade of it. */
/** A surveyor's stake: a short pole with a metal foot and a pennant near the top (farmclaws part 3 spec §8). */
function buildZoneMarkerGeometry(): THREE.BufferGeometry {
  const topY = 0.3;
  return bakeParts([
    { geometry: cylinder(0.018, 0.02, 0.44, 6), color: WOOD, position: [0, 0.09, 0] },
    { geometry: cylinder(0.026, 0.026, 0.07, 6), color: TOOL_WRAP.zoneMarker, position: [0, -0.085, 0] },
    { geometry: cone(0.02, 0.06, 6), color: METAL, position: [0, -0.16, 0], rotation: [Math.PI, 0, 0] },
    { geometry: box(0.012, 0.1, 0.14), color: PENNANT, position: [0, topY - 0.03, 0.075] },
    { geometry: box(0.014, 0.03, 0.03), color: PENNANT, shade: 0.8, position: [0, topY + 0.04, 0.012] },
  ]);
}

function buildPouchGeometry(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: ico(0.068, 0), color: 0xffffff, position: [0, -0.01, 0.045], scale: [1, 0.9, 1] },
    { geometry: cylinder(0.024, 0.034, 0.035, 6), color: 0xffffff, shade: 0.5, position: [0, 0.055, 0.045] },
    { geometry: cylinder(0.04, 0.02, 0.03, 6), color: 0xffffff, shade: 0.9, position: [0, 0.085, 0.045] },
  ]);
}

function buildGemGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.OctahedronGeometry(0.06, 0);
  geometry.scale(1, 1.35, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.translate(0, 0.035, 0.05);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

function segment(geometry: THREE.BufferGeometry, material: THREE.Material, receiveShadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * The farmer's bone hierarchy and meshes, in the colours, hair and hat of an Appearance (the
 * player's original look by default). Owns (and disposes) its geometries and materials.
 */
export class PlayerModel {
  /** Placed at the feet and yawed by the renderer. */
  readonly root = new THREE.Group();
  /** Everything but the ground blob; lifted by `hop`. */
  readonly body = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly rightArm = new THREE.Group();
  readonly leftArm = new THREE.Group();
  /** Grip point of the right hand; held props attach here. */
  readonly rightWrist = new THREE.Group();
  readonly leftLeg = new THREE.Group();
  readonly rightLeg = new THREE.Group();
  readonly eyes: THREE.Mesh;
  /** Soft contact shadow under the feet (keeps the character grounded at night). */
  readonly groundBlob: THREE.Mesh;
  readonly blobMaterial: THREE.MeshBasicMaterial;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  /** Throws a RangeError when `appearance` picks a colour, hair style or hat that doesn't exist. */
  constructor(appearance: Appearance = DEFAULT_APPEARANCE) {
    const R = PLAYER_RIG;
    const colors = appearanceColors(appearance);
    const material = createFlatMaterial(0xffffff, { vertexColors: true });
    this.blobMaterial = new THREE.MeshBasicMaterial({
      color: 0x1d2a22,
      transparent: true,
      opacity: BLOB_OPACITY,
      depthWrite: false,
    });
    this.materials.push(material, this.blobMaterial);

    const headGeometry = buildHeadGeometry(colors, appearance.hairStyle, appearance.hat);
    const eyesGeometry = buildEyesGeometry();
    const torsoGeometry = buildTorsoGeometry(colors);
    const pelvisGeometry = buildPelvisGeometry(colors);
    const legGeometry = buildLegGeometry(colors);
    const armGeometry = buildArmGeometry(colors);
    const blobGeometry = new THREE.CircleGeometry(0.27, 12);
    blobGeometry.rotateX(-Math.PI / 2);
    this.geometries.push(
      headGeometry,
      eyesGeometry,
      torsoGeometry,
      pelvisGeometry,
      legGeometry,
      armGeometry,
      blobGeometry,
    );

    this.root.name = 'player';
    // The bones NpcRenderer hangs the cast's props from (npcProps.ts NPC_PROP_BONES).
    this.hips.name = 'hips';
    this.torso.name = 'torso';
    this.head.name = 'head';
    this.root.add(this.body);

    this.groundBlob = new THREE.Mesh(blobGeometry, this.blobMaterial);
    this.groundBlob.position.y = 0.012;
    this.groundBlob.renderOrder = 1;
    this.root.add(this.groundBlob);

    // Pelvis and upper body.
    this.hips.position.y = R.hipHeight;
    this.body.add(this.hips);
    this.hips.add(segment(pelvisGeometry, material));
    this.torso.rotation.order = 'YXZ';
    this.hips.add(this.torso);
    this.torso.add(segment(torsoGeometry, material));

    this.head.position.y = R.neckY;
    this.torso.add(this.head);
    this.head.add(segment(headGeometry, material));
    this.eyes = segment(eyesGeometry, material, false);
    this.eyes.castShadow = false;
    this.eyes.position.y = R.eyeY;
    this.head.add(this.eyes);

    // Arms (the character's right side is -X when facing +Z).
    for (const [arm, side] of [
      [this.rightArm, -1],
      [this.leftArm, 1],
    ] as const) {
      arm.rotation.order = 'YXZ';
      arm.position.set(side * R.shoulderX, R.shoulderY, 0);
      arm.add(segment(armGeometry, material));
      this.torso.add(arm);
    }
    // Twist about the handle first, then lean sideways, then pitch with the forearm.
    this.rightWrist.rotation.order = 'XZY';
    this.rightWrist.position.y = -R.armLength;
    this.rightArm.add(this.rightWrist);

    // Legs hang from the body (not the hips) so torso rotations never lift the feet.
    for (const [leg, side] of [
      [this.rightLeg, -1],
      [this.leftLeg, 1],
    ] as const) {
      leg.position.set(side * R.legOffsetX, R.hipHeight, 0);
      leg.add(segment(legGeometry, material));
      this.body.add(leg);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Held item props
// ---------------------------------------------------------------------------

/** Which prop is in the farmer's right hand. */
export type HeldModelKind = ToolType | 'pouch' | 'gem';

export const HELD_MODEL_KINDS: readonly HeldModelKind[] = [
  'hoe',
  'wateringCan',
  'pickaxe',
  'axe',
  'scythe',
  'zoneMarker',
  'pouch',
  'gem',
];

/**
 * All held props, pre-built and parented to one socket. Switching is a visibility toggle plus
 * a colour change for the tinted pouch / gem, so it never allocates.
 */
export class HeldItemRack {
  /** Attach to PlayerModel.rightWrist; scale it for pop-in effects. */
  readonly socket = new THREE.Group();
  private readonly meshes: Readonly<Record<HeldModelKind, THREE.Mesh>>;
  private readonly propMaterial: THREE.MeshStandardMaterial;
  private readonly pouchMaterial: THREE.MeshStandardMaterial;
  private readonly gemMaterial: THREE.MeshStandardMaterial;
  private currentKind: HeldModelKind | null = null;
  private currentColor = -1;

  constructor() {
    this.propMaterial = createFlatMaterial(0xffffff, { vertexColors: true, roughness: 0.75 });
    this.pouchMaterial = createFlatMaterial(0xffffff, { vertexColors: true });
    this.gemMaterial = createFlatMaterial(0xffffff, { roughness: 0.35, emissiveIntensity: 0.35 });

    const prop = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.visible = false;
      this.socket.add(mesh);
      return mesh;
    };

    this.meshes = {
      hoe: prop(buildHoeGeometry(), this.propMaterial),
      wateringCan: prop(buildWateringCanGeometry(), this.propMaterial),
      pickaxe: prop(buildPickaxeGeometry(), this.propMaterial),
      axe: prop(buildAxeGeometry(), this.propMaterial),
      scythe: prop(buildScytheGeometry(), this.propMaterial),
      zoneMarker: prop(buildZoneMarkerGeometry(), this.propMaterial),
      pouch: prop(buildPouchGeometry(), this.pouchMaterial),
      gem: prop(buildGemGeometry(), this.gemMaterial),
    };
    this.socket.name = 'held-item';
  }

  get kind(): HeldModelKind | null {
    return this.currentKind;
  }

  get color(): number {
    return this.currentColor;
  }

  /** Shows one prop (or none). `color` tints the pouch and gem; tools ignore it. */
  show(kind: HeldModelKind | null, color: number): void {
    if (kind === this.currentKind && color === this.currentColor) return;
    for (const candidate of HELD_MODEL_KINDS) {
      this.meshes[candidate].visible = candidate === kind;
    }
    if (kind === 'pouch') {
      this.pouchMaterial.color.setHex(color);
    } else if (kind === 'gem') {
      this.gemMaterial.color.setHex(color);
      this.gemMaterial.emissive.setHex(color);
    }
    this.currentKind = kind;
    this.currentColor = color;
  }

  dispose(): void {
    this.socket.removeFromParent();
    for (const kind of HELD_MODEL_KINDS) this.meshes[kind].geometry.dispose();
    this.propMaterial.dispose();
    this.pouchMaterial.dispose();
    this.gemMaterial.dispose();
  }
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

export const POSE_KEYS = [
  'hop',
  'crouch',
  'hipsForward',
  'lean',
  'twist',
  'tilt',
  'breath',
  'headPitch',
  'rArmSwing',
  'rArmSpread',
  'rArmYaw',
  'lArmSwing',
  'lArmSpread',
  'lArmYaw',
  'wristPitch',
  'wristTwist',
  'wristRoll',
  'lLegSwing',
  'rLegSwing',
] as const;

export type PoseKey = (typeof POSE_KEYS)[number];

/** A complete set of joint parameters (see the module header for sign conventions). */
export type Pose = Record<PoseKey, number>;

export function createPose(values: Readonly<Partial<Pose>> = {}): Pose {
  const pose = {} as Pose;
  for (const key of POSE_KEYS) pose[key] = values[key] ?? 0;
  return pose;
}

export function copyPose(target: Pose, source: Readonly<Pose>): Pose {
  for (const key of POSE_KEYS) target[key] = source[key];
  return target;
}

/** target = a + (b − a) · t, per joint. `target` may alias `a` or `b`. */
export function blendPose(target: Pose, a: Readonly<Pose>, b: Readonly<Pose>, t: number): Pose {
  for (const key of POSE_KEYS) {
    const from = a[key];
    target[key] = from + (b[key] - from) * t;
  }
  return target;
}

function placeLeg(leg: THREE.Group, x: number, hipsY: number, z: number, swing: number): void {
  leg.position.set(x, hipsY, z);
  leg.rotation.x = -swing;
  // Squash or stretch the leg so the sole stays on the ground at the current hip height.
  const reach = PLAYER_RIG.legLength * Math.cos(swing);
  const scale = reach > 1e-3 ? hipsY / reach : LEG_SCALE_MAX;
  leg.scale.y = Math.min(LEG_SCALE_MAX, Math.max(LEG_SCALE_MIN, scale));
}

/** Writes a pose into the rig's joint transforms. Allocation-free. */
export function applyPose(model: PlayerModel, pose: Readonly<Pose>): void {
  const R = PLAYER_RIG;
  model.body.position.y = pose.hop;

  const hipsY = R.hipHeight - pose.crouch;
  model.hips.position.set(0, hipsY, pose.hipsForward);
  model.hips.rotation.y = pose.twist * HIP_TWIST_SHARE;

  model.torso.rotation.set(pose.lean, pose.twist * (1 - HIP_TWIST_SHARE), pose.tilt);
  const breathe = pose.breath * 0.014;
  model.torso.scale.set(1 - breathe * 0.4, 1 + breathe, 1 - breathe * 0.4);

  model.head.rotation.x = pose.headPitch;

  model.rightArm.rotation.set(-pose.rArmSwing, pose.rArmYaw, -pose.rArmSpread);
  model.leftArm.rotation.set(-pose.lArmSwing, pose.lArmYaw, pose.lArmSpread);
  model.rightWrist.rotation.set(pose.wristPitch, pose.wristTwist, pose.wristRoll);

  placeLeg(model.leftLeg, R.legOffsetX, hipsY, pose.hipsForward, pose.lLegSwing);
  placeLeg(model.rightLeg, -R.legOffsetX, hipsY, pose.hipsForward, pose.rLegSwing);

  // The contact shadow shrinks and fades a little while airborne.
  const lift = Math.max(0, pose.hop);
  model.groundBlob.scale.setScalar(Math.max(0.6, 1 - lift * 3));
  model.blobMaterial.opacity = BLOB_OPACITY * Math.max(0.5, 1 - lift * 4);
}
