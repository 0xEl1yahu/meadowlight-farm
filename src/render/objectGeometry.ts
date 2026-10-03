/**
 * Geometry for placed objects (ObjectRenderer, spec §7.3). Every builder is pure: no scene, no
 * state, no randomness. The caller owns and disposes what it receives.
 *
 * Conventions
 * - Authored in tile units (1 = one tile), facing +Z (the side the camera sees), base at y = 0 on
 *   the tile's ground, centred on the tile (a giant crop on its 3×3 footprint). Paths are flush
 *   planks and flagstones whose tops sit at HEIGHTS.pathTop.
 * - Built on geometryParts.ts: non-indexed, `position` + `normal` + `color`, flat shaded. Painted
 *   parts bake their real colours and render with a white vertex-colour material; the instance
 *   colour multiplies them (white for most objects, a cosmetic shade, or a tint where noted).
 * - Tinted parts (fence timber, giant-crop produce, trophy ribbons) bake white or grey multipliers
 *   and take their colour from the instance. Forage parts carry TINT_MASK_ATTRIBUTE: only the
 *   masked bits (berries, caps, nuts…) take the forage colour, leaves keep their baked green.
 * - Glass parts (lantern paper and lights) are unpainted and use the shared glow-glass material.
 *
 * One InstancedMesh per part: see OBJECT_PARTS. The chest lid is its own part so it can open.
 */
import * as THREE from 'three';
import type { DecorationId, FestivalId, ForageId, GiantCropId, PlacedObject, PlacedObjectKind } from '../core/types';
import { WORKBENCH } from '../config';
import { HEIGHTS } from './constants';
import { createLeafBlade, produceGeometryFor, type LeafSpec } from './cropGeometry';
import { at, box, convexPrismX, glassBox, mergeParts, paint, pose, shade, withTintMask, type Pose, type Vec2 } from './geometryParts';
import { createFencePostGeometry, createFenceRailGeometry } from './structureGeometry';

// ---------------------------------------------------------------------------
// Colours (sRGB hex)
// ---------------------------------------------------------------------------

export const OBJECT_COLORS = {
  chestWood: 0xc28650,
  chestLid: 0xad7446,
  chestBand: 0x7a5136,
  brass: 0xf0bf4f,
  copper: 0xde9161,
  copperDark: 0xa8653f,
  gold: 0xf3cd5d,
  goldDark: 0xc99a3c,
  nozzle: 0x6f7f8c,
  post: 0x9c7250,
  straw: 0xf2d47c,
  sack: 0xecdcb4,
  face: 0x5b4636,
  shirt: 0x7fa7e8,
  patchA: 0xf2a65a,
  patchB: 0xe8787a,
  hat: 0xc49a5c,
  hatBand: 0x7a4e36,
  plank: 0xcfa06c,
  plankDark: 0xb98a5b,
  flagstone: [0xcbc4ba, 0xbdb7b0, 0xd6cfc5] as const,
  leafBed: [0x6fb86a, 0x5fa75e, 0x7cc271] as const,
  forageLeaf: 0x78bf68,
  forageLeafDark: 0x3f7f4a,
  plinth: 0x9c6e4b,
  plinthTop: 0xb48259,
  cup: 0xf4c64a,
  lanternWood: 0x7e5436,
  paperTrim: 0xc0453c,
  stone: 0xc9c3b8,
  stoneDark: 0xa9a399,
  archWood: 0xb98a5c,
  blossoms: [0xffb3c7, 0xfff1a8, 0xc9b6ff, 0xffffff] as const,
  archLeaf: 0x6fb86a,
  benchTop: 0xc8955c,
  benchTopEdge: 0xa87545,
  benchLeg: 0x8c6440,
  pegboard: 0xe0c493,
  viceIron: 0x5e6670,
  toolSteel: 0xb8c0c8,
  toolHandle: 0xd9534a,
} as const;

// ---------------------------------------------------------------------------
// Render-side tables
// ---------------------------------------------------------------------------

/** Shapes of the forage colour bits drawn over the small base plant. */
export const FORAGE_FORMS = ['sprig', 'bulb', 'berries', 'nut', 'cap', 'root', 'holly'] as const;
export type ForageForm = (typeof FORAGE_FORMS)[number];

export interface ForageLook {
  readonly color: number;
  readonly form: ForageForm;
}

/** Colour and form of every forage item's bits. */
export const FORAGE_LOOKS: Readonly<Record<ForageId, ForageLook>> = {
  wildLeek: { color: 0xe4f0c4, form: 'sprig' },
  springOnion: { color: 0xf5eedb, form: 'bulb' },
  wildBerries: { color: 0x7d6cf0, form: 'berries' },
  sweetPea: { color: 0xf59ac4, form: 'sprig' },
  hazelnut: { color: 0xb57b46, form: 'nut' },
  chanterelle: { color: 0xf3b23b, form: 'cap' },
  frostRoot: { color: 0xd5e6f5, form: 'root' },
  holly: { color: 0xd8323c, form: 'holly' },
};

/** Ribbon colour of a trophy, picked by its festival. */
export const TROPHY_RIBBONS: Readonly<Record<FestivalId, number>> = {
  blossomFair: 0xf59ac4,
  lanternNight: 0xf2a65a,
  harvestFair: 0xe0513f,
  starfallFeast: 0x6f7fe8,
};

