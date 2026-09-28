/**
 * Dense InstancedMesh slot allocator (src/render/InstanceSlotMap.ts).
 *
 * Live instances must always occupy slots [0, count) with mesh.count === size; removal
 * swaps the last live instance into the hole, carrying its matrix and colour with it; the
 * colour buffer exists before the first render; capacity overflow throws without corrupting
 * the map; commit() flags exactly the buffers that changed and refreshes culling bounds.
 * three's math and InstancedMesh run in node without a WebGL context.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/hash';
import { InstanceSlotMap } from '../src/render/InstanceSlotMap';
import { HEAVY_TEST_TIMEOUT_MS, Violations } from './testUtils';

function makeMesh(capacity: number): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), capacity);
}

/** Exactly representable in float32, so buffer reads compare exactly. */
function matrixFor(key: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(key, key * 0.5, -key),
    new THREE.Quaternion(),
    new THREE.Vector3(1 + (key % 4) * 0.25, 1, 1),
  );
}

function colorFor(key: number): THREE.Color {
  return new THREE.Color((key % 8) / 8, ((key * 3) % 8) / 8, ((key * 5) % 8) / 8);
}

function matrixAt(mesh: THREE.InstancedMesh, slot: number): number[] {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(slot, matrix);
  return matrix.elements.slice();
}

function colorAt(mesh: THREE.InstancedMesh, slot: number): [number, number, number] {
  const color = new THREE.Color();
  mesh.getColorAt(slot, color);
  return [color.r, color.g, color.b];
}

function rgb(color: THREE.Color): [number, number, number] {
  return [color.r, color.g, color.b];
}

describe('construction', () => {
  it('starts empty with a white, pre-allocated colour buffer and dynamic usage', () => {
    const mesh = makeMesh(16);
    const map = new InstanceSlotMap(mesh);
    expect(map.capacity).toBe(16);
    expect(map.size).toBe(0);
    expect(mesh.count).toBe(0);
    const colors = mesh.instanceColor;
    expect(colors).not.toBeNull();
    expect(colors?.count).toBe(16);
    expect(colors?.itemSize).toBe(3);
    expect(Array.from(colors?.array ?? [])).toEqual(new Array<number>(48).fill(1));
    expect(colors?.usage).toBe(THREE.DynamicDrawUsage);
    expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
  });

  it('can skip the colour buffer, and keeps an existing one', () => {
    const plain = makeMesh(4);
    new InstanceSlotMap(plain, false);
    expect(plain.instanceColor).toBeNull();

    const tinted = makeMesh(4);
    const existing = new THREE.InstancedBufferAttribute(new Float32Array(12).fill(0.5), 3);
    tinted.instanceColor = existing;
    new InstanceSlotMap(tinted);
    expect(tinted.instanceColor).toBe(existing);
    expect(existing.usage).toBe(THREE.DynamicDrawUsage);
  });
});

describe('set', () => {
  it('appends new keys densely and tracks mesh.count', () => {
    const mesh = makeMesh(8);
    const map = new InstanceSlotMap(mesh);
    expect(map.set(40, matrixFor(40), colorFor(40))).toBe(0);
    expect(map.set(7, matrixFor(7), colorFor(7))).toBe(1);
    expect(map.set(1234, matrixFor(1234))).toBe(2);
    expect(map.size).toBe(3);
    expect(mesh.count).toBe(3);
    expect(map.has(7)).toBe(true);
    expect(map.has(8)).toBe(false);
    expect(map.slotOf(1234)).toBe(2);
    expect(map.slotOf(8)).toBeUndefined();
    expect(matrixAt(mesh, 1)).toEqual(matrixFor(7).elements);
    expect(colorAt(mesh, 1)).toEqual(rgb(colorFor(7)));
    // No colour given: the pre-filled white stays.
    expect(colorAt(mesh, 2)).toEqual([1, 1, 1]);
  });

  it('updates an existing key in place without growing', () => {
    const mesh = makeMesh(8);
    const map = new InstanceSlotMap(mesh);
    map.set(1, matrixFor(1), colorFor(1));
    map.set(2, matrixFor(2), colorFor(2));
    expect(map.set(1, matrixFor(9), colorFor(9))).toBe(0);
    expect(map.size).toBe(2);
    expect(mesh.count).toBe(2);
    expect(matrixAt(mesh, 0)).toEqual(matrixFor(9).elements);
    expect(colorAt(mesh, 0)).toEqual(rgb(colorFor(9)));
    // Updating without a colour keeps the previous colour.
    map.set(1, matrixFor(3));
    expect(colorAt(mesh, 0)).toEqual(rgb(colorFor(9)));
  });

  it('throws on capacity overflow without corrupting the map', () => {
    const mesh = makeMesh(3);
    const map = new InstanceSlotMap(mesh);
    for (const key of [10, 11, 12]) map.set(key, matrixFor(key), colorFor(key));
    expect(() => map.set(13, matrixFor(13))).toThrow(RangeError);
    expect(map.size).toBe(3);
    expect(mesh.count).toBe(3);
    expect(map.has(13)).toBe(false);
    // Existing keys can still be updated at full capacity, and freed slots can be reused.
    expect(map.set(11, matrixFor(1))).toBe(1);
    map.remove(10);
    expect(map.set(13, matrixFor(13))).toBe(2);
    expect(map.size).toBe(3);
  });
});

