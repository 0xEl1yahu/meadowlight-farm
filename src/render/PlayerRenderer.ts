/**
 * PlayerRenderer — the visual half of the character controller.
 *
 * The simulation moves the farmer one whole tile at a time; this system turns those discrete
 * steps into continuous motion and a layered animation. It never mutates or dispatches.
 *
 * Movement
 * - A new `player.moveSeq` starts a cubic Hermite lerp from the CURRENT visual position to the
 *   new tile centre over PLAYER.moveDurationSeconds. The start tangent carries the current
 *   velocity, so a move that arrives mid-lerp — or right after one ends, as held keys do —
 *   continues smoothly instead of snapping back or stuttering. A single step eases in and out;
 *   a step that ends mid-frame coasts on for the rest of that frame so a chained step picks up
 *   seamlessly, and otherwise settles back onto the tile centre within a few frames.
 * - A new `teleportSeq` (sleep, a warp, load), a change of map and a full rebuild snap instantly.
 *   Everything reads the active map's world.
 * - The feet stand on grass, or on a path object's planks (HEIGHTS.pathTop, eased); the ground
 *   blob follows the surface underneath (soil, grass or path).
 * - The yaw eases toward directionYaw(facing) along the shortest arc in ~0.1 s.
 * - `focus` always equals the visual feet position (y = HEIGHTS.grassTop); main.ts makes the
 *   camera follow it.
 *
 * Animation, evaluated every frame into one Pose (see playerModel.ts)
 * 1. Carry stance for the held prop (eased when the prop changes). While the player carries a
 *    robot (`player.carrying !== null`) both arms rise to hold it and the held prop hides.
 * 2. Walk cycle driven by distance travelled (legs, counter-swinging arms, bob, twist).
 * 3. Idle breathing and blinking.
 * 4. Keyframed action clips triggered by `actionSeq` (state.player.lastAction): overhead chops
 *    for hoe and pickaxe, a sideways axe chop, a watering-can pour, a scythe sweep, crouch-and-
 *    place for planting, crouch-and-lift for harvesting, a toss for shipping and a dip for
 *    refilling. Failed actions play a faster, smaller version of the same clip. Clip keys only
 *    list the joints they drive; every other joint follows the live base pose, so a clip can
 *    play while walking without freezing the legs.
 *
 * Held item
 * - The selected hotbar stack decides the prop: a tool model, a seed pouch tinted with the
 *   item colour, or a gem-like item for produce and materials; an empty slot shows nothing.
 * - When the stack changes while a clip is playing (planting the last seed, shipping the
 *   stack), the swap waits for the clip's release moment so the item leaves the hand on cue.
 */
import * as THREE from 'three';
import { PLAYER } from '../config';
import { Salt, mulberry32 } from '../core/hash';
import type { ActionKind, GameState, ItemStack, MapId, Tile } from '../core/types';
import { getItem } from '../items/items';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
import { getTile, isPathObject, isSoil } from '../world/tiles';
import { HEIGHTS } from './constants';
import {
  HeldItemRack,
  PLAYER_RIG,
  PlayerModel,
  applyPose,
  blendPose,
  copyPose,
  createPose,
  POSE_KEYS,
  type HeldModelKind,
  type Pose,
} from './playerModel';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';
import { selectActiveWorld } from '../state/selectors';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const MOVE_SECONDS = PLAYER.moveDurationSeconds;
/** A move arriving this soon after the previous step ended still counts as a continuous walk. */
const CHAIN_GRACE_SECONDS = 0.07;
/** End speed of a step, as a fraction of its average speed (0 = ease to a stop). */
const FIRST_STEP_END_SLOPE = 0.3;
const CHAINED_STEP_END_SLOPE = 0.55;
/** Longest carried start tangent (world units); keeps sharp reversals from looping. */
const MAX_START_TANGENT = 1.2;
/**
 * A step that finishes mid-frame coasts past the tile centre at its end velocity for the rest
 * of that frame (at most this long), so a chained step continues without a one-frame stall.
 * Without a follow-up move the character settles back onto the centre.
 */
const MAX_COAST_SECONDS = 1 / 45;
const SETTLE_RATE = 30;

/** Exponential rates (1/s). */
const FACING_RATE = 28;
const WALK_BLEND_RATE = 12;
const CARRY_RATE = 14;
const GROUND_RATE = 12;

/** World distance covered by half a gait cycle (one foot passing the other). */
const STRIDE_LENGTH = 0.55;
const WALK_LEG_SWING = 0.62;
const WALK_ARM_SWING = 0.5;
const WALK_LEAN = 0.1;
const WALK_TWIST = 0.12;
const WALK_BOUNCE = 0.015;

const BREATH_RATE = 2.3;

/** Cross-fade applied whenever a clip starts, so interrupting a pose never pops. */
const CLIP_BLEND_SECONDS = 0.08;
/** Failed actions play faster and smaller. */
const FAILED_TIME_SCALE = 0.7;
const FAILED_WEIGHT = 0.6;

const HELD_POP_SECONDS = 0.2;
const BLINK_SECONDS = 0.13;
const BLINK_MIN_INTERVAL = 2.2;
const BLINK_INTERVAL_RANGE = 3.4;
const DOUBLE_BLINK_CHANCE = 0.2;
const DOUBLE_BLINK_GAP = 0.16;
/** Height of the contact shadow above the ground it sits on. */
export const BLOB_LIFT = 0.012;

const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Carry stances
// ---------------------------------------------------------------------------

type CarryStyle = 'empty' | 'tool' | 'scythe' | 'can' | 'small' | 'robot';

