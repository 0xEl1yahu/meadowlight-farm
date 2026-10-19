/**
 * Posters (farmclaws part 4b spec §7, part 4d spec §5.3, §6.1, §7.2): ads for the valley's made-up
 * brands on the town's walls, each a brand name, a slogan and a simple picture; the Claw Fair
 * banner; the two faces of the shops' hanging door signs; and SLOPMART's neon.
 *
 * - Everything is drawn once onto one shared canvas texture, the atlas, each in its own cell
 *   (posterAtlasLayout), so all the posters and signs on a map cost one material and one draw
 *   call, and the neon one more.
 * - posterQuad builds a quad UV'd into a cell; townGeometry puts the quads on the walls and
 *   StructureRenderer merges a map's quads into one mesh. A door sign flips by moving its quad's
 *   UVs to the other face's cell (setQuadCell), so nothing is rebuilt.
 * - The neon's title has a cell per character (neonCells), so one letter can dim on its own.
 *   neonSignQuads and neonPaint make the parts of the self-lit neon mesh: the sign, and DEALZ's
 *   eyes, which sample the atlas's plain white cell.
 * - drawPosterAtlas draws it all with fillText and simple shapes. createPosterAtlas needs a
 *   canvas, so StructureRenderer takes it as a factory and tests pass a stand-in, as with the
 *   nameplates.
 */
import * as THREE from 'three';
import type { SignFace } from '../people/shops';
import { paint, pose, type Pose } from './geometryParts';

export type PosterPicture = 'claw' | 'bottle' | 'battery' | 'apple' | 'bowl';

/** A poster's colours: the board inside the cream border, the brand, and the slogan and picture. */
interface Ink {
  readonly board: string;
  readonly brand: string;
  readonly text: string;
}

/** FarmClaw's colours: a deep blue board, the brand in sunflower yellow. */
const FARMCLAW_INK: Ink = { board: '#2f5d7c', brand: '#f2c14e', text: '#f2ead8' };

/** Part 4b's posters for FarmClaw, the valley's robot maker, then part 4d's brands (spec §7.2). */
export const POSTERS = [
  { id: 'farmclawFarm', brand: 'FarmClaw', slogan: 'Your farm. Our claws.', picture: 'claw', ink: FARMCLAW_INK },
  { id: 'farmclawParts', brand: 'FarmClaw', slogan: 'Genuine FarmClaw parts.', picture: 'claw', ink: FARMCLAW_INK },
  { id: 'farmclawOrder', brand: 'FarmClaw', slogan: 'Robots built to order.', picture: 'claw', ink: FARMCLAW_INK },
  { id: 'byre', brand: 'Byre', slogan: 'Milk from cows, not claws. 100% claw free.', picture: 'bottle', ink: { board: '#5d9bc9', brand: '#fdf8ec', text: '#fdf8ec' } },
  { id: 'tokenly', brand: 'Tokenly', slogan: 'Keep your claws charged.', picture: 'battery', ink: { board: '#3b2f63', brand: '#7fe0c4', text: '#f2ead8' } },
  { id: 'hollis', brand: 'Hollis Handpicked', slogan: 'Picked by people. Slowly.', picture: 'apple', ink: { board: '#6e8f4e', brand: '#f6e3bf', text: '#f6e3bf' } },
  { id: 'sprocket', brand: 'Sprocket Cereal', slogan: 'Part of a balanced robot.', picture: 'bowl', ink: { board: '#f0a03a', brand: '#7a2e1e', text: '#3a2418' } },
] as const satisfies readonly { readonly id: string; readonly brand: string; readonly slogan: string; readonly picture: PosterPicture; readonly ink: Ink }[];

/** The Claw Fair's banner over the main street (spec §7.2): a long cloth with the brand and the slogan. */
export const CLAW_FAIR = { brand: 'Claw Fair', slogan: 'Parade · Contest · Day 14' } as const;

/** The faces of a door's hanging sign (spec §5.3). */
export const SIGN_FACES: readonly SignFace[] = ['OPEN', 'CLOSED'];

