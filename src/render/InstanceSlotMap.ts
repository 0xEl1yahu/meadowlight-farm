/**
 * Dense instance allocator for an InstancedMesh, keyed by a stable integer (usually the global
 * tile index from world/grid.ts tileIndex).
 *
 * Live instances always occupy slots [0, count). Removal moves the last live instance into the
 * freed slot (swap-remove), so add / update / remove are O(1) and `mesh.count` always equals
 * the number of live instances — the GPU never draws hidden or zero-scaled leftovers.
 *
 * Call `commit()` once after a batch of edits: it flags the GPU buffers for upload and
 * recomputes the bounding sphere used for frustum culling.
 */
import * as THREE from 'three';

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();

export class InstanceSlotMap {
  readonly mesh: THREE.InstancedMesh;
  private readonly keyToSlot = new Map<number, number>();
  private readonly slotToKey: number[] = [];
  private matrixDirty = false;
  private colorDirty = false;

  /**
   * @param mesh     InstancedMesh whose constructor `count` is the capacity.
   * @param useColor Allocate the per-instance colour buffer up front. It must exist before the
   *                 first render, otherwise the shader is compiled without instance colours.
   */
  constructor(mesh: THREE.InstancedMesh, useColor = true) {
    this.mesh = mesh;
    const capacity = mesh.instanceMatrix.count;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (useColor && mesh.instanceColor === null) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    }
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  get size(): number {
    return this.slotToKey.length;
  }

  has(key: number): boolean {
    return this.keyToSlot.has(key);
  }

  slotOf(key: number): number | undefined {
    return this.keyToSlot.get(key);
  }

  /** Inserts or updates the instance for `key`. Returns its slot. */
  set(key: number, matrix: THREE.Matrix4, color?: THREE.Color): number {
    let slot = this.keyToSlot.get(key);
    if (slot === undefined) {
      slot = this.slotToKey.length;
      if (slot >= this.capacity) {
        throw new RangeError(`InstanceSlotMap: capacity ${this.capacity} exceeded by key ${key}`);
      }
      this.keyToSlot.set(key, slot);
      this.slotToKey.push(key);
      this.mesh.count = this.slotToKey.length;
    }
    this.mesh.setMatrixAt(slot, matrix);
    this.matrixDirty = true;
    if (color !== undefined) this.setSlotColor(slot, color);
    return slot;
  }

  /** Updates only the matrix of an existing key. Returns false if the key is absent. */
  setMatrix(key: number, matrix: THREE.Matrix4): boolean {
    const slot = this.keyToSlot.get(key);
    if (slot === undefined) return false;
    this.mesh.setMatrixAt(slot, matrix);
    this.matrixDirty = true;
    return true;
  }

  /** Updates only the colour of an existing key. Returns false if the key is absent. */
  setColor(key: number, color: THREE.Color): boolean {
    const slot = this.keyToSlot.get(key);
    if (slot === undefined) return false;
    this.setSlotColor(slot, color);
    return true;
  }

  getMatrix(key: number, target: THREE.Matrix4): boolean {
    const slot = this.keyToSlot.get(key);
    if (slot === undefined) return false;
    this.mesh.getMatrixAt(slot, target);
    return true;
  }

  remove(key: number): boolean {
    const slot = this.keyToSlot.get(key);
    if (slot === undefined) return false;
    const last = this.slotToKey.length - 1;
    if (slot !== last) {
      const lastKey = this.slotToKey[last];
      if (lastKey === undefined) throw new Error('InstanceSlotMap: slot table corrupted');
      this.mesh.getMatrixAt(last, scratchMatrix);
      this.mesh.setMatrixAt(slot, scratchMatrix);
      if (this.mesh.instanceColor !== null) {
        this.mesh.getColorAt(last, scratchColor);
        this.setSlotColor(slot, scratchColor);
      }
      this.slotToKey[slot] = lastKey;
      this.keyToSlot.set(lastKey, slot);
    }
    this.slotToKey.pop();
    this.keyToSlot.delete(key);
    this.mesh.count = this.slotToKey.length;
    this.matrixDirty = true;
    return true;
  }

  clear(): void {
    if (this.slotToKey.length === 0) return;
    this.keyToSlot.clear();
    this.slotToKey.length = 0;
    this.mesh.count = 0;
    this.matrixDirty = true;
  }

  forEach(fn: (key: number, slot: number) => void): void {
    for (let slot = 0; slot < this.slotToKey.length; slot++) {
      const key = this.slotToKey[slot];
      if (key !== undefined) fn(key, slot);
    }
  }

  /**
   * Uploads pending edits and refreshes culling bounds. Cheap when nothing changed.
   * Pass `{ bounds: false }` for small per-frame animations (a wobble, a bob) that stay inside
   * the existing bounds; skipping the O(count) sphere recomputation keeps them cheap. An empty
   * map hides its mesh so it drops out of the render and shadow lists entirely.
   */
  commit(options: { readonly bounds?: boolean } = {}): void {
    if (this.matrixDirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.count > 0 && options.bounds !== false) this.mesh.computeBoundingSphere();
      this.matrixDirty = false;
    }
    this.mesh.visible = this.mesh.count > 0;
    if (this.colorDirty && this.mesh.instanceColor !== null) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }

  private setSlotColor(slot: number, color: THREE.Color): void {
    this.mesh.setColorAt(slot, color);
    this.colorDirty = true;
  }
}
