/**
 * Heads-up display: the DOM layer drawn over the 3D canvas.
 *
 * Layout (#hud is position: fixed, inset 0, pointer-events: none)
 *   top-left       message toasts (aria-live polite)
 *   top-right      clock panel: date, time, day dial, weather + forecast, gold, shipment, speed
 *   bottom-left    collapsible controls chip above a small performance readout
 *   bottom-centre  context hint ("Space: Till", "E: Harvest") above the 12-slot hotbar
 *   bottom-right   vertical energy bar
 *   overlays       seed shop modal, pause card, day-transition fade
 *
 * Update model
 * - `sync(state, prev)` runs from the store subscription. Each widget compares only the slice it
 *   renders by reference (structural sharing) and writes the DOM only when that slice changed.
 *   `prev === null` means boot or a freshly loaded game: every widget redraws from scratch.
 * - `update(frame)` runs every animation frame but only advances what is actually animating:
 *   the gold count-up, toast lifetimes, the pause-menu confirm timeout, the day-fade fallback
 *   timer and the FPS sampler (which writes the DOM at most four times per second).
 * - The HUD dispatches only from DOM event handlers, never from sync or update. Hotbar and help
 *   buttons blur after every click so Space, Enter and Tab go straight back to the game; buttons
 *   inside the frozen modals blur after mouse clicks but keep focus on keyboard activation, so
 *   Tab navigation through the shop and pause card (which InputController allows) keeps working.
 * - Text is always written with textContent / text nodes; no dynamic HTML is ever parsed.
 */
import './hud.css';
import { TIME } from '../config';
import type { Store } from '../core/store';
import {
  SEASON_NAMES,
  Season,
  type GameMessage,
  type GameState,
  type InventoryState,
  type ItemId,
  type ItemStack,
  type Weather,
} from '../core/types';
import { CROPS, totalGrowDays } from '../farming/crops';
import { getItem, isSeedItemId, type SeedItem } from '../items/items';
import type { FrameContext } from '../render/types';
import { actions, type GameAction } from '../state/actions';
import { describeIntent, planInteraction, planPrimaryAction } from '../state/intents';
import { capacityFor, countItem } from '../state/inventory';
import {
  selectActiveWorld,
  selectForecast,
  selectIsFrozen,
  selectPendingShipmentValue,
  selectSelectedItem,
  selectShopStock,
} from '../state/selectors';
import { dayProgress, formatClock, formatDate } from '../time/clock';
import { weatherLabel } from '../time/weather';
import {
  DayDial,
  createCloseIcon,
  createCoinIcon,
  createCrateIcon,
  createFastForwardIcon,
  createItemIcon,
  createToneIcon,
  createWeatherIcon,
  createWinterIcon,
} from './icons';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface HudOptions {
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
  readonly onNewGame: () => void;
  readonly getRenderStats: () => { readonly calls: number; readonly triangles: number };
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Key labels for hotbar slots 0…11, matching the InputController bindings. */
const SLOT_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const TOAST_LIFETIME_SECONDS = 5;
const TOAST_EXIT_SECONDS = 0.4;
const MAX_VISIBLE_TOASTS = 5;
const GOLD_TWEEN_SECONDS = 0.7;
const PERF_INTERVAL_SECONDS = 0.25;
/** Per-frame weight of the newest frame time in the FPS moving average. */
const FPS_SMOOTHING = 0.08;
const NEW_GAME_CONFIRM_SECONDS = 8;
/** Matches the hud-daywipe animation duration in hud.css (plus a little slack). */
const DAY_WIPE_SECONDS = 1.3;
const LOW_ENERGY_RATIO = 0.2;
const BUY_QUANTITIES: readonly number[] = [1, 5, 10];
const HELP_STORAGE_KEY = 'meadowlight-farm.hud.help-collapsed';
/** Matches the narrow-layout breakpoint in hud.css. */
const NARROW_SCREEN_QUERY = '(max-width: 720px), (max-height: 560px)';

const DAWN_END_MINUTE = 8 * 60;
const DUSK_START_MINUTE = 18 * 60;
const NIGHT_START_MINUTE = 20 * 60;
/** After midnight the clock turns red: pass-out is two hours away. */
const LATE_NIGHT_MINUTE = 24 * 60;

type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

interface ControlRow {
  readonly keys: readonly string[];
  readonly action: string;
  readonly detail?: string;
}

const CONTROL_ROWS: readonly ControlRow[] = [
  { keys: ['W A S D', 'Arrows'], action: 'Move', detail: 'Hold Shift to turn without stepping' },
  { keys: ['Space', 'J', 'Left-click'], action: 'Use tool' },
  {
    keys: ['E', 'K', 'Enter', 'Right-click'],
    action: 'Interact',
    detail: 'Harvest, ship at the bin, sleep at the house door, refill at the pond',
  },
  { keys: ['1–0', '-', '=', 'Tab', 'Wheel'], action: 'Select slot' },
  { keys: ['B'], action: 'Seed shop' },
  { keys: ['Z', 'X', 'Ctrl + wheel'], action: 'Zoom in / out' },
  { keys: ['T'], action: 'Time speed' },
  { keys: ['N'], action: 'Sleep' },
  { keys: ['P', 'Esc'], action: 'Pause' },
];

const HELP_HINTS: readonly (readonly [string, string])[] = [
  ['WASD', 'Walk'],
  ['Space', 'Use tool'],
  ['E', 'Interact'],
  ['1–0', 'Pick slot'],
  ['B', 'Seed shop'],
  ['T', 'Speed up'],
  ['P', 'Pause & all controls'],
];

const numberFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

let hudInstanceCount = 0;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hudButton(className: string, text?: string): HTMLButtonElement {
  const button = h('button', className, text);
  button.type = 'button';
  return button;
}

function kbd(label: string): HTMLElement {
  return h('kbd', 'hud-kbd', label);
}

function iconHost(className: string, icon: SVGSVGElement): HTMLElement {
  const host = h('span', className);
  host.setAttribute('aria-hidden', 'true');
  host.append(icon);
  return host;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function setTitle(node: HTMLElement, title: string): void {
  if (node.title !== title) node.title = title;
}

/**
 * Restarts a CSS animation without forcing a reflow: the stylesheet binds two identical
 * keyframe sets to data-anim="a" / "b", and switching the animation name restarts it.
 */
function restartAnimation(node: HTMLElement): void {
  node.dataset.anim = node.dataset.anim === 'a' ? 'b' : 'a';
}

/**
 * Focus release for buttons inside the frozen modals (shop, pause). A mouse click blurs the
 * button so Space and Enter return to the game once the modal closes; a keyboard activation
 * (click.detail === 0) keeps focus so Tab navigation through the modal is not thrown away.
 * A modal that closes hides its buttons, which drops their focus anyway.
 */
function releasePointerFocus(button: HTMLElement, event: MouseEvent): void {
  if (event.detail !== 0) button.blur();
}

/** The element matching `selector` that contains the event target, if it lies inside root. */
function closestWithin(event: Event, root: HTMLElement, selector: string): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const match = target.closest(selector);
  return match instanceof HTMLElement && root.contains(match) ? match : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function dayPhase(minuteOfDay: number): DayPhase {
  if (minuteOfDay < DAWN_END_MINUTE) return 'dawn';
  if (minuteOfDay < DUSK_START_MINUTE) return 'day';
  if (minuteOfDay < NIGHT_START_MINUTE) return 'dusk';
  return 'night';
}

/**
 * The player's stored choice wins; without one the hints start open on roomy screens and
 * collapsed on narrow ones, where the panel would cover much of the farm.
 */
function readHelpCollapsed(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(HELP_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === '1') return true;
  if (stored === '0') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_SCREEN_QUERY).matches;
}

function writeHelpCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(HELP_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage is unavailable (private mode, blocked cookies): the preference lasts this session only.
  }
}

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

