/**
 * Warps between maps (spec §5.1), through the real `player/move` action.
 *
 * Stepping off a map's edge from a warp tile, in the warp's exit direction, puts the player on
 * the warp's arrival tile on the other map, facing into it: `teleportSeq` goes up, `moveSeq`
 * does not, and nothing else in the state changes. Every other step off an edge is blocked, a
 * held key can't bounce the player straight back, and a warp whose arrival tile isn't walkable
 * is refused. Entering the town for the first time sets `stats.visitedTown`.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, TIME } from '../src/config';
import { Blocker, DIRECTIONS, Direction, MAP_IDS, type GameState, type MapId, type Tile, type TileCoord } from '../src/core/types';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { inBounds, stepTile } from '../src/world/grid';
import { MAPS, findWarp, type Warp } from '../src/world/maps';
import { EMPTY_TILE, blockedTile, isWalkable } from '../src/world/tiles';
import { BASE, atDay, must, tileAt, withPlayer, withTile } from './testUtils';

function run(state: GameState, ...sequence: readonly GameAction[]): GameState {
  return sequence.reduce(gameReducer, state);
}

function move(state: GameState, direction: Direction): GameState {
  return gameReducer(state, actions.move(direction));
}

function opposite(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

/**
 * Stands the player on (tx, tz) of `mapId` facing `facing`, whatever the tile holds: the edge
 * rules never look at the tile the player stands on.
 */
function standAt(state: GameState, mapId: MapId, tx: number, tz: number, facing: Direction): GameState {
  return { ...state, player: { ...state.player, mapId, tx, tz, facing } };
}

/** Every warp of every map, labelled for failure messages. */
const WARPS: readonly { readonly mapId: MapId; readonly warp: Warp; readonly label: string }[] = MAP_IDS.flatMap((mapId) =>
  MAPS[mapId].warps.map((warp) => ({ mapId, warp, label: `${mapId} (${warp.from.tx}, ${warp.from.tz}) → ${warp.to.mapId}` })),
);

/** The player standing on the warp's edge tile, facing along the map edge (not yet at the exit). */
function onWarpTile(mapId: MapId, warp: Warp, state: GameState = BASE): GameState {
  return withPlayer(state, warp.from, ((warp.exit + 1) % 4) as Direction, mapId);
}

function expectArrived(prev: GameState, next: GameState, warp: Warp): void {
  expect(next.player).toEqual({
    ...prev.player,
    mapId: warp.to.mapId,
    tx: warp.to.tx,
    tz: warp.to.tz,
    facing: warp.to.facing,
    teleportSeq: prev.player.teleportSeq + 1,
  });
  expect(next.player.moveSeq).toBe(prev.player.moveSeq);
  expect(next.maps).toBe(prev.maps);
  expect(next.time).toBe(prev.time);
  expect(next.inventory).toBe(prev.inventory);
  expect(next.messages).toBe(prev.messages);
}

