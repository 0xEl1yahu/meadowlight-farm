/**
 * Keyboard and mouse → store actions. This is the entry point for movement, inventory
 * selection and tool interaction; it never reads or writes render state except the camera
 * zoom, and it never dispatches from inside a store listener (only from DOM events and from
 * update(), which the frame loop calls before anything else).
 *
 * Bindings (KeyboardEvent.code, so they follow physical key positions on every layout)
 *   Move          W A S D / arrow keys. Shift + direction turns in place.
 *                 (Isometric camera: North appears up-right on screen.)
 *   Use tool      Space, J, left mouse button on the canvas. Hold to repeat. With the zone
 *                 marker only fresh presses count, and Shift + any of them picks the next zone
 *                 letter (part 3 spec §8; markerToolCommand in panelKeys.ts).
 *   Interact      E, K, Enter, right mouse button on the canvas (Ctrl + click on macOS).
 *                 While the backpack or a chest is open, E, K and Enter close it instead.
 *   Peek          Shift + any interact key or button (part 3 spec §2.3). Every change of the
 *                 Shift key is reported through `onShiftChange`, so the HUD hint can follow it.
 *   Hotbar        1–9, 0, -, = select slots 0–11 (INVENTORY.hotbarSize). Tab / Shift+Tab and
 *                 the mouse wheel cycle within those 12.
 *   Backpack      I toggles the inventory screen; with a chest open, I closes the chest.
 *   Zoom          Z (in) / X (out), Ctrl + mouse wheel or trackpad pinch.
 *   Shop          B toggles. It does nothing while the backpack or a chest is open.
 *   Pause         P toggles. Escape closes any open panel, otherwise drops a zone draft, otherwise toggles pause.
 *   Sleep         N.
 *   Time scale    T cycles through TIME.timeScales.
 * The panel keys (I, E / K / Enter, B, Escape) are decided by panelKeyCommand in panelKeys.ts.
 *
 * Held keys
 * - Direction keys form a stack in press order; the most recent one steers and releasing it
 *   falls back to the previous key still held. A fresh press moves immediately; while held,
 *   moves repeat every PLAYER.moveDurationSeconds from an accumulator advanced in update(dt),
 *   so the cadence matches the render lerp exactly and never bunches up after a hitch.
 * - Tool sources (Space, J, each pointer) are a set; while any is held the tool repeats
 *   every TOOL_REPEAT_SECONDS.
 * - While the game is frozen (paused or a panel open) held repeats are suspended: accumulators do
 *   not advance, so nothing is queued for the moment the game resumes.
 * - Window blur, the page becoming hidden and releasing Cmd (macOS swallows key-ups while it
 *   is held) clear all held state so no key can get stuck.
 *
 * Focus etiquette
 * - Events aimed at text inputs, selects and contenteditable elements are ignored.
 * - Space / Enter on a focused HUD button activate the button, not the game. Tab on a focused
 *   HUD button, or while any panel is open, moves keyboard focus normally so the HUD stays
 *   keyboard-accessible.
 * - Key presses with Ctrl, Cmd or Alt are left to the browser (shortcuts keep working).
 * - While a robot screen is open every key is left to it (part 3 spec §4.1).
 */
import { INVENTORY, PLAYER, TIME } from '../config';
import type { Store } from '../core/store';
import { Direction, type GameState } from '../core/types';
import type { CameraRig } from '../render/CameraRig';
import { actions, type GameAction } from '../state/actions';
import { isZoneMarkerSelected, selectIsFrozen } from '../state/selectors';
import { IGNORED, markerToolCommand, panelKeyCommand } from './panelKeys';

