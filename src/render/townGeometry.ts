/**
 * Painted geometry for Brookhollow's structures (`MapDefinition.structures`): the four shops, Sol's
 * parts exchange, SLOPMART's booth, the well, the lamp posts, the trimmed hedges of the back band
 * and the low props out on the grass (farmclaws part 4d spec §6.1, §7.1). Every builder
 * works in world space and pushes parts into a {@link PartSet}: painted opaque parts into `body`
 * (StructureRenderer merges them into the map's one painted mesh) and window and lamp glass into
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state. The same
 * dispatch builds the Neighbours map's back band: Cosmo's and Barnaby's houses (the farm's
 * cottage under each farmer's roof colour) and Cosmo's chicken coop, which with the hedges fill
 * that band (z 0–4), so they too can hide only more back band.
 *
 * Shopfronts (farmclaws part 4b spec §7, part 4d spec §5.3, §6.1, §7.2): the parts exchange's
 * display stand, and Juniper's Mini on its stand and her crate, stand in front of the wall in the
 * front inset; the FarmClaw and brand posters hang on the walls, and each shop's OPEN / CLOSED sign
 * hangs beside its door, or on the parts exchange's door itself (doorSignParts, built apart so the
 * renderer can find and flip each one). SLOPMART's booth has DEALZ behind its counter and its
 * neon on the roof. All of it stays inside the building's rect. Poster quads go into the PartSet's
 * `posters` (one atlas mesh per map), and the neon and DEALZ's eyes into its `neon` (one self-lit
 * mesh). The town's bunting and Claw Fair banners (part 4d spec §7.1) hang from its lamp posts.
 *
 * Occlusion: the camera looks from +X/+Z, so a point at height h hides the ground h units further
 * along −X and −Z. Everything stays inside its structure rect: the shops, the booth, the parts
 * exchange and the hedges fill the back band (z 0–6), so all they can hide is more back band,
 * however tall they stand; the well and every prop stay ≤ 0.9 tall and the lamp posts ≤ 0.15
 * wide, as the town layout allows. The bunting and banners hang high and thin between the lamps.
 */
import * as THREE from 'three';
import { NEIGHBOUR_ROOFS, ROBOT_PAINTS } from '../config';
import { assertNever } from '../core/invariant';
import type { GridSpec, StructureKind, TileCoord, TileRect } from '../core/types';
import { SHOP_DOORS, type ShopId } from '../people/shops';
import { WORKSHOP_ROBOTS } from '../robots/workshop';
import { tileCenterX, tileCenterZ, tileMinX, tileMinZ } from '../world/grid';
import type { MapDefinition, StructurePlacement } from '../world/maps';
import { HEIGHTS } from './constants';
import {
  STRUCTURE_COLORS,
  at,
  box,
  createPartSet,
  doorParts,
  gableRoofFrame,
  gableRoofParts,
  gableWallPart,
  glassBox,
  paint,
  pick,
  pose,
  transformParts,
  wallLanternParts,
  windowParts,
  type DoorColors,
  type GableRoofSpec,
  type PartSet,
  type RoofColors,
  type WindowStyle,
} from './geometryParts';
import { PALETTE } from './palette';
import { neonPaint, neonSignQuads, posterAspect, posterQuad, type PosterId } from './posters';
import { SHELL_MESHES, createRobotMeshGeometry } from './robotGeometry';
import { EYE_COLORS, SIZE_SCALE, robotMeshes, type RobotMeshId } from './robotLayout';
import { cosmetic, createFarmhouseGeometry, farmhousePlacement, type CosmeticOffset } from './structureGeometry';

/** Per-feature salts, combined with Salt.Cosmetic (structureGeometry uses 11–61, sceneryGeometry 71–81, chickenLayout 121). */
const FEATURE = { hedge: 91, crate: 101, prop: 111 } as const;

/** World-space bounds of a tile rect. */
interface RectBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function rectBounds(grid: GridSpec, rect: TileRect): RectBounds {
  return {
    minX: tileMinX(grid, rect.x0),
    maxX: tileMinX(grid, rect.x0 + rect.width),
    minZ: tileMinZ(grid, rect.z0),
    maxZ: tileMinZ(grid, rect.z0 + rect.depth),
  };
}

/** Turns a building's local parts `yaw` about +Y, moves them to `origin` and appends them to `out`. */
function placeParts(local: PartSet, origin: THREE.Vector3, out: PartSet, yaw = 0): void {
  const move = new THREE.Matrix4().makeRotationY(yaw).setPosition(origin);
  transformParts(local.body, move, out.body);
  transformParts(local.glass, move, out.glass);
  transformParts(local.posters, move, out.posters);
  transformParts(local.neon, move, out.neon);
}

/** Vertices in `parts`, all of them: where the next part's vertices start once they're merged. */
function vertexCount(parts: readonly THREE.BufferGeometry[]): number {
  return parts.reduce((sum, part) => sum + part.getAttribute('position').count, 0);
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export type ShopKind = Extract<StructureKind, 'generalStore' | 'blacksmith' | 'carpenter' | 'ranch'>;

export const SHOP_KINDS: readonly ShopKind[] = ['generalStore', 'blacksmith', 'carpenter', 'ranch'];

export function isShopKind(kind: StructureKind): kind is ShopKind {
  return (SHOP_KINDS as readonly StructureKind[]).includes(kind);
}

/** What a shop's sign shows (the parts exchange's sign shows the cog and claw). */
export type ShopEmblem = 'sack' | 'anvil' | 'saw' | 'horseshoe' | 'cogClaw';

/** One shop's palette and silhouette (sRGB hex, world units, radians). */
export interface ShopStyle {
  readonly wall: number;
  readonly foundation: number;
  readonly trim: number;
  readonly roof: RoofColors;
  readonly door: DoorColors;
  readonly window: WindowStyle;
  readonly sign: { readonly board: number; readonly frame: number; readonly emblem: number };
  readonly emblem: ShopEmblem;
  readonly wallHeight: number;
  readonly pitch: number;
  /** Flower boxes under the front windows. */
  readonly planters: boolean;
  /** Vertical boards on the walls (timber-clad shops). */
  readonly boards: number | null;
  readonly chimney: boolean;
}

const WINDOW_FRAME = { frameWidth: 0.08, shutterWidth: 0.19 } as const;

/** Four distinct shopfronts: a cream store, a stone smithy, a timber workshop and a red barn. */
export const SHOP_STYLES: Readonly<Record<ShopKind, ShopStyle>> = {
  generalStore: {
    wall: 0xf3e3c3,
    foundation: STRUCTURE_COLORS.stone,
    trim: 0x7f6a55,
    roof: { roof: 0x6fb7a4, shingle: 0x5ea593, ridge: 0x4f9483, barge: 0x7f6a55 },
    door: { trim: 0x7f6a55, door: 0x5e9c8c, doorDark: 0x477e70, awning: 0xe98a7a },
    window: { ...WINDOW_FRAME, trim: 0x7f6a55, shutter: 0xe98a7a, shutterDark: 0xcf7466 },
    sign: { board: 0xfff4d6, frame: 0x7f6a55, emblem: 0xd9a55b },
    emblem: 'sack',
    wallHeight: 2.4,
    pitch: 0.55,
    planters: true,
    boards: null,
    chimney: false,
  },
  blacksmith: {
    wall: 0xc9c2b8,
    foundation: 0xa9a29a,
    trim: 0x5b4a40,
    roof: { roof: 0x7d8aa3, shingle: 0x6d7a92, ridge: 0x5d6982, barge: 0x5b4a40 },
    door: { trim: 0x5b4a40, door: 0x6e5444, doorDark: 0x4e3a30, awning: 0x7d8aa3 },
    window: { ...WINDOW_FRAME, trim: 0x5b4a40, shutter: 0x8e9bb3, shutterDark: 0x77849c },
    sign: { board: 0xe8dccb, frame: 0x5b4a40, emblem: 0x4a4a55 },
    emblem: 'anvil',
    wallHeight: 2.4,
    pitch: 0.46,
    planters: false,
    boards: null,
    chimney: true,
  },
  carpenter: {
    wall: 0xe0b27a,
    foundation: STRUCTURE_COLORS.stone,
    trim: 0x7a5236,
    roof: { roof: 0xd98a4e, shingle: 0xc97a40, ridge: 0xb86c36, barge: 0x7a5236 },
    door: { trim: 0x7a5236, door: 0x9c6b45, doorDark: 0x7a5236, awning: 0xd98a4e },
    window: { ...WINDOW_FRAME, trim: 0x7a5236, shutter: 0x9cc48a, shutterDark: 0x86ae76 },
    sign: { board: 0xf6e3bf, frame: 0x7a5236, emblem: 0x8d8f99 },
    emblem: 'saw',
    wallHeight: 2.4,
    pitch: 0.6,
    planters: true,
    boards: 0xcf9f68,
    chimney: false,
  },
  ranch: {
    wall: 0xc9574a,
    foundation: 0xb9b0a4,
    trim: 0xf4ede0,
    roof: { roof: 0x8a5a44, shingle: 0x7b4d3a, ridge: 0x6b4231, barge: 0xf4ede0 },
    door: { trim: 0xf4ede0, door: 0xa9463b, doorDark: 0x8a3830, awning: 0x8a5a44 },
    window: { ...WINDOW_FRAME, trim: 0xf4ede0, shutter: 0xf4ede0, shutterDark: 0xddd3c2 },
    sign: { board: 0xf4ede0, frame: 0x8a5a44, emblem: 0x9a8f86 },
    emblem: 'horseshoe',
    wallHeight: 2.5,
    pitch: 0.72,
    planters: false,
    boards: 0xb84d41,
    chimney: false,
  },
};

/** Proportions shared by every shop (world units). */
export const SHOP_SHAPE = {
  foundationHeight: 0.17,
  foundationLip: 0.07,
  roofThickness: 0.14,
  /** Keep eaveOverhang ≤ SHOP_INSET.back and gableOverhang + 0.06 ≤ SHOP_INSET.side: the roof stays inside the rect. */
  eaveOverhang: 0.28,
  gableOverhang: 0.22,
  cornerPost: 0.18,
  doorWidth: 0.86,
  doorHeight: 1.4,
  stepDepth: 0.52,
  windowWidth: 0.8,
  windowHeight: 0.72,
  windowCenterHeight: 1.12,
  lanternGap: 0.3,
  signWidth: 1.56,
  signHeight: 0.36,
  chimneyWidth: 0.55,
} as const;

/** Half the width of a shop's shuttered front window, shutters and all. */
const WINDOW_HALF = SHOP_SHAPE.windowWidth / 2 + WINDOW_FRAME.frameWidth + WINDOW_FRAME.shutterWidth + 0.01;
/** Half the width of a door and its frame. */
const DOOR_FRAME_HALF = SHOP_SHAPE.doorWidth / 2 + 0.1;

/**
 * How far a shop's walls sit inside its rect. The front inset holds the door step and the awning
 * (≤ 0.47 past the wall), so nothing reaches the walkable row in front of the door.
 */
export const SHOP_INSET = { side: 0.3, back: 0.3, front: 0.62 } as const;

/** A shop in its own space: origin on the ground at the centre of the wall footprint, door on +Z. */
export interface ShopSpec {
  readonly width: number;
  readonly depth: number;
  /** Door centre along X relative to the footprint centre (clamped between the corner posts). */
  readonly doorOffsetX: number;
}

interface ShopFrame {
  readonly halfW: number;
  readonly halfD: number;
  readonly base: number;
  readonly wallTop: number;
  readonly roof: GableRoofSpec;
  readonly doorX: number;
}

function shopFrame(spec: ShopSpec, style: ShopStyle): ShopFrame {
  const S = SHOP_SHAPE;
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const base = S.foundationHeight;
  const wallTop = base + style.wallHeight;
  const doorLimit = Math.max(0, halfW - S.cornerPost - S.doorWidth / 2 - 0.12);
  return {
    halfW,
    halfD,
    base,
    wallTop,
    roof: {
      halfW,
      halfD,
      wallTop,
      pitch: style.pitch,
      thickness: S.roofThickness,
      eaveOverhang: S.eaveOverhang,
      gableOverhang: S.gableOverhang,
    },
    doorX: THREE.MathUtils.clamp(spec.doorOffsetX, -doorLimit, doorLimit),
  };
}

/**
 * The centre of the front window on `side` of the door (−1 west, +1 east), or null where the wall
 * from the lantern gap out to the corner post is too narrow for one.
 */
function frontWindowX(f: ShopFrame, side: -1 | 1): number | null {
  const S = SHOP_SHAPE;
  const near = f.doorX + side * (DOOR_FRAME_HALF + S.lanternGap);
  const far = side * (f.halfW - S.cornerPost / 2);
  return Math.abs(far - near) < 2 * WINDOW_HALF ? null : (near + far) / 2;
}

/**
 * The middle of the bare front wall on `side` of the door, between the door frame and the front
 * window (or the corner post, where there's no window): where a poster or a door sign hangs.
 */
function besideDoorX(f: ShopFrame, side: -1 | 1): number {
  const window = frontWindowX(f, side);
  const end = window === null ? side * (f.halfW - SHOP_SHAPE.cornerPost / 2) : window - side * WINDOW_HALF;
  return (f.doorX + side * DOOR_FRAME_HALF + end) / 2;
}

/** Foundation, walls, siding, gables, corner posts and trim beams. */
function shopShellParts(f: ShopFrame, style: ShopStyle, out: PartSet): void {
  const S = SHOP_SHAPE;
  const width = f.halfW * 2;
  const depth = f.halfD * 2;
  const wallHeight = f.wallTop - f.base;
  out.body.push(box(width + 2 * S.foundationLip, f.base + 0.05, depth + 2 * S.foundationLip, { y: (f.base - 0.05) / 2 }, style.foundation));
  out.body.push(box(width, wallHeight, depth, { y: f.base + wallHeight / 2 }, style.wall));
  out.body.push(box(width + 0.02, 0.08, depth + 0.02, { y: f.base + 0.04 }, style.trim));
  out.body.push(gableWallPart(f.roof, style.wall));

  if (style.boards !== null) {
    // Lap siding on the two walls the camera sees (+Z front, +X side).
    for (let y = f.base + 0.34; y < f.wallTop - 0.2; y += 0.32) {
      out.body.push(box(width - 0.1, 0.035, 0.02, { y, z: f.halfD + 0.01 }, style.boards));
      out.body.push(box(0.02, 0.035, depth - 0.1, { x: f.halfW + 0.01, y }, style.boards));
    }
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.body.push(box(S.cornerPost, wallHeight, S.cornerPost, { x: sx * f.halfW, y: f.base + wallHeight / 2, z: sz * f.halfD }, style.trim));
    }
  }
  const beamY = f.wallTop - 0.07;
  for (const sz of [-1, 1]) out.body.push(box(width + 0.04, 0.14, 0.07, { y: beamY, z: sz * (f.halfD + 0.035) }, style.trim));
  for (const sx of [-1, 1]) out.body.push(box(0.07, 0.14, depth, { x: sx * (f.halfW + 0.035), y: beamY }, style.trim));
}