describe('taking a warp', () => {
  it('has four warps: the farm gates to the forest and the town, and one back from each', () => {
    expect(WARPS.map(({ label }) => label)).toEqual([
      'farm (0, 13) → forest',
      'farm (47, 38) → town',
      'forest (35, 15) → farm',
      'town (0, 16) → farm',
    ]);
  });

  it('moves the player onto the arrival tile of the other map, facing into it, as a teleport', () => {
    for (const { mapId, warp, label } of WARPS) {
      const state = onWarpTile(mapId, warp);
      expect(isWalkable(tileAt(state, warp.from)), label).toBe(true);
      const next = move(state, warp.exit);
      expectArrived(state, next, warp);
      // The arrival tile is one tile inside the edge, and the arrival facing looks into the map.
      const grid = MAPS[warp.to.mapId].grid;
      const ahead = stepTile(warp.to, warp.to.facing);
      expect(inBounds(grid, ahead.tx, ahead.tz), label).toBe(true);
      const behind = stepTile(warp.to, opposite(warp.to.facing));
      expect(findWarp(MAPS[warp.to.mapId], behind.tx, behind.tz, opposite(warp.to.facing)), label).not.toBeNull();
    }
  });

  it('walks from the farm to the forest and back through the west gate', () => {
    const start = withPlayer(BASE, { tx: 1, tz: 13 }, Direction.North, 'farm');
    const atGate = move(start, Direction.West);
    expect(atGate.player).toMatchObject({ mapId: 'farm', tx: 0, tz: 13, facing: Direction.West, moveSeq: 1, teleportSeq: 0 });
    const inForest = move(atGate, Direction.West);
    expect(inForest.player).toMatchObject({ mapId: 'forest', tx: 34, tz: 15, facing: Direction.West, moveSeq: 1, teleportSeq: 1 });
    const forestEdge = move(inForest, Direction.East);
    expect(forestEdge.player).toMatchObject({ mapId: 'forest', tx: 35, tz: 15, facing: Direction.East, moveSeq: 2, teleportSeq: 1 });
    const home = move(forestEdge, Direction.East);
    expect(home.player).toMatchObject({ mapId: 'farm', tx: 1, tz: 13, facing: Direction.East, moveSeq: 2, teleportSeq: 2 });
    expect(home.stats).toBe(BASE.stats);
    expect(home.maps).toBe(BASE.maps);
  });

  it('walks from the farm to the town and back through the south-east gate, visiting the town once', () => {
    const start = withPlayer(BASE, { tx: 46, tz: 38 }, Direction.North, 'farm');
    expect(start.stats.visitedTown).toBe(false);
    const inTown = run(start, actions.move(Direction.East), actions.move(Direction.East));
    expect(inTown.player).toMatchObject({ mapId: 'town', tx: 1, tz: 16, facing: Direction.East, moveSeq: 1, teleportSeq: 1 });
    expect(inTown.stats).toEqual({ ...BASE.stats, visitedTown: true });
    const home = run(inTown, actions.move(Direction.West), actions.move(Direction.West));
    expect(home.player).toMatchObject({ mapId: 'farm', tx: 46, tz: 38, facing: Direction.West, moveSeq: 2, teleportSeq: 2 });
    expect(home.stats).toBe(inTown.stats);
    // A second visit keeps the flag (and the stats object) as it is.
    const again = run(home, actions.move(Direction.East), actions.move(Direction.East));
    expect(again.player).toMatchObject({ mapId: 'town', tx: 1, tz: 16, teleportSeq: 3 });
    expect(again.stats).toBe(inTown.stats);
  });

  it('does not mark the town visited when entering the forest', () => {
    const forest = must(MAPS.farm.warps.find((warp) => warp.to.mapId === 'forest'));
    expect(move(onWarpTile('farm', forest), forest.exit).stats).toBe(BASE.stats);
  });
});

describe('edges without a warp', () => {
  it('block every step off every map edge that has no warp, only turning the player', () => {
    let blocked = 0;
    for (const mapId of MAP_IDS) {
      const def = MAPS[mapId];
      for (let tz = 0; tz < def.grid.depth; tz++) {
        for (let tx = 0; tx < def.grid.width; tx++) {
          for (const direction of DIRECTIONS) {
            const out = stepTile({ tx, tz }, direction);
            if (inBounds(def.grid, out.tx, out.tz) || findWarp(def, tx, tz, direction) !== null) continue;
            const facingAway = standAt(BASE, mapId, tx, tz, opposite(direction));
            const turned = move(facingAway, direction);
            expect(turned.player).toEqual({ ...facingAway.player, facing: direction });
            expect(turned.maps).toBe(BASE.maps);
            // Already facing the edge: nothing changes at all.
            expect(move(turned, direction)).toBe(turned);
            blocked++;
          }
        }
      }
    }
    // Every edge step of the farm (48 × 40), forest (36 × 30) and town (40 × 32), minus the four warps.
    expect(blocked).toBe(2 * (48 + 40) + 2 * (36 + 30) + 2 * (40 + 32) - 4);
  });

  it('only warps in the exit direction: the gate tile itself turns or steps like any other tile', () => {
    for (const { mapId, warp, label } of WARPS) {
      for (const direction of DIRECTIONS) {
        if (direction === warp.exit) continue;
        const next = move(onWarpTile(mapId, warp), direction);
        expect(next.player.mapId, label).toBe(mapId);
        expect(next.player.teleportSeq, label).toBe(0);
      }
    }
  });
});