/**
 * Rest pose per held prop. Prop pitch in the world ≈ lean − armSwing + wristPitch, so
 * e.g. a tool at armSwing 0.32 / wristPitch 0.55 leans ~0.23 rad forward.
 */
const CARRY_POSES: Readonly<Record<CarryStyle, Pose>> = {
  empty: createPose({ rArmSwing: 0.06, rArmSpread: 0.1, lArmSwing: 0.06, lArmSpread: 0.1 }),
  tool: createPose({
    rArmSwing: 0.32,
    rArmSpread: 0.15,
    lArmSwing: 0.06,
    lArmSpread: 0.1,
    wristPitch: 0.55,
    wristRoll: 0.4,
  }),
  scythe: createPose({
    rArmSwing: 0.3,
    rArmSpread: 0.15,
    lArmSwing: 0.06,
    lArmSpread: 0.1,
    wristPitch: 0.5,
    wristTwist: -1.3,
    wristRoll: 0.35,
  }),
  can: createPose({
    rArmSwing: 0.12,
    rArmSpread: 0.22,
    lArmSwing: 0.06,
    lArmSpread: 0.1,
    wristPitch: 0.12,
    wristRoll: 0.22,
    tilt: -0.04,
  }),
  small: createPose({ rArmSwing: 0.75, rArmSpread: 0.05, rArmYaw: 0.3, lArmSwing: 0.06, lArmSpread: 0.1, wristPitch: 0.75 }),
  /** Both arms raised to hold a robot overhead (farmclaws part 1 §7.4). */
  robot: createPose({ rArmSwing: 1.25, rArmSpread: 0.22, lArmSwing: 1.25, lArmSpread: 0.22, lean: -0.05 }),
};

/** How much of the walk arm swing the right arm keeps while carrying. */
const CARRY_ARM_SWING: Readonly<Record<CarryStyle, number>> = {
  empty: 1,
  tool: 0.4,
  scythe: 0.4,
  can: 0.35,
  small: 0.3,
  robot: 0.1,
};

function carryStyleFor(kind: HeldModelKind | null): CarryStyle {
  switch (kind) {
    case null:
      return 'empty';
    case 'hoe':
    case 'pickaxe':
    case 'axe':
      return 'tool';
    case 'scythe':
      return 'scythe';
    case 'wateringCan':
      return 'can';
    case 'pouch':
    case 'gem':
      return 'small';
  }
}

interface HeldChoice {
  readonly kind: HeldModelKind | null;
  readonly color: number;
}

const EMPTY_HAND: HeldChoice = { kind: null, color: 0 };

function heldChoiceFor(stack: ItemStack | null): HeldChoice {
  if (stack === null) return EMPTY_HAND;
  const item = getItem(stack.itemId);
  switch (item.kind) {
    case 'tool':
      return { kind: item.tool, color: item.color };
    case 'seed':
      return { kind: 'pouch', color: item.color };
    case 'fertilizer':
      return { kind: 'pouch', color: item.color };
    case 'produce':
    case 'material':
    case 'placeable':
      return { kind: 'gem', color: item.color };
  }
}

// ---------------------------------------------------------------------------
// Action clips
// ---------------------------------------------------------------------------

type EaseKind = 'linear' | 'in' | 'out' | 'inOut';

interface ClipKey {
  /** Normalised time in [0, 1]. */
  readonly at: number;
  /** Easing of the segment that ENDS at this key. */
  readonly ease: EaseKind;
  /** Joints driven at this key; omitted joints follow the live base pose. */
  readonly pose: Readonly<Partial<Pose>>;
}

interface ActionClip {
  /** Seconds, at full (successful) speed. */
  readonly duration: number;
  /** Normalised time at which the item leaves the hand / the tool connects. */
  readonly release: number;
  /** Sorted by `at`; the first key is at 0 and the last at 1, both empty (= base pose). */
  readonly keys: readonly ClipKey[];
}

type AnimatedAction = Exclude<ActionKind, 'sleep' | 'none'>;

function key(at: number, ease: EaseKind, pose: Readonly<Partial<Pose>> = {}): ClipKey {
  return { at, ease, pose };
}

/** Hoe: lift overhead with both hands, chop down into the tile ahead. */
const HOE_CHOP: ActionClip = {
  duration: 0.42,
  release: 0.62,
  keys: [
    key(0, 'linear'),
    key(0.38, 'out', {
      crouch: -0.01,
      lean: -0.2,
      headPitch: -0.25,
      rArmSwing: 3.25,
      rArmSpread: -0.1,
      lArmSwing: 2.9,
      lArmSpread: -0.28,
      wristPitch: 1.55,
      wristRoll: 0,
    }),
    key(0.62, 'in', {
      crouch: 0.06,
      hipsForward: 0.05,
      lean: 0.42,
      headPitch: 0.3,
      rArmSwing: 1.05,
      rArmSpread: -0.08,
      lArmSwing: 1.0,
      lArmSpread: -0.3,
      wristPitch: 2.93,
      wristRoll: 0,
      lLegSwing: 0.2,
      rLegSwing: -0.14,
    }),
    key(0.78, 'out', {
      crouch: 0.05,
      hipsForward: 0.04,
      lean: 0.36,
      headPitch: 0.25,
      rArmSwing: 1.18,
      rArmSpread: -0.08,
      lArmSwing: 1.1,
      lArmSpread: -0.28,
      wristPitch: 2.8,
      wristRoll: 0,
      lLegSwing: 0.18,
      rLegSwing: -0.12,
    }),
    key(1, 'inOut'),
  ],
};

