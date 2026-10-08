/**
 * The cast's props (farmclaws part 4a spec §2.3): one merged, vertex-coloured geometry per
 * NpcProp, hung from one bone of the character's PlayerModel so it sways with the character.
 *
 * - Each prop is authored in the local space of its bone (NPC_PROP_BONES), facing +Z like the
 *   model: the head's origin is the neck pivot, the torso's the waist and the hips' the hip joint
 *   (see PLAYER_RIG and the body segments in playerModel.ts).
 * - A prop worn as a hat replaces the character's own hat: modelAppearance builds the model
 *   with HAT_STYLES.none under it.
 * - A clipboard is held against the chest, so it brings a left-arm pose of its own
 *   (NPC_PROP_POSES); every other prop leaves the arms at rest.
 */
import * as THREE from 'three';
import type { Appearance } from '../core/types';
import type { CastLook, NpcProp } from '../people/cast';
import { mergeParts } from './geometryParts';
import { HAT_STYLES, bakeParts, type Part, type Pose } from './playerModel';

/** The PlayerModel bones a prop hangs from. */
export type PropBone = 'head' | 'torso' | 'hips';

export const NPC_PROP_BONES: Readonly<Record<NpcProp, PropBone>> = {
  toolApron: 'torso',
  featherHat: 'head',
  clipboard: 'torso',
  seedPouch: 'hips',
  smithApron: 'torso',
  pencil: 'head',
  neckerchief: 'torso',
};

/** Joints a prop sets on top of the empty-handed rest pose. */
export const NPC_PROP_POSES: Readonly<Partial<Record<NpcProp, Readonly<Partial<Pose>>>>> = {
  // The left hand holds the clipboard's lower corner against the chest.
  clipboard: { lArmSwing: 0.85, lArmSpread: -0.3 },
};

/** Props worn in place of the character's own hat. */
const HAT_PROPS: ReadonlySet<NpcProp> = new Set<NpcProp>(['featherHat']);

const CANVAS = 0xd9b77e;
const LEATHER = 0x8a5a3c;
const BRASS = 0xf2c46b;
const METAL = 0xaab2c6;
const HANDLE_RED = 0xe2563f;
const HANDLE_BLUE = 0x5f93c6;
const STRAW = 0xe8c77a;
const RIBBON = 0x6b8f5a;
const FEATHER = 0xf4f0e6;
const FEATHER_TIP = 0x7a6aa8;
const BOARD = 0xc58b5a;
const PAPER = 0xfaf6ea;
const INK_LINE = 0x9aa3b5;
const BURLAP = 0xd8b98a;
const SPROUT = 0x8cc56f;
const PENCIL_PAINT = 0xf2c94c;
const PENCIL_WOOD = 0xe8c99a;
const PENCIL_LEAD = 0x4a4a52;
const ERASER = 0xf6a6a0;
const KERCHIEF = 0xe2563f;

const placement = new THREE.Matrix4();
const placementRotation = new THREE.Quaternion();
const placementEuler = new THREE.Euler();
const placementPosition = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth);
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
}

/** Bakes `parts` authored in their own frame, then rotates (x, y, z order) and moves them onto the bone. */
function bakePlaced(parts: readonly Part[], position: readonly [number, number, number], rotation: readonly [number, number, number]): THREE.BufferGeometry {
  const geometry = bakeParts(parts);
  placement.compose(
    placementPosition.set(position[0], position[1], position[2]),
    placementRotation.setFromEuler(placementEuler.set(rotation[0], rotation[1], rotation[2])),
    UNIT_SCALE,
  );
  return geometry.applyMatrix4(placement);
}

/** Sol: a canvas tool apron round the waist, two pockets with a screwdriver, a file and a spanner. */
function buildToolApron(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.31, 0.03, 0.215), color: CANVAS, shade: 0.8, position: [0, 0.075, 0] },
    { geometry: box(0.3, 0.2, 0.02), color: CANVAS, position: [0, -0.03, 0.13] },
    { geometry: box(0.11, 0.08, 0.016), color: CANVAS, shade: 0.85, position: [0.07, -0.05, 0.147] },
    { geometry: box(0.11, 0.08, 0.016), color: CANVAS, shade: 0.85, position: [-0.07, -0.05, 0.147] },
    { geometry: cylinder(0.012, 0.012, 0.07, 5), color: HANDLE_RED, position: [0.05, 0.01, 0.15] },
    { geometry: cylinder(0.012, 0.012, 0.06, 5), color: HANDLE_BLUE, position: [0.09, 0.005, 0.15] },
    { geometry: box(0.022, 0.09, 0.008), color: METAL, position: [-0.07, 0.005, 0.151] },
    { geometry: box(0.05, 0.022, 0.008), color: METAL, position: [-0.07, 0.05, 0.151] },
  ]);
}

/** Cosmo: a weathered straw hat with a green ribbon and a feather tucked in it. */
function buildFeatherHat(): THREE.BufferGeometry {
  const hat = bakeParts([
    { geometry: cylinder(0.28, 0.28, 0.022, 10), color: STRAW, position: [0, 0.27, 0.01], rotation: [0.05, 0, 0] },
    { geometry: cylinder(0.125, 0.15, 0.12, 8), color: STRAW, shade: 1.04, position: [0, 0.34, 0] },
    { geometry: cylinder(0.153, 0.153, 0.032, 8), color: RIBBON, position: [0, 0.3, 0] },
    { geometry: cylinder(0.1, 0.125, 0.012, 8), color: STRAW, shade: 0.9, position: [0, 0.406, 0] },
  ]);
  // The feather, quill down at the origin, leaning out and back from the ribbon on the left.
  const feather = bakePlaced(
    [
      { geometry: cylinder(0.005, 0.005, 0.04, 4), color: FEATHER, shade: 0.8, position: [0, -0.01, 0] },
      { geometry: box(0.012, 0.18, 0.05), color: FEATHER, position: [0, 0.1, 0] },
      { geometry: box(0.014, 0.05, 0.054), color: FEATHER_TIP, position: [0, 0.205, 0] },
    ],
    [0.14, 0.31, -0.06],
    [-0.35, 0, -0.45],
  );
  return mergeParts([hat, feather], 'featherHat');
}

