/**
 * The Neighbours map's buildings (farmclaws part 4a spec §5.2), all pure geometry that runs in
 * node without a WebGL context:
 * - the farmhouse takes an optional roof colour, and without one the farm's farmhouse is built
 *   exactly as before;
 * - Cosmo's and Barnaby's houses are that farmhouse at the farm's scale, door on the door tile,
 *   alike but for the roof; the coop is a lower plank shed; all three stay inside their rects;
 * - every structure of every map draws something (R7's gap is closed);
 * - the map gets the farm style's fence, open at the west gate, within the draw-call budget.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUT, NEIGHBOUR_ROOFS } from '../src/config';
import { Direction, MAP_IDS, STRUCTURE_KINDS, type StructureKind } from '../src/core/types';
import { STRUCTURE_COLORS, createPartSet, type PartSet } from '../src/render/geometryParts';
import { getSharedGlowGlassMaterial } from '../src/render/materials';
import { PALETTE } from '../src/render/palette';
import type { SceneContext } from '../src/render/SceneContext';
import { planScenery } from '../src/render/sceneryGeometry';
import { FARMHOUSE_STEP_DEPTH, createFarmhouseGeometry, farmhousePlacement } from '../src/render/structureGeometry';
import { StructureRenderer } from '../src/render/StructureRenderer';
import { COOP_INSET, COOP_SHAPE, structureParts } from '../src/render/townGeometry';
import { tileCenterX, tileMinX, tileMinZ } from '../src/world/grid';
import { MAPS, type StructurePlacement } from '../src/world/maps';
import { NEIGHBOURS_BACK_BAND_DEPTH } from '../src/world/maps/neighbours';
import { BASE, withPlayer } from './testUtils';

const EPS = 1e-6;

/** Meshes the renderer would draw: visible, and instanced meshes only when they hold instances. */
function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverseVisible((object) => {
    if (object instanceof THREE.InstancedMesh) calls += object.count > 0 ? 1 : 0;
    else if (object instanceof THREE.Mesh) calls += 1;
  });
  return calls;
}

/** Sums of one attribute's x, y and z components over every vertex. */
function attributeSums(geometry: THREE.BufferGeometry, name: string): [number, number, number] {
  const attribute = geometry.getAttribute(name);
  const sums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < attribute.count; i++) {
    sums[0] += attribute.getX(i);
    sums[1] += attribute.getY(i);
    sums[2] += attribute.getZ(i);
  }
  return sums;
}

function colorAt(geometry: THREE.BufferGeometry, i: number): THREE.Color {
  const color = geometry.getAttribute('color');
  return new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
}

function sameColor(a: THREE.Color, b: THREE.Color): boolean {
  return Math.abs(a.r - b.r) < 1e-6 && Math.abs(a.g - b.g) < 1e-6 && Math.abs(a.b - b.b) < 1e-6;
}

