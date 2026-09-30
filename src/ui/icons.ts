/**
 * Inline SVG icons for the HUD, assembled with DOM APIs (createElementNS + setAttribute) so no
 * markup string is ever parsed.
 *
 * Style: every icon is a handful of flat polygons, a base fill plus lighter and darker facets
 * and a warm ink outline drawn last, which echoes the flat-shaded low-poly look of the 3D farm.
 * Item icons take their colours from the item and crop registries, so a new crop gets a
 * matching seed packet and produce icon without any extra art.
 *
 * All icons use a 32 × 32 viewBox (the day dial uses 64 × 36). Builders return fresh detached
 * nodes; callers that show the same icon many times should build it once and cloneNode(true).
 */
import { Weather, type MessageTone, type ToolType } from '../core/types';
import { CROPS, type CropVisual } from '../farming/crops';
import type { FertilizerItem, ItemDefinition, MaterialItem, PlaceableItem, SeedItem } from '../items/items';
import { PALETTE } from '../render/palette';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Outline colour shared by every icon (matches --hud-ink in hud.css). */
const INK = '#5a3d2b';
const OUTLINE_WIDTH = 1.4;
/** Shadows mix toward a warm brown instead of black so darker facets stay cosy. */
const SHADE_TARGET = 0x4a2c1f;
const WHITE = 0xffffff;

/** Default class for item icons that fill their container. */
export const ICON_CLASS = 'hud-icon';
/** Default class for small icons that sit inline with text. */
export const INLINE_ICON_CLASS = 'hud-inline-icon';

const COLORS = {
  mushroomStem: 0xf6ead6,
  handle: 0xc4945f,
  metal: 0xb9c1d6,
  gold: 0xf7c948,
  silver: 0xcfd8e6,
  sun: 0xffd35c,
  sunRay: 0xffb347,
  moon: 0xfff1b8,
  cloud: 0xf7f4ff,
  stormCloud: 0xbdb6d6,
  rain: 0x7fb8e6,
  snow: 0x8fbfe8,
  bolt: 0xffd966,
  sprout: 0x7cc36b,
  soil: PALETTE.soilPlowed,
  warn: 0xffb070,
  paper: 0xfff8ea,
  melonPeek: 0x9ad97c,
  logEnd: PALETTE.stumpTop,
  stem: PALETTE.treeTrunk,
  crate: PALETTE.binWood,
  crateLid: PALETTE.binLid,
} as const;

type Point = readonly [number, number];
type Attrs = Readonly<Record<string, string | number>>;

// ---------------------------------------------------------------------------
// Low-level builders
// ---------------------------------------------------------------------------

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  children: readonly SVGElement[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, typeof value === 'number' ? fmt(value) : value);
  }
  if (children.length > 0) node.append(...children);
  return node;
}

function svgRoot(children: readonly SVGElement[], className: string, viewBox = '0 0 32 32'): SVGSVGElement {
  return svgNode('svg', { viewBox, class: className, 'aria-hidden': 'true', focusable: 'false' }, children);
}

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * t) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function light(color: number, amount: number): string {
  return hex(mix(color, WHITE, amount));
}

function dark(color: number, amount: number): string {
  return hex(mix(color, SHADE_TARGET, amount));
}

function pts(points: readonly Point[]): string {
  return points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
}

function vertex(points: readonly Point[], index: number): Point {
  return points[((index % points.length) + points.length) % points.length] ?? [0, 0];
}

/** Regular polygon; rotationDeg = 0 puts the first vertex on +X (SVG y points down). */
function regularPolygon(cx: number, cy: number, radius: number, sides: number, rotationDeg: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((rotationDeg + (360 * i) / sides) * Math.PI) / 180;
    result.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return result;
}

/** A filled polygon with the ink outline. */
function outlined(points: string, fill: string): SVGPolygonElement {
  return svgNode('polygon', {
    points,
    fill,
    stroke: INK,
    'stroke-width': OUTLINE_WIDTH,
    'stroke-linejoin': 'round',
  });
}

/** An unoutlined facet, drawn on top of a base fill. */
function facet(points: string, fill: string): SVGPolygonElement {
  return svgNode('polygon', { points, fill });
}

/**
 * Base fill, then facets, then the outline on top, so facets that touch the silhouette never
 * thin its outline.
 */
function faceted(points: string, fill: string, facets: readonly SVGElement[]): SVGGElement {
  return svgNode('g', {}, [
    svgNode('polygon', { points, fill }),
    ...facets,
    svgNode('polygon', {
      points,
      fill: 'none',
      stroke: INK,
      'stroke-width': OUTLINE_WIDTH,
      'stroke-linejoin': 'round',
    }),
  ]);
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): SVGLineElement {
  return svgNode('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round' });
}

/** A tool handle: ink outline, body colour and a thin highlight along its left edge. */
function stick(x1: number, y1: number, x2: number, y2: number, color: number, width: number): SVGGElement {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const offset = -width * 0.22;
  const nx = (-dy / length) * offset;
  const ny = (dx / length) * offset;
  return svgNode('g', {}, [
    line(x1, y1, x2, y2, INK, width + OUTLINE_WIDTH * 2),
    line(x1, y1, x2, y2, hex(color), width),
    line(x1 + dx * 0.1 + nx, y1 + dy * 0.1 + ny, x1 + dx * 0.9 + nx, y1 + dy * 0.9 + ny, light(color, 0.4), width * 0.32),
  ]);
}

function tilt(children: readonly SVGElement[], degrees: number): SVGGElement {
  return svgNode('g', { transform: `rotate(${degrees} 16 16)` }, children);
}