/** Barnaby: a clipboard with a written sheet, held against the chest. */
function buildClipboard(): THREE.BufferGeometry {
  return bakePlaced(
    [
      { geometry: box(0.16, 0.21, 0.015), color: BOARD },
      { geometry: box(0.13, 0.165, 0.004), color: PAPER, position: [0, -0.01, 0.0095] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, 0.03, 0.0125] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, -0.005, 0.0125] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, -0.04, 0.0125] },
      { geometry: box(0.06, 0.03, 0.014), color: METAL, position: [0, 0.095, 0.012] },
    ],
    [0.05, 0.16, 0.165],
    [-0.3, 0, 0],
  );
}

/** Marigold: a burlap seed pouch on a belt, a sprout peeking out of its neck. */
function buildSeedPouch(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.305, 0.03, 0.215), color: LEATHER, position: [0, 0.03, 0] },
    { geometry: new THREE.IcosahedronGeometry(0.07, 0), color: BURLAP, position: [-0.1, -0.045, 0.115], scale: [0.85, 1, 0.75] },
    { geometry: cylinder(0.026, 0.036, 0.03, 6), color: BURLAP, shade: 0.8, position: [-0.1, 0.02, 0.115] },
    { geometry: cylinder(0.03, 0.03, 0.012, 6), color: LEATHER, position: [-0.1, 0.01, 0.115] },
    { geometry: box(0.018, 0.045, 0.008), color: SPROUT, position: [-0.095, 0.05, 0.115], rotation: [0, 0, -0.35] },
  ]);
}

/** Bram: a leather smith's apron from the chest to the knees, with neck straps, a tie and rivets. */
function buildSmithApron(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.22, 0.2, 0.02), color: LEATHER, position: [0, 0.2, 0.135] },
    { geometry: box(0.28, 0.26, 0.02), color: LEATHER, position: [0, -0.05, 0.135] },
    { geometry: box(0.31, 0.025, 0.215), color: LEATHER, shade: 0.75, position: [0, 0.09, 0] },
    { geometry: box(0.025, 0.08, 0.02), color: LEATHER, shade: 0.75, position: [0.075, 0.33, 0.125], rotation: [0, 0, 0.69] },
    { geometry: box(0.025, 0.08, 0.02), color: LEATHER, shade: 0.75, position: [-0.075, 0.33, 0.125], rotation: [0, 0, -0.69] },
    { geometry: box(0.1, 0.06, 0.012), color: LEATHER, shade: 0.82, position: [0, -0.06, 0.151] },
    { geometry: box(0.02, 0.02, 0.01), color: BRASS, position: [0.1, 0.29, 0.148] },
    { geometry: box(0.02, 0.02, 0.01), color: BRASS, position: [-0.1, 0.29, 0.148] },
  ]);
}

/** Juniper: a pencil tucked behind the right ear (−X), point forward and a little down. */
function buildPencil(): THREE.BufferGeometry {
  return bakePlaced(
    [
      { geometry: cylinder(0.014, 0.014, 0.1, 6), color: PENCIL_PAINT },
      { geometry: new THREE.ConeGeometry(0.014, 0.03, 6), color: PENCIL_WOOD, position: [0, 0.065, 0] },
      { geometry: new THREE.ConeGeometry(0.005, 0.01, 6), color: PENCIL_LEAD, position: [0, 0.077, 0] },
      { geometry: cylinder(0.015, 0.015, 0.012, 6), color: METAL, position: [0, -0.056, 0] },
      { geometry: cylinder(0.014, 0.014, 0.018, 6), color: ERASER, position: [0, -0.071, 0] },
    ],
    [-0.19, 0.19, -0.02],
    [Math.PI / 2 + 0.25, 0, 0],
  );
}

/** Tess: a red neckerchief, a band round the neck with a triangle over the chest and a knot. */
function buildNeckerchief(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: cylinder(0.072, 0.078, 0.035, 8), color: KERCHIEF, position: [0, 0.335, 0] },
    { geometry: new THREE.ConeGeometry(0.075, 0.12, 3), color: KERCHIEF, position: [0, 0.27, 0.118], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.3] },
    { geometry: new THREE.IcosahedronGeometry(0.024, 0), color: KERCHIEF, shade: 0.8, position: [0, 0.325, 0.085] },
  ]);
}

const PROP_BUILDERS: Readonly<Record<NpcProp, () => THREE.BufferGeometry>> = {
  toolApron: buildToolApron,
  featherHat: buildFeatherHat,
  clipboard: buildClipboard,
  seedPouch: buildSeedPouch,
  smithApron: buildSmithApron,
  pencil: buildPencil,
  neckerchief: buildNeckerchief,
};

/** A fresh geometry for `prop` in its bone's local space; the caller disposes it. */
export function createNpcPropGeometry(prop: NpcProp): THREE.BufferGeometry {
  return PROP_BUILDERS[prop]();
}

/** The appearance a character's model is built with: a prop worn as a hat replaces its own hat. */
export function modelAppearance(look: CastLook): Appearance {
  return HAT_PROPS.has(look.prop) ? { ...look.appearance, hat: HAT_STYLES.none } : look.appearance;
}