/** Pickaxe: a heavier overhead swing with a little hop on the wind-up and a harder strike. */
const PICKAXE_CHOP: ActionClip = {
  duration: 0.44,
  release: 0.64,
  keys: [
    key(0, 'linear'),
    key(0.4, 'out', {
      hop: 0.02,
      crouch: -0.015,
      lean: -0.24,
      headPitch: -0.28,
      rArmSwing: 3.35,
      rArmSpread: -0.1,
      lArmSwing: 3.0,
      lArmSpread: -0.28,
      wristPitch: 1.6,
      wristRoll: 0,
    }),
    key(0.64, 'in', {
      crouch: 0.07,
      hipsForward: 0.06,
      lean: 0.46,
      headPitch: 0.34,
      rArmSwing: 1.0,
      rArmSpread: -0.08,
      lArmSwing: 0.96,
      lArmSpread: -0.3,
      wristPitch: 2.95,
      wristRoll: 0,
      lLegSwing: 0.22,
      rLegSwing: -0.16,
    }),
    key(0.8, 'out', {
      crouch: 0.055,
      hipsForward: 0.045,
      lean: 0.38,
      headPitch: 0.26,
      rArmSwing: 1.2,
      rArmSpread: -0.08,
      lArmSwing: 1.12,
      lArmSpread: -0.28,
      wristPitch: 2.78,
      wristRoll: 0,
      lLegSwing: 0.2,
      rLegSwing: -0.13,
    }),
    key(1, 'inOut'),
  ],
};

/** Axe: wind up to the right, chop horizontally across the front with the blade leading. */
const AXE_CHOP: ActionClip = {
  duration: 0.42,
  release: 0.6,
  keys: [
    key(0, 'linear'),
    key(0.36, 'out', {
      crouch: 0.02,
      lean: -0.05,
      twist: -1.05,
      tilt: 0.08,
      headPitch: 0.05,
      rArmSwing: 1.25,
      rArmSpread: 0.75,
      rArmYaw: 0,
      lArmSwing: 1.1,
      lArmSpread: -0.35,
      lArmYaw: -0.5,
      wristPitch: 2.5,
      wristRoll: 0,
      wristTwist: 1.57,
      lLegSwing: 0.15,
      rLegSwing: -0.15,
    }),
    key(0.6, 'in', {
      crouch: 0.06,
      lean: 0.2,
      twist: 0.55,
      tilt: -0.05,
      headPitch: 0.15,
      rArmSwing: 1.15,
      rArmSpread: 0.15,
      rArmYaw: 0,
      lArmSwing: 1.05,
      lArmSpread: -0.45,
      lArmYaw: -0.3,
      wristPitch: 3.05,
      wristRoll: 0,
      wristTwist: 1.57,
      lLegSwing: 0.22,
      rLegSwing: -0.18,
    }),
    key(0.78, 'out', {
      crouch: 0.04,
      lean: 0.15,
      twist: 0.4,
      tilt: -0.03,
      headPitch: 0.1,
      rArmSwing: 1.0,
      rArmSpread: 0.2,
      rArmYaw: 0,
      lArmSwing: 0.9,
      lArmSpread: -0.3,
      lArmYaw: -0.2,
      wristPitch: 2.8,
      wristRoll: 0,
      wristTwist: 1.3,
      lLegSwing: 0.18,
      rLegSwing: -0.14,
    }),
    key(1, 'inOut'),
  ],
};

/** Watering can: raise the can, tip it forward and hold the pour. */
const CAN_POUR: ActionClip = {
  duration: 0.45,
  release: 0.5,
  keys: [
    key(0, 'linear'),
    key(0.3, 'out', {
      hipsForward: 0.03,
      lean: 0.16,
      headPitch: 0.2,
      rArmSwing: 1.15,
      rArmSpread: 0.08,
      rArmYaw: 0.2,
      lArmSwing: 0.25,
      lArmSpread: 0.2,
      wristPitch: 1.0,
      wristRoll: 0,
    }),
    key(0.46, 'inOut', {
      crouch: 0.03,
      hipsForward: 0.05,
      lean: 0.24,
      headPitch: 0.32,
      rArmSwing: 1.25,
      rArmSpread: 0.08,
      rArmYaw: 0.2,
      lArmSwing: 0.3,
      lArmSpread: 0.25,
      wristPitch: 1.86,
      wristRoll: 0,
    }),
    key(0.74, 'linear', {
      crouch: 0.035,
      hipsForward: 0.05,
      lean: 0.25,
      headPitch: 0.34,
      rArmSwing: 1.22,
      rArmSpread: 0.08,
      rArmYaw: 0.18,
      lArmSwing: 0.3,
      lArmSpread: 0.25,
      wristPitch: 1.95,
      wristRoll: 0,
    }),
    key(1, 'inOut'),
  ],
};