/** Faceted hexagonal gem (berries, the seed packet emblem, the crate's peeking produce). */
function gem(cx: number, cy: number, radius: number, color: number): SVGGElement {
  const v = regularPolygon(cx, cy, radius, 6, -90);
  const centre: Point = [cx, cy];
  const shades: readonly (string | null)[] = [
    light(color, 0.28),
    null,
    dark(color, 0.2),
    dark(color, 0.1),
    null,
    light(color, 0.5),
  ];
  const facets: SVGElement[] = [];
  shades.forEach((fill, i) => {
    if (fill !== null) facets.push(facet(pts([centre, vertex(v, i), vertex(v, i + 1)]), fill));
  });
  facets.push(
    svgNode('circle', {
      cx: cx - radius * 0.35,
      cy: cy - radius * 0.4,
      r: Math.max(0.6, radius * 0.16),
      fill: hex(WHITE),
      'fill-opacity': 0.75,
    }),
  );
  return faceted(pts(v), hex(color), facets);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Diagonal handle with a narrow neck that flares into a wide blade pointing at the ground. */
function hoeParts(color: number): SVGElement[] {
  const metal = COLORS.metal;
  return [
    stick(6.5, 29, 20.5, 6.4, color, 3),
    faceted('18.8,4.2 25,3.8 26.6,6.6 30,17.4 20.8,17.4 23.4,7.8 18.8,8', hex(metal), [
      facet('18.8,4.2 25,3.8 26.6,6.6 23.4,7.8 18.8,8', light(metal, 0.35)),
      facet('23.4,7.8 25.2,7.2 25.4,17.4 20.8,17.4', light(metal, 0.5)),
      facet('25.2,7.2 26.6,6.6 30,17.4 25.4,17.4', dark(metal, 0.2)),
      line(21.6, 16.2, 29.2, 16.2, light(metal, 0.75), 0.9),
    ]),
  ];
}

function wateringCanParts(color: number): SVGElement[] {
  const handle = 'M10 12.5 C 9.5 5, 19.5 5, 19 12.5';
  return [
    svgNode('path', { d: handle, fill: 'none', stroke: INK, 'stroke-width': 4.6, 'stroke-linecap': 'round' }),
    svgNode('path', { d: handle, fill: 'none', stroke: dark(color, 0.15), 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
    faceted('20.5,17.2 27.4,9 29.2,10.6 22,21', hex(color), [facet('20.5,17.2 27.4,9 28.3,9.8 21.2,19', light(color, 0.3))]),
    faceted('25.4,7.2 29.8,6 31,10.4 28,12', light(color, 0.3), [facet('29.8,6 31,10.4 28,12', dark(color, 0.05))]),
    faceted('7.5,12.5 21.5,12.5 23,27.5 6,27.5', hex(color), [
      facet('7.5,12.5 11.4,12.5 10.4,27.5 6,27.5', light(color, 0.35)),
      facet('18.2,12.5 21.5,12.5 23,27.5 19.2,27.5', dark(color, 0.18)),
      facet('14.5,16.5 16.8,20.2 14.5,22.4 12.2,20.2', light(color, 0.6)),
    ]),
    faceted('6.8,10.8 22.2,10.8 22.2,13.6 6.8,13.6', light(color, 0.2), [
      facet('6.8,10.8 22.2,10.8 22.2,11.8 6.8,11.8', light(color, 0.5)),
    ]),
  ];
}

function pickaxeParts(color: number): SVGElement[] {
  const handle = COLORS.handle;
  return [
    tilt(
      [
        stick(16, 29.5, 16, 7.5, handle, 3),
        faceted('3.5,12.5 8,7 16,4.2 24,7 28.5,12.5 24,9.6 16,8.4 8,9.6', hex(color), [
          facet('8,7 16,4.2 24,7 16,6.4', light(color, 0.45)),
          facet('3.5,12.5 8,9.6 8,7', dark(color, 0.15)),
          facet('28.5,12.5 24,9.6 24,7', dark(color, 0.25)),
        ]),
        faceted('14.2,6.2 17.8,6.2 17.8,10.4 14.2,10.4', dark(handle, 0.25), [
          facet('14.2,6.2 15.6,6.2 15.6,10.4 14.2,10.4', dark(handle, 0.05)),
        ]),
      ],
      30,
    ),
  ];
}

function axeParts(color: number): SVGElement[] {
  const metal = COLORS.metal;
  return [
    tilt(
      [
        stick(14, 29.5, 14, 5, color, 3.2),
        faceted('12.6,5.2 20.5,3.8 27,7.4 27.6,16.2 21,17.4 12.6,12.8', hex(metal), [
          facet('24.4,6 27,7.4 27.6,16.2 24.8,16.7', light(metal, 0.5)),
          facet('12.6,5.2 16.4,4.5 16.4,14.9 12.6,12.8', dark(metal, 0.25)),
          facet('16.4,4.5 20.5,3.8 24.4,6 16.4,7.4', light(metal, 0.25)),
        ]),
      ],
      28,
    ),
  ];
}

function scytheParts(color: number): SVGElement[] {
  const handle = COLORS.handle;
  return [
    tilt(
      [
        stick(18, 30, 18, 4.5, handle, 2.8),
        stick(18, 18, 22.5, 16.4, handle, 2.4),
        faceted('19.5,3 11,3.2 5,5.8 1.8,10.6 7,8.2 12.2,7 19.5,6.8', hex(color), [
          facet('19.5,3 11,3.2 5,5.8 11.6,4.9 19.5,4.8', light(color, 0.5)),
          facet('1.8,10.6 7,8.2 12.2,7 7.6,7.2', dark(color, 0.2)),
        ]),
      ],
      20,
    ),
  ];
}

function toolParts(tool: ToolType, color: number): SVGElement[] {
  switch (tool) {
    case 'hoe':
      return hoeParts(color);
    case 'wateringCan':
      return wateringCanParts(color);
    case 'pickaxe':
      return pickaxeParts(color);
    case 'axe':
      return axeParts(color);
    case 'scythe':
      return scytheParts(color);
  }
}

// ---------------------------------------------------------------------------
// Seeds, produce, materials
// ---------------------------------------------------------------------------

function seedPacketParts(item: SeedItem): SVGElement[] {
  const visual = CROPS[item.cropId].visual;
  const leaf = visual.foliageColor;
  const paper = mix(leaf, COLORS.paper, 0.62);
  return [
    faceted('8,7 24,7 24.6,28.4 7.4,28.4', hex(paper), [
      facet('7.9,13.2 24.2,13.2 24.4,23.8 7.6,23.8', hex(leaf)),
      facet('21.4,7 24,7 24.6,28.4 21.6,28.4', dark(paper, 0.12)),
      facet('21.4,13.2 24.2,13.2 24.4,23.8 21.6,23.8', dark(leaf, 0.14)),
      svgNode('circle', { cx: 12, cy: 26, r: 0.9, fill: dark(paper, 0.4) }),
      svgNode('circle', { cx: 15.5, cy: 26.4, r: 0.9, fill: dark(paper, 0.4) }),
      svgNode('circle', { cx: 19, cy: 26, r: 0.9, fill: dark(paper, 0.4) }),
    ]),
    faceted('7.6,8.4 7.6,6.2 9.6,4 11.6,6.2 13.6,4 15.6,6.2 17.6,4 19.6,6.2 21.6,4 23.6,6.2 24.3,6.2 24.3,8.4', dark(paper, 0.1), [
      facet('7.6,6.2 9.6,4 11.6,6.2 13.6,4 15.6,6.2 17.6,4 19.6,6.2 21.6,4 23.6,6.2', light(paper, 0.4)),
    ]),
    gem(15.6, 18.6, 4.4, visual.produceColor),
  ];
}

function bulbParts(color: number, leaf: number): SVGElement[] {
  return [
    outlined('16,11.5 10.5,3.2 14.4,4 16.8,10.4', hex(leaf)),
    outlined('16.2,11 16.2,1.8 19,5.2 17.6,10.6', light(leaf, 0.15)),
    outlined('16.6,11.6 23,4.6 21.6,8.4 17.8,12', hex(leaf)),
    faceted('10,13 16,10.5 22,13 21,19 16.6,29.6 15.4,29.6 11,19', hex(color), [
      facet('10,13 16,10.5 14.2,16.5 11,19', light(color, 0.45)),
      facet('16,10.5 22,13 17.4,17 14.2,16.5', light(color, 0.2)),
      facet('22,13 21,19 16.6,29.6 17.4,17', dark(color, 0.18)),
    ]),
  ];
}

/** A lumpy, leafless tuber (bulb produce grown on a bush, e.g. potatoes). */
function tuberParts(color: number, leaf: number): SVGElement[] {
  const eye = dark(color, 0.45);
  return [
    faceted('4.5,18 7,11.5 13,8 21,7.5 27,11 28.5,17.5 25.5,23.5 18,26.5 10,25.5', hex(color), [
      facet('7,11.5 13,8 21,7.5 16,13.5 9.5,15', light(color, 0.4)),
      facet('4.5,18 7,11.5 9.5,15 12,20 10,25.5', light(color, 0.15)),
      facet('21,7.5 27,11 28.5,17.5 22.5,17 16,13.5', dark(color, 0.08)),
      facet('28.5,17.5 25.5,23.5 18,26.5 17.5,20.5 22.5,17', dark(color, 0.22)),
      svgNode('circle', { cx: 12.5, cy: 17.5, r: 0.9, fill: eye }),
      svgNode('circle', { cx: 19.5, cy: 14.5, r: 0.9, fill: eye }),
      svgNode('circle', { cx: 21.5, cy: 21, r: 0.9, fill: eye }),
    ]),
    faceted('20.5,8 23.5,3.2 25.5,6.8', hex(leaf), [facet('20.5,8 23.5,3.2 22.6,7.2', light(leaf, 0.25))]),
  ];
}

function headParts(color: number, leaf: number): SVGElement[] {
  return [
    faceted('3,22 9.5,14 15,23.5 8.5,27.5', hex(leaf), [facet('3,22 9.5,14 9,22', light(leaf, 0.25))]),
    faceted('29,22 22.5,14 17,23.5 23.5,27.5', hex(leaf), [facet('29,22 22.5,14 23,22', dark(leaf, 0.15))]),
    faceted('8.5,14.5 11.5,8.5 16,6.5 20.5,8.5 23.5,14.5 21.5,20.5 16,22.5 10.5,20.5', hex(color), [
      facet('11.5,8.5 16,6.5 16.5,12 11,13.5', light(color, 0.5)),
      facet('16,6.5 20.5,8.5 21.5,13 16.5,12', light(color, 0.25)),
      facet('8.5,14.5 11,13.5 13.5,17.5 10.5,20.5', dark(color, 0.05)),
      facet('23.5,14.5 21.5,20.5 18,17.5 21.5,13', dark(color, 0.16)),
      facet('10.5,20.5 13.5,17.5 18,17.5 21.5,20.5 16,22.5', dark(color, 0.1)),
    ]),
    faceted('9.5,27.5 16,20.5 22.5,27.5 16,30', light(leaf, 0.1), [facet('16,20.5 22.5,27.5 16,30', dark(leaf, 0.1))]),
  ];
}

function berriesParts(color: number, leaf: number): SVGElement[] {
  return [
    gem(16, 12.6, 5.6, color),
    gem(10.4, 20.8, 5.6, color),
    gem(21.6, 20.8, 5.6, color),
    faceted('12.4,6.6 16,2.8 19.6,6.6 16,8.4', hex(leaf), [facet('16,2.8 19.6,6.6 16,8.4', dark(leaf, 0.15))]),
  ];
}

function cobParts(color: number, leaf: number): SVGElement[] {
  const kernel = dark(color, 0.28);
  return [
    faceted('12,9 16,3.5 20,9 21,18 16,24.5 11,18', hex(color), [
      facet('12,9 16,3.5 16,24.5 11,18', light(color, 0.28)),
      line(14, 6.5, 13.6, 21.5, kernel, 0.7),
      line(18, 6.5, 18.4, 21.5, kernel, 0.7),
      line(12.4, 9, 19.6, 9, kernel, 0.7),
      line(11.9, 12.5, 20.1, 12.5, kernel, 0.7),
      line(11.6, 16, 20.4, 16, kernel, 0.7),
      line(12.6, 19.5, 19.4, 19.5, kernel, 0.7),
    ]),
    faceted('16,29 8.5,25 6,13 12.5,19.5', hex(leaf), [facet('8.5,25 6,13 12.5,19.5', light(leaf, 0.25))]),
    faceted('16,29 23.5,25 26,13 19.5,19.5', hex(leaf), [facet('16,29 23.5,25 19.5,19.5', dark(leaf, 0.15))]),
  ];
}

function gourdParts(color: number, leaf: number): SVGElement[] {
  return [
    outlined('15,4.8 17.6,4 18.2,9.2 15.4,9.4', hex(COLORS.stem)),
    faceted('18,6.2 24.5,3.4 23.2,7.8', hex(leaf), [facet('18,6.2 24.5,3.4 21,6.4', light(leaf, 0.25))]),
    faceted('4,17 7,11 12,8.5 16,8 20,8.5 25,11 28,17 25.5,24 20,27 12,27 6.5,24', hex(color), [
      facet('4,17 7,11 10.8,9.2 9.2,17.5 10.8,26.6 6.5,24', dark(color, 0.14)),
      facet('14,8.2 18,8.2 19.2,17.5 18,27 14,27 12.8,17.5', light(color, 0.3)),
      facet('28,17 25,11 21.2,9.2 22.8,17.5 21.2,26.6 25.5,24', dark(color, 0.2)),
      facet('7.4,12.6 10,10.2 8.6,14.4', light(color, 0.55)),
    ]),
  ];
}

/** A sheaf of wheat: three stalks, each topped with a faceted ear of kernels. */
function earsParts(color: number, leaf: number): SVGElement[] {
  const ear = (x: number, tilt: number): SVGElement =>
    svgNode('g', { transform: `rotate(${tilt} ${x} 27)` }, [
      line(x, 27, x, 13, hex(leaf), 1.4),
      faceted(`${x},3.5 ${x + 2.6},7.5 ${x + 2.2},13 ${x},15.5 ${x - 2.2},13 ${x - 2.6},7.5`, hex(color), [
        facet(`${x},3.5 ${x - 2.6},7.5 ${x - 2.2},13 ${x},15.5`, light(color, 0.3)),
        facet(`${x - 2.4},10 ${x + 2.4},10 ${x + 2.2},11 ${x - 2.2},11`, dark(color, 0.2)),
      ]),
    ]);
  return [ear(16, -16), ear(16, 16), ear(16, 0), line(11.5, 23, 20.5, 23, dark(leaf, 0.1), 2.2)];
}

/** Two faceted toadstools of different sizes: pale stems under domed caps. */
function mushroomParts(color: number): SVGElement[] {
  const cap = (cx: number, cy: number, r: number): SVGElement =>
    faceted(`${cx - r},${cy} ${cx - r * 0.7},${cy - r * 0.62} ${cx},${cy - r * 0.85} ${cx + r * 0.7},${cy - r * 0.62} ${cx + r},${cy}`, hex(color), [
      facet(`${cx - r},${cy} ${cx - r * 0.7},${cy - r * 0.62} ${cx},${cy - r * 0.85} ${cx - r * 0.2},${cy - r * 0.3}`, light(color, 0.3)),
      facet(`${cx + r * 0.7},${cy - r * 0.62} ${cx + r},${cy} ${cx + r * 0.3},${cy - r * 0.25}`, dark(color, 0.18)),
    ]);
  const stem = (cx: number, top: number, bottom: number, w: number): SVGElement =>
    outlined(`${cx - w},${top} ${cx + w},${top} ${cx + w * 1.2},${bottom} ${cx - w * 1.2},${bottom}`, hex(COLORS.mushroomStem));
  return [stem(20.5, 17, 27, 2), cap(20.5, 17.5, 6.5), stem(11, 12, 27, 2.6), cap(11, 12.5, 8.5)];
}

function produceParts(visual: CropVisual): SVGElement[] {
  const color = visual.produceColor;
  const leaf = visual.foliageColor;
  switch (visual.produce) {
    case 'bulb':
      return visual.form === 'bush' ? tuberParts(color, leaf) : bulbParts(color, leaf);
    case 'head':
      return headParts(color, leaf);
    case 'berries':
      return berriesParts(color, leaf);
    case 'cob':
      return cobParts(color, leaf);
    case 'gourd':
      return gourdParts(color, leaf);
    case 'ears':
      return earsParts(color, leaf);
    case 'none':
      return visual.form === 'fungus' ? mushroomParts(color) : headParts(color, leaf);
  }
}

function logParts(dx: number, dy: number, color: number): SVGGElement {
  const end = COLORS.logEnd;
  return svgNode('g', { transform: `translate(${dx} ${dy})` }, [
    faceted('8,11 26,9 27,17 9,19', hex(color), [
      facet('8,11 26,9 26.4,12 8.3,14', light(color, 0.3)),
      facet('8.7,16.5 26.8,14.6 27,17 9,19', dark(color, 0.15)),
    ]),
    svgNode('ellipse', { cx: 8.5, cy: 15, rx: 3.4, ry: 4.2, fill: hex(end), stroke: INK, 'stroke-width': OUTLINE_WIDTH }),
    svgNode('ellipse', { cx: 8.5, cy: 15, rx: 1.7, ry: 2.2, fill: 'none', stroke: dark(end, 0.3), 'stroke-width': 0.9 }),
  ]);
}

function materialParts(item: MaterialItem): SVGElement[] {
  const color = item.color;
  switch (item.id) {
    case 'stone':
      return [
        faceted('4.5,22 8,13 15,7.5 23,9 28,17 25.5,25.5 12,27', hex(color), [
          facet('8,13 15,7.5 23,9 17,14', light(color, 0.4)),
          facet('4.5,22 8,13 17,14 11,19.5', light(color, 0.15)),
          facet('23,9 28,17 25.5,25.5 19,20 17,14', dark(color, 0.16)),
          facet('4.5,22 11,19.5 19,20 25.5,25.5 12,27', dark(color, 0.06)),
        ]),
      ];
    case 'wood':
      return [logParts(3, -4, color), logParts(0, 7, color)];
    case 'copperOre': {
      const rock = 0x9a8f99;
      return [
        faceted('4,23 7,13 14,8 23,9.5 28,18 25,26 12,27.5', hex(rock), [
          facet('7,13 14,8 23,9.5 16,14', light(rock, 0.35)),
          facet('23,9.5 28,18 25,26 18,20 16,14', dark(rock, 0.18)),
        ]),
        gem(11.5, 19, 3.6, color),
        gem(20, 15.5, 3, color),
        gem(18.5, 23, 2.4, color),
      ];
    }
    case 'sap':
      return [
        faceted('16,3.5 22.5,15 23.5,21 20,27 12,27 8.5,21 9.5,15', hex(color), [
          facet('16,3.5 9.5,15 8.5,21 12.5,18 14.5,9', light(color, 0.35)),
          facet('22.5,15 23.5,21 20,27 16,27 19.5,20', dark(color, 0.2)),
          svgNode('circle', { cx: 12.6, cy: 19.5, r: 1.3, fill: light(color, 0.7) }),
        ]),
      ];
    case 'fiber':
      return [
        line(9, 28, 13, 5, INK, 3.6),
        line(9, 28, 13, 5, hex(color), 1.8),
        line(16, 28.5, 16, 4, INK, 3.6),
        line(16, 28.5, 16, 4, light(color, 0.2), 1.8),
        line(23, 28, 19, 5.5, INK, 3.6),
        line(23, 28, 19, 5.5, dark(color, 0.12), 1.8),
        faceted('9.5,19.5 22.5,19.5 22,23.5 10,23.5', hex(0xc9a26b), [facet('9.5,19.5 22.5,19.5 22.3,21 9.8,21', light(0xc9a26b, 0.3))]),
      ];
  }
}

/** A sprinkler head on a short pipe: grey for the basic one, copper for the quality one. */
function sprinklerParts(color: number, quality: boolean): SVGElement[] {
  const drop = COLORS.rain;
  const drops = quality
    ? [gem(5.5, 9, 2, drop), gem(26.5, 9, 2, drop), gem(5.5, 22, 2, drop), gem(26.5, 22, 2, drop), gem(16, 4.5, 2, drop)]
    : [gem(5.5, 12, 2.2, drop), gem(26.5, 12, 2.2, drop), gem(16, 4.5, 2.2, drop)];
  return [
    ...drops,
    faceted('8,26 24,26 25,29 7,29', dark(color, 0.3), []),
    faceted('13.5,14 18.5,14 18.5,26 13.5,26', hex(color), [facet('13.5,14 15.3,14 15.3,26 13.5,26', light(color, 0.35))]),
    faceted('9,10 23,10 24,14.5 8,14.5', hex(color), [
      facet('9,10 23,10 23.3,11.8 8.7,11.8', light(color, 0.4)),
      facet('20,11.8 23.3,11.8 24,14.5 20.4,14.5', dark(color, 0.18)),
    ]),
  ];
}

function placeableParts(item: PlaceableItem): SVGElement[] {
  const color = item.color;
  switch (item.id) {
    case 'chest':
      return [
        faceted('4,14 28,14 27,28 5,28', hex(color), [
          facet('22,14 28,14 27,28 22,28', dark(color, 0.18)),
          facet('4,19.5 28,19.5 28,21 4,21', dark(color, 0.3)),
        ]),
        faceted('4,14 6,6 26,6 28,14', light(color, 0.12), [facet('6,6 26,6 26.6,9 5.3,9', light(color, 0.35))]),
        faceted('14,12 18,12 18,18 14,18', hex(COLORS.gold), [facet('14,12 16,12 16,18 14,18', light(COLORS.gold, 0.4))]),
      ];
    case 'woodFence':
      return [
        faceted('3,11 29,11 29,15 3,15', hex(color), [facet('3,11 29,11 29,12.4 3,12.4', light(color, 0.3))]),
        faceted('3,19 29,19 29,23 3,23', hex(color), [facet('3,19 29,19 29,20.4 3,20.4', light(color, 0.3))]),
        faceted('6,28 6,7 8.5,4.5 11,7 11,28', light(color, 0.1), [facet('8.5,4.5 11,7 11,28 8.5,28', dark(color, 0.16))]),
        faceted('21,28 21,7 23.5,4.5 26,7 26,28', light(color, 0.1), [facet('23.5,4.5 26,7 26,28 23.5,28', dark(color, 0.16))]),
      ];
    case 'woodPath':
      return [
        faceted('4,6 28,5 28,12 4,13', hex(color), [facet('4,6 28,5 28,7 4,8', light(color, 0.3))]),
        faceted('4,14.5 28,13.5 28,20.5 4,21.5', dark(color, 0.08), [facet('4,14.5 28,13.5 28,15.5 4,16.5', light(color, 0.25))]),
        faceted('4,23 28,22 28,29 4,30', hex(color), [facet('4,23 28,22 28,24 4,25', light(color, 0.3))]),
      ];
    case 'stonePath':
      return [
        faceted('3,10 8,4 15,5 16,12 10,15 4,14', hex(color), [facet('8,4 15,5 16,12 10,9', light(color, 0.35))]),
        faceted('18,6 26,4.5 29,11 25,16 18,14', dark(color, 0.06), [facet('18,6 26,4.5 24,10', light(color, 0.35))]),
        faceted('4,19 12,17 17,21 15,28 6,28.5 3,24', hex(color), [facet('4,19 12,17 11,21 5,23', light(color, 0.35))]),
        faceted('19,19 27,18 29,25 23,29 18,26', dark(color, 0.1), [facet('19,19 27,18 24,22', light(color, 0.3))]),
      ];
    case 'scarecrow': {
      const cloth = 0x7a9ad0;
      return [
        stick(16, 29, 16, 12, COLORS.handle, 2.6),
        stick(5, 16, 27, 16, COLORS.handle, 2.2),
        faceted('10,14 22,14 21,24 11,24', hex(cloth), [facet('17,14 22,14 21,24 17,24', dark(cloth, 0.2))]),
        faceted('11.5,9 16,5.5 20.5,9 20,13.5 12,13.5', hex(0xf0d890), [facet('16,5.5 20.5,9 20,13.5 16,13.5', dark(0xf0d890, 0.15))]),
        faceted('8,6.5 24,6.5 20,2.5 12,2.5', hex(color), [facet('16,2.5 20,2.5 24,6.5 16,6.5', dark(color, 0.2))]),
      ];
    }
    case 'sprinkler':
      return sprinklerParts(color, false);
    case 'qualitySprinkler':
      return sprinklerParts(color, true);
    case 'woodBurner':
      return [
        faceted('6,12 26,12 26,28 6,28', hex(color), [facet('20,12 26,12 26,28 20,28', dark(color, 0.2))]),
        faceted('10,18 22,18 22,24 10,24', hex(0xe8743b), [facet('10,18 22,18 22,20 10,20', light(0xe8743b, 0.35))]),
        faceted('18,3 23,3 23,12 18,12', dark(color, 0.1), [facet('18,3 20,3 20,12 18,12', light(color, 0.25))]),
      ];
  }
}

/** A tied sack of fertiliser, tinted by kind, with a sprout emblem. */
function fertilizerParts(item: FertilizerItem): SVGElement[] {
  const color = item.color;
  const sack = 0xe4cfa3;
  const parts: SVGElement[] = [
    faceted('7,12 11,8 21,8 25,12 27,26 23,29 9,29 5,26', hex(sack), [
      facet('21,8 25,12 27,26 23,29 20,29 22,13', dark(sack, 0.18)),
      facet('7,12 11,8 13,8 10,14 8,26 5,26', light(sack, 0.3)),
      facet('8,16 24,16 25,24 7,24', hex(color)),
      facet('20,16 24,16 25,24 20.5,24', dark(color, 0.2)),
    ]),
    faceted('11,8 13,3.5 19,3.5 21,8', dark(sack, 0.08), []),
    gem(16, 20, 2.6, COLORS.sprout),
  ];
  if (item.id === 'speedGro') parts.push(line(12, 12, 20, 12, hex(color), 1.6));
  if (item.id === 'qualityFertilizer') parts.push(gem(16, 11.5, 1.8, COLORS.gold));
  return parts;
}

/** Icon for any registry item: tools, tinted seed packets, faceted produce and materials. */
export function createItemIcon(item: ItemDefinition, className: string = ICON_CLASS): SVGSVGElement {
  switch (item.kind) {
    case 'tool':
      return svgRoot(toolParts(item.tool, item.color), className);
    case 'seed':
      return svgRoot(seedPacketParts(item), className);
    case 'produce':
      return svgRoot(produceParts(CROPS[item.cropId].visual), className);
    case 'material':
      return svgRoot(materialParts(item), className);
    case 'placeable':
      return svgRoot(placeableParts(item), className);
    case 'fertilizer':
      return svgRoot(fertilizerParts(item), className);
  }
}

// ---------------------------------------------------------------------------
// HUD glyphs
// ---------------------------------------------------------------------------

/**
 * Quality badge for silver (1) and gold (2) items: a faceted five-point star. Each arm is split
 * along its spine into a lit and a shaded half, so the star reads as a bevelled low-poly gem.
 */
export function createQualityStarIcon(quality: 1 | 2, className: string = INLINE_ICON_CLASS): SVGSVGElement {
  const color = quality === 2 ? COLORS.gold : COLORS.silver;
  const outer = regularPolygon(16, 16.6, 14, 5, -90);
  const inner = regularPolygon(16, 16.6, 6.2, 5, -54);
  const star: Point[] = [];
  for (let i = 0; i < 5; i++) star.push(vertex(outer, i), vertex(inner, i));
  const centre: Point = [16, 16.6];
  const facets: SVGElement[] = [];
  for (let i = 0; i < 5; i++) {
    const tip = vertex(outer, i);
    // Arms facing up-left catch the light; the rest fall into shade.
    const lit = i === 0 || i === 4;
    facets.push(facet(pts([centre, vertex(inner, i - 1), tip]), lit ? light(color, 0.45) : light(color, 0.15)));
    facets.push(facet(pts([centre, tip, vertex(inner, i)]), lit ? light(color, 0.1) : dark(color, 0.22)));
  }
  return svgRoot([faceted(pts(star), hex(color), facets)], className);
}

export function createCoinIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  const gold = COLORS.gold;
  const outer = regularPolygon(16, 16, 12.5, 8, 22.5);
  const centre: Point = [16, 16];
  return svgRoot(
    [
      faceted(pts(outer), hex(gold), [
        facet(pts([centre, vertex(outer, 4), vertex(outer, 5), vertex(outer, 6)]), light(gold, 0.4)),
        facet(pts([centre, vertex(outer, 0), vertex(outer, 1), vertex(outer, 2)]), dark(gold, 0.2)),
        svgNode('polygon', {
          points: pts(regularPolygon(16, 16, 7.6, 8, 22.5)),
          fill: light(gold, 0.18),
          stroke: dark(gold, 0.4),
          'stroke-width': 1.1,
          'stroke-linejoin': 'round',
        }),
        facet('16,11.6 18.4,16 16,20.4 13.6,16', dark(gold, 0.3)),
        facet('16,11.6 18.4,16 16,16', dark(gold, 0.12)),
      ]),
    ],
    className,
  );
}

/** A faceted blue lightning bolt: the farm's token pool. */
export function createBoltIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  const bolt = 0x7fd3ff;
  return svgRoot(
    [
      faceted('18,3 7,18 15,18 13,29 25,13 17,13', hex(bolt), [
        facet('18,3 7,18 15,18 17,13', light(bolt, 0.35)),
        facet('13,29 25,13 17,13 15,18', dark(bolt, 0.18)),
      ]),
    ],
    className,
  );
}

function sunParts(cx: number, cy: number, radius: number): SVGElement[] {
  const parts: SVGElement[] = [];
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    const tip: Point = [cx + Math.cos(angle) * radius * 1.75, cy + Math.sin(angle) * radius * 1.75];
    const left: Point = [cx + Math.cos(angle - 0.3) * radius * 1.12, cy + Math.sin(angle - 0.3) * radius * 1.12];
    const right: Point = [cx + Math.cos(angle + 0.3) * radius * 1.12, cy + Math.sin(angle + 0.3) * radius * 1.12];
    parts.push(outlined(pts([left, tip, right]), hex(COLORS.sunRay)));
  }
  const body = regularPolygon(cx, cy, radius, 8, 22.5);
  const centre: Point = [cx, cy];
  parts.push(
    faceted(pts(body), hex(COLORS.sun), [
      facet(pts([centre, vertex(body, 4), vertex(body, 5), vertex(body, 6)]), light(COLORS.sun, 0.45)),
      facet(pts([centre, vertex(body, 0), vertex(body, 1), vertex(body, 2)]), dark(COLORS.sun, 0.12)),
    ]),
  );
  return parts;
}