/** Brick chimney through the back slope, towards the −X end. */
function shopChimneyParts(f: ShopFrame, out: PartSet): void {
  const S = SHOP_SHAPE;
  const frame = gableRoofFrame(f.roof);
  const cx = -f.halfW + Math.min(1.1, f.halfW * 0.4);
  const cz = -f.halfD * 0.4;
  const bottom = f.wallTop + frame.rise - Math.abs(cz) * frame.slope - 0.05;
  const top = frame.ridgeTop + 0.5;
  const w = S.chimneyWidth;
  out.body.push(box(w, top - bottom, w, { x: cx, y: (top + bottom) / 2, z: cz }, STRUCTURE_COLORS.brick));
  out.body.push(box(w + 0.12, 0.1, w + 0.12, { x: cx, y: top + 0.05, z: cz }, STRUCTURE_COLORS.brickDark));
}

/** The parts exchange's emblem: an eight-toothed cog beside a three-fingered claw (world units, radians). */
const COG_CLAW_SHAPE = {
  /** Centres of the cog and the claw along X, either side of the emblem's centre. */
  cogX: -0.09,
  clawX: 0.1,
  thickness: 0.035,
  cogRadius: 0.07,
  cogTeeth: 8,
  toothSize: 0.04,
  hubRadius: 0.025,
  hubSides: 6,
  clawStemWidth: 0.035,
  clawStemHeight: 0.12,
  clawFingerWidth: 0.03,
  clawFingerLength: 0.1,
  /** How far the outer fingers lean from upright. */
  clawSpread: 0.45,
} as const;

/** The emblem on a shop sign, centred at (x, y) on a face at z, facing +Z. */
function emblemParts(emblem: ShopEmblem, x: number, y: number, z: number, color: number, accent: number, out: PartSet): void {
  switch (emblem) {
    case 'sack':
      out.body.push(paint(pose(new THREE.IcosahedronGeometry(0.12, 0).scale(1, 1.08, 0.3), { x, y: y - 0.02, z }), color));
      out.body.push(box(0.11, 0.035, 0.035, { x, y: y + 0.11, z }, accent));
      out.body.push(paint(pose(new THREE.ConeGeometry(0.06, 0.07, 5).scale(1, 1, 0.4), { x, y: y + 0.155, z }), color));
      return;
    case 'anvil':
      out.body.push(box(0.3, 0.07, 0.035, { x: x + 0.02, y: y + 0.05, z }, color));
      out.body.push(paint(pose(new THREE.ConeGeometry(0.035, 0.12, 4), { x: x - 0.19, y: y + 0.05, z, rz: Math.PI / 2 }), color));
      out.body.push(box(0.1, 0.08, 0.035, { x: x + 0.02, y: y - 0.025, z }, color));
      out.body.push(box(0.24, 0.05, 0.035, { x: x + 0.02, y: y - 0.09, z }, color));
      return;
    case 'saw':
      out.body.push(box(0.34, 0.1, 0.02, { x: x - 0.04, y, z, rz: 0.12 }, color));
      for (let i = 0; i < 5; i++) {
        out.body.push(box(0.035, 0.035, 0.02, { x: x - 0.18 + i * 0.07, y: y - 0.06 + i * 0.008, z, rz: Math.PI / 4 }, color));
      }
      out.body.push(box(0.1, 0.14, 0.03, { x: x + 0.18, y: y + 0.02, z }, accent));
      return;
    case 'horseshoe':
      out.body.push(paint(pose(new THREE.TorusGeometry(0.1, 0.03, 4, 10, Math.PI * 1.5), { x, y, z, rz: -Math.PI / 4 }), color));
      return;
    case 'cogClaw': {
      const C = COG_CLAW_SHAPE;
      const cogX = x + C.cogX;
      const disc = new THREE.CylinderGeometry(C.cogRadius, C.cogRadius, C.thickness, C.cogTeeth * 2);
      out.body.push(paint(pose(disc, { x: cogX, y, z, rx: Math.PI / 2 }), color));
      for (let i = 0; i < C.cogTeeth; i++) {
        const angle = (i / C.cogTeeth) * Math.PI * 2;
        const tooth = { x: cogX + Math.cos(angle) * C.cogRadius, y: y + Math.sin(angle) * C.cogRadius, z, rz: angle };
        out.body.push(box(C.toothSize, C.toothSize, C.thickness, tooth, color));
      }
      const hub = new THREE.CylinderGeometry(C.hubRadius, C.hubRadius, C.thickness, C.hubSides);
      out.body.push(paint(pose(hub, { x: cogX, y, z: z + C.thickness / 2, rx: Math.PI / 2 }), accent));
      const clawX = x + C.clawX;
      const stemY = y - C.clawFingerLength / 2;
      const knuckle = stemY + C.clawStemHeight / 2;
      out.body.push(box(C.clawStemWidth, C.clawStemHeight, C.thickness, { x: clawX, y: stemY, z }, color));
      for (const side of [-1, 0, 1]) {
        const lean = side * C.clawSpread;
        const finger = {
          x: clawX + (Math.sin(lean) * C.clawFingerLength) / 2,
          y: knuckle + (Math.cos(lean) * C.clawFingerLength) / 2,
          z,
          rz: -lean,
        };
        out.body.push(box(C.clawFingerWidth, C.clawFingerLength, C.thickness, finger, color));
      }
      return;
    }
  }
}

/**
 * Framed sign board above the door, standing just in front of the eave edge so the isometric
 * camera sees it over the roofline (on the wall it would sit in the eave's shadow band), held by
 * two iron brackets, with the shop's emblem between two painted "words".
 */
function signParts(f: ShopFrame, style: ShopStyle, out: PartSet): void {
  const S = SHOP_SHAPE;
  const z = f.halfD + S.eaveOverhang + 0.06;
  const y = f.wallTop + S.signHeight / 2 - 0.02;
  const x = f.doorX;
  const w = S.signWidth;
  const h = S.signHeight;
  const sign = style.sign;
  out.body.push(box(w, h, 0.06, { x, y, z }, sign.board));
  for (const sy of [-1, 1]) out.body.push(box(w + 0.1, 0.05, 0.08, { x, y: y + sy * (h / 2 + 0.025), z }, sign.frame));
  for (const sx of [-1, 1]) out.body.push(box(0.05, h, 0.08, { x: x + sx * (w / 2 + 0.025), y, z }, sign.frame));
  for (const sx of [-1, 1]) {
    out.body.push(box(0.04, 0.04, S.eaveOverhang + 0.1, { x: x + sx * w * 0.32, y: y - h / 2 + 0.06, z: z - (S.eaveOverhang + 0.1) / 2 }, STRUCTURE_COLORS.iron));
  }
  for (const sx of [-1, 1]) {
    for (const [dy, length] of [[0.06, 0.4], [-0.06, 0.3]] as const) {
      out.body.push(box(length, 0.045, 0.012, { x: x + sx * (0.25 + length / 2), y: y + dy, z: z + 0.035 }, sign.frame));
    }
  }
  emblemParts(style.emblem, x, y, z + 0.045, sign.emblem, sign.frame, out);
}

/** Ranch hay-loft door on the +X gable: planks with an X brace. */
function loftDoorParts(f: ShopFrame, style: ShopStyle, out: PartSet): void {
  const { rise } = gableRoofFrame(f.roof);
  const y = f.wallTop + rise * 0.3;
  const x = f.halfW;
  out.body.push(box(0.06, 0.82, 0.72, { x: x + 0.03, y, z: 0 }, style.trim));
  out.body.push(box(0.05, 0.7, 0.6, { x: x + 0.05, y, z: 0 }, style.door.door));
  const angle = Math.atan2(0.6, 0.7);
  for (const sign of [-1, 1]) out.body.push(box(0.02, 0.86, 0.06, { x: x + 0.08, y, z: 0, rx: sign * angle }, style.trim));
}

/**
 * A shop in its own space (see {@link ShopSpec}): stone foundation, walls, gabled roof, door with
 * awning and step, a sign above the door, front windows either side where they fit, a wall
 * lantern, a window on the +X wall and one in the +X gable (a loft door on the ranch), and a
 * chimney on the smithy.
 */
