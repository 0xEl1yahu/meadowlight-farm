/**
 * Item registry. Tools and materials are declared here; seed and produce items are derived
 * from the crop registry so new crops need no item boilerplate.
 */
import { INVENTORY, TOOLS } from '../config';
import { CROPS, seedItemId } from '../farming/crops';
import {
  CROP_IDS,
  MATERIAL_IDS,
  TOOL_TYPES,
  type CropId,
  type ItemId,
  type MaterialItemId,
  type SeedItemId,
  type ToolType,
} from '../core/types';

export type ItemKind = 'tool' | 'seed' | 'produce' | 'material';

interface ItemBase {
  readonly id: ItemId;
  readonly name: string;
  readonly description: string;
  readonly maxStack: number;
  /** Shipping value per unit; null = cannot be shipped. */
  readonly sellPrice: number | null;
  /** Representative colour for UI icons. */
  readonly color: number;
}

export interface ToolItem extends ItemBase {
  readonly kind: 'tool';
  readonly id: ToolType;
  readonly tool: ToolType;
  readonly energyCost: number;
}

export interface SeedItem extends ItemBase {
  readonly kind: 'seed';
  readonly id: SeedItemId;
  readonly cropId: CropId;
  readonly price: number;
}

export interface ProduceItem extends ItemBase {
  readonly kind: 'produce';
  readonly id: CropId;
  readonly cropId: CropId;
}

export interface MaterialItem extends ItemBase {
  readonly kind: 'material';
  readonly id: MaterialItemId;
}

export type ItemDefinition = ToolItem | SeedItem | ProduceItem | MaterialItem;

const TOOL_INFO: Readonly<Record<ToolType, { name: string; description: string; color: number }>> = {
  hoe: { name: 'Hoe', description: 'Tills grass into soil. Clears withered crops.', color: 0xb98b5e },
  wateringCan: {
    name: 'Watering Can',
    description: 'Waters tilled soil. Refill it at the pond.',
    color: 0x7fb8e6,
  },
  pickaxe: { name: 'Pickaxe', description: 'Breaks rocks. Turns empty soil back into grass.', color: 0x9aa0b5 },
  axe: { name: 'Axe', description: 'Chops stumps into wood.', color: 0xc07a4f },
  scythe: { name: 'Scythe', description: 'Harvests ripe crops and clears withered ones.', color: 0xd9d4c7 },
};

const MATERIAL_INFO: Readonly<Record<MaterialItemId, { name: string; description: string; sellPrice: number; color: number }>> = {
  stone: { name: 'Stone', description: 'A common building material.', sellPrice: 2, color: 0xb7b4c7 },
  wood: { name: 'Wood', description: 'Sturdy and useful.', sellPrice: 2, color: 0xa47552 },
};

function buildRegistry(): ReadonlyMap<ItemId, ItemDefinition> {
  const registry = new Map<ItemId, ItemDefinition>();
  for (const tool of TOOL_TYPES) {
    const info = TOOL_INFO[tool];
    registry.set(tool, {
      kind: 'tool',
      id: tool,
      tool,
      name: info.name,
      description: info.description,
      maxStack: 1,
      sellPrice: null,
      color: info.color,
      energyCost: TOOLS.energyCost[tool],
    });
  }
  for (const cropId of CROP_IDS) {
    const crop = CROPS[cropId];
    const seedId = seedItemId(cropId);
    registry.set(seedId, {
      kind: 'seed',
      id: seedId,
      cropId,
      name: `${crop.name} Seeds`,
      description: `Grows in ${crop.stageDays.reduce((a, b) => a + b, 0)} days${crop.regrowDays !== null ? `, regrows every ${crop.regrowDays}` : ''}.`,
      maxStack: INVENTORY.maxStack,
      sellPrice: Math.max(1, Math.floor(crop.seedPrice / 2)),
      color: crop.visual.foliageColor,
      price: crop.seedPrice,
    });
    registry.set(cropId, {
      kind: 'produce',
      id: cropId,
      cropId,
      name: crop.name,
      description: `Sells for ${crop.sellPrice}g.`,
      maxStack: INVENTORY.maxStack,
      sellPrice: crop.sellPrice,
      color: crop.visual.produceColor,
    });
  }
  for (const material of MATERIAL_IDS) {
    const info = MATERIAL_INFO[material];
    registry.set(material, {
      kind: 'material',
      id: material,
      name: info.name,
      description: info.description,
      maxStack: INVENTORY.maxStack,
      sellPrice: info.sellPrice,
      color: info.color,
    });
  }
  return registry;
}

export const ITEMS: ReadonlyMap<ItemId, ItemDefinition> = buildRegistry();

export function getItem(id: ItemId): ItemDefinition {
  const item = ITEMS.get(id);
  if (item === undefined) throw new RangeError(`Unknown item id "${id}"`);
  return item;
}

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && ITEMS.has(value as ItemId);
}

export function isSeedItemId(value: unknown): value is SeedItemId {
  return isItemId(value) && getItem(value).kind === 'seed';
}
