/**
 * Pure render rules for robots (farmclaws part 1 spec §7): which meshes a robot shows, how it
 * poses in each power state, its action clips, shared-tile offsets, movement timing and idle bob.
 */
import { TIME } from '../config';
import type { Robot, RobotActionEvent, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';
import { periodFor } from '../robots/stats';

export const ROBOT_MESH_IDS = [
  'treads', 'body', 'head', 'eyes', 'arm', 'claw', 'spout', 'tines', 'hopper', 'basket', 'antenna', 'lens', 'coreGreen', 'coreOrange',
] as const;
export type RobotMeshId = (typeof ROBOT_MESH_IDS)[number];

const PART_MESH: Readonly<Record<RobotPartId, RobotMeshId>> = {
  claw: 'claw',
  wateringHead: 'spout',
  tiller: 'tines',
  seeder: 'hopper',
  basket: 'basket',
  antenna: 'antenna',
  sensorEye: 'lens',
  efficientCore: 'coreGreen',
  quickCore: 'coreOrange',
};

export function robotMeshes(robot: Pick<Robot, 'parts'>): readonly RobotMeshId[] {
  return ['treads', 'body', 'head', 'eyes', 'arm', ...robot.parts.map((p) => PART_MESH[p])];
}

/**
 * The model is authored at Standard size (0.6 tall). Mini stands 0.45 (×0.75), Big 0.85 (×1.42)
 * and its body is 1.3× wider on top of that (1.42 × 1.3 ≈ 1.85).
 */
export const SIZE_SCALE: Readonly<Record<RobotSize, { readonly height: number; readonly width: number }>> = {
  mini: { height: 0.75, width: 0.75 },
  standard: { height: 1, width: 1 },
  big: { height: 1.42, width: 1.85 },
};

// ---------------------------------------------------------------------------
// Motion (spec §7.3)
// ---------------------------------------------------------------------------

/** Longest a tile-to-tile lerp takes, in real seconds. */
export const MAX_MOVE_SECONDS = 0.45;
/** A lerp lasts this share of the robot's act period, so it arrives before the next step. */
export const MOVE_PERIOD_SHARE = 0.8;

export function moveSeconds(robot: Pick<Robot, 'parts'>, timeScale: number): number {
  return Math.min(MAX_MOVE_SECONDS, (MOVE_PERIOD_SHARE * periodFor(robot) * TIME.realSecondsPerGameMinute) / Math.max(1, timeScale));
}

/** Robots sharing a tile spread sideways by ±this, in tiles. */
export const SHARED_OFFSET = 0.18;

/** Sideways offset per robot on the map; robots sharing a tile spread ±SHARED_OFFSET in id order. */
export function sharedTileOffsets(robots: readonly Robot[]): ReadonlyMap<number, number> {
  const groups = new Map<string, number[]>();
  for (const r of robots) {
    if (r.carried || r.power === 'repairing') continue;
    const key = `${r.tx},${r.tz}`;
    groups.set(key, [...(groups.get(key) ?? []), r.id]);
  }
  const offsets = new Map<number, number>();
  for (const ids of groups.values()) {
    ids.forEach((id, i) => offsets.set(id, (i - (ids.length - 1) / 2) * SHARED_OFFSET * 2));
  }
  return offsets;
}

/** Peak height of a working robot's idle bob, in tiles. */
export const IDLE_BOB_HEIGHT = 0.015;
/** One full bob, in real seconds. */
export const IDLE_BOB_SECONDS = 1.6;
/** Phase step between robot ids (the golden ratio's fraction), so neighbours never bob in step. */
const IDLE_BOB_PHASE_STEP = 0.618034;

/** A working robot's lift above its ground at `timeSeconds`, in [0, IDLE_BOB_HEIGHT]. */
export function idleBob(timeSeconds: number, robotId: number): number {
  const phase = (timeSeconds / IDLE_BOB_SECONDS + robotId * IDLE_BOB_PHASE_STEP) * Math.PI * 2;
  return IDLE_BOB_HEIGHT * (0.5 + 0.5 * Math.sin(phase));
}

// ---------------------------------------------------------------------------
// Carrying, badge and sparks (spec §7.4)
// ---------------------------------------------------------------------------

/** A carried robot rides this far above the player's feet. */
export const CARRY_HEIGHT = 0.9;
/** A carried robot is drawn at this scale. */
export const CARRY_SCALE = 0.7;
/** The bicker badge floats this high above the robot's feet, as a share of its height scale. */
export const BADGE_HEIGHT = 0.85;
/** Broken robots spark from this high, as a share of their height scale. */
export const SPARK_HEIGHT = 0.4;

export const CLIP_SECONDS = 0.45;
export const BADGE_SECONDS = 1.5;
export const SPARK_SECONDS = 1.2;

// ---------------------------------------------------------------------------
// Power poses (spec §7.4)
// ---------------------------------------------------------------------------

export type EyeState = 'lit' | 'dim' | 'off';
export const EYE_COLORS: Readonly<Record<EyeState, number>> = { lit: 0xfff3b8, dim: 0x8a8366, off: 0x2b2b2e };

const DEG = Math.PI / 180;
/** A flat robot's head slumps forward 20°. */
const FLAT_HEAD_PITCH = 20 * DEG;
/** A broken robot sinks 0.25 tile into the pond, tilted 15°, head slightly down. */
const BROKEN_SINK = 0.25;
const BROKEN_TILT = 15 * DEG;
const BROKEN_HEAD_PITCH = 0.15;

export interface RobotPose {
  /** How far the robot sinks below its ground, in tiles. */
  readonly sink: number;
  /** Roll, radians. */
  readonly tilt: number;
  readonly headPitch: number;
  readonly eyes: EyeState;
  readonly visible: boolean;
}

export function robotPose(power: RobotPower, carried: boolean): RobotPose {
  const eyes: EyeState = power === 'working' ? 'lit' : power === 'standby' ? 'dim' : 'off';
  if (carried) return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: true };
  switch (power) {
    case 'working':
    case 'standby':
      return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: true };
    case 'flat':
      return { sink: 0, tilt: 0, headPitch: FLAT_HEAD_PITCH, eyes, visible: true };
    case 'broken':
      return { sink: BROKEN_SINK, tilt: BROKEN_TILT, headPitch: BROKEN_HEAD_PITCH, eyes, visible: true };
    case 'repairing':
      return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: false };
  }
}

