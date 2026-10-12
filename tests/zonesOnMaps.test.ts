/**
 * Zones on both maps (farmclaws part 4c spec §5.3): a zone lives on the farm or the Neighbours
 * map, the marker paints on either and moves a letter between them, a robot's `For each tile`,
 * `At edge of` and DON'T leave card only see zones on its own map, and the overlay and the chip
 * show the active map's zones.
 */
import { describe, expect, it } from 'vitest';
import { Direction, type GameState, type MdCard, type Robot, type TileCoord, type ZoneRect } from '../src/core/types';
import { overlayMapId } from '../src/render/ZoneRenderer';
import { b } from '../src/robots/blocks';
import { ZONE_OFF_MAP, withZone } from '../src/robots/edits';
import { evaluate } from '../src/robots/eval';
import { freshExec } from '../src/robots/exec';
import { startStack, stepProgram } from '../src/robots/interpret';
import { moveForbiddenBy } from '../src/robots/md';
import { zoneOf } from '../src/robots/zones';
import { actions } from '../src/state/actions';
import { ZONES_ON_ROBOT_MAPS, planPrimaryAction, planShiftInteraction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { zoneChipText } from '../src/ui/zoneChip';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, holding, robotOf, withPlayer, withTile, withZones } from './testUtils';

/** Zone A on each map, over the same tiles: inside Cosmo's field on the Neighbours map. */
const FARM_A: ZoneRect = { mapId: 'farm', x0: 4, z0: 8, w: 3, d: 3 };
const NEIGHBOURS_A: ZoneRect = { mapId: 'neighbours', x0: 4, z0: 8, w: 3, d: 3 };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };

const use = (state: GameState): GameState => gameReducer(state, actions.useTool());
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

/** Clears `tiles` on `mapId` to plain ground, so the marker and robots stand anywhere among them. */
function cleared(state: GameState, mapId: 'farm' | 'neighbours' | 'town', tiles: readonly TileCoord[]): GameState {
  return tiles.reduce((next, coord) => withTile(next, coord, EMPTY_TILE, mapId), state);
}

/** The 3×3 block x 4…6, z 8…10 and the tiles round it, cleared on both robot maps. */
const AROUND: TileCoord[] = [];
for (let tx = 3; tx <= 7; tx++) for (let tz = 7; tz <= 11; tz++) AROUND.push({ tx, tz });
const OPEN = cleared(cleared(BASE, 'farm', AROUND), 'neighbours', AROUND);

/** The marker in hand on `mapId`, standing on (4, 7) facing South, so (4, 8) is ahead. */
function marking(mapId: 'farm' | 'neighbours', state: GameState = OPEN): GameState {
  return withPlayer(holding(state, 'zoneMarker'), { tx: 4, tz: 7 }, Direction.South, mapId);
}

/** Paints the current letter from (4, 8) to (6, 10): the first press from (4, 7), the second from (6, 9). */
function paint3x3(state: GameState): GameState {
  const cornered = use(state);
  return use(withPlayer(cornered, { tx: 6, tz: 9 }, Direction.South));
}

describe('zoneOf', () => {
  it('returns the zone only on its own map', () => {
    const state = withZones(BASE, { A: NEIGHBOURS_A, B: FARM_A });
    expect(zoneOf(state, 'A', 'neighbours')).toEqual(NEIGHBOURS_A);
    expect(zoneOf(state, 'A', 'farm')).toBeNull();
    expect(zoneOf(state, 'B', 'farm')).toEqual(FARM_A);
    expect(zoneOf(state, 'B', 'neighbours')).toBeNull();
    expect(zoneOf(state, 'C', 'farm')).toBeNull();
  });

  it('accepts a rectangle that lies on its map, and says so in its refusal', () => {
    expect(withZone(BASE, 'A', { mapId: 'neighbours', x0: 21, z0: 17, w: 8, d: 8 })).not.toBeTypeOf('string');
    expect(withZone(BASE, 'A', { mapId: 'neighbours', x0: 38, z0: 26, w: 3, d: 3 })).toBe(ZONE_OFF_MAP);
    expect(ZONE_OFF_MAP).toBe('A zone is at least 1 × 1 tile and lies wholly inside its map.');
  });
});