/** Produce shape of each giant crop (CROPS[id].visual.produce; tests keep the two in step). */
export type GiantProduceForm = 'head' | 'gourd';
export const GIANT_PRODUCE: Readonly<Record<GiantCropId, GiantProduceForm>> = {
  cauliflower: 'head',
  melon: 'gourd',
  pumpkin: 'gourd',
};

/** Giant produce is the crop's own produce model at this scale. */
export const GIANT_SCALE = 3;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Chest body and lid. The lid hinges on the back top edge and opens about local X. */
export const CHEST_SHAPE = {
  width: 0.64,
  height: 0.4,
  depth: 0.46,
  /** Lid hinge in chest space (the lid geometry is authored with the hinge at its origin). */
  hingeY: 0.4,
  hingeZ: -0.24,
  /** Lid angle when fully open (radians). */
  openAngle: 1.85,
} as const;

/** Heights of the two rails between neighbouring wood fences, and the post size. */
export const WOOD_FENCE_SHAPE = { postHeight: 0.74, postWidth: 1.15, rails: [0.27, 0.54] } as const;

// ---------------------------------------------------------------------------
// Chest
// ---------------------------------------------------------------------------

export function createChestBodyGeometry(): THREE.BufferGeometry {
  const { width: w, height: h, depth: d } = CHEST_SHAPE;
  const C = OBJECT_COLORS;
  const parts = [
    box(w + 0.04, 0.05, d + 0.04, { y: 0.025 }, C.chestBand),
    box(w, h - 0.04, d, { y: 0.04 + (h - 0.04) / 2 }, C.chestWood),
  ];
  // Plank seams on the front and the sides.
  for (const y of [0.16, 0.28]) {
    parts.push(box(w - 0.04, 0.014, 0.01, { y, z: d / 2 + 0.004 }, C.chestBand));
    for (const side of [-1, 1]) parts.push(box(0.01, 0.014, d - 0.04, { x: side * (w / 2 + 0.004), y }, C.chestBand));
  }
  // Iron bands, brass corners and the latch plate.
  for (const x of [-0.19, 0.19]) parts.push(box(0.05, h - 0.02, d + 0.016, { x, y: (h - 0.02) / 2 + 0.02 }, C.chestBand));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(box(0.06, h - 0.03, 0.06, { x: sx * (w / 2 - 0.018), y: (h - 0.03) / 2 + 0.03, z: sz * (d / 2 - 0.018) }, C.brass));
  }
  parts.push(box(0.12, 0.1, 0.02, { y: h - 0.07, z: d / 2 + 0.012 }, C.brass));
  parts.push(box(0.035, 0.035, 0.02, { y: h - 0.08, z: d / 2 + 0.026 }, C.chestBand));
  return mergeParts(parts, 'chest body');
}

/** Rounded lid profile in (z, y), hinge at the origin, running forward over the body. */
function chestLidProfile(grow: number): Vec2[] {
  const d = CHEST_SHAPE.depth + 0.04;
  return [
    [-grow, -grow],
    [d + grow, -grow],
    [d + grow, 0.07 + grow],
    [d * 0.8, 0.13 + grow],
    [d * 0.5, 0.155 + grow],
    [d * 0.2, 0.13 + grow],
    [-grow, 0.07 + grow],
  ];
}

export function createChestLidGeometry(): THREE.BufferGeometry {
  const w = CHEST_SHAPE.width + 0.03;
  const d = CHEST_SHAPE.depth + 0.04;
  const C = OBJECT_COLORS;
  const parts = [paint(convexPrismX(chestLidProfile(0), -w / 2, w / 2), C.chestLid)];
  for (const x of [-0.19, 0.19]) parts.push(paint(convexPrismX(chestLidProfile(0.008), x - 0.025, x + 0.025), C.chestBand));
  for (const side of [-1, 1]) parts.push(paint(convexPrismX(chestLidProfile(0.006), side * (w / 2) - 0.03, side * (w / 2) + 0.03), C.brass));
  // Hasp hanging over the latch plate.
  parts.push(box(0.06, 0.08, 0.02, { y: 0.01, z: d + 0.012 }, C.brass));
  return mergeParts(parts, 'chest lid');
}

// ---------------------------------------------------------------------------
// Sprinklers
// ---------------------------------------------------------------------------

interface SprinklerSpec {
  readonly metal: number;
  readonly metalDark: number;
  readonly stemHeight: number;
  readonly armLength: number;
  readonly nozzles: number;
}

/** A painted, posed cylinder part. */
export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number, p: Pose, color: number): THREE.BufferGeometry {
  return paint(pose(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), p), color);
}

/** Base disc + stem + hub, with `nozzles` arms radiating from the hub, each capped by a nozzle. */
function sprinklerGeometry(spec: SprinklerSpec, label: string): THREE.BufferGeometry {
  const hubY = 0.05 + spec.stemHeight;
  const parts = [
    cylinder(0.15, 0.17, 0.05, 10, { y: 0.025 }, spec.metalDark),
    cylinder(0.1, 0.12, 0.03, 10, { y: 0.065 }, spec.metal),
    cylinder(0.03, 0.036, spec.stemHeight, 6, { y: 0.05 + spec.stemHeight / 2 }, spec.metal),
    cylinder(0.055, 0.06, 0.055, 8, { y: hubY }, spec.metalDark),
  ];
  const r = spec.armLength / 2;
  for (let i = 0; i < spec.nozzles; i++) {
    const heading = (i * Math.PI * 2) / spec.nozzles;
    const cx = Math.cos(heading) * r;
    const cz = -Math.sin(heading) * r;
    parts.push(box(r, 0.032, 0.032, { x: cx / 2, y: hubY, z: cz / 2, ry: heading }, spec.metal));
    parts.push(cylinder(0.018, 0.026, 0.06, 6, { x: cx, y: hubY + 0.03, z: cz }, OBJECT_COLORS.nozzle));
  }
  parts.push(cylinder(0.022, 0.03, 0.04, 6, { y: hubY + 0.045 }, spec.metal));
  return mergeParts(parts, label);
}