export function createShopParts(spec: ShopSpec, style: ShopStyle, out: PartSet): void {
  const S = SHOP_SHAPE;
  const f = shopFrame(spec, style);
  shopShellParts(f, style, out);
  gableRoofParts(f.roof, style.roof, out);
  if (style.chimney) shopChimneyParts(f, out);
  doorParts(
    { x: f.doorX, front: f.halfD, base: f.base, width: S.doorWidth, height: S.doorHeight, stepDepth: S.stepDepth },
    style.door,
    out,
  );
  signParts(f, style, out);

  const postInner = f.halfW - S.cornerPost / 2;
  const windowY = f.base + S.windowCenterHeight;
  const placement = new THREE.Matrix4();
  for (const side of [-1, 1] as const) {
    const windowX = frontWindowX(f, side);
    if (windowX === null) continue;
    const options = { width: S.windowWidth, height: S.windowHeight, shutters: true, planter: style.planters };
    windowParts(options, style.window, placement.makeTranslation(windowX, windowY, f.halfD), out);
  }
  const right = f.doorX + DOOR_FRAME_HALF + S.lanternGap / 2;
  const left = f.doorX - DOOR_FRAME_HALF - S.lanternGap / 2;
  const lanternX = right + 0.08 < postInner ? right : left;
  if (lanternX - 0.08 > -postInner) wallLanternParts(lanternX, f.base + 1.36, f.halfD, out);

  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  if (f.halfD * 2 >= WINDOW_HALF * 2 + S.cornerPost) {
    placement.copy(faceEast).setPosition(f.halfW, windowY, 0);
    windowParts({ width: S.windowWidth, height: S.windowHeight, shutters: true, planter: false }, style.window, placement, out);
  }
  if (style.emblem === 'horseshoe') {
    loftDoorParts(f, style, out);
  } else {
    placement.copy(faceEast).setPosition(f.halfW, f.wallTop + gableRoofFrame(f.roof).rise * 0.36, 0);
    windowParts({ width: 0.46, height: 0.42, shutters: false, planter: false }, style.window, placement, out);
  }
}

