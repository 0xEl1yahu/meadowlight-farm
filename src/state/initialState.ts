import { INVENTORY, PLAYER, TOOLS, UNLOCKS, WORKBENCH, WORLD } from '../config';
import { invariant } from '../core/invariant';
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type InventoryState, type NpcId, type NpcRelation } from '../core/types';
import { createInitialTime } from '../time/clock';
import { rollWeather } from '../time/weather';
import { withWorkbenchAt } from '../robots/workbench';
import { generateMaps } from '../world/maps';
import { createInventory } from './inventory';
import { withZoneMarker } from './zoneMarker';

/**
 * Defaults for every section later workstreams fill in. A new game and the save migration both
 * start from these, so an old save gains exactly the state a fresh game would have.
 */
export function createDefaultSections(): GameSections {
  const npcs = {} as Record<NpcId, NpcRelation>;
  for (const id of NPC_IDS) {
    npcs[id] = { points: 0, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 0 };
  }
  return {
    profile: {
      playerName: 'Farmer',
      farmName: 'Meadowlight',
      appearance: { skinTone: 0, hairStyle: 0, hairColor: 0, shirtColor: 0, overallsColor: 0, hat: 0 },
    },
    tools: { levels: { hoe: 0, wateringCan: 0, pickaxe: 0, axe: 0 }, upgrade: null },
    crafting: { known: ['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'basicFertilizer'] },
    cooking: { known: ['friedMushrooms', 'veggieStew'], kitchenLevel: 0 },
    buildings: [],
    nextEntityId: 1,
    npcs,
    quests: { completed: [], board: null },
    stats: {
      parsnipsShipped: 0,
      debrisCleared: 0,
      forageFound: 0,
      totalEarned: 0,
      visitedTown: false,
      craftedChest: false,
      builtCoop: false,
    },
    festival: { activeDay: -1, eggsFound: 0, lanternReleased: false, display: [], giftTarget: null, giftGiven: false },
    robots: {
      nextId: 1,
      list: [],
      pool: 0,
      log: { nextId: 0, entries: [] },
      lastNightFuel: { wood: 0, tokens: 0 },
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      pendingMarker: false,
      unlocks: UNLOCKS.job1,
    },
  };
}

/** The starter kit, with the zone marker in the first slot it leaves free (farmclaws part 3 spec §8). */
function starterInventory(): InventoryState {
  const inventory = withZoneMarker(createInventory(INVENTORY.starting, TOOLS.wateringCanCapacity));
  invariant(inventory !== null, 'the starter kit leaves room for the zone marker');
  return inventory;
}

export function createInitialState(seed: number = WORLD.seed): GameState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`createInitialState: seed must be a 32-bit unsigned integer, got ${seed}`);
  }
  const time = createInitialTime();
  const maps = generateMaps(seed);
  return {
    version: SAVE_VERSION,
    seed,
    time,
    weather: rollWeather(seed, time.absoluteDay),
    // The workbench is built into every farm (part 3 spec §2.1); its home is clear on every generated farm.
    maps: { ...maps, farm: withWorkbenchAt(maps.farm, WORKBENCH.home) },
    player: {
      mapId: 'farm',
      tx: PLAYER.spawn.tx,
      tz: PLAYER.spawn.tz,
      facing: PLAYER.spawnFacing,
      energy: PLAYER.maxEnergy,
      maxEnergy: PLAYER.maxEnergy,
      gold: PLAYER.startingGold,
      moveSeq: 0,
      teleportSeq: 0,
      actionSeq: 0,
      lastAction: null,
      carrying: null,
    },
    inventory: starterInventory(),
    shipping: { pending: [], lastPayout: 0 },
    ui: { panel: { kind: 'none' }, paused: false, timeScale: 1, zoneDraft: null, zoneLetter: 'A' },
    messages: {
      nextId: 2,
      entries: [
        {
          id: 0,
          text: 'Welcome to Meadowlight Farm! Till soil, scatter your parsnip seeds, water them, then sleep.',
          tone: 'info',
          day: time.absoluteDay,
          minute: time.minuteOfDay,
        },
        {
          id: 1,
          text: 'Mushrooms sprout on their own in the shade by the woods and the house. Forage them with E.',
          tone: 'info',
          day: time.absoluteDay,
          minute: time.minuteOfDay,
        },
      ],
    },
    ...createDefaultSections(),
  };
}