/** Copper base disc, stem and a 4-nozzle cross. */
export function createSprinklerGeometry(): THREE.BufferGeometry {
  return sprinklerGeometry(
    { metal: OBJECT_COLORS.copper, metalDark: OBJECT_COLORS.copperDark, stemHeight: 0.24, armLength: 0.32, nozzles: 4 },
    'sprinkler',
  );
}

/** Gold-toned, taller, 8 nozzles. */
export function createQualitySprinklerGeometry(): THREE.BufferGeometry {
  return sprinklerGeometry(
    { metal: OBJECT_COLORS.gold, metalDark: OBJECT_COLORS.goldDark, stemHeight: 0.34, armLength: 0.36, nozzles: 8 },
    'quality sprinkler',
  );
}

// ---------------------------------------------------------------------------
// Wood burner
// ---------------------------------------------------------------------------

/** A squat iron stove with a glowing grate, a chimney and a copper cap. */
export function createWoodBurnerGeometry(): THREE.BufferGeometry {
  const iron = 0x4a4541;
  const ironDark = 0x34302d;
  const ember = 0xe8743b;
  return mergeParts(
    [
      box(0.5, 0.06, 0.44, { y: 0.03 }, ironDark),
      box(0.44, 0.36, 0.38, { y: 0.24 }, iron),
      box(0.3, 0.14, 0.02, { y: 0.2, z: 0.2 }, ember),
      box(0.34, 0.03, 0.03, { y: 0.28, z: 0.205 }, ironDark),
      cylinder(0.06, 0.06, 0.34, 8, { x: 0.12, y: 0.59, z: -0.08 }, ironDark),
      cylinder(0.08, 0.08, 0.04, 8, { x: 0.12, y: 0.78, z: -0.08 }, OBJECT_COLORS.copper),
    ],
    'wood burner',
  );
}

// ---------------------------------------------------------------------------
// Workbench
// ---------------------------------------------------------------------------

/** The bench's footprint and timber, in tiles; its top surface is at WORKBENCH.topHeight. */
export const WORKBENCH_SHAPE = { width: 0.84, depth: 0.6, top: 0.06, leg: 0.06 } as const;

/**
 * A low-poly workbench (part 3 spec §2.1): a thick top on four legs with a shelf between them, a
 * vice on the front right corner, and a pegboard along the back holding a hammer, a wrench and a
 * screwdriver. A robot on the bench stands on the top (RobotRenderer, robotLayout.benchLift).
 */
export function createWorkbenchGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const S = WORKBENCH_SHAPE;
  const top = WORKBENCH.topHeight;
  const legHeight = top - S.top;
  const back = -S.depth / 2;
  const parts = [
    box(S.width, S.top, S.depth, { y: top - S.top / 2 }, C.benchTop),
    box(S.width + 0.01, 0.015, S.depth + 0.01, { y: top - S.top + 0.0075 }, C.benchTopEdge),
    box(S.width - 2 * S.leg, 0.03, S.depth - 2 * S.leg, { y: 0.16 }, C.benchLeg),
    // Vice: fixed jaw, moving jaw and its screw handle.
    box(0.12, 0.08, 0.1, { x: 0.3, y: top + 0.04, z: 0.2 }, C.viceIron),
    box(0.12, 0.06, 0.03, { x: 0.3, y: top + 0.03, z: 0.27 }, C.viceIron),
    box(0.14, 0.015, 0.015, { x: 0.3, y: top + 0.03, z: 0.295 }, C.toolSteel),
    // Pegboard, then a hammer, a wrench and a screwdriver hanging on it.
    box(0.7, 0.34, 0.03, { y: top + 0.17, z: back + 0.015 }, C.pegboard),
    box(0.02, 0.16, 0.015, { x: -0.2, y: top + 0.15, z: back + 0.04 }, C.benchLeg),
    box(0.08, 0.03, 0.02, { x: -0.2, y: top + 0.24, z: back + 0.04 }, C.viceIron),
    box(0.025, 0.18, 0.012, { x: 0, y: top + 0.16, z: back + 0.04 }, C.toolSteel),
    box(0.06, 0.03, 0.012, { x: 0, y: top + 0.26, z: back + 0.04 }, C.toolSteel),
    box(0.03, 0.07, 0.02, { x: 0.2, y: top + 0.23, z: back + 0.04 }, C.toolHandle),
    box(0.01, 0.1, 0.01, { x: 0.2, y: top + 0.145, z: back + 0.04 }, C.toolSteel),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(S.leg, legHeight, S.leg, { x: sx * (S.width / 2 - S.leg), y: legHeight / 2, z: sz * (S.depth / 2 - S.leg) }, C.benchLeg));
    }
  }
  return mergeParts(parts, 'workbench');
}