/** Builds each item icon once and hands out clones. */
class ItemIconCache {
  private readonly templates = new Map<ItemId, SVGSVGElement>();

  get(itemId: ItemId): SVGSVGElement {
    let template = this.templates.get(itemId);
    if (template === undefined) {
      template = createItemIcon(getItem(itemId));
      this.templates.set(itemId, template);
    }
    return template.cloneNode(true) as SVGSVGElement;
  }
}

interface HudContext {
  readonly dispatch: (action: GameAction) => void;
  /** Aborted on dispose; every listener the HUD adds is registered with it. */
  readonly signal: AbortSignal;
  readonly icons: ItemIconCache;
  /** Unique prefix for element ids (aria-labelledby). */
  readonly idPrefix: string;
}

// ---------------------------------------------------------------------------
// Clock panel
// ---------------------------------------------------------------------------

class WeatherBadge {
  readonly element: HTMLElement;
  private readonly icon = h('span', 'hud-weather__icon');
  private readonly label = h('span', 'hud-weather__label');
  private readonly prefix: string;
  private shown: Weather | null = null;

  constructor(className: string, prefix: string, caption: string | null) {
    this.prefix = prefix;
    this.element = h('span', `hud-weather ${className}`);
    this.icon.setAttribute('aria-hidden', 'true');
    if (caption !== null) this.element.append(h('span', 'hud-weather__caption', caption));
    this.element.append(this.icon, this.label);
  }

  set(weather: Weather): void {
    if (weather === this.shown) return;
    this.shown = weather;
    const label = weatherLabel(weather);
    this.icon.replaceChildren(createWeatherIcon(weather));
    setText(this.label, label);
    this.element.title = `${this.prefix}: ${label}`;
    this.element.dataset.weather = weather;
  }
}

/** Gold total that counts smoothly toward its target and floats a +/- delta. */
class GoldCounter {
  readonly element = h('div', 'hud-gold');
  private readonly value = h('span', 'hud-gold__value');
  private readonly delta = h('span', 'hud-gold__delta');
  private from = 0;
  private target = 0;
  private shown = 0;
  /** Tween progress; 1 = idle. */
  private t = 1;

  constructor() {
    this.element.title = 'Gold';
    this.delta.setAttribute('aria-hidden', 'true');
    this.element.append(iconHost('hud-gold__coin', createCoinIcon()), this.value, h('span', 'hud-gold__unit', 'g'), this.delta);
  }

  set(gold: number, instant: boolean): void {
    if (instant) {
      this.from = gold;
      this.target = gold;
      this.shown = gold;
      this.t = 1;
      this.render(gold);
      return;
    }
    const change = gold - this.target;
    if (change === 0) return;
    this.from = this.shown;
    this.target = gold;
    this.t = 0;
    this.delta.textContent = `${change > 0 ? '+' : '−'}${numberFormat.format(Math.abs(change))}g`;
    this.element.classList.toggle('is-gain', change > 0);
    this.element.classList.toggle('is-loss', change < 0);
    restartAnimation(this.element);
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / GOLD_TWEEN_SECONDS);
    const eased = 1 - (1 - this.t) ** 3;
    this.shown = this.from + (this.target - this.from) * eased;
    this.render(this.t >= 1 ? this.target : Math.round(this.shown));
  }

  private render(gold: number): void {
    setText(this.value, numberFormat.format(gold));
  }
}

