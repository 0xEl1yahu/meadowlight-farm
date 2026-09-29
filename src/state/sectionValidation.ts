/**
 * Save validation for the GameState sections later workstreams fill in (profile, tools,
 * crafting, cooking, buildings, NPCs, quests, stats, festival). Phase 0 only stores them, so
 * these checks pin down exactly the shapes and ranges the section types document.
 */
import { APPEARANCE, LAYOUT, PROFILE } from '../config';
import {
  ANIMAL_KINDS,
  CRAFTING_RECIPE_IDS,
  DISH_IDS,
  FARM_BUILDING_KINDS,
  NPC_IDS,
  STORY_QUEST_IDS,
  UPGRADABLE_TOOLS,
  type AnimalKind,
  type FarmBuildingKind,
  type GameSections,
  type HeartEventLevel,
} from '../core/types';
import { isItemId } from '../items/items';
import {
  hasExactKeys,
  isBool,
  isCanonicalSubset,
  isCount,
  isIntIn,
  isObj,
  isOneOf,
  isValidStack,
  type Obj,
} from './validation';

/** Friendship points cap: 10 hearts of 250 points. */
const MAX_NPC_POINTS = 2500;
const HEART_EVENT_LEVELS: readonly HeartEventLevel[] = [2, 4, 6];
/** Every coop and barn has room for this many animals. */
const MAX_ANIMALS_PER_BUILDING = 4;
/** Which building houses each animal kind. */
const HOME_OF: Readonly<Record<AnimalKind, FarmBuildingKind>> = { chicken: 'coop', cow: 'barn' };
const MAX_HAPPINESS = 255;
/** Blossom Fair has 12 eggs, stored as a bitmask. */
const MAX_EGG_MASK = 0xfff;
const MAX_FESTIVAL_DISPLAY = 9;

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

function isValidCooking(v: unknown): boolean {
  return isObj(v) && isCanonicalSubset(v.known, DISH_IDS) && isIntIn(v.kitchenLevel, 0, 1);
}

function isValidNpcRelation(v: unknown): boolean {
  return (
    isObj(v) &&
    isIntIn(v.points, 0, MAX_NPC_POINTS) &&
    isBool(v.talkedToday) &&
    isIntIn(v.giftsToday, 0, 1) &&
    isIntIn(v.giftsThisWeek, 0, 2) &&
    isCanonicalSubset(v.heartEventsSeen, HEART_EVENT_LEVELS) &&
    isCount(v.talks)
  );
}

function isValidNpcs(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, NPC_IDS) && NPC_IDS.every((id) => isValidNpcRelation(v[id]));
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
    plots.add(building.plot);
    if (!isCount(building.readyDay) || !isCount(building.troughWheat)) return false;
    const animals = building.animals;
    if (!Array.isArray(animals) || animals.length > MAX_ANIMALS_PER_BUILDING) return false;
    const home = building.kind;
    if (!animals.every((animal: unknown) => isValidAnimal(animal, home) && claim(animal.id))) return false;
  }
  return true;
}

const BOARD_STATUSES = ['active', 'completed', 'expired'] as const;

function isValidQuests(v: unknown): boolean {
  if (!isObj(v) || !isCanonicalSubset(v.completed, STORY_QUEST_IDS)) return false;
  const board = v.board;
  return (
    board === null ||
    (isObj(board) &&
      isCount(board.week) &&
      isOneOf(board.npc, NPC_IDS) &&
      isItemId(board.itemId) &&
      isIntIn(board.quantity, 1, Number.MAX_SAFE_INTEGER) &&
      isCount(board.dueDay) &&
      isIntIn(board.delivered, 0, board.quantity) &&
      isOneOf(board.status, BOARD_STATUSES))
  );
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

function isValidFestival(v: unknown): boolean {
  return (
    isObj(v) &&
    isIntIn(v.activeDay, -1, Number.MAX_SAFE_INTEGER) &&
    isIntIn(v.eggsFound, 0, MAX_EGG_MASK) &&
    isBool(v.lanternReleased) &&
    Array.isArray(v.display) &&
    v.display.length <= MAX_FESTIVAL_DISPLAY &&
    v.display.every((stack: unknown) => isValidStack(stack, true)) &&
    (v.giftTarget === null || isOneOf(v.giftTarget, NPC_IDS)) &&
    isBool(v.giftGiven)
  );
}

/** Every section `createDefaultSections()` produces, read from an untrusted save object. */
export function isValidSections(v: Obj): v is Obj & GameSections {
  return (
    isValidProfile(v.profile) &&
    isValidTools(v.tools) &&
    isValidCrafting(v.crafting) &&
    isValidCooking(v.cooking) &&
    isValidBuildings(v.buildings, v.nextEntityId) &&
    isValidNpcs(v.npcs) &&
    isValidQuests(v.quests) &&
    isValidStats(v.stats) &&
    isValidFestival(v.festival)
  );
}