/** SLOPMART's neon (spec §6.1): the title, and the byline in small letters underneath. */
export const NEON_TEXT = { title: 'SLOPMART 24/7', byline: 'A BARNABY VENTURE' } as const;

export type PosterId = (typeof POSTERS)[number]['id'];
type Poster = (typeof POSTERS)[number];

/** Atlas canvas and poster cell sizes (pixels). Posters run left to right, then down, `gap` apart and from the edges. */
export const POSTER_ATLAS = { width: 1024, height: 512, cellWidth: 160, cellHeight: 224, gap: 8 } as const;

/**
 * The atlas's other cells, [x, y, width, height] in pixels, in the room the posters leave on their
 * second row: the banner, the sign faces, a plain white square, and the neon, whose title takes
 * its top NEON_DRAW.titleHeight pixels and the byline the rest.
 */
const OTHER_CELLS = {
  clawFair: [176, 240, 352, 112],
  OPEN: [176, 360, 144, 64],
  CLOSED: [328, 360, 144, 64],
  white: [480, 360, 16, 16],
  neon: [536, 240, 468, 152],
} as const satisfies Readonly<Record<'clawFair' | SignFace | 'white' | 'neon', readonly [number, number, number, number]>>;

type OtherCellId = keyof typeof OTHER_CELLS;
export type AtlasCellId = PosterId | OtherCellId;
export const ATLAS_CELL_IDS: readonly AtlasCellId[] = [...POSTERS.map((p) => p.id), ...(Object.keys(OTHER_CELLS) as OtherCellId[])];

/** A cell of the atlas in texture coordinates (v runs up from the canvas's bottom edge). */
export interface AtlasCell {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** The cell over the atlas's pixels from (x, y), `w` × `h`. */
function cellAt(x: number, y: number, w: number, h: number): AtlasCell {
  const A = POSTER_ATLAS;
  return { u0: x / A.width, v0: 1 - (y + h) / A.height, u1: (x + w) / A.width, v1: 1 - y / A.height };
}

/** A cell's pixels: its top-left corner and size. */
function pixelsOf(cell: AtlasCell): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const A = POSTER_ATLAS;
  return { x: cell.u0 * A.width, y: (1 - cell.v1) * A.height, w: (cell.u1 - cell.u0) * A.width, h: (cell.v1 - cell.v0) * A.height };
}

/** Every cell of the atlas: the posters in POSTERS order on a grid, then the others. */
export function posterAtlasLayout(): Readonly<Record<AtlasCellId, AtlasCell>> {
  const A = POSTER_ATLAS;
  const columns = Math.floor((A.width - A.gap) / (A.cellWidth + A.gap));
  const cells: Partial<Record<AtlasCellId, AtlasCell>> = {};
  POSTERS.forEach((poster, i) => {
    const x = A.gap + (i % columns) * (A.cellWidth + A.gap);
    const y = A.gap + Math.floor(i / columns) * (A.cellHeight + A.gap);
    cells[poster.id] = cellAt(x, y, A.cellWidth, A.cellHeight);
  });
  for (const id of Object.keys(OTHER_CELLS) as OtherCellId[]) {
    const [x, y, w, h] = OTHER_CELLS[id];
    cells[id] = cellAt(x, y, w, h);
  }
  return cells as Record<AtlasCellId, AtlasCell>;
}

const CELLS = posterAtlasLayout();

/** The neon's cells: one per character of the title, left to right, and the byline under them. */
export function neonCells(): { readonly title: readonly AtlasCell[]; readonly byline: AtlasCell } {
  const { x, y, w, h } = pixelsOf(CELLS.neon);
  const slot = w / NEON_TEXT.title.length;
  const titleHeight = NEON_DRAW.titleHeight;
  return {
    title: Array.from(NEON_TEXT.title, (_, i) => cellAt(x + i * slot, y, slot, titleHeight)),
    byline: cellAt(x, y + titleHeight, w, h - titleHeight),
  };
}

/** Width over height of a cell. */
export function posterAspect(id: AtlasCellId): number {
  const { w, h } = pixelsOf(CELLS[id]);
  return w / h;
}

