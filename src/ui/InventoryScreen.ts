/**
 * The backpack screen (I) and the chest screen (interacting with a chest): a modal with the
 * open chest's 36 slots (3 × 12, chest panels only) above the player's 36 (the hotbar row 0–11
 * with its key labels, a dashed rule, then the backpack 12–35).
 *
 * Moving items (rules in heldStack.ts)
 * - Left click picks up a whole stack or puts everything held down; right click picks up half or
 *   puts down one. The screen only remembers `{ref, quantity}`: the units stay in their slot
 *   (shown dimmed with what would remain) until a click dispatches `inventory/move`.
 * - A cursor ghost with the held icon and count follows the pointer.
 * - Right click arrives as `contextmenu` on the screen root (default prevented); `pointerdown`
 *   for button 2 is ignored, so each right click acts exactly once. A `contextmenu` acts only
 *   when its gesture (pointerdown or keydown) began on the screen (rightClickGate.ts), so the right
 *   click (or macOS Ctrl + click) on the canvas that opens a chest does not also act on a slot.
 *   Left click uses `click`, so Enter and Space on a focused slot pick up and place too.
 * - Slots at or past `unlockedSlots` are locked: dimmed, hatched and `aria-disabled`.
 *
 * Update model
 * - `sync(state, prev)` re-renders only the slots whose stack reference changed (plus the watering
 *   can when its water changes, and the held slots when the held stack changes). The chest comes
 *   from `selectOpenChest(state)`. A held stack is dropped or clamped when its source changes.
 * - Every listener is registered with the HUD's AbortSignal.
 */
import './inventory.css';
import { INVENTORY } from '../config';
import type { GameState, InventoryState, ItemStack, SlotRef } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { selectOpenChest } from '../state/selectors';
import { closestWithin, h, hudButton, releasePointerFocus, setAttr, setHidden, setText, setTitle } from './dom';
import {
  leftClickSlot,
  reconcileHeld,
  rightClickSlot,
  sameSlotRef,
  stackAtRef,
  type HeldStack,
  type SlotClickResult,
} from './heldStack';
import { CraftingPanel } from './CraftingPanel';
import { createCloseIcon } from './icons';
import { RightClickGate } from './rightClickGate';
import {
  ItemIconCache,
  SLOT_KEYS,
  createSlotView,
  renderSlotView,
  setSlotQuantity,
  slotAriaLabel,
  stackName,
  type SlotView,
} from './slots';

export interface InventoryScreenContext {
  readonly dispatch: (action: GameAction) => void;
  readonly signal: AbortSignal;
  readonly icons: ItemIconCache;
  readonly idPrefix: string;
}

const LOCKED_TITLE = 'Unlocks with the backpack upgrade from the general store';
/** Chest grid: 3 rows of 12. */
const CHEST_COLUMNS = 12;

/** One slot of either grid, with what it currently shows so unchanged slots are skipped. */
interface ScreenSlot {
  readonly view: SlotView;
  readonly container: 'player' | 'chest';
  readonly index: number;
  /** The stack last rendered; undefined before the first render. */
  shown: ItemStack | null | undefined;
  locked: boolean;
  /** Units of this slot on the cursor (0 when not the held source). */
  held: number;
}

function isScreenPanel(state: GameState): boolean {
  const kind = state.ui.panel.kind;
  return kind === 'inventory' || kind === 'chest';
}

/** Identity of the open panel: which chest, or the backpack. Null when the screen is closed. */
function panelKey(state: GameState): string | null {
  const panel = state.ui.panel;
  if (panel.kind === 'inventory') return 'inventory';
  if (panel.kind === 'chest') return `chest:${panel.mapId}:${panel.tx}:${panel.tz}`;
  return null;
}

/**
 * True when a contextmenu event came from a pointer rather than the keyboard. Browsers that send
 * it as a PointerEvent give keyboard ones an empty pointerType (and `detail` is 0 either way);
 * older ones send a MouseEvent whose button is 2 for a real right click.
 */
function isPointerContextMenu(event: MouseEvent): boolean {
  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) return event.pointerType !== '';
  return event.button === 2;
}

function countFilled(slots: readonly (ItemStack | null)[]): number {
  let filled = 0;
  for (const stack of slots) if (stack !== null) filled++;
  return filled;
}