// ---------------------------------------------------------------------------
// Scarecrow
// ---------------------------------------------------------------------------

/** Post, cross-arm, straw hands and feet, sack head with a face, and a hat. Static. */
export function createScarecrowFrameGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const parts = [
    box(0.08, 1.12, 0.08, { y: 0.56 }, C.post),
    box(0.84, 0.06, 0.06, { y: 0.9 }, C.post),
    // Straw poking out below the shirt and from the sleeves.
    cylinder(0.02, 0.1, 0.16, 6, { y: 0.52 }, C.straw),
  ];
  for (const side of [-1, 1]) {
    parts.push(cylinder(0.018, 0.055, 0.1, 5, { x: side * 0.42, y: 0.9, rz: side * (Math.PI / 2) }, C.straw));
  }
  parts.push(paint(pose(new THREE.IcosahedronGeometry(0.13, 0), { y: 1.13 }), C.sack));
  for (const side of [-1, 1]) parts.push(box(0.03, 0.03, 0.02, { x: side * 0.045, y: 1.15, z: 0.118 }, C.face));
  parts.push(box(0.07, 0.016, 0.02, { y: 1.08, z: 0.115 }, C.face));
  parts.push(cylinder(0.21, 0.21, 0.022, 9, { y: 1.235 }, C.hat));
  parts.push(cylinder(0.105, 0.125, 0.13, 8, { y: 1.31 }, C.hat));
  parts.push(cylinder(0.127, 0.127, 0.03, 8, { y: 1.262 }, C.hatBand));
  return mergeParts(parts, 'scarecrow frame');
}

/** Patched shirt over the cross-arm, on the cloth sway material. */
export function createScarecrowShirtGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const parts = [
    box(0.32, 0.36, 0.15, { y: 0.78 }, C.shirt),
    box(0.3, 0.1, 0.12, { x: -0.22, y: 0.9 }, C.shirt),
    box(0.3, 0.1, 0.12, { x: 0.22, y: 0.9 }, C.shirt),
    box(0.09, 0.08, 0.01, { x: 0.07, y: 0.72, z: 0.079 }, C.patchA),
    box(0.07, 0.06, 0.01, { x: -0.08, y: 0.84, z: 0.079 }, C.patchB),
    box(0.08, 0.07, 0.01, { x: -0.25, y: 0.9, z: 0.064 }, C.patchA),
  ];
  return mergeParts(parts, 'scarecrow shirt');
}

// ---------------------------------------------------------------------------
// Wood fence
// ---------------------------------------------------------------------------

/** The boundary fence's post, stockier and shorter; white so the instance colour is the timber. */
export function createWoodFencePostGeometry(): THREE.BufferGeometry {
  const { postWidth, postHeight } = WOOD_FENCE_SHAPE;
  return shade(createFencePostGeometry().scale(postWidth, postHeight, postWidth), 1);
}

/**
 * The rails between a fence and its east neighbour: two boundary-fence rails from this tile's
 * centre (x = 0) to the next one (x = 1). The south rail is the same geometry turned a quarter.
 */
export function createWoodFenceRailGeometry(): THREE.BufferGeometry {
  return mergeParts(
    WOOD_FENCE_SHAPE.rails.map((y, i) => shade(pose(createFenceRailGeometry().scale(1, 1.3, 1.4), { x: 0.5, y }), i === 0 ? 0.9 : 1)),
    'wood fence rails',
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Thickness of path planks and flagstones; their tops sit at HEIGHTS.pathTop. */
const PATH_THICKNESS = 0.04;
const PATH_Y = HEIGHTS.pathTop - PATH_THICKNESS / 2;

/** Three plank slats across the tile, flush with the ground. */
export function createWoodPathGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const slats: readonly (readonly [number, number, number])[] = [
    [-0.31, 0.02, C.plank],
    [0, -0.015, C.plankDark],
    [0.31, 0.01, C.plank],
  ];
  const parts = slats.map(([z, x, color]) => box(0.9, PATH_THICKNESS, 0.27, { x, y: PATH_Y, z }, color));
  // Nail heads at the plank ends.
  for (const [z, x] of slats) {
    for (const end of [-1, 1]) parts.push(box(0.03, 0.006, 0.03, { x: x + end * 0.38, y: HEIGHTS.pathTop + 0.002, z }, C.chestBand));
  }
  return mergeParts(parts, 'wood path');
}

/** One flagstone: centre, radii, sides, yaw and colour index. */
type Flagstone = readonly [x: number, z: number, rx: number, rz: number, sides: number, yaw: number, color: number];

/** Flagstone layouts, each inside the tile (|x|, |z| + radius ≤ 0.48). */
const FLAGSTONE_LAYOUTS: readonly (readonly Flagstone[])[] = [
  [
    [-0.2, -0.2, 0.22, 0.18, 6, 0.3, 0],
    [0.2, -0.13, 0.2, 0.22, 5, 1.1, 1],
    [-0.03, 0.24, 0.25, 0.19, 7, 0.6, 2],
  ],
  [
    [-0.24, -0.22, 0.17, 0.16, 5, 0.2, 2],
    [0.18, -0.24, 0.2, 0.16, 6, 0.9, 0],
    [-0.19, 0.2, 0.2, 0.2, 6, 1.4, 1],
    [0.23, 0.2, 0.17, 0.19, 5, 0.5, 2],
  ],
  [
    [-0.12, -0.14, 0.3, 0.24, 7, 0.4, 1],
    [0.26, 0.22, 0.2, 0.18, 5, 1.2, 0],
    [-0.2, 0.28, 0.16, 0.14, 6, 0.1, 2],
  ],
];

/** Stone path `variant` (0 … STONE_PATH_VARIANTS − 1, see objectLayout): flush flagstones. */
export function createStonePathGeometry(variant: number): THREE.BufferGeometry {
  const layout = at(FLAGSTONE_LAYOUTS, variant);
  const parts = layout.map(([x, z, rx, rz, sides, yaw, color]) => {
    const stone = new THREE.CylinderGeometry(1, 1.03, PATH_THICKNESS, sides).scale(rx, 1, rz);
    return paint(pose(stone, { x, y: PATH_Y, z, ry: yaw }), at(OBJECT_COLORS.flagstone, color));
  });
  return mergeParts(parts, `stone path ${variant}`);
}

// ---------------------------------------------------------------------------
// Giant crop
// ---------------------------------------------------------------------------

function paintedLeaf(spec: LeafSpec, color: number): THREE.BufferGeometry {
  return paint(createLeafBlade(spec), color);
}

/** A bed of broad leaves spread over the 3×3 footprint, centred on the origin. */
export function createGiantLeafBedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const yaw = (i * Math.PI * 2) / count + (i % 2) * 0.12;
    const outer = i % 2 === 0;
    parts.push(
      paintedLeaf(
        { length: outer ? 1.3 : 1.05, width: outer ? 0.46 : 0.4, pitch: outer ? 0.28 : 0.5, droop: 0.42, yaw, y: 0.04 },
        at(OBJECT_COLORS.leafBed, i % 3),
      ),
    );
  }
  return mergeParts(parts, 'giant crop leaves');
}