class ClockPanel {
  readonly element = h('section', 'hud-panel hud-clock');
  private readonly date = h('div', 'hud-clock__date');
  private readonly time = h('div', 'hud-clock__time');
  private readonly speed = h('span', 'hud-clock__speed');
  private readonly speedText = h('span', 'hud-clock__speed-text');
  private readonly dial = new DayDial();
  private readonly today = new WeatherBadge('hud-weather--today', 'Today', null);
  private readonly tomorrow = new WeatherBadge('hud-weather--tomorrow', 'Tomorrow', 'Tomorrow');
  private readonly gold = new GoldCounter();
  private readonly pending = h('div', 'hud-clock__pending');
  private readonly pendingValue = h('strong', 'hud-clock__pending-value');

  constructor() {
    this.element.setAttribute('aria-label', 'Date, time and gold');

    const main = h('div', 'hud-clock__main');
    this.dial.element.setAttribute('aria-hidden', 'true');
    this.speed.hidden = true;
    this.speed.append(iconHost('hud-clock__speed-icon', createFastForwardIcon()), this.speedText);
    main.append(this.dial.element, this.time, this.speed);

    const weather = h('div', 'hud-clock__weather');
    weather.append(this.today.element, this.tomorrow.element);

    this.pending.hidden = true;
    this.pending.title = 'Shipping bin contents are paid out tomorrow morning';
    this.pending.append(
      iconHost('hud-clock__pending-icon', createCrateIcon()),
      h('span', '', 'Shipping '),
      this.pendingValue,
      h('span', '', ' tomorrow'),
    );

    const money = h('div', 'hud-clock__money');
    money.append(this.gold.element, this.pending);

    this.element.append(this.date, main, weather, money);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null || state.time !== prev.time) this.syncTime(state);
    if (
      prev === null ||
      state.weather !== prev.weather ||
      state.seed !== prev.seed ||
      state.time.absoluteDay !== prev.time.absoluteDay
    ) {
      this.today.set(state.weather);
      this.tomorrow.set(selectForecast(state));
    }
    if (prev === null || state.ui.timeScale !== prev.ui.timeScale) this.syncSpeed(state.ui.timeScale);
    if (prev === null || state.shipping !== prev.shipping) this.syncPending(selectPendingShipmentValue(state));
    if (prev === null || state.player.gold !== prev.player.gold) this.gold.set(state.player.gold, prev === null);
  }

  update(dt: number): void {
    this.gold.update(dt);
  }

  private syncTime(state: GameState): void {
    const minute = state.time.minuteOfDay;
    setText(this.date, formatDate(state.time));
    setText(this.time, formatClock(minute));
    this.dial.update(dayProgress(minute), minute >= NIGHT_START_MINUTE);
    this.element.classList.toggle('is-late', minute >= LATE_NIGHT_MINUTE);
  }

  private syncSpeed(timeScale: number): void {
    const fast = timeScale > 1;
    setHidden(this.speed, !fast);
    if (!fast) return;
    setText(this.speedText, `×${timeScale}`);
    this.speed.title = `Time runs ${timeScale}× faster (T to change)`;
  }

  private syncPending(value: number): void {
    setHidden(this.pending, value <= 0);
    if (value > 0) setText(this.pendingValue, `+${numberFormat.format(value)}g`);
  }
}

// ---------------------------------------------------------------------------
// Energy bar
// ---------------------------------------------------------------------------

class EnergyBar {
  readonly element = h('div', 'hud-energy');
  private readonly tip = h('div', 'hud-energy__tip');

  constructor() {
    this.element.setAttribute('role', 'meter');
    this.element.setAttribute('aria-label', 'Energy');
    this.element.setAttribute('aria-valuemin', '0');
    this.tip.setAttribute('aria-hidden', 'true');
    const label = h('div', 'hud-energy__label', 'E');
    label.setAttribute('aria-hidden', 'true');
    const track = h('div', 'hud-energy__track');
    track.append(h('div', 'hud-energy__fill'));
    this.element.append(this.tip, label, track);
  }

  sync(state: GameState, prev: GameState | null): void {
    const { energy, maxEnergy } = state.player;
    if (prev !== null && energy === prev.player.energy && maxEnergy === prev.player.maxEnergy) return;
    const ratio = maxEnergy > 0 ? clamp01(energy / maxEnergy) : 0;
    const text = `Energy ${energy} / ${maxEnergy}`;
    this.element.style.setProperty('--hud-energy-ratio', ratio.toFixed(4));
    this.element.setAttribute('aria-valuemax', String(maxEnergy));
    this.element.setAttribute('aria-valuenow', String(energy));
    this.element.setAttribute('aria-valuetext', text);
    this.tip.textContent = text;
    this.element.classList.toggle('is-low', ratio <= LOW_ENERGY_RATIO);
  }
}

// ---------------------------------------------------------------------------
// Hotbar
// ---------------------------------------------------------------------------

interface SlotView {
  readonly button: HTMLButtonElement;
  readonly icon: HTMLElement;
  readonly quantity: HTMLElement;
  readonly water: HTMLElement;
  readonly keyLabel: string;
  itemId: ItemId | null;
}

function slotTitle(stack: ItemStack | null, keyLabel: string, inventory: InventoryState): string {
  if (stack === null) return `Empty slot · key ${keyLabel}`;
  const item = getItem(stack.itemId);
  const lines = [stack.quantity > 1 ? `${item.name} ×${stack.quantity}` : item.name, item.description];
  if (item.kind === 'tool') {
    if (item.tool === 'wateringCan') lines.push(`Water: ${inventory.water} / ${inventory.waterCapacity}`);
    if (item.energyCost > 0) lines.push(`Uses ${item.energyCost} energy`);
  } else if (item.sellPrice !== null) {
    lines.push(`Ships for ${item.sellPrice}g each`);
  }
  lines.push(`Key ${keyLabel}`);
  return lines.join('\n');
}