export class InventoryScreen {
  readonly element = h('div', 'hud-modal hud-inv');
  private readonly title = h('h2', 'hud-modal__title', 'Backpack');
  private readonly subtitle = h('p', 'hud-modal__subtitle');
  private readonly chestSection = h('section', 'hud-inv__section hud-inv__section--chest');
  private readonly chestCount = h('span', 'hud-inv__count');
  private readonly bagCount = h('span', 'hud-inv__count');
  private readonly ghost = h('div', 'hud-inv__ghost');
  private readonly ghostIcon = h('span', 'hud-inv__ghost-icon');
  private readonly ghostQuantity = h('span', 'hud-inv__ghost-qty');
  /** Items / Crafting tabs, shown only on the backpack screen (a chest always shows items). */
  private readonly tabs = h('div', 'hud-inv__tabs');
  private readonly itemsTab = hudButton('hud-btn hud-btn--soft hud-inv__tab', 'Items');
  private readonly craftTab = hudButton('hud-btn hud-btn--soft hud-inv__tab', 'Crafting');
  private readonly bagSection = h('section', 'hud-inv__section');
  private readonly footer = h('p', 'hud-inv__footer');
  private readonly crafting: CraftingPanel;
  private tab: 'items' | 'crafting' = 'items';
  private readonly icons: ItemIconCache;
  private readonly dispatch: (action: GameAction) => void;
  private readonly playerSlots: ScreenSlot[] = [];
  private readonly chestSlots: ScreenSlot[] = [];
  private readonly rightClicks = new RightClickGate();
  /** The state last synced: click handlers act on it, and a rejected move leaves it unchanged. */
  private state: GameState | null = null;
  private shownPanel: string | null = null;
  private held: HeldStack | null = null;
  private selected = -1;
  private water = -1;
  private waterCapacity = -1;

  constructor(context: InventoryScreenContext) {
    this.icons = context.icons;
    this.dispatch = context.dispatch;
    const titleId = `${context.idPrefix}-inventory-title`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);

    const backdrop = h('div', 'hud-modal__backdrop');
    const card = h('div', 'hud-panel hud-modal__card hud-inv__card');

    const header = h('header', 'hud-modal__header');
    const heading = h('div', 'hud-modal__heading');
    this.title.id = titleId;
    heading.append(this.title, this.subtitle);
    const close = hudButton('hud-iconbtn hud-modal__close');
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (I / Esc)';
    close.append(createCloseIcon());
    header.append(heading, close);

    const chestGrid = h('div', 'hud-inv__grid');
    chestGrid.setAttribute('role', 'group');
    chestGrid.setAttribute('aria-label', 'Chest');
    for (let i = 0; i < INVENTORY.chestSlots; i++) chestGrid.append(this.addSlot(this.chestSlots, 'chest', i, '', `Chest slot ${i + 1}`));
    chestGrid.style.setProperty('--cols', String(CHEST_COLUMNS));
    this.chestSection.append(this.sectionHeading('Chest', this.chestCount), chestGrid);

    const hotbarRow = h('div', 'hud-inv__grid hud-inv__grid--hotbar');
    hotbarRow.setAttribute('role', 'group');
    hotbarRow.setAttribute('aria-label', 'Hotbar');
    const backpackGrid = h('div', 'hud-inv__grid');
    backpackGrid.setAttribute('role', 'group');
    backpackGrid.setAttribute('aria-label', 'Backpack');
    for (let i = 0; i < INVENTORY.slotCount; i++) {
      const hotbar = i < INVENTORY.hotbarSize;
      const keyLabel = hotbar ? (SLOT_KEYS[i] ?? '') : '';
      const name = hotbar ? `Hotbar slot ${keyLabel}` : `Backpack slot ${i - INVENTORY.hotbarSize + 1}`;
      (hotbar ? hotbarRow : backpackGrid).append(this.addSlot(this.playerSlots, 'player', i, keyLabel, name));
    }
    const bagSection = this.bagSection;
    bagSection.append(this.sectionHeading('Backpack', this.bagCount), hotbarRow, h('hr', 'hud-inv__rule'), backpackGrid);

