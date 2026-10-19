/**
 * The poster atlas (farmclaws part 4b spec §7, part 4d spec §5.3, §6.1, §7.2): FarmClaw's posters
 * and the made-up brands' with the spec's text, the Claw Fair banner, the door signs' OPEN and
 * CLOSED faces and SLOPMART's neon, each in its own cell of the one shared texture; the quads on
 * the town's walls, each UV'd into its cell; the door signs; and the bunting and banners. Node has
 * no canvas, so the drawing is checked on a context that records what it's asked to write.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../src/core/types';
import { SHOP_DOORS } from '../src/people/shops';
import { createPartSet } from '../src/render/geometryParts';
import {
  ATLAS_CELL_IDS,
  CLAW_FAIR,
  NEON_TEXT,
  POSTERS,
  POSTER_ATLAS,
  SIGN_FACES,
  drawPosterAtlas,
  neonCells,
  posterAspect,
  posterAtlasLayout,
  posterQuad,
  setQuadCell,
  type AtlasCell,
  type AtlasCellId,
} from '../src/render/posters';
import { BUNTING, CLAW_FAIR_BANNERS, doorSignParts, mapStructureParts, structureParts } from '../src/render/townGeometry';
import { tileCenterX, tileMinX, tileMinZ } from '../src/world/grid';
import { MAPS } from '../src/world/maps';
import { TOWN_MAIN_STREET } from '../src/world/maps/town';

const EPS = 1e-6;
const CELLS = posterAtlasLayout();

/** Whether every vertex of `quad` (from `first`, `count` of them) has its UV inside `c`. */
function uvsIn(quad: THREE.BufferGeometry, c: AtlasCell, first = 0, count = quad.getAttribute('uv').count): boolean {
  const uv = quad.getAttribute('uv');
  for (let i = first; i < first + count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < c.u0 - EPS || u > c.u1 + EPS || v < c.v0 - EPS || v > c.v1 + EPS) return false;
  }
  return true;
}

/** The cell a quad's UVs fall in, or null when they straddle cells or fall in none. */
function cellOf(quad: THREE.BufferGeometry): AtlasCellId | null {
  return ATLAS_CELL_IDS.find((id) => uvsIn(quad, CELLS[id])) ?? null;
}

function boxOf(part: THREE.BufferGeometry): THREE.Box3 {
  return new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute);
}