export interface InputControllerOptions {
  readonly target: Window;
  readonly canvas: HTMLCanvasElement;
  readonly store: Store<GameState, GameAction>;
  readonly rig: CameraRig;
  /** Called whenever Shift goes down or up (and with false when held keys are cleared). */
  readonly onShiftChange?: (held: boolean) => void;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Seconds between tool uses while a tool button is held. */
const TOOL_REPEAT_SECONDS = 0.3;

const ZOOM = {
  /** Z: smaller view height (zoom in). */
  inFactor: 0.85,
  /** X: larger view height (zoom out). */
  outFactor: 1.18,
  /** Ctrl + wheel: zoom factor = exp(pixels × perPixel); ~100 px (one notch) ≈ ×1.17. */
  wheelPerPixel: 0.0016,
  /** Clamp per event so one flung wheel cannot jump across the whole zoom range. */
  wheelMaxPixels: 120,
} as const;

const WHEEL = {
  /** At most one hotbar step per this many milliseconds. */
  stepIntervalMs: 80,
  /** Scroll distance (pixels) that makes one hotbar step; small trackpad deltas accumulate. */
  stepPixels: 40,
  /** Pixel size of one wheel "line" (Firefox reports lines) and fallback page size. */
  linePixels: 16,
  pagePixels: 800,
} as const;

/** WheelEvent.deltaMode values. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

// ---------------------------------------------------------------------------
// Key maps
// ---------------------------------------------------------------------------

const DIRECTION_KEYS: ReadonlyMap<string, Direction> = new Map<string, Direction>([
  ['KeyW', Direction.North],
  ['ArrowUp', Direction.North],
  ['KeyD', Direction.East],
  ['ArrowRight', Direction.East],
  ['KeyS', Direction.South],
  ['ArrowDown', Direction.South],
  ['KeyA', Direction.West],
  ['ArrowLeft', Direction.West],
]);

const TOOL_KEYS: ReadonlySet<string> = new Set(['Space', 'KeyJ']);

const HOTBAR_KEYS: ReadonlyMap<string, number> = new Map<string, number>([
  ['Digit1', 0],
  ['Digit2', 1],
  ['Digit3', 2],
  ['Digit4', 3],
  ['Digit5', 4],
  ['Digit6', 5],
  ['Digit7', 6],
  ['Digit8', 7],
  ['Digit9', 8],
  ['Digit0', 9],
  ['Minus', 10],
  ['Equal', 11],
]);

/** Keys a focused button (or focus navigation) owns; the game leaves them alone then. */
const FOCUSED_CONTROL_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter', 'Tab']);

/** Releasing Cmd clears held keys: macOS does not deliver key-ups for keys released while Cmd is down. */
const META_KEYS: ReadonlySet<string> = new Set(['MetaLeft', 'MetaRight']);

const BUTTON_SELECTOR = 'button, [role="button"], a[href], summary';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BUTTON_SELECTOR) !== null;
}