    const footer = this.footer;
    footer.append(
      h('strong', '', 'Click'),
      ' picks up or places a stack · ',
      h('strong', '', 'Right-click'),
      ' takes half or places one',
    );

    this.chestSection.hidden = true;
    this.crafting = new CraftingPanel(this.icons, this.dispatch, context.signal);
    this.crafting.element.hidden = true;
    this.tabs.setAttribute('role', 'tablist');
    for (const [tab, name] of [
      [this.itemsTab, 'items'],
      [this.craftTab, 'crafting'],
    ] as const) {
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => this.showTab(name), { signal: context.signal });
      this.tabs.append(tab);
    }
    card.append(header, this.tabs, this.chestSection, bagSection, this.crafting.element, footer);

    this.ghost.hidden = true;
    this.ghost.setAttribute('aria-hidden', 'true');
    this.ghost.append(this.ghostIcon, this.ghostQuantity);
    this.element.append(backdrop, card, this.ghost);

    this.listen(context.signal, close, backdrop);
  }

  private showTab(tab: 'items' | 'crafting'): void {
    this.tab = tab;
    if (this.state !== null) this.renderTab(this.state);
  }

  /** Shows the chosen tab; a chest panel always shows its items. */
  private renderTab(state: GameState): void {
    const onBackpack = state.ui.panel.kind === 'inventory';
    const crafting = onBackpack && this.tab === 'crafting';
    setHidden(this.tabs, !onBackpack);
    setHidden(this.bagSection, crafting);
    setHidden(this.footer, crafting);
    setHidden(this.crafting.element, !crafting);
    setAttr(this.itemsTab, 'aria-selected', crafting ? 'false' : 'true');
    setAttr(this.craftTab, 'aria-selected', crafting ? 'true' : 'false');
    if (crafting) {
      if (this.held !== null) this.setHeld(null);
      this.crafting.sync(state);
    }
  }

  private sectionHeading(label: string, count: HTMLElement): HTMLElement {
    const heading = h('h3', 'hud-inv__heading');
    heading.append(h('span', 'hud-inv__label', label), count);
    return heading;
  }

  private addSlot(list: ScreenSlot[], container: 'player' | 'chest', index: number, keyLabel: string, name: string): HTMLButtonElement {
    const view = createSlotView({ keyLabel, name }, 'hud-slot hud-inv__slot');
    view.button.dataset.container = container;
    view.button.dataset.index = String(index);
    list.push({ view, container, index, shown: undefined, locked: false, held: 0 });
    return view.button;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private listen(signal: AbortSignal, close: HTMLButtonElement, backdrop: HTMLElement): void {
    close.addEventListener(
      'click',
      (event) => {
        releasePointerFocus(close, event);
        this.dispatch(actions.closePanel());
      },
      { signal },
    );
    // The backdrop first lets go of a held stack, then closes the screen.
    backdrop.addEventListener(
      'click',
      () => {
        if (this.held !== null) this.setHeld(null);
        else this.dispatch(actions.closePanel());
      },
      { signal },
    );
    this.element.addEventListener(
      'click',
      (event) => {
        const slot = this.slotFromEvent(event);
        if (slot === null) return;
        releasePointerFocus(slot.view.button, event);
        if (event.detail === 0) this.placeGhostAt(slot.view.button);
        else this.moveGhost(event.clientX, event.clientY);
        this.apply(slot, 'left');
      },
      { signal },
    );
    // These only mark where a gesture began and act on nothing: button 2 still acts once, on contextmenu.
    const gestureBegan = (): void => this.rightClicks.gestureBegan();
    this.element.addEventListener('pointerdown', gestureBegan, { signal });
    this.element.addEventListener('keydown', gestureBegan, { signal });
    this.element.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
        if (!this.rightClicks.accept()) return;
        const slot = this.slotFromEvent(event);
        if (slot === null) return;
        // A mouse right click hands keys back to the game; the Menu key keeps focus on the slot.
        if (isPointerContextMenu(event)) {
          slot.view.button.blur();
          this.moveGhost(event.clientX, event.clientY);
        } else {
          this.placeGhostAt(slot.view.button);
        }
        this.apply(slot, 'right');
      },
      { signal },
    );
    this.element.addEventListener(
      'pointermove',
      (event) => {
        if (this.held !== null) this.moveGhost(event.clientX, event.clientY);
      },
      { signal },
    );
  }

  private slotFromEvent(event: Event): ScreenSlot | null {
    const button = closestWithin(event, this.element, '[data-container]');
    if (button === null) return null;
    const index = Number(button.dataset.index);
    const list = button.dataset.container === 'chest' ? this.chestSlots : this.playerSlots;
    return Number.isInteger(index) ? (list[index] ?? null) : null;
  }

  /** The slot reference for a screen slot in the current panel, or null when it can't be used. */
  private refFor(slot: ScreenSlot, state: GameState): SlotRef | null {
    if (slot.container === 'player') return { container: 'player', index: slot.index };
    const panel = state.ui.panel;
    if (panel.kind !== 'chest') return null;
    return { container: 'chest', mapId: panel.mapId, tx: panel.tx, tz: panel.tz, index: slot.index };
  }

  /**
   * Runs a click rule on a slot. The expected held stack is set before the move is dispatched, so
   * the sync that the move triggers clamps against it; if the reducer rejects the move (the state
   * reference is unchanged) a right click keeps holding what it held.
   */
  private apply(slot: ScreenSlot, button: 'left' | 'right'): void {
    const state = this.state;
    if (state === null || slot.locked || !isScreenPanel(state)) return;
    const ref = this.refFor(slot, state);
    if (ref === null) return;
    const stack = stackAtRef(state, ref);
    if (stack === undefined) return;
    const before = this.held;
    const result: SlotClickResult = button === 'left' ? leftClickSlot(before, ref, stack) : rightClickSlot(before, ref, stack);
    this.setHeld(result.held);
    if (result.move === null) return;
    this.dispatch(actions.moveItem(result.move.from, result.move.to, result.move.quantity));
    const rejected = this.state === state;
    // A rejected left-click placement still lets go (the stack never left its slot).
    if (rejected && button === 'right') this.setHeld(before);
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  sync(state: GameState, prev: GameState | null): void {
    // The held stack was last checked against the previously synced state.
    const checked = this.state;
    this.state = state;
    const key = panelKey(state);
    setHidden(this.element, key === null);
    if (key === null) {
      this.shownPanel = null;
      this.rightClicks.reset();
      this.setHeld(null);
      return;
    }
    const reopened = prev === null || key !== this.shownPanel;
    if (reopened) {
      this.shownPanel = key;
      this.rightClicks.reset();
      this.setHeld(null);
    } else {
      this.setHeld(reconcileHeld(this.held, state, checked));
    }
    this.renderPlayer(state.inventory, reopened);
    this.renderChest(state, reopened);
    this.renderHeader(state);
    this.renderTab(state);
  }

  private renderHeader(state: GameState): void {
    const inventory = state.inventory;
    const chest = selectOpenChest(state);
    setText(this.title, chest === null ? 'Backpack' : 'Chest');
    setText(
      this.subtitle,
      chest === null
        ? `${inventory.unlockedSlots} / ${INVENTORY.slotCount} slots`
        : `${countFilled(chest.slots)} / ${INVENTORY.chestSlots} slots in use`,
    );
    setText(this.bagCount, `${countFilled(inventory.slots)} / ${inventory.unlockedSlots} in use`);
    if (chest !== null) setText(this.chestCount, `${countFilled(chest.slots)} / ${INVENTORY.chestSlots}`);
  }

  private renderPlayer(inventory: InventoryState, force: boolean): void {
    const waterChanged = inventory.water !== this.water || inventory.waterCapacity !== this.waterCapacity;
    this.water = inventory.water;
    this.waterCapacity = inventory.waterCapacity;
    for (const slot of this.playerSlots) {
      const stack = inventory.slots[slot.index] ?? null;
      const locked = slot.index >= inventory.unlockedSlots;
      const isCan = stack !== null && stack.itemId === 'wateringCan';
      this.renderSlot(slot, stack, inventory, force || (waterChanged && isCan), locked);
    }
    if (force || inventory.selected !== this.selected) {
      this.playerSlots[this.selected]?.view.button.classList.remove('is-selected');
      this.playerSlots[inventory.selected]?.view.button.classList.add('is-selected');
      this.selected = inventory.selected;
    }
  }

  private renderChest(state: GameState, force: boolean): void {
    const chest = selectOpenChest(state);
    setHidden(this.chestSection, chest === null);
    if (chest === null) return;
    for (const slot of this.chestSlots) {
      this.renderSlot(slot, chest.slots[slot.index] ?? null, state.inventory, force, false);
    }
  }

  /** Redraws one slot when its stack, held count or lock changed (or when forced). */
  private renderSlot(slot: ScreenSlot, stack: ItemStack | null, inventory: InventoryState, force: boolean, locked: boolean): void {
    const held = this.held !== null && this.matches(slot, this.held.ref) ? this.held.quantity : 0;
    if (!force && stack === slot.shown && held === slot.held && locked === slot.locked) return;
    slot.shown = stack;
    slot.held = held;
    slot.locked = locked;
    const view = slot.view;
    renderSlotView(view, stack, inventory, this.icons);
    view.button.classList.toggle('is-locked', locked);
    setAttr(view.button, 'aria-disabled', locked ? 'true' : 'false');
    if (locked) {
      setTitle(view.button, LOCKED_TITLE);
      view.button.setAttribute('aria-label', `${view.name}: locked. ${LOCKED_TITLE}`);
    }
    const holding = held > 0 && stack !== null;
    view.button.classList.toggle('is-held', holding);
    view.button.classList.toggle('is-all-held', holding && held >= stack.quantity);
    if (holding) {
      setSlotQuantity(view, stack.quantity - held);
      view.button.setAttribute('aria-label', `${slotAriaLabel(stack, view.name)}. Holding ${held}`);
    }
  }

  private matches(slot: ScreenSlot, ref: SlotRef): boolean {
    if (slot.container !== ref.container || slot.index !== ref.index) return false;
    const state = this.state;
    if (state === null || ref.container === 'player') return true;
    const own = this.refFor(slot, state);
    return own !== null && sameSlotRef(own, ref);
  }

  // -------------------------------------------------------------------------
  // Held stack and cursor ghost
  // -------------------------------------------------------------------------

  /** Replaces the held stack and redraws the slots it leaves and lands on, plus the ghost. */
  private setHeld(next: HeldStack | null): void {
    const previous = this.held;
    if (previous === next) return;
    this.held = next;
    this.element.classList.toggle('is-holding', next !== null);
    const state = this.state;
    if (state !== null && isScreenPanel(state)) {
      if (previous !== null) this.refresh(previous.ref, state);
      if (next !== null) this.refresh(next.ref, state);
    }
    this.renderGhost(next, state);
  }

  private refresh(ref: SlotRef, state: GameState): void {
    const list = ref.container === 'player' ? this.playerSlots : this.chestSlots;
    const slot = list[ref.index];
    if (slot === undefined || slot.shown === undefined) return;
    const stack = stackAtRef(state, ref);
    this.renderSlot(slot, stack ?? null, state.inventory, false, slot.locked);
  }

  private renderGhost(held: HeldStack | null, state: GameState | null): void {
    const stack = held === null || state === null ? null : (stackAtRef(state, held.ref) ?? null);
    setHidden(this.ghost, held === null || stack === null);
    if (held === null || stack === null) {
      this.ghostIcon.replaceChildren();
      delete this.ghost.dataset.item;
      return;
    }
    const identity = `${stack.itemId}:${stack.quality}`;
    if (this.ghost.dataset.item !== identity) {
      this.ghost.dataset.item = identity;
      this.ghostIcon.replaceChildren(this.icons.get(stack.itemId));
      if (stack.quality !== 0) {
        const star = h('span', 'hud-slot__quality');
        star.append(this.icons.star(stack.quality));
        this.ghostIcon.append(star);
      }
    }
    setHidden(this.ghostQuantity, held.quantity <= 1);
    setText(this.ghostQuantity, String(held.quantity));
    setTitle(this.ghost, `${stackName(stack)} ×${held.quantity}`);
  }

  private moveGhost(x: number, y: number): void {
    this.ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  /** Keyboard pick-ups have no pointer position: the ghost starts over the slot itself. */
  private placeGhostAt(button: HTMLElement): void {
    const rect = button.getBoundingClientRect();
    this.moveGhost(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
}
