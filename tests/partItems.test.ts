/**
 * Robot parts as items (farmclaws part 4b spec §2): every part is an item of kind 'part' with
 * its robot-screen name and its design price, stacks like a material, can't be shipped, and
 * rides along in the backpack and in chests.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PARTS } from '../src/config';
import { Blocker, Direction, ROBOT_PART_IDS, type ItemStack, type RobotPartId } from '../src/core/types';
import { ITEMS, getItem, isPartItemId } from '../src/items/items';
import { actions } from '../src/state/actions';
import { planInteraction, planPrimaryAction } from '../src/state/intents';
import { addItem } from '../src/state/inventory';
import { deserializeGame, isValidGameState, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { PART_LABELS } from '../src/ui/robotScreen/viewModel';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, TARGET, holding, scenario, stack, withPlayer, withSlots, withTile } from './testUtils';

/** The spec's names (spec §2) and the design §3.7 prices. */
const EXPECTED: Readonly<Record<RobotPartId, readonly [name: string, price: number]>> = {
  claw: ['Claw', 300],
  wateringHead: ['Watering head', 400],
  tiller: ['Tiller', 500],
  seeder: ['Seeder', 500],
  basket: ['Basket', 350],
  antenna: ['Antenna', 600],
  sensorEye: ['Sensor eye', 450],
  efficientCore: ['Efficient core', 1500],
  quickCore: ['Quick core', 1500],
};

/** Sol's shop lines (spec §3.2), which double as the basic parts' descriptions. */
const BASIC_LINES: Readonly<Partial<Record<RobotPartId, string>>> = {
  claw: 'Harvest, take from and deposit into.',
  wateringHead: 'Water and refill. Holds 20 uses.',
  tiller: 'Till soil.',
  seeder: 'Plant seeds.',
  basket: 'Two more bag stacks.',
  sensorEye: 'Sees the tile ahead, the rain and the time.',
};

describe('part items', () => {
  it('makes every robot part an item of kind part with its name and price', () => {
    for (const part of ROBOT_PART_IDS) {
      const item = getItem(part);
      const [name, price] = EXPECTED[part];
      expect(item.kind, part).toBe('part');
      expect(item.name).toBe(name);
      expect(PART_LABELS[part]).toBe(name);
      expect(PARTS.prices[part]).toBe(price);
      if (item.kind === 'part') expect(item.price).toBe(price);
      expect(item.hasQuality).toBe(false);
      const line = BASIC_LINES[part];
      if (line !== undefined) expect(item.description).toBe(line);
      else expect(item.description).not.toBe('');
    }
    expect([...ITEMS.values()].filter((item) => item.kind === 'part').map((item) => item.id)).toEqual([...ROBOT_PART_IDS]);
    expect(PARTS.sellBackShare).toBe(0.5);
  });

  it('knows part ids from every other item id', () => {
    for (const part of ROBOT_PART_IDS) expect(isPartItemId(part)).toBe(true);
    for (const other of ['hoe', 'stone', 'parsnip', 'parsnip_seeds', 'chest', 'cog', 3, null]) expect(isPartItemId(other)).toBe(false);
  });

  it("can't be shipped: the bin refuses a part by name", () => {
    expect(getItem('claw').sellPrice).toBeNull();
    const atBin = holding(withPlayer(BASE, { tx: 9, tz: 6 }, Direction.North), 'claw', 2);
    expect(planInteraction(atBin).intent).toEqual({ kind: 'blocked', reason: "Claw can't be shipped." });
    const next = gameReducer(atBin, actions.interact());
    expect(next.shipping).toBe(atBin.shipping);
    expect(next.inventory).toBe(atBin.inventory);
    expect(next.messages.entries.at(-1)).toMatchObject({ text: "Claw can't be shipped.", tone: 'warn' });
  });

  it('stacks like a material, up to the inventory stack limit', () => {
    expect(getItem('tiller').maxStack).toBe(INVENTORY.maxStack);
    const empty = withSlots(BASE, []).inventory;
    const once = addItem(empty, 'tiller', 1).inventory;
    const twice = addItem(once, 'tiller', 1).inventory;
    expect(twice.slots[0]).toEqual(stack('tiller', 2));
    expect(twice.slots[1]).toBeNull();
    const over = addItem(empty, 'tiller', INVENTORY.maxStack + 1).inventory;
    expect(over.slots.slice(0, 2)).toEqual([stack('tiller', INVENTORY.maxStack), stack('tiller', 1)]);
  });

  it('round-trips parts in the backpack and in a chest through a save', () => {
    const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY.chestSlots }, () => null);
    slots[0] = stack('claw', 3);
    slots[7] = stack('quickCore', 1);
    let state = withTile(BASE, TARGET, { ...EMPTY_TILE, object: { kind: 'chest', slots } }, 'farm');
    state = withSlots(state, [stack('hoe', 1), stack('sensorEye', 2), stack('antenna', 1)]);
    expect(isValidGameState(state)).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
    const silver = withSlots(state, [stack('claw', 1, 1)]);
    expect(isValidGameState(silver)).toBe(false);
  });

  it('does nothing on the field: Space falls back to E', () => {
    for (const tile of [EMPTY_TILE, blockedTile(Blocker.ShippingBin)]) {
      const state = holding(scenario(tile), 'wateringHead', 2);
      expect(planPrimaryAction(state)).toEqual(planInteraction(state));
    }
    const idle = holding(scenario(EMPTY_TILE), 'seeder');
    expect(planPrimaryAction(idle)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    const next = gameReducer(idle, actions.useTool());
    expect(next.maps).toBe(idle.maps);
    expect(next.inventory).toBe(idle.inventory);
    expect(next.player.energy).toBe(idle.player.energy);
    expect(next.messages).toBe(idle.messages);
  });
});