describe('arriving', () => {
  it('can never bounce a held key straight back: repeating the step walks on into the new map', () => {
    for (const { mapId, warp, label } of WARPS) {
      // Clear the few tiles ahead so the held key really walks (debris on the farm depends on the seed).
      let state = onWarpTile(mapId, warp);
      let ahead: TileCoord = warp.to;
      for (let i = 0; i < 3; i++) {
        ahead = stepTile(ahead, warp.to.facing);
        state = withTile(state, ahead, EMPTY_TILE, warp.to.mapId);
      }
      state = move(state, warp.exit);
      expect(state.player.mapId, label).toBe(warp.to.mapId);
      let expected: TileCoord = warp.to;
      for (let i = 1; i <= 3; i++) {
        state = move(state, warp.to.facing);
        expected = stepTile(expected, warp.to.facing);
        expect(state.player, label).toMatchObject({ mapId: warp.to.mapId, ...expected, moveSeq: i, teleportSeq: 1 });
      }
    }
  });

  it('refuses a warp whose arrival tile is blocked by a placed object or a blocker, like a blocked step', () => {
    const chest = { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } } as const;
    const blockers: readonly Tile[] = [chest, { ...EMPTY_TILE, object: { kind: 'woodFence' } }, blockedTile(Blocker.Rock, 2)];
    for (const { mapId, warp, label } of WARPS) {
      for (const tile of blockers) {
        const state = withTile(onWarpTile(mapId, warp), warp.to, tile, warp.to.mapId);
        const next = move(state, warp.exit);
        expect(next.player, label).toEqual({ ...state.player, facing: warp.exit });
        expect(next.maps).toBe(state.maps);
        expect(next.stats).toBe(state.stats);
        expect(move(next, warp.exit)).toBe(next);
      }
      // A path is walkable, so a path on the arrival tile lets the warp through.
      const path = withTile(onWarpTile(mapId, warp), warp.to, { ...EMPTY_TILE, object: { kind: 'stonePath' } }, warp.to.mapId);
      expect(move(path, warp.exit).player.mapId, label).toBe(warp.to.mapId);
    }
  });

  it('is frozen with the rest of the player while paused or shopping', () => {
    const { mapId, warp } = must(WARPS[0]);
    const state = onWarpTile(mapId, warp);
    for (const frozen of [run(state, actions.setPaused(true)), run(state, actions.setShopOpen(true))]) {
      expect(move(frozen, warp.exit)).toBe(frozen);
    }
  });

  it('wakes up on the farm after sleeping (or passing out) on another map', () => {
    for (const mapId of ['forest', 'town'] as const) {
      const warp = must(MAPS[mapId].warps[0], `${mapId} has no warps`);
      const away = withPlayer(BASE, warp.from, Direction.South, mapId);
      const late = atDay(away, 0, TIME.passOutMinute - 1);
      for (const next of [gameReducer(away, actions.sleep()), gameReducer(late, actions.tick(1))]) {
        expect(next.time.absoluteDay).toBe(1);
        expect(next.player).toMatchObject({
          mapId: 'farm',
          tx: PLAYER.spawn.tx,
          tz: PLAYER.spawn.tz,
          facing: PLAYER.spawnFacing,
          teleportSeq: away.player.teleportSeq + 1,
        });
      }
    }
  });
});