describe('farmhouse roof colour', () => {
  const farm = farmhousePlacement(MAPS.farm.grid, LAYOUT.house, LAYOUT.houseDoor);

  it("builds the farm's farmhouse exactly as before without a roof colour", () => {
    // Pinned from the farmhouse as it was built before FarmhouseSpec had a roof colour.
    expect(farm.spec).toEqual({ width: expect.closeTo(4.4, 9), depth: expect.closeTo(4.1, 9), doorOffsetX: expect.closeTo(0, 9), stepDepth: 0.52 });
    const house = createFarmhouseGeometry(farm.spec);
    expect(Object.keys(house.body.attributes)).toEqual(['position', 'normal', 'color']);
    expect(house.body.getAttribute('position').count).toBe(3708);
    expect(house.glass.getAttribute('position').count).toBe(216);
    const expected: readonly (readonly [THREE.BufferGeometry, string, readonly [number, number, number]])[] = [
      [house.body, 'position', [1554.768013, 5737.09278, 4165.047803]],
      [house.body, 'normal', [0, 0.664085, 0]],
      [house.body, 'color', [1546.319354, 1036.524514, 844.572806]],
      [house.glass, 'position', [182.880002, 329.077111, 306.539995]],
    ];
    for (const [geometry, name, sums] of expected) {
      const actual = attributeSums(geometry, name);
      sums.forEach((sum, axis) => expect(actual[axis], `${name} ${axis}`).toBeCloseTo(sum, 3));
    }
    expect(house.height).toBeCloseTo(4.52428, 5);
  });

  it('recolours exactly the roof and the door awning, and moves nothing', () => {
    const plain = createFarmhouseGeometry(farm.spec);
    const roofed = createFarmhouseGeometry({ ...farm.spec, roofColor: NEIGHBOUR_ROOFS.cosmoHouse });
    expect(Array.from(roofed.body.getAttribute('position').array)).toEqual(Array.from(plain.body.getAttribute('position').array));
    expect(Array.from(roofed.body.getAttribute('normal').array)).toEqual(Array.from(plain.body.getAttribute('normal').array));
    expect(Array.from(roofed.glass.getAttribute('position').array)).toEqual(Array.from(plain.glass.getAttribute('position').array));
    // The farm's roof, its shingle rows and ridge, and the awning (in the roof colour) are the only parts that change.
    const roofTones = [PALETTE.houseRoof, STRUCTURE_COLORS.roofShade, STRUCTURE_COLORS.roofRidge].map((hex) => new THREE.Color(hex));
    let recoloured = 0;
    for (let i = 0; i < plain.body.getAttribute('color').count; i++) {
      const before = colorAt(plain.body, i);
      const onRoof = roofTones.some((tone) => sameColor(tone, before));
      expect(sameColor(colorAt(roofed.body, i), before), `vertex ${i}`).toBe(!onRoof);
      if (onRoof) recoloured++;
    }
    expect(recoloured).toBeGreaterThan(0);
    // Roofs in the new colour, shingles and ridge darker shades of it.
    const roof = new THREE.Color(NEIGHBOUR_ROOFS.cosmoHouse);
    let inNewRoof = 0;
    for (let i = 0; i < roofed.body.getAttribute('color').count; i++) if (sameColor(colorAt(roofed.body, i), roof)) inNewRoof++;
    expect(inNewRoof).toBeGreaterThan(0);
  });
});

