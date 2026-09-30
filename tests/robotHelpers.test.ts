/**
 * Robot helper modules: harvested tiles, robot lookup, bag and chest arithmetic, the farm log.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { Blocker, TileState, type ItemStack } from '../src/core/types';
import { harvestedTile } from '../src/farming/harvest';
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, takeIntoBag } from '../src/robots/bag';
import { logRobotEvent, pruneRobotLog } from '../src/robots/log';
import { containerOf, nearestWalkable, robotsOnTile, withRobot } from '../src/robots/world';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, atDay, matureCrop, robotOf, soilTile, stack, withRobots, withTile } from './testUtils';

const empties = (n: number): (ItemStack | null)[] => Array.from({ length: n }, () => null);

describe('harvestedTile', () => {
  it('clears a one-off crop and its fertiliser, and drops a regrowing crop back a stage', () => {
    const parsnip = { ...soilTile(TileState.Watered, matureCrop('parsnip')), fertilizer: 'basic' as const };
    expect(harvestedTile(parsnip)).toEqual({ ...parsnip, crop: null, fertilizer: null });
    const berry = { ...soilTile(TileState.Plowed, matureCrop('strawberry')), fertilizer: 'basic' as const };
    const after = harvestedTile(berry);
    expect(after.crop?.regrowing).toBe(true);
    expect(after.crop?.harvestCount).toBe(1);
    expect(after.fertilizer).toBe('basic');
  });
});

describe('robot world helpers', () => {
  it('finds robots on a tile, skipping carried and repairing ones', () => {
    const state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, carried: true }), robotOf({ id: 3, power: 'repairing', repairReadyDay: 1 }), robotOf({ id: 4 })]);
    expect(robotsOnTile(state, TARGET.tx, TARGET.tz).map((r) => r.id)).toEqual([1, 4]);
  });

  it('keeps the state when a robot is replaced by itself or an identical copy', () => {
    const state = withRobots(BASE, [robotOf()]);
    const robot = state.robots.list[0]!;
    expect(withRobot(state, robot)).toBe(state);
    expect(withRobot(state, { ...robot })).toBe(state);
    expect(withRobot(state, { ...robot, tokens: 1 }).robots.list[0]?.tokens).toBe(1);
  });

  it('names chests and the shipping bin as containers', () => {
    expect(containerOf({ ...EMPTY_TILE, object: { kind: 'chest', slots: empties(36) } })).toBe('chest');
    expect(containerOf(blockedTile(Blocker.ShippingBin))).toBe('bin');
    expect(containerOf(EMPTY_TILE)).toBeNull();
    expect(containerOf(null)).toBeNull();
  });

  it('finds the nearest walkable tile', () => {
    const blocked = withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm');
    expect(nearestWalkable(blocked.maps.farm, TARGET)).toEqual({ tx: TARGET.tx, tz: TARGET.tz - 1 });
    expect(nearestWalkable(BASE.maps.farm, TARGET)).toEqual(TARGET);
  });
});

describe('bag arithmetic', () => {
  it('adds into matching stacks, then new stacks up to the limit', () => {
    const { bag, added } = addToBag([stack('parsnip', 998)], 2, 'parsnip', 5);
    expect(added).toBe(5);
    expect(bag).toEqual([stack('parsnip', 999), stack('parsnip', 4)]);
    expect(addToBag(bag, 2, 'wood', 1).added).toBe(0);
    expect(bagRoom([stack('parsnip', 990)], 1, 'parsnip', 0)).toBe(9);
    expect(bagRoom([stack('parsnip', 990)], 1, 'parsnip', 1)).toBe(0);
  });

  it('removes lowest quality first and counts every quality', () => {
    const bag = [stack('parsnip', 2, 1), stack('parsnip', 1, 0)];
    expect(bagCount(bag, 'parsnip')).toBe(3);
    expect(removeFromBag(bag, 'parsnip', 2)).toEqual([stack('parsnip', 1, 1)]);
  });

  it('adds to chest slots like the inventory and takes lowest quality first', () => {
    const slots = [stack('wood', 999), null, stack('wood', 5)];
    const { slots: after, added } = addToSlots(slots, stack('wood', 10));
    expect(added).toBe(10);
    expect(after).toEqual([stack('wood', 999), null, stack('wood', 15)]);
    const chest = [stack('parsnip', 3, 2), stack('parsnip', 2, 0)];
    const taken = takeIntoBag(chest, [], 1, 'parsnip');
    expect(taken.moved).toBe(2);
    expect(taken.bag).toEqual([stack('parsnip', 2, 0)]);
    expect(taken.slots).toEqual([stack('parsnip', 3, 2), null]);
  });
});

describe('farm log', () => {
  it('collapses identical consecutive events of one robot and keeps the first tile and time', () => {
    let state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2 })]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(state, 2, { kind: 'flat' });
    state = logRobotEvent(state, 1, { kind: 'flat' });
    expect(state.robots.log.entries.map((e) => [e.robotId, e.count])).toEqual([[1, 2], [2, 1]]);
    state = logRobotEvent(state, 1, { kind: 'finished' });
    expect(state.robots.log.entries).toHaveLength(3);
    expect(state.robots.log.nextId).toBe(3);
  });

  it('keeps the newest entries within capacity and prunes days before yesterday', () => {
    let state = withRobots(BASE, [robotOf()]);
    for (let i = 0; i < ROBOTS.logCapacity + 5; i++) {
      state = logRobotEvent(state, 1, i % 2 === 0 ? { kind: 'flat' } : { kind: 'finished' });
    }
    expect(state.robots.log.entries).toHaveLength(ROBOTS.logCapacity);
    const later = pruneRobotLog(atDay(state, 2));
    expect(later.robots.log.entries).toHaveLength(0);
    expect(pruneRobotLog(atDay(state, 1)).robots.log).toBe(state.robots.log);
  });
});
