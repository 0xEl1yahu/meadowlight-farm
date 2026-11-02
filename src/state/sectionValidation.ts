/**
 * Save validation for the GameState sections later workstreams fill in (profile, tools,
 * crafting, buildings, NPCs, townsfolk, stats, shop stock, SLOPMART, jobs).
 * Phase 0 only stores them, so these checks pin down exactly the shapes and ranges the section
 * types document.
 */
import { APPEARANCE, JOBS, LAYOUT, PROFILE, SHOP_STOCK, SLOP } from '../config';
import {
  ANIMAL_KINDS,
  BASIC_PART_IDS,
  CRAFTING_RECIPE_IDS,
  CROP_IDS,
  DIRECTIONS,
  FARM_BUILDING_KINDS,
  JOB_IDS,
  JOB_STATUSES,
  MAP_IDS,
  NPC_IDS,
  ROBOT_SIZES,
  TOWNSFOLK_IDS,
  UPGRADABLE_TOOLS,
  type AnimalKind,
  type FarmBuildingKind,
  type GameSections,
  type GameState,
} from '../core/types';
import { seedItemId } from '../farming/crops';
import { inBounds } from '../world/grid';
import { MAPS } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import {
  hasExactKeys,
  isBool,
  isCanonicalSubset,
  isCount,
  isInt,
  isIntIn,
  isObj,
  isOneOf,
  type Obj,
} from './validation';

/** The fields of an NpcTalk, exactly. */
const NPC_TALK_KEYS = ['talks', 'place'] as const;
/** The fields of an `out` WalkerPlace, exactly. */
const OUT_PLACE_KEYS = ['kind', 'mapId', 'tx', 'tz', 'facing'] as const;
/** Every coop and barn has room for this many animals. */
const MAX_ANIMALS_PER_BUILDING = 4;
/** Which building houses each animal kind. */
const HOME_OF: Readonly<Record<AnimalKind, FarmBuildingKind>> = { chicken: 'coop', cow: 'barn' };
/** Which of the farm layout's plots each building kind stands on; each plot is sized for its kind. */
const PLOT_OF: Readonly<Record<FarmBuildingKind, number>> = { coop: 0, barn: 1 };
const MAX_HAPPINESS = 255;
/** Every seed item, one per crop: the keys of Marigold's sold-today counts. */
const SEED_ITEM_IDS = CROP_IDS.map(seedItemId);

/** A player, farm or animal name: 1 … PROFILE.maxNameLength characters, trimmed, not blank. */
export function isValidName(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() !== v) return false;
  const length = Array.from(v).length;
  return length >= 1 && length <= PROFILE.maxNameLength;
}

function isValidProfile(v: unknown): boolean {
  if (!isObj(v) || !isValidName(v.playerName) || !isValidName(v.farmName)) return false;
  const a = v.appearance;
  return (
    isObj(a) &&
    isIntIn(a.skinTone, 0, APPEARANCE.skinTones - 1) &&
    isIntIn(a.hairStyle, 0, APPEARANCE.hairStyles - 1) &&
    isIntIn(a.hairColor, 0, APPEARANCE.hairColors - 1) &&
    isIntIn(a.shirtColor, 0, APPEARANCE.shirtColors - 1) &&
    isIntIn(a.overallsColor, 0, APPEARANCE.overallsColors - 1) &&
    isIntIn(a.hat, 0, APPEARANCE.hats - 1)
  );
}

function isValidTools(v: unknown): boolean {
  if (!isObj(v) || !isObj(v.levels) || !hasExactKeys(v.levels, UPGRADABLE_TOOLS)) return false;
  const levels = v.levels;
  if (!UPGRADABLE_TOOLS.every((tool) => isIntIn(levels[tool], 0, 2))) return false;
  const upgrade = v.upgrade;
  return (
    upgrade === null ||
    (isObj(upgrade) && isOneOf(upgrade.tool, UPGRADABLE_TOOLS) && isIntIn(upgrade.level, 1, 2) && isCount(upgrade.readyDay))
  );
}

