/**
 * Item registry. Tools and materials are declared here; seed and produce items are derived
 * from the crop registry so new crops need no item boilerplate.
 */
import { FARMING, INVENTORY, PARTS, TOOLS } from '../config';
import { CROPS, seedItemId } from '../farming/crops';
import {
  CROP_IDS,
  FERTILIZER_ITEM_IDS,
  MATERIAL_IDS,
  PLACEABLE_ITEM_IDS,
  ROBOT_PART_IDS,
  type FertilizerItemId,
  type FertilizerKind,
  type PlaceableItemId,
  TOOL_TYPES,
  type CropId,
  type ItemId,
  type MaterialItemId,
  type Quality,
  type RobotPartId,
  type SeedItemId,
  type ToolType,
} from '../core/types';

export type ItemKind = 'tool' | 'seed' | 'produce' | 'material' | 'placeable' | 'fertilizer' | 'part';

interface ItemBase {
  readonly id: ItemId;
  readonly name: string;
  readonly description: string;
  readonly maxStack: number;
  /** Shipping value per unit; null = cannot be shipped. */
  readonly sellPrice: number | null;
  /** Representative colour for UI icons. */
  readonly color: number;
  /** Whether stacks of this item carry a silver or gold quality (produce; later forage, food, animal products). */
  readonly hasQuality: boolean;
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

/** Placed on an empty tile as the PlacedObject of the same kind (see state/placement.ts). */
export interface PlaceableItem extends ItemBase {
  readonly kind: 'placeable';
  readonly id: PlaceableItemId;
}

/** Mixed into empty tilled soil; lasts until the crop on it is harvested. */
export interface FertilizerItem extends ItemBase {
  readonly kind: 'fertilizer';
  readonly id: FertilizerItemId;
  readonly fertilizer: FertilizerKind;
}

/** A robot part (farmclaws part 4b spec §2): fitted at the workbench, bought from and sold back to Sol, never shipped. */
export interface PartItem extends ItemBase {
  readonly kind: 'part';
  readonly id: RobotPartId;
  /** Sol's price; he buys one back for PARTS.sellBackShare of it. */
  readonly price: number;
}

export type ItemDefinition = ToolItem | SeedItem | ProduceItem | MaterialItem | PlaceableItem | FertilizerItem | PartItem;

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
  zoneMarker: {
    name: 'Zone Marker',
    description: 'Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.',
    color: 0xe2563f,
  },
};

const MATERIAL_INFO: Readonly<Record<MaterialItemId, { name: string; description: string; sellPrice: number; color: number }>> = {
  stone: { name: 'Stone', description: 'A common building material.', sellPrice: 2, color: 0xb7b4c7 },
  wood: { name: 'Wood', description: 'Sturdy and useful.', sellPrice: 2, color: 0xa47552 },
  copperOre: { name: 'Copper Ore', description: 'Sometimes found in broken rocks. Used for sprinklers.', sellPrice: 5, color: 0xd9824a },
  sap: { name: 'Sap', description: 'Sticky resin from trees. Used for fertiliser.', sellPrice: 2, color: 0xc98f2e },
  fiber: { name: 'Fiber', description: 'Tough strands cut from weeds.', sellPrice: 1, color: 0x8fb45a },
};

type SimpleInfo = { name: string; description: string; sellPrice: number | null; color: number };

const PLACEABLE_INFO: Readonly<Record<PlaceableItemId, SimpleInfo>> = {
  chest: { name: 'Chest', description: 'Place it to store 36 stacks. Pick it up with the axe once empty.', sellPrice: null, color: 0xb07a45 },
  woodFence: { name: 'Wood Fence', description: 'Keeps a tile clear. Pick it up with the axe.', sellPrice: null, color: 0xa47552 },
  woodPath: { name: 'Wood Path', description: 'Lay it on grass. Pick it up with the axe.', sellPrice: null, color: 0xc49a6c },
  stonePath: { name: 'Stone Path', description: 'Lay it on grass. Pick it up with the pickaxe.', sellPrice: null, color: 0xa9a7b8 },
  scarecrow: { name: 'Scarecrow', description: 'Keeps crows off crops within 8 tiles.', sellPrice: null, color: 0xd8b45a },
  sprinkler: { name: 'Sprinkler', description: 'Waters the 4 tiles beside it every morning.', sellPrice: null, color: 0x9aa7b8 },
  woodBurner: {
    name: 'Wood Burner',
    description: 'Burns wood overnight and turns it into tokens for your robots. Load it with wood (E).',
    sellPrice: null,
    color: 0x8a5a3c,
  },
  qualitySprinkler: { name: 'Quality Sprinkler', description: 'Waters the 8 tiles around it every morning.', sellPrice: null, color: 0xd9a05b },
};

