/**
 * A multi-robot fuzz (farmclaws part 3 final review): seeded farms with six working robots (three
 * looping scripts that move, three random block programs), water, a wood burner and crops nearby,
 * and a switched-off robot on the bench, run for three days in two-hour ticks. After every tick:
 * no two standing robots (not carried, not away for repairs, not on the bench) share a tile, the
 * bench robot hasn't moved and is still `off: 'player'`, and the farm saves and loads.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { Blocker, DIRECTIONS, TileState, ZONE_IDS, type GameState, type Robot, type RobotProgram, type ZoneId, type ZoneRect } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { MAPS, isReservedTile } from '../src/world/maps';
import { EMPTY_TILE, blockedTile, getTile, isWalkable } from '../src/world/tiles';
import { SAFE_AREA, SAFETY_BODY, chance, int, pick, randomProgram, addBlockRobot, type Rng } from './programGen';
import { BASE, HEAVY_TEST_TIMEOUT_MS, Violations, atDay, benchedRobotOf, matureCrop, must, soilTile, withTile, withZones } from './testUtils';

const FARMS = 30;
const SEED = 20261004;
/** Two-hour ticks over three days. */
const TICK_MINUTES = 120;
const TICKS = (3 * 24 * 60) / TICK_MINUTES;
const SCRIPTS = 3;
const GENERATED = 3;

const SCRIPT_STEPS: readonly RobotProgram[] = [
  { kind: 'script', steps: [{ kind: 'move' }, { kind: 'move' }, { kind: 'turn', side: 'left' }], loop: true },
  { kind: 'script', steps: [{ kind: 'move' }, { kind: 'turn', side: 'right' }], loop: true },
  { kind: 'script', steps: [{ kind: 'move' }, { kind: 'move' }, { kind: 'move' }, { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }], loop: true },
];

function randomRect(rng: Rng): ZoneRect {
  const w = int(rng, 2, 5);
  const d = int(rng, 2, 4);
  return { x0: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - w), z0: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - d), w, d };
}

/** A farm at 6:00 with six field robots on distinct tiles, hazards and crops around them, and a switched-off robot on the bench. */
function fuzzFarm(rng: Rng): GameState {
  const zones: Partial<Record<ZoneId, ZoneRect | null>> = {};
  for (const id of ZONE_IDS) zones[id] = chance(rng, 0.4) ? null : randomRect(rng);
  let state = withZones(atDay(BASE, int(rng, 0, 27), TIME.dayStartMinute), zones);

  // Robots first, one tile each, close together so they meet.
  const used = new Set<string>();
  const open = (at: { tx: number; tz: number }): boolean => {
    const tile = getTile(state.maps.farm, at.tx, at.tz);
    return tile !== null && isWalkable(tile) && tile.object === null && !isReservedTile(MAPS.farm, at.tx, at.tz);
  };
  const freeSpot = (): { tx: number; tz: number } => {
    for (;;) {
      const at = { tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + 7), tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + 4) };
      if (!used.has(`${at.tx},${at.tz}`) && open(at)) {
        used.add(`${at.tx},${at.tz}`);
        return at;
      }
    }
  };
  for (let i = 0; i < SCRIPTS; i++) {
    const added = addRobot(state, { name: `Loop${i}`, size: 'mini', parts: ['claw'], place: { ...freeSpot(), facing: pick(rng, DIRECTIONS) }, program: must(SCRIPT_STEPS[i]) });
    if ('error' in added) throw new Error(added.error);
    state = added.state;
  }
  for (let i = 0; i < GENERATED; i++) {
    state = addBlockRobot(state, {
      name: `Gen${i}`,
      size: SAFETY_BODY.size,
      parts: [...SAFETY_BODY.parts],
      place: { ...freeSpot(), facing: pick(rng, DIRECTIONS) },
      program: randomProgram(rng),
    });
  }

  // Water, a burner and crops nearby, never under a robot.
  const hazards: readonly (() => ReturnType<typeof soilTile>)[] = [
    () => blockedTile(Blocker.Water),
    () => blockedTile(Blocker.Water),
    () => ({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 5 } }),
    () => soilTile(TileState.Watered, matureCrop('parsnip')),
    () => soilTile(TileState.Plowed),
  ];
  for (let placed = 0; placed < 14; ) {
    const at = { tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + 9), tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + 5) };
    if (used.has(`${at.tx},${at.tz}`) || !open(at)) continue;
    used.add(`${at.tx},${at.tz}`);
    state = withTile(state, at, pick(rng, hazards)(), 'farm');
    placed++;
  }

  const id = state.robots.nextId;
  const sleeper = benchedRobotOf({ id, name: 'Sleeper', program: { kind: 'script', steps: [{ kind: 'move' }], loop: true }, off: 'player' });
  return { ...state, robots: { ...state.robots, list: [...state.robots.list, sleeper], nextId: id + 1 } };
}

const standing = (robot: Robot): boolean => !robot.carried && robot.power !== 'repairing' && !robot.onBench;

describe('the multi-robot fuzz', () => {
  it(
    'keeps standing robots apart, the bench robot still and off, and the farm loadable, over three days',
    () => {
      const v = new Violations();
      let moves = 0;
      for (let farm = 0; farm < FARMS; farm++) {
        const rng = mulberry32(SEED + farm);
        let state = fuzzFarm(rng);
        const sleeperId = state.robots.nextId - 1;
        const sleeper = requireRobot(state, sleeperId);
        try {
          for (let tick = 0; tick < TICKS; tick++) {
            state = gameReducer(state, actions.tick(TICK_MINUTES));
            const where = `farm ${farm} tick ${tick}`;
            const seen = new Map<string, number>();
            for (const robot of state.robots.list) {
              if (!standing(robot)) continue;
              const key = `${robot.tx},${robot.tz}`;
              const other = seen.get(key);
              v.check(other === undefined, () => `${where}: robots ${String(other)} and ${robot.id} share (${key})`);
              seen.set(key, robot.id);
            }
            const now = requireRobot(state, sleeperId);
            v.check(
              now.onBench && now.tx === sleeper.tx && now.tz === sleeper.tz && now.off === 'player',
              () => `${where}: the bench robot moved or came on (${now.tx},${now.tz} onBench ${String(now.onBench)} off ${String(now.off)})`,
            );
            v.check(deserializeGame(serializeGame(state)) !== null, () => `${where}: the farm no longer loads`);
          }
          moves += state.robots.list.reduce((sum, robot) => sum + robot.moveSeq, 0);
        } catch (error) {
          v.list.push(`farm ${farm} threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      expect(v.head()).toEqual([]);
      // The robots really walked about (the bench robot never does), so the checks above had something to catch.
      expect(moves).toBeGreaterThan(FARMS * 20);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
