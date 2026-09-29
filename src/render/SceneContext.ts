/**
 * Rendering context shared by every render system: the WebGL renderer, the scene, the
 * orthographic isometric camera and the rig that moves it.
 *
 * - Requires WebGL 2. When it is unavailable the constructor throws an Error whose message is
 *   written for players (main.ts shows it in the fatal-error panel).
 * - Colour pipeline: linear working space, NeutralToneMapping, sRGB output. Neutral tone mapping
 *   keeps the pastel palette's hues intact and only rolls off highlights.
 * - Shadows use PCF (r186 folded the soft variant into it). The shadow-casting light itself is
 *   created by LightingManager, which also drives `scene.background` and `scene.fog`; this class
 *   only seeds them with the daytime sky colour.
 * - The canvas tracks its container through a ResizeObserver (window resize as a fallback).
 *   Zero-sized containers (hidden tabs, collapsed layouts) keep the last valid size, so the
 *   frustum never receives NaN.
 */
import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import type { GridSpec } from '../core/types';
import { worldRect } from '../world/grid';
import { CameraRig } from './CameraRig';
import { CAMERA } from './constants';

export const RENDERER_SETTINGS = {
  /** Upper bound for the device pixel ratio (keeps fill rate sane on 3× phones and 4K). */
  maxPixelRatio: 2,
  /** Tone-mapping exposure; slightly above 1 for a bright, airy pastel look. */
  exposure: 1.05,
  /** Daytime sky; LightingManager animates it from the first frame on. */
  initialSky: 0xbfe6f2,
  /** Initial fog range relative to CAMERA.distance (a faint haze at the far side of the view). */
  initialFogNear: 8,
  initialFogFar: 72,
  near: 0.1,
  /** Far plane as a multiple of CAMERA.distance; comfortably contains the whole farm. */
  farDistanceFactor: 2.5,
  /** How far past the world edge the camera focus may travel (world units). */
  focusMargin: 3,
} as const;

const WEBGL2_UNAVAILABLE_MESSAGE =
  'Meadowlight Farm needs WebGL 2, which this browser or device does not provide. ' +
  'Please try an up-to-date Chrome, Edge, Firefox or Safari and make sure hardware acceleration is turned on.';

const RENDERER_FAILED_MESSAGE =
  'The 3D view could not be created. Your graphics driver may have refused to start WebGL; ' +
  'closing other 3D tabs, enabling hardware acceleration or restarting the browser usually helps.';

const scratchSize = new THREE.Vector2();

function currentPixelRatio(): number {
  const ratio = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return Math.min(Math.max(ratio, 1), RENDERER_SETTINGS.maxPixelRatio);
}

function createRenderer(): THREE.WebGLRenderer {
  if (!WebGL.isWebGL2Available()) throw new Error(WEBGL2_UNAVAILABLE_MESSAGE);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (cause) {
    throw new Error(RENDERER_FAILED_MESSAGE, { cause });
  }
  renderer.setPixelRatio(currentPixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = RENDERER_SETTINGS.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function prepareCanvas(canvas: HTMLCanvasElement): void {
  // CSS owns the displayed size; the renderer only sets the drawing-buffer size.
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Meadowlight Farm. Use the keyboard to walk, farm and use tools.');
}

export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly rig: CameraRig;

  /** Grid of the active map; replaced by `setActiveGrid` on a load or a map change. */
  private activeGrid: GridSpec;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onWindowResize: () => void;
  private readonly onPixelRatioChange: () => void;
  private pixelRatioQuery: MediaQueryList | null = null;
  private aspect = 16 / 9;
  private hasRendered = false;
  private disposed = false;

  constructor(container: HTMLElement, grid: GridSpec) {
    this.container = container;
    this.activeGrid = grid;

    this.renderer = createRenderer();
    prepareCanvas(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const sky = new THREE.Color(RENDERER_SETTINGS.initialSky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(
      sky.clone(),
      CAMERA.distance + RENDERER_SETTINGS.initialFogNear,
      CAMERA.distance + RENDERER_SETTINGS.initialFogFar,
    );

    this.camera = new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      RENDERER_SETTINGS.near,
      CAMERA.distance * RENDERER_SETTINGS.farDistanceFactor,
    );

    const initialWidth = container.clientWidth;
    const initialHeight = container.clientHeight;
    if (initialWidth > 0 && initialHeight > 0) {
      this.aspect = initialWidth / initialHeight;
    } else if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      this.aspect = window.innerWidth / window.innerHeight;
    }

    this.rig = new CameraRig(this.camera, {
      getAspect: () => this.aspect,
      bounds: worldRect(grid),
      boundsMargin: RENDERER_SETTINGS.focusMargin,
    });

    container.appendChild(this.renderer.domElement);

    this.onWindowResize = () => {
      this.handleResize();
    };
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onWindowResize);
      this.resizeObserver.observe(container);
    } else {
      this.resizeObserver = null;
      window.addEventListener('resize', this.onWindowResize);
    }
    this.onPixelRatioChange = () => {
      this.watchPixelRatio();
      this.handleResize();
    };
    this.watchPixelRatio();
    this.handleResize();
  }

  /** Grid of the active map. */
  get grid(): GridSpec {
    return this.activeGrid;
  }

  /**
   * Switches to another map's grid (a load or a map change) and re-bounds the camera to it.
   * main.ts calls this before the render systems sync, so they read the new grid.
   */
  setActiveGrid(grid: GridSpec): void {
    this.activeGrid = grid;
    this.rig.setBounds(worldRect(grid));
  }

  /** Current viewport aspect (width / height). */
  get viewportAspect(): number {
    return this.aspect;
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.hasRendered = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this.onWindowResize);
    }
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.clear();
    this.renderer.dispose();
    // Release the GL context right away (hot reloads would otherwise exhaust the browser's pool).
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /**
   * Moving the window to a monitor with a different pixel density changes devicePixelRatio
   * without resizing the container, so a resolution media query (re-armed on every change)
   * triggers the resize path as well.
   */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = null;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = query;
  }

  /**
   * Matches the drawing buffer and frustum to the container. Resizing clears the canvas, so once
   * the loop has started a frame is re-rendered immediately to avoid a one-frame blank flash.
   */
  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.floor(this.container.clientWidth);
    const height = Math.floor(this.container.clientHeight);
    if (width <= 0 || height <= 0) return;

    const pixelRatio = currentPixelRatio();
    const ratioChanged = this.renderer.getPixelRatio() !== pixelRatio;
    if (ratioChanged) this.renderer.setPixelRatio(pixelRatio);

    this.aspect = width / height;
    const size = this.renderer.getSize(scratchSize);
    const sizeChanged = size.x !== width || size.y !== height;
    if (sizeChanged) this.renderer.setSize(width, height, false);
    const projectionChanged = this.rig.syncProjection();
    if (this.hasRendered && (ratioChanged || sizeChanged || projectionChanged)) this.render();
  }
}
