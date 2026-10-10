/**
 * The FarmClaw posters (farmclaws part 4b spec §7): the poster list with the spec's brand and
 * slogan text, the atlas layout that gives each poster its own cell of the one shared texture,
 * and the poster quads on the town's shopfronts, each UV'd into its poster's cell. Drawing the
 * atlas needs a canvas, which node hasn't got; the drawing itself is checked by playing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../src/core/types';
import { createPartSet } from '../src/render/geometryParts';
import { POSTERS, POSTER_ASPECT, posterAtlasLayout, posterQuad, type AtlasCell, type PosterId } from '../src/render/posters';
import { mapStructureParts, structureParts } from '../src/render/townGeometry';
import { tileMinX } from '../src/world/grid';
import { MAPS } from '../src/world/maps';

const EPS = 1e-6;

/** The cell a quad's UVs fall in, or null when they straddle cells or fall in none. */
function cellOf(quad: THREE.BufferGeometry): PosterId | null {
  const uv = quad.getAttribute('uv');
  const cells = posterAtlasLayout();
  for (const poster of POSTERS) {
    const c = cells[poster.id];
    let inside = true;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (u < c.u0 - EPS || u > c.u1 + EPS || v < c.v0 - EPS || v > c.v1 + EPS) inside = false;
    }
    if (inside) return poster.id;
  }
  return null;
}

function overlaps(a: AtlasCell, b: AtlasCell): boolean {
  return a.u0 < b.u1 - EPS && b.u0 < a.u1 - EPS && a.v0 < b.v1 - EPS && b.v0 < a.v1 - EPS;
}

describe('the posters', () => {
  it("are part 4b's three FarmClaw ads, with the spec's brand and slogans and a claw", () => {
    expect(POSTERS.map((p) => [p.brand, p.slogan, p.picture])).toEqual([
      ['FarmClaw', 'Your farm. Our claws.', 'claw'],
      ['FarmClaw', 'Genuine FarmClaw parts.', 'claw'],
      ['FarmClaw', 'Robots built to order.', 'claw'],
    ]);
    expect(new Set(POSTERS.map((p) => p.id)).size).toBe(POSTERS.length);
  });

  it('gives every poster a cell of the atlas, inside it, with no two cells overlapping', () => {
    const cells = posterAtlasLayout();
    expect(Object.keys(cells).sort()).toEqual(POSTERS.map((p) => p.id).sort());
    const list = POSTERS.map((p) => cells[p.id]);
    for (const c of list) {
      expect(c.u0).toBeGreaterThanOrEqual(0);
      expect(c.v0).toBeGreaterThanOrEqual(0);
      expect(c.u1).toBeLessThanOrEqual(1);
      expect(c.v1).toBeLessThanOrEqual(1);
      expect(c.u1).toBeGreaterThan(c.u0);
      expect(c.v1).toBeGreaterThan(c.v0);
    }
    list.forEach((a, i) => list.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  });

  it("builds a poster's quad facing +Z at the poster's aspect, UV'd into its own cell", () => {
    for (const poster of POSTERS) {
      const quad = posterQuad(poster.id, 0.5, { x: 1, y: 2, z: 3 });
      expect(Object.keys(quad.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      const box = new THREE.Box3().setFromBufferAttribute(quad.getAttribute('position') as THREE.BufferAttribute);
      expect(box.max.y - box.min.y).toBeCloseTo(0.5, 6);
      expect(box.max.x - box.min.x).toBeCloseTo(0.5 * POSTER_ASPECT, 6);
      expect(box.min.z).toBeCloseTo(3, 6);
      expect(box.max.z).toBeCloseTo(3, 6);
      expect(quad.getAttribute('normal').getZ(0)).toBeCloseTo(1, 6);
      expect(cellOf(quad)).toBe(poster.id);
    }
  });
});

describe('posters on the shopfronts', () => {
  const town = MAPS.town;
  const postersOf = (kind: 'partsExchange' | 'carpenter') => {
    const s = town.structures.find((st) => st.kind === kind);
    if (s === undefined || s.door === null) throw new Error(`no ${kind} with a door`);
    const parts = createPartSet();
    structureParts(town.grid, town.cosmeticOffset, s, parts);
    return { s, door: s.door, quads: parts.posters };
  };

  it('puts one FarmClaw poster on each side of the parts exchange door', () => {
    const { door, quads } = postersOf('partsExchange');
    expect(quads.map(cellOf)).toEqual(['farmclawFarm', 'farmclawParts']);
    const [left, right] = quads.map((q) => new THREE.Box3().setFromBufferAttribute(q.getAttribute('position') as THREE.BufferAttribute));
    expect(left!.max.x).toBeLessThan(tileMinX(town.grid, door.tx));
    expect(right!.min.x).toBeGreaterThan(tileMinX(town.grid, door.tx + 1));
  });

  it("puts the made-to-order poster on Juniper's workshop", () => {
    expect(postersOf('carpenter').quads.map(cellOf)).toEqual(['farmclawOrder']);
  });

  it('has posters only in the town, three of them', () => {
    for (const id of MAP_IDS) {
      const parts = createPartSet();
      mapStructureParts(MAPS[id], parts);
      expect(parts.posters).toHaveLength(id === 'town' ? 3 : 0);
    }
  });
});