/** A 2D context that records the text written on it, with each character 9 px wide. */
function recordingContext(): { readonly g: CanvasRenderingContext2D; readonly texts: { readonly text: string; readonly x: number; readonly y: number }[] } {
  const texts: { text: string; x: number; y: number }[] = [];
  const props: Record<string | symbol, unknown> = {};
  const g = new Proxy(props, {
    get(target, key) {
      if (key === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y });
      if (key === 'measureText') return (text: string) => ({ width: text.length * 9 });
      return key in target ? target[key] : () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, texts };
}

/** The text written inside the pixel rect of `c`, in the order it was written. */
function textIn(texts: readonly { readonly text: string; readonly x: number; readonly y: number }[], c: AtlasCell, width: number, height: number): string[] {
  const inside = (t: { x: number; y: number }): boolean =>
    t.x > c.u0 * width && t.x < c.u1 * width && t.y > (1 - c.v1) * height && t.y < (1 - c.v0) * height;
  return texts.filter(inside).map((t) => t.text);
}

function overlaps(a: AtlasCell, b: AtlasCell): boolean {
  return a.u0 < b.u1 - EPS && b.u0 < a.u1 - EPS && a.v0 < b.v1 - EPS && b.v0 < a.v1 - EPS;
}

describe('the posters', () => {
  it("are part 4b's three FarmClaw ads and part 4d's four brands, with the spec's text verbatim", () => {
    expect(POSTERS.map((p) => [p.brand, p.slogan])).toEqual([
      ['FarmClaw', 'Your farm. Our claws.'],
      ['FarmClaw', 'Genuine FarmClaw parts.'],
      ['FarmClaw', 'Robots built to order.'],
      ['Byre', 'Milk from cows, not claws. 100% claw free.'],
      ['Tokenly', 'Keep your claws charged.'],
      ['Hollis Handpicked', 'Picked by people. Slowly.'],
      ['Sprocket Cereal', 'Part of a balanced robot.'],
    ]);
    expect(POSTERS.slice(0, 3).map((p) => p.picture)).toEqual(['claw', 'claw', 'claw']);
    expect(new Set(POSTERS.map((p) => p.id)).size).toBe(POSTERS.length);
    expect(CLAW_FAIR).toEqual({ brand: 'Claw Fair', slogan: 'Parade · Contest · Day 14' });
    expect(SIGN_FACES).toEqual(['OPEN', 'CLOSED']);
    expect(NEON_TEXT).toEqual({ title: 'SLOPMART 24/7', byline: 'A BARNABY VENTURE' });
  });

  it('gives every poster, the banner, both sign faces and the neon a cell of the atlas, inside it, with no two cells overlapping', () => {
    const cells = posterAtlasLayout();
    expect(Object.keys(cells).sort()).toEqual([...ATLAS_CELL_IDS].sort());
    for (const id of [...POSTERS.map((p) => p.id), 'clawFair', 'OPEN', 'CLOSED', 'neon'] as const) expect(ATLAS_CELL_IDS).toContain(id);
    const list = ATLAS_CELL_IDS.map((id) => cells[id]);
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

  it("builds a quad facing +Z at its cell's aspect, UV'd into its own cell, and moves it to another cell", () => {
    for (const id of [...POSTERS.map((p) => p.id), 'clawFair', 'OPEN', 'CLOSED'] as const) {
      const quad = posterQuad(id, 0.5, { x: 1, y: 2, z: 3 });
      expect(Object.keys(quad.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      const box = boxOf(quad);
      expect(box.max.y - box.min.y).toBeCloseTo(0.5, 6);
      expect(box.max.x - box.min.x).toBeCloseTo(0.5 * posterAspect(id), 6);
      expect(box.min.z).toBeCloseTo(3, 6);
      expect(box.max.z).toBeCloseTo(3, 6);
      expect(quad.getAttribute('normal').getZ(0)).toBeCloseTo(1, 6);
      expect(cellOf(quad)).toBe(id);
    }
    const sign = posterQuad('OPEN', 0.2, {});
    setQuadCell(sign.getAttribute('uv') as THREE.BufferAttribute, 0, CELLS.OPEN, CELLS.CLOSED);
    expect(cellOf(sign)).toBe('CLOSED');
    setQuadCell(sign.getAttribute('uv') as THREE.BufferAttribute, 0, CELLS.CLOSED, CELLS.OPEN);
    expect(cellOf(sign)).toBe('OPEN');
  });

  it("writes every poster's brand and slogan, the banner's, OPEN and CLOSED, and the neon's two lines verbatim in their cells", () => {
    const { g, texts } = recordingContext();
    drawPosterAtlas(g);
    const { width, height } = POSTER_ATLAS;
    const written = (c: AtlasCell): string[] => textIn(texts, c, width, height);
    // A long brand or slogan wraps a word at a time, so its lines rejoin into the text.
    for (const poster of POSTERS) expect(written(CELLS[poster.id]).join(' ')).toBe(`${poster.brand} ${poster.slogan}`);
    expect(written(CELLS.farmclawFarm)[0]).toBe('FarmClaw');
    const [brand, ...slogan] = written(CELLS.clawFair);
    expect(brand).toBe(CLAW_FAIR.brand);
    expect(slogan.join(' ')).toBe(CLAW_FAIR.slogan);
    for (const face of SIGN_FACES) expect(written(CELLS[face])).toEqual([face]);
    // The neon's title one character to a slot, so a letter can dim on its own; the byline in one piece.
    const neon = neonCells();
    expect(neon.title).toHaveLength(NEON_TEXT.title.length);
    expect(neon.title.map((c) => written(c).join('')).join('')).toBe(NEON_TEXT.title.replace(/ /g, ''));
    NEON_TEXT.title.split('').forEach((ch, i) => expect(written(neon.title[i]!).join(''), `slot ${i}`).toBe(ch.trim()));
    expect(written(neon.byline)).toEqual([NEON_TEXT.byline]);
  });
});

describe('posters on the shopfronts', () => {
  const town = MAPS.town;
  const placementOf = (kind: string) => {
    const s = town.structures.find((st) => st.kind === kind);
    if (s === undefined || s.door === null) throw new Error(`no ${kind} with a door`);
    return { s, door: s.door };
  };
  const postersOf = (kind: string) => {
    const { s, door } = placementOf(kind);
    const parts = createPartSet();
    structureParts(town.grid, town.cosmeticOffset, s, parts);
    return { s, door, quads: parts.posters };
  };

  it('puts one FarmClaw poster on each side of the parts exchange door', () => {
    const { door, quads } = postersOf('partsExchange');
    expect(quads.map(cellOf)).toEqual(['farmclawFarm', 'farmclawParts']);
    const [left, right] = quads.map(boxOf);
    expect(left!.max.x).toBeLessThan(tileMinX(town.grid, door.tx));
    expect(right!.min.x).toBeGreaterThan(tileMinX(town.grid, door.tx + 1));
  });

  it("puts the made-to-order poster on Juniper's workshop", () => {
    expect(postersOf('carpenter').quads.map(cellOf)).toEqual(['farmclawOrder']);
  });

  it('hangs Hollis Handpicked, Tokenly and Byre beside the general store, blacksmith and ranch doors, clear of the door', () => {
    for (const [kind, poster] of [['generalStore', 'hollis'], ['blacksmith', 'tokenly'], ['ranch', 'byre']] as const) {
      const { s, door, quads } = postersOf(kind);
      expect(quads.map(cellOf), kind).toEqual([poster]);
      const b = boxOf(quads[0]!);
      const doorX = tileCenterX(town.grid, door.tx);
      // Beside the door, not over it, within a tile and a half of it, on the wall's face.
      expect(Math.min(Math.abs(b.min.x - doorX), Math.abs(b.max.x - doorX)), kind).toBeGreaterThan(0.5);
      expect(Math.abs((b.min.x + b.max.x) / 2 - doorX), kind).toBeLessThan(1.5);
      expect(b.min.z, kind).toBeGreaterThan(tileMinZ(town.grid, s.rect.z0 + s.rect.depth) - 0.7);
      expect(quads[0]!.getAttribute('normal').getZ(0), kind).toBeCloseTo(1, 6);
    }
  });

  it("hangs Sprocket Cereal on SLOPMART's side wall, facing the camera's +X side", () => {
    const { s, quads } = postersOf('slopShop');
    expect(quads.map(cellOf)).toEqual(['sprocket']);
    const b = boxOf(quads[0]!);
    expect(quads[0]!.getAttribute('normal').getX(0)).toBeCloseTo(1, 6);
    expect(b.max.x).toBeLessThan(tileMinX(town.grid, s.rect.x0 + s.rect.width));
    expect(b.min.x).toBeGreaterThan(tileCenterX(town.grid, s.door!.tx));
  });

  it('has posters only in the town: three FarmClaw, four brands and the two Claw Fair banners', () => {
    for (const id of MAP_IDS) {
      const parts = createPartSet();
      mapStructureParts(MAPS[id], parts);
      expect(parts.posters).toHaveLength(id === 'town' ? 9 : 0);
    }
  });
});

describe('the door signs', () => {
  const town = MAPS.town;
  /** The posters' part whose first vertex, counted across every part before it, is `first`. */
  function quadAt(quads: readonly THREE.BufferGeometry[], first: number): THREE.BufferGeometry {
    let start = 0;
    for (const quad of quads) {
      if (start === first) return quad;
      start += quad.getAttribute('position').count;
    }
    throw new Error(`no part starts at vertex ${first}`);
  }

  it('hangs one sign at each shop door, reading OPEN as built, beside the door or, at the parts exchange, on it', () => {
    const parts = createPartSet();
    mapStructureParts(town, parts);
    const before = parts.posters.length;
    const signs = doorSignParts(town, parts);
    expect(signs.map((sign) => sign.shop).sort()).toEqual(SHOP_DOORS.map((d) => d.shop).sort());
    expect(parts.posters).toHaveLength(before + SHOP_DOORS.length);
    const posters = parts.posters.slice(0, before).map(boxOf);
    for (const sign of signs) {
      const quad = quadAt(parts.posters, sign.first);
      expect(cellOf(quad), sign.shop).toBe('OPEN');
      const b = boxOf(quad);
      const door = SHOP_DOORS.find((d) => d.shop === sign.shop)!.door;
      const doorMin = tileMinX(town.grid, door.tx);
      // Small, at eye height, on the front of the shop, in the back band.
      expect(b.max.x - b.min.x, sign.shop).toBeLessThan(0.5);
      expect(b.min.y, sign.shop).toBeGreaterThan(0.5);
      expect(b.max.y, sign.shop).toBeLessThan(1.5);
      expect(b.max.z, sign.shop).toBeLessThan(tileMinZ(town.grid, door.tz + 1));
      expect(b.min.z, sign.shop).toBeGreaterThan(tileMinZ(town.grid, door.tz));
      expect(Math.abs((b.min.x + b.max.x) / 2 - (doorMin + 0.5)), sign.shop).toBeLessThan(1);
      // Clear of every poster.
      for (const p of posters) expect(b.intersectsBox(p), sign.shop).toBe(false);
      if (sign.shop === 'partsExchange') {
        // On the door itself, between the FarmClaw posters.
        expect(b.min.x).toBeGreaterThan(doorMin + 0.05);
        expect(b.max.x).toBeLessThan(doorMin + 0.95);
      }
    }
  });

  it('hangs no signs off the town', () => {
    for (const id of MAP_IDS.filter((m) => m !== 'town')) expect(doorSignParts(MAPS[id], createPartSet())).toEqual([]);
  });
});

describe('the bunting and the Claw Fair banners', () => {
  const town = MAPS.town;
  const lamps = town.structures.filter((s) => s.kind === 'lampPost').map((s) => `${s.rect.x0},${s.rect.z0}`);

  it('strings bunting between the lamp posts, round the square and out to both main-street posts', () => {
    const ends = new Set<string>();
    for (const [from, to] of BUNTING) {
      for (const end of [from, to]) {
        expect(lamps).toContain(`${end.tx},${end.tz}`);
        ends.add(`${end.tx},${end.tz}`);
      }
    }
    expect([...ends].sort()).toEqual([...lamps].sort());
  });

  it('hangs two banners over the main street, facing +X and well above head height', () => {
    expect(CLAW_FAIR_BANNERS).toHaveLength(2);
    const parts = createPartSet();
    mapStructureParts(town, parts);
    const banners = parts.posters.filter((q) => cellOf(q) === 'clawFair');
    expect(banners).toHaveLength(2);
    const streetMin = tileMinZ(town.grid, TOWN_MAIN_STREET.z0);
    const streetMax = tileMinZ(town.grid, TOWN_MAIN_STREET.z0 + TOWN_MAIN_STREET.depth);
    for (const banner of banners) {
      const b = boxOf(banner);
      expect(b.min.z).toBeGreaterThanOrEqual(streetMin - EPS);
      expect(b.max.z).toBeLessThanOrEqual(streetMax + EPS);
      expect(b.min.y).toBeGreaterThan(1.5);
      expect(banner.getAttribute('normal').getX(0)).toBeCloseTo(1, 6);
    }
  });
});