/** Wall footprint inside the shop rect, with the door centred on the door tile's column. */
export function shopPlacement(grid: GridSpec, rect: TileRect, door: TileCoord | null): { readonly spec: ShopSpec; readonly origin: THREE.Vector3 } {
  const b = rectBounds(grid, rect);
  const minX = b.minX + SHOP_INSET.side;
  const maxX = b.maxX - SHOP_INSET.side;
  const minZ = b.minZ + SHOP_INSET.back;
  const maxZ = b.maxZ - SHOP_INSET.front;
  const centerX = (minX + maxX) / 2;
  return {
    spec: { width: maxX - minX, depth: maxZ - minZ, doorOffsetX: door === null ? 0 : tileCenterX(grid, door.tx) - centerX },
    origin: new THREE.Vector3(centerX, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}

/**
 * Each shop's door sign side and its brand poster (part 4d spec §5.3, §7.2), which hangs on the
 * door's other side. Juniper's workshop has her own FarmClaw poster (workshopFrontParts).
 */
const SHOP_FRONTS: Readonly<Record<ShopKind, { readonly signSide: -1 | 1; readonly poster: PosterId | null }>> = {
  generalStore: { signSide: 1, poster: 'hollis' },
  blacksmith: { signSide: -1, poster: 'tokenly' },
  carpenter: { signSide: -1, poster: null },
  ranch: { signSide: 1, poster: 'byre' },
};

/** A brand poster beside a shop's door: its height and centre above the floor, as Juniper's. */
const BRAND_POSTER = { height: 0.66, centerHeight: 1 } as const;

function shopParts(grid: GridSpec, offset: CosmeticOffset, kind: ShopKind, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = shopPlacement(grid, s.rect, s.door);
  const style = SHOP_STYLES[kind];
  const f = shopFrame(spec, style);
  const local = createPartSet();
  createShopParts(spec, style, local);
  if (kind === 'carpenter') workshopFrontParts(f, (i, k) => cosmetic(offset, FEATURE.crate, s.rect.x0, i, k), local);
  const front = SHOP_FRONTS[kind];
  if (front.poster !== null) {
    wallPosterParts(front.poster, besideDoorX(f, front.signSide === 1 ? -1 : 1), f.base + BRAND_POSTER.centerHeight, f.halfD, BRAND_POSTER.height, style.trim, local);
  }
  placeParts(local, origin, out);
}

// ---------------------------------------------------------------------------
// Parts exchange
// ---------------------------------------------------------------------------

/** Sol's parts exchange: steel-blue walls, slate trim and a mustard roof, distinct from the four shops. */
export const PARTS_EXCHANGE_STYLE: ShopStyle = {
  wall: 0xaebfcc,
  foundation: 0xa9a29a,
  trim: 0x46505e,
  roof: { roof: 0xd6ad48, shingle: 0xc59c3c, ridge: 0xb08a32, barge: 0x46505e },
  door: { trim: 0x46505e, door: 0x5f7f99, doorDark: 0x4a6680, awning: 0xd6ad48 },
  window: { ...WINDOW_FRAME, trim: 0x46505e, shutter: 0xd6ad48, shutterDark: 0xc0983c },
  sign: { board: 0xf2ead8, frame: 0x46505e, emblem: 0x6f7a86 },
  emblem: 'cogClaw',
  wallHeight: 4,
  pitch: 0.44,
  planters: false,
  boards: null,
  chimney: false,
};

/**
 * The parts exchange's own proportions (world units), on top of SHOP_SHAPE. Its walls stand
 * PARTS_EXCHANGE_STYLE.wallHeight tall: two storeys of `storeyHeight`, split by a trim band.
 */
export const PARTS_EXCHANGE_SHAPE = {
  storeyHeight: 2,
  floorBandHeight: 0.12,
  floorBandDepth: 0.06,
  /** The door frame's width either side of the door (doorParts). */
  doorFrame: 0.1,
  /** The big display window on the door's −X side: wider and taller than a shop window, no shutters. */
  displayWidth: 1,
  displayHeight: 0.96,
  displayCenterHeight: 1,
  lanternHeight: 1.36,
  upperWindowWidth: 0.56,
  upperWindowHeight: 0.62,
  upperWindowCenterHeight: 2.95,
  /** The two upper front windows sit this far either side of the footprint centre. */
  upperWindowSpacing: 0.8,
  /** The +X wall has a window on each storey this far either side of its middle. */
  sideWindowSpacing: 1.4,
  gableWindowWidth: 0.46,
  gableWindowHeight: 0.42,
  /** The gable window's centre above the wall tops, as a share of the gable's rise. */
  gableWindowRise: 0.36,
  /** Half the door step's width past the door: doorParts makes the step doorWidth + 0.52 wide. */
  stepOverhang: 0.26,
  /** The crate stands this far east of the door step and this far out from the wall. */
  crateGap: 0.04,
  crateWallGap: 0.12,
  crateWidth: 0.36,
  crateDepth: 0.34,
  crateHeight: 0.28,
  crateSlat: 0.035,
  /** How far the slats stand proud of the planks; also the thickness of the dark inside. */
  crateSlatProud: 0.008,
  /** The plank rim round the crate's dark inside. */
  crateRim: 0.03,
  /** Spare parts in the crate, laid out two by two: cogs and bolts in turn. */
  crateParts: 4,
  partSize: 0.09,
  partThickness: 0.025,
  /** How far the parts rise above the crate's rim. */
  partHeight: 0.06,
  partJitter: 0.04,
  partTilt: 0.5,
  cogSides: 8,
  /** The FarmClaw posters either side of the door: height (the poster's aspect sets the width) and centre above the floor. */
  posterHeight: 0.4,
  posterCenterHeight: 0.95,
  /** The display stand stands this far west of the door step, and far enough out from the wall that its parts clear the display window's sill. */
  standGap: 0.04,
  standWallGap: 0.18,
  standWidth: 0.6,
  standDepth: 0.3,
  standHeight: 0.3,
  standTop: 0.04,
  /** How far the top board overhangs the stand. */
  standLip: 0.03,
} as const;

/** The parts on the display stand, west to east: a claw, a watering head and a sensor eye, as the robot wears them, scaled up. */
const DISPLAY_STAND_PARTS: readonly (readonly [RobotMeshId, number])[] = [['claw', 2.4], ['spout', 1.5], ['lens', 3]];

const PARTS_EXCHANGE_COLORS = {
  crate: STRUCTURE_COLORS.binPlank,
  crateSlat: PALETTE.binLid,
  crateInside: 0x4a3a30,
  metals: [0xa7b0ba, 0xc98b5a, 0x7d8794] as const,
  stand: PARTS_EXCHANGE_STYLE.trim,
  standTop: PARTS_EXCHANGE_STYLE.roof.roof,
} as const;

/** What sticks out of a crate between its cogs: bolts at the parts exchange, planks at Juniper's. */
type CrateFiller = 'bolt' | 'plank';

/** Posters stand off the wall (clear of lap siding) on a thin board a little bigger than the poster. */
const POSTER_SHAPE = { wallGap: 0.025, board: 0.02, border: 0.02, lift: 0.002 } as const;

/** A poster on a board on the wall face at `front`, centred on (x, y). */
function wallPosterParts(id: PosterId, x: number, y: number, front: number, height: number, board: number, out: PartSet): void {
  const P = POSTER_SHAPE;
  const z = front + P.wallGap;
  out.body.push(box(height * posterAspect(id) + 2 * P.border, height + 2 * P.border, P.board, { x, y, z: z + P.board / 2 }, board));
  out.posters.push(posterQuad(id, height, { x, y, z: z + P.board + P.lift }));
}

/** A robot part off its robot, recentred and scaled, standing on (x, y, z). */
function loosePart(id: RobotMeshId, scale: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const part = createRobotMeshGeometry(id).center();
  const lift = -(part.boundingBox?.min.y ?? 0) * scale;
  // Turned round, so the watering head's spout points out at the street.
  return pose(part.scale(scale, scale, scale), { x, y: y + lift, z, ry: Math.PI });
}

/** The display stand by the door: a slate plinth under a mustard top, with DISPLAY_STAND_PARTS on it. */
function displayStandParts(x: number, front: number, out: PartSet): void {
  const P = PARTS_EXCHANGE_SHAPE;
  const C = PARTS_EXCHANGE_COLORS;
  const z = front + P.standWallGap + P.standDepth / 2;
  out.body.push(box(P.standWidth, P.standHeight, P.standDepth, { x, y: P.standHeight / 2, z }, C.stand));
  const top = P.standHeight + P.standTop;
  out.body.push(box(P.standWidth + 2 * P.standLip, P.standTop, P.standDepth + 2 * P.standLip, { x, y: top - P.standTop / 2, z }, C.standTop));
  const spacing = P.standWidth / DISPLAY_STAND_PARTS.length;
  DISPLAY_STAND_PARTS.forEach(([id, scale], i) => {
    out.body.push(loosePart(id, scale, x + (i - (DISPLAY_STAND_PARTS.length - 1) / 2) * spacing, top, z));
  });
}

/**
 * A crate of spare parts centred on `x` in front of the wall face at `front`: planks with two
 * slats, a dark inside and cogs and bolts (or planks) poking out of it. `unit(i, k)` is a
 * cosmetic [0, 1) value for part i.
 */
function crateParts(x: number, front: number, filler: CrateFiller, unit: (i: number, k: number) => number, out: PartSet): void {
  const P = PARTS_EXCHANGE_SHAPE;
  const C = PARTS_EXCHANGE_COLORS;
  const z = front + P.crateWallGap + P.crateDepth / 2;
  out.body.push(box(P.crateWidth, P.crateHeight, P.crateDepth, { x, y: P.crateHeight / 2, z }, C.crate));
  for (const third of [1, 2]) {
    const slat = { x, y: (third * P.crateHeight) / 3, z };
    out.body.push(box(P.crateWidth + 2 * P.crateSlatProud, P.crateSlat, P.crateDepth + 2 * P.crateSlatProud, slat, C.crateSlat));
  }
  const insideW = P.crateWidth - 2 * P.crateRim;
  const insideD = P.crateDepth - 2 * P.crateRim;
  out.body.push(box(insideW, P.crateSlatProud, insideD, { x, y: P.crateHeight + P.crateSlatProud / 2, z }, C.crateInside));
  for (let i = 0; i < P.crateParts; i++) {
    const px = x + ((i % 2) - 0.5) * (insideW / 2) + (unit(i, 0) - 0.5) * P.partJitter;
    const pz = z + (Math.floor(i / 2) - 0.5) * (insideD / 2) + (unit(i, 1) - 0.5) * P.partJitter;
    const tilt = (unit(i, 2) - 0.5) * P.partTilt;
    const color = pick(C.metals, unit(i, 3));
    if (i % 2 === 0) {
      // A cog standing on edge, half sunk in the pile.
      const r = P.partSize / 2;
      const cog = new THREE.CylinderGeometry(r, r, P.partThickness, P.cogSides);
      out.body.push(paint(pose(cog, { x: px, y: P.crateHeight + P.partHeight - r, z: pz, rx: Math.PI / 2, ry: tilt }), color));
    } else if (filler === 'bolt') {
      out.body.push(box(P.partThickness, 2 * P.partHeight, P.partThickness, { x: px, y: P.crateHeight, z: pz, rz: tilt }, color));
    } else {
      // A plank standing up out of the crate, leaning.
      const W = WORKSHOP_FRONT_SHAPE;
      const plank = { x: px, y: P.crateHeight + W.plankRise - W.plankLength / 2, z: pz, rz: tilt };
      out.body.push(box(W.plankWidth, W.plankLength, W.plankThickness, plank, pick(WORKSHOP_FRONT_COLORS.planks, unit(i, 3))));
    }
  }
}

/**
 * The parts exchange in its own space (see {@link ShopSpec}): a shop's shell and roof two storeys
 * tall with a trim band between them, the door with its awning and step, the cog-and-claw sign
 * above it, a big display window on the door's −X side, a wall lantern and a crate of parts on its
 * +X side, two shuttered windows upstairs, a window on each storey of the +X wall either side of
 * its middle, and one in the +X gable. Its shopfront: a FarmClaw poster either side of the door
 * and a display stand with a claw, a watering head and a sensor eye.
 */
function createPartsExchangeParts(spec: ShopSpec, unit: (i: number, k: number) => number, out: PartSet): void {
  const S = SHOP_SHAPE;
  const P = PARTS_EXCHANGE_SHAPE;
  const style = PARTS_EXCHANGE_STYLE;
  const f = shopFrame(spec, style);
  shopShellParts(f, style, out);
  gableRoofParts(f.roof, style.roof, out);
  doorParts(
    { x: f.doorX, front: f.halfD, base: f.base, width: S.doorWidth, height: S.doorHeight, stepDepth: S.stepDepth },
    style.door,
    out,
  );
  signParts(f, style, out);

  // The trim band between the storeys, on the two walls the camera sees.
  const bandY = f.base + P.storeyHeight;
  const band = P.floorBandDepth;
  out.body.push(box(f.halfW * 2 + 2 * band, P.floorBandHeight, band, { y: bandY, z: f.halfD + band / 2 }, style.trim));
  out.body.push(box(band, P.floorBandHeight, f.halfD * 2 + 2 * band, { x: f.halfW + band / 2, y: bandY }, style.trim));

  // Ground floor: the display window fills the wall between the −X corner post and the door;
  // the lantern and the crate stand on the door's other side.
  const frameHalf = S.doorWidth / 2 + P.doorFrame;
  const postInner = f.halfW - S.cornerPost / 2;
  const placement = new THREE.Matrix4();
  const displayEnd = f.doorX - frameHalf - S.lanternGap;
  const display = { width: P.displayWidth, height: P.displayHeight, shutters: false, planter: false };
  windowParts(display, style.window, placement.makeTranslation((displayEnd - postInner) / 2, f.base + P.displayCenterHeight, f.halfD), out);
  wallLanternParts(f.doorX + frameHalf + S.lanternGap / 2, f.base + P.lanternHeight, f.halfD, out);
  const crateX = Math.min(f.doorX + S.doorWidth / 2 + P.stepOverhang + P.crateGap + P.crateWidth / 2, postInner - P.crateWidth / 2);
  crateParts(crateX, f.halfD, 'bolt', unit, out);

  // The shopfront: a FarmClaw poster either side of the door (between the display window and the
  // door frame, and below the lantern), and the display stand west of the door step.
  const posterY = f.base + P.posterCenterHeight;
  const displayEast = (displayEnd - postInner) / 2 + P.displayWidth / 2 + WINDOW_FRAME.frameWidth;
  wallPosterParts('farmclawFarm', (displayEast + f.doorX - frameHalf) / 2, posterY, f.halfD, P.posterHeight, style.trim, out);
  wallPosterParts('farmclawParts', (f.doorX + frameHalf + postInner) / 2, posterY, f.halfD, P.posterHeight, style.trim, out);
  displayStandParts(f.doorX - S.doorWidth / 2 - P.stepOverhang - P.standGap - P.standWidth / 2, f.halfD, out);

  // Upstairs: two shuttered windows over the shopfront.
  const upper = { width: P.upperWindowWidth, height: P.upperWindowHeight, shutters: true, planter: false };
  for (const sx of [-1, 1]) {
    windowParts(upper, style.window, placement.makeTranslation(sx * P.upperWindowSpacing, f.base + P.upperWindowCenterHeight, f.halfD), out);
  }

  // The +X wall: a window on each storey either side of its middle, and one in the gable.
  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const ground = { width: S.windowWidth, height: S.windowHeight, shutters: true, planter: false };
  for (const sz of [-1, 1]) {
    placement.copy(faceEast).setPosition(f.halfW, f.base + S.windowCenterHeight, sz * P.sideWindowSpacing);
    windowParts(ground, style.window, placement, out);
    placement.copy(faceEast).setPosition(f.halfW, f.base + P.upperWindowCenterHeight, sz * P.sideWindowSpacing);
    windowParts(upper, style.window, placement, out);
  }
  placement.copy(faceEast).setPosition(f.halfW, f.wallTop + gableRoofFrame(f.roof).rise * P.gableWindowRise, 0);
  windowParts({ width: P.gableWindowWidth, height: P.gableWindowHeight, shutters: false, planter: false }, style.window, placement, out);
}

/**
 * The parts exchange, placed in its rect exactly like a shop (the same insets, the door centred on
 * the door tile's column), so it stays inside the rect as the shops do.
 */
function partsExchangeParts(grid: GridSpec, offset: CosmeticOffset, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = shopPlacement(grid, s.rect, s.door);
  const local = createPartSet();
  createPartsExchangeParts(spec, (i, k) => cosmetic(offset, FEATURE.crate, s.rect.x0, i, k), local);
  placeParts(local, origin, out);
}

// ---------------------------------------------------------------------------
// Juniper's workshop front
// ---------------------------------------------------------------------------

/** Juniper's shopfront on the carpenter (world units): the Mini's stand, the poster and the crate's planks. */
export const WORKSHOP_FRONT_SHAPE = {
  /** The Mini's low stand, this far east of the door step and this far out from the wall. */
  standGap: 0.06,
  standWallGap: 0.08,
  standWidth: 0.44,
  standDepth: 0.4,
  standHeight: 0.1,
  /** The poster's height and centre above the floor; it hangs between the door frame and the corner post, below the lantern. */
  posterHeight: 0.66,
  posterCenterHeight: 1,
  /** The crate stands this far from the −X corner post. */
  crateGap: 0.06,
  plankWidth: 0.06,
  plankLength: 0.4,
  plankThickness: 0.018,
  /** How far the planks rise above the crate's rim. */
  plankRise: 0.24,
} as const;

const WORKSHOP_FRONT_COLORS = {
  stand: 0x7a5236,
  planks: [0xe0b27a, 0xcf9f68, 0xd9a35f] as const,
} as const;

/**
 * A ready-made Mini standing still on (x, y, z) facing the street: the robot model's meshes merged
 * and the shells in the factory paint. Juniper's display Mini has its eyes dark (no lights, no
 * sway); DEALZ's are lit, in the neon (part 4d spec §6.1).
 */
function displayRobotParts(x: number, y: number, z: number, eyes: 'off' | 'lit', out: PartSet): void {
  const scale = SIZE_SCALE.mini;
  for (const id of robotMeshes(WORKSHOP_ROBOTS.mini)) {
    const mesh = createRobotMeshGeometry(id);
    const painted = SHELL_MESHES.has(id) ? paint(mesh, ROBOT_PAINTS[0].color) : mesh;
    painted.scale(scale.width, scale.height, scale.width).translate(x, y, z);
    if (id !== 'eyes') out.body.push(painted);
    else if (eyes === 'off') out.body.push(paint(painted, EYE_COLORS.off));
    else out.neon.push(neonPaint(painted, EYE_COLORS.lit));
  }
}

/**
 * Juniper's shopfront, in the carpenter's own space: the Mini on its low stand just east of the
 * door step, the made-to-order poster on the wall beyond the door frame and a crate of planks and
 * cogs by the −X corner post. All of it stays inside the front inset, as the door step does.
 */
function workshopFrontParts(f: ShopFrame, unit: (i: number, k: number) => number, out: PartSet): void {
  const S = SHOP_SHAPE;
  const W = WORKSHOP_FRONT_SHAPE;
  const style = SHOP_STYLES.carpenter;
  const standX = f.doorX + S.doorWidth / 2 + PARTS_EXCHANGE_SHAPE.stepOverhang + W.standGap + W.standWidth / 2;
  const standZ = f.halfD + W.standWallGap + W.standDepth / 2;
  out.body.push(box(W.standWidth, W.standHeight, W.standDepth, { x: standX, y: W.standHeight / 2, z: standZ }, WORKSHOP_FRONT_COLORS.stand));
  displayRobotParts(standX, W.standHeight, standZ, 'off', out);
  const postInner = f.halfW - S.cornerPost / 2;
  wallPosterParts('farmclawOrder', besideDoorX(f, 1), f.base + W.posterCenterHeight, f.halfD, W.posterHeight, style.trim, out);
  crateParts(-postInner + W.crateGap + PARTS_EXCHANGE_SHAPE.crateWidth / 2, f.halfD, 'plank', unit, out);
}

// ---------------------------------------------------------------------------
// Door signs
// ---------------------------------------------------------------------------

/**
 * The shops' hanging door signs (part 4d spec §5.3), world units: the face's height (its cell sets
 * the width), its centre above the floor beside a shop door or on the parts exchange's door, how
 * far in front of the door's wall face the door's own face is, and the string up to the nail.
 */
export const DOOR_SIGN = { height: 0.16, centerHeight: 1, onDoorHeight: 0.78, doorFace: 0.125, string: 0.1 } as const;

const DOOR_SIGN_COLORS = { board: 0x5b4a40, string: 0xd8c7a0 } as const;

/** One shop's sign, built: its shop, and the first of its face's vertices among the posters' (counted in order, as merging lays them out). */
export interface DoorSign {
  readonly shop: ShopId;
  readonly first: number;
}

/** A small sign hanging flat on the face at `front`, centred on (x, y): a board with the OPEN face on it, on a string from a nail. */
function hangingSignParts(x: number, y: number, front: number, out: PartSet): void {
  const D = DOOR_SIGN;
  const width = D.height * posterAspect('OPEN');
  out.body.push(box(width + 0.03, D.height + 0.03, 0.02, { x, y, z: front + 0.01 }, DOOR_SIGN_COLORS.board));
  out.posters.push(posterQuad('OPEN', D.height, { x, y, z: front + 0.022 }));
  const top = y + D.height / 2 + 0.015;
  const reach = width * 0.4;
  for (const side of [-1, 1]) {
    const string = { x: x + (side * reach) / 2, y: top + D.string / 2, z: front + 0.008, rz: -side * Math.atan2(D.string, reach) };
    out.body.push(box(Math.hypot(reach, D.string), 0.012, 0.012, string, DOOR_SIGN_COLORS.string));
  }
  out.body.push(box(0.03, 0.03, 0.03, { x, y: top + D.string, z: front + 0.015 }, STRUCTURE_COLORS.iron));
}

/**
 * A hanging sign at every shop door of `def` (SHOP_DOORS, the town's), reading OPEN as built:
 * beside the door, on SHOP_FRONTS' side, or on the parts exchange's door itself, which has a
 * FarmClaw poster each side. The faces go into `out.posters`; StructureRenderer flips each sign
 * by moving its face's UVs.
 */
export function doorSignParts(def: MapDefinition, out: PartSet): DoorSign[] {
  if (def.id !== 'town') return [];
  const signs: DoorSign[] = [];
  for (const s of def.structures) {
    const shop = SHOP_DOORS.find((d) => s.door !== null && d.door.tx === s.door.tx && d.door.tz === s.door.tz)?.shop;
    if (shop === undefined) continue;
    const { spec, origin } = shopPlacement(def.grid, s.rect, s.door);
    const local = createPartSet();
    if (isShopKind(s.kind)) {
      const f = shopFrame(spec, SHOP_STYLES[s.kind]);
      hangingSignParts(besideDoorX(f, SHOP_FRONTS[s.kind].signSide), f.base + DOOR_SIGN.centerHeight, f.halfD + POSTER_SHAPE.wallGap, local);
    } else {
      const f = shopFrame(spec, PARTS_EXCHANGE_STYLE);
      hangingSignParts(f.doorX, f.base + DOOR_SIGN.onDoorHeight, f.halfD + DOOR_SIGN.doorFace, local);
    }
    signs.push({ shop, first: vertexCount(out.posters) });
    placeParts(local, origin, out);
  }
  return signs;
}

// ---------------------------------------------------------------------------
// Well
// ---------------------------------------------------------------------------

/** Tallest point of the well: it stands in the open square, so it must stay low. */
export const WELL_MAX_HEIGHT = 0.9;

/** Round stone well with a coping, water, a low crank frame and a bucket; ≤ WELL_MAX_HEIGHT tall. */
function wellParts(grid: GridSpec, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const x = (b.minX + b.maxX) / 2;
  const z = (b.minZ + b.maxZ) / 2;
  const stone = STRUCTURE_COLORS.stone;
  out.body.push(paint(pose(new THREE.CylinderGeometry(0.74, 0.78, 0.5, 8), { x, y: 0.25, z, ry: Math.PI / 8 }), stone));
  out.body.push(paint(pose(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 8), { x, y: 0.54, z, ry: Math.PI / 8 }), 0xbfb6aa));
  out.body.push(paint(pose(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 8), { x, y: 0.585, z, ry: Math.PI / 8 }), PALETTE.waterDeep));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const y = i % 2 === 0 ? 0.14 : 0.36;
    out.body.push(box(0.3, 0.13, 0.05, { x: x + Math.sin(angle) * 0.77, y, z: z + Math.cos(angle) * 0.77, ry: angle }, 0xc7beb2));
  }
  const wood = PALETTE.binLid;
  for (const sx of [-1, 1]) out.body.push(box(0.09, 0.86, 0.09, { x: x + sx * 0.86, y: 0.43, z }, wood));
  out.body.push(box(1.84, 0.06, 0.06, { x, y: WELL_MAX_HEIGHT - 0.07, z }, wood));
  out.body.push(box(0.02, 0.1, 0.02, { x, y: 0.78, z }, 0xd8c7a0));
  out.body.push(paint(pose(new THREE.CylinderGeometry(0.11, 0.09, 0.14, 7), { x, y: 0.66, z }), PALETTE.binWood));
}

