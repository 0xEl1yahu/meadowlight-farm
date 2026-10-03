/**
 * RobotRenderer's pure rules (src/render/robotLayout.ts, farmclaws part 1 spec §7): which meshes a
 * robot shows, its lerp duration, shared-tile offsets, per-power poses, action clips and the idle bob.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import type { Robot, RobotPower } from '../src/core/types';
import { CAMERA } from '../src/render/constants';
import {
  DIZZY_SPIN_SECONDS,
  IDLE_BOB_HEIGHT,
  IDLE_BOB_SECONDS,
  MAX_MOVE_SECONDS,
  MOVE_PERIOD_SHARE,
  SHARED_OFFSET,
  clipFor,
  clipOffsets,
  dizzySpin,
  eyeLevel,
  idleBob,
  moveSeconds,
  sharedOffsetXZ,
  robotMeshes,
  robotPose,
  sharedTileOffsets,
  startsDizzySpin,
} from '../src/render/robotLayout';
import { robotOf } from './testUtils';

describe('robot render rules', () => {
  it('shows the body plus one mesh per part', () => {
    expect(robotMeshes(robotOf({ parts: ['claw'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'claw']);
    expect(robotMeshes(robotOf({ size: 'big', parts: ['wateringHead', 'basket', 'quickCore'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'spout', 'basket', 'coreOrange']);
  });

  it('lerps faster at higher speeds and never over the cap', () => {
    expect(moveSeconds(robotOf(), 1)).toBeCloseTo(MAX_MOVE_SECONDS);
    expect(moveSeconds(robotOf(), 16)).toBeCloseTo((MOVE_PERIOD_SHARE * ROBOTS.period * TIME.realSecondsPerGameMinute) / 16);
    expect(moveSeconds(robotOf({ parts: ['quickCore'] }), 16)).toBeCloseTo((MOVE_PERIOD_SHARE * ROBOTS.quickCorePeriod * TIME.realSecondsPerGameMinute) / 16);
  });

  it('spreads robots that share a tile, in id order', () => {
    const offsets = sharedTileOffsets([robotOf({ id: 1 }), robotOf({ id: 2 }), robotOf({ id: 3, tx: 1 }), robotOf({ id: 4, carried: true })]);
    expect(offsets.get(1)).toBeCloseTo(-SHARED_OFFSET);
    expect(offsets.get(2)).toBeCloseTo(SHARED_OFFSET);
    expect(offsets.get(3)).toBe(0);
    expect(offsets.has(4)).toBe(false);
  });

  it('keeps robots on one tile apart whichever way they face', () => {
    // Regression: offsets once ran along each robot's own side, so two robots facing opposite
    // ways with opposite offsets landed on the same point. The offset axis ignores facing.
    const offsets = sharedTileOffsets([robotOf({ id: 1 }), robotOf({ id: 2 })]);
    const a = sharedOffsetXZ(offsets.get(1) ?? 0);
    const b = sharedOffsetXZ(offsets.get(2) ?? 0);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(SHARED_OFFSET * 2);
    // Along screen-right: perpendicular to the camera's ground-plane view direction.
    const yaw = (CAMERA.yawDeg * Math.PI) / 180;
    expect(a.x * Math.sin(yaw) + a.z * Math.cos(yaw)).toBeCloseTo(0);
  });

  it('poses each power', () => {
    expect(robotPose('working', false)).toMatchObject({ eyes: 'lit', visible: true, sink: 0 });
    expect(robotPose('standby', false).eyes).toBe('dim');
    expect(robotPose('flat', false)).toMatchObject({ eyes: 'off' });
    expect(robotPose('flat', false).headPitch).toBeGreaterThan(0.3);
    expect(robotPose('broken', false)).toMatchObject({ eyes: 'off', sink: 0.25 });
    expect(robotPose('repairing', false).visible).toBe(false);
    expect(robotPose('broken', true)).toMatchObject({ sink: 0, tilt: 0, eyes: 'off' });
  });

  it('plays clips for actions, smaller when they fail, and shakes on a bicker', () => {
    expect(clipFor({ seq: 1, kind: 'move', success: true, bickered: false })).toBeNull();
    const harvest = clipFor({ seq: 1, kind: 'harvest', success: true, bickered: false });
    const failed = clipFor({ seq: 1, kind: 'harvest', success: false, bickered: false });
    expect(harvest?.scale).toBe(1);
    expect(failed?.scale).toBe(0.5);
    const bicker = clipFor({ seq: 1, kind: 'harvest', success: false, bickered: true });
    expect(bicker?.bickered).toBe(true);
    expect(clipOffsets(harvest!, 0.2).pitch).toBeGreaterThan(clipOffsets(failed!, 0.2).pitch);
  });

  it('bobs gently above the ground, out of step between robots', () => {
    for (let t = 0; t < IDLE_BOB_SECONDS * 2; t += 0.05) {
      const y = idleBob(t, 1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(IDLE_BOB_HEIGHT);
    }
    expect(idleBob(0.3 + IDLE_BOB_SECONDS, 1)).toBeCloseTo(idleBob(0.3, 1), 9);
    expect(idleBob(0.3, 1)).not.toBeCloseTo(idleBob(0.3, 2), 5);
    expect(idleBob(0.3, 2)).not.toBeCloseTo(idleBob(0.3, 3), 5);
  });
});

describe('robots that are off (part 2 spec §9)', () => {
  it('spin once when dizzy: a full turn over DIZZY_SPIN_SECONDS, then nothing', () => {
    expect(DIZZY_SPIN_SECONDS).toBe(1);
    expect(dizzySpin(0)).toBe(0);
    expect(dizzySpin(0.5)).toBeCloseTo(Math.PI);
    expect(dizzySpin(1)).toBe(0);
    expect(dizzySpin(1.5)).toBe(0);
    expect(dizzySpin(-0.2)).toBe(0);
    // Inside the clip the yaw only ever grows, and stays short of a full turn.
    let last = 0;
    for (let i = 1; i < 20; i++) {
      const yaw = dizzySpin((i / 20) * DIZZY_SPIN_SECONDS);
      expect(yaw).toBeGreaterThan(last);
      expect(yaw).toBeLessThan(Math.PI * 2);
      last = yaw;
    }
  });

  it('dims the eyes of robots on standby or turned off, and puts them out when flat, broken or away', () => {
    const table: readonly (readonly [RobotPower, Robot['off'], number])[] = [
      ['working', null, 1],
      ['working', 'dizzy', 0.5],
      ['working', 'done', 0.5],
      ['standby', null, 0.5],
      ['standby', 'dizzy', 0.5],
      ['standby', 'done', 0.5],
      ['flat', null, 0],
      ['broken', null, 0],
      ['repairing', null, 0],
    ];
    for (const [power, off, level] of table) expect(eyeLevel(power, off), `${power} / ${String(off)}`).toBe(level);
  });

  it('starts a spin only when a robot has just got dizzy, never on a load or a new robot', () => {
    const on = robotOf();
    const dizzy = robotOf({ off: 'dizzy' });
    expect(startsDizzySpin(on, dizzy)).toBe(true);
    expect(startsDizzySpin(undefined, dizzy)).toBe(false);
    expect(startsDizzySpin(dizzy, dizzy)).toBe(false);
    expect(startsDizzySpin(on, robotOf({ off: 'done' }))).toBe(false);
    expect(startsDizzySpin(on, on)).toBe(false);
    expect(startsDizzySpin(dizzy, on)).toBe(false);
  });
});