describe('the Neighbours buildings', () => {
  const def = MAPS.neighbours;
  const grid = def.grid;

  function placed(kind: StructureKind): StructurePlacement {
    const s = def.structures.find((st) => st.kind === kind);
    if (s === undefined) throw new Error(`no ${kind} on the Neighbours map`);
    return s;
  }

  function partsOf(s: StructurePlacement): PartSet {
    const parts = createPartSet();
    structureParts(grid, def.cosmeticOffset, s, parts);
    return parts;
  }

  function boundsOf(geometries: readonly THREE.BufferGeometry[]): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const g of geometries) bounds.union(new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute));
    return bounds;
  }

  const farmHeight = createFarmhouseGeometry(farmhousePlacement(MAPS.farm.grid, LAYOUT.house, LAYOUT.houseDoor).spec).height;

  it('draws every structure of every map, and every structure kind stands on some map', () => {
    const kinds = new Set<StructureKind>();
    for (const id of MAP_IDS) {
      const map = MAPS[id];
      for (const s of map.structures) {
        const parts = createPartSet();
        structureParts(map.grid, map.cosmeticOffset, s, parts);
        expect(parts.body.length, `${id}: ${s.kind} at (${s.rect.x0}, ${s.rect.z0})`).toBeGreaterThan(0);
        kinds.add(s.kind);
      }
    }
    expect([...kinds].sort()).toEqual([...STRUCTURE_KINDS].sort());
  });

  it('keeps both houses and the coop inside their rects, standing on the ground', () => {
    for (const kind of ['cosmoHouse', 'chickenCoop', 'barnabyHouse'] as const) {
      const s = placed(kind);
      const parts = partsOf(s);
      const body = boundsOf([...parts.body, ...parts.glass]);
      expect(body.min.x, kind).toBeGreaterThanOrEqual(tileMinX(grid, s.rect.x0) - EPS);
      expect(body.max.x, kind).toBeLessThanOrEqual(tileMinX(grid, s.rect.x0 + s.rect.width) + EPS);
      expect(body.min.z, kind).toBeGreaterThanOrEqual(tileMinZ(grid, s.rect.z0) - EPS);
      expect(body.max.z, kind).toBeLessThanOrEqual(tileMinZ(grid, s.rect.z0 + s.rect.depth) + EPS);
      expect(body.min.y, kind).toBeGreaterThanOrEqual(-0.06);
      // Everything tall stands in the back band, which every one of these fills to its front row.
      expect(s.rect.z0 + s.rect.depth).toBeLessThanOrEqual(NEIGHBOURS_BACK_BAND_DEPTH);
    }
  });

  it("builds the houses at the farmhouse's scale, door on the door tile, with glowing windows", () => {
    for (const kind of ['cosmoHouse', 'barnabyHouse'] as const) {
      const s = placed(kind);
      if (s.door === null) throw new Error(`${kind} has no door`);
      const { spec, origin } = farmhousePlacement(grid, s.rect, s.door);
      expect(origin.x + spec.doorOffsetX).toBeCloseTo(tileCenterX(grid, s.door.tx), 9);
      expect(spec.stepDepth).toBe(FARMHOUSE_STEP_DEPTH);
      const parts = partsOf(s);
      // Five tiles deep like the farm's house, so the same roof rise and chimney height.
      expect(boundsOf(parts.body).max.y).toBeCloseTo(farmHeight, 5);
      expect(boundsOf(parts.glass).isEmpty()).toBe(false);
    }
  });

  it('roofs the two houses in their own colours and otherwise builds them alike', () => {
    expect(new Set([NEIGHBOUR_ROOFS.cosmoHouse, NEIGHBOUR_ROOFS.barnabyHouse, PALETTE.houseRoof]).size).toBe(3);
    const cosmo = placed('cosmoHouse');
    const barnaby = placed('barnabyHouse');
    const [a] = partsOf(cosmo).body;
    const [b] = partsOf(barnaby).body;
    if (a === undefined || b === undefined) throw new Error('a house built no body');
    const shift = tileMinX(grid, barnaby.rect.x0) - tileMinX(grid, cosmo.rect.x0);
    const pa = a.getAttribute('position');
    const pb = b.getAttribute('position');
    expect(pb.count).toBe(pa.count);
    let differ = 0;
    for (let i = 0; i < pa.count; i++) {
      expect(pb.getX(i) - shift).toBeCloseTo(pa.getX(i), 4);
      expect(pb.getY(i)).toBe(pa.getY(i));
      expect(pb.getZ(i)).toBe(pa.getZ(i));
      if (!sameColor(colorAt(a, i), colorAt(b, i))) differ++;
    }
    expect(Array.from(b.getAttribute('normal').array)).toEqual(Array.from(a.getAttribute('normal').array));
    expect(differ).toBeGreaterThan(0);
    expect(differ).toBeLessThan(pa.count / 2);
  });

  it('builds the coop lower than the houses, with a ramp out front and a glowing window', () => {
    const s = placed('chickenCoop');
    expect(s.door).toBeNull();
    const parts = partsOf(s);
    const body = boundsOf(parts.body);
    expect(body.max.y).toBeLessThan(farmHeight);
    // The ramp reaches out over the front inset, towards the lane.
    const wallFront = tileMinZ(grid, s.rect.z0 + s.rect.depth) - COOP_INSET.front;
    expect(body.max.z).toBeGreaterThanOrEqual(wallFront + COOP_SHAPE.rampRun - EPS);
    expect(boundsOf(parts.glass).isEmpty()).toBe(false);
  });

  it('fences the map in the farm style, with a gap at the west gate', () => {
    const plan = planScenery(def);
    expect(plan).toMatchObject({ fence: true, wall: false });
    expect(plan.gaps).toHaveLength(1);
    const gap = plan.gaps[0];
    if (gap === undefined) throw new Error('no gap');
    expect(gap.side).toBe('west');
    expect(gap.min).toBeLessThanOrEqual(tileMinZ(grid, 14));
    expect(gap.max).toBeGreaterThanOrEqual(tileMinZ(grid, 15));
  });

  it('draws the Neighbours map within the draw-call budget, its glass with the shared glow material', () => {
    const scene = new THREE.Scene();
    const renderer = new StructureRenderer({ scene } as unknown as SceneContext);
    const root = scene.getObjectByName('StructureRenderer');
    if (root === undefined) throw new Error('no root group');
    renderer.sync(withPlayer(BASE, { tx: 1, tz: 14 }, Direction.East, 'neighbours'), null);
    expect(root.children.filter((g) => g.visible).map((g) => g.name)).toEqual(['scenery-neighbours']);
    expect(drawCalls(root)).toBeLessThanOrEqual(14);
    const glass = root.getObjectByName('glow-glass');
    expect(glass instanceof THREE.Mesh && glass.material === getSharedGlowGlassMaterial()).toBe(true);
    renderer.dispose();
  });
});