// ---------------------------------------------------------------------------
// Lamp posts
// ---------------------------------------------------------------------------

/** Lamp posts stand in the open, so the post itself stays ≤ 0.15 tile wide. */
export const LAMP_POST_SHAPE = { postWidth: 0.12, height: 1.9 } as const;

const LAMP_IRON = 0x4a4a55;

/** A slim iron post with a four-sided lantern on top; the lantern glass glows at night. */
function lampPostParts(grid: GridSpec, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const x = (b.minX + b.maxX) / 2;
  const z = (b.minZ + b.maxZ) / 2;
  const L = LAMP_POST_SHAPE;
  out.body.push(box(0.18, 0.1, 0.18, { x, y: 0.05, z }, LAMP_IRON));
  out.body.push(box(L.postWidth, L.height, L.postWidth, { x, y: L.height / 2, z }, LAMP_IRON));
  out.body.push(box(0.24, 0.04, 0.24, { x, y: L.height + 0.02, z }, LAMP_IRON));
  out.glass.push(glassBox(0.18, 0.26, 0.18, { x, y: L.height + 0.17, z }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) out.body.push(box(0.03, 0.26, 0.03, { x: x + sx * 0.1, y: L.height + 0.17, z: z + sz * 0.1 }, LAMP_IRON));
  }
  out.body.push(paint(pose(new THREE.ConeGeometry(0.19, 0.14, 4), { x, y: L.height + 0.37, z, ry: Math.PI / 4 }), LAMP_IRON));
  out.body.push(box(0.04, 0.08, 0.04, { x, y: L.height + 0.48, z }, LAMP_IRON));
}

// ---------------------------------------------------------------------------
// Bunting and banners
// ---------------------------------------------------------------------------

/**
 * The town's bunting (part 4d spec §7.1), each string between two lamp posts: round the square,
 * and from its south corners out along the main street to the street's two posts.
 */
export const BUNTING: readonly (readonly [TileCoord, TileCoord])[] = [
  [{ tx: 13, tz: 8 }, { tx: 26, tz: 8 }],
  [{ tx: 26, tz: 8 }, { tx: 26, tz: 20 }],
  [{ tx: 26, tz: 20 }, { tx: 13, tz: 20 }],
  [{ tx: 13, tz: 20 }, { tx: 13, tz: 8 }],
  [{ tx: 4, tz: 14 }, { tx: 13, tz: 20 }],
  [{ tx: 26, tz: 20 }, { tx: 36, tz: 14 }],
];

/** The two Claw Fair banners (spec §7.2), hung over the main street's middle row from the square's west and east strings. */
export const CLAW_FAIR_BANNERS: readonly TileCoord[] = [
  { tx: 13, tz: 16 },
  { tx: 26, tz: 16 },
];

/**
 * Bunting and banner proportions (world units): the strings run from just under the lamps' caps
 * and sag in the middle; a pennant every `spacing`; the banners hang under their strings, high
 * over the street's walkers.
 */
export const BUNTING_SHAPE = { top: LAMP_POST_SHAPE.height + 0.3, sag: 0.25, segments: 8, rope: 0.018, spacing: 0.45, flag: 0.07, flagLength: 0.15, bannerHeight: 0.34 } as const;

const BUNTING_COLORS = { rope: 0xe8dcc4, flags: [0xe2563f, 0xf2c14e, 0x5fa8d3, 0x78c06b, 0xf3ead8] as const, bannerBack: 0xa8433b } as const;

/** Height of a string `t` of the way along it (0–1): a parabola sagging `sag` at the middle. */
function buntingY(t: number): number {
  return BUNTING_SHAPE.top - BUNTING_SHAPE.sag * 4 * t * (1 - t);
}

/** The point `t` of the way along the string from `a` to `b`, in world space. */
function buntingPoint(grid: GridSpec, a: TileCoord, b: TileCoord, t: number): THREE.Vector3 {
  const x = tileCenterX(grid, a.tx) + (tileCenterX(grid, b.tx) - tileCenterX(grid, a.tx)) * t;
  const z = tileCenterZ(grid, a.tz) + (tileCenterZ(grid, b.tz) - tileCenterZ(grid, a.tz)) * t;
  return new THREE.Vector3(x, buntingY(t), z);
}

/** Every bunting string with its pennants, skipping the stretch a banner hangs from, and the two banners. */
function festivalParts(grid: GridSpec, out: PartSet): void {
  const F = BUNTING_SHAPE;
  const bannerWidth = F.bannerHeight * posterAspect('clawFair');
  const banners = CLAW_FAIR_BANNERS.map((tile) => ({ x: tileCenterX(grid, tile.tx), z: tileCenterZ(grid, tile.tz) }));
  let flag = 0;
  for (const [a, b] of BUNTING) {
    for (let i = 0; i < F.segments; i++) {
      const p0 = buntingPoint(grid, a, b, i / F.segments);
      const p1 = buntingPoint(grid, a, b, (i + 1) / F.segments);
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const along = Math.hypot(dx, dz);
      const rope = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2, rx: -Math.atan2(p1.y - p0.y, along), ry: Math.atan2(dx, dz) };
      out.body.push(box(F.rope, F.rope, p0.distanceTo(p1), rope, BUNTING_COLORS.rope));
    }
    const length = buntingPoint(grid, a, b, 0).distanceTo(buntingPoint(grid, a, b, 1));
    const count = Math.floor(length / F.spacing);
    for (let k = 1; k < count; k++) {
      const p = buntingPoint(grid, a, b, k / count);
      if (banners.some((banner) => Math.abs(banner.x - p.x) < 0.1 && Math.abs(banner.z - p.z) < bannerWidth / 2 + F.spacing / 2)) continue;
      // A three-sided pennant hanging point down, each turned a little differently, in the colours in turn.
      const pennant = pose(new THREE.ConeGeometry(F.flag, F.flagLength, 3), { x: p.x, y: p.y - F.flagLength / 2, z: p.z, rx: Math.PI, ry: flag });
      out.body.push(paint(pennant, at(BUNTING_COLORS.flags, flag % BUNTING_COLORS.flags.length)));
      flag += 1;
    }
  }
  for (const tile of CLAW_FAIR_BANNERS) {
    const string = BUNTING.find(([from, to]) => from.tx === tile.tx && to.tx === tile.tx);
    if (string === undefined) throw new RangeError(`townGeometry: no bunting string runs over the banner at (${tile.tx}, ${tile.tz})`);
    const [from, to] = string;
    // The cloth hangs just under the string, its printed face to +X, where the camera sees it.
    const middle = { x: tileCenterX(grid, tile.tx), y: buntingY((tile.tz - from.tz) / (to.tz - from.tz)) - F.bannerHeight / 2 - 0.02, z: tileCenterZ(grid, tile.tz) };
    out.body.push(box(0.012, F.bannerHeight, bannerWidth, middle, BUNTING_COLORS.bannerBack));
    out.posters.push(posterQuad('clawFair', F.bannerHeight, { ...middle, x: middle.x + 0.008, ry: Math.PI / 2 }));
  }
}