const CLOUD_PATH =
  'M8 23 C4.2 23 3.4 17.4 7.6 16.4 C7.4 11.6 13 9.2 16.4 12.2 C18.2 8.8 24.6 9.4 24.8 14.6 C28.8 14.8 29.2 23 24.6 23 Z';

function cloud(color: number, dy: number): SVGGElement {
  return svgNode('g', { transform: `translate(0 ${dy})` }, [
    svgNode('path', { d: CLOUD_PATH, fill: hex(color) }),
    svgNode('path', { d: 'M6.4 21 L26.6 21 C26 22.4 25.4 23 24.6 23 L8 23 C7.2 23 6.7 22.2 6.4 21 Z', fill: dark(color, 0.12) }),
    svgNode('ellipse', { cx: 13, cy: 14.4, rx: 3, ry: 1.5, fill: light(color, 0.7), 'fill-opacity': 0.9 }),
    svgNode('path', {
      d: CLOUD_PATH,
      fill: 'none',
      stroke: INK,
      'stroke-width': OUTLINE_WIDTH,
      'stroke-linejoin': 'round',
    }),
  ]);
}

function raindrop(x: number, y: number): SVGPolygonElement {
  return outlined(pts([[x, y - 2.8], [x + 2, y + 0.6], [x, y + 2.4], [x - 2, y + 0.6]]), hex(COLORS.rain));
}

