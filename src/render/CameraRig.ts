/**
 * Isometric camera rig. Owns the orthographic camera's transform and frustum.
 *
 * - The camera sits on a fixed offset from a ground focus point: yaw / pitch from CAMERA give the
 *   offset direction (sin yaw · cos pitch, sin pitch, cos yaw · cos pitch), so yaw 45° places it
 *   on the (+X, +Y, +Z) diagonal looking back at the focus. The orientation never changes, so it
 *   is computed once; per frame only the position moves.
 * - `follow(target)` sets where the rig should look; `update(dt)` eases the focus toward it with
 *   frame-rate independent exponential smoothing (1 − e^(−rate·dt)). `snap(target)` jumps there.
 * - Zoom is expressed as the vertical extent of the view in world units. `zoomBy` changes the
 *   target view height and `update` eases toward it in log space, so every wheel notch feels
 *   the same whether zoomed in or out.
 * - The projection matrix is rebuilt only when the view height or the viewport aspect actually
 *   changed; the world matrix only when the focus moved.
 */
import * as THREE from 'three';
import type { WorldRect } from '../world/grid';
import { CAMERA } from './constants';

/** Exponential zoom easing rate (1/s). */
const ZOOM_RATE = 10;
/** Below this distance (world units) the focus is considered to have arrived. */
const FOCUS_EPSILON = 1e-4;
/** Below this relative difference the zoom is considered to have arrived. */
const ZOOM_EPSILON = 1e-4;
/** Aspect used until the viewport reports a usable size. */
const FALLBACK_ASPECT = 16 / 9;
/** Default distance the focus may wander past the world edge (world units). */
const DEFAULT_BOUNDS_MARGIN = 3;

const DEG2RAD = Math.PI / 180;

/**
 * Unit vector from the focus toward the camera for a yaw / pitch in degrees.
 * Yaw rotates about +Y starting from +Z; pitch is the elevation above the ground plane.
 */
export function cameraOffsetDirection(
  yawDeg: number,
  pitchDeg: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const yaw = yawDeg * DEG2RAD;
  const pitch = pitchDeg * DEG2RAD;
  const horizontal = Math.cos(pitch);
  return target.set(Math.sin(yaw) * horizontal, Math.sin(pitch), Math.cos(yaw) * horizontal).normalize();
}

