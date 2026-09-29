/**
 * Painted geometry for Brookhollow's structures (`MapDefinition.structures`): the four shops, the
 * notice board, the well, the lamp posts and the trimmed hedges of the back band. Every builder
 * works in world space and pushes parts into a {@link PartSet}: painted opaque parts into `body`
 * (StructureRenderer merges them into the map's one painted mesh) and window and lamp glass into
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state.
 *
 * Occlusion: the camera looks from +X/+Z, so a point at height h hides the ground h units further
 * along −X and −Z. Everything stays inside its structure rect: the shops and hedges fill the back
 * band (z 0–6), so all they can hide is more back band; the notice board stands on the band's
 * front row; the well stays ≤ 0.9 tall and the lamp posts ≤ 0.15 wide, as the town layout allows.
 */
import * as THREE from 'three';
import { Salt, hashFloat } from '../core/hash';
import type { GridSpec, StructureKind, TileCoord, TileRect } from '../core/types';
import { tileCenterX, tileMinX, tileMinZ } from '../world/grid';
import type { MapDefinition, StructurePlacement } from '../world/maps';
import { HEIGHTS } from './constants';
import {
  STRUCTURE_COLORS,
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

/** Integer offset added to cosmetic hash coordinates (a map's `cosmeticOffset`). */
interface Offset {
  readonly x: number;
  readonly z: number;
}

/** Per-feature salts, combined with Salt.Cosmetic (structureGeometry uses 11–61, sceneryGeometry 71–81). */
const FEATURE = { hedge: 91, notice: 101 } as const;

function cosmetic(offset: Offset, feature: number, a: number, b: number, k: number): number {
  return hashFloat(Salt.Cosmetic, feature, a + offset.x, b + offset.z, k);
}

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

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export type ShopKind = Extract<StructureKind, 'generalStore' | 'blacksmith' | 'carpenter' | 'ranch'>;

export const SHOP_KINDS: readonly ShopKind[] = ['generalStore', 'blacksmith', 'carpenter', 'ranch'];

export function isShopKind(kind: StructureKind): kind is ShopKind {
  return (SHOP_KINDS as readonly StructureKind[]).includes(kind);
}

/** What a shop's sign shows. */
export type ShopEmblem = 'sack' | 'anvil' | 'saw' | 'horseshoe';

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

  const frameHalf = S.doorWidth / 2 + 0.1;
  const postInner = f.halfW - S.cornerPost / 2;
  const windowHalf = S.windowWidth / 2 + WINDOW_FRAME.frameWidth + WINDOW_FRAME.shutterWidth + 0.01;
  const windowY = f.base + S.windowCenterHeight;
  const placement = new THREE.Matrix4();
  const spans: readonly (readonly [number, number])[] = [
    [-postInner, f.doorX - frameHalf - S.lanternGap],
    [f.doorX + frameHalf + S.lanternGap, postInner],
  ];
  for (const [start, end] of spans) {
    if (end - start < windowHalf * 2) continue;
    const options = { width: S.windowWidth, height: S.windowHeight, shutters: true, planter: style.planters };
    windowParts(options, style.window, placement.makeTranslation((start + end) / 2, windowY, f.halfD), out);
  }
  const right = f.doorX + frameHalf + S.lanternGap / 2;
  const left = f.doorX - frameHalf - S.lanternGap / 2;
  const lanternX = right + 0.08 < postInner ? right : left;
  if (lanternX - 0.08 > -postInner) wallLanternParts(lanternX, f.base + 1.36, f.halfD, out);

  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  if (f.halfD * 2 >= windowHalf * 2 + S.cornerPost) {
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

function shopParts(grid: GridSpec, kind: ShopKind, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = shopPlacement(grid, s.rect, s.door);
  const local = createPartSet();
  createShopParts(spec, SHOP_STYLES[kind], local);
  const move = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
  transformParts(local.body, move, out.body);
  transformParts(local.glass, move, out.glass);
}

// ---------------------------------------------------------------------------
// Notice board
// ---------------------------------------------------------------------------

const NOTICE_COLORS = {
  post: 0x8a6a4e,
  board: 0xc99a68,
  frame: 0x7a5a40,
  roof: { roof: 0x8f6a4f, shingle: 0x7f5d44, ridge: 0x6f503a, barge: 0x7a5a40 } satisfies RoofColors,
  papers: [0xfffbef, 0xfff1a8, 0xffd3de, 0xd4e8ff] as const,
  pin: 0xe25a4f,
} as const;

/** Two posts carrying a framed cork board under a little gabled cap, pinned with notes. Faces +Z. */
function noticeBoardParts(grid: GridSpec, offset: Offset, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const cx = (b.minX + b.maxX) / 2;
  const z = b.minZ + 0.42;
  const halfSpan = (b.maxX - b.minX) / 2 - 0.3;
  const boardY = 1.06;
  const boardW = halfSpan * 2 - 0.05;
  const boardH = 0.92;
  for (const sx of [-1, 1]) out.body.push(box(0.12, 1.72, 0.12, { x: cx + sx * halfSpan, y: 0.86, z }, NOTICE_COLORS.post));
  out.body.push(box(boardW, boardH, 0.08, { x: cx, y: boardY, z: z + 0.08 }, NOTICE_COLORS.board));
  for (const sy of [-1, 1]) out.body.push(box(boardW + 0.08, 0.06, 0.11, { x: cx, y: boardY + sy * (boardH / 2 + 0.03), z: z + 0.08 }, NOTICE_COLORS.frame));

  const cap = createPartSet();
  const roof: GableRoofSpec = { halfW: halfSpan + 0.06, halfD: 0.2, wallTop: 0, pitch: 0.5, thickness: 0.06, eaveOverhang: 0.1, gableOverhang: 0.08 };
  gableRoofParts(roof, NOTICE_COLORS.roof, cap);
  transformParts(cap.body, new THREE.Matrix4().makeTranslation(cx, boardY + boardH / 2 + 0.08, z + 0.04), out.body);

  const papers = 5;
  for (let i = 0; i < papers; i++) {
    const u = cosmetic(offset, FEATURE.notice, s.rect.x0, i, 0);
    const v = cosmetic(offset, FEATURE.notice, s.rect.x0, i, 1);
    const x = cx - boardW / 2 + 0.22 + ((i + 0.5 * u) / papers) * (boardW - 0.4);
    const y = boardY + (i % 2 === 0 ? 0.16 : -0.14) + (v - 0.5) * 0.12;
    const tilt = (cosmetic(offset, FEATURE.notice, s.rect.x0, i, 2) - 0.5) * 0.3;
    out.body.push(box(0.26, 0.32, 0.01, { x, y, z: z + 0.126, rz: tilt }, pick(NOTICE_COLORS.papers, cosmetic(offset, FEATURE.notice, s.rect.x0, i, 3))));
    out.body.push(box(0.04, 0.04, 0.02, { x, y: y + 0.13, z: z + 0.135 }, NOTICE_COLORS.pin));
  }
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
// Hedges
// ---------------------------------------------------------------------------

/** Clipped hedge blocks filling the back band between the shops. */
export const HEDGE_SHAPE = { inset: 0.06, height: 0.95, capHeight: 0.18, bump: 0.27 } as const;

const HEDGE_GREENS = [0x5c9e5a, 0x66a860, 0x579455, 0x6bae62] as const;

/** A trimmed box hedge over the whole rect with a softer cap and one leafy mound per tile on top. */
function hedgeParts(grid: GridSpec, offset: Offset, s: StructurePlacement, out: PartSet): void {
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
// Dispatch
// ---------------------------------------------------------------------------

/** World-space parts for one structure of a map. */
export function structureParts(grid: GridSpec, offset: Offset, s: StructurePlacement, out: PartSet): void {
  const kind = s.kind;
  if (isShopKind(kind)) {
    shopParts(grid, kind, s, out);
    return;
  }
  switch (kind) {
    case 'noticeBoard':
      noticeBoardParts(grid, offset, s, out);
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
  }
}

/** Every structure of a map (the town's shops, board, well, lamp posts and hedges), in world space. */
export function mapStructureParts(def: MapDefinition, out: PartSet): void {
  for (const s of def.structures) structureParts(def.grid, def.cosmeticOffset, s, out);
}