class Hotbar {
  readonly element = h('div', 'hud-hotbar');
  private readonly views: SlotView[] = [];
  private readonly icons: ItemIconCache;
  private selected = -1;
  private water = -1;
  private waterCapacity = -1;

  constructor(context: HudContext) {
    this.icons = context.icons;
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Hotbar');
    this.element.addEventListener(
      'click',
      (event) => {
        const slot = closestWithin(event, this.element, '.hud-slot');
        if (slot === null) return;
        const index = Number(slot.dataset.slot);
        if (Number.isInteger(index)) context.dispatch(actions.selectSlot(index));
        slot.blur();
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const inventory = state.inventory;
    const previous = prev === null ? null : prev.inventory;
    const rebuild = previous === null || inventory.slots.length !== this.views.length;
    if (rebuild) this.build(inventory.slots.length);
    else if (inventory === previous) return;

    const waterChanged = inventory.water !== this.water || inventory.waterCapacity !== this.waterCapacity;
    this.water = inventory.water;
    this.waterCapacity = inventory.waterCapacity;

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      if (view === undefined) continue;
      const stack = inventory.slots[i] ?? null;
      const stackChanged = rebuild || previous === null || stack !== (previous.slots[i] ?? null);
      const canNeedsWater = waterChanged && stack !== null && stack.itemId === 'wateringCan';
      if (stackChanged || canNeedsWater) this.renderSlot(view, stack, inventory);
    }
    if (rebuild || previous === null || inventory.selected !== previous.selected) this.select(inventory.selected);
  }

  private build(count: number): void {
    this.views.length = 0;
    this.selected = -1;
    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < count; i++) {
      const keyLabel = SLOT_KEYS[i] ?? '';
      const button = hudButton('hud-slot is-empty');
      button.dataset.slot = String(i);
      button.setAttribute('aria-pressed', 'false');
      const icon = h('span', 'hud-slot__icon');
      icon.setAttribute('aria-hidden', 'true');
      const water = h('span', 'hud-slot__water');
      water.hidden = true;
      water.setAttribute('aria-hidden', 'true');
      water.append(h('span', 'hud-slot__water-fill'));
      const quantity = h('span', 'hud-slot__qty');
      quantity.hidden = true;
      quantity.setAttribute('aria-hidden', 'true');
      const key = h('span', 'hud-slot__key', keyLabel);
      key.setAttribute('aria-hidden', 'true');
      button.append(icon, water, quantity, key);
      buttons.push(button);
      this.views.push({ button, icon, quantity, water, keyLabel, itemId: null });
    }
    this.element.replaceChildren(...buttons);
  }

  private renderSlot(view: SlotView, stack: ItemStack | null, inventory: InventoryState): void {
    const itemId = stack === null ? null : stack.itemId;
    if (itemId !== view.itemId) {
      view.itemId = itemId;
      if (itemId === null) view.icon.replaceChildren();
      else view.icon.replaceChildren(this.icons.get(itemId));
      view.button.classList.toggle('is-empty', itemId === null);
    }

    const quantity = stack === null ? 0 : stack.quantity;
    setHidden(view.quantity, quantity <= 1);
    if (quantity > 1) setText(view.quantity, String(quantity));

    const isCan = itemId === 'wateringCan';
    setHidden(view.water, !isCan);
    if (isCan) {
      const ratio = inventory.waterCapacity > 0 ? clamp01(inventory.water / inventory.waterCapacity) : 0;
      view.button.style.setProperty('--hud-water-level', ratio.toFixed(3));
      view.water.classList.toggle('is-empty', inventory.water <= 0);
    }

    setTitle(view.button, slotTitle(stack, view.keyLabel, inventory));
    const label =
      stack === null
        ? `Slot ${view.keyLabel}: empty`
        : `Slot ${view.keyLabel}: ${getItem(stack.itemId).name}${stack.quantity > 1 ? `, ${stack.quantity}` : ''}`;
    view.button.setAttribute('aria-label', label);
  }

  private select(index: number): void {
    if (index === this.selected) return;
    const previous = this.views[this.selected];
    if (previous !== undefined) {
      previous.button.classList.remove('is-selected');
      previous.button.setAttribute('aria-pressed', 'false');
    }
    const next = this.views[index];
    if (next !== undefined) {
      next.button.classList.add('is-selected');
      next.button.setAttribute('aria-pressed', 'true');
    }
    this.selected = index;
  }
}

// ---------------------------------------------------------------------------
// Context hint
// ---------------------------------------------------------------------------

class ContextHint {
  readonly element = h('div', 'hud-hint');
  private readonly item = h('span', 'hud-chip hud-hint__item');
  private readonly primary = h('span', 'hud-chip hud-hint__action');
  private readonly primaryAlt = h('span', 'hud-hint__alt');
  private readonly primaryVerb = h('span', 'hud-hint__verb');
  private readonly interact = h('span', 'hud-chip hud-hint__action');
  private readonly interactVerb = h('span', 'hud-hint__verb');