/** Scythe: wind across the body, then sweep the blade low through the tile ahead. */
const SCYTHE_SWEEP: ActionClip = {
  duration: 0.38,
  release: 0.6,
  keys: [
    key(0, 'linear'),
    key(0.3, 'out', {
      crouch: 0.03,
      lean: 0.15,
      twist: 0.95,
      headPitch: 0.15,
      rArmSwing: 0.9,
      rArmSpread: -0.15,
      rArmYaw: 0.4,
      lArmSwing: 0.4,
      lArmSpread: 0.3,
      wristPitch: 2.4,
      wristRoll: 0,
      wristTwist: 0,
    }),
    key(0.62, 'in', {
      crouch: 0.08,
      lean: 0.34,
      twist: -0.72,
      headPitch: 0.25,
      rArmSwing: 1.0,
      rArmSpread: 0.32,
      rArmYaw: -0.1,
      lArmSwing: 0.3,
      lArmSpread: 0.45,
      wristPitch: 2.7,
      wristRoll: 0,
      wristTwist: 0,
      lLegSwing: 0.15,
      rLegSwing: -0.15,
    }),
    key(0.8, 'out', {
      crouch: 0.05,
      lean: 0.24,
      twist: -0.6,
      headPitch: 0.18,
      rArmSwing: 0.85,
      rArmSpread: 0.28,
      rArmYaw: -0.05,
      lArmSwing: 0.25,
      lArmSpread: 0.35,
      wristPitch: 2.4,
      wristRoll: 0,
      wristTwist: -0.3,
      lLegSwing: 0.12,
      rLegSwing: -0.12,
    }),
    key(1, 'inOut'),
  ],
};

/** Planting: crouch into a lunge, tip the pouch over the soil, rise. */
const PLANT: ActionClip = {
  duration: 0.42,
  release: 0.58,
  keys: [
    key(0, 'linear'),
    key(0.38, 'out', {
      crouch: 0.14,
      hipsForward: 0.045,
      lean: 0.6,
      headPitch: 0.35,
      rArmSwing: 1.45,
      rArmSpread: 0.05,
      rArmYaw: 0.15,
      lArmSwing: 0.3,
      lArmSpread: 0.28,
      wristPitch: 1.3,
      lLegSwing: 0.55,
      rLegSwing: -0.42,
    }),
    key(0.58, 'inOut', {
      crouch: 0.15,
      hipsForward: 0.05,
      lean: 0.66,
      headPitch: 0.42,
      rArmSwing: 1.62,
      rArmSpread: 0.05,
      rArmYaw: 0.12,
      lArmSwing: 0.32,
      lArmSpread: 0.3,
      wristPitch: 2.1,
      lLegSwing: 0.55,
      rLegSwing: -0.42,
    }),
    key(0.72, 'out', {
      crouch: 0.13,
      hipsForward: 0.045,
      lean: 0.56,
      headPitch: 0.3,
      rArmSwing: 1.4,
      rArmSpread: 0.08,
      rArmYaw: 0.12,
      lArmSwing: 0.3,
      lArmSpread: 0.28,
      wristPitch: 1.4,
      lLegSwing: 0.5,
      rLegSwing: -0.38,
    }),
    key(1, 'inOut'),
  ],
};

/** Harvest: crouch and grab with both hands, then pop up holding the crop overhead. */
const HARVEST: ActionClip = {
  duration: 0.46,
  release: 0.45,
  keys: [
    key(0, 'linear'),
    key(0.3, 'out', {
      crouch: 0.13,
      hipsForward: 0.045,
      lean: 0.6,
      headPitch: 0.3,
      rArmSwing: 1.4,
      rArmSpread: -0.12,
      lArmSwing: 1.4,
      lArmSpread: -0.12,
      lLegSwing: 0.52,
      rLegSwing: -0.4,
    }),
    key(0.42, 'linear', {
      crouch: 0.14,
      hipsForward: 0.05,
      lean: 0.64,
      headPitch: 0.35,
      rArmSwing: 1.52,
      rArmSpread: -0.14,
      lArmSwing: 1.52,
      lArmSpread: -0.14,
      lLegSwing: 0.54,
      rLegSwing: -0.42,
    }),
    key(0.7, 'out', {
      hop: 0.07,
      crouch: -0.02,
      lean: -0.12,
      headPitch: -0.3,
      rArmSwing: 2.95,
      rArmSpread: 0.28,
      lArmSwing: 2.95,
      lArmSpread: 0.28,
    }),
    key(0.84, 'linear', {
      hop: 0,
      crouch: 0.01,
      lean: -0.1,
      headPitch: -0.25,
      rArmSwing: 2.85,
      rArmSpread: 0.3,
      lArmSwing: 2.85,
      lArmSpread: 0.3,
    }),
    key(1, 'inOut'),
  ],
};

/** Shipping: swing the arm back, then toss forward and up into the bin. */
const SHIP_TOSS: ActionClip = {
  duration: 0.4,
  release: 0.56,
  keys: [
    key(0, 'linear'),
    key(0.34, 'out', {
      crouch: 0.05,
      lean: -0.08,
      twist: -0.35,
      headPitch: 0.05,
      rArmSwing: -0.65,
      rArmSpread: 0.22,
      lArmSwing: 0.45,
      lArmSpread: 0.15,
      lLegSwing: 0.18,
      rLegSwing: -0.18,
    }),
    key(0.56, 'in', {
      hop: 0.03,
      crouch: -0.01,
      lean: 0.16,
      twist: 0.28,
      headPitch: -0.15,
      rArmSwing: 2.3,
      rArmSpread: 0.1,
      lArmSwing: -0.3,
      lArmSpread: 0.2,
      lLegSwing: 0.22,
      rLegSwing: -0.1,
    }),
    key(0.76, 'out', {
      lean: 0.1,
      twist: 0.18,
      headPitch: -0.05,
      rArmSwing: 1.85,
      rArmSpread: 0.12,
      lArmSwing: -0.1,
      lArmSpread: 0.15,
      lLegSwing: 0.12,
      rLegSwing: -0.06,
    }),
    key(1, 'inOut'),
  ],
};

