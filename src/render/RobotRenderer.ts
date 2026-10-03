/**
 * RobotRenderer: the farm's robots (farmclaws part 1 spec §7).
 *
 * - One InstancedMesh per robot mesh id (robotGeometry.ts), capacity ROBOTS.maxRobots, keyed by
 *   robot id. Robots move every frame, so these meshes skip frustum culling instead of
 *   recomputing bounds; at 12 robots that's cheap.
 * - Robots are drawn only while the player is on the farm.
 * - A new moveSeq lerps to the new tile; a new teleportSeq, a rebuild or a new robot snaps.
 * - A new actionSeq plays a clip (robotLayout.clipFor); water and till clips spray particles,
 *   bickers show a red badge; broken robots spark; working robots bob gently.
 * - A carried robot is drawn above the player's visual position (the carryAnchor callback).
 * - A robot that just got dizzy spins once (robotLayout.dizzySpin; never on a rebuild). Eyes
 *   follow robotLayout.eyeLevel, so dizzy and done robots look like standby ones and don't bob.
 * - A robot on the workbench stands on the bench top (robotLayout.benchLift); benching it bumps teleportSeq, so it snaps there.
 */
import * as THREE from 'three';
import { ROBOTS } from '../config';
import { Blocker, type GameState, type Robot } from '../core/types';
import { selectActiveMapId } from '../state/selectors';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
import { getTile, isSoil } from '../world/tiles';
import { CAMERA, HEIGHTS } from './constants';
import { InstanceSlotMap } from './InstanceSlotMap';
import { createFlatMaterial } from './materials';
import { HEAD_MESHES, NECK_Y, createBadgeGeometry, createParticleGeometry, createRobotMeshGeometry } from './robotGeometry';
import {
  BADGE_HEIGHT,
  BADGE_SECONDS,
  CARRY_HEIGHT,
  CARRY_SCALE,
  CLIP_SECONDS,
  DIZZY_SPIN_SECONDS,
  EYE_COLORS,
  MAX_MOVE_SECONDS,
  ROBOT_MESH_IDS,
  SIZE_SCALE,
  SPARK_HEIGHT,
  SPARK_SECONDS,
  STILL,
  benchLift,
  clipFor,
  clipOffsets,
  dizzySpin,
  eyeLevel,
  idleBob,
  moveSeconds,
  robotMeshes,
  robotPose,
  sharedOffsetXZ,
  sharedTileOffsets,
  startsDizzySpin,
  type EyeState,
  type RobotClip,
  type RobotMeshId,
} from './robotLayout';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

const PARTICLE_CAPACITY = 64;
const CAMERA_YAW = (CAMERA.yawDeg * Math.PI) / 180;
/** Yaw easing rate toward the facing (1/s). */
const YAW_RATE = 12;

/** Particle bursts: count, colour, launch speeds (tiles/s), gravity (tiles/s²) and lifetime (s). */
const DROPLETS = { count: 6, color: 0x7fb8e6 } as const;
const SOIL_PUFF = { count: 6, color: 0x8a6a4a } as const;
const SPARKS = { count: 3, color: 0xffd866 } as const;
const PARTICLE_SPREAD = 0.6;
const PARTICLE_LIFT = 1.2;
const PARTICLE_GRAVITY = 4;
const PARTICLE_LIFE = 0.5;
/** Bursts start this high above the ground. */
const BURST_HEIGHT = 0.1;

interface Visual {
  robot: Robot;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  moveT: number;
  moveDur: number;
  yaw: number;
  groundY: number;
  offset: number;
  clip: RobotClip | null;
  clipT: number;
  badgeT: number;
  sparkT: number;
  /** Seconds into the dizzy spin; DIZZY_SPIN_SECONDS or more when not spinning. */
  spinT: number;
  moveSeq: number;
  teleportSeq: number;
  actionSeq: number;
}

