/**
 * ChickenRenderer: Cosmo's five chickens pecking about their run on the Neighbours map (farmclaws
 * part 4d spec §7.3). Render-only: chickenLayout.chickenAt places each one from render time
 * alone, so they're never saved or simulated, and they potter on while the game is frozen, like
 * the chimney smoke.
 *
 * - One InstancedMesh of five low-poly hens, painted in one geometry, two of them brown by their
 *   instance colour. It's shown only while the player is on the Neighbours map.
 * - update() stands each hen on the grass where chickenAt puts her, turned to her heading and
 *   tipped forward, from her feet, as she pecks.
 */
import * as THREE from 'three';
import type { GameState } from '../core/types';
import { selectActiveMapId } from '../state/selectors';
import { MAPS } from '../world/maps';
import { CHICKEN_RUN, ringInside } from '../world/maps/neighbours';
import { tileMinX, tileMinZ } from '../world/grid';
import { CHICKEN_COUNT, chickenAt } from './chickenLayout';
import { HEIGHTS } from './constants';
import { box, mergeParts } from './geometryParts';
import { createFlatMaterial } from './materials';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

/** How far a hen tips forward at the bottom of a peck (radians). */
const PECK_TILT = 0.75;

const HEN_COLORS = { feathers: 0xf6efe2, comb: 0xd9433a, beak: 0xf2a33a, eye: 0x2b2b2e } as const;
/** Instance colours: white hens, and two brown. */
const HEN_TINTS = [0xffffff, 0xd9a877, 0xffffff, 0xc98f5e, 0xfff4e0] as const;

/** A hen about 0.4 tall, facing +Z, feet at y = 0: body, tail, head, comb, wattle, beak, eyes and legs. */
function createHenGeometry(): THREE.BufferGeometry {
  const C = HEN_COLORS;
  return mergeParts(
    [
      box(0.2, 0.17, 0.27, { y: 0.17 }, C.feathers),
      box(0.13, 0.15, 0.08, { y: 0.26, z: -0.14, rx: -0.4 }, C.feathers),
      box(0.12, 0.12, 0.12, { y: 0.31, z: 0.12 }, C.feathers),
      box(0.03, 0.06, 0.09, { y: 0.39, z: 0.12 }, C.comb),
      box(0.03, 0.05, 0.03, { y: 0.24, z: 0.18 }, C.comb),
      box(0.05, 0.03, 0.06, { y: 0.3, z: 0.2 }, C.beak),
      box(0.13, 0.025, 0.025, { y: 0.33, z: 0.15 }, C.eye),
      box(0.025, 0.09, 0.025, { x: -0.05, y: 0.045 }, C.beak),
      box(0.025, 0.09, 0.025, { x: 0.05, y: 0.045 }, C.beak),
    ],
    'hen',
  );
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

export class ChickenRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly material = createFlatMaterial(0xffffff, { vertexColors: true });
  private readonly hens: THREE.InstancedMesh;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    this.hens = new THREE.InstancedMesh(createHenGeometry(), this.material, CHICKEN_COUNT);
    this.hens.name = 'chickens';
    this.hens.castShadow = true;
    this.hens.visible = false;
    this.hens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const tint = new THREE.Color();
    for (let i = 0; i < CHICKEN_COUNT; i++) this.hens.setColorAt(i, tint.set(HEN_TINTS[i % HEN_TINTS.length] ?? 0xffffff));
    // The hens move every frame; a fixed sphere round the whole run keeps culling valid.
    const grid = MAPS.neighbours.grid;
    const run = ringInside(CHICKEN_RUN);
    const min = new THREE.Vector3(tileMinX(grid, run.x0), HEIGHTS.grassTop, tileMinZ(grid, run.z0));
    const max = new THREE.Vector3(tileMinX(grid, run.x0 + run.width), HEIGHTS.grassTop + 0.5, tileMinZ(grid, run.z0 + run.depth));
    this.hens.boundingSphere = new THREE.Box3(min, max).getBoundingSphere(new THREE.Sphere());
    ctx.scene.add(this.hens);
  }

  sync(state: GameState, prev: GameState | null): void {
    // The map only changes with a full rebuild.
    if (prev === null) this.hens.visible = selectActiveMapId(state) === 'neighbours';
  }

  update(frame: FrameContext): void {
    if (!this.hens.visible) return;
    const grid = MAPS.neighbours.grid;
    for (let i = 0; i < CHICKEN_COUNT; i++) {
      const hen = chickenAt(i, frame.elapsed);
      scratchPosition.set(tileMinX(grid, hen.x), HEIGHTS.grassTop, tileMinZ(grid, hen.z));
      scratchQuaternion.setFromEuler(scratchEuler.set(hen.peck * PECK_TILT, hen.yaw, 0));
      this.hens.setMatrixAt(i, scratchMatrix.compose(scratchPosition, scratchQuaternion, UNIT_SCALE));
    }
    this.hens.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.ctx.scene.remove(this.hens);
    this.hens.geometry.dispose();
    this.material.dispose();
    this.hens.dispose();
  }
}