// ---------------------------------------------------------------------------
// Action clips (spec §7.4)
// ---------------------------------------------------------------------------

export interface RobotClip {
  readonly kind: RobotActionKind;
  readonly scale: number;
  readonly bickered: boolean;
}

/** A failed action plays its clip at this size. */
const FAILED_CLIP_SCALE = 0.5;

const NO_CLIP: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['move', 'turn', 'wait', 'powerDown']);

export function clipFor(event: RobotActionEvent): RobotClip | null {
  if (event.bickered) return { kind: event.kind, scale: 1, bickered: true };
  if (NO_CLIP.has(event.kind)) return null;
  return { kind: event.kind, scale: event.success ? 1 : FAILED_CLIP_SCALE, bickered: false };
}

export interface ClipOffsets {
  /** Vertical dip, in tiles (negative is down). */
  readonly dip: number;
  /** Forward lean, radians. */
  readonly pitch: number;
  /** Sideways shake, in tiles. */
  readonly shake: number;
  /** Head turn, radians. */
  readonly headYaw: number;
}

export const STILL: ClipOffsets = { dip: 0, pitch: 0, shake: 0, headYaw: 0 };

/** Peak dip and lean of each body clip, at full size. */
const CLIP_PEAKS: Partial<Record<RobotActionKind, { readonly dip: number; readonly pitch: number }>> = {
  harvest: { dip: -0.06, pitch: 0.2 },
  water: { dip: 0, pitch: 0.3 },
  till: { dip: -0.04, pitch: 0.25 },
  plant: { dip: -0.03, pitch: 0.1 },
  deposit: { dip: 0, pitch: 0.18 },
  take: { dip: 0, pitch: 0.18 },
  refill: { dip: 0, pitch: 0.18 },
};

/** A bicker's sideways shake: amplitude in tiles, rate in radians per second. */
const BICKER_SHAKE = 0.05;
const BICKER_SHAKE_RATE = 40;
/** A `say` head wobble: amplitude in radians, rate in radians per second. */
const SAY_WOBBLE = 0.25;
const SAY_WOBBLE_RATE = 20;

/** Offsets `t` seconds into a clip: one smooth rise and fall over CLIP_SECONDS. */
export function clipOffsets(clip: RobotClip, t: number): ClipOffsets {
  if (t >= CLIP_SECONDS) return STILL;
  const s = Math.sin((t / CLIP_SECONDS) * Math.PI) * clip.scale;
  if (clip.bickered) return { ...STILL, shake: Math.sin(t * BICKER_SHAKE_RATE) * BICKER_SHAKE * s };
  if (clip.kind === 'say') return { ...STILL, headYaw: Math.sin(t * SAY_WOBBLE_RATE) * SAY_WOBBLE * s };
  const peak = CLIP_PEAKS[clip.kind];
  return peak === undefined ? STILL : { ...STILL, dip: peak.dip * s, pitch: peak.pitch * s };
}