/** A quad `width` × `height` facing +Z, posed; its UVs cover `cell`. */
function cellQuad(cell: AtlasCell, width: number, height: number, p: Pose): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(width, height);
  const geometry = quad.toNonIndexed();
  quad.dispose();
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
  }
  return pose(geometry, p);
}

/** A quad of cell `id`, `height` tall at the cell's aspect, facing +Z, posed. */
export function posterQuad(id: AtlasCellId, height: number, p: Pose): THREE.BufferGeometry {
  return cellQuad(CELLS[id], height * posterAspect(id), height, p);
}

/** Vertices in one quad (two triangles, not indexed). */
const QUAD_VERTICES = 6;

/** Moves the quad whose vertices start at `first` from cell `from` to cell `to`, as a door sign flips. */
export function setQuadCell(uv: THREE.BufferAttribute, first: number, from: AtlasCell, to: AtlasCell): void {
  for (let i = first; i < first + QUAD_VERTICES; i++) {
    const s = (uv.getX(i) - from.u0) / (from.u1 - from.u0);
    const t = (uv.getY(i) - from.v0) / (from.v1 - from.v0);
    uv.setXY(i, to.u0 + s * (to.u1 - to.u0), to.v0 + t * (to.v1 - to.v0));
  }
  uv.needsUpdate = true;
}

/** `geometry` with a white `color` on every vertex, which the neon's renderer can dim. */
function withWhite(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
  return geometry;
}

/**
 * SLOPMART's neon, `width` wide facing +Z, the middle of its bottom edge at `p`: a quad for each
 * character of the title, so each can dim on its own, and one for the byline.
 */
export function neonSignQuads(width: number, p: Pose): THREE.BufferGeometry[] {
  const { title, byline } = neonCells();
  const scale = width / pixelsOf(CELLS.neon).w;
  const slot = width / NEON_TEXT.title.length;
  const titleHeight = NEON_DRAW.titleHeight * scale;
  const bylineHeight = pixelsOf(byline).h * scale;
  const x = p.x ?? 0;
  const y = p.y ?? 0;
  const quads = title.map((cell, i) => cellQuad(cell, slot, titleHeight, { ...p, x: x - width / 2 + (i + 0.5) * slot, y: y + bylineHeight + titleHeight / 2 }));
  quads.push(cellQuad(byline, width, bylineHeight, { ...p, y: y + bylineHeight / 2 }));
  return quads.map(withWhite);
}

/** `geometry` for the neon mesh, all `color`: painted, its UVs on the atlas's plain white cell. */
export function neonPaint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const painted = paint(geometry, color);
  const white = CELLS.white;
  const uv = new Float32Array(painted.getAttribute('position').count * 2);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = (white.u0 + white.u1) / 2;
    uv[i + 1] = (white.v0 + white.v1) / 2;
  }
  painted.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return painted;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
/** Every poster, the banner and the signs have a cream border. */
const BORDER = '#f2ead8';
/** Sizes on a poster cell (pixels). The brand and slogan shrink, in steps, until they fit their lines. */
const LAYOUT = {
  border: 7,
  padding: 14,
  brandSizes: [34, 24],
  brandTop: 18,
  pictureY: 0.47,
  sloganSizes: [19, 15],
  sloganLines: 3,
  sloganBottom: 24,
  /** Line spacing over font size. */
  leading: 1.16,
} as const;
const BANNER_INK: Ink = { board: '#c94f45', brand: '#f2c14e', text: BORDER };
const SIGN_INK: Readonly<Record<SignFace, string>> = { OPEN: '#4f8f4a', CLOSED: '#b8433a' };
/** The neon: a dark board, the title in hot pink, the byline in ice blue, both glowing. */
const NEON_DRAW = { titleHeight: 104, board: '#241b30', title: '#ff5fb0', byline: '#7fe8ff', titleSize: 72, bylineSize: 26, glow: 16 } as const;

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