interface Particle {
  readonly key: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const m = new THREE.Matrix4();
const headLocal = new THREE.Matrix4();
const headM = new THREE.Matrix4();
const tmp = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const color = new THREE.Color();

function groundOf(state: GameState, robot: Robot): number {
  // The workbench stands on plain grass; a robot on it stands on its top.
  if (robot.onBench) return HEIGHTS.grassTop + benchLift(robot);
  const tile = getTile(state.maps.farm, robot.tx, robot.tz);
  if (tile === null) return HEIGHTS.grassTop;
  if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

/** The eye colour for a robotLayout.eyeLevel: full is lit, anything between is dim, 0 is out. */
function eyeState(level: number): EyeState {
  if (level >= 1) return 'lit';
  return level > 0 ? 'dim' : 'off';
}

export class RobotRenderer implements RenderSystem {
  private readonly group = new THREE.Group();
  private readonly painted = createFlatMaterial(0xffffff, { vertexColors: true });
  private readonly eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly particleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly meshes: Record<RobotMeshId, InstanceSlotMap>;
  private readonly badges: InstanceSlotMap;
  private readonly particles: InstanceSlotMap;
  private readonly visuals = new Map<number, Visual>();
  private readonly live: Particle[] = [];
  private nextParticle = 0;
  private state: GameState | null = null;
  /** The player's visual feet position; a carried robot rides above it. */
  private readonly carryAnchor: () => THREE.Vector3;

  constructor(ctx: SceneContext, carryAnchor: () => THREE.Vector3) {
    this.carryAnchor = carryAnchor;
    this.group.name = 'robots';
    const meshes = {} as Record<RobotMeshId, InstanceSlotMap>;
    for (const id of ROBOT_MESH_IDS) {
      const eyes = id === 'eyes';
      const mesh = new THREE.InstancedMesh(createRobotMeshGeometry(id), eyes ? this.eyeMaterial : this.painted, ROBOTS.maxRobots);
      mesh.castShadow = !eyes;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      meshes[id] = new InstanceSlotMap(mesh, eyes);
    }
    this.meshes = meshes;
    const badge = new THREE.InstancedMesh(createBadgeGeometry(), this.painted, ROBOTS.maxRobots);
    badge.frustumCulled = false;
    this.group.add(badge);
    this.badges = new InstanceSlotMap(badge, false);
    const particle = new THREE.InstancedMesh(createParticleGeometry(), this.particleMaterial, PARTICLE_CAPACITY);
    particle.frustumCulled = false;
    this.group.add(particle);
    this.particles = new InstanceSlotMap(particle, true);
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    this.state = state;
    if (selectActiveMapId(state) !== 'farm') {
      this.clearAll();
      return;
    }
    if (prev !== null && state.robots.list === prev.robots.list && state.maps.farm === prev.maps.farm && state.ui.timeScale === prev.ui.timeScale) return;
    const offsets = sharedTileOffsets(state.robots.list);
    const grid = state.maps.farm.grid;
    const seen = new Set<number>();
    if (prev === null) this.resetEffects();
    for (const robot of state.robots.list) {
      seen.add(robot.id);
      const toX = tileCenterX(grid, robot.tx);
      const toZ = tileCenterZ(grid, robot.tz);
      const groundY = groundOf(state, robot);
      const existing = this.visuals.get(robot.id);
      const snap = prev === null || existing === undefined || robot.teleportSeq !== existing.teleportSeq;
      const visual: Visual = existing ?? {
        robot, x: toX, z: toZ, fromX: toX, fromZ: toZ, toX, toZ, moveT: 1, moveDur: MAX_MOVE_SECONDS, yaw: directionYaw(robot.facing),
        groundY, offset: 0, clip: null, clipT: CLIP_SECONDS, badgeT: BADGE_SECONDS, sparkT: 0, spinT: DIZZY_SPIN_SECONDS,
        moveSeq: robot.moveSeq, teleportSeq: robot.teleportSeq, actionSeq: robot.actionSeq,
      };
      if (snap) {
        Object.assign(visual, { x: toX, z: toZ, fromX: toX, fromZ: toZ, toX, toZ, moveT: 1, yaw: directionYaw(robot.facing) });
      } else if (robot.moveSeq !== visual.moveSeq) {
        Object.assign(visual, { fromX: visual.x, fromZ: visual.z, toX, toZ, moveT: 0, moveDur: moveSeconds(robot, state.ui.timeScale) });
      }
      const action = robot.lastAction;
      if (!snap && robot.actionSeq !== visual.actionSeq && action !== null) {
        visual.clip = clipFor(action);
        visual.clipT = 0;
        if (action.bickered) visual.badgeT = 0;
        if (action.success && action.kind === 'water') this.spray(toX, groundY + BURST_HEIGHT, toZ, DROPLETS.color, DROPLETS.count);
        if (action.success && action.kind === 'till') this.spray(toX, groundY + BURST_HEIGHT, toZ, SOIL_PUFF.color, SOIL_PUFF.count);
      }
      // visual.robot is still the robot as it was at the last sync.
      if (!snap && startsDizzySpin(visual.robot, robot)) visual.spinT = 0;
      Object.assign(visual, {
        robot,
        groundY,
        offset: offsets.get(robot.id) ?? 0,
        moveSeq: robot.moveSeq,
        teleportSeq: robot.teleportSeq,
        actionSeq: robot.actionSeq,
      });
      this.visuals.set(robot.id, visual);
      this.syncMeshes(robot);
    }
    for (const id of [...this.visuals.keys()]) {
      if (!seen.has(id)) {
        this.visuals.delete(id);
        for (const mesh of Object.values(this.meshes)) mesh.remove(id);
        this.badges.remove(id);
      }
    }
  }

  update(frame: FrameContext): void {
    const state = this.state;
    if (state === null || selectActiveMapId(state) !== 'farm') return;
    const dt = frame.dt;
    for (const visual of this.visuals.values()) this.animate(visual, dt, frame.elapsed, state);
    this.updateParticles(dt);
    for (const mesh of Object.values(this.meshes)) mesh.commit({ bounds: false });
    this.badges.commit({ bounds: false });
    this.particles.commit({ bounds: false });
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const map of [...Object.values(this.meshes), this.badges, this.particles]) {
      map.mesh.dispose();
      map.mesh.geometry.dispose();
    }
    this.painted.dispose();
    this.eyeMaterial.dispose();
    this.particleMaterial.dispose();
  }

  /** A full rebuild drops every robot's clip and badge timer and any particles still in flight. */
  private resetEffects(): void {
    for (const visual of this.visuals.values()) {
      visual.clip = null;
      visual.clipT = CLIP_SECONDS;
      visual.badgeT = BADGE_SECONDS;
      visual.spinT = DIZZY_SPIN_SECONDS;
    }
    this.particles.clear();
    this.particles.commit();
    this.live.length = 0;
  }

  private clearAll(): void {
    this.visuals.clear();
    for (const mesh of Object.values(this.meshes)) {
      mesh.clear();
      mesh.commit();
    }
    this.badges.clear();
    this.badges.commit();
    this.particles.clear();
    this.particles.commit();
    this.live.length = 0;
  }

  /** Adds or removes this robot's instance on every mesh to match its parts and visibility. */
  private syncMeshes(robot: Robot): void {
    const wanted = new Set(robotMeshes(robot));
    const visible = robotPose(robot.power, robot.carried).visible;
    for (const id of ROBOT_MESH_IDS) {
      const map = this.meshes[id];
      if (visible && wanted.has(id)) {
        if (!map.has(robot.id)) map.set(robot.id, m.identity());
      } else {
        map.remove(robot.id);
      }
    }
    if (!visible) this.badges.remove(robot.id);
  }

  private animate(v: Visual, dt: number, elapsed: number, state: GameState): void {
    const robot = v.robot;
    const pose = robotPose(robot.power, robot.carried);
    if (!pose.visible) return;
    if (v.moveT < 1) {
      v.moveT = Math.min(1, v.moveT + dt / Math.max(0.01, v.moveDur));
      const t = v.moveT * v.moveT * (3 - 2 * v.moveT);
      v.x = v.fromX + (v.toX - v.fromX) * t;
      v.z = v.fromZ + (v.toZ - v.fromZ) * t;
    }
    const targetYaw = directionYaw(robot.carried ? state.player.facing : robot.facing);
    const delta = Math.atan2(Math.sin(targetYaw - v.yaw), Math.cos(targetYaw - v.yaw));
    v.yaw += delta * (1 - Math.exp(-YAW_RATE * dt));
    v.clipT += dt;
    v.badgeT += dt;
    v.spinT += dt;
    const clip = v.clip === null ? STILL : clipOffsets(v.clip, v.clipT);
    const size = SIZE_SCALE[robot.size];

    let x: number;
    let y: number;
    let z: number;
    let s = 1;
    if (robot.carried) {
      const anchor = this.carryAnchor();
      x = anchor.x;
      y = anchor.y + CARRY_HEIGHT;
      z = anchor.z;
      s = CARRY_SCALE;
    } else {
      // The shared-tile offset runs along a fixed screen axis; the bicker shake along the robot's own side.
      const shared = sharedOffsetXZ(v.offset);
      const side = v.yaw + Math.PI / 2;
      x = v.x + shared.x + Math.sin(side) * clip.shake;
      z = v.z + shared.z + Math.cos(side) * clip.shake;
      const bob = robot.power === 'working' && robot.off === null ? idleBob(elapsed, robot.id) : 0;
      // pose.sink is absolute (the broken sink is 0.25 tile at every size); nothing sinks into the bench top.
      y = v.groundY - (robot.onBench ? 0 : pose.sink) + clip.dip + bob;
    }
    euler.set(clip.pitch, v.yaw + dizzySpin(v.spinT), pose.tilt);
    quat.setFromEuler(euler);
    pos.set(x, y, z);
    scl.set(size.width * s, size.height * s, size.width * s);
    m.compose(pos, quat, scl);
    headLocal
      .makeTranslation(0, NECK_Y, 0)
      .multiply(tmp.makeRotationX(pose.headPitch))
      .multiply(tmp.makeRotationY(clip.headYaw))
      .multiply(tmp.makeTranslation(0, -NECK_Y, 0));
    headM.multiplyMatrices(m, headLocal);

    for (const id of robotMeshes(robot)) {
      this.meshes[id].setMatrix(robot.id, HEAD_MESHES.has(id) ? headM : m);
    }
    this.meshes.eyes.setColor(robot.id, color.setHex(EYE_COLORS[eyeState(eyeLevel(robot.power, robot.off))]));

    if (v.badgeT < BADGE_SECONDS) {
      pos.set(x, y + BADGE_HEIGHT * size.height * s, z);
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, CAMERA_YAW);
      this.badges.set(robot.id, tmp.compose(pos, quat, scl.setScalar(1)));
    } else {
      this.badges.remove(robot.id);
    }

    // Last: spray writes the scratch matrix `m`, which every mesh above has already read.
    if (robot.power === 'broken' && !robot.carried) {
      v.sparkT += dt;
      if (v.sparkT >= SPARK_SECONDS) {
        v.sparkT = 0;
        this.spray(x, y + SPARK_HEIGHT * size.height, z, SPARKS.color, SPARKS.count);
      }
    }
  }

  private spray(x: number, y: number, z: number, hex: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.live.length >= PARTICLE_CAPACITY) return;
      const angle = (i / count) * Math.PI * 2 + this.nextParticle;
      const key = this.nextParticle++;
      this.live.push({
        key, x, y, z,
        vx: Math.cos(angle) * PARTICLE_SPREAD,
        vy: PARTICLE_LIFT,
        vz: Math.sin(angle) * PARTICLE_SPREAD,
        life: PARTICLE_LIFE,
      });
      this.particles.set(key, m.makeTranslation(x, y, z), color.setHex(hex));
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      if (p === undefined) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.remove(p.key);
        this.live.splice(i, 1);
        continue;
      }
      p.vy -= PARTICLE_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particles.setMatrix(p.key, m.makeTranslation(p.x, p.y, p.z));
    }
  }
}
