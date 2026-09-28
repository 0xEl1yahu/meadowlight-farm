/**
 * Shared vertical layout (world units, +Y up). Every system that places things on the ground
 * reads these so crops sit exactly on soil, the player stands exactly on grass, etc.
 */
export const HEIGHTS = {
  /** Top face of an untilled grass tile. */
  grassTop: 0,
  /** Top face of plowed / watered soil (slightly sunken). */
  soilTop: -0.04,
  /** Ground slabs extend this far below their top face. */
  tileThickness: 0.5,
  /** Visible water surface of pond tiles. */
  waterSurface: -0.16,
  /** Floor of the pond basin under the water surface. */
  pondBed: -0.5,
  /** Height of the player's eyes / tool-ray origin above the ground. */
  playerEye: 0.9,
} as const;

/** Camera framing (orthographic, isometric). */
export const CAMERA = {
  /** Yaw of the camera around +Y. 45° places the camera on the (+X, +Z) diagonal: classic isometric. */
  yawDeg: 45,
  /** Elevation above the ground plane. atan(1/√2) ≈ 35.264° is true isometric. */
  pitchDeg: 35.264,
  /** Distance from the focus point along the view direction (only affects clipping). */
  distance: 60,
  /** Default vertical extent of the view in world units. */
  viewHeight: 15,
  minViewHeight: 8,
  maxViewHeight: 34,
  /** Exponential follow rate (1/s). */
  followRate: 7,
} as const;

export const SHADOWS = {
  mapSize: 2048,
  /** Half-extent of the orthographic shadow frustum around the camera focus. */
  halfExtent: 18,
} as const;
