/**
 * Posters (farmclaws part 4b spec §7): ads for the valley's made-up brands on the shopfronts,
 * each a brand name, a slogan and a simple picture.
 *
 * - Every poster is drawn once onto one shared canvas texture, the atlas, in its own cell
 *   (posterAtlasLayout), so all the posters on a map cost one material and one draw call.
 * - posterQuad builds a poster's quad, UV'd into its cell; townGeometry puts the quads on the
 *   walls and StructureRenderer merges a map's quads into one mesh.
 * - createPosterAtlas draws the atlas with fillText and simple shapes. It needs a canvas, so
 *   StructureRenderer takes it as a factory and tests pass a stand-in, as with the nameplates.
 */
import * as THREE from 'three';
import { pose, type Pose } from './geometryParts';

export type PosterPicture = 'claw';

/** Part 4b's posters: FarmClaw, the valley's robot maker. */
export const POSTERS = [
  { id: 'farmclawFarm', brand: 'FarmClaw', slogan: 'Your farm. Our claws.', picture: 'claw' },
  { id: 'farmclawParts', brand: 'FarmClaw', slogan: 'Genuine FarmClaw parts.', picture: 'claw' },
  { id: 'farmclawOrder', brand: 'FarmClaw', slogan: 'Robots built to order.', picture: 'claw' },
] as const satisfies readonly { readonly id: string; readonly brand: string; readonly slogan: string; readonly picture: PosterPicture }[];

export type PosterId = (typeof POSTERS)[number]['id'];
type Poster = (typeof POSTERS)[number];

/** Atlas canvas and cell sizes (pixels). Cells run left to right, then down, `gap` apart and from the edges. */
export const POSTER_ATLAS = { width: 512, height: 256, cellWidth: 160, cellHeight: 224, gap: 8 } as const;
/** Width over height of every poster. */
export const POSTER_ASPECT = POSTER_ATLAS.cellWidth / POSTER_ATLAS.cellHeight;

/** A cell of the atlas in texture coordinates (v runs up from the canvas's bottom edge). */
export interface AtlasCell {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Each poster's cell of the atlas, in POSTERS order. */
export function posterAtlasLayout(): Readonly<Record<PosterId, AtlasCell>> {
  const A = POSTER_ATLAS;
  const columns = Math.floor((A.width - A.gap) / (A.cellWidth + A.gap));
  const cells: Partial<Record<PosterId, AtlasCell>> = {};
  POSTERS.forEach((poster, i) => {
    const x = A.gap + (i % columns) * (A.cellWidth + A.gap);
    const y = A.gap + Math.floor(i / columns) * (A.cellHeight + A.gap);
    cells[poster.id] = { u0: x / A.width, v0: 1 - (y + A.cellHeight) / A.height, u1: (x + A.cellWidth) / A.width, v1: 1 - y / A.height };
  });
  return cells as Record<PosterId, AtlasCell>;
}

const CELLS = posterAtlasLayout();

/** A poster `height` tall at POSTER_ASPECT, facing +Z, posed; its UVs cover the poster's cell. */
export function posterQuad(id: PosterId, height: number, p: Pose): THREE.BufferGeometry {
  const cell = CELLS[id];
  const quad = new THREE.PlaneGeometry(height * POSTER_ASPECT, height);
  const geometry = quad.toNonIndexed();
  quad.dispose();
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
  }
  return pose(geometry, p);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
/** FarmClaw's colours: a cream border round a deep blue board, the brand in sunflower yellow. */
const INK = { border: '#f2ead8', board: '#2f5d7c', brand: '#f2c14e', text: '#f2ead8' } as const;
/** Sizes on a cell (pixels). */
const LAYOUT = { border: 7, padding: 14, brandSize: 34, brandY: 36, pictureY: 0.47, sloganSize: 19, sloganLine: 22, sloganBottom: 24 } as const;

/** `text` broken into lines no wider than `maxWidth`, a word at a time. */
function wrapWords(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && g.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** A three-fingered claw reaching down, centred on (x, y). */
function drawClaw(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.strokeStyle = INK.text;
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  // The arm runs on into the middle finger; the outer fingers curl in from the knuckle.
  g.moveTo(x, y - 40);
  g.lineTo(x, y + 30);
  for (const side of [-1, 1]) {
    g.moveTo(x, y - 8);
    g.quadraticCurveTo(x + side * 34, y + 6, x + side * 14, y + 34);
  }
  g.stroke();
  g.fillStyle = INK.brand;
  g.beginPath();
  g.arc(x, y - 8, 10, 0, Math.PI * 2);
  g.fill();
}

/** One poster in the cell whose top-left corner is (x, y). */
function drawPoster(g: CanvasRenderingContext2D, poster: Poster, x: number, y: number): void {
  const L = LAYOUT;
  const w = POSTER_ATLAS.cellWidth;
  const h = POSTER_ATLAS.cellHeight;
  const cx = x + w / 2;
  const textWidth = w - 2 * L.padding;
  g.fillStyle = INK.border;
  g.fillRect(x, y, w, h);
  g.fillStyle = INK.board;
  g.fillRect(x + L.border, y + L.border, w - 2 * L.border, h - 2 * L.border);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = INK.brand;
  g.font = `700 ${L.brandSize}px ${FONT}`;
  g.fillText(poster.brand, cx, y + L.brandY, textWidth);
  switch (poster.picture) {
    case 'claw':
      drawClaw(g, cx, y + h * L.pictureY);
      break;
  }
  g.fillStyle = INK.text;
  g.font = `700 ${L.sloganSize}px ${FONT}`;
  const lines = wrapWords(g, poster.slogan, textWidth);
  lines.forEach((line, i) => g.fillText(line, cx, y + h - L.sloganBottom - (lines.length - 1 - i) * L.sloganLine, textWidth));
}

/** Every poster drawn into its cell of one texture. The caller owns (and disposes) it. */
export function createPosterAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_ATLAS.width;
  canvas.height = POSTER_ATLAS.height;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('posters: no 2D canvas context for the poster atlas');
  for (const poster of POSTERS) {
    const cell = CELLS[poster.id];
    drawPoster(g, poster, cell.u0 * POSTER_ATLAS.width, (1 - cell.v1) * POSTER_ATLAS.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