  constructor() {
    this.primaryAlt.append(h('span', 'hud-hint__sep', '/'), kbd('E'));
    this.primaryAlt.hidden = true;
    this.primary.append(kbd('Space'), this.primaryAlt, this.primaryVerb);
    this.interact.append(kbd('E'), this.interactVerb);
    this.primary.hidden = true;
    this.interact.hidden = true;
    this.element.append(this.item, this.primary, this.interact);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (
      prev !== null &&
      state.player === prev.player &&
      selectActiveWorld(state) === selectActiveWorld(prev) &&
      state.inventory === prev.inventory &&
      state.ui === prev.ui &&
      state.time.season === prev.time.season
    ) {
      return;
    }
    const frozen = selectIsFrozen(state);
    setHidden(this.element, frozen);
    if (frozen) return;

    const primary = describeIntent(planPrimaryAction(state).intent);
    const interact = describeIntent(planInteraction(state).intent);
    const merged = primary !== null && primary === interact;

    setHidden(this.primary, primary === null);
    setHidden(this.primaryAlt, !merged);
    if (primary !== null) setText(this.primaryVerb, primary);
    setHidden(this.interact, interact === null || merged);
    if (interact !== null) setText(this.interactVerb, interact);

    const item = selectSelectedItem(state);
    setText(this.item, item === null ? 'Empty hands' : item.name);
    this.item.classList.toggle('is-empty', item === null);
  }
}

// ---------------------------------------------------------------------------
// Message toasts
// ---------------------------------------------------------------------------

interface ToastView {
  readonly element: HTMLElement;
  age: number;
  /** Age at which the exit transition started; -1 while still showing. */
  leftAt: number;
}

class ToastStack {
  readonly element = h('div', 'hud-toasts');
  private readonly toasts: ToastView[] = [];
  private lastShownId = -1;

  constructor() {
    this.element.setAttribute('role', 'log');
    this.element.setAttribute('aria-live', 'polite');
    this.element.setAttribute('aria-relevant', 'additions');
    this.element.setAttribute('aria-label', 'Messages');
  }

  sync(state: GameState, prev: GameState | null): void {
    const { messages } = state;
    if (prev === null) {
      this.clear();
      const brandNew = state.time.absoluteDay === 0 && state.time.minuteOfDay === TIME.dayStartMinute;
      if (brandNew) {
        for (const entry of messages.entries) {
          if (entry.day === 0 && entry.minute === TIME.dayStartMinute) this.show(entry);
        }
      }
      this.lastShownId = messages.nextId - 1;
      for (const entry of messages.entries) this.lastShownId = Math.max(this.lastShownId, entry.id);
      return;
    }
    if (messages === prev.messages) return;
    for (const entry of messages.entries) {
      if (entry.id <= this.lastShownId) continue;
      this.show(entry);
      this.lastShownId = entry.id;
    }
  }

  update(dt: number): void {
    if (this.toasts.length === 0) return;
    let kept = 0;
    for (let i = 0; i < this.toasts.length; i++) {
      const toast = this.toasts[i];
      if (toast === undefined) continue;
      toast.age += dt;
      if (toast.leftAt < 0 && toast.age >= TOAST_LIFETIME_SECONDS) this.beginExit(toast);
      if (toast.leftAt >= 0 && toast.age >= toast.leftAt + TOAST_EXIT_SECONDS) {
        toast.element.remove();
        continue;
      }
      this.toasts[kept++] = toast;
    }
    this.toasts.length = kept;
  }

  private show(entry: GameMessage): void {
    const toast = h('div', `hud-toast hud-toast--${entry.tone}`);
    const clip = h('div', 'hud-toast__clip');
    const card = h('div', 'hud-toast__card');
    card.append(iconHost('hud-toast__icon', createToneIcon(entry.tone)), h('span', 'hud-toast__text', entry.text));
    clip.append(card);
    toast.append(clip);
    this.element.append(toast);
    this.toasts.push({ element: toast, age: 0, leftAt: -1 });
    this.enforceLimit();
  }

  private enforceLimit(): void {
    let visible = 0;
    for (const toast of this.toasts) if (toast.leftAt < 0) visible++;
    for (const toast of this.toasts) {
      if (visible <= MAX_VISIBLE_TOASTS) break;
      if (toast.leftAt >= 0) continue;
      this.beginExit(toast);
      visible--;
    }
  }

  private beginExit(toast: ToastView): void {
    toast.leftAt = toast.age;
    toast.element.classList.add('is-leaving');
  }