function snowflake(x: number, y: number, radius: number): SVGGElement {
  const arms: SVGElement[] = [];
  for (let k = 0; k < 3; k++) {
    const angle = (k * Math.PI) / 3 + Math.PI / 2;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    arms.push(line(x - dx, y - dy, x + dx, y + dy, hex(COLORS.snow), 1.4));
  }
  return svgNode('g', {}, arms);
}

export function createWeatherIcon(weather: Weather, className: string = INLINE_ICON_CLASS): SVGSVGElement {
  switch (weather) {
    case Weather.Sunny:
      return svgRoot(sunParts(16, 16, 7.4), className);
    case Weather.Rain:
      return svgRoot([cloud(COLORS.cloud, -4), raindrop(10.5, 24), raindrop(16.5, 26.5), raindrop(22.5, 24)], className);
    case Weather.Storm:
      return svgRoot(
        [
          cloud(COLORS.stormCloud, -4),
          outlined('17,18.5 12.5,25 15.5,25 13.5,30.5 20.5,23 17.2,23 19.5,18.5', hex(COLORS.bolt)),
        ],
        className,
      );
    case Weather.Snow:
      return svgRoot(
        [cloud(COLORS.cloud, -4), snowflake(10.5, 24.5, 2.6), snowflake(16.5, 27.5, 2.6), snowflake(22.5, 24.5, 2.6)],
        className,
      );
  }
}