// ---------------------------------------------------------------------------
// Hedges
// ---------------------------------------------------------------------------

/** Clipped hedge blocks filling the back band between the shops. */
export const HEDGE_SHAPE = { inset: 0.06, height: 0.95, capHeight: 0.18, bump: 0.27 } as const;

const HEDGE_GREENS = [0x5c9e5a, 0x66a860, 0x579455, 0x6bae62] as const;

/** A trimmed box hedge over the whole rect with a softer cap and one leafy mound per tile on top. */
function hedgeParts(grid: GridSpec, offset: CosmeticOffset, s: StructurePlacement, out: PartSet): void {
  const H = HEDGE_SHAPE;
  const b = rectBounds(grid, s.rect);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX - 2 * H.inset;
  const d = b.maxZ - b.minZ - 2 * H.inset;
  out.body.push(box(w, H.height, d, { x: cx, y: H.height / 2, z: cz }, 0x578f55));
  out.body.push(box(w - 0.12, H.capHeight, d - 0.12, { x: cx, y: H.height + H.capHeight / 2, z: cz }, 0x64a35f));
  const unit = grid.tileSize;
  for (let tz = s.rect.z0; tz < s.rect.z0 + s.rect.depth; tz++) {
    for (let tx = s.rect.x0; tx < s.rect.x0 + s.rect.width; tx++) {
      const u = cosmetic(offset, FEATURE.hedge, tx, tz, 0);
      const v = cosmetic(offset, FEATURE.hedge, tx, tz, 1);
      const size = H.bump * unit * (0.85 + 0.3 * cosmetic(offset, FEATURE.hedge, tx, tz, 2));
      const x = tileCenterX(grid, tx) + (u - 0.5) * 0.2 * unit;
      const z = tileMinZ(grid, tz) + (0.5 + (v - 0.5) * 0.2) * unit;
      const color = pick(HEDGE_GREENS, cosmetic(offset, FEATURE.hedge, tx, tz, 3));
      out.body.push(paint(pose(new THREE.IcosahedronGeometry(size, 0).scale(1, 0.62, 1), { x, y: H.height + H.capHeight * 0.6, z, ry: u * 3 }), color));
    }
  }
}

// ---------------------------------------------------------------------------
// The Neighbours: two farmhouses and a chicken coop
// ---------------------------------------------------------------------------

type NeighbourHouseKind = Extract<StructureKind, 'cosmoHouse' | 'barnabyHouse'>;

/**
 * A neighbour's farmhouse: the farm's cottage, placed in its rect exactly as the farmhouse is in
 * the farm's (same insets, so the same scale), door on the door tile, under the farmer's roof
 * colour. Its chimney stays smokeless; the smoke belongs to the farm's farmstead.
 */
function neighbourHouseParts(grid: GridSpec, kind: NeighbourHouseKind, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = farmhousePlacement(grid, s.rect, s.door);
  const house = createFarmhouseGeometry({ ...spec, roofColor: NEIGHBOUR_ROOFS[kind] });
  out.body.push(house.body.translate(origin.x, origin.y, origin.z));
  out.glass.push(house.glass.translate(origin.x, origin.y, origin.z));
}

/** Proportions of the chicken coop, a plank shed on legs (world units, radians). */
export const COOP_SHAPE = {
  legHeight: 0.34,
  legWidth: 0.14,
  floorThickness: 0.1,
  wallHeight: 1.3,
  pitch: 0.62,
  roofThickness: 0.12,
  /** Keep eaveOverhang ≤ COOP_INSET.back and gableOverhang + 0.06 ≤ COOP_INSET.side: the roof stays inside the rect. */
  eaveOverhang: 0.26,
  gableOverhang: 0.2,
  cornerPost: 0.12,
  /** Gap between the vertical boards on the walls the camera sees. */
  boardSpacing: 0.3,
  /** The hens' door: centre along X from the footprint centre, size, at floor level. */
  henDoorX: 0.6,
  henDoorWidth: 0.36,
  henDoorHeight: 0.42,
  /** How far the hens' ramp reaches in front of the wall; it stays inside COOP_INSET.front. */
  rampRun: 0.6,
  rampWidth: 0.32,
  /** A small square window on the front, left of the hens' door; its centre is above the floor top. */
  windowX: -0.6,
  windowSize: 0.42,
  windowCenterHeight: 0.85,
  /** The nest box on the +X wall: length along Z, height, how far it stands out, centre above the floor top. */
  nestLength: 1.1,
  nestHeight: 0.5,
  nestDepth: 0.26,
  nestCenterHeight: 0.45,
  /** Downward tilt of the nest box's lid (radians). */
  nestLidTilt: 0.3,
} as const;

/** How far the coop's walls sit inside its rect. The front inset holds the ramp; the others the roof overhang and the nest box. */
export const COOP_INSET = { side: 0.35, back: 0.35, front: 0.75 } as const;

const COOP_COLORS = {
  wall: 0xd8b07e,
  boards: 0xc49a68,
  trim: 0x8a5f3e,
  legs: 0x7a5236,
  floor: 0x9c6b45,
  roof: { roof: 0x9b6a4e, shingle: 0x8a5c42, ridge: 0x7a5038, barge: 0x8a5f3e } satisfies RoofColors,
  opening: 0x4a3426,
  ramp: 0xb88a5a,
} as const;

const COOP_WINDOW: WindowStyle = {
  ...WINDOW_FRAME,
  trim: COOP_COLORS.trim,
  shutter: COOP_COLORS.trim,
  shutterDark: COOP_COLORS.trim,
};

/** The coop in its own space: origin on the ground at the centre of the wall footprint, front on +Z. */
export interface CoopSpec {
  readonly width: number;
  readonly depth: number;
}

/**
 * A plain wooden coop: a plank shed raised on four legs under a gabled roof, with vertical boards
 * on the two walls the camera sees, a small window, the hens' door with a cleated ramp down to the
 * ground, a nest box with a sloped lid on the +X wall and a vent in the +X gable.
 */
export function createCoopParts(spec: CoopSpec, out: PartSet): void {
  const C = COOP_SHAPE;
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const floorTop = C.legHeight + C.floorThickness;
  const wallTop = floorTop + C.wallHeight;
  const wallMid = floorTop + C.wallHeight / 2;
  const roof: GableRoofSpec = {
    halfW,
    halfD,
    wallTop,
    pitch: C.pitch,
    thickness: C.roofThickness,
    eaveOverhang: C.eaveOverhang,
    gableOverhang: C.gableOverhang,
  };

  // Legs and the floor the shed stands on.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = { x: sx * (halfW - C.legWidth / 2), y: C.legHeight / 2, z: sz * (halfD - C.legWidth / 2) };
      out.body.push(box(C.legWidth, C.legHeight, C.legWidth, leg, COOP_COLORS.legs));
    }
  }
  const floor = { y: C.legHeight + C.floorThickness / 2 };
  out.body.push(box(spec.width + 0.06, C.floorThickness, spec.depth + 0.06, floor, COOP_COLORS.floor));

  // Walls, gables, boards, corner posts and the roof.
  out.body.push(box(spec.width, C.wallHeight, spec.depth, { y: wallMid }, COOP_COLORS.wall));
  out.body.push(gableWallPart(roof, COOP_COLORS.wall));
  for (let x = -halfW + C.boardSpacing; x < halfW - C.boardSpacing / 2; x += C.boardSpacing) {
    out.body.push(box(0.035, C.wallHeight - 0.1, 0.02, { x, y: wallMid, z: halfD + 0.01 }, COOP_COLORS.boards));
  }
  for (let z = -halfD + C.boardSpacing; z < halfD - C.boardSpacing / 2; z += C.boardSpacing) {
    out.body.push(box(0.02, C.wallHeight - 0.1, 0.035, { x: halfW + 0.01, y: wallMid, z }, COOP_COLORS.boards));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.body.push(box(C.cornerPost, C.wallHeight, C.cornerPost, { x: sx * halfW, y: wallMid, z: sz * halfD }, COOP_COLORS.trim));
    }
  }
  gableRoofParts(roof, COOP_COLORS.roof, out);

  // The hens' door: a dark opening in a plank frame at floor level.
  const henY = floorTop + C.henDoorHeight / 2;
  const henFrame = { x: C.henDoorX, y: henY + 0.03, z: halfD + 0.025 };
  out.body.push(box(C.henDoorWidth + 0.12, C.henDoorHeight + 0.06, 0.05, henFrame, COOP_COLORS.trim));
  out.body.push(box(C.henDoorWidth, C.henDoorHeight, 0.05, { x: C.henDoorX, y: henY, z: halfD + 0.035 }, COOP_COLORS.opening));

  // The ramp runs from the door's sill down to the ground, with cleats for little feet.
  const angle = Math.atan2(floorTop, C.rampRun);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ramp = { x: C.henDoorX, y: floorTop / 2, z: halfD + C.rampRun / 2, rx: angle };
  out.body.push(box(C.rampWidth, 0.04, Math.hypot(floorTop, C.rampRun), ramp, COOP_COLORS.ramp));
  for (const t of [0.25, 0.5, 0.75]) {
    const cleat = { x: C.henDoorX, y: floorTop * (1 - t) + 0.035 * cos, z: halfD + C.rampRun * t + 0.035 * sin, rx: angle };
    out.body.push(box(C.rampWidth - 0.04, 0.03, 0.04, cleat, COOP_COLORS.trim));
  }

  const windowAt = new THREE.Matrix4().makeTranslation(C.windowX, floorTop + C.windowCenterHeight, halfD);
  windowParts({ width: C.windowSize, height: C.windowSize, shutters: false, planter: false }, COOP_WINDOW, windowAt, out);

  // Nest box on the +X wall under a lid that slopes away from the wall.
  const nestX = halfW + C.nestDepth / 2;
  const nestY = floorTop + C.nestCenterHeight;
  out.body.push(box(C.nestDepth, C.nestHeight, C.nestLength, { x: nestX, y: nestY, z: 0 }, COOP_COLORS.wall));
  out.body.push(box(C.nestDepth, 0.06, C.nestLength + 0.04, { x: nestX, y: nestY - C.nestHeight / 2 + 0.03, z: 0 }, COOP_COLORS.trim));
  const lid = { x: nestX + 0.01, y: nestY + C.nestHeight / 2 + 0.04, z: 0, rz: -C.nestLidTilt };
  out.body.push(box(C.nestDepth + 0.04, 0.05, C.nestLength + 0.08, lid, COOP_COLORS.roof.roof));

  // A diamond vent high in the +X gable.
  const vent = { x: halfW + 0.02, y: wallTop + gableRoofFrame(roof).rise * 0.4, rx: Math.PI / 4 };
  out.body.push(box(0.04, 0.22, 0.22, vent, COOP_COLORS.opening));
}

/** The coop's wall footprint inside its rect; it has no door tile (the hens' door is part of the shed). */
function coopParts(grid: GridSpec, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const minX = b.minX + COOP_INSET.side;
  const maxX = b.maxX - COOP_INSET.side;
  const minZ = b.minZ + COOP_INSET.back;
  const maxZ = b.maxZ - COOP_INSET.front;
  const local = createPartSet();
  createCoopParts({ width: maxX - minX, depth: maxZ - minZ }, local);
  placeParts(local, new THREE.Vector3((minX + maxX) / 2, HEIGHTS.grassTop, (minZ + maxZ) / 2), out);
}

