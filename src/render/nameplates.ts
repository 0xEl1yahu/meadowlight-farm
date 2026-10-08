/**
 * Nameplates (farmclaws part 4a spec §2.3): a character's name on a small rounded plate, drawn
 * once per character onto a canvas that NpcRenderer shows on a sprite above the head.
 *
 * - Every plate's canvas is NAMEPLATE_CANVAS in size, so every sprite has the same aspect
 *   (NAMEPLATE_ASPECT). The plate inside it is sized to the name (nameplateRect); the rest of
 *   the canvas stays transparent.
 * - The name is drawn with fillText, squeezed to fit when it is too long for the plate.
 */
import * as THREE from 'three';

/** Canvas size of every nameplate (pixels). */
export const NAMEPLATE_CANVAS = { width: 256, height: 64 } as const;
/** Width over height of every nameplate sprite. */
export const NAMEPLATE_ASPECT = NAMEPLATE_CANVAS.width / NAMEPLATE_CANVAS.height;

const FONT = '700 34px "Trebuchet MS", "Segoe UI", sans-serif';
/** Space between the name and the plate's left and right edges (pixels). */
const PADDING = 18;
/** Transparent space kept round the plate, so its outline is never clipped (pixels). */
const MARGIN = 4;
const OUTLINE = 4;
const CORNER = 18;
const PLATE_FILL = 'rgba(255, 248, 232, 0.92)';
const INK = '#5a3d2b';

/** A rectangle on the nameplate canvas (pixels). */
export interface PlateRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The plate behind a name `textWidth` pixels wide: padded, centred, and never past the canvas margin. */
export function nameplateRect(textWidth: number): PlateRect {
  const width = Math.min(NAMEPLATE_CANVAS.width - 2 * MARGIN, Math.max(0, textWidth) + 2 * PADDING);
  return { x: (NAMEPLATE_CANVAS.width - width) / 2, y: MARGIN, width, height: NAMEPLATE_CANVAS.height - 2 * MARGIN };
}

/** Traces a rounded rectangle as the current path. */
function tracePlate(g: CanvasRenderingContext2D, rect: PlateRect): void {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  g.beginPath();
  g.moveTo(rect.x + CORNER, rect.y);
  g.arcTo(right, rect.y, right, bottom, CORNER);
  g.arcTo(right, bottom, rect.x, bottom, CORNER);
  g.arcTo(rect.x, bottom, rect.x, rect.y, CORNER);
  g.arcTo(rect.x, rect.y, right, rect.y, CORNER);
  g.closePath();
}

/** `name` on a cream plate with an ink outline. The caller owns (and disposes) the texture. */
export function createNameplateTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = NAMEPLATE_CANVAS.width;
  canvas.height = NAMEPLATE_CANVAS.height;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('nameplates: no 2D canvas context for the nameplates');
  g.font = FONT;
  const rect = nameplateRect(g.measureText(name).width);
  tracePlate(g, rect);
  g.fillStyle = PLATE_FILL;
  g.fill();
  g.lineWidth = OUTLINE;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, NAMEPLATE_CANVAS.width / 2, NAMEPLATE_CANVAS.height / 2, rect.width - 2 * PADDING);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