function pointerSource(pointerId: number): string {
  return `pointer:${pointerId}`;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class InputController {
  private readonly target: Window;
  private readonly document: Document;
  private readonly canvas: HTMLCanvasElement;
  private readonly store: Store<GameState, GameAction>;
  private readonly rig: CameraRig;
  private readonly onShiftChange: ((held: boolean) => void) | undefined;

  /** Held direction key codes in press order; the last one steers. */
  private readonly directionKeys: string[] = [];
  /** Held tool sources: key codes and pointer ids. */
  private readonly toolSources = new Set<string>();
  private shiftHeld = false;
  /** Seconds since the last movement step while a direction is held. */
  private moveElapsed = 0;
  /** Seconds since the last tool use while a tool source is held. */
  private toolElapsed = 0;
  private wheelAccumulator = 0;
  private lastWheelStepAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(options: InputControllerOptions) {
    this.target = options.target;
    this.document = options.target.document;
    this.canvas = options.canvas;
    this.store = options.store;
    this.rig = options.rig;
    this.onShiftChange = options.onShiftChange;

    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
    this.target.addEventListener('pointerup', this.onPointerUp);
    this.target.addEventListener('pointercancel', this.onPointerUp);
    this.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Held-key repeats. Call once per frame before the simulation clock advances. */
  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    if (this.isFrozen()) return;
    this.updateMovement(dt);
    this.updateTool(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerUp);
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.releaseAll();
  }

  // -------------------------------------------------------------------------
  // Held repeats
  // -------------------------------------------------------------------------

  private updateMovement(dt: number): void {
    const direction = this.activeDirection();
    if (direction === null || this.shiftHeld) {
      this.moveElapsed = 0;
      return;
    }
    const interval = PLAYER.moveDurationSeconds;
    this.moveElapsed += dt;
    if (this.moveElapsed < interval) return;
    this.moveElapsed -= interval;
    // Never owe more than one step: after a long frame, restart the cadence instead of bursting.
    if (this.moveElapsed >= interval) this.moveElapsed = 0;
    this.store.dispatch(actions.move(direction));
  }

  private updateTool(dt: number): void {
    // The zone marker never repeats, even for a key held down before the marker was selected.
    if (this.toolSources.size === 0 || isZoneMarkerSelected(this.store.getState())) {
      this.toolElapsed = 0;
      return;
    }
    this.toolElapsed += dt;
    if (this.toolElapsed < TOOL_REPEAT_SECONDS) return;
    this.toolElapsed -= TOOL_REPEAT_SECONDS;
    if (this.toolElapsed >= TOOL_REPEAT_SECONDS) this.toolElapsed = 0;
    this.store.dispatch(actions.useTool());
  }

  private activeDirection(): Direction | null {
    const code = this.directionKeys[this.directionKeys.length - 1];
    if (code === undefined) return null;
    return DIRECTION_KEYS.get(code) ?? null;
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.setShiftHeld(event.shiftKey);
    // The robot screen owns the keyboard (part 3 spec §4.1): Blockly, its fields and the screen
    // get every key, so nothing is dispatched and no default is prevented.
    if (this.store.getState().ui.panel.kind === 'robot') return;
    if (event.defaultPrevented || event.isComposing) return;
    if (isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (FOCUSED_CONTROL_KEYS.has(event.code) && isButtonTarget(event.target)) return;
    if (this.handleKeyDown(event)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.setShiftHeld(event.shiftKey);
    const code = event.code;
    if (META_KEYS.has(code)) {
      this.releaseAll();
      return;
    }
    if (DIRECTION_KEYS.has(code)) this.releaseDirection(code);
    else if (TOOL_KEYS.has(code)) this.releaseTool(code);
  };

  /** Applies a key press. Returns true when the key is a game key (its default is prevented). */
  private handleKeyDown(event: KeyboardEvent): boolean {
    const code = event.code;
    const direction = DIRECTION_KEYS.get(code);
    if (direction !== undefined) {
      this.pressDirection(code, direction, event.repeat, event.shiftKey);
      return true;
    }
    if (TOOL_KEYS.has(code)) {
      this.pressTool(code, event.repeat, event.shiftKey);
      return true;
    }
    // Zoom steps honour auto-repeat so holding Z / X zooms smoothly (the rig clamps).
    if (code === 'KeyZ' || code === 'KeyX') {
      this.rig.zoomBy(code === 'KeyZ' ? ZOOM.inFactor : ZOOM.outFactor);
      return true;
    }
    const slot = HOTBAR_KEYS.get(code);
    if (slot !== undefined) {
      if (!event.repeat) this.selectSlot(slot);
      return true;
    }
    const state = this.store.getState();
    // I, E / K / Enter, B and Escape: open, close or toggle panels, interact, or peek with Shift.
    const command = panelKeyCommand(code, state, event.shiftKey);
    if (command !== null) {
      if (!event.repeat && command !== IGNORED) this.store.dispatch(command);
      return true;
    }
    switch (code) {
      case 'Tab':
        // With a panel open, Tab walks keyboard focus through the panel instead.
        if (state.ui.panel.kind !== 'none') return false;
        if (!event.repeat) this.store.dispatch(actions.cycleSlot(event.shiftKey ? -1 : 1));
        return true;
      case 'KeyP':
        if (!event.repeat) this.store.dispatch(actions.setPaused(!state.ui.paused));
        return true;
      case 'KeyN':
        if (!event.repeat) this.store.dispatch(actions.sleep());
        return true;
      case 'KeyT':
        if (!event.repeat) this.cycleTimeScale(state);
        return true;
      default:
        return false;
    }
  }

  private pressDirection(code: string, direction: Direction, repeat: boolean, shift: boolean): void {
    const index = this.directionKeys.indexOf(code);
    if (repeat && index !== -1) return; // OS auto-repeat of a key already held.
    if (index !== -1) this.directionKeys.splice(index, 1);
    this.directionKeys.push(code);
    // An auto-repeat for a key we are not tracking means it was held across a focus loss:
    // pick it up again and let the paced repeat continue, without an extra immediate step.
    if (repeat) return;
    this.moveElapsed = 0;
    if (this.isFrozen()) return;
    this.store.dispatch(shift ? actions.face(direction) : actions.move(direction));
  }

  private releaseDirection(code: string): void {
    const index = this.directionKeys.indexOf(code);
    if (index === -1) return;
    this.directionKeys.splice(index, 1);
    if (this.directionKeys.length === 0) this.moveElapsed = 0;
  }

  private pressTool(source: string, repeat: boolean, shift: boolean): void {
    const marker = markerToolCommand(this.store.getState(), shift, repeat);
    if (marker !== null) {
      // The zone marker is never held: no source is tracked, so nothing repeats.
      if (marker !== IGNORED && !this.isFrozen()) this.store.dispatch(marker);
      return;
    }
    if (repeat) {
      // Held across a focus loss: resume repeating without an extra immediate use.
      this.toolSources.add(source);
      return;
    }
    this.toolSources.add(source);
    this.toolElapsed = 0;
    if (!this.isFrozen()) this.store.dispatch(actions.useTool());
  }

  private releaseTool(source: string): void {
    if (this.toolSources.delete(source) && this.toolSources.size === 0) this.toolElapsed = 0;
  }

  private selectSlot(slot: number): void {
    if (slot < INVENTORY.hotbarSize) this.store.dispatch(actions.selectSlot(slot));
  }

  private cycleTimeScale(state: GameState): void {
    const scales: readonly number[] = TIME.timeScales;
    const index = scales.indexOf(state.ui.timeScale);
    const next = scales[(index + 1) % scales.length];
    if (next !== undefined) this.store.dispatch(actions.setTimeScale(next));
  }

  // -------------------------------------------------------------------------
  // Mouse / pointer
  // -------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0 && !event.ctrlKey) {
      this.capturePointer(event.pointerId);
      this.pressTool(pointerSource(event.pointerId), false, event.shiftKey);
    } else if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      this.store.dispatch(event.shiftKey ? actions.peek() : actions.interact());
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.releaseTool(pointerSource(event.pointerId));
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = this.wheelPixels(event);
    if (delta === 0) return;
    if (event.ctrlKey || event.metaKey) {
      // Ctrl + wheel, and trackpad pinch (reported as Ctrl + wheel): zoom. Down / pinch-in zooms out.
      const clamped = Math.max(-ZOOM.wheelMaxPixels, Math.min(ZOOM.wheelMaxPixels, delta));
      this.rig.zoomBy(Math.exp(clamped * ZOOM.wheelPerPixel));
      return;
    }
    this.stepHotbarByWheel(delta, event.timeStamp);
  };

  /** One hotbar step per WHEEL.stepPixels of scrolling, at most one per WHEEL.stepIntervalMs. */
  private stepHotbarByWheel(delta: number, timeStamp: number): void {
    const sign = Math.sign(delta);
    if (sign !== Math.sign(this.wheelAccumulator)) this.wheelAccumulator = 0;
    this.wheelAccumulator += delta;
    if (Math.abs(this.wheelAccumulator) < WHEEL.stepPixels) return;
    if (timeStamp - this.lastWheelStepAt < WHEEL.stepIntervalMs) {
      // Throttled: hold exactly one pending step, never a backlog.
      this.wheelAccumulator = sign * WHEEL.stepPixels;
      return;
    }
    this.lastWheelStepAt = timeStamp;
    this.wheelAccumulator = 0;
    this.store.dispatch(actions.cycleSlot(sign));
  }

  private wheelPixels(event: WheelEvent): number {
    switch (event.deltaMode) {
      case DELTA_MODE_LINE:
        return event.deltaY * WHEEL.linePixels;
      case DELTA_MODE_PAGE:
        return event.deltaY * (this.canvas.clientHeight > 0 ? this.canvas.clientHeight : WHEEL.pagePixels);
      default:
        return event.deltaY;
    }
  }

  /** Keeps pointer-up coming to us even when the button is released outside the canvas. */
  private capturePointer(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      // The pointer is no longer active (released before we got here); window pointerup still applies.
    }
  }

  // -------------------------------------------------------------------------
  // Focus loss
  // -------------------------------------------------------------------------

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.document.visibilityState === 'hidden') this.releaseAll();
  };

  /** Tracks Shift and reports every change to `onShiftChange`. */
  private setShiftHeld(held: boolean): void {
    if (held === this.shiftHeld) return;
    this.shiftHeld = held;
    this.onShiftChange?.(held);
  }

  private releaseAll(): void {
    this.directionKeys.length = 0;
    this.toolSources.clear();
    this.setShiftHeld(false);
    this.moveElapsed = 0;
    this.toolElapsed = 0;
    this.wheelAccumulator = 0;
  }

  private isFrozen(): boolean {
    return selectIsFrozen(this.store.getState());
  }
}