// ---------------------------------------------------------------------------
// SLOPMART's booth
// ---------------------------------------------------------------------------

/**
 * SLOPMART's booth (part 4d spec §6.1, §7.2), world units: a narrow, cramped kiosk on the front
 * rows of its rect with the hedge it replaced still filling the rows behind it. Its serving hatch
 * is cut back into the front wall above the counter, at the door tile, and DEALZ stands in it.
 * The neon sign stands on the roof's front edge, and Sprocket Cereal's poster hangs on the +X
 * side wall by the front corner, where the camera sees past the ranch.
 */
export const SLOP_BOOTH_SHAPE = {
  /** The booth stands on this many front rows of its rect; the hedge fills the rest. */
  rows: 3,
  /** How far the walls sit inside the booth's rows. The front inset is the shops' (SHOP_INSET), so the counter stays inside the rect. */
  inset: { side: 0.32, back: 0.12, front: SHOP_INSET.front },
  plinthHeight: 0.12,
  wallHeight: 1.85,
  /** A band of trim round the top of the walls. */
  bandHeight: 0.14,
  roofThickness: 0.12,
  roofOverhang: 0.1,
  /** The serving hatch above the counter: width, height, its sill above the ground, and how deep it's cut into the wall. */
  hatchWidth: 1.2,
  hatchHeight: 0.72,
  counterHeight: 0.86,
  hatchDepth: 0.42,
  counterThickness: 0.07,
  /** How far the counter reaches out of the front wall. */
  counterReach: 0.3,
  /** The roller shutter, rolled up above the hatch. */
  shutterHeight: 0.12,
  /** The neon: its width (its cell sets the height), how far back from the front wall it stands, on posts this tall, before a board this thick. */
  neonWidth: 2.2,
  neonInset: 0.18,
  neonLift: 0.08,
  neonBoard: 0.06,
  /** Sprocket Cereal's poster: height, centre above the ground, and its gap from the front corner. */
  posterHeight: 0.5,
  posterCenterHeight: 1.15,
  posterCornerGap: 0.06,
} as const;

const SLOP_BOOTH_COLORS = {
  wall: 0x8f7cc4,
  band: 0xf0e6f5,
  plinth: 0x5f527c,
  roof: 0x4f4368,
  hatch: 0x2a2236,
  counter: 0xe9dcc4,
  bracket: 0x5f527c,
  shutter: 0xb9b0c8,
  neonFrame: 0x3a3048,
} as const;

/** The booth on its front rows, and a hedge on the rows behind it. */
function slopBoothParts(grid: GridSpec, offset: CosmeticOffset, s: StructurePlacement, out: PartSet): void {
  const B = SLOP_BOOTH_SHAPE;
  const C = SLOP_BOOTH_COLORS;
  const hedgeDepth = s.rect.depth - B.rows;
  hedgeParts(grid, offset, { kind: 'hedge', rect: { ...s.rect, depth: hedgeDepth }, door: null }, out);
  const b = rectBounds(grid, s.rect);
  const minX = b.minX + B.inset.side;
  const maxX = b.maxX - B.inset.side;
  const minZ = tileMinZ(grid, s.rect.z0 + hedgeDepth) + B.inset.back;
  const front = b.maxZ - B.inset.front;
  const w = maxX - minX;
  const d = front - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + front) / 2;
  const top = B.plinthHeight + B.wallHeight;
  out.body.push(box(w + 0.08, B.plinthHeight, d + 0.08, { x: cx, y: B.plinthHeight / 2, z: cz }, C.plinth));
  // The walls, with the hatch cut back into the front wall over the counter, centred on the door tile.
  const hatchX = s.door === null ? cx : tileCenterX(grid, s.door.tx);
  const hatchTop = B.counterHeight + B.hatchHeight;
  const hatchBack = front - B.hatchDepth;
  const frontZ = front - B.hatchDepth / 2;
  out.body.push(box(w, B.wallHeight, hatchBack - minZ, { x: cx, y: B.plinthHeight + B.wallHeight / 2, z: (minZ + hatchBack) / 2 }, C.wall));
  out.body.push(box(w, B.counterHeight - B.plinthHeight, B.hatchDepth, { x: cx, y: (B.plinthHeight + B.counterHeight) / 2, z: frontZ }, C.wall));
  out.body.push(box(w, top - hatchTop, B.hatchDepth, { x: cx, y: (hatchTop + top) / 2, z: frontZ }, C.wall));
  for (const [edge, end] of [[hatchX - B.hatchWidth / 2, minX], [hatchX + B.hatchWidth / 2, maxX]] as const) {
    out.body.push(box(Math.abs(end - edge), B.hatchHeight, B.hatchDepth, { x: (edge + end) / 2, y: B.counterHeight + B.hatchHeight / 2, z: frontZ }, C.wall));
  }
  out.body.push(box(B.hatchWidth, B.hatchHeight, 0.02, { x: hatchX, y: B.counterHeight + B.hatchHeight / 2, z: hatchBack + 0.01 }, C.hatch));
  out.body.push(box(w + 0.04, B.bandHeight, d + 0.04, { x: cx, y: top - B.bandHeight / 2, z: cz }, C.band));
  const roofTop = top + B.roofThickness;
  out.body.push(box(w + 2 * B.roofOverhang, B.roofThickness, d + 2 * B.roofOverhang, { x: cx, y: top + B.roofThickness / 2, z: cz }, C.roof));
  const shutterY = hatchTop + B.shutterHeight / 2;
  out.body.push(box(B.hatchWidth + 0.1, B.shutterHeight, 0.1, { x: hatchX, y: shutterY, z: front + 0.04 }, C.shutter));
  const counterZ = front + B.counterReach / 2 - 0.02;
  out.body.push(box(B.hatchWidth + 0.16, B.counterThickness, B.counterReach, { x: hatchX, y: B.counterHeight, z: counterZ }, C.counter));
  for (const side of [-1, 1]) {
    const bracket = { x: hatchX + side * (B.hatchWidth / 2 - 0.08), y: B.counterHeight - 0.12, z: front + 0.08 };
    out.body.push(box(0.05, 0.18, 0.14, bracket, C.bracket));
  }

  // DEALZ, a Mini in the factory paint, on the hatch's floor behind the counter, eyes lit.
  displayRobotParts(hatchX, B.counterHeight, frontZ, 'lit', out);

  // The neon on the roof's front edge: a dark board on two posts, the lit letters on its face.
  const neonZ = front - B.neonInset;
  const neonBottom = roofTop + B.neonLift;
  const neonHeight = B.neonWidth / posterAspect('neon');
  out.body.push(box(B.neonWidth + 0.08, neonHeight + 0.08, B.neonBoard, { x: cx, y: neonBottom + neonHeight / 2, z: neonZ }, C.neonFrame));
  for (const side of [-1, 1]) out.body.push(box(0.06, B.neonLift, 0.06, { x: cx + side * B.neonWidth * 0.35, y: roofTop + B.neonLift / 2, z: neonZ }, C.neonFrame));
  out.neon.push(...neonSignQuads(B.neonWidth, { x: cx, y: neonBottom, z: neonZ + B.neonBoard / 2 + 0.003 }));

  // Sprocket Cereal on the +X side wall: built facing +Z, then turned to face +X.
  const side = createPartSet();
  wallPosterParts('sprocket', 0, B.posterCenterHeight, 0, B.posterHeight, C.band, side);
  const posterZ = front - B.posterCornerGap - (B.posterHeight * posterAspect('sprocket')) / 2;
  placeParts(side, new THREE.Vector3(maxX, 0, posterZ), out, Math.PI / 2);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** How far every prop stays inside its rect. */
const PROP_INSET = 0.08;

const PROP_COLORS = {
  wood: 0xb5835a,
  woodDark: 0x8a5f3e,
  iron: LAMP_IRON,
  awning: [0xd9574a, 0xf3ead8] as const,
  cloth: 0xe8d6b0,
  produce: [0xe2563f, 0xf28a3a, 0xf2c14e, 0x78c06b, 0x8e5ba8] as const,
  stone: STRUCTURE_COLORS.stone,
  soil: 0x6b4a32,
  leaf: STRUCTURE_COLORS.leaf,
  blossom: [0xf4b38a, 0xe87fa3, 0xf3ead8] as const,
  sack: 0xd8c39a,
} as const;

/** A prop's footprint: its rect less PROP_INSET all round, in world space. */
interface PropFrame {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  /** A cosmetic [0, 1) value for part i of this prop. */
  readonly unit: (i: number, k: number) => number;
}

function propFrame(grid: GridSpec, offset: CosmeticOffset, s: StructurePlacement): PropFrame {
  const b = rectBounds(grid, s.rect);
  const minX = b.minX + PROP_INSET;
  const maxX = b.maxX - PROP_INSET;
  const minZ = b.minZ + PROP_INSET;
  const maxZ = b.maxZ - PROP_INSET;
  const unit = (i: number, k: number): number => cosmetic(offset, FEATURE.prop, s.rect.x0 * 8 + i, s.rect.z0, k);
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, unit };
}

/** A few pieces of produce heaped on a surface at height y around (x, z). */
function produceParts(x: number, y: number, z: number, spread: number, unit: (i: number, k: number) => number, first: number, out: PartSet): void {
  for (let i = first; i < first + 4; i++) {
    const px = x + ((i % 2) - 0.5) * spread + (unit(i, 0) - 0.5) * 0.04;
    const pz = z + (Math.floor((i - first) / 2) - 0.5) * spread * 0.8;
    const color = pick(PROP_COLORS.produce, unit(i, 1));
    out.body.push(paint(pose(new THREE.IcosahedronGeometry(0.055, 0), { x: px, y: y + 0.045, z: pz, ry: unit(i, 2) * 3 }), color));
  }
}

/** Market stall proportions: a table under a striped awning on four posts, crates of produce on display. */
export const MARKET_STALL_SHAPE = { tableHeight: 0.42, tableTop: 0.05, leg: 0.06, post: 0.045, awningTop: 0.88, awningThickness: 0.04, stripes: 6, crates: 3, crateHeight: 0.12 } as const;

function marketStallParts(f: PropFrame, out: PartSet): void {
  const M = MARKET_STALL_SHAPE;
  const C = PROP_COLORS;
  out.body.push(box(f.w, M.tableTop, f.d * 0.8, { x: f.cx, y: M.tableHeight - M.tableTop / 2, z: f.cz }, C.wood));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = { x: f.cx + sx * (f.w / 2 - M.leg), y: (M.tableHeight - M.tableTop) / 2, z: f.cz + sz * (f.d * 0.4 - M.leg) };
      out.body.push(box(M.leg, M.tableHeight - M.tableTop, M.leg, leg, C.woodDark));
      const postHeight = M.awningTop - M.awningThickness - M.tableHeight;
      const post = { x: f.cx + sx * (f.w / 2 - M.post / 2), y: M.tableHeight + postHeight / 2, z: f.cz + sz * (f.d / 2 - M.post / 2) };
      out.body.push(box(M.post, postHeight, M.post, post, C.woodDark));
    }
  }
  // A cloth skirt along the front of the table.
  out.body.push(box(f.w - 0.04, 0.22, 0.02, { x: f.cx, y: M.tableHeight - M.tableTop - 0.11, z: f.cz + f.d * 0.4 }, C.cloth));
  const crateW = (f.w - 0.12) / M.crates;
  for (let i = 0; i < M.crates; i++) {
    const x = f.minX + 0.06 + crateW * (i + 0.5);
    out.body.push(box(crateW - 0.06, M.crateHeight, f.d * 0.55, { x, y: M.tableHeight + M.crateHeight / 2, z: f.cz }, C.woodDark));
    produceParts(x, M.tableHeight + M.crateHeight - 0.03, f.cz, crateW * 0.4, f.unit, i * 4, out);
  }
  const stripeW = f.w / M.stripes;
  for (let i = 0; i < M.stripes; i++) {
    const stripe = { x: f.minX + stripeW * (i + 0.5), y: M.awningTop - M.awningThickness / 2, z: f.cz };
    out.body.push(box(stripeW, M.awningThickness, f.d, stripe, C.awning[i % 2] ?? C.cloth));
  }
}