describe('remove', () => {
  it('swaps the last instance into the freed slot, preserving its matrix and colour', () => {
    const mesh = makeMesh(8);
    const map = new InstanceSlotMap(mesh);
    for (const key of [100, 101, 102, 103]) map.set(key, matrixFor(key), colorFor(key));
    expect(map.remove(101)).toBe(true);
    expect(map.size).toBe(3);
    expect(mesh.count).toBe(3);
    expect(map.has(101)).toBe(false);
    expect(map.slotOf(103)).toBe(1);
    expect(matrixAt(mesh, 1)).toEqual(matrixFor(103).elements);
    expect(colorAt(mesh, 1)).toEqual(rgb(colorFor(103)));
    // Untouched instances stay where they were.
    expect(map.slotOf(100)).toBe(0);
    expect(map.slotOf(102)).toBe(2);
    expect(matrixAt(mesh, 2)).toEqual(matrixFor(102).elements);
  });

  it('just shrinks when removing the last instance', () => {
    const mesh = makeMesh(4);
    const map = new InstanceSlotMap(mesh);
    map.set(1, matrixFor(1), colorFor(1));
    map.set(2, matrixFor(2), colorFor(2));
    expect(map.remove(2)).toBe(true);
    expect(mesh.count).toBe(1);
    expect(matrixAt(mesh, 0)).toEqual(matrixFor(1).elements);
    expect(map.remove(2)).toBe(false);
    expect(map.remove(1)).toBe(true);
    expect(map.size).toBe(0);
    expect(mesh.count).toBe(0);
    expect(map.remove(1)).toBe(false);
  });

  it(
    'keeps instances dense and correct under thousands of random edits',
    () => {
      const capacity = 48;
      const mesh = makeMesh(capacity);
      const map = new InstanceSlotMap(mesh);
      const reference = new Map<number, { matrix: number[]; color: [number, number, number] }>();
      const rng = mulberry32(2024);
      const v = new Violations();
      let overflows = 0;

      for (let op = 0; op < 4000; op++) {
        const key = Math.floor(rng() * 80);
        const roll = rng();
        if (roll < 0.55) {
          if (!reference.has(key) && reference.size >= capacity) {
            let threw = false;
            try {
              map.set(key, matrixFor(key));
            } catch (error) {
              threw = error instanceof RangeError;
            }
            v.check(threw, `op ${op}: overflow did not throw a RangeError`);
            overflows++;
          } else {
            const variant = key + Math.floor(rng() * 4) * 100;
            const color = colorFor(variant);
            map.set(key, matrixFor(variant), color);
            reference.set(key, { matrix: matrixFor(variant).elements.slice(), color: rgb(color) });
          }
        } else if (roll < 0.9) {
          v.equal(`op ${op}: remove(${key})`, map.remove(key), reference.delete(key));
        } else if (roll < 0.95) {
          const entry = reference.get(key);
          const moved = matrixFor(key + 1000);
          v.equal(`op ${op}: setMatrix(${key})`, map.setMatrix(key, moved), entry !== undefined);
          if (entry !== undefined) entry.matrix = moved.elements.slice();
        } else {
          const entry = reference.get(key);
          const tint = colorFor(key + 3);
          v.equal(`op ${op}: setColor(${key})`, map.setColor(key, tint), entry !== undefined);
          if (entry !== undefined) entry.color = rgb(tint);
        }

        // Dense: size, mesh.count and the slot table agree after every single edit.
        v.equal(`op ${op}: size`, map.size, reference.size);
        v.equal(`op ${op}: mesh.count`, mesh.count, reference.size);
        const slots = new Set<number>();
        map.forEach((k, slot) => {
          v.check(slot < mesh.count && map.slotOf(k) === slot && reference.has(k), `op ${op}: key ${k} at slot ${slot}`);
          slots.add(slot);
        });
        v.equal(`op ${op}: distinct slots`, slots.size, reference.size);

        // Contents: every live key still has its own matrix and colour, wherever it moved.
        if (op % 25 === 0) {
          const out = new THREE.Matrix4();
          for (const [k, entry] of reference) {
            const slot = map.slotOf(k);
            if (slot === undefined) {
              v.check(false, `op ${op}: key ${k} lost`);
              continue;
            }
            v.equal(`op ${op}: matrix of ${k}`, matrixAt(mesh, slot), entry.matrix);
            v.equal(`op ${op}: colour of ${k}`, colorAt(mesh, slot), entry.color);
            v.check(map.getMatrix(k, out), `op ${op}: getMatrix(${k}) failed`);
            v.equal(`op ${op}: getMatrix(${k})`, out.elements, entry.matrix);
          }
        }
      }
      expect(v.head()).toEqual([]);
      expect(overflows).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe('partial updates, queries and clear', () => {
  it('setMatrix / setColor / getMatrix only touch existing keys', () => {
    const mesh = makeMesh(4);
    const map = new InstanceSlotMap(mesh);
    const out = new THREE.Matrix4();
    expect(map.setMatrix(5, matrixFor(5))).toBe(false);
    expect(map.setColor(5, colorFor(5))).toBe(false);
    expect(map.getMatrix(5, out)).toBe(false);
    expect(map.size).toBe(0);

    map.set(5, matrixFor(5), colorFor(5));
    expect(map.setMatrix(5, matrixFor(6))).toBe(true);
    expect(map.setColor(5, colorFor(6))).toBe(true);
    expect(map.getMatrix(5, out)).toBe(true);
    expect(out.elements).toEqual(matrixFor(6).elements);
    expect(colorAt(mesh, 0)).toEqual(rgb(colorFor(6)));
  });

  it('clear empties the map and restarts allocation at slot 0', () => {
    const mesh = makeMesh(4);
    const map = new InstanceSlotMap(mesh);
    for (const key of [1, 2, 3]) map.set(key, matrixFor(key));
    map.clear();
    expect(map.size).toBe(0);
    expect(mesh.count).toBe(0);
    expect(map.has(2)).toBe(false);
    let visited = 0;
    map.forEach(() => visited++);
    expect(visited).toBe(0);
    expect(map.set(9, matrixFor(9))).toBe(0);
  });

  it('forEach reports every (key, slot) pair in slot order', () => {
    const map = new InstanceSlotMap(makeMesh(8));
    for (const key of [30, 10, 20]) map.set(key, matrixFor(key));
    map.remove(30);
    const pairs: [number, number][] = [];
    map.forEach((key, slot) => pairs.push([key, slot]));
    expect(pairs).toEqual([
      [20, 0],
      [10, 1],
    ]);
  });
});

describe('commit', () => {
  it('flags exactly the buffers that changed (version increments) and is idempotent', () => {
    const mesh = makeMesh(8);
    const map = new InstanceSlotMap(mesh);
    const colors = mesh.instanceColor;
    if (colors === null) throw new Error('colour buffer missing');
    const versions = (): [number, number] => [mesh.instanceMatrix.version, colors.version];

    const v0 = versions();
    map.commit();
    expect(versions()).toEqual(v0);

    map.set(1, matrixFor(1), colorFor(1));
    map.set(2, matrixFor(2), colorFor(2));
    map.commit();
    const v1 = versions();
    expect(v1).toEqual([v0[0] + 1, v0[1] + 1]);
    map.commit();
    expect(versions()).toEqual(v1);

    map.setMatrix(1, matrixFor(3));
    map.commit();
    const v2 = versions();
    expect(v2).toEqual([v1[0] + 1, v1[1]]);

    map.setColor(2, colorFor(4));
    map.commit();
    const v3 = versions();
    expect(v3).toEqual([v2[0], v2[1] + 1]);

    // Removing a middle instance moves a colour too; removing the tail only shrinks.
    map.set(3, matrixFor(3), colorFor(3));
    map.commit();
    const v4 = versions();
    map.remove(1);
    map.commit();
    const v5 = versions();
    expect(v5).toEqual([v4[0] + 1, v4[1] + 1]);
    map.remove(2);
    map.commit();
    expect(versions()).toEqual([v5[0] + 1, v5[1]]);
  });

  it('recomputes the bounding sphere so culling covers every live instance', () => {
    const mesh = makeMesh(8);
    const map = new InstanceSlotMap(mesh);
    map.set(1, new THREE.Matrix4().makeTranslation(10, 0, 0));
    map.set(2, new THREE.Matrix4().makeTranslation(-4, 2, 0));
    map.commit();
    const sphere = mesh.boundingSphere;
    expect(sphere).not.toBeNull();
    expect(sphere?.containsPoint(new THREE.Vector3(10, 0, 0))).toBe(true);
    expect(sphere?.containsPoint(new THREE.Vector3(-4, 2, 0))).toBe(true);

    map.set(3, new THREE.Matrix4().makeTranslation(0, 0, 50));
    map.commit();
    expect(mesh.boundingSphere?.containsPoint(new THREE.Vector3(0, 0, 50))).toBe(true);

    map.clear();
    expect(() => map.commit()).not.toThrow();
    expect(mesh.count).toBe(0);
  });
});
