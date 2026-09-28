/**
 * Time & weather lighting engine.
 *
 * Day cycle
 * - A keyframed gradient over the continuous clock (FrameContext.clockMinutes, 360 … 1560) drives
 *   the key light's colour and intensity, the hemisphere sky / ground colours and intensity, and
 *   the sky (scene background, which the fog colour always matches). Neighbouring keyframes are
 *   blended with smoothstep easing in linear colour space.
 * - The key light is the sun by day: it rises in the east (+X), swings through the south (+Z)
 *   and sets in the west (−X), peaking in elevation at noon, never dropping below a minimum
 *   elevation so shadows stay readable. At night the same light becomes cool moonlight from a
 *   fixed direction; twilight keyframes cross-fade between the two.
 * - Nights are deep blue but stay bright enough to farm.
 *
 * Weather
 * - `sync` records the target weather; `update` eases per-weather weights toward it (~2 s), and
 *   the blended "look" dims and desaturates the sun, greys the sky and pulls the fog closer for
 *   rain and storms, or brightens and cools the ambient light for snow.
 * - Storms add lightning: brief double-flicker spikes on the hemisphere light and the sky
 *   (presentation-only randomness from mulberry32).
 *
 * Shadows
 * - A single PCF shadow map (SHADOWS.mapSize) covers ±SHADOWS.halfExtent around the camera focus.
 *   The light and its target follow the focus but are snapped to whole shadow-map texels in
 *   light space, and the light direction advances in half-minute steps, so walking around never
 *   makes shadow edges shimmer.
 *
 * The keyframe sampling, sun path and phase classification are pure exported functions so they
 * can be unit tested without a renderer.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/hash';
import { Weather, type GameState } from '../core/types';
import { CAMERA, SHADOWS } from './constants';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export type LightingPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Minute boundaries of the lighting phases (minutes since midnight, continuous clock). */
export const LIGHTING_PHASES = {
  dawnStart: 360,
  dayStart: 450,
  duskStart: 1080,
  nightStart: 1200,
} as const;

const NOON_MINUTE = 720;