/** Refill: kneel at the water, dip the can in, lift it out. */
const REFILL_DIP: ActionClip = {
  duration: 0.46,
  release: 0.6,
  keys: [
    key(0, 'linear'),
    key(0.34, 'inOut', {
      crouch: 0.14,
      hipsForward: 0.05,
      lean: 0.72,
      headPitch: 0.35,
      rArmSwing: 1.75,
      rArmSpread: 0.1,
      lArmSwing: 0.25,
      lArmSpread: 0.3,
      wristPitch: 1.48,
      wristRoll: 0,
      lLegSwing: 0.55,
      rLegSwing: -0.42,
    }),
    key(0.6, 'linear', {
      crouch: 0.15,
      hipsForward: 0.055,
      lean: 0.76,
      headPitch: 0.38,
      rArmSwing: 1.85,
      rArmSpread: 0.1,
      lArmSwing: 0.28,
      lArmSpread: 0.3,
      wristPitch: 1.3,
      wristRoll: 0,
      lLegSwing: 0.56,
      rLegSwing: -0.43,
    }),
    key(0.82, 'out', {
      crouch: 0.03,
      lean: 0.15,
      headPitch: 0.1,
      rArmSwing: 0.6,
      rArmSpread: 0.15,
      lArmSwing: 0.1,
      lArmSpread: 0.15,
      wristPitch: 0.45,
      wristRoll: 0,
      lLegSwing: 0.12,
      rLegSwing: -0.1,
    }),
    key(1, 'inOut'),
  ],
};

const ACTION_CLIPS: Readonly<Record<AnimatedAction, ActionClip>> = {
  hoe: HOE_CHOP,
  pickaxe: PICKAXE_CHOP,
  axe: AXE_CHOP,
  wateringCan: CAN_POUR,
  scythe: SCYTHE_SWEEP,
  plant: PLANT,
  harvest: HARVEST,
  ship: SHIP_TOSS,
  refill: REFILL_DIP,
  /** Lifting a chest lid reads like the shipping-bin toss. */
  openChest: SHIP_TOSS,
  /** Setting an object down and mixing in fertiliser both crouch like planting. */
  place: PLANT,
  fertilize: PLANT,
};