/** Bench proportions: slatted seat on iron legs with a back on its −Z side. */
export const BENCH_SHAPE = { seatHeight: 0.32, slats: 3, slatGap: 0.03, backTop: 0.64, seatDepth: 0.42 } as const;

function benchParts(f: PropFrame, out: PartSet): void {
  const B = BENCH_SHAPE;
  const C = PROP_COLORS;
  const seatZ = f.cz + 0.04;
  const slatD = (B.seatDepth - (B.slats - 1) * B.slatGap) / B.slats;
  for (let i = 0; i < B.slats; i++) {
    const z = seatZ - B.seatDepth / 2 + slatD / 2 + i * (slatD + B.slatGap);
    out.body.push(box(f.w - 0.1, 0.04, slatD, { x: f.cx, y: B.seatHeight, z }, C.wood));
  }
  const backZ = seatZ - B.seatDepth / 2 + 0.02;
  for (const y of [B.seatHeight + 0.14, B.backTop - 0.06]) out.body.push(box(f.w - 0.1, 0.08, 0.035, { x: f.cx, y, z: backZ }, C.wood));
  for (const sx of [-1, 1]) {
    const x = f.cx + sx * (f.w / 2 - 0.16);
    out.body.push(box(0.05, B.seatHeight, 0.05, { x, y: B.seatHeight / 2, z: seatZ + B.seatDepth / 2 - 0.06 }, C.iron));
    out.body.push(box(0.05, B.backTop, 0.05, { x, y: B.backTop / 2, z: backZ - 0.01 }, C.iron));
    out.body.push(box(0.04, 0.04, B.seatDepth, { x, y: B.seatHeight - 0.04, z: seatZ }, C.iron));
  }
}

/** Planter proportions: a stone box of soil with a round shrub and a few flowers. */
export const PLANTER_SHAPE = { size: 0.72, height: 0.34, shrub: 0.25 } as const;

function planterParts(f: PropFrame, out: PartSet): void {
  const P = PLANTER_SHAPE;
  const C = PROP_COLORS;
  out.body.push(box(P.size, P.height, P.size, { x: f.cx, y: P.height / 2, z: f.cz }, C.stone));
  out.body.push(box(P.size + 0.06, 0.05, P.size + 0.06, { x: f.cx, y: P.height + 0.02, z: f.cz }, 0xc7beb2));
  out.body.push(box(P.size - 0.1, 0.02, P.size - 0.1, { x: f.cx, y: P.height + 0.05, z: f.cz }, C.soil));
  out.body.push(paint(pose(new THREE.IcosahedronGeometry(P.shrub, 0).scale(1, 0.85, 1), { x: f.cx, y: P.height + P.shrub * 0.75, z: f.cz, ry: f.unit(0, 0) * 3 }), C.leaf));
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + f.unit(i, 1);
    const r = P.size / 2 - 0.09;
    const flower = { x: f.cx + Math.sin(angle) * r, y: P.height + 0.12, z: f.cz + Math.cos(angle) * r, ry: angle };
    out.body.push(paint(pose(new THREE.OctahedronGeometry(0.06, 0), flower), pick(C.blossom, f.unit(i, 2))));
  }
}

/** Crate proportions: a big slatted crate with a smaller one set askew on top. */
export const CRATES_SHAPE = { big: 0.6, bigHeight: 0.46, small: 0.42, smallHeight: 0.34 } as const;

function slattedCrate(width: number, height: number, x: number, y: number, z: number, ry: number, out: PartSet): void {
  const C = PROP_COLORS;
  out.body.push(box(width, height, width, { x, y: y + height / 2, z, ry }, C.wood));
  for (const third of [1, 2]) out.body.push(box(width + 0.02, 0.04, width + 0.02, { x, y: y + (third * height) / 3, z, ry }, C.woodDark));
}

function cratesParts(f: PropFrame, out: PartSet): void {
  const K = CRATES_SHAPE;
  slattedCrate(K.big, K.bigHeight, f.cx, 0, f.cz, (f.unit(0, 0) - 0.5) * 0.3, out);
  slattedCrate(K.small, K.smallHeight, f.cx + (f.unit(1, 0) - 0.5) * 0.06, K.bigHeight, f.cz, (f.unit(1, 1) - 0.5) * 0.9, out);
}

/** Barrel proportions: a staved barrel with two iron hoops and a lid. */
export const BARREL_SHAPE = { radius: 0.27, bulge: 0.03, height: 0.72, sides: 10 } as const;

function barrelsParts(f: PropFrame, out: PartSet): void {
  const B = BARREL_SHAPE;
  const C = PROP_COLORS;
  const ry = f.unit(0, 0) * Math.PI;
  const half = B.height / 2;
  for (const [y0, rBottom, rTop] of [[0, B.radius, B.radius + B.bulge], [half, B.radius + B.bulge, B.radius]] as const) {
    out.body.push(paint(pose(new THREE.CylinderGeometry(rTop, rBottom, half, B.sides), { x: f.cx, y: y0 + half / 2, z: f.cz, ry }), C.wood));
  }
  for (const y of [0.12, B.height - 0.12]) {
    out.body.push(paint(pose(new THREE.CylinderGeometry(B.radius + 0.025, B.radius + 0.025, 0.04, B.sides), { x: f.cx, y, z: f.cz, ry }), C.iron));
  }
  out.body.push(paint(pose(new THREE.CylinderGeometry(B.radius - 0.03, B.radius - 0.03, 0.02, B.sides), { x: f.cx, y: B.height + 0.01, z: f.cz, ry }), C.woodDark));
}

/** Handcart proportions: a plank bed with low sides on two spoked wheels, its handles to −X. */
export const CART_SHAPE = { bedLength: 1.2, bedHeight: 0.44, bedThickness: 0.08, sideHeight: 0.18, wheelRadius: 0.3, wheelWidth: 0.06 } as const;

function cartParts(f: PropFrame, out: PartSet): void {
  const K = CART_SHAPE;
  const C = PROP_COLORS;
  const bedX = f.maxX - K.bedLength / 2 - 0.04;
  const bedD = f.d - 2 * K.wheelWidth - 0.08;
  out.body.push(box(K.bedLength, K.bedThickness, bedD, { x: bedX, y: K.bedHeight, z: f.cz }, C.wood));
  const sideY = K.bedHeight + K.sideHeight / 2;
  for (const sz of [-1, 1]) out.body.push(box(K.bedLength, K.sideHeight, 0.04, { x: bedX, y: sideY, z: f.cz + sz * (bedD / 2 - 0.02) }, C.woodDark));
  for (const sx of [-1, 1]) out.body.push(box(0.04, K.sideHeight, bedD, { x: bedX + sx * (K.bedLength / 2 - 0.02), y: sideY, z: f.cz }, C.woodDark));
  // Wheels on an axle across the bed's middle, their faces towards ±Z.
  for (const sz of [-1, 1]) {
    const z = f.cz + sz * (f.d / 2 - K.wheelWidth / 2);
    out.body.push(paint(pose(new THREE.CylinderGeometry(K.wheelRadius, K.wheelRadius, K.wheelWidth, 10), { x: bedX, y: K.wheelRadius, z, rx: Math.PI / 2 }), C.woodDark));
    out.body.push(paint(pose(new THREE.CylinderGeometry(0.06, 0.06, K.wheelWidth + 0.02, 6), { x: bedX, y: K.wheelRadius, z, rx: Math.PI / 2 }), C.iron));
  }
  out.body.push(box(0.05, 0.05, f.d - 0.02, { x: bedX, y: K.wheelRadius, z: f.cz }, C.iron));
  // Two handles running down to the ground on the −X side, and a rest leg under the bed's end.
  const handleLength = bedX - K.bedLength / 2 - f.minX;
  const handleX = f.minX + handleLength / 2;
  for (const sz of [-1, 1]) {
    out.body.push(box(handleLength, 0.04, 0.04, { x: handleX, y: K.bedHeight - 0.04, z: f.cz + sz * (bedD / 2 - 0.04) }, C.woodDark));
  }
  out.body.push(box(0.05, K.bedHeight, 0.05, { x: bedX - K.bedLength / 2 + 0.06, y: K.bedHeight / 2, z: f.cz }, C.woodDark));
  // A sack and some produce in the bed.
  const sack = { x: bedX + K.bedLength / 4, y: K.bedHeight + 0.14, z: f.cz, ry: f.unit(0, 0) };
  out.body.push(paint(pose(new THREE.DodecahedronGeometry(0.17, 0).scale(1.2, 0.85, 1), sack), C.sack));
  produceParts(bedX - K.bedLength / 6, K.bedHeight + 0.02, f.cz, 0.16, f.unit, 1, out);
}

type PropKind = Extract<StructureKind, 'marketStall' | 'bench' | 'planter' | 'crates' | 'barrels' | 'cart'>;

/** One prop, low and inside its rect. */
function propParts(grid: GridSpec, offset: CosmeticOffset, kind: PropKind, s: StructurePlacement, out: PartSet): void {
  const f = propFrame(grid, offset, s);
  switch (kind) {
    case 'marketStall':
      marketStallParts(f, out);
      return;
    case 'bench':
      benchParts(f, out);
      return;
    case 'planter':
      planterParts(f, out);
      return;
    case 'crates':
      cratesParts(f, out);
      return;
    case 'barrels':
      barrelsParts(f, out);
      return;
    case 'cart':
      cartParts(f, out);
      return;
    default:
      assertNever(kind, 'propParts');
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** World-space parts for one structure of a map. */
export function structureParts(grid: GridSpec, offset: CosmeticOffset, s: StructurePlacement, out: PartSet): void {
  const kind = s.kind;
  if (isShopKind(kind)) {
    shopParts(grid, offset, kind, s, out);
    return;
  }
  switch (kind) {
    case 'partsExchange':
      partsExchangeParts(grid, offset, s, out);
      return;
    case 'well':
      wellParts(grid, s, out);
      return;
    case 'lampPost':
      lampPostParts(grid, s, out);
      return;
    case 'hedge':
      hedgeParts(grid, offset, s, out);
      return;
    case 'cosmoHouse':
    case 'barnabyHouse':
      neighbourHouseParts(grid, kind, s, out);
      return;
    case 'chickenCoop':
      coopParts(grid, s, out);
      return;
    case 'slopShop':
      slopBoothParts(grid, offset, s, out);
      return;
    case 'marketStall':
    case 'bench':
    case 'planter':
    case 'crates':
    case 'barrels':
    case 'cart':
      propParts(grid, offset, kind, s, out);
      return;
    default:
      assertNever(kind, 'structureParts');
  }
}

/**
 * Every structure of a map (the town's shops, parts exchange, booth, well, lamp posts, hedges and
 * props, and its bunting and banners; the Neighbours' houses, coop and hedges), in world space.
 */
export function mapStructureParts(def: MapDefinition, out: PartSet): void {
  for (const s of def.structures) structureParts(def.grid, def.cosmeticOffset, s, out);
  if (def.id === 'town') festivalParts(def.grid, out);
}