/** A usable aspect ratio, or the fallback when the viewport has no size yet. */
function sanitizeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : FALLBACK_ASPECT;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function isFiniteVector(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export interface CameraRigOptions {
  /** Current viewport width / height. Non-finite or non-positive values fall back to 16:9. */
  readonly getAspect: () => number;
  /** World rectangle the focus is clamped to (expanded by `boundsMargin`). Null disables clamping. */
  readonly bounds?: WorldRect | null;
  /** How far past `bounds` the focus may go, in world units. */
  readonly boundsMargin?: number;
}

export class CameraRig {
  /** Current smoothed ground focus point (world space). Read-only for callers. */
  readonly focus = new THREE.Vector3();

  private readonly camera: THREE.OrthographicCamera;
  private readonly getAspect: () => number;
  private bounds: WorldRect | null;
  private readonly boundsMargin: number;
  /** Focus → camera vector (unit direction × CAMERA.distance). */
  private readonly offset = new THREE.Vector3();
  /** Where the focus is heading. */
  private readonly goal = new THREE.Vector3();
  private currentViewHeight: number = CAMERA.viewHeight;
  private targetViewHeight: number = CAMERA.viewHeight;
  private appliedViewHeight = Number.NaN;
  private appliedAspect = Number.NaN;
  private transformDirty = true;

  constructor(camera: THREE.OrthographicCamera, options: CameraRigOptions) {
    this.camera = camera;
    this.getAspect = options.getAspect;
    this.bounds = options.bounds ?? null;
    this.boundsMargin = Math.max(0, options.boundsMargin ?? DEFAULT_BOUNDS_MARGIN);

    cameraOffsetDirection(CAMERA.yawDeg, CAMERA.pitchDeg, this.offset).multiplyScalar(CAMERA.distance);

    // The orientation is constant for the rig's lifetime: aim once from the offset at the origin.
    camera.zoom = 1;
    camera.up.set(0, 1, 0);
    camera.position.copy(this.offset);
    camera.lookAt(0, 0, 0);

    this.applyTransform();
    this.syncProjection();
  }

  /** Current (smoothed) vertical extent of the view in world units. */
  get viewHeight(): number {
    return this.currentViewHeight;
  }

  /** The view height the rig is easing toward. */
  get targetHeight(): number {
    return this.targetViewHeight;
  }

  /**
   * Replaces the world rectangle the focus is clamped to (a map change). Re-clamps both the goal
   * and the current focus and marks the transform dirty, so the next `update` (or a `snap`) moves
   * the camera inside the new map. Null disables clamping.
   */
  setBounds(bounds: WorldRect | null): void {
    this.bounds = bounds;
    this.clampToBounds(this.goal);
    this.clampToBounds(this.focus);
    this.transformDirty = true;
  }

  /** Sets the point the camera should ease toward. Non-finite targets are ignored. */
  follow(target: THREE.Vector3): void {
    if (!isFiniteVector(target)) return;
    this.clampToBounds(this.goal.copy(target));
  }

  /** Jumps the focus to `target` immediately (boot, load, teleport). */
  snap(target: THREE.Vector3): void {
    if (!isFiniteVector(target)) return;
    this.clampToBounds(this.goal.copy(target));
    this.focus.copy(this.goal);
    this.transformDirty = true;
    this.applyTransform();
  }

  /**
   * Multiplies the target view height. factor > 1 zooms out (sees more), factor < 1 zooms in.
   * The result is clamped to [CAMERA.minViewHeight, CAMERA.maxViewHeight].
   */
  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.targetViewHeight = clamp(this.targetViewHeight * factor, CAMERA.minViewHeight, CAMERA.maxViewHeight);
  }

  /** Eases focus and zoom toward their targets and refreshes the camera when anything changed. */
  update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (step > 0) {
      this.easeFocus(step);
      this.easeZoom(step);
    }
    if (this.transformDirty) this.applyTransform();
    this.syncProjection();
  }

  /**
   * Rebuilds the orthographic frustum if the view height or the viewport aspect changed since the
   * last call. Returns true when the projection matrix was updated. SceneContext calls this on
   * resize so the very next render uses the new aspect.
   */
  syncProjection(): boolean {
    const aspect = sanitizeAspect(this.getAspect());
    const height = this.currentViewHeight;
    if (aspect === this.appliedAspect && height === this.appliedViewHeight) return false;
    const halfHeight = height / 2;
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.appliedAspect = aspect;
    this.appliedViewHeight = height;
    return true;
  }

  private easeFocus(dt: number): void {
    const distanceSq = this.focus.distanceToSquared(this.goal);
    if (distanceSq === 0) return;
    if (distanceSq <= FOCUS_EPSILON * FOCUS_EPSILON) {
      this.focus.copy(this.goal);
    } else {
      this.focus.lerp(this.goal, 1 - Math.exp(-CAMERA.followRate * dt));
    }
    this.transformDirty = true;
  }

  private easeZoom(dt: number): void {
    const current = this.currentViewHeight;
    const target = this.targetViewHeight;
    if (current === target) return;
    if (Math.abs(target - current) <= ZOOM_EPSILON * target) {
      this.currentViewHeight = target;
      return;
    }
    const k = 1 - Math.exp(-ZOOM_RATE * dt);
    const logHeight = Math.log(current) + (Math.log(target) - Math.log(current)) * k;
    this.currentViewHeight = Math.exp(logHeight);
  }

  private applyTransform(): void {
    this.camera.position.copy(this.focus).add(this.offset);
    // Keep matrixWorld / matrixWorldInverse current so input picking between frames is exact.
    this.camera.updateMatrixWorld();
    this.transformDirty = false;
  }

  private clampToBounds(point: THREE.Vector3): THREE.Vector3 {
    const bounds = this.bounds;
    if (bounds === null) return point;
    const margin = this.boundsMargin;
    point.x = clamp(point.x, bounds.minX - margin, bounds.maxX + margin);
    point.z = clamp(point.z, bounds.minZ - margin, bounds.maxZ + margin);
    return point;
  }
}