/** Height of the surface under the player's tile: path planks, sunken soil or grass. */
export function playerGroundHeight(tile: Tile | null): number {
  if (tile === null) return HEIGHTS.grassTop;
  if (tile.object !== null && isPathObject(tile.object)) return HEIGHTS.pathTop;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

/** World height of the model root: feet rise onto path planks but stay at grass height over sunken soil. */
export function playerRootHeight(groundY: number): number {
  return Math.max(HEIGHTS.grassTop, groundY);
}

/** Ground blob height local to the root, so the shadow sits BLOB_LIFT above the surface whatever the root height. */
export function playerBlobLocalHeight(groundY: number): number {
  return groundY - playerRootHeight(groundY) + BLOB_LIFT;
}

function clipFor(kind: ActionKind): ActionClip | null {
  return kind === 'sleep' || kind === 'none' ? null : ACTION_CLIPS[kind];
}

function validateClip(name: string, clip: ActionClip): void {
  const first = clip.keys[0];
  const last = clip.keys[clip.keys.length - 1];
  if (first === undefined || last === undefined || clip.keys.length < 2 || first.at !== 0 || last.at !== 1) {
    throw new Error(`PlayerRenderer: clip "${name}" must start at 0 and end at 1`);
  }
  for (let i = 1; i < clip.keys.length; i++) {
    const previous = clip.keys[i - 1];
    const current = clip.keys[i];
    if (previous === undefined || current === undefined || !(current.at > previous.at)) {
      throw new Error(`PlayerRenderer: clip "${name}" keys must be strictly increasing`);
    }
  }
  if (!(clip.duration > 0) || !(clip.release >= 0 && clip.release <= 1)) {
    throw new Error(`PlayerRenderer: clip "${name}" has an invalid duration or release`);
  }
}

for (const [name, clip] of Object.entries(ACTION_CLIPS)) validateClip(name, clip);

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function ease(kind: EaseKind, t: number): number {
  switch (kind) {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out': {
      const inv = 1 - t;
      return 1 - inv * inv * inv;
    }
    case 'inOut':
      return t * t * (3 - 2 * t);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Wraps an angle into [-π, π). */
function wrapAngle(angle: number): number {
  return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}

/** Frame-rate independent smoothing factor for an exponential approach at `rate` (1/s). */
function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * Samples `clip` at normalised time `progress` into `out`. Joints a key omits take the value
 * of `base`, so clips layer over the live locomotion pose.
 */
function sampleClip(clip: ActionClip, progress: number, base: Readonly<Pose>, out: Pose): void {
  const keys = clip.keys;
  let index = 0;
  while (index < keys.length - 2) {
    const next = keys[index + 1];
    if (next === undefined || progress < next.at) break;
    index++;
  }
  const from = keys[index];
  const to = keys[index + 1];
  if (from === undefined || to === undefined) {
    copyPose(out, base);
    return;
  }
  const span = to.at - from.at;
  const t = ease(to.ease, span > 0 ? clamp01((progress - from.at) / span) : 1);
  for (const joint of POSE_KEYS) {
    const a = from.pose[joint] ?? base[joint];
    const b = to.pose[joint] ?? base[joint];
    out[joint] = a + (b - a) * t;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class PlayerRenderer implements RenderSystem {
  /** The character's current (lerped) feet position; the camera follows it. */
  readonly focus = new THREE.Vector3(0, HEIGHTS.grassTop, 0);

  private readonly ctx: SceneContext;
  private readonly model: PlayerModel;
  private readonly held: HeldItemRack;

  // Sequence numbers already consumed; -1 until the first sync.
  private moveSeq = -1;
  private teleportSeq = -1;
  /** Map the character was last placed on; null before the first sync. */
  private mapId: MapId | null = null;
  private actionSeq = -1;

  // Movement (world XZ; y is unused and kept at grassTop).
  private readonly position = new THREE.Vector3(0, HEIGHTS.grassTop, 0);
  private readonly velocity = new THREE.Vector3();
  private readonly lerpFrom = new THREE.Vector3();
  private readonly lerpTo = new THREE.Vector3();
  private readonly tangentStart = new THREE.Vector3();
  private readonly tangentEnd = new THREE.Vector3();
  /** Velocity at the end of the last completed step (carried into a chained step). */
  private readonly releaseVelocity = new THREE.Vector3();
  private lerping = false;
  private lerpElapsed = 0;
  private sinceLerpEnd = Number.POSITIVE_INFINITY;
  /** True while the visual position is off the tile centre after a coasting step end. */
  private settling = false;

  // Facing & ground contact.
  private yaw = 0;
  private targetYaw = 0;
  private groundY: number = HEIGHTS.grassTop;
  private targetGroundY: number = HEIGHTS.grassTop;

  // Locomotion.
  private walkPhase = 0;
  private walkBlend = 0;

  // Carry stance (eased toward the held prop's stance).
  private carryStyle: CarryStyle = 'empty';
  /** True while the player carries a robot: the robot stance overrides the held prop's, and the prop hides. */
  private carryingRobot = false;
  private readonly carry = createPose();
  private carryArmSwing = 1;

  // Active action clip.
  private clip: ActionClip | null = null;
  private clipElapsed = 0;
  private clipDuration = 1;
  private clipWeight = 1;
  private clipReleased = false;
  private readonly transitionFrom = createPose();
  private transitionElapsed = Number.POSITIVE_INFINITY;

  // Held prop swap deferred to the current clip's release moment.
  private hasPendingHeld = false;
  private pendingHeld: HeldChoice = EMPTY_HAND;
  private heldPopElapsed = Number.POSITIVE_INFINITY;

  // Blinking.
  private readonly blinkRandom = mulberry32(Salt.Cosmetic ^ 0x0b11b);
  private blinkCountdown = BLINK_MIN_INTERVAL;
  private blinkElapsed = Number.POSITIVE_INFINITY;

  // Scratch poses (reused every frame).
  private readonly basePose = createPose();
  private readonly clipPose = createPose();
  private readonly finalPose = createPose();

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.model = new PlayerModel();
    this.held = new HeldItemRack();
    this.model.rightWrist.add(this.held.socket);
    copyPose(this.carry, CARRY_POSES.empty);
    copyPose(this.finalPose, this.carry);
    applyPose(this.model, this.finalPose);
    ctx.scene.add(this.model.root);
  }

  sync(state: GameState, prev: GameState | null): void {
    // Everything this system derives comes from the player, the inventory and the world, so
    // clock ticks and UI changes are free.
    if (prev !== null && state.player === prev.player && state.inventory === prev.inventory && selectActiveWorld(state) === selectActiveWorld(prev)) {
      return;
    }
    const { player } = state;
    const grid = selectActiveWorld(state).grid;
    const centreX = tileCenterX(grid, player.tx);
    const centreZ = tileCenterZ(grid, player.tz);
    const teleported = prev === null || player.teleportSeq !== this.teleportSeq || player.mapId !== this.mapId;

    if (teleported) {
      this.snapTo(centreX, centreZ, directionYaw(player.facing));
    } else if (player.moveSeq !== this.moveSeq) {
      this.startMove(centreX, centreZ);
    }
    this.targetYaw = directionYaw(player.facing);

    const tile = getTile(selectActiveWorld(state), player.tx, player.tz);
    this.targetGroundY = playerGroundHeight(tile);
    if (teleported) this.groundY = this.targetGroundY;

    if (teleported) {
      this.stopClip();
    } else if (player.actionSeq !== this.actionSeq && player.lastAction !== null) {
      this.startClip(player.lastAction.kind, player.lastAction.success);
    }

    this.moveSeq = player.moveSeq;
    this.teleportSeq = player.teleportSeq;
    this.mapId = player.mapId;
    this.actionSeq = player.actionSeq;

    this.carryingRobot = player.carrying !== null;
    this.syncHeldItem(state, teleported);
    if (teleported) this.placeRoot();
  }

  update(frame: FrameContext): void {
    const dt = frame.dt;
    this.updateMovement(dt);
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.targetYaw - this.yaw) * damp(FACING_RATE, dt));
    this.groundY += (this.targetGroundY - this.groundY) * damp(GROUND_RATE, dt);
    this.placeRoot();
    this.updatePose(dt, frame.elapsed);
    this.updateBlink(dt);
    this.updateHeldPop(dt);
  }

  dispose(): void {
    this.ctx.scene.remove(this.model.root);
    this.held.dispose();
    this.model.dispose();
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  private snapTo(x: number, z: number, yaw: number): void {
    this.position.set(x, HEIGHTS.grassTop, z);
    this.velocity.set(0, 0, 0);
    this.releaseVelocity.set(0, 0, 0);
    this.lerping = false;
    this.lerpElapsed = 0;
    this.sinceLerpEnd = Number.POSITIVE_INFINITY;
    this.settling = false;
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.walkBlend = 0;
    this.walkPhase = 0;
  }

  /** Starts a step from the current visual position, carrying the current velocity. */
  private startMove(x: number, z: number): void {
    const chained = this.lerping || this.sinceLerpEnd <= CHAIN_GRACE_SECONDS;
    if (this.lerping) {
      this.tangentStart.copy(this.velocity);
    } else if (chained) {
      this.tangentStart.copy(this.releaseVelocity);
    } else {
      this.tangentStart.set(0, 0, 0);
    }
    this.tangentStart.y = 0;
    this.tangentStart.multiplyScalar(MOVE_SECONDS);
    if (this.tangentStart.length() > MAX_START_TANGENT) this.tangentStart.setLength(MAX_START_TANGENT);

    this.lerpFrom.copy(this.position);
    this.lerpTo.set(x, HEIGHTS.grassTop, z);
    this.tangentEnd
      .subVectors(this.lerpTo, this.lerpFrom)
      .multiplyScalar(chained ? CHAINED_STEP_END_SLOPE : FIRST_STEP_END_SLOPE);
    this.lerpElapsed = 0;
    this.lerping = true;
    this.settling = false;
  }

  /** Advances the Hermite step and derives the visual velocity analytically. */
  private updateMovement(dt: number): void {
    if (!this.lerping) {
      this.sinceLerpEnd += dt;
      this.velocity.set(0, 0, 0);
      if (this.settling) this.settle(dt);
      return;
    }
    this.lerpElapsed += dt;
    if (this.lerpElapsed >= MOVE_SECONDS) {
      const coast = Math.min(this.lerpElapsed - MOVE_SECONDS, MAX_COAST_SECONDS);
      this.releaseVelocity.copy(this.tangentEnd).divideScalar(MOVE_SECONDS);
      this.position.copy(this.lerpTo).addScaledVector(this.releaseVelocity, coast);
      this.position.y = HEIGHTS.grassTop;
      this.velocity.set(0, 0, 0);
      this.lerping = false;
      this.settling = coast > 0;
      this.sinceLerpEnd = this.lerpElapsed - MOVE_SECONDS;
      return;
    }

    const u = this.lerpElapsed / MOVE_SECONDS;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const d00 = 6 * u2 - 6 * u;
    const d10 = 3 * u2 - 4 * u + 1;
    const d01 = -6 * u2 + 6 * u;
    const d11 = 3 * u2 - 2 * u;
    const from = this.lerpFrom;
    const to = this.lerpTo;
    const m0 = this.tangentStart;
    const m1 = this.tangentEnd;

    this.position.x = h00 * from.x + h10 * m0.x + h01 * to.x + h11 * m1.x;
    this.position.z = h00 * from.z + h10 * m0.z + h01 * to.z + h11 * m1.z;
    this.velocity.x = (d00 * from.x + d10 * m0.x + d01 * to.x + d11 * m1.x) / MOVE_SECONDS;
    this.velocity.z = (d00 * from.z + d10 * m0.z + d01 * to.z + d11 * m1.z) / MOVE_SECONDS;
  }

  /** Eases a coasting overshoot back onto the destination tile centre. */
  private settle(dt: number): void {
    const k = damp(SETTLE_RATE, dt);
    this.position.x += (this.lerpTo.x - this.position.x) * k;
    this.position.z += (this.lerpTo.z - this.position.z) * k;
    if (Math.abs(this.lerpTo.x - this.position.x) + Math.abs(this.lerpTo.z - this.position.z) < 1e-4) {
      this.position.x = this.lerpTo.x;
      this.position.z = this.lerpTo.z;
      this.settling = false;
    }
  }

  private placeRoot(): void {
    const root = this.model.root;
    root.position.set(this.position.x, playerRootHeight(this.groundY), this.position.z);
    root.rotation.y = this.yaw;
    // The blob is a child of the root, so its height is relative to where the root actually sits.
    this.model.groundBlob.position.y = playerBlobLocalHeight(this.groundY);
    this.focus.set(this.position.x, HEIGHTS.grassTop, this.position.z);
  }

  // -------------------------------------------------------------------------
  // Pose layering
  // -------------------------------------------------------------------------

  private updatePose(dt: number, elapsed: number): void {
    // 1. Carry stance, eased toward the held prop's rest pose.
    const carryFactor = damp(CARRY_RATE, dt);
    const stance = this.stance();
    blendPose(this.carry, this.carry, CARRY_POSES[stance], carryFactor);
    this.carryArmSwing += (CARRY_ARM_SWING[stance] - this.carryArmSwing) * carryFactor;
    this.held.socket.visible = !this.carryingRobot;
    const base = copyPose(this.basePose, this.carry);

    // 2. Walk cycle, phase-locked to the distance travelled.
    const walking = this.lerping || this.sinceLerpEnd <= CHAIN_GRACE_SECONDS;
    this.walkBlend += ((walking ? 1 : 0) - this.walkBlend) * damp(WALK_BLEND_RATE, dt);
    const speed = this.lerping
      ? Math.hypot(this.velocity.x, this.velocity.z)
      : walking
        ? Math.hypot(this.releaseVelocity.x, this.releaseVelocity.z)
        : 0;
    this.walkPhase = (this.walkPhase + (speed * dt * Math.PI) / STRIDE_LENGTH) % TWO_PI;
    if (this.walkBlend > 1e-3) {
      const weight = this.walkBlend;
      const stride = Math.sin(this.walkPhase);
      const legAngle = WALK_LEG_SWING * stride * weight;
      base.lLegSwing += legAngle;
      base.rLegSwing -= legAngle;
      // Hips ride lowest at full stride so both feet stay planted, plus a little bounce.
      base.crouch += PLAYER_RIG.legLength * (1 - Math.cos(legAngle));
      base.hop += WALK_BOUNCE * weight * Math.max(0, Math.cos(2 * this.walkPhase));
      base.rArmSwing += WALK_ARM_SWING * stride * weight * this.carryArmSwing;
      base.lArmSwing -= WALK_ARM_SWING * stride * weight;
      base.lean += WALK_LEAN * weight;
      base.headPitch -= WALK_LEAN * 0.5 * weight;
      base.twist += WALK_TWIST * stride * weight;
    }

    // 3. Idle breathing (damped while walking).
    const breath = Math.sin(elapsed * BREATH_RATE) * (1 - 0.7 * this.walkBlend);
    base.breath += breath;
    base.rArmSpread += 0.015 * breath;
    base.lArmSpread += 0.015 * breath;
    base.headPitch -= 0.02 * breath;

    // 4. Action clip layered on top.
    const final = this.finalPose;
    const clip = this.clip;
    if (clip === null) {
      copyPose(final, base);
    } else {
      this.clipElapsed += dt;
      const progress = this.clipElapsed / this.clipDuration;
      if (!this.clipReleased && progress >= clip.release) {
        this.clipReleased = true;
        this.flushPendingHeld();
      }
      if (progress >= 1) {
        this.stopClip();
        copyPose(final, base);
      } else {
        sampleClip(clip, progress, base, this.clipPose);
        blendPose(final, base, this.clipPose, this.clipWeight);
      }
    }

    // Cross-fade from the pose held when the latest clip started.
    if (this.transitionElapsed < CLIP_BLEND_SECONDS) {
      this.transitionElapsed += dt;
      const t = clamp01(this.transitionElapsed / CLIP_BLEND_SECONDS);
      blendPose(final, this.transitionFrom, final, t * t * (3 - 2 * t));
    }

    applyPose(this.model, final);
  }

  private startClip(kind: ActionKind, success: boolean): void {
    // A swap deferred by an interrupted clip happens now.
    this.flushPendingHeld();
    copyPose(this.transitionFrom, this.finalPose);
    this.transitionElapsed = 0;
    const clip = clipFor(kind);
    if (clip === null) {
      this.stopClip();
      return;
    }
    this.clip = clip;
    this.clipElapsed = 0;
    this.clipDuration = clip.duration * (success ? 1 : FAILED_TIME_SCALE);
    this.clipWeight = success ? 1 : FAILED_WEIGHT;
    this.clipReleased = false;
  }

  private stopClip(): void {
    this.clip = null;
    this.clipElapsed = 0;
    this.clipReleased = false;
    this.flushPendingHeld();
  }

  // -------------------------------------------------------------------------
  // Held item
  // -------------------------------------------------------------------------

  private syncHeldItem(state: GameState, immediate: boolean): void {
    const inventory = state.inventory;
    const choice = heldChoiceFor(inventory.slots[inventory.selected] ?? null);
    const deferred = !immediate && this.clip !== null && !this.clipReleased;
    if (deferred) {
      if (choice.kind === this.held.kind && choice.color === this.held.color) {
        this.hasPendingHeld = false;
      } else {
        this.hasPendingHeld = true;
        this.pendingHeld = choice;
      }
      return;
    }
    this.hasPendingHeld = false;
    this.showHeld(choice, !immediate);
    if (immediate) {
      copyPose(this.carry, CARRY_POSES[this.stance()]);
      this.carryArmSwing = CARRY_ARM_SWING[this.stance()];
      this.heldPopElapsed = Number.POSITIVE_INFINITY;
      this.held.socket.scale.setScalar(1);
    }
  }

  /** The stance to ease toward: holding a robot overrides the held prop's stance. */
  private stance(): CarryStyle {
    return this.carryingRobot ? 'robot' : this.carryStyle;
  }

  private flushPendingHeld(): void {
    if (!this.hasPendingHeld) return;
    this.hasPendingHeld = false;
    this.showHeld(this.pendingHeld, true);
  }

  private showHeld(choice: HeldChoice, animate: boolean): void {
    if (choice.kind === this.held.kind && choice.color === this.held.color) return;
    this.held.show(choice.kind, choice.color);
    this.carryStyle = carryStyleFor(choice.kind);
    if (animate && choice.kind !== null) {
      this.heldPopElapsed = 0;
      this.held.socket.scale.setScalar(0.01);
    }
  }

  private updateHeldPop(dt: number): void {
    if (this.heldPopElapsed >= HELD_POP_SECONDS) return;
    this.heldPopElapsed += dt;
    const t = clamp01(this.heldPopElapsed / HELD_POP_SECONDS);
    this.held.socket.scale.setScalar(t >= 1 ? 1 : Math.max(0.01, easeOutBack(t)));
  }

  // -------------------------------------------------------------------------
  // Blinking
  // -------------------------------------------------------------------------

  private updateBlink(dt: number): void {
    const eyes = this.model.eyes;
    if (this.blinkElapsed < BLINK_SECONDS) {
      this.blinkElapsed += dt;
      const t = clamp01(this.blinkElapsed / BLINK_SECONDS);
      eyes.scale.y = t >= 1 ? 1 : 1 - 0.9 * Math.sin(Math.PI * t);
      return;
    }
    this.blinkCountdown -= dt;
    if (this.blinkCountdown > 0) return;
    this.blinkElapsed = 0;
    this.blinkCountdown =
      this.blinkRandom() < DOUBLE_BLINK_CHANCE
        ? DOUBLE_BLINK_GAP
        : BLINK_MIN_INTERVAL + this.blinkRandom() * BLINK_INTERVAL_RANGE;
  }
}