/** The crop's own produce model at GIANT_SCALE; white multipliers, tinted with the produce colour. */
export function createGiantProduceGeometry(form: GiantProduceForm): THREE.BufferGeometry {
  const geometry = produceGeometryFor(form).scale(GIANT_SCALE, GIANT_SCALE, GIANT_SCALE);
  if (form === 'gourd') geometry.translate(0, 0.05, 0);
  return mergeParts([geometry], `giant ${form}`);
}

// ---------------------------------------------------------------------------
// Forage (tint-mask sway material: masked bits take the forage colour)
// ---------------------------------------------------------------------------

/** A baked piece (mask 0) keeps `color`; a tinted piece (mask 1) multiplies the forage colour by `color`. */
function masked(geometry: THREE.BufferGeometry, p: Pose, color: number, mask: 0 | 1): THREE.BufferGeometry {
  return withTintMask(paint(pose(geometry, p), color), mask);
}

function blob(radius: number, p: Pose, color: number, mask: 0 | 1, squash = 1): THREE.BufferGeometry {
  return masked(new THREE.IcosahedronGeometry(radius, 0).scale(1, squash, 1), p, color, mask);
}

function forageLeaf(spec: LeafSpec, color: number): THREE.BufferGeometry {
  return withTintMask(paintedLeaf(spec, color), 0);
}

/** Forage is authored small and drawn a little larger, so it stands out from the meadow flowers. */
const FORAGE_SIZE = 1.25;

/** The small base plant every forage grows from: a rosette of five leaves. */
export function createForagePlantGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    parts.push(forageLeaf({ length: 0.2, width: 0.075, pitch: 0.85, droop: 0.55, yaw: 0.3 + (i * Math.PI * 2) / 5 }, OBJECT_COLORS.forageLeaf));
  }
  // scale() refreshes the bounds mergeParts computed.
  return mergeParts(parts, 'forage plant').scale(FORAGE_SIZE, FORAGE_SIZE, FORAGE_SIZE);
}

const WHITE = 0xffffff;
const STEM = OBJECT_COLORS.forageLeaf;

