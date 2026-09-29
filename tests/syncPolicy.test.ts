/**
 * How main.ts fans a store change out to the scene, the render systems and the HUD
 * (src/render/syncPolicy.ts, spec §7.1), plus the camera re-bounding a map change relies on.
 *
 * - A load rebuilds everything, switches the grid and snaps the camera.
 * - A map change rebuilds the render systems and switches the grid, but the HUD keeps `prev`.
 * - A new `teleportSeq` snaps the camera; ordinary moves ease it.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Direction, type GameState, type MapId } from '../src/core/types';
import { CameraRig } from '../src/render/CameraRig';
import { classifySync } from '../src/render/syncPolicy';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { selectActiveWorld } from '../src/state/selectors';
import { worldRect } from '../src/world/grid';
import { getMap } from '../src/world/maps';
import { BASE, STAND, withPlayer } from './testUtils';

/** The player moved to another map the way a warp does it: new map, new tile, teleportSeq + 1. */
function warped(state: GameState, mapId: MapId, tx: number, tz: number, facing: Direction): GameState {
  const moved = withPlayer(state, { tx, tz }, facing, mapId);
  return { ...moved, player: { ...moved.player, teleportSeq: moved.player.teleportSeq + 1 } };
}

const FARM = withPlayer(BASE, STAND, Direction.South);
const FOREST = warped(FARM, 'forest', 34, 15, Direction.West);

describe('classifySync', () => {
  it('lets every system diff an ordinary change on the same map', () => {
    const next = gameReducer(FARM, actions.tick(1));
    expect(next).not.toBe(FARM);
    expect(classifySync(next, FARM, actions.tick(1))).toEqual({
      systemsPrev: 'prev',
      hudPrev: 'prev',
      setGrid: false,
      snapCamera: false,
    });
  });

  it('eases the camera after a step on the same map', () => {
    const next = gameReducer(FARM, actions.move(Direction.North));
    expect(next.player.moveSeq).toBe(FARM.player.moveSeq + 1);
    expect(classifySync(next, FARM, actions.move(Direction.North)).snapCamera).toBe(false);
  });

  it('snaps the camera on a teleport within the same map (sleep) but keeps diffing', () => {
    const next = gameReducer(FARM, actions.sleep());
    expect(next.player.mapId).toBe('farm');
    expect(next.player.teleportSeq).toBe(FARM.player.teleportSeq + 1);
    expect(classifySync(next, FARM, actions.sleep())).toEqual({
      systemsPrev: 'prev',
      hudPrev: 'prev',
      setGrid: false,
      snapCamera: true,
    });
  });

  it('rebuilds the render systems on a map change while the HUD keeps prev', () => {
    const action: GameAction = actions.move(Direction.West);
    expect(classifySync(FOREST, FARM, action)).toEqual({
      systemsPrev: 'null',
      hudPrev: 'prev',
      setGrid: true,
      snapCamera: true,
    });
    expect(classifySync(FARM, FOREST, action)).toEqual({
      systemsPrev: 'null',
      hudPrev: 'prev',
      setGrid: true,
      snapCamera: true,
    });
  });

  it('treats a map change as a rebuild even when teleportSeq did not move', () => {
    const sameSeq = withPlayer(FARM, { tx: 1, tz: 16 }, Direction.East, 'town');
    expect(sameSeq.player.teleportSeq).toBe(FARM.player.teleportSeq);
    expect(classifySync(sameSeq, FARM, actions.tick(1))).toEqual({
      systemsPrev: 'null',
      hudPrev: 'prev',
      setGrid: true,
      snapCamera: false,
    });
  });

  it('rebuilds everything on a load, on the same map or another one', () => {
    for (const loaded of [FARM, FOREST]) {
      const action = actions.load(loaded);
      const next = gameReducer(FARM, action);
      expect(next.player.mapId).toBe(loaded.player.mapId);
      expect(classifySync(next, FARM, action)).toEqual({
        systemsPrev: 'null',
        hudPrev: 'null',
        setGrid: true,
        snapCamera: true,
      });
    }
  });

  it('classifies a load by its action type alone, even if nothing visible changed', () => {
    expect(classifySync(FARM, FARM, { type: 'game/load' })).toEqual({
      systemsPrev: 'null',
      hudPrev: 'null',
      setGrid: true,
      snapCamera: true,
    });
  });

  it('is pure: frozen inputs, same answer twice', () => {
    const state = Object.freeze({ ...FOREST });
    const prev = Object.freeze({ ...FARM });
    const first = classifySync(state, prev, actions.move(Direction.West));
    expect(classifySync(state, prev, actions.move(Direction.West))).toEqual(first);
  });

  it('points the active world at the map the player stands on', () => {
    expect(selectActiveWorld(FOREST)).toBe(FOREST.maps.forest);
    expect(selectActiveWorld(FOREST).grid).toEqual(getMap('forest').grid);
  });
});

describe('CameraRig.setBounds (map change)', () => {
  const MARGIN = 3;
  const farm = worldRect(getMap('farm').grid);
  const forest = worldRect(getMap('forest').grid);

  function makeRig(): { rig: CameraRig; camera: THREE.OrthographicCamera } {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const rig = new CameraRig(camera, { getAspect: () => 16 / 9, bounds: farm, boundsMargin: MARGIN });
    return { rig, camera };
  }

  it('re-clamps the focus into the new bounds and moves the camera on the next update', () => {
    const { rig, camera } = makeRig();
    rig.snap(new THREE.Vector3(farm.maxX, 0, farm.maxZ));
    expect(rig.focus.x).toBe(farm.maxX);
    expect(farm.maxX).toBeGreaterThan(forest.maxX + MARGIN);
    const before = camera.position.clone();

    rig.setBounds(forest);
    expect(rig.focus.x).toBe(forest.maxX + MARGIN);
    expect(rig.focus.z).toBe(forest.maxZ + MARGIN);

    rig.update(0);
    expect(camera.position.x).toBeCloseTo(before.x - (farm.maxX - forest.maxX - MARGIN), 9);
  });

  it('clamps later follow and snap targets to the new bounds', () => {
    const { rig } = makeRig();
    rig.setBounds(forest);
    rig.snap(new THREE.Vector3(-1000, 0, 1000));
    expect(rig.focus.x).toBe(forest.minX - MARGIN);
    expect(rig.focus.z).toBe(forest.maxZ + MARGIN);

    rig.follow(new THREE.Vector3(1000, 0, -1000));
    rig.update(10);
    expect(rig.focus.x).toBeCloseTo(forest.maxX + MARGIN, 3);
    expect(rig.focus.z).toBeCloseTo(forest.minZ - MARGIN, 3);
  });

  it('leaves a focus that is already inside the new bounds where it is', () => {
    const { rig } = makeRig();
    rig.snap(new THREE.Vector3(0.25, 0, -0.5));
    rig.setBounds(forest);
    expect(rig.focus.x).toBe(0.25);
    expect(rig.focus.z).toBe(-0.5);
  });
});
