/**
 * Interpreter safety (farmclaws part 2 spec §14.2): random well-typed programs never make the
 * game throw. Each turn the interpreter acts, finishes its stack or gets dizzy, every exec it
 * returns or the game saves validates, and the farm still saves and loads.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, ROBOTS, TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { Blocker, DIRECTIONS, TileState, Weather, ZONE_IDS, type BlockProgram, type GameState, type Tile, type ZoneId, type ZoneRect } from '../src/core/types';
import { checkProgram } from '../src/robots/check';
import { stepProgram } from '../src/robots/interpret';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { isValidExec } from '../src/state/robotValidation';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { SAFE_AREA, SAFETY_BODY, chance, int, pick, programmed, randomProgram, type Rng } from './programGen';
import { BASE, HEAVY_TEST_TIMEOUT_MS, Violations, atDay, cropOf, matureCrop, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';

const PROGRAMS = 300;
/** Turns per program: one robot period each, so 30 turns is two game hours from 6:00. */
const TURNS = 30;
/** Every this many programs, the whole farm goes through a save and a load too. */
const SAVE_EVERY = 10;
const START = { tx: 9, tz: 13 } as const;

const TILES: readonly ((rng: Rng) => Tile)[] = [
  () => soilTile(TileState.Plowed),
  (rng) => soilTile(TileState.Watered, matureCrop(pick(rng, ['parsnip', 'potato', 'pumpkin'] as const))),
  () => soilTile(TileState.Plowed, cropOf('parsnip')),
  () => blockedTile(Blocker.Rock, 2),
  () => blockedTile(Blocker.Water),
  () => ({ ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, (_, i) => (i === 0 ? stack('parsnip', 3) : null)) } }),
  () => ({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }),
];

function randomRect(rng: Rng): ZoneRect {
  const w = int(rng, 1, 4);
  const d = int(rng, 1, 3);
  return { x0: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - w), z0: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - d), w, d };
}

/** A farm at 6:00 with random zones, weather and tiles, and robot 1 running `program` from START. */
function safetyFarm(rng: Rng, program: BlockProgram): GameState {
  const zones: Partial<Record<ZoneId, ZoneRect | null>> = {};
  for (const id of ZONE_IDS) zones[id] = chance(rng, 0.4) ? null : randomRect(rng);
  let state: GameState = {
    ...withZones(atDay(BASE, int(rng, 0, 27), TIME.dayStartMinute), zones),
    weather: pick(rng, [Weather.Sunny, Weather.Rain, Weather.Storm]),
  };
  for (let i = 0; i < 16; i++) {
    const at = { tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - 1), tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - 1) };
    if (at.tx === START.tx && at.tz === START.tz) continue;
    state = withTile(state, at, pick(rng, TILES)(rng), 'farm');
  }
  const body = robotOf({
    size: SAFETY_BODY.size,
    parts: [...SAFETY_BODY.parts],
    tx: START.tx,
    tz: START.tz,
    facing: pick(rng, DIRECTIONS),
    tokens: pick(rng, [500, 500, 500, 30]),
    tank: int(rng, 0, ROBOTS.tankCapacity),
    bag: [stack('parsnip_seeds', 5)],
  });
  return withRobots(state, [programmed(body, program)]);
}

describe('interpreter safety', () => {
  it(
    'runs random well-typed programs without throwing: every turn acts, finishes or gets dizzy, and every exec validates',
    () => {
      const v = new Violations();
      const rng = mulberry32(20261002);
      const seen = { act: 0, idle: 0, dizzy: 0 };
      for (let i = 0; i < PROGRAMS; i++) {
        const program = randomProgram(rng);
        const problem = checkProgram(program, SAFETY_BODY);
        if (problem !== null) {
          v.list.push(`program ${i} fails the checker: ${problem}`);
          continue;
        }
        let state = safetyFarm(rng, program);
        try {
          for (let turn = 0; turn < TURNS; turn++) {
            const robot = requireRobot(state, 1);
            if (robot.exec !== null && robot.exec.running !== null && robot.power === 'working' && robot.off === null && !robot.carried) {
              const step = stepProgram(state, robot);
              seen[step.kind]++;
              if (step.kind !== 'dizzy') v.check(isValidExec(step.exec, program), () => `program ${i} turn ${turn}: stepProgram returned an invalid exec`);
            }
            state = gameReducer(state, actions.tick(ROBOTS.period));
            const after = requireRobot(state, 1);
            v.check(after.exec !== null && isValidExec(after.exec, program), () => `program ${i} turn ${turn}: the robot's exec is invalid`);
          }
          if (i % SAVE_EVERY === 0) v.check(deserializeGame(serializeGame(state)) !== null, () => `program ${i}: the farm no longer loads`);
        } catch (error) {
          v.list.push(`program ${i} threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      expect(v.head()).toEqual([]);
      // The programs really ran: some acted and some finished their stacks.
      expect(seen.act).toBeGreaterThan(0);
      expect(seen.idle).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
