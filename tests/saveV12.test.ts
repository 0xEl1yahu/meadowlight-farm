/**
 * Save version 12 (release 1 cleanup spec §2): the v2 features release 1 cut leave the save. The
 * v11 → v12 migration deletes the cooking, quests and festival sections and every character's
 * `talkedToday`, clears every trophy and decoration, and teaches job 2's and job 3's recipes to a
 * farm that has done them already (spec §2.3, §5.2), so long as its recipe list is well formed.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, CRAFTING_RECIPE_IDS, SAVE_VERSION, type CraftingRecipeId, type GameState, type MapId, type Tile, type TileCoord } from '../src/core/types';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { forEachTile } from '../src/world/tiles';
import { BASE, TARGET, livelySections, must, savedTileAt, setSavedTile, tileAt, v11Save, v9Save, withJobsDone, type SaveJson } from './testUtils';

const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

/** The recipes a farm knows once it has taken job 1: the starting ones and the Wood Burner. */
const AFTER_JOB_1: readonly CraftingRecipeId[] = ['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'basicFertilizer', 'woodBurner'];

/** A version-11 save of `state`, knowing just `known`, as version 11 could leave it. */
function v11Knowing(state: GameState, known: readonly unknown[]): SaveJson {
  return { ...v11Save(state), crafting: { known } };
}

/** The first tile of `mapId` in BASE with nothing on it and no blocker: room for a placed object. */
function openTile(mapId: MapId): TileCoord {
  const open: TileCoord[] = [];
  forEachTile(BASE.maps[mapId], (tile, tx, tz) => {
    if (tile.object === null && tile.crop === null && tile.blocker === Blocker.None && tile.fertilizer === null) open.push({ tx, tz });
  });
  return must(open[0], `an open tile on ${mapId}`);
}

describe('save version 12', () => {
  it('is the current version', () => {
    expect(SAVE_VERSION).toBe(12);
    expect(BASE.version).toBe(12);
    expect((migrateSave(v11Save(BASE)) as SaveJson).version).toBe(12);
  });

  it('drops the cooking, quests and festival sections and every talkedToday', () => {
    const save = v11Save(BASE);
    expect(Object.keys(save)).toEqual(expect.arrayContaining(['cooking', 'quests', 'festival']));
    const migrated = migrateSave(save) as SaveJson;
    for (const key of ['cooking', 'quests', 'festival']) expect(migrated, key).not.toHaveProperty(key);
    for (const [id, talk] of Object.entries(migrated.npcs as Record<string, SaveJson>)) expect(talk, id).not.toHaveProperty('talkedToday');
    expect(load(save)).toEqual(BASE);
  });

  it('drops the three sections whatever they hold', () => {
    const save = { ...v11Save(BASE), cooking: 'stew', quests: null, festival: [1, 2, 3] };
    expect(load(save)).toEqual(BASE);
  });

  it('clears a trophy on the farm and a decoration in town', () => {
    const save = v11Save(BASE);
    const farmAt = TARGET;
    const townAt = openTile('town');
    const farmTile = tileAt(BASE, farmAt, 'farm');
    const townTile = tileAt(BASE, townAt, 'town');
    expect(farmTile.object).toBeNull();
    setSavedTile(save, 'farm', farmAt, { ...farmTile, object: { kind: 'trophy', festival: 'harvestFair', year: 1 } } as unknown as Tile);
    setSavedTile(save, 'town', townAt, { ...townTile, object: { kind: 'decoration', variant: 'paperLantern' } } as unknown as Tile);
    expect((savedTileAt(save, 'farm', farmAt).object as SaveJson).kind).toBe('trophy');
    const loaded = must(load(save));
    expect(tileAt(loaded, farmAt, 'farm').object).toBeNull();
    expect(tileAt(loaded, townAt, 'town').object).toBeNull();
    expect(loaded).toEqual(BASE);
  });

  // R5: the farm's map doesn't change in v9 → v10, so v12 cleans what stands on it; a town or
  // Neighbours map with one fails migrateMapV10's guard, so the save stays at v9 and is refused.
  describe('a version-9 save holding a trophy or a decoration', () => {
    const DECORATION = { kind: 'decoration', variant: 'paperLantern' };
    /** BASE at `minute`, so the walkers stand where that hour puts them (or indoors). */
    const at = (minute: number): GameState => ({ ...BASE, time: { ...BASE.time, minuteOfDay: minute } });
    const HOURS = [6 * 60, 10 * 60, 20 * 60, 25 * 60] as const;

    it('loads cleaned when it is on the farm, at any hour', () => {
      for (const minute of HOURS) {
        const save = v9Save(at(minute));
        setSavedTile(save, 'farm', TARGET, { ...tileAt(BASE, TARGET, 'farm'), object: DECORATION } as unknown as Tile);
        expect(tileAt(must(load(save)), TARGET, 'farm').object, `minute ${minute}`).toBeNull();
      }
    });

    it('is refused when it is in town or on the Neighbours, at any hour', () => {
      for (const mapId of ['town', 'neighbours'] as const) {
        const spot = openTile(mapId);
        for (const minute of HOURS) {
          const save = v9Save(at(minute));
          setSavedTile(save, mapId, spot, { ...tileAt(BASE, spot, mapId), object: DECORATION } as unknown as Tile);
          expect(load(save), `${mapId} at minute ${minute}`).toBeNull();
        }
      }
    });
  });

  it("teaches job 2's recipes to a farm that has done it, in canonical order", () => {
    const state = withJobsDone(BASE, 'showHim');
    const loaded = must(load(v11Knowing(state, AFTER_JOB_1)));
    expect(loaded.crafting.known).toEqual(['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'basicFertilizer', 'qualityFertilizer', 'speedGro', 'woodBurner']);
    expect(loaded).toEqual(state);
  });

  it("teaches job 3's recipe too to a farm that has done it, in canonical order", () => {
    const state = withJobsDone(BASE, 'knowTheLimits');
    const loaded = must(load(v11Knowing(state, AFTER_JOB_1)));
    expect(loaded.crafting.known).toEqual(['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'qualitySprinkler', 'basicFertilizer', 'qualityFertilizer', 'speedGro', 'woodBurner']);
    expect(loaded).toEqual(state);
  });

  it('teaches nothing while job 2 is active', () => {
    const done = withJobsDone(BASE, 'spinningRobot');
    const state = { ...done, jobs: { ...done.jobs, status: { ...done.jobs.status, showHim: 'active' as const } } };
    const loaded = must(load(v11Save(state)));
    expect(loaded.crafting.known).toEqual(AFTER_JOB_1);
    expect(loaded).toEqual(state);
  });

  it('teaches a recipe the farm already knows only once', () => {
    const state = withJobsDone(BASE, 'showHim');
    const known = CRAFTING_RECIPE_IDS.filter((id) => AFTER_JOB_1.includes(id) || id === 'speedGro');
    const loaded = must(load(v11Knowing(state, known)));
    expect(loaded.crafting.known.filter((id) => id === 'speedGro')).toHaveLength(1);
    expect(loaded).toEqual(state);
  });

  it('leaves a corrupt recipe list as found, so the save is refused', () => {
    const state = withJobsDone(BASE, 'showHim');
    const outOfOrder = ['woodBurner', ...AFTER_JOB_1.slice(0, -1)];
    const unknownId = [...AFTER_JOB_1, 'goldenHoe'];
    for (const known of [outOfOrder, unknownId, 'chest']) {
      const save = { ...v11Save(state), crafting: { known } };
      const migrated = migrateSave(save) as { crafting: { known: unknown } };
      expect(migrated.crafting.known, JSON.stringify(known)).toEqual(known);
      expect(load(save), JSON.stringify(known)).toBeNull();
    }
  });

  it('loads a version-11 save of every section filled in as the state it was taken from', () => {
    const state: GameState = { ...BASE, ...livelySections() };
    expect(load(v11Save(state))).toEqual(state);
  });

  it('refuses a version-12 save with a talkedToday on a character', () => {
    const save = JSON.parse(serializeGame(BASE)) as SaveJson;
    expect(load(save)).toEqual(BASE);
    (save.npcs as Record<string, SaveJson>).sol = { ...(save.npcs as Record<string, SaveJson>).sol, talkedToday: false };
    expect(load(save)).toBeNull();
  });

  it('refuses a version-12 save holding a trophy or a decoration', () => {
    for (const object of [{ kind: 'trophy', festival: 'harvestFair', year: 1 }, { kind: 'decoration', variant: 'paperLantern' }]) {
      const save = JSON.parse(serializeGame(BASE)) as SaveJson;
      setSavedTile(save, 'farm', TARGET, { ...tileAt(BASE, TARGET, 'farm'), object } as unknown as Tile);
      expect(load(save), object.kind).toBeNull();
    }
  });
});