/** Shipping-bin crate with a little melon peeking out (pending shipment). */
export function createCrateIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  const crate = COLORS.crate;
  const lid = COLORS.crateLid;
  const slat = dark(crate, 0.32);
  return svgRoot(
    [
      gem(16, 7, 3.8, COLORS.melonPeek),
      faceted('3.5,9 28.5,9 28.5,13.5 3.5,13.5', hex(lid), [facet('3.5,9 28.5,9 28.5,10.8 3.5,10.8', light(lid, 0.3))]),
      faceted('5.5,13.5 26.5,13.5 25.5,28 6.5,28', hex(crate), [
        facet('21.5,13.5 26.5,13.5 25.5,28 21,28', dark(crate, 0.15)),
        line(6, 18.4, 26, 18.4, slat, 1),
        line(6.3, 23.2, 25.7, 23.2, slat, 1),
      ]),
    ],
    className,
  );
}

export function createToneIcon(tone: MessageTone, className: string = INLINE_ICON_CLASS): SVGSVGElement {
  switch (tone) {
    case 'info': {
      const leaf = COLORS.sprout;
      return svgRoot(
        [
          line(16, 27, 16, 13, INK, 4.4),
          line(16, 27, 16, 13, dark(leaf, 0.2), 2),
          faceted('16,15 6,12.5 4,5 12.5,6.5', hex(leaf), [facet('16,15 4,5 12.5,6.5', light(leaf, 0.3))]),
          faceted('16,17.5 26,14 28.5,6.5 20,8', hex(leaf), [facet('16,17.5 28.5,6.5 26,14', dark(leaf, 0.15))]),
          faceted('6.5,29.5 10.5,25.5 21.5,25.5 25.5,29.5', hex(COLORS.soil), [facet('10.5,25.5 21.5,25.5 22.5,26.5 9.5,26.5', light(COLORS.soil, 0.3))]),
        ],
        className,
      );
    }
    case 'success': {
      const star = COLORS.sun;
      return svgRoot(
        [
          faceted('16,2.5 19.2,12.8 29.5,16 19.2,19.2 16,29.5 12.8,19.2 2.5,16 12.8,12.8', hex(star), [
            facet('16,2.5 19.2,12.8 16,16 12.8,12.8', light(star, 0.5)),
            facet('2.5,16 12.8,12.8 16,16', light(star, 0.25)),
            facet('16,16 29.5,16 19.2,19.2', dark(star, 0.12)),
            facet('16,16 19.2,19.2 16,29.5', dark(star, 0.2)),
          ]),
          faceted('25.5,3.5 26.6,6.4 29.5,7.5 26.6,8.6 25.5,11.5 24.4,8.6 21.5,7.5 24.4,6.4', light(star, 0.35), []),
        ],
        className,
      );
    }
    case 'warn': {
      const warn = COLORS.warn;
      return svgRoot(
        [
          faceted('16,3.5 29.5,27.5 2.5,27.5', hex(warn), [
            facet('16,3.5 29.5,27.5 16,27.5', dark(warn, 0.12)),
            facet('16,3.5 9.2,15.5 16,15.5', light(warn, 0.3)),
          ]),
          svgNode('rect', { x: 14.4, y: 10.5, width: 3.2, height: 9.5, rx: 1.6, fill: INK }),
          svgNode('circle', { cx: 16, cy: 23.6, r: 1.8, fill: INK }),
        ],
        className,
      );
    }
  }
}