const FERTILIZER_INFO: Readonly<Record<FertilizerItemId, SimpleInfo & { fertilizer: FertilizerKind }>> = {
  basicFertilizer: { name: 'Basic Fertiliser', description: 'Mix into empty soil: better odds of silver and gold crops.', sellPrice: 2, color: 0x8a6a4a, fertilizer: 'basic' },
  qualityFertilizer: { name: 'Quality Fertiliser', description: 'Mix into empty soil: much better odds of silver and gold crops.', sellPrice: 5, color: 0x6a8a4a, fertilizer: 'quality' },
  speedGro: { name: 'Speed-Gro', description: 'Mix into empty soil: crops grow 10% faster.', sellPrice: 5, color: 0x4a9a8a, fertilizer: 'speedGro' },
};

/** Name and description per part; the basic six describe themselves with Sol's shop lines (part 4b spec §3.2). */
const PART_INFO: Readonly<Record<RobotPartId, readonly [name: string, description: string]>> = {
  claw: ['Claw', 'Harvest, take from and deposit into.'],
  wateringHead: ['Watering head', 'Water and refill. Holds 20 uses.'],
  tiller: ['Tiller', 'Till soil.'],
  seeder: ['Seeder', 'Plant seeds.'],
  basket: ['Basket', 'Two more bag stacks.'],
  antenna: ['Antenna', 'Send messages to other robots.'],
  sensorEye: ['Sensor eye', 'Sees the tile ahead, the rain and the time.'],
  efficientCore: ['Efficient core', 'Actions cost a quarter fewer tokens.'],
  quickCore: ['Quick core', 'Acts every 3 minutes instead of 4.'],
};

/** Every part shares the robots' steel; the icon's drawing tells them apart. */
const PART_COLOR = 0x9fb4c8;

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
      hasQuality: false,
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
      hasQuality: false,
      price: crop.seedPrice,
    });
    registry.set(cropId, {
      kind: 'produce',
      id: cropId,
      cropId,
      name: crop.name,
      // No price here: the price depends on the stack's quality (see sellPriceFor).
      description: 'Ship it for gold. Silver and gold ones sell for more.',
      maxStack: INVENTORY.maxStack,
      sellPrice: crop.sellPrice,
      color: crop.visual.produceColor,
      hasQuality: true,
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
      hasQuality: false,
    });
  }
  for (const id of PLACEABLE_ITEM_IDS) {
    const info = PLACEABLE_INFO[id];
    registry.set(id, { kind: 'placeable', id, ...info, maxStack: INVENTORY.maxStack, hasQuality: false });
  }
  for (const id of FERTILIZER_ITEM_IDS) {
    const info = FERTILIZER_INFO[id];
    registry.set(id, { kind: 'fertilizer', id, ...info, maxStack: INVENTORY.maxStack, hasQuality: false });
  }
  for (const id of ROBOT_PART_IDS) {
    const [name, description] = PART_INFO[id];
    const price = PARTS.prices[id];
    registry.set(id, { kind: 'part', id, name, description, price, maxStack: INVENTORY.maxStack, sellPrice: null, color: PART_COLOR, hasQuality: false });
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

export function isPartItemId(value: unknown): value is RobotPartId {
  return isItemId(value) && getItem(value).kind === 'part';
}

/**
 * Shipping value of one unit of `itemId` at `quality`: the base price times the quality's
 * multiplier, rounded down. 0 for items that can't be shipped.
 */
export function sellPriceFor(itemId: ItemId, quality: Quality): number {
  const price = getItem(itemId).sellPrice;
  return price === null ? 0 : Math.floor(price * FARMING.qualityMultipliers[quality]);
}

/** What Sol pays for one `part` (farmclaws part 4b spec §3.2): half its price, rounded down. */
export function sellBackPrice(part: RobotPartId): number {
  return Math.floor(PARTS.prices[part] * PARTS.sellBackShare);
}