function isValidCrafting(v: unknown): boolean {
  return isObj(v) && isCanonicalSubset(v.known, CRAFTING_RECIPE_IDS);
}

/**
 * A walker's place (farmclaws part 4d spec §9.3), with exact keys: indoors, or out on a map that
 * exists, on a walkable tile within it, facing a direction.
 */
function isWalkerPlace(v: unknown, maps: GameState['maps']): boolean {
  if (!isObj(v)) return false;
  if (v.kind === 'indoors') return hasExactKeys(v, ['kind']);
  if (v.kind !== 'out' || !hasExactKeys(v, OUT_PLACE_KEYS) || !isOneOf(v.mapId, MAP_IDS) || !isOneOf(v.facing, DIRECTIONS)) return false;
  if (!isInt(v.tx) || !isInt(v.tz)) return false;
  const tile = getTile(maps[v.mapId], v.tx, v.tz);
  return tile !== null && isWalkable(tile);
}

function isValidNpcTalk(v: unknown, maps: GameState['maps']): boolean {
  return isObj(v) && hasExactKeys(v, NPC_TALK_KEYS) && isCount(v.talks) && isWalkerPlace(v.place, maps);
}

/** Exactly the seven characters (farmclaws part 4a spec §6.3), each with exactly an NpcTalk's fields. */
function isValidNpcs(v: unknown, maps: GameState['maps']): boolean {
  return isObj(v) && hasExactKeys(v, NPC_IDS) && NPC_IDS.every((id) => isValidNpcTalk(v[id], maps));
}

/** Exactly the six townsfolk (farmclaws part 4d spec §9.3), each with exactly a place. */
function isValidTownsfolk(v: unknown, maps: GameState['maps']): boolean {
  return (
    isObj(v) &&
    hasExactKeys(v, TOWNSFOLK_IDS) &&
    TOWNSFOLK_IDS.every((id) => {
      const townsperson = v[id];
      return isObj(townsperson) && hasExactKeys(townsperson, ['place']) && isWalkerPlace(townsperson.place, maps);
    })
  );
}

function isValidAnimal(v: unknown, home: FarmBuildingKind): v is Obj {
  return (
    isObj(v) &&
    isOneOf(v.kind, ANIMAL_KINDS) &&
    HOME_OF[v.kind] === home &&
    isValidName(v.name) &&
    isCount(v.bornDay) &&
    isBool(v.fedToday) &&
    isBool(v.pettedToday) &&
    isIntIn(v.happiness, 0, MAX_HAPPINESS) &&
    isBool(v.hasProduct)
  );
}

/**
 * Farm buildings and their animals. Both draw ids from one shared counter, so every id lies in
 * 1 … nextEntityId − 1 and no id appears twice across buildings and animals combined.
 */
