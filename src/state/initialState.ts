import { INVENTORY, PLAYER, TOOLS, WORLD } from '../config';
import { SAVE_VERSION, type GameState } from '../core/types';
import { createInitialTime } from '../time/clock';
import { rollWeather } from '../time/weather';
import { createGridSpec } from '../world/grid';
import { generateWorld } from '../world/worldgen';
import { createInventory } from './inventory';

export function createInitialState(seed: number = WORLD.seed): GameState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`createInitialState: seed must be a 32-bit unsigned integer, got ${seed}`);
  }
  const grid = createGridSpec(WORLD.width, WORLD.depth, WORLD.chunkSize, WORLD.tileSize);
  const time = createInitialTime();
  return {
    version: SAVE_VERSION,
    seed,
    time,
    weather: rollWeather(seed, time.absoluteDay),
    world: generateWorld(seed, grid),
    player: {
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
    inventory: createInventory(INVENTORY.hotbarSize, INVENTORY.starting, TOOLS.wateringCanCapacity),
    shipping: { pending: [], lastPayout: 0 },
    ui: { shopOpen: false, paused: false, timeScale: 1 },
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
  };
}