/** Large illustration for the empty winter shop: a sprout napping under a snowflake. */
export function createWinterIcon(className: string = ICON_CLASS): SVGSVGElement {
  const leaf = COLORS.sprout;
  return svgRoot(
    [
      snowflake(9, 8, 4.5),
      snowflake(24, 6, 3.2),
      line(16, 26, 16, 18, INK, 4),
      line(16, 26, 16, 18, dark(leaf, 0.2), 1.8),
      faceted('16,19.5 9,16 8,11 13.5,12.5', hex(leaf), [facet('16,19.5 8,11 13.5,12.5', light(leaf, 0.3))]),
      faceted('16,21 23,17.5 24,12.5 18.5,14', hex(leaf), [facet('16,21 24,12.5 23,17.5', dark(leaf, 0.15))]),
      faceted('3,29.5 7,24.5 25,24.5 29,29.5', hex(COLORS.paper), [facet('7,24.5 25,24.5 26,25.8 6,25.8', light(COLORS.paper, 0.6))]),
    ],
    className,
  );
}

export function createCloseIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  return svgRoot(
    [
      svgNode('path', {
        d: 'M9 9 L23 23 M23 9 L9 23',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 3.6,
        'stroke-linecap': 'round',
      }),
    ],
    className,
  );
}

export function createFastForwardIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  return svgRoot(
    [
      svgNode('polygon', { points: '4,8 15.5,16 4,24', fill: 'currentColor', 'stroke-linejoin': 'round' }),
      svgNode('polygon', { points: '16,8 27.5,16 16,24', fill: 'currentColor', 'stroke-linejoin': 'round' }),
    ],
    className,
  );
}