describe('the marker on the Neighbours map', () => {
  it('paints a zone there, on the player’s map', () => {
    const state = marking('neighbours');
    expect(planPrimaryAction(state).intent).toEqual({ kind: 'zoneCorner', corner: { tx: 4, tz: 8 } });
    const cornered = use(state);
    expect(planPrimaryAction(cornered).intent).toEqual({ kind: 'markZone', zone: 'A', rect: { mapId: 'neighbours', x0: 4, z0: 8, w: 1, d: 1 } });
    const painted = paint3x3(state);
    expect(painted.robots.zones.A).toEqual(NEIGHBOURS_A);
    expect(lastText(painted)).toBe('Zone A · 3×3.');
  });

  it('moves a letter painted on one map to the other', () => {
    const onFarm = paint3x3(marking('farm'));
    expect(onFarm.robots.zones.A).toEqual(FARM_A);
    const moved = paint3x3(marking('neighbours', onFarm));
    expect(moved.robots.zones.A).toEqual(NEIGHBOURS_A);
    const back = paint3x3(marking('farm', moved));
    expect(back.robots.zones.A).toEqual(FARM_A);
  });

  it('clears a zone only from its own map; from the other it counts as empty', () => {
    const set = withZones(OPEN, { A: NEIGHBOURS_A });
    expect(planShiftInteraction(marking('farm', set)).intent).toEqual({ kind: 'blocked', reason: null });
    const farm = marking('farm', set);
    expect(gameReducer(farm, actions.peek())).toBe(farm);
    const cleared = gameReducer(marking('neighbours', set), actions.peek());
    expect(cleared.robots.zones.A).toBeNull();
    expect(lastText(cleared)).toBe('Cleared Zone A.');
  });

  it('is refused in town and the forest', () => {
    expect(ZONES_ON_ROBOT_MAPS).toBe("Zones go on your farm or the neighbours' fields.");
    for (const mapId of ['town', 'forest'] as const) {
      const here = { tx: 10, tz: 10 };
      const ahead = { tx: 10, tz: 11 };
      const away = withPlayer(withTile(withTile(holding(withZones(BASE, { A: FARM_A }), 'zoneMarker'), here, EMPTY_TILE, mapId), ahead, EMPTY_TILE, mapId), here, Direction.South, mapId);
      expect(planPrimaryAction(away).intent).toEqual({ kind: 'blocked', reason: ZONES_ON_ROBOT_MAPS });
      expect(lastText(use(away))).toBe(ZONES_ON_ROBOT_MAPS);
      expect(planShiftInteraction(away).intent).toEqual({ kind: 'blocked', reason: ZONES_ON_ROBOT_MAPS });
    }
  });
});

describe('robots only use zones on their own map', () => {
  const waterer = (overrides: Partial<Robot>): Robot => {
    const program = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.water()), b.say('Done'))] });
    return robotOf({ program, exec: startStack(freshExec(program), 0), parts: ['wateringHead'], tank: 20, tx: 5, tz: 7, ...overrides });
  };
  const farmBot = waterer({});
  const cosmoBot = waterer({ mapId: 'neighbours', owner: 'cosmo' });

  it("skip For each tile over a zone on the other map, as if it were empty", () => {
    const state = withZones(OPEN, { A: NEIGHBOURS_A });
    expect(stepProgram(state, farmBot)).toMatchObject({ kind: 'act', action: { kind: 'say', text: 'Done' } });
    expect(stepProgram(state, cosmoBot)).toMatchObject({ kind: 'act', action: { kind: 'move' } });
    const onFarm = withZones(OPEN, { A: FARM_A });
    expect(stepProgram(onFarm, farmBot)).toMatchObject({ kind: 'act', action: { kind: 'move' } });
    expect(stepProgram(onFarm, cosmoBot)).toMatchObject({ kind: 'act', action: { kind: 'say', text: 'Done' } });
  });

  it("ignore a DON'T leave card's zone on the other map", () => {
    const inside: TileCoord = { tx: 4, tz: 8 };
    const outside: TileCoord = { tx: 4, tz: 7 };
    const state = withZones(OPEN, { A: NEIGHBOURS_A });
    expect(moveForbiddenBy({ ...farmBot, md: [LEAVE_A] }, inside, outside, state)).toBeNull();
    expect(moveForbiddenBy({ ...cosmoBot, md: [LEAVE_A] }, inside, outside, state)).toEqual(LEAVE_A);
  });

  it('read At edge of only for a zone on their own map', () => {
    const state = withZones(OPEN, { A: NEIGHBOURS_A });
    const ctx = (robot: Robot) => ({ state, robot, program: b.program({ stacks: [] }), vars: [] });
    expect(evaluate(b.atEdgeOf('A'), ctx({ ...farmBot, tx: 4, tz: 8 }))).toEqual({ type: 'yesNo', value: false });
    expect(evaluate(b.atEdgeOf('A'), ctx({ ...cosmoBot, tx: 4, tz: 8 }))).toEqual({ type: 'yesNo', value: true });
  });
});

describe('the overlay and the chip', () => {
  const both = withZones(OPEN, { A: NEIGHBOURS_A, B: FARM_A });

  it('show the active map’s zones while the marker is in hand or a robot screen is open', () => {
    expect(overlayMapId(marking('farm', both))).toBe('farm');
    expect(overlayMapId(marking('neighbours', both))).toBe('neighbours');
    const robotScreen: GameState = { ...withPlayer(both, { tx: 4, tz: 7 }, Direction.South, 'neighbours'), ui: { ...both.ui, panel: { kind: 'robot', robotId: 1, mode: 'peek' } } };
    expect(overlayMapId(robotScreen)).toBe('neighbours');
    expect(overlayMapId(withPlayer(both, { tx: 4, tz: 7 }, Direction.South, 'neighbours'))).toBeNull();
    const town = withPlayer(holding(both, 'zoneMarker'), { tx: 10, tz: 10 }, Direction.South, 'town');
    expect(overlayMapId(town)).toBeNull();
  });

  it('names a zone’s size only on its own map', () => {
    expect(zoneChipText(marking('neighbours', both))).toBe('Zone A · 3×3');
    expect(zoneChipText(marking('farm', both))).toBe('Zone A · not set');
    const pickB = gameReducer(marking('farm', both), actions.cycleZoneLetter());
    expect(zoneChipText(pickB)).toBe('Zone B · 3×3');
  });
});
