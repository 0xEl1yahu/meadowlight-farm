import { INVENTORY, PLAYER, TOOLS, WORLD } from '../config';
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type NpcId, type NpcRelation } from '../core/types';
import { createInitialTime } from '../time/clock';
import { rollWeather } from '../time/weather';
import { generateMaps } from '../world/maps';
import { createInventory } from './inventory';

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
  };
}

export function createInitialState(seed: number = WORLD.seed): GameState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`createInitialState: seed must be a 32-bit unsigned integer, got ${seed}`);
  }
  const time = createInitialTime();
  return {
    version: SAVE_VERSION,
    seed,
    time,
    weather: rollWeather(seed, time.absoluteDay),
    maps: generateMaps(seed),
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
    },
    inventory: createInventory(INVENTORY.starting, TOOLS.wateringCanCapacity),
    shipping: { pending: [], lastPayout: 0 },
    ui: { panel: { kind: 'none' }, paused: false, timeScale: 1 },
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