/** Coarse classification of a clock minute; anything before 06:00 or from 20:00 on is night. */
export function lightingPhase(minute: number): LightingPhase {
  const m = Number.isFinite(minute) ? minute : NOON_MINUTE;
  if (m < LIGHTING_PHASES.dawnStart) return 'night';
  if (m < LIGHTING_PHASES.dayStart) return 'dawn';
  if (m < LIGHTING_PHASES.duskStart) return 'day';
  if (m < LIGHTING_PHASES.nightStart) return 'dusk';
  return 'night';
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/** One stop of the day gradient. Colours are sRGB hex; intensities are three.js light units. */
export interface LightingKeyframe {
  readonly minute: number;
  readonly label: string;
  /** Key light colour (sun, or moon once `moon` reaches 1). */
  readonly keyColor: number;
  readonly keyIntensity: number;
  readonly skyColor: number;
  readonly groundColor: number;
  readonly hemiIntensity: number;
  /** Sky / clear colour; the fog colour always matches it. */
  readonly background: number;
  /** 0 = the key light comes from the sun's path, 1 = from the fixed moon direction. */
  readonly moon: number;
  /** 0 = night … 1 = full daylight. Unlit effects (rain, snow) use it to dim themselves. */
  readonly daylight: number;
}

export const DAY_KEYFRAMES: readonly LightingKeyframe[] = [
  // The day starts at 06:00 with the player already up, so the first frame is a soft, readable
  // dawn rather than night: players spend the opening minutes of every day here.
  {
    minute: 360,
    label: 'dawn',
    keyColor: 0xffc4ac,
    keyIntensity: 1.65,
    skyColor: 0xeccbe2,
    groundColor: 0x948797,
    hemiIntensity: 1.42,
    background: 0xf0cadb,
    moon: 0.1,
    daylight: 0.7,
  },
  {
    minute: 410,
    label: 'sunrise',
    keyColor: 0xffc59e,
    keyIntensity: 1.95,
    skyColor: 0xf7d5d8,
    groundColor: 0x9e918b,
    hemiIntensity: 1.44,
    background: 0xf6d6d6,
    moon: 0,
    daylight: 0.85,
  },
  {
    minute: 480,
    label: 'morning',
    keyColor: 0xffe4c6,
    keyIntensity: 2.2,
    skyColor: 0xd6ebf8,
    groundColor: 0xa6aa8e,
    hemiIntensity: 1.45,
    background: 0xc7e8f4,
    moon: 0,
    daylight: 1,
  },
  {
    minute: 720,
    label: 'noon',
    keyColor: 0xfff4e2,
    keyIntensity: 2.4,
    skyColor: 0xe4f1ff,
    groundColor: 0xb4c29a,
    hemiIntensity: 1.5,
    background: 0xbfe6f2,
    moon: 0,
    daylight: 1,
  },
  {
    minute: 900,
    label: 'afternoon',
    keyColor: 0xffedd4,
    keyIntensity: 2.3,
    skyColor: 0xdeeefc,
    groundColor: 0xb0ba94,
    hemiIntensity: 1.48,
    background: 0xc3e5f0,
    moon: 0,
    daylight: 1,
  },
  {
    minute: 1060,
    label: 'golden hour',
    keyColor: 0xffc27e,
    keyIntensity: 2.0,
    skyColor: 0xfad9bc,
    groundColor: 0xa8927c,
    hemiIntensity: 1.38,
    background: 0xf8d7b8,
    moon: 0,
    daylight: 0.95,
  },
  {
    minute: 1130,
    label: 'dusk',
    keyColor: 0xff9c74,
    keyIntensity: 1.35,
    skyColor: 0xd9afdf,
    groundColor: 0x87718f,
    hemiIntensity: 1.3,
    background: 0xdcafd6,
    moon: 0,
    daylight: 0.7,
  },
  {
    minute: 1175,
    label: 'twilight',
    keyColor: 0xb690d8,
    keyIntensity: 0.8,
    skyColor: 0x928acd,
    groundColor: 0x575079,
    hemiIntensity: 1.22,
    background: 0x8b87c9,
    moon: 0.6,
    daylight: 0.35,
  },
  {
    minute: 1215,
    label: 'night',
    keyColor: 0xa4b8ff,
    keyIntensity: 1.0,
    skyColor: 0x6d80c8,
    groundColor: 0x39406d,
    hemiIntensity: 1.2,
    background: 0x3a4886,
    moon: 1,
    daylight: 0,
  },
  {
    minute: 1440,
    label: 'midnight',
    keyColor: 0x9cb0fa,
    keyIntensity: 0.95,
    skyColor: 0x6678c0,
    groundColor: 0x333a67,
    hemiIntensity: 1.15,
    background: 0x303d78,
    moon: 1,
    daylight: 0,
  },
  {
    minute: 1560,
    label: 'deep night',
    keyColor: 0x93a6f2,
    keyIntensity: 0.9,
    skyColor: 0x5f70b6,
    groundColor: 0x2d335e,
    hemiIntensity: 1.1,
    background: 0x2a366c,
    moon: 1,
    daylight: 0,
  },
];

interface ResolvedKeyframe {
  readonly minute: number;
  readonly keyColor: THREE.Color;
  readonly keyIntensity: number;
  readonly skyColor: THREE.Color;
  readonly groundColor: THREE.Color;
  readonly hemiIntensity: number;
  readonly background: THREE.Color;
  readonly moon: number;
  readonly daylight: number;
}

/** Keyframes with colours converted once to the linear working space. */
const RESOLVED_KEYFRAMES: readonly ResolvedKeyframe[] = DAY_KEYFRAMES.map((frame) => ({
  minute: frame.minute,
  keyColor: new THREE.Color(frame.keyColor),
  keyIntensity: frame.keyIntensity,
  skyColor: new THREE.Color(frame.skyColor),
  groundColor: new THREE.Color(frame.groundColor),
  hemiIntensity: frame.hemiIntensity,
  background: new THREE.Color(frame.background),
  moon: frame.moon,
  daylight: frame.daylight,
}));

function keyframeAt(index: number): ResolvedKeyframe {
  const frame = RESOLVED_KEYFRAMES[index];
  if (frame === undefined) throw new RangeError(`LightingManager: keyframe ${index} missing`);
  return frame;
}

function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Segment {
  from: ResolvedKeyframe;
  to: ResolvedKeyframe;
  /** Eased blend factor from `from` to `to`. */
  t: number;
}

const scratchSegment: Segment = { from: keyframeAt(0), to: keyframeAt(0), t: 0 };

/** Finds the keyframe pair around `minute` (clamped to the first / last keyframe). */
function locateSegment(minute: number, out: Segment): Segment {
  const m = Number.isFinite(minute) ? minute : NOON_MINUTE;
  const first = keyframeAt(0);
  if (m <= first.minute) {
    out.from = first;
    out.to = first;
    out.t = 0;
    return out;
  }
  for (let i = 1; i < RESOLVED_KEYFRAMES.length; i++) {
    const to = keyframeAt(i);
    if (m <= to.minute) {
      const from = keyframeAt(i - 1);
      const span = to.minute - from.minute;
      out.from = from;
      out.to = to;
      out.t = smoothstep(span > 0 ? (m - from.minute) / span : 1);
      return out;
    }
  }
  const last = keyframeAt(RESOLVED_KEYFRAMES.length - 1);
  out.from = last;
  out.to = last;
  out.t = 0;
  return out;
}

/** Output of the day-gradient sampler. Colours are in the linear working space. */
export interface DayLightingSample {
  readonly keyColor: THREE.Color;
  keyIntensity: number;
  readonly skyColor: THREE.Color;
  readonly groundColor: THREE.Color;
  hemiIntensity: number;
  /** Sky colour; the fog colour matches it. */
  readonly background: THREE.Color;
  moon: number;
  daylight: number;
}

export function createDayLightingSample(): DayLightingSample {
  return {
    keyColor: new THREE.Color(),
    keyIntensity: 0,
    skyColor: new THREE.Color(),
    groundColor: new THREE.Color(),
    hemiIntensity: 0,
    background: new THREE.Color(),
    moon: 0,
    daylight: 0,
  };
}

/**
 * Pure day-gradient sampler: fills `out` with the clear-weather lighting for a continuous clock
 * minute and returns it. Minutes outside the keyframe range clamp to the first / last stop.
 */
export function sampleDayLighting(minute: number, out: DayLightingSample = createDayLightingSample()): DayLightingSample {
  const { from, to, t } = locateSegment(minute, scratchSegment);
  out.keyColor.lerpColors(from.keyColor, to.keyColor, t);
  out.keyIntensity = lerp(from.keyIntensity, to.keyIntensity, t);
  out.skyColor.lerpColors(from.skyColor, to.skyColor, t);
  out.groundColor.lerpColors(from.groundColor, to.groundColor, t);
  out.hemiIntensity = lerp(from.hemiIntensity, to.hemiIntensity, t);
  out.background.lerpColors(from.background, to.background, t);
  out.moon = lerp(from.moon, to.moon, t);
  out.daylight = lerp(from.daylight, to.daylight, t);
  return out;
}

/** 0 at night … 1 in full daylight, for effects that are not lit by the scene lights. */
export function sampleDaylight(minute: number): number {
  const { from, to, t } = locateSegment(minute, scratchSegment);
  return lerp(from.daylight, to.daylight, t);
}

// ---------------------------------------------------------------------------
// Sun & moon path
// ---------------------------------------------------------------------------

export const SUN_PATH = {
  sunriseMinute: 380,
  noonMinute: NOON_MINUTE,
  sunsetMinute: 1180,
  /** Elevation at sunrise / sunset; keeps shadows at most ~3.5× an object's height. */
  minElevationDeg: 16,
  maxElevationDeg: 62,
} as const;

/** Moonlight comes from high in the south-west, so shadows fall toward screen-right. */
const MOON_DIRECTION = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();

const DEG2RAD = Math.PI / 180;

/**
 * Sun azimuth parameter φ ∈ [0, π]: 0 at sunrise (east), π/2 at noon (south), π at sunset (west).
 * Piecewise linear so the peak lands exactly on noon even though the day is not symmetric.
 */
function sunArcAngle(minute: number): number {
  const { sunriseMinute, noonMinute, sunsetMinute } = SUN_PATH;
  if (minute <= sunriseMinute) return 0;
  if (minute >= sunsetMinute) return Math.PI;
  if (minute <= noonMinute) return ((minute - sunriseMinute) / (noonMinute - sunriseMinute)) * (Math.PI / 2);
  return Math.PI / 2 + ((minute - noonMinute) / (sunsetMinute - noonMinute)) * (Math.PI / 2);
}

/** Unit vector toward the sun for a clock minute (east at sunrise, south and highest at noon). */
export function sampleSunDirection(minute: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const m = Number.isFinite(minute) ? minute : NOON_MINUTE;
  const phi = sunArcAngle(m);
  const minElevation = SUN_PATH.minElevationDeg * DEG2RAD;
  const maxElevation = SUN_PATH.maxElevationDeg * DEG2RAD;
  const elevation = minElevation + (maxElevation - minElevation) * Math.sin(phi);
  const horizontal = Math.cos(elevation);
  return out.set(Math.cos(phi) * horizontal, Math.sin(elevation), Math.sin(phi) * horizontal).normalize();
}

/**
 * Unit vector toward the key light: the sun's path blended toward the fixed moon direction by
 * the keyframes' `moon` weight. Always has a positive Y component.
 */
export function sampleLightDirection(minute: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const { from, to, t } = locateSegment(minute, scratchSegment);
  const moon = lerp(from.moon, to.moon, t);
  sampleSunDirection(minute, out);
  return out.lerp(MOON_DIRECTION, moon).normalize();
}

// ---------------------------------------------------------------------------
// Weather looks
// ---------------------------------------------------------------------------

interface WeatherLook {
  /** Multiplier on the key light intensity. */
  readonly keyIntensity: number;
  /** Saturation kept in the key light colour (1 = unchanged, 0 = grey). */
  readonly keySaturation: number;
  readonly hemiIntensity: number;
  /** Saturation kept in the sky, ground and background colours. */
  readonly skySaturation: number;
  /** Linear RGB multiplier applied to sky, ground and background (may exceed 1). */
  readonly tint: readonly [number, number, number];
  readonly backgroundBrightness: number;
  /** Multiplier on shadow opacity (overcast light casts faint shadows). */
  readonly shadowIntensity: number;
  /** Fog start / end relative to CAMERA.distance (world units along the view direction). */
  readonly fogNear: number;
  readonly fogFar: number;
  /** 1 enables lightning flashes. */
  readonly lightning: number;
}

const WEATHER_LOOKS: Readonly<Record<Weather, WeatherLook>> = {
  [Weather.Sunny]: {
    keyIntensity: 1,
    keySaturation: 1,
    hemiIntensity: 1,
    skySaturation: 1,
    tint: [1, 1, 1],
    backgroundBrightness: 1,
    shadowIntensity: 1,
    fogNear: 8,
    fogFar: 72,
    lightning: 0,
  },
  [Weather.Rain]: {
    keyIntensity: 0.38,
    keySaturation: 0.35,
    hemiIntensity: 1.04,
    skySaturation: 0.45,
    tint: [0.88, 0.93, 1.0],
    backgroundBrightness: 0.8,
    shadowIntensity: 0.55,
    fogNear: -4,
    fogFar: 34,
    lightning: 0,
  },
  [Weather.Storm]: {
    keyIntensity: 0.2,
    keySaturation: 0.2,
    hemiIntensity: 0.94,
    skySaturation: 0.3,
    tint: [0.8, 0.85, 1.0],
    backgroundBrightness: 0.58,
    shadowIntensity: 0.4,
    fogNear: -8,
    fogFar: 26,
    lightning: 1,
  },
  [Weather.Snow]: {
    keyIntensity: 0.75,
    keySaturation: 0.55,
    hemiIntensity: 1.22,
    skySaturation: 0.6,
    tint: [0.93, 0.98, 1.08],
    backgroundBrightness: 1.06,
    shadowIntensity: 0.75,
    fogNear: -2,
    fogFar: 42,
    lightning: 0,
  },
};

const WEATHERS: readonly Weather[] = [Weather.Sunny, Weather.Rain, Weather.Storm, Weather.Snow];

/** Mutable weighted blend of WeatherLooks. */
interface BlendedLook {
  keyIntensity: number;
  keySaturation: number;
  hemiIntensity: number;
  skySaturation: number;
  readonly tint: THREE.Color;
  backgroundBrightness: number;
  shadowIntensity: number;
  fogNear: number;
  fogFar: number;
  lightning: number;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Weather weights converge ~95 % in 2 s. */
const WEATHER_BLEND_RATE = 1.5;
/** Shadow opacity by day and under moonlight (before the weather multiplier). */
const SHADOW_INTENSITY_DAY = 0.85;
const SHADOW_INTENSITY_NIGHT = 0.7;
/** Distance from the snapped focus to the light along the light direction. */
const LIGHT_DISTANCE = 50;
const SHADOW_NEAR = 1;
const SHADOW_FAR = LIGHT_DISTANCE + 45;
/** Depth bias in normalised shadow depth (≈ 0.03 world units over the 94-unit range). */
const SHADOW_BIAS = -0.0003;
/** Normal offset in world units; scales naturally with grazing angles on flat faces. */
const SHADOW_NORMAL_BIAS = 0.028;
/** PCF filter radius in texels. */
const SHADOW_RADIUS = 1.5;
/** The light direction advances in steps of 1 / N game minutes (keeps the shadow map stable). */
const DIRECTION_STEPS_PER_MINUTE = 2;

const LIGHTNING = {
  /** Seconds between flashes. */
  minGap: 3.5,
  maxGap: 11,
  /** Delay before the first flash once a storm rolls in. */
  firstMin: 1.5,
  firstMax: 5,
  /** Storm weight above which flashes are scheduled. */
  threshold: 0.5,
  hemiBoost: 3.2,
  skyMix: 0.75,
  backgroundMix: 0.45,
  duration: 0.9,
} as const;

const FLASH_SKY = new THREE.Color(0xf0ecff);
const FLASH_BACKGROUND = new THREE.Color(0xd9d6f5);

/**
 * Lightning brightness envelope for `t` seconds after a strike: a sharp flash followed by a
 * weaker re-strike 0.14 s later, both decaying exponentially. 0 outside [0, duration).
 */
export function lightningEnvelope(t: number): number {
  if (!(t >= 0) || t >= LIGHTNING.duration) return 0;
  const first = Math.exp(-t * 22);
  const second = t >= 0.14 ? 0.8 * Math.exp(-(t - 0.14) * 13) : 0;
  return Math.min(1, Math.max(first, second));
}

/** Rec. 709 luminance of a linear colour. */
function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Desaturates toward luminance, then multiplies by `tint` and `brightness`. In place. */
function grade(color: THREE.Color, saturation: number, tint: THREE.Color, brightness: number): THREE.Color {
  const l = luminance(color);
  color.r = (l + (color.r - l) * saturation) * tint.r * brightness;
  color.g = (l + (color.g - l) * saturation) * tint.g * brightness;
  color.b = (l + (color.b - l) * saturation) * tint.b * brightness;
  return color;
}

const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
// LightingManager
// ---------------------------------------------------------------------------

export class LightingManager implements RenderSystem {
  /** Sun by day, moon by night. Casts the scene's only shadow map. */
  readonly keyLight: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;

  private readonly ctx: SceneContext;
  private readonly background: THREE.Color;
  private readonly fog: THREE.Fog;
  private readonly sample = createDayLightingSample();
  private readonly look: BlendedLook = {
    keyIntensity: 1,
    keySaturation: 1,
    hemiIntensity: 1,
    skySaturation: 1,
    tint: new THREE.Color(1, 1, 1),
    backgroundBrightness: 1,
    shadowIntensity: 1,
    fogNear: WEATHER_LOOKS[Weather.Sunny].fogNear,
    fogFar: WEATHER_LOOKS[Weather.Sunny].fogFar,
    lightning: 0,
  };
  private readonly weights: Record<Weather, number> = {
    [Weather.Sunny]: 1,
    [Weather.Rain]: 0,
    [Weather.Storm]: 0,
    [Weather.Snow]: 0,
  };
  private targetWeather: Weather = Weather.Sunny;

  /** Unit vector toward the light, and the light-space axes used for texel snapping. */
  private readonly direction = new THREE.Vector3(0, 1, 0);
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 0, -1);
  private directionMinute = Number.NaN;
  private readonly texelSize: number;

  private readonly random = mulberry32(0x6c1a7e5d);
  private lightningCountdown = 0;
  private flashAge = Number.POSITIVE_INFINITY;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const scene = ctx.scene;

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2);
    this.keyLight.name = 'lighting:key';
    this.configureShadow(this.keyLight);
    this.texelSize = (2 * SHADOWS.halfExtent) / SHADOWS.mapSize;

    this.hemisphere = new THREE.HemisphereLight(0xe4f1ff, 0xb4c29a, 1.5);
    this.hemisphere.name = 'lighting:hemisphere';

    // Background and fog belong to the scene; this system animates them in place.
    if (scene.background instanceof THREE.Color) {
      this.background = scene.background;
    } else {
      this.background = new THREE.Color();
      scene.background = this.background;
    }
    if (scene.fog instanceof THREE.Fog) {
      this.fog = scene.fog;
    } else {
      this.fog = new THREE.Fog(this.background.clone(), CAMERA.distance + 8, CAMERA.distance + 72);
      scene.fog = this.fog;
    }

    scene.add(this.keyLight, this.keyLight.target, this.hemisphere);
    this.scheduleLightning(LIGHTNING.firstMin, LIGHTNING.firstMax);
  }

  sync(state: GameState, prev: GameState | null): void {
    this.targetWeather = state.weather;
    if (prev === null) {
      // Boot or load: jump straight to the target look, no cross-fade.
      for (const weather of WEATHERS) this.weights[weather] = weather === state.weather ? 1 : 0;
      this.flashAge = Number.POSITIVE_INFINITY;
      this.scheduleLightning(LIGHTNING.firstMin, LIGHTNING.firstMax);
      this.directionMinute = Number.NaN;
    }
  }

  update(frame: FrameContext): void {
    this.blendWeather(frame.dt);
    this.blendLook();
    sampleDayLighting(frame.clockMinutes, this.sample);
    const flash = this.updateLightning(frame.dt);
    this.applyColors(flash);
    this.updateDirection(frame.clockMinutes);
    this.followFocus();
  }

  dispose(): void {
    const scene = this.ctx.scene;
    scene.remove(this.keyLight, this.keyLight.target, this.hemisphere);
    this.keyLight.dispose();
    this.hemisphere.dispose();
  }

  private configureShadow(light: THREE.DirectionalLight): void {
    light.castShadow = true;
    const shadow = light.shadow;
    shadow.mapSize.set(SHADOWS.mapSize, SHADOWS.mapSize);
    shadow.bias = SHADOW_BIAS;
    shadow.normalBias = SHADOW_NORMAL_BIAS;
    shadow.radius = SHADOW_RADIUS;
    shadow.intensity = SHADOW_INTENSITY_DAY;
    const camera = shadow.camera;
    camera.left = -SHADOWS.halfExtent;
    camera.right = SHADOWS.halfExtent;
    camera.top = SHADOWS.halfExtent;
    camera.bottom = -SHADOWS.halfExtent;
    camera.near = SHADOW_NEAR;
    camera.far = SHADOW_FAR;
    camera.updateProjectionMatrix();
  }

  /** Eases every weather weight toward the one-hot target; the weights keep summing to 1. */
  private blendWeather(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const k = 1 - Math.exp(-WEATHER_BLEND_RATE * step);
    for (const weather of WEATHERS) {
      const target = weather === this.targetWeather ? 1 : 0;
      const current = this.weights[weather];
      const next = current + (target - current) * k;
      this.weights[weather] = Math.abs(target - next) < 1e-4 ? target : next;
    }
  }

  private blendLook(): void {
    const look = this.look;
    look.keyIntensity = 0;
    look.keySaturation = 0;
    look.hemiIntensity = 0;
    look.skySaturation = 0;
    look.tint.setRGB(0, 0, 0);
    look.backgroundBrightness = 0;
    look.shadowIntensity = 0;
    look.fogNear = 0;
    look.fogFar = 0;
    look.lightning = 0;
    let total = 0;
    for (const weather of WEATHERS) {
      const w = this.weights[weather];
      if (w <= 0) continue;
      const source = WEATHER_LOOKS[weather];
      total += w;
      look.keyIntensity += source.keyIntensity * w;
      look.keySaturation += source.keySaturation * w;
      look.hemiIntensity += source.hemiIntensity * w;
      look.skySaturation += source.skySaturation * w;
      look.tint.r += source.tint[0] * w;
      look.tint.g += source.tint[1] * w;
      look.tint.b += source.tint[2] * w;
      look.backgroundBrightness += source.backgroundBrightness * w;
      look.shadowIntensity += source.shadowIntensity * w;
      look.fogNear += source.fogNear * w;
      look.fogFar += source.fogFar * w;
      look.lightning += source.lightning * w;
    }
    if (total > 0 && total !== 1) {
      const inv = 1 / total;
      look.keyIntensity *= inv;
      look.keySaturation *= inv;
      look.hemiIntensity *= inv;
      look.skySaturation *= inv;
      look.tint.multiplyScalar(inv);
      look.backgroundBrightness *= inv;
      look.shadowIntensity *= inv;
      look.fogNear *= inv;
      look.fogFar *= inv;
      look.lightning *= inv;
    }
  }

  /** Advances the lightning schedule and returns the current flash strength in [0, 1]. */
  private updateLightning(dt: number): number {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.flashAge += step;
    const storm = this.look.lightning;
    if (storm > LIGHTNING.threshold) {
      this.lightningCountdown -= step;
      if (this.lightningCountdown <= 0) {
        this.flashAge = 0;
        this.scheduleLightning(LIGHTNING.minGap, LIGHTNING.maxGap);
      }
    }
    return lightningEnvelope(this.flashAge) * storm;
  }

  private scheduleLightning(minSeconds: number, maxSeconds: number): void {
    this.lightningCountdown = lerp(minSeconds, maxSeconds, this.random());
  }

  private applyColors(flash: number): void {
    const sample = this.sample;
    const look = this.look;

    grade(this.keyLight.color.copy(sample.keyColor), look.keySaturation, WHITE, 1);
    this.keyLight.intensity = sample.keyIntensity * look.keyIntensity;
    this.keyLight.shadow.intensity =
      lerp(SHADOW_INTENSITY_DAY, SHADOW_INTENSITY_NIGHT, sample.moon) * look.shadowIntensity;

    const hemi = this.hemisphere;
    grade(hemi.color.copy(sample.skyColor), look.skySaturation, look.tint, 1);
    grade(hemi.groundColor.copy(sample.groundColor), look.skySaturation, look.tint, 1);
    hemi.intensity = sample.hemiIntensity * look.hemiIntensity + flash * LIGHTNING.hemiBoost;

    grade(this.background.copy(sample.background), look.skySaturation, look.tint, look.backgroundBrightness);

    if (flash > 0) {
      hemi.color.lerp(FLASH_SKY, Math.min(1, flash * LIGHTNING.skyMix));
      this.background.lerp(FLASH_BACKGROUND, Math.min(1, flash * LIGHTNING.backgroundMix));
    }

    this.fog.color.copy(this.background);
    const near = CAMERA.distance + look.fogNear;
    this.fog.near = near;
    this.fog.far = Math.max(near + 1, CAMERA.distance + look.fogFar);
  }

  /** Recomputes the light direction (and its light-space axes) when the quantised minute moves. */
  private updateDirection(minute: number): void {
    const m = Number.isFinite(minute) ? minute : NOON_MINUTE;
    const quantised = Math.round(m * DIRECTION_STEPS_PER_MINUTE) / DIRECTION_STEPS_PER_MINUTE;
    if (quantised === this.directionMinute) return;
    this.directionMinute = quantised;
    sampleLightDirection(quantised, this.direction);
    // Same basis Matrix4.lookAt builds for the shadow camera: x = up × z, y = z × x.
    this.axisX.set(0, 1, 0).cross(this.direction);
    if (this.axisX.lengthSq() < 1e-8) this.axisX.set(1, 0, 0);
    this.axisX.normalize();
    this.axisY.crossVectors(this.direction, this.axisX).normalize();
  }

  /**
   * Centres the shadow frustum on the camera focus, snapped to whole texels in light space so the
   * shadow map rasterises identically while the camera glides.
   */
  private followFocus(): void {
    const focus = this.ctx.rig.focus;
    const texel = this.texelSize;
    const x = Math.round(focus.dot(this.axisX) / texel) * texel;
    const y = Math.round(focus.dot(this.axisY) / texel) * texel;
    const z = focus.dot(this.direction);
    const target = this.keyLight.target.position;
    target.copy(this.axisX).multiplyScalar(x).addScaledVector(this.axisY, y).addScaledVector(this.direction, z);
    this.keyLight.position.copy(target).addScaledVector(this.direction, LIGHT_DISTANCE);
  }
}
