/**
 * Shade, wild crops and seed scattering.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PLAYER, SHADE } from '../src/config';
import { Direction, SAVE_VERSION, Season, TileState, Weather, type Tile, type TileCoord, type WorldState } from '../src/core/types';
import { CROPS, createCropInstance, isMature, stageCount } from '../src/farming/crops';
import { advanceTileOvernight, advanceWorldOvernight, type DayContext } from '../src/farming/growth';
import { canSproutWild, spreadWildCrops } from '../src/farming/wild';
import { actions } from '../src/state/actions';
import { planPrimaryAction } from '../src/state/intents';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { selectScatterPatch } from '../src/state/selectors';
import { createGridSpec } from '../src/world/grid';
import { MAPS } from '../src/world/maps';
import { isShadedTile } from '../src/world/shade';
import { EMPTY_TILE, assertTileConsistent, countTiles, createWorld, forEachTile, getTile, setTile } from '../src/world/tiles';
import {
  BASE,
  STAND,
  TARGET,
  atDay,
  count,
  holding,
  legacySave,
  must,
  soilTile,
  tileAt,
  withPlayer,
  withTile,
} from './testUtils';

const grid = BASE.maps.farm.grid;

function ctx(overrides: Partial<DayContext> = {}): DayContext {
  return { seed: 7, day: 10, season: Season.Summer, seasonChanged: false, weather: Weather.Sunny, ...overrides };
}

function wildTile(cropId: 'mushroom' | 'snozberry', stage = 0): Tile {
  return { ...EMPTY_TILE, crop: { ...createCropInstance(cropId, 0, true), stage } };
}

function wildCount(world: WorldState): number {
  return countTiles(world, (tile) => tile.crop !== null && tile.crop.wild);
}

describe('shade map', () => {
  it('covers the woodland edge band and a ring around the house, and nothing else', () => {
    const { house } = LAYOUT;
    for (let tz = 0; tz < grid.depth; tz++) {
      for (let tx = 0; tx < grid.width; tx++) {
        const edge = tx < SHADE.edgeBand || tz < SHADE.edgeBand;
        const ring =
          tx >= house.x0 - SHADE.houseRing &&
          tx < house.x0 + house.width + SHADE.houseRing &&
          tz >= house.z0 - SHADE.houseRing &&
          tz < house.z0 + house.depth + SHADE.houseRing;
        expect(isShadedTile(grid, tx, tz), `(${tx}, ${tz})`).toBe(edge || ring);
      }
    }
    expect(isShadedTile(grid, -1, 5)).toBe(false);
    expect(isShadedTile(grid, grid.width, 0)).toBe(false);
  });
});

describe('wild crops overnight', () => {
  it('grow every night in shade without water', () => {
    let tile = wildTile('mushroom');
    const stages = [tile.crop?.stage];
    for (let night = 0; night < 3; night++) {
      tile = advanceTileOvernight(tile, 0, 10, ctx({ day: 10 + night }), true);
      stages.push(tile.crop?.stage);
    }
    expect(stages).toEqual([0, 1, 2, 2]);
    expect(isMature(must(tile.crop))).toBe(true);
    expect(tile.state).toBe(TileState.Unplowed);
  });

  it('vanish out of season or out of shade instead of leaving a withered husk', () => {
    const snoz = wildTile('snozberry', 1);
    expect(advanceTileOvernight(snoz, 0, 10, ctx({ season: Season.Spring, seasonChanged: true }), true)).toEqual(EMPTY_TILE);
    expect(advanceTileOvernight(snoz, 0, 10, ctx(), false)).toEqual(EMPTY_TILE);
  });

  it('keep their identity when fully grown', () => {
    const grown = wildTile('mushroom', stageCount(CROPS.mushroom));
    expect(advanceTileOvernight(grown, 0, 10, ctx(), true)).toBe(grown);
  });
});

describe('sprouting and spreading', () => {
  const empty = (): WorldState => createWorld(createGridSpec(48, 40, 16), () => EMPTY_TILE);

  it('only ever sprouts on empty shaded grass, deterministically', () => {
    let world = empty();
    for (let day = 1; day <= 30; day++) world = advanceWorldOvernight(world, ctx({ day }), MAPS.farm);
    const again = (() => {
      let w = empty();
      for (let day = 1; day <= 30; day++) w = advanceWorldOvernight(w, ctx({ day }), MAPS.farm);
      return w;
    })();
    expect(again).toEqual(world);
    expect(wildCount(world)).toBeGreaterThan(0);
    forEachTile(world, (tile, tx, tz) => {
      if (tile.crop === null) return;
      expect(tile.crop.wild).toBe(true);
      expect(isShadedTile(world.grid, tx, tz)).toBe(true);
      expect(tile.state).toBe(TileState.Unplowed);
      assertTileConsistent(tile);
    });
  });

  it('never exceeds the wild population cap', () => {
    let world = empty();
    for (let day = 1; day <= 200; day++) {
      world = advanceWorldOvernight(world, ctx({ day }), MAPS.farm);
      expect(wildCount(world)).toBeLessThanOrEqual(SHADE.maxWild);
    }
    expect(wildCount(world)).toBe(SHADE.maxWild);
  });

  it('spreads much faster next to mature wild crops', () => {
    // Plant a column of mature mushrooms and compare sprouting beside it with open shade.
    let world = empty();
    for (let tz = 10; tz < 30; tz++) world = setTile(world, 0, tz, wildTile('mushroom', stageCount(CROPS.mushroom)));
    let besideHits = 0;
    let openHits = 0;
    for (let day = 0; day < 200; day++) {
      const next = spreadWildCrops(world, ctx({ day }), MAPS.farm);
      for (let tz = 10; tz < 30; tz++) {
        if (getTile(next, 1, tz)?.crop !== null) besideHits++;
        if (getTile(next, 40, 0)?.crop !== null && tz === 10) openHits++;
      }
    }
    // Beside: sprout + one neighbour ≈ 13.5 % per tile per night; open shade ≈ 1.5 %.
    expect(besideHits / (200 * 20)).toBeGreaterThan(0.09);
    expect(openHits / 200).toBeLessThan(0.05);
  });

  it('copies the kind of a neighbouring mature crop', () => {
    let world = empty();
    for (let tz = 10; tz < 30; tz++) world = setTile(world, 0, tz, wildTile('snozberry', stageCount(CROPS.snozberry)));
    for (let day = 0; day < 100; day++) {
      const next = spreadWildCrops(world, ctx({ day }), MAPS.farm);
      for (let tz = 10; tz < 30; tz++) {
        const crop = getTile(next, 1, tz)?.crop;
        // Only the wooded column tx 0-1 is shaded here; a sprout beside a lone snozberry column
        // with no mushroom neighbours must be a snozberry.
        if (crop && getTile(world, 1, tz - 1)?.crop === null && getTile(world, 1, tz + 1)?.crop === null) {
          expect(crop.cropId).toBe('snozberry');
        }
      }
    }
  });

  it('does nothing in winter, when no shade crop is in season', () => {
    const world = empty();
    expect(spreadWildCrops(world, ctx({ season: Season.Winter }), MAPS.farm)).toBe(world);
  });

  it('never sprouts on tilled soil, blocked tiles or occupied grass', () => {
    const soil = soilTile(TileState.Plowed);
    expect(canSproutWild(MAPS.farm, soil, 0, 10)).toBe(false);
    expect(canSproutWild(MAPS.farm, wildTile('mushroom'), 0, 10)).toBe(false);
    expect(canSproutWild(MAPS.farm, EMPTY_TILE, 20, 20)).toBe(false);
    expect(canSproutWild(MAPS.farm, EMPTY_TILE, 0, 20)).toBe(true);
  });

  it('never sprouts on a reserved (gate) tile, though it is shaded', () => {
    for (const { tx, tz } of MAPS.farm.reserved) {
      if (!MAPS.farm.isShaded(tx, tz)) continue;
      expect(canSproutWild(MAPS.farm, EMPTY_TILE, tx, tz), `(${tx}, ${tz})`).toBe(false);
    }
    expect(MAPS.farm.isShaded(1, 13)).toBe(true);
    expect(canSproutWild(MAPS.farm, EMPTY_TILE, 1, 12)).toBe(true);
  });

  it('follows the map definition: its shade, and nothing at all without wild tuning', () => {
    const town = MAPS.town.generate(0);
    expect(spreadWildCrops(town, ctx(), MAPS.town)).toBe(town);
    // The forest clearing is its only unshaded ground.
    expect(canSproutWild(MAPS.forest, EMPTY_TILE, 17, 14)).toBe(false);
    expect(canSproutWild(MAPS.forest, EMPTY_TILE, 30, 25)).toBe(true);
  });

  it('never sprouts under a placed object', () => {
    for (const object of [{ kind: 'woodPath' }, { kind: 'scarecrow' }] as const) {
      expect(canSproutWild(MAPS.farm, { ...EMPTY_TILE, object }, 0, 20)).toBe(false);
    }
  });
});

describe('a new farm', () => {
  it('starts with a few wild spring crops in the shade, never on the spawn tile', () => {
    let wild = 0;
    forEachTile(BASE.maps.farm, (tile, tx, tz) => {
      if (tile.crop === null || !tile.crop.wild) return;
      wild++;
      expect(tile.crop.cropId).toBe('mushroom'); // snozberries don't grow in spring
      expect(isShadedTile(grid, tx, tz)).toBe(true);
      expect(tx === PLAYER.spawn.tx && tz === PLAYER.spawn.tz).toBe(false);
    });
    expect(wild).toBeGreaterThan(3);
  });
});

describe('foraging', () => {
  const mushroomAhead = withTile(BASE, TARGET, wildTile('mushroom', stageCount(CROPS.mushroom)));
  const standing = withPlayer(mushroomAhead, STAND, Direction.South);

  it('harvests a mature wild crop with E and leaves plain grass', () => {
    const next = gameReducer(standing, actions.interact());
    expect(tileAt(next, TARGET)).toEqual(EMPTY_TILE);
    expect(count(next, 'mushroom')).toBeGreaterThanOrEqual(1);
  });

  it('will not till over a wild crop', () => {
    const plan = planPrimaryAction(holding(standing, 'hoe'));
    expect(plan.intent).toEqual({ kind: 'blocked', reason: 'Forage the mushroom first (E).' });
  });
});

describe('seed scattering', () => {
  const standing = withPlayer(BASE, STAND, Direction.South);
  const patch = selectScatterPatch(standing);

  function tilled(state: typeof BASE, coords: readonly TileCoord[]): typeof BASE {
    return coords.reduce((s, coord) => withTile(s, coord, soilTile(TileState.Plowed)), state);
  }

  it('covers three rows ahead, three wide, nearest row and centre first', () => {
    expect(patch).toEqual([
      { tx: 5, tz: 10 }, { tx: 6, tz: 10 }, { tx: 4, tz: 10 },
      { tx: 5, tz: 11 }, { tx: 6, tz: 11 }, { tx: 4, tz: 11 },
      { tx: 5, tz: 12 }, { tx: 6, tz: 12 }, { tx: 4, tz: 12 },
    ]);
    // Facing east the patch turns with the player.
    expect(selectScatterPatch(withPlayer(BASE, STAND, Direction.East)).slice(0, 3)).toEqual([
      { tx: 6, tz: 9 }, { tx: 6, tz: 8 }, { tx: 6, tz: 10 },
    ]);
  });

  it('is clipped at the edge of the world', () => {
    const atEdge = withPlayer(BASE, { tx: 0, tz: 20 }, Direction.West);
    expect(selectScatterPatch(atEdge)).toEqual([]);
    const nearEdge = withPlayer(BASE, { tx: 2, tz: 20 }, Direction.West);
    expect(selectScatterPatch(nearEdge).map((c) => c.tx).sort()).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('plants every empty tilled tile of the patch with one handful', () => {
    const state = holding(atDay(tilled(standing, patch), 3), 'parsnip_seeds', 15);
    const next = gameReducer(state, actions.useTool());
    for (const coord of patch) expect(tileAt(next, coord).crop).toEqual(createCropInstance('parsnip', 3));
    expect(count(next, 'parsnip_seeds')).toBe(15 - patch.length);
  });

  it('runs out nearest-first when the stack is short', () => {
    const state = holding(tilled(standing, patch), 'parsnip_seeds', 4);
    const next = gameReducer(state, actions.useTool());
    const planted = patch.filter((coord) => tileAt(next, coord).crop !== null);
    expect(planted).toEqual(patch.slice(0, 4));
    expect(next.inventory.slots[next.inventory.selected]).toBeNull();
  });

  it('skips grass and occupied soil inside the patch', () => {
    const some = [patch[0], patch[4], patch[8]].map((c) => must(c));
    let state = tilled(standing, some);
    state = withTile(state, must(patch[4]), soilTile(TileState.Plowed, createCropInstance('potato', 0)));
    const next = gameReducer(holding(state, 'parsnip_seeds', 9), actions.useTool());
    expect(tileAt(next, must(patch[0])).crop?.cropId).toBe('parsnip');
    expect(tileAt(next, must(patch[4])).crop?.cropId).toBe('potato');
    expect(tileAt(next, must(patch[8])).crop?.cropId).toBe('parsnip');
    expect(tileAt(next, must(patch[1])).crop).toBeNull();
    expect(count(next, 'parsnip_seeds')).toBe(7);
  });
});

describe('save migration', () => {
  it('loads a version-1 save, marking every existing crop as sown', () => {
    const current = withTile(BASE, TARGET, soilTile(TileState.Watered, createCropInstance('parsnip', 0)));
    // Version 1 had no wild crops and no `wild` field.
    const v1 = legacySave(current, 1);
    const loaded = must(deserializeGame(JSON.stringify(v1)));
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(tileAt(loaded, TARGET).crop).toEqual(createCropInstance('parsnip', 0));
  });

  it('rejects a sown crop on grass and a wild field crop', () => {
    const sownOnGrass = withTile(BASE, TARGET, EMPTY_TILE);
    const text = serializeGame(sownOnGrass).replace(
      JSON.stringify(EMPTY_TILE),
      JSON.stringify({ ...EMPTY_TILE, crop: createCropInstance('parsnip', 0) }),
    );
    expect(deserializeGame(text)).toBeNull();
    const wildField = serializeGame(withTile(BASE, TARGET, { ...EMPTY_TILE, crop: createCropInstance('parsnip', 0, true) }));
    expect(deserializeGame(wildField)).toBeNull();
  });
});