function isValidBuildings(buildings: unknown, nextEntityId: unknown): boolean {
  if (!Array.isArray(buildings) || !isIntIn(nextEntityId, 1, Number.MAX_SAFE_INTEGER)) return false;
  const maxId = nextEntityId - 1;
  const ids = new Set<number>();
  const claim = (id: unknown): boolean => {
    if (!isIntIn(id, 1, maxId) || ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  const plots = new Set<number>();
  for (const building of buildings as readonly unknown[]) {
    if (!isObj(building) || !claim(building.id) || !isOneOf(building.kind, FARM_BUILDING_KINDS)) return false;
    if (!isIntIn(building.plot, 0, LAYOUT.plots.length - 1) || plots.has(building.plot)) return false;
    if (building.plot !== PLOT_OF[building.kind]) return false;
    plots.add(building.plot);
    if (!isCount(building.readyDay) || !isCount(building.troughWheat)) return false;
    const animals = building.animals;
    if (!Array.isArray(animals) || animals.length > MAX_ANIMALS_PER_BUILDING) return false;
    const home = building.kind;
    if (!animals.every((animal: unknown) => isValidAnimal(animal, home) && claim(animal.id))) return false;
  }
  return true;
}

function isValidStats(v: unknown): boolean {
  return (
    isObj(v) &&
    isCount(v.parsnipsShipped) &&
    isCount(v.debrisCleared) &&
    isCount(v.forageFound) &&
    isCount(v.totalEarned) &&
    isBool(v.visitedTown) &&
    isBool(v.craftedChest) &&
    isBool(v.builtCoop)
  );
}

/** A shop's sold-today counts: exactly `ids`, each an integer from 0 to the shop's daily stock. */
function isValidSoldCounts(v: unknown, ids: readonly string[], stock: number): boolean {
  return isObj(v) && hasExactKeys(v, ids) && ids.every((id) => isIntIn(v[id], 0, stock));
}

/**
 * What each shop sold today (farmclaws part 4b spec §9): Sol's parts, Juniper's robots and
 * Marigold's seeds, and SLOPMART's boxes, no more than SLOP.boxesPerDay (part 4d spec §9.3).
 */
function isValidShopsSoldToday(v: unknown): boolean {
  return (
    isObj(v) &&
    hasExactKeys(v, ['parts', 'robots', 'seeds', 'slopBoxes']) &&
    isValidSoldCounts(v.parts, BASIC_PART_IDS, SHOP_STOCK.partsPerDay) &&
    isValidSoldCounts(v.robots, ROBOT_SIZES, SHOP_STOCK.robotsPerSizePerDay) &&
    isValidSoldCounts(v.seeds, SEED_ITEM_IDS, SHOP_STOCK.seedsPerDay) &&
    isIntIn(v.slopBoxes, 0, SLOP.boxesPerDay)
  );
}

/** SLOPMART (part 4d spec §9.3): exactly a lifetime count of boxes. */
function isValidSlopShop(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, ['boxesOpened']) && isCount(v.boxesOpened);
}

/**
 * The jobs (farmclaws part 4c spec §7): exactly a status per job, in order every job done, then
 * the next one offered or active (none once all are done), then the rest locked, so at most one
 * job is active and a job is only reached when the one before it is done. The bed is null or the
 * corner of a 3 × 3 block on the farm; the field day is -1 or an absolute day.
 */
function isValidJobs(v: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['status', 'bed', 'rescued', 'fieldDay'])) return false;
  const status = v.status;
  if (!isObj(status) || !hasExactKeys(status, JOB_IDS) || !JOB_IDS.every((id) => isOneOf(status[id], JOB_STATUSES))) return false;
  const statuses = JOB_IDS.map((id) => status[id]);
  const next = statuses.findIndex((s) => s !== 'done');
  if (next !== -1 && (!isOneOf(statuses[next], ['offered', 'active']) || statuses.slice(next + 1).some((s) => s !== 'locked'))) return false;
  const bed = v.bed;
  const bedOk =
    bed === null ||
    (isObj(bed) &&
      hasExactKeys(bed, ['tx', 'tz']) &&
      isInt(bed.tx) &&
      isInt(bed.tz) &&
      inBounds(MAPS.farm.grid, bed.tx, bed.tz) &&
      inBounds(MAPS.farm.grid, bed.tx + JOBS.bedSize - 1, bed.tz + JOBS.bedSize - 1));
  return bedOk && isBool(v.rescued) && isIntIn(v.fieldDay, -1, Number.MAX_SAFE_INTEGER);
}

/**
 * Every section `createDefaultSections()` produces, read from an untrusted save object whose
 * `maps` have already passed validation.
 */
export function isValidSections(v: Obj, maps: GameState['maps']): v is Obj & GameSections {
  return (
    isValidProfile(v.profile) &&
    isValidTools(v.tools) &&
    isValidCrafting(v.crafting) &&
    isValidBuildings(v.buildings, v.nextEntityId) &&
    isValidNpcs(v.npcs, maps) &&
    isValidTownsfolk(v.townsfolk, maps) &&
    isValidStats(v.stats) &&
    isValidShopsSoldToday(v.shopsSoldToday) &&
    isValidSlopShop(v.slopShop) &&
    isValidJobs(v.jobs)
  );
}