/** The first of `sizes` at which `text` wraps into at most `maxLines` lines (or the last size), with the font set and the lines. */
function fitLines(g: CanvasRenderingContext2D, text: string, sizes: readonly number[], maxWidth: number, maxLines: number): { readonly size: number; readonly lines: string[] } {
  let fit = { size: 0, lines: [text] };
  for (const size of sizes) {
    g.font = `700 ${size}px ${FONT}`;
    fit = { size, lines: wrapWords(g, text, maxWidth) };
    if (fit.lines.length <= maxLines) break;
  }
  return fit;
}

/** A cream border round a board of `board`, filling the cell from (x, y). */
function boardParts(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, board: string): void {
  g.fillStyle = BORDER;
  g.fillRect(x, y, w, h);
  g.fillStyle = board;
  g.fillRect(x + LAYOUT.border, y + LAYOUT.border, w - 2 * LAYOUT.border, h - 2 * LAYOUT.border);
}

/** A three-fingered claw reaching down, centred on (x, y). */
function drawClaw(g: CanvasRenderingContext2D, x: number, y: number, ink: Ink): void {
  g.strokeStyle = ink.text;
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
  g.fillStyle = ink.brand;
  g.beginPath();
  g.arc(x, y - 8, 10, 0, Math.PI * 2);
  g.fill();
}