function forageBits(form: ForageForm): THREE.BufferGeometry[] {
  switch (form) {
    case 'sprig':
      return [-0.05, 0.02, 0.06].flatMap((x, i) => {
        const lean = (i - 1) * 0.18;
        const height = 0.22 + i * 0.03;
        const tipX = x + Math.sin(-lean) * height;
        return [
          masked(new THREE.CylinderGeometry(0.01, 0.014, height, 5), { x: x + (tipX - x) / 2, y: height / 2, rz: lean }, STEM, 0),
          blob(0.034, { x: tipX, y: height + 0.015, z: 0.01 }, WHITE, 1, 1.3),
        ];
      });
    case 'bulb':
      return [
        blob(0.075, { y: 0.05, z: 0.04 }, WHITE, 1, 0.85),
        masked(new THREE.CylinderGeometry(0.012, 0.02, 0.2, 5), { y: 0.18, z: 0.04 }, STEM, 0),
        masked(new THREE.CylinderGeometry(0.008, 0.016, 0.16, 5), { x: 0.03, y: 0.16, z: 0.04, rz: -0.3 }, STEM, 0),
      ];
    case 'berries':
      return [
        [0.05, 0.16, 0.03],
        [-0.04, 0.14, 0.05],
        [0.0, 0.2, -0.02],
        [0.08, 0.11, -0.03],
        [-0.07, 0.1, -0.02],
        [0.02, 0.12, 0.08],
      ].map(([x = 0, y = 0, z = 0]) => blob(0.032, { x, y, z }, WHITE, 1));
    case 'nut':
      return [
        [0.1, 0.07],
        [-0.08, 0.1],
        [0.02, -0.1],
      ].flatMap(([x = 0, z = 0]) => [
        blob(0.045, { x, y: 0.035, z }, WHITE, 1, 0.8),
        masked(new THREE.CylinderGeometry(0.042, 0.03, 0.025, 6), { x, y: 0.07, z }, 0x9e9e9e, 1),
      ]);
    case 'cap':
      return [
        [0.06, 0.06, 1],
        [-0.07, 0.03, 0.75],
      ].flatMap(([x = 0, z = 0, s = 1]) => [
        masked(new THREE.CylinderGeometry(0.022 * s, 0.028 * s, 0.09 * s, 6), { x, y: 0.045 * s, z }, 0xf6ecd8, 0),
        masked(new THREE.CylinderGeometry(0.085 * s, 0.03 * s, 0.05 * s, 8), { x, y: 0.1 * s, z }, WHITE, 1),
      ]);
    case 'root':
      return [
        [0.06, 0.05, 0.5],
        [-0.06, 0.02, -0.4],
      ].map(([x = 0, z = 0, tilt = 0]) => masked(new THREE.ConeGeometry(0.045, 0.17, 6), { x, y: 0.03, z, rx: Math.PI, rz: tilt }, WHITE, 1));
    case 'holly':
      return [
        ...[0.2, 1.8, 3.5, 5].map((yaw) =>
          forageLeaf({ length: 0.19, width: 0.1, pitch: 0.5, droop: 0.2, yaw, y: 0.08 }, OBJECT_COLORS.forageLeafDark),
        ),
        blob(0.03, { x: 0.02, y: 0.13, z: 0.02 }, WHITE, 1),
        blob(0.03, { x: -0.03, y: 0.12, z: 0.03 }, WHITE, 1),
        blob(0.028, { x: 0.0, y: 0.14, z: -0.03 }, WHITE, 1),
      ];
  }
}

/** The colour bits of a forage `form`, on top of or beside the base plant. */
export function createForageBitsGeometry(form: ForageForm): THREE.BufferGeometry {
  return mergeParts(forageBits(form), `forage ${form}`).scale(FORAGE_SIZE, FORAGE_SIZE, FORAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Trophy
// ---------------------------------------------------------------------------

/** A gold cup with two handles on a wooden plinth. */
export function createTrophyGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const parts = [
    box(0.4, 0.22, 0.4, { y: 0.11 }, C.plinth),
    box(0.44, 0.04, 0.44, { y: 0.24 }, C.plinthTop),
    cylinder(0.1, 0.12, 0.04, 10, { y: 0.28 }, C.cup),
    cylinder(0.025, 0.035, 0.14, 6, { y: 0.37 }, C.cup),
    paint(pose(new THREE.IcosahedronGeometry(0.04, 0), { y: 0.39 }), C.cup),
    cylinder(0.15, 0.07, 0.2, 10, { y: 0.54 }, C.cup),
    cylinder(0.16, 0.16, 0.025, 10, { y: 0.65 }, C.cup),
  ];
  for (const side of [-1, 1]) {
    parts.push(box(0.03, 0.13, 0.03, { x: side * 0.2, y: 0.55 }, C.cup));
    parts.push(box(0.07, 0.03, 0.03, { x: side * 0.17, y: 0.61 }, C.cup));
    parts.push(box(0.07, 0.03, 0.03, { x: side * 0.16, y: 0.49 }, C.cup));
  }
  return mergeParts(parts, 'trophy');
}

/** A rosette with two tails on the plinth front; white, so the instance colour is the festival's. */
export function createTrophyRibbonGeometry(): THREE.BufferGeometry {
  const parts = [
    shade(pose(new THREE.CylinderGeometry(0.075, 0.075, 0.016, 10), { y: 0.13, z: 0.208, rx: Math.PI / 2 }), 1),
    shade(pose(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 8), { y: 0.13, z: 0.22, rx: Math.PI / 2 }), 0.78),
  ];
  for (const side of [-1, 1]) {
    parts.push(shade(pose(new THREE.BoxGeometry(0.035, 0.1, 0.01), { x: side * 0.03, y: 0.05, z: 0.206, rz: side * 0.25 }), 0.9));
  }
  return mergeParts(parts, 'trophy ribbon');
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

/** Where the paper lantern hangs: from an arm on the post, off to +X. */
const PAPER_LANTERN = { x: 0.2, y: 0.735, width: 0.18, height: 0.24 } as const;

/** Post, arm, hanger and the lantern's caps and red paper trim (the paper itself is glass). */
export function createPaperLanternGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const L = PAPER_LANTERN;
  const top = L.y + L.height / 2;
  const bottom = L.y - L.height / 2;
  return mergeParts(
    [
      box(0.18, 0.06, 0.18, { y: 0.03 }, C.stoneDark),
      box(0.07, 1.0, 0.07, { y: 0.5 }, C.lanternWood),
      box(0.27, 0.04, 0.04, { x: 0.115, y: 0.98 }, C.lanternWood),
      box(0.012, 0.96 - top, 0.012, { x: L.x, y: (0.96 + top) / 2 }, C.lanternWood),
      box(L.width + 0.03, 0.03, L.width + 0.03, { x: L.x, y: top + 0.015 }, C.lanternWood),
      box(L.width + 0.03, 0.03, L.width + 0.03, { x: L.x, y: bottom - 0.015 }, C.lanternWood),
      box(L.width + 0.012, 0.025, L.width + 0.012, { x: L.x, y: L.y + 0.06 }, C.paperTrim),
      box(L.width + 0.012, 0.025, L.width + 0.012, { x: L.x, y: L.y - 0.06 }, C.paperTrim),
      box(0.04, 0.04, 0.04, { x: L.x, y: bottom - 0.05 }, C.paperTrim),
    ],
    'paper lantern',
  );
}