  private clear(): void {
    for (const toast of this.toasts) toast.element.remove();
    this.toasts.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Seed shop
// ---------------------------------------------------------------------------

interface BuyButton {
  readonly button: HTMLButtonElement;
  readonly quantity: number;
}

interface ShopRow {
  readonly element: HTMLElement;
  readonly item: SeedItem;
  readonly buttons: readonly BuyButton[];
  readonly owned: HTMLElement;
}

function metaTag(text: string, modifier = ''): HTMLElement {
  return h('span', modifier === '' ? 'hud-tag' : `hud-tag ${modifier}`, text);
}

class ShopModal {
  readonly element = h('div', 'hud-modal hud-shop');
  private readonly list = h('ul', 'hud-shop__list');
  private readonly empty = h('div', 'hud-shop__empty');
  private readonly emptyTitle = h('h3', 'hud-shop__empty-title');
  private readonly emptyText = h('p', 'hud-shop__empty-text');
  private readonly season = h('p', 'hud-modal__subtitle');
  private readonly goldValue = h('span', 'hud-shop__gold-value');
  private readonly icons: ItemIconCache;
  private rows: ShopRow[] = [];

  constructor(context: HudContext) {
    this.icons = context.icons;
    const titleId = `${context.idPrefix}-shop-title`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-shop__card');

    const header = h('header', 'hud-modal__header');
    const heading = h('div', 'hud-modal__heading');
    const title = h('h2', 'hud-modal__title', 'Seed Shop');
    title.id = titleId;
    heading.append(title, this.season);
    const gold = h('div', 'hud-shop__gold');
    gold.title = 'Your gold';
    gold.append(iconHost('hud-shop__gold-coin', createCoinIcon()), this.goldValue, h('span', 'hud-shop__gold-unit', 'g'));
    const close = hudButton('hud-iconbtn hud-modal__close');
    close.setAttribute('aria-label', 'Close the seed shop');
    close.title = 'Close (B / Esc)';
    close.append(createCloseIcon());
    header.append(heading, gold, close);

    this.empty.hidden = true;
    this.empty.append(iconHost('hud-shop__empty-art', createWinterIcon()), this.emptyTitle, this.emptyText);

    const footer = h('p', 'hud-shop__footer', 'Seeds only grow in their season, and only on days they are watered.');

    card.append(header, this.list, this.empty, footer);
    this.element.append(backdrop, card);

    const closeShop = (event: MouseEvent): void => {
      releasePointerFocus(close, event);
      context.dispatch(actions.setShopOpen(false));
    };
    close.addEventListener('click', closeShop, { signal: context.signal });
    backdrop.addEventListener('click', closeShop, { signal: context.signal });
    this.list.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, this.list, 'button[data-item]');
        if (!(button instanceof HTMLButtonElement)) return;
        releasePointerFocus(button, event);
        if (button.disabled) return;
        const itemId = button.dataset.item;
        const quantity = Number(button.dataset.qty);
        if (isSeedItemId(itemId) && Number.isInteger(quantity) && quantity > 0) {
          context.dispatch(actions.buy(itemId, quantity));
        }
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const open = state.ui.shopOpen;
    setHidden(this.element, !open);
    if (!open) return;
    if (prev === null || !prev.ui.shopOpen || state.time.season !== prev.time.season) {
      this.buildStock(state);
      this.syncAvailability(state);
      return;
    }
    if (state.player.gold !== prev.player.gold || state.inventory !== prev.inventory) this.syncAvailability(state);
  }

  private buildStock(state: GameState): void {
    const season = state.time.season;
    const stock = selectShopStock(state);
    setText(this.season, `${SEASON_NAMES[season]} seeds`);
    this.rows = stock.map((item) => this.createRow(item));
    this.list.replaceChildren(...this.rows.map((row) => row.element));
    setHidden(this.list, stock.length === 0);
    setHidden(this.empty, stock.length > 0);
    if (stock.length === 0) {
      if (season === Season.Winter) {
        setText(this.emptyTitle, 'Nothing to plant in winter');
        setText(
          this.emptyText,
          'The soil is resting under the snow. Clear rocks and stumps, plan your beds, and come back when Spring arrives!',
        );
      } else {
        setText(this.emptyTitle, 'Sold out for now');
        setText(this.emptyText, 'Fresh seeds arrive with the next season.');
      }
    }
  }

  private createRow(item: SeedItem): ShopRow {
    const crop = CROPS[item.cropId];
    const element = h('li', 'hud-shop__item');

    const info = h('div', 'hud-shop__info');
    const nameRow = h('div', 'hud-shop__name-row');
    nameRow.append(h('span', 'hud-shop__name', item.name), h('span', 'hud-shop__price', `${item.price}g`));

    const growDays = totalGrowDays(crop);
    const meta = h('div', 'hud-shop__meta');
    meta.append(
      metaTag(`${growDays} ${growDays === 1 ? 'day' : 'days'} to grow`),
      crop.regrowDays === null
        ? metaTag('Single harvest')
        : metaTag(`Regrows every ${crop.regrowDays} ${crop.regrowDays === 1 ? 'day' : 'days'}`, 'is-regrow'),
      metaTag(`Sells ${crop.sellPrice}g`, 'is-sell'),
    );
    if (crop.seasons.length > 1) {
      meta.append(metaTag(`Grows in ${crop.seasons.map((season) => SEASON_NAMES[season]).join(' & ')}`, 'is-season'));
    }
    const owned = h('span', 'hud-shop__owned');
    owned.hidden = true;
    info.append(nameRow, meta, owned);

    const buy = h('div', 'hud-shop__buy');
    const buttons = BUY_QUANTITIES.map((quantity): BuyButton => {
      const button = hudButton('hud-btn hud-btn--buy', `×${quantity}`);
      button.dataset.item = item.id;
      button.dataset.qty = String(quantity);
      button.setAttribute('aria-label', `Buy ${quantity} ${item.name} for ${item.price * quantity}g`);
      buy.append(button);
      return { button, quantity };
    });

    element.append(iconHost('hud-shop__icon', this.icons.get(item.id)), info, buy);
    return { element, item, buttons, owned };
  }

  private syncAvailability(state: GameState): void {
    const gold = state.player.gold;
    setText(this.goldValue, numberFormat.format(gold));
    for (const row of this.rows) {
      const inBag = countItem(state.inventory, row.item.id);
      setHidden(row.owned, inBag === 0);
      if (inBag > 0) setText(row.owned, `In your bag: ${inBag}`);
      const room = capacityFor(state.inventory, row.item.id);
      for (const { button, quantity } of row.buttons) {
        const cost = row.item.price * quantity;
        const affordable = cost <= gold;
        const fits = quantity <= room;
        const disabled = !affordable || !fits;
        if (button.disabled !== disabled) button.disabled = disabled;
        const title = !affordable
          ? `Costs ${numberFormat.format(cost)}g, you have ${numberFormat.format(gold)}g`
          : !fits
            ? 'Not enough room in your bag'
            : `Buy ${quantity} for ${numberFormat.format(cost)}g`;
        setTitle(button, title);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pause overlay
// ---------------------------------------------------------------------------

function buildControlsList(): HTMLElement {
  const list = h('ul', 'hud-controls');
  for (const row of CONTROL_ROWS) {
    const item = h('li', 'hud-controls__row');
    const keys = h('span', 'hud-controls__keys');
    row.keys.forEach((key, index) => {
      if (index > 0) keys.append(h('span', 'hud-controls__sep', '/'));
      keys.append(kbd(key));
    });
    const action = h('span', 'hud-controls__action');
    action.append(h('strong', '', row.action));
    if (row.detail !== undefined) action.append(h('small', 'hud-controls__detail', row.detail));
    item.append(keys, action);
    list.append(item);
  }
  return list;
}

class PauseOverlay {
  readonly element = h('div', 'hud-modal hud-pause');
  private readonly subtitle = h('p', 'hud-modal__subtitle');
  private readonly newFarm = hudButton('hud-btn hud-btn--soft', 'New Farm');
  private readonly cancel = hudButton('hud-btn hud-btn--ghost', 'Keep my farm');
  private readonly warning = h(
    'p',
    'hud-pause__warning',
    'Starting over replaces this farm, its crops and your gold. Click “Yes, start over” to confirm.',
  );
  private confirming = false;
  private confirmTimer = 0;

  constructor(context: HudContext, onNewGame: () => void) {
    const titleId = `${context.idPrefix}-pause-title`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-pause__card');

    const header = h('header', 'hud-modal__header hud-pause__header');
    const heading = h('div', 'hud-modal__heading');
    const title = h('h2', 'hud-modal__title', 'Paused');
    title.id = titleId;
    heading.append(title, this.subtitle);
    header.append(heading);

    const resume = hudButton('hud-btn hud-btn--primary', 'Resume');
    resume.title = 'Resume (P / Esc)';
    this.cancel.hidden = true;
    this.warning.hidden = true;
    const buttons = h('div', 'hud-pause__actions');
    buttons.append(resume, this.newFarm, this.cancel);

    const controlsTitle = h('h3', 'hud-pause__section', 'Controls');
    card.append(header, buttons, this.warning, controlsTitle, buildControlsList());
    this.element.append(backdrop, card);

    const signal = context.signal;
    resume.addEventListener(
      'click',
      (event) => {
        releasePointerFocus(resume, event);
        context.dispatch(actions.setPaused(false));
      },
      { signal },
    );
    this.newFarm.addEventListener(
      'click',
      (event) => {
        releasePointerFocus(this.newFarm, event);
        if (!this.confirming) {
          this.setConfirming(true);
          return;
        }
        this.setConfirming(false);
        onNewGame();
      },
      { signal },
    );
    this.cancel.addEventListener(
      'click',
      (event) => {
        // The cancel button hides itself, so hand keyboard focus back to New Farm first.
        if (event.detail === 0) this.newFarm.focus();
        else this.cancel.blur();
        this.setConfirming(false);
      },
      { signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    const paused = state.ui.paused;
    setHidden(this.element, !paused);
    if (!paused) {
      if (this.confirming) this.setConfirming(false);
      return;
    }
    if (prev === null || !prev.ui.paused || state.time !== prev.time) {
      setText(this.subtitle, `${formatDate(state.time)} · ${formatClock(state.time.minuteOfDay)}`);
    }
  }

  update(dt: number): void {
    if (!this.confirming) return;
    this.confirmTimer -= dt;
    if (this.confirmTimer <= 0) this.setConfirming(false);
  }

  private setConfirming(confirming: boolean): void {
    this.confirming = confirming;
    this.confirmTimer = confirming ? NEW_GAME_CONFIRM_SECONDS : 0;
    this.newFarm.textContent = confirming ? 'Yes, start over' : 'New Farm';
    this.newFarm.classList.toggle('hud-btn--danger', confirming);
    this.newFarm.classList.toggle('hud-btn--soft', !confirming);
    setHidden(this.cancel, !confirming);
    setHidden(this.warning, !confirming);
  }
}

// ---------------------------------------------------------------------------
// Day transition
// ---------------------------------------------------------------------------

class DayTransition {
  readonly element = h('div', 'hud-daywipe');
  private readonly eyebrow = h('div', 'hud-daywipe__eyebrow');
  private readonly date = h('div', 'hud-daywipe__date');
  private readonly weather = h('div', 'hud-daywipe__weather');
  private readonly weatherIcon = h('span', 'hud-daywipe__weather-icon');
  private readonly weatherText = h('span', '');
  private remaining = 0;

  constructor(context: HudContext) {
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.weather.append(this.weatherIcon, this.weatherText);
    const content = h('div', 'hud-daywipe__content');
    content.append(this.eyebrow, this.date, this.weather);
    this.element.append(content);
    this.element.addEventListener(
      'animationend',
      (event) => {
        if (event.target === this.element) this.finish();
      },
      { signal: context.signal },
    );
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null) {
      this.finish();
      return;
    }
    if (state.time.absoluteDay !== prev.time.absoluteDay) this.play(state);
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.finish();
  }

  private play(state: GameState): void {
    setText(this.eyebrow, `Day ${state.time.absoluteDay + 1}`);
    setText(this.date, formatDate(state.time));
    this.weatherIcon.replaceChildren(createWeatherIcon(state.weather));
    setText(this.weatherText, weatherLabel(state.weather));
    setHidden(this.element, false);
    restartAnimation(this.element);
    this.remaining = DAY_WIPE_SECONDS;
  }

  private finish(): void {
    this.remaining = 0;
    setHidden(this.element, true);
  }
}

// ---------------------------------------------------------------------------
// Performance readout and help chip
// ---------------------------------------------------------------------------

class PerfReadout {
  readonly element = h('div', 'hud-perf');
  private readonly fps = h('span', 'hud-perf__value');
  private readonly calls = h('span', 'hud-perf__value');
  private readonly triangles = h('span', 'hud-perf__value');
  private readonly getStats: HudOptions['getRenderStats'];
  private averageDt = 1 / 60;
  private sinceWrite = PERF_INTERVAL_SECONDS;

  constructor(getStats: HudOptions['getRenderStats']) {
    this.getStats = getStats;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.title = 'Frames per second · draw calls · triangles (last frame)';
    this.element.append(
      this.fps,
      h('span', 'hud-perf__unit', ' fps · '),
      this.calls,
      h('span', 'hud-perf__unit', ' calls · '),
      this.triangles,
      h('span', 'hud-perf__unit', ' tris'),
    );
  }

  update(dt: number): void {
    if (dt > 0) this.averageDt += (dt - this.averageDt) * FPS_SMOOTHING;
    this.sinceWrite += dt;
    if (this.sinceWrite < PERF_INTERVAL_SECONDS) return;
    this.sinceWrite = 0;
    const stats = this.getStats();
    setText(this.fps, String(Math.round(1 / Math.max(1e-3, this.averageDt))));
    setText(this.calls, String(stats.calls));
    setText(this.triangles, compactFormat.format(stats.triangles));
  }
}

class HelpChip {
  readonly element = h('div', 'hud-help');
  private readonly toggle = hudButton('hud-chip hud-help__toggle');
  private readonly panel = h('ul', 'hud-panel hud-help__panel');
  private collapsed: boolean;

  constructor(context: HudContext) {
    const panelId = `${context.idPrefix}-help`;
    this.panel.id = panelId;
    for (const [key, action] of HELP_HINTS) {
      const item = h('li', 'hud-help__row');
      item.append(kbd(key), h('span', 'hud-help__action', action));
      this.panel.append(item);
    }
    const badge = h('span', 'hud-help__badge', '?');
    badge.setAttribute('aria-hidden', 'true');
    this.toggle.append(badge, h('span', 'hud-help__label', 'Controls'), h('span', 'hud-help__chevron'));
    this.toggle.setAttribute('aria-controls', panelId);
    this.element.append(this.toggle, this.panel);

    this.collapsed = readHelpCollapsed();
    this.apply();
    this.toggle.addEventListener(
      'click',
      () => {
        this.toggle.blur();
        this.collapsed = !this.collapsed;
        this.apply();
        writeHelpCollapsed(this.collapsed);
      },
      { signal: context.signal },
    );
  }

  private apply(): void {
    setHidden(this.panel, this.collapsed);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    this.toggle.title = this.collapsed ? 'Show control hints' : 'Hide control hints';
    this.element.classList.toggle('is-collapsed', this.collapsed);
  }
}

// ---------------------------------------------------------------------------
// Hud
// ---------------------------------------------------------------------------

export class Hud {
  private readonly abort = new AbortController();
  private readonly container = h('div', 'hud');
  private readonly clock: ClockPanel;
  private readonly energy: EnergyBar;
  private readonly hotbar: Hotbar;
  private readonly hint: ContextHint;
  private readonly toasts: ToastStack;
  private readonly shop: ShopModal;
  private readonly pause: PauseOverlay;
  private readonly dayTransition: DayTransition;
  private readonly perf: PerfReadout;
  private readonly help: HelpChip;
  private phase: DayPhase | null = null;
  private frozen: boolean | null = null;

  constructor(options: HudOptions) {
    hudInstanceCount += 1;
    const store = options.store;
    const context: HudContext = {
      dispatch: (action) => {
        store.dispatch(action);
      },
      signal: this.abort.signal,
      icons: new ItemIconCache(),
      idPrefix: `hud${hudInstanceCount}`,
    };

    this.clock = new ClockPanel();
    this.energy = new EnergyBar();
    this.hotbar = new Hotbar(context);
    this.hint = new ContextHint();
    this.toasts = new ToastStack();
    this.shop = new ShopModal(context);
    this.pause = new PauseOverlay(context, options.onNewGame);
    this.dayTransition = new DayTransition(context);
    this.perf = new PerfReadout(options.getRenderStats);
    this.help = new HelpChip(context);

    const top = h('div', 'hud-top');
    top.append(this.toasts.element, this.clock.element);

    const left = h('div', 'hud-left');
    left.append(this.help.element, this.perf.element);
    const center = h('div', 'hud-center');
    center.append(this.hint.element, this.hotbar.element);
    const right = h('div', 'hud-right');
    right.append(this.energy.element);
    const bottom = h('div', 'hud-bottom');
    bottom.append(left, center, right);

    this.container.append(top, bottom, this.shop.element, this.pause.element, this.dayTransition.element);
    this.container.addEventListener('contextmenu', (event) => event.preventDefault(), { signal: this.abort.signal });
    options.root.append(this.container);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null || state.time.minuteOfDay !== prev.time.minuteOfDay) this.syncPhase(state.time.minuteOfDay);
    if (prev === null || state.ui !== prev.ui) this.syncFrozen(selectIsFrozen(state));
    this.clock.sync(state, prev);
    this.energy.sync(state, prev);
    this.hotbar.sync(state, prev);
    this.hint.sync(state, prev);
    this.toasts.sync(state, prev);
    this.shop.sync(state, prev);
    this.pause.sync(state, prev);
    this.dayTransition.sync(state, prev);
  }

  update(frame: FrameContext): void {
    const dt = frame.dt;
    this.clock.update(dt);
    this.toasts.update(dt);
    this.pause.update(dt);
    this.dayTransition.update(dt);
    this.perf.update(dt);
  }

  dispose(): void {
    this.abort.abort();
    this.container.remove();
  }

  private syncPhase(minuteOfDay: number): void {
    const phase = dayPhase(minuteOfDay);
    if (phase === this.phase) return;
    this.phase = phase;
    this.container.dataset.phase = phase;
  }

  private syncFrozen(frozen: boolean): void {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    this.container.classList.toggle('is-frozen', frozen);
  }
}
