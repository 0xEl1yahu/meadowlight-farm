/**
 * Slot titles and aria text shared by the hotbar and the inventory screen (spec §7.4,
 * src/ui/slots.ts): quality names and quality-adjusted prices from sellPriceFor.
 */
import { describe, expect, it } from 'vitest';
import { FARMING } from '../src/config';
import { getItem, sellPriceFor } from '../src/items/items';
import { qualityPrefix, slotAriaLabel, slotTitle, stackName, stackUnitPrice } from '../src/ui/slots';
import { BASE, stack } from './testUtils';

const inventory = BASE.inventory;

describe('slot text', () => {
  it('names silver and gold stacks', () => {
    expect(qualityPrefix(stack('parsnip', 1))).toBe('');
    expect(qualityPrefix(stack('parsnip', 1, 1))).toBe('Silver ');
    expect(qualityPrefix(stack('parsnip', 1, 2))).toBe('Gold ');
    expect(stackName(stack('parsnip', 3, 2))).toBe(`Gold ${getItem('parsnip').name}`);
  });

  it('prices each quality with sellPriceFor', () => {
    const base = getItem('parsnip').sellPrice ?? 0;
    for (const quality of [0, 1, 2] as const) {
      const price = sellPriceFor('parsnip', quality);
      expect(price).toBe(Math.floor(base * FARMING.qualityMultipliers[quality]));
      expect(stackUnitPrice(stack('parsnip', 2, quality))).toBe(price);
    }
    expect(stackUnitPrice(stack('hoe', 1))).toBeNull();
  });

  it('puts the quality and its price in the title', () => {
    const gold = stack('parsnip', 4, 2);
    const title = slotTitle(gold, '3', inventory);
    expect(title).toContain(`Gold ${getItem('parsnip').name} ×4`);
    expect(title).toContain(`Ships for ${sellPriceFor('parsnip', 2)}g each`);
    expect(title).toContain('Key 3');
    const silver = slotTitle(stack('parsnip', 1, 1), '', inventory);
    expect(silver.startsWith(`Silver ${getItem('parsnip').name}`)).toBe(true);
    expect(silver).toContain(`Ships for ${sellPriceFor('parsnip', 1)}g each`);
    expect(silver).not.toContain('Key');
  });

  it('describes tools and empty slots', () => {
    expect(slotTitle(null, '1', inventory)).toBe('Empty slot · key 1');
    expect(slotTitle(null, '', inventory)).toBe('Empty slot');
    const can = slotTitle(stack('wateringCan', 1), '2', inventory);
    expect(can).toContain(`Water: ${inventory.water} / ${inventory.waterCapacity}`);
    expect(can).not.toContain('Ships for');
  });

  it('speaks the slot name, item, quantity, quality and price', () => {
    expect(slotAriaLabel(null, 'Backpack slot 4')).toBe('Backpack slot 4: empty');
    expect(slotAriaLabel(stack('parsnip', 5, 1), 'Slot 2')).toBe(
      `Slot 2: Silver ${getItem('parsnip').name}, 5, ships for ${sellPriceFor('parsnip', 1)}g each`,
    );
    expect(slotAriaLabel(stack('hoe', 1), 'Slot 1')).toBe(`Slot 1: ${getItem('hoe').name}`);
  });
});