export function createPaperLanternGlassGeometry(): THREE.BufferGeometry {
  const L = PAPER_LANTERN;
  return mergeParts([glassBox(L.width, L.height, L.width, { x: L.x, y: L.y })], 'paper lantern glass');
}

/** Stone lantern: base, pedestal, platform, four corner posts round the light, and a pyramid roof. */
export function createStoneLanternGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const parts = [
    box(0.34, 0.08, 0.34, { y: 0.04 }, C.stoneDark),
    cylinder(0.08, 0.1, 0.34, 6, { y: 0.25 }, C.stone),
    box(0.3, 0.06, 0.3, { y: 0.45 }, C.stone),
    paint(pose(new THREE.ConeGeometry(0.27, 0.16, 4), { y: 0.74, ry: Math.PI / 4 }), C.stoneDark),
    paint(pose(new THREE.IcosahedronGeometry(0.045, 0), { y: 0.84 }), C.stone),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(box(0.05, 0.18, 0.05, { x: sx * 0.105, y: 0.57, z: sz * 0.105 }, C.stone));
  }
  return mergeParts(parts, 'stone lantern');
}

export function createStoneLanternGlassGeometry(): THREE.BufferGeometry {
  return mergeParts([glassBox(0.17, 0.17, 0.17, { y: 0.57 })], 'stone lantern glass');
}

/** An arch over the tile (posts at ±0.38, a flattened half circle on top) dressed in flower clusters. */
export function createFlowerArchGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const postHeight = 0.8;
  const span = 0.38;
  const rise = 0.3;
  const parts = [
    box(0.08, postHeight, 0.08, { x: -span, y: postHeight / 2 }, C.archWood),
    box(0.08, postHeight, 0.08, { x: span, y: postHeight / 2 }, C.archWood),
  ];
  const points: [number, number][] = [];
  const segments = 7;
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI - (i * Math.PI) / segments;
    points.push([Math.cos(angle) * span, postHeight + Math.sin(angle) * rise]);
  }
  for (let i = 0; i < segments; i++) {
    const [x0, y0] = at(points, i);
    const [x1, y1] = at(points, i + 1);
    const length = Math.hypot(x1 - x0, y1 - y0) + 0.03;
    parts.push(box(length, 0.07, 0.07, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rz: Math.atan2(y1 - y0, x1 - x0) }, C.archWood));
  }
  const clusters: [number, number][] = [...points, [-span, 0.3], [span, 0.45], [-span, 0.58], [span, 0.2]];
  clusters.forEach(([x, y], i) => {
    const z = i % 2 === 0 ? 0.04 : -0.03;
    parts.push(paint(pose(new THREE.IcosahedronGeometry(0.065, 0), { x: x + 0.02, y: y - 0.02, z: -z }), C.archLeaf));
    parts.push(paint(pose(new THREE.IcosahedronGeometry(0.05, 0), { x, y: y + 0.03, z }), at(C.blossoms, i % C.blossoms.length)));
  });
  return mergeParts(parts, 'flower arch');
}

// ---------------------------------------------------------------------------
// Part table: one InstancedMesh per (kind, part)
// ---------------------------------------------------------------------------

/**
 * Material a part renders with; the ObjectRenderer creates one of each. `painted`: white with
 * vertex colours; `cloth`: the same, swaying gently (scarecrow shirt); `plant`: the tint-mask sway
 * material (forage); `glass`: the shared glow glass.
 */
export type ObjectMaterialKind = 'painted' | 'cloth' | 'plant' | 'glass';

/** Sway of the cloth and plant materials (see createSwayMaterial). */
export const OBJECT_SWAY = {
  cloth: { amplitude: 0.035, frequency: 1.3 },
  plant: { amplitude: 0.4, frequency: 1.9 },
} as const;

export const OBJECT_PART_IDS = [
  'chestBody',
  'chestLid',
  'sprinkler',
  'qualitySprinkler',
  'woodBurner',
  'scarecrowFrame',
  'scarecrowShirt',
  'fencePost',
  'fenceRail',
  'woodPath',
  'stonePath0',
  'stonePath1',
  'stonePath2',
  'giantLeaves',
  'giantHead',
  'giantGourd',
  'foragePlant',
  'forageSprig',
  'forageBulb',
  'forageBerries',
  'forageNut',
  'forageCap',
  'forageRoot',
  'forageHolly',
  'trophy',
  'trophyRibbon',
  'paperLantern',
  'paperLanternGlass',
  'stoneLantern',
  'stoneLanternGlass',
  'flowerArch',
  'workbench',
] as const;
export type ObjectPartId = (typeof OBJECT_PART_IDS)[number];

export interface ObjectPartSpec {
  readonly kind: PlacedObjectKind;
  readonly material: ObjectMaterialKind;
  /** Flush paths (and glowing glass) cast no shadow. */
  readonly castShadow: boolean;
  readonly build: () => THREE.BufferGeometry;
}