// ---------------------------------------------------------------------------
// Day dial
// ---------------------------------------------------------------------------

/** Crescent centred on the origin (outer r 5, bite r 4.2 offset up-right). */
const MOON_PATH = 'M0.71 -4.95 A5 5 0 1 0 4.23 2.67 A4.2 4.2 0 0 1 0.71 -4.95 Z';
const DIAL_CX = 32;
const DIAL_CY = 32;
const DIAL_RADIUS = 23;

/**
 * The clock panel's day-progress dial: a half-disc of sky with a dashed arc from sunrise (left)
 * to pass-out (right), a filled progress arc, and a sun or moon riding the arc. Colours come
 * from CSS (.hud-dial__*), so the sky can follow the time of day through --hud-dial-sky.
 */
export class DayDial {
  readonly element: SVGSVGElement;
  private readonly marker: SVGGElement;
  private readonly progressArc: SVGPathElement;
  private readonly sun: SVGGElement;
  private readonly moon: SVGGElement;
  private progress = -1;
  private night: boolean | null = null;

  constructor() {
    const r = DIAL_RADIUS;
    const arc = `M${DIAL_CX - r} ${DIAL_CY} A${r} ${r} 0 0 1 ${DIAL_CX + r} ${DIAL_CY}`;
    const skyRadius = r + 5;
    const sky = svgNode('path', {
      d: `M${DIAL_CX - skyRadius} ${DIAL_CY} A${skyRadius} ${skyRadius} 0 0 1 ${DIAL_CX + skyRadius} ${DIAL_CY} Z`,
      class: 'hud-dial__sky',
    });
    const track = svgNode('path', { d: arc, class: 'hud-dial__track', fill: 'none' });
    this.progressArc = svgNode('path', {
      d: arc,
      class: 'hud-dial__progress',
      fill: 'none',
      pathLength: 100,
      'stroke-dasharray': '100 100',
      'stroke-dashoffset': 100,
    });
    const ground = svgNode('rect', { x: 1, y: DIAL_CY - 0.5, width: 62, height: 4, rx: 2, class: 'hud-dial__ground' });
    this.sun = svgNode('g', { class: 'hud-dial__sun' }, sunParts(0, 0, 3.3));
    this.moon = svgNode('g', { class: 'hud-dial__moon' }, [
      svgNode('path', {
        d: MOON_PATH,
        fill: hex(COLORS.moon),
        stroke: INK,
        'stroke-width': 1.2,
        'stroke-linejoin': 'round',
      }),
    ]);
    this.marker = svgNode('g', { class: 'hud-dial__marker' }, [this.sun, this.moon]);
    this.element = svgRoot([sky, track, this.progressArc, ground, this.marker], 'hud-dial', '0 0 64 36');
    this.update(0, false);
  }

  /** progress: 0 at 06:00, 1 at pass-out. Writes attributes only when something changed. */
  update(progress: number, night: boolean): void {
    const p = Math.min(1, Math.max(0, progress));
    if (p !== this.progress) {
      this.progress = p;
      const angle = Math.PI * p;
      const x = DIAL_CX - DIAL_RADIUS * Math.cos(angle);
      const y = DIAL_CY - DIAL_RADIUS * Math.sin(angle);
      this.marker.setAttribute('transform', `translate(${fmt(x)} ${fmt(y)})`);
      this.progressArc.setAttribute('stroke-dashoffset', fmt(100 * (1 - p)));
    }
    if (night !== this.night) {
      this.night = night;
      this.sun.setAttribute('display', night ? 'none' : 'inline');
      this.moon.setAttribute('display', night ? 'inline' : 'none');
    }
  }
}
