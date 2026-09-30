/**
 * Robots follow the player's tile rules: for every kind of tile, a robot's till, water and
 * harvest succeed exactly when the player's hoe, watering can and scythe would, and a
 * harvest yields the same size and quality.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, TileState, type GameState, type Tile } from '../src/core/types';
import { applyRobotPlan, planRobotAction } from '../src/robots/execute';
import { requireRobot } from '../src/robots/world';
import { planPrimaryAction } from '../src/state/intents';
import { forEachTile, blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, Violations, cropOf, holding, matureCrop, robotOf, scenario, soilTile, stack, withRobots } from './testUtils';

function distinctFarmTiles(): Tile[] {
  const seen = new Map<string, Tile>();
  forEachTile(BASE.maps.farm, (tile) => {
    seen.set(JSON.stringify(tile), tile);
  });
  const crafted: Tile[] = [
    EMPTY_TILE,
    soilTile(TileState.Plowed),
    soilTile(TileState.Watered),
    soilTile(TileState.Plowed, cropOf('parsnip')),
    soilTile(TileState.Watered, matureCrop('parsnip')),
    soilTile(TileState.Watered, matureCrop('strawberry')),
    soilTile(TileState.Plowed, matureCrop('parsnip', { dead: true })),
    { ...EMPTY_TILE, crop: matureCrop('mushroom', { wild: true }) },
    { ...soilTile(TileState.Plowed), fertilizer: 'quality' },
    { ...soilTile(TileState.Watered, matureCrop('cauliflower')), fertilizer: 'quality' },
    { ...EMPTY_TILE, object: { kind: 'woodPath' } },
    { ...soilTile(TileState.Plowed), object: { kind: 'sprinkler' } },
    blockedTile(Blocker.Rock, 2),
    blockedTile(Blocker.Water),
    blockedTile(Blocker.Weeds),
  ];
  for (const tile of crafted) seen.set(JSON.stringify(tile), tile);
  return [...seen.values()];
}

/** A Big robot on the scenario's target tile, with `overrides` (its parts). */
function robotOn(state: GameState, overrides: Parameters<typeof robotOf>[0]) {
  const robot = robotOf({ size: 'big', tank: 5, ...overrides });
  return { robot, state: withRobots(state, [robot]) };
}

describe('robot and player tile rules agree', () => {
  it('for tilling, watering and harvesting on every kind of farm tile', () => {
    const v = new Violations();
    let harvests = 0;
    for (const tile of distinctFarmTiles()) {
      const state = scenario(tile);
      const label = JSON.stringify(tile);

      const hoe = planPrimaryAction(holding(state, 'hoe')).intent.kind === 'till';
      const tiller = robotOn(state, { parts: ['tiller'] });
      v.equal(`till ${label}`, planRobotAction(tiller.state, tiller.robot, { kind: 'till' }).ok, hoe);

      const can = planPrimaryAction(holding(state, 'wateringCan')).intent.kind === 'water';
      const waterer = robotOn(state, { parts: ['wateringHead'] });
      v.equal(`water ${label}`, planRobotAction(waterer.state, waterer.robot, { kind: 'water' }).ok, can);

      const scythe = planPrimaryAction(holding(state, 'scythe')).intent;
      const harvester = robotOn(state, { parts: ['claw', 'basket'] });
      const robotPlan = planRobotAction(harvester.state, harvester.robot, { kind: 'harvest' });
      v.equal(`harvest ${label}`, robotPlan.ok, scythe.kind === 'harvest');

      if (robotPlan.ok && scythe.kind === 'harvest') {
        harvests++;
        const crop = tile.crop;
        if (crop === null) throw new Error(`harvestable tile without a crop: ${label}`);
        const after = requireRobot(applyRobotPlan(harvester.state, harvester.robot.id, robotPlan), harvester.robot.id);
        v.equal(`harvest yield ${label}`, after.bag, [stack(crop.cropId, scythe.quantity, scythe.quality)]);
      }
    }
    expect(harvests).toBeGreaterThan(0);
    expect(v.head()).toEqual([]);
  });
});