/** A poster's picture, centred on (x, y): FarmClaw's claw, Byre's milk bottle, Tokenly's charged battery, Hollis's apple or Sprocket's bowl of cogs. */
function drawPicture(g: CanvasRenderingContext2D, picture: PosterPicture, x: number, y: number, ink: Ink): void {
  switch (picture) {
    case 'claw':
      drawClaw(g, x, y, ink);
      return;
    case 'bottle':
      g.fillStyle = ink.text;
      g.fillRect(x - 18, y - 14, 36, 48);
      g.fillRect(x - 9, y - 30, 18, 18);
      g.fillStyle = '#d9574a';
      g.fillRect(x - 11, y - 38, 22, 9);
      g.fillStyle = ink.board;
      g.fillRect(x - 18, y + 4, 36, 10);
      return;
    case 'battery':
      g.strokeStyle = ink.text;
      g.lineWidth = 6;
      g.strokeRect(x - 28, y - 18, 50, 36);
      g.fillStyle = ink.text;
      g.fillRect(x + 22, y - 8, 8, 16);
      g.fillStyle = ink.brand;
      g.beginPath();
      // A lightning bolt across the cell.
      for (const [dx, dy] of [[5, -14], [-11, 3], [-2, 3], [-7, 15], [9, -3], [0, -3]] as const) g.lineTo(x + dx, y + dy);
      g.fill();
      return;
    case 'apple':
      g.fillStyle = '#d9433a';
      g.beginPath();
      g.arc(x, y + 4, 26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#5b3a26';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x, y - 18);
      g.lineTo(x + 4, y - 32);
      g.stroke();
      g.fillStyle = '#3f6b2e';
      g.beginPath();
      g.ellipse(x + 16, y - 28, 13, 6, -0.5, 0, Math.PI * 2);
      g.fill();
      return;
    case 'bowl':
      g.fillStyle = ink.brand;
      // Cogs of cereal heaped above the rim.
      for (const [dx, dy] of [[-16, -6], [0, -12], [16, -6], [-6, -2], [8, -2]] as const) {
        g.beginPath();
        g.arc(x + dx, y + dy, 9, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = BORDER;
      g.beginPath();
      g.arc(x, y, 34, 0, Math.PI);
      g.fill();
      return;
  }
}

/** One poster in its cell from (x, y): the brand at the top, the picture, then the slogan at the bottom, all centred. */
function drawPoster(g: CanvasRenderingContext2D, poster: Poster, x: number, y: number): void {
  const L = LAYOUT;
  const w = POSTER_ATLAS.cellWidth;
  const h = POSTER_ATLAS.cellHeight;
  const cx = x + w / 2;
  const textWidth = w - 2 * L.padding;
  boardParts(g, x, y, w, h, poster.ink.board);
  g.fillStyle = poster.ink.brand;
  const brand = fitLines(g, poster.brand, L.brandSizes, textWidth, 1);
  brand.lines.forEach((line, i) => g.fillText(line, cx, y + L.brandTop + brand.size * (0.5 + i * L.leading), textWidth));
  drawPicture(g, poster.picture, cx, y + h * L.pictureY, poster.ink);
  g.fillStyle = poster.ink.text;
  const slogan = fitLines(g, poster.slogan, L.sloganSizes, textWidth, L.sloganLines);
  const line = slogan.size * L.leading;
  slogan.lines.forEach((text, i) => g.fillText(text, cx, y + h - L.sloganBottom - (slogan.lines.length - 1 - i) * line, textWidth));
}

/** The Claw Fair banner: the brand big over the slogan. */
function drawBanner(g: CanvasRenderingContext2D, cell: AtlasCell): void {
  const { x, y, w, h } = pixelsOf(cell);
  const ink = BANNER_INK;
  const textWidth = w - 4 * LAYOUT.padding;
  boardParts(g, x, y, w, h, ink.board);
  g.fillStyle = ink.brand;
  g.font = `700 44px ${FONT}`;
  g.fillText(CLAW_FAIR.brand, x + w / 2, y + h * 0.38, textWidth);
  g.fillStyle = ink.text;
  g.font = `700 22px ${FONT}`;
  g.fillText(CLAW_FAIR.slogan, x + w / 2, y + h * 0.74, textWidth);
}

/** A door sign's face: the word on a green (OPEN) or red (CLOSED) board. */
function drawSignFace(g: CanvasRenderingContext2D, face: SignFace): void {
  const { x, y, w, h } = pixelsOf(CELLS[face]);
  boardParts(g, x, y, w, h, SIGN_INK[face]);
  g.fillStyle = BORDER;
  g.font = `700 30px ${FONT}`;
  g.fillText(face, x + w / 2, y + h / 2 + 1, w - 2 * LAYOUT.padding);
}

/** SLOPMART's neon: a dark board, each title character glowing in its own cell, and the byline. */
function drawNeon(g: CanvasRenderingContext2D): void {
  const N = NEON_DRAW;
  const { x, y, w, h } = pixelsOf(CELLS.neon);
  g.fillStyle = N.board;
  g.fillRect(x, y, w, h);
  g.shadowBlur = N.glow;
  const { title, byline } = neonCells();
  g.fillStyle = N.title;
  g.shadowColor = N.title;
  g.font = `700 ${N.titleSize}px ${FONT}`;
  title.forEach((cell, i) => {
    const slot = pixelsOf(cell);
    const ch = NEON_TEXT.title.charAt(i);
    if (ch !== ' ') g.fillText(ch, slot.x + slot.w / 2, slot.y + slot.h / 2 + 4, slot.w);
  });
  const b = pixelsOf(byline);
  g.fillStyle = N.byline;
  g.shadowColor = N.byline;
  g.font = `700 ${N.bylineSize}px ${FONT}`;
  g.fillText(NEON_TEXT.byline, b.x + b.w / 2, b.y + b.h / 2, b.w);
  g.shadowBlur = 0;
}

/** Draws every cell of the atlas onto `g`, a POSTER_ATLAS-sized canvas. */
export function drawPosterAtlas(g: CanvasRenderingContext2D): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const poster of POSTERS) {
    const { x, y } = pixelsOf(CELLS[poster.id]);
    drawPoster(g, poster, x, y);
  }
  drawBanner(g, CELLS.clawFair);
  for (const face of SIGN_FACES) drawSignFace(g, face);
  const white = pixelsOf(CELLS.white);
  g.fillStyle = '#ffffff';
  g.fillRect(white.x, white.y, white.w, white.h);
  drawNeon(g);
}

/** Every poster, sign face and the neon drawn into its cell of one texture. The caller owns (and disposes) it. */
export function createPosterAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_ATLAS.width;
  canvas.height = POSTER_ATLAS.height;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('posters: no 2D canvas context for the poster atlas');
  drawPosterAtlas(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