function part(kind: PlacedObjectKind, material: ObjectMaterialKind, build: () => THREE.BufferGeometry, castShadow = true): ObjectPartSpec {
  return { kind, material, castShadow: castShadow && material !== 'glass', build };
}

export const OBJECT_PARTS: Readonly<Record<ObjectPartId, ObjectPartSpec>> = {
  chestBody: part('chest', 'painted', createChestBodyGeometry),
  chestLid: part('chest', 'painted', createChestLidGeometry),
  sprinkler: part('sprinkler', 'painted', createSprinklerGeometry),
  qualitySprinkler: part('qualitySprinkler', 'painted', createQualitySprinklerGeometry),
  woodBurner: part('woodBurner', 'painted', createWoodBurnerGeometry),
  scarecrowFrame: part('scarecrow', 'painted', createScarecrowFrameGeometry),
  scarecrowShirt: part('scarecrow', 'cloth', createScarecrowShirtGeometry),
  fencePost: part('woodFence', 'painted', createWoodFencePostGeometry),
  fenceRail: part('woodFence', 'painted', createWoodFenceRailGeometry),
  woodPath: part('woodPath', 'painted', createWoodPathGeometry, false),
  stonePath0: part('stonePath', 'painted', () => createStonePathGeometry(0), false),
  stonePath1: part('stonePath', 'painted', () => createStonePathGeometry(1), false),
  stonePath2: part('stonePath', 'painted', () => createStonePathGeometry(2), false),
  giantLeaves: part('giantCrop', 'painted', createGiantLeafBedGeometry),
  giantHead: part('giantCrop', 'painted', () => createGiantProduceGeometry('head')),
  giantGourd: part('giantCrop', 'painted', () => createGiantProduceGeometry('gourd')),
  foragePlant: part('forage', 'plant', createForagePlantGeometry),
  forageSprig: part('forage', 'plant', () => createForageBitsGeometry('sprig')),
  forageBulb: part('forage', 'plant', () => createForageBitsGeometry('bulb')),
  forageBerries: part('forage', 'plant', () => createForageBitsGeometry('berries')),
  forageNut: part('forage', 'plant', () => createForageBitsGeometry('nut')),
  forageCap: part('forage', 'plant', () => createForageBitsGeometry('cap')),
  forageRoot: part('forage', 'plant', () => createForageBitsGeometry('root')),
  forageHolly: part('forage', 'plant', () => createForageBitsGeometry('holly')),
  trophy: part('trophy', 'painted', createTrophyGeometry),
  trophyRibbon: part('trophy', 'painted', createTrophyRibbonGeometry),
  paperLantern: part('decoration', 'painted', createPaperLanternGeometry),
  paperLanternGlass: part('decoration', 'glass', createPaperLanternGlassGeometry),
  stoneLantern: part('decoration', 'painted', createStoneLanternGeometry),
  stoneLanternGlass: part('decoration', 'glass', createStoneLanternGlassGeometry),
  flowerArch: part('decoration', 'painted', createFlowerArchGeometry),
  workbench: part('workbench', 'painted', createWorkbenchGeometry),
};

const FORAGE_PARTS: Readonly<Record<ForageForm, ObjectPartId>> = {
  sprig: 'forageSprig',
  bulb: 'forageBulb',
  berries: 'forageBerries',
  nut: 'forageNut',
  cap: 'forageCap',
  root: 'forageRoot',
  holly: 'forageHolly',
};

const GIANT_PARTS: Readonly<Record<GiantProduceForm, ObjectPartId>> = { head: 'giantHead', gourd: 'giantGourd' };

const DECORATION_PARTS: Readonly<Record<DecorationId, readonly ObjectPartId[]>> = {
  paperLantern: ['paperLantern', 'paperLanternGlass'],
  stoneLantern: ['stoneLantern', 'stoneLanternGlass'],
  flowerArch: ['flowerArch'],
};

const STONE_PATH_PARTS: readonly ObjectPartId[] = ['stonePath0', 'stonePath1', 'stonePath2'];

/**
 * The parts one drawn object shows at its anchor tile (fence rails are keyed by edge and come
 * separately). `stoneVariant` is objectLayout's stonePathVariant for the tile.
 */
export function objectPartsFor(object: PlacedObject, stoneVariant: number): readonly ObjectPartId[] {
  switch (object.kind) {
    case 'chest':
      return ['chestBody', 'chestLid'];
    case 'sprinkler':
      return ['sprinkler'];
    case 'qualitySprinkler':
      return ['qualitySprinkler'];
    case 'woodBurner':
      return ['woodBurner'];
    case 'scarecrow':
      return ['scarecrowFrame', 'scarecrowShirt'];
    case 'woodFence':
      return ['fencePost'];
    case 'woodPath':
      return ['woodPath'];
    case 'stonePath':
      return [at(STONE_PATH_PARTS, stoneVariant)];
    case 'giantCrop':
      return ['giantLeaves', GIANT_PARTS[GIANT_PRODUCE[object.cropId]]];
    case 'forage':
      return ['foragePlant', FORAGE_PARTS[FORAGE_LOOKS[object.itemId].form]];
    case 'trophy':
      return ['trophy', 'trophyRibbon'];
    case 'decoration':
      return DECORATION_PARTS[object.variant];
    case 'workbench':
      return ['workbench'];
  }
}
