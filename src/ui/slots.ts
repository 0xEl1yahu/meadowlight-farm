/**
 * Slot views shared by the hotbar and the inventory screen: one button per slot with an item
 * icon, a quality star (bottom-left), a quantity badge (bottom-right), the watering can's water
 * gauge and an optional key label. `renderSlotView` rewrites only what changed.
 */
import type { InventoryState, ItemId, ItemStack, Quality } from '../core/types';
import { getItem, sellPriceFor } from '../items/items';
import { clamp01, h, hudButton, setHidden, setText, setTitle } from './dom';
import { createItemIcon, createQualityStarIcon } from './icons';

/** Key labels for hotbar slots 0…11, matching the InputController bindings. */
export const SLOT_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

/** Builds each item icon and quality star once and hands out clones. */
export class ItemIconCache {
  private readonly templates = new Map<ItemId, SVGSVGElement>();
  private readonly stars = new Map<1 | 2, SVGSVGElement>();

  get(itemId: ItemId): SVGSVGElement {
    let template = this.templates.get(itemId);
    if (template === undefined) {
      template = createItemIcon(getItem(itemId));
      this.templates.set(itemId, template);
    }
    return template.cloneNode(true) as SVGSVGElement;
  }

  star(quality: 1 | 2): SVGSVGElement {
    let template = this.stars.get(quality);
    if (template === undefined) {
      template = createQualityStarIcon(quality);
      this.stars.set(quality, template);
    }
    return template.cloneNode(true) as SVGSVGElement;
  }
}

export interface SlotView {
  readonly button: HTMLButtonElement;
  readonly icon: HTMLElement;
  readonly quality: HTMLElement;
  readonly quantity: HTMLElement;
  readonly water: HTMLElement;
  /** Hotbar key ('1' … '='), or '' for slots without a key. */
  readonly keyLabel: string;
  /** Spoken name of the slot, e.g. "Slot 1", "Backpack slot 3" or "Chest slot 7". */
  readonly name: string;
  itemId: ItemId | null;
  qualityShown: Quality;
}

export interface SlotViewOptions {
  readonly keyLabel: string;
  readonly name: string;
}

/** "Silver " or "Gold " before an item name; empty for normal quality. */
export function qualityPrefix(stack: ItemStack): string {
  return stack.quality === 2 ? 'Gold ' : stack.quality === 1 ? 'Silver ' : '';
}

/** The item's display name with its quality, e.g. "Gold Parsnip". */
export function stackName(stack: ItemStack): string {
  return `${qualityPrefix(stack)}${getItem(stack.itemId).name}`;
}

/** Sell price per unit for a stack at its quality, or null for items that can't be shipped. */
export function stackUnitPrice(stack: ItemStack): number | null {
  return getItem(stack.itemId).sellPrice === null ? null : sellPriceFor(stack.itemId, stack.quality);
}

export function slotTitle(stack: ItemStack | null, keyLabel: string, inventory: InventoryState): string {
  if (stack === null) return keyLabel === '' ? 'Empty slot' : `Empty slot · key ${keyLabel}`;
  const item = getItem(stack.itemId);
  const name = stackName(stack);
  const lines = [stack.quantity > 1 ? `${name} ×${stack.quantity}` : name, item.description];
  if (item.kind === 'tool') {
    if (item.tool === 'wateringCan') lines.push(`Water: ${inventory.water} / ${inventory.waterCapacity}`);
    if (item.energyCost > 0) lines.push(`Uses ${item.energyCost} energy`);
  } else {
    const price = stackUnitPrice(stack);
    if (price !== null) lines.push(`Ships for ${price}g each`);
  }
  if (keyLabel !== '') lines.push(`Key ${keyLabel}`);
  return lines.join('\n');
}

export function slotAriaLabel(stack: ItemStack | null, name: string): string {
  if (stack === null) return `${name}: empty`;
  const price = stackUnitPrice(stack);
  const quantity = stack.quantity > 1 ? `, ${stack.quantity}` : '';
  return `${name}: ${stackName(stack)}${quantity}${price === null ? '' : `, ships for ${price}g each`}`;
}

export function createSlotView(options: SlotViewOptions, className = 'hud-slot'): SlotView {
  const button = hudButton(`${className} is-empty`);
  const icon = h('span', 'hud-slot__icon');
  icon.setAttribute('aria-hidden', 'true');
  const water = h('span', 'hud-slot__water');
  water.hidden = true;
  water.setAttribute('aria-hidden', 'true');
  water.append(h('span', 'hud-slot__water-fill'));
  const quality = h('span', 'hud-slot__quality');
  quality.hidden = true;
  quality.setAttribute('aria-hidden', 'true');
  const quantity = h('span', 'hud-slot__qty');
  quantity.hidden = true;
  quantity.setAttribute('aria-hidden', 'true');
  button.append(icon, water, quality, quantity);
  if (options.keyLabel !== '') {
    const key = h('span', 'hud-slot__key', options.keyLabel);
    key.setAttribute('aria-hidden', 'true');
    button.append(key);
  }
  return { button, icon, quality, quantity, water, keyLabel: options.keyLabel, name: options.name, itemId: null, qualityShown: 0 };
}

/** Shows `quantity` in the badge (hidden at 1 or less); the inventory screen uses it for a held stack's remainder. */
export function setSlotQuantity(view: SlotView, quantity: number): void {
  setHidden(view.quantity, quantity <= 1);
  if (quantity > 1) setText(view.quantity, String(quantity));
}

export function renderSlotView(view: SlotView, stack: ItemStack | null, inventory: InventoryState, icons: ItemIconCache): void {
  const itemId = stack === null ? null : stack.itemId;
  if (itemId !== view.itemId) {
    view.itemId = itemId;
    if (itemId === null) view.icon.replaceChildren();
    else view.icon.replaceChildren(icons.get(itemId));
    view.button.classList.toggle('is-empty', itemId === null);
  }

  const quality: Quality = stack === null ? 0 : stack.quality;
  if (quality !== view.qualityShown) {
    view.qualityShown = quality;
    if (quality === 0) view.quality.replaceChildren();
    else view.quality.replaceChildren(icons.star(quality));
    setHidden(view.quality, quality === 0);
    view.quality.dataset.quality = String(quality);
  }

  setSlotQuantity(view, stack === null ? 0 : stack.quantity);

  const isCan = itemId === 'wateringCan';
  setHidden(view.water, !isCan);
  if (isCan) {
    const ratio = inventory.waterCapacity > 0 ? clamp01(inventory.water / inventory.waterCapacity) : 0;
    view.button.style.setProperty('--hud-water-level', ratio.toFixed(3));
    view.water.classList.toggle('is-empty', inventory.water <= 0);
  }

  setTitle(view.button, slotTitle(stack, view.keyLabel, inventory));
  view.button.setAttribute('aria-label', slotAriaLabel(stack, view.name));
}
