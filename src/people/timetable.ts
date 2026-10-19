/**
 * Everyone's day (farmclaws part 4d spec §2, §3.2): each walker's legs, dry and wet, their home,
 * and where the clock and the weather put them. Pure. The cast's legs live in config
 * (`TIMETABLES`); the townsfolk's are built from their loops (`TOWNSFOLK`). The current leg is
 * never saved: it's worked out from the minute of the day and whether today is wet.
 *
 * The startup check (`assertTimetables`) reads the town and the Neighbours from their own modules
 * rather than the map registry, because the registry runs it while it loads.
 */
import { JOBS, TIME, TIMETABLES, TOWNSFOLK } from '../config';
import {
  Direction,
  NPC_IDS,
  TOWNSFOLK_IDS,
  type MapId,
  type NpcId,
  type TileCoord,
  type TownsfolkId,
  type WalkerId,
  type WalkerPlace,
  type WorldState,
} from '../core/types';
import { inBounds, rectContains } from '../world/grid';
import { coordIn } from '../world/maps/lookup';
import { BARNABY_FIELD, COSMO_FIELD, NEIGHBOURS_MAP } from '../world/maps/neighbours';
import { TOWN_EXITS, TOWN_MAP } from '../world/maps/town';
import type { MapDefinition } from '../world/maps/types';
import { findPath } from '../world/path';
import { getTile, isWalkable } from '../world/tiles';

/**
 * Where a leg goes (spec §2.1): a spot to stand on, facing one way; a pace between spots in order,
 * moving on every `everyMinutes` counted from the leg's departure; or home. A pace's facing applies
 * when the walker reaches a spot and waits there; null (the townsfolk's loops) keeps the facing
 * they walked in with.
 */
export type Stop =
  | { readonly kind: 'spot'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction }
  | {
      readonly kind: 'pace';
      readonly mapId: MapId;
      readonly spots: readonly TileCoord[];
      readonly facing: Direction | null;
      readonly everyMinutes: number;
    }
  | { readonly kind: 'home' };

/** A stop out on a map: a spot or a pace. */
export type OutStop = Exclude<Stop, { readonly kind: 'home' }>;

export interface Leg {
  /** The minute of the day the walker sets off. */
  readonly departs: number;
  readonly to: Stop;
}

/** A character's day (spec §2.2, §2.3): their home door, and their legs on a dry and on a wet day. */
export interface Timetable {
  readonly home: { readonly mapId: MapId; readonly door: TileCoord };
  readonly dry: readonly Leg[];
  readonly wet: readonly Leg[];
}

/** A townsperson's day (spec §3.1, §3.2): their exit, their loop, and whether they come out when it's wet. */
export interface TownsfolkDay {
  readonly exit: TileCoord;
  readonly loop: OutStop;
  readonly rainOrShine: boolean;
}

/** Where a walker lives: behind a door on a map, or off the town by one of its exits. */
export type Home = { readonly kind: 'door'; readonly mapId: MapId; readonly door: TileCoord } | { readonly kind: 'exit'; readonly tile: TileCoord };

/** Where a walker is headed: a tile on a map, facing a way (null: as they walked in), or home. */
export type Target = { readonly mapId: MapId; readonly tile: TileCoord; readonly facing: Direction | null } | 'home';

const HOME: Stop = { kind: 'home' };
const INDOORS: WalkerPlace = { kind: 'indoors' };
const NO_LEGS: readonly Leg[] = [];
const NO_TILES: readonly TileCoord[] = [];

/** Every walker, in the order the walk takes them: the characters, then the townsfolk. */
const WALKER_IDS: readonly WalkerId[] = [...NPC_IDS, ...TOWNSFOLK_IDS];

function isTownsfolk(id: WalkerId): id is TownsfolkId {
  return (TOWNSFOLK_IDS as readonly string[]).includes(id);
}

/** A townsperson's dry-day and wet-day legs: out to their loop at TOWNSFOLK.outAt, home at TOWNSFOLK.homeAt; wet days only rain or shine. */
function townsfolkDays(day: TownsfolkDay): { readonly dry: readonly Leg[]; readonly wet: readonly Leg[] } {
  const dry: readonly Leg[] = [
    { departs: TOWNSFOLK.outAt, to: day.loop },
    { departs: TOWNSFOLK.homeAt, to: HOME },
  ];
  return { dry, wet: day.rainOrShine ? dry : NO_LEGS };
}

const TOWNSFOLK_LEGS = Object.fromEntries(TOWNSFOLK_IDS.map((id) => [id, townsfolkDays(TOWNSFOLK.days[id])])) as Readonly<
  Record<TownsfolkId, { readonly dry: readonly Leg[]; readonly wet: readonly Leg[] }>
>;

export function walkerHome(id: WalkerId): Home {
  if (isTownsfolk(id)) return { kind: 'exit', tile: TOWNSFOLK.days[id].exit };
  const { mapId, door } = TIMETABLES[id].home;
  return { kind: 'door', mapId, door };
}

/** Where a walker comes out and goes in: the tile in front of their door (its +Z side), or their exit tile on the town. */
export function homeFront(id: WalkerId): { readonly mapId: MapId; readonly tile: TileCoord } {
  const home = walkerHome(id);
  if (home.kind === 'exit') return { mapId: 'town', tile: home.tile };
  return { mapId: home.mapId, tile: { tx: home.door.tx, tz: home.door.tz + 1 } };
}

/** `id`'s legs for the day, in order of departure; none for a townsperson who stays home in the wet. */
export function legsFor(id: WalkerId, wet: boolean): readonly Leg[] {
  const days = isTownsfolk(id) ? TOWNSFOLK_LEGS[id] : TIMETABLES[id];
  return wet ? days.wet : days.dry;
}

/** The last leg departing at or before `minute`, or null before the first (the walker is at home). */
export function currentLeg(id: WalkerId, minute: number, wet: boolean): Leg | null {
  let current: Leg | null = null;
  for (const leg of legsFor(id, wet)) {
    if (leg.departs > minute) break;
    current = leg;
  }
  return current;
}

/** Where `id` is headed at `minute`: their current leg's spot, or the pace spot it's on (spec §2.1), or home. */
export function targetOf(id: WalkerId, minute: number, wet: boolean): Target {
  const leg = currentLeg(id, minute, wet);
  if (leg === null) return 'home';
  const stop = leg.to;
  switch (stop.kind) {
    case 'home':
      return 'home';
    case 'spot':
      return { mapId: stop.mapId, tile: { tx: stop.tx, tz: stop.tz }, facing: stop.facing };
    case 'pace': {
      const tile = stop.spots[Math.floor((minute - leg.departs) / stop.everyMinutes) % stop.spots.length];
      if (tile === undefined) throw new RangeError(`Timetable: ${id}'s pace has no spots`);
      return { mapId: stop.mapId, tile, facing: stop.facing };
    }
  }
}

/** Every tile of an out stop. */
function stopTiles(stop: OutStop): readonly TileCoord[] {
  return stop.kind === 'spot' ? [{ tx: stop.tx, tz: stop.tz }] : stop.spots;
}

/** Every spot in a farmer's timetables on `mapId`, dry and wet, once each. */
function collectFarmerStops(mapId: MapId): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  for (const id of ['cosmo', 'barnaby'] as const satisfies readonly NpcId[]) {
    for (const leg of [...TIMETABLES[id].dry, ...TIMETABLES[id].wet]) {
      if (leg.to.kind === 'home' || leg.to.mapId !== mapId) continue;
      for (const tile of stopTiles(leg.to)) if (!coordIn(tiles, tile.tx, tile.tz)) tiles.push(tile);
    }
  }
  return tiles;
}

const FARMER_STOPS: Readonly<Record<'town' | 'neighbours', readonly TileCoord[]>> = {
  town: collectFarmerStops('town'),
  neighbours: collectFarmerStops('neighbours'),
};

/** Every spot in the farmers' timetables on `mapId` (spec §4.5): the fixed set 4c's drag-back keeps flat robots off. */
export function farmerStops(mapId: MapId): readonly TileCoord[] {
  return mapId === 'town' || mapId === 'neighbours' ? FARMER_STOPS[mapId] : NO_TILES;
}

/**
 * Where a save made at `minute` puts `id` (spec §9.2): on their target, facing the stop's way, or
 * indoors at home or before their first leg. A townsperson on a loop faces South, towards the
 * camera, as if they had just stopped there.
 */
export function placeAt(id: WalkerId, minute: number, wet: boolean): WalkerPlace {
  const target = targetOf(id, minute, wet);
  if (target === 'home') return INDOORS;
  return { kind: 'out', mapId: target.mapId, tx: target.tile.tx, tz: target.tile.tz, facing: target.facing ?? Direction.South };
}

/** The maps walkers walk, as the timetables check them: with nothing placed. */
const WALKED_MAPS: Readonly<Partial<Record<MapId, MapDefinition>>> = { town: TOWN_MAP, neighbours: NEIGHBOURS_MAP };

/** Tiles no stop may sit on (spec §3.1, §4.5, §7.1): the jobs' generators and robots' starting tiles. */
const JOB_TILES: readonly TileCoord[] = [...Object.values(JOBS.generators), JOBS.waveAt, ...JOBS.barnabyRobots];

/**
 * Throws on a broken timetable. Every walker's legs depart in order within the day, and a day
 * that has legs ends with one home. A character's home door is a door on its map; a townsperson's
 * exit is one of the town's. Every stop's tile is on the town or the Neighbours, in bounds and
 * walkable on the map with nothing placed (so never on a prop), not reserved, not in front of a
 * door, not on a field, a generator or a job robot's starting tile; a pace has spots and moves on
 * after a whole number of minutes; and the tile can be walked to from the walker's home front,
 * through the warp between the two maps when the stop is on the other one.
 */
export function assertTimetables(): void {
  const worlds = new Map<MapId, WorldState>();
  const worldOf = (def: MapDefinition): WorldState => {
    const known = worlds.get(def.id);
    if (known !== undefined) return known;
    const world = def.generate(0);
    worlds.set(def.id, world);
    return world;
  };
  const walkable = (world: WorldState, tile: TileCoord): boolean => {
    const at = getTile(world, tile.tx, tile.tz);
    return at !== null && isWalkable(at);
  };
  const reaches = (def: MapDefinition, from: TileCoord, to: TileCoord): boolean => {
    const world = worldOf(def);
    return findPath(def.grid, from, to, (_, next) => walkable(world, next)) !== null;
  };
  const defOf = (mapId: MapId, name: string): MapDefinition => {
    const def = WALKED_MAPS[mapId];
    if (def === undefined) throw new RangeError(`${name} is on ${mapId}, where nobody walks`);
    return def;
  };
  for (const id of WALKER_IDS) {
    const home = walkerHome(id);
    if (home.kind === 'exit') {
      if (!coordIn(TOWN_EXITS, home.tile.tx, home.tile.tz)) throw new RangeError(`Timetable ${id}: (${home.tile.tx}, ${home.tile.tz}) is not a town exit`);
    } else {
      const { door } = home;
      const doors = defOf(home.mapId, `Timetable ${id}: the home door`).structures.flatMap((s) => (s.door === null ? [] : [s.door]));
      if (!coordIn(doors, door.tx, door.tz)) throw new RangeError(`Timetable ${id}: (${door.tx}, ${door.tz}) is not a door on ${home.mapId}`);
    }
    const front = homeFront(id);
    const frontDef = defOf(front.mapId, `Timetable ${id}: the home front`);
    if (!walkable(worldOf(frontDef), front.tile)) throw new RangeError(`Timetable ${id}: the home front is not walkable`);
    for (const wet of [false, true]) {
      const legs = legsFor(id, wet);
      legs.forEach((leg, i) => {
        const name = `Timetable ${id} (${wet ? 'wet' : 'dry'}): the leg at minute ${leg.departs}`;
        const before = legs[i - 1];
        if (!Number.isInteger(leg.departs) || leg.departs < TIME.dayStartMinute || leg.departs >= TIME.passOutMinute) {
          throw new RangeError(`${name} departs outside the day`);
        }
        if (before !== undefined && before.departs >= leg.departs) throw new RangeError(`${name} departs out of order`);
        if (i === legs.length - 1 && leg.to.kind !== 'home') throw new RangeError(`${name} is the last, and doesn't go home`);
        if (leg.to.kind === 'home') return;
        if (leg.to.kind === 'pace' && (leg.to.spots.length === 0 || !Number.isInteger(leg.to.everyMinutes) || leg.to.everyMinutes < 1)) {
          throw new RangeError(`${name} paces with no spots or no whole minutes`);
        }
        const def = defOf(leg.to.mapId, name);
        if (isTownsfolk(id) && def.id !== 'town') throw new RangeError(`${name} leaves the town`);
        for (const tile of stopTiles(leg.to)) assertStop(def, worldOf(def), front, tile, `${name}: (${tile.tx}, ${tile.tz})`, reaches);
      });
    }
  }
}

/** One stop tile's rules (see `assertTimetables`). */
function assertStop(
  def: MapDefinition,
  world: WorldState,
  front: { readonly mapId: MapId; readonly tile: TileCoord },
  tile: TileCoord,
  name: string,
  reaches: (def: MapDefinition, from: TileCoord, to: TileCoord) => boolean,
): void {
  const { tx, tz } = tile;
  const at = getTile(world, tx, tz);
  if (!inBounds(def.grid, tx, tz) || at === null || !isWalkable(at)) throw new RangeError(`${name} is not walkable`);
  if (coordIn(def.reserved, tx, tz)) throw new RangeError(`${name} is on a reserved tile`);
  if (def.structures.some((s) => s.door !== null && s.door.tx === tx && s.door.tz + 1 === tz)) throw new RangeError(`${name} is in front of a door`);
  if (def.id === 'neighbours') {
    if (rectContains(COSMO_FIELD, tx, tz) || rectContains(BARNABY_FIELD, tx, tz)) throw new RangeError(`${name} is on a field`);
    if (coordIn(JOB_TILES, tx, tz)) throw new RangeError(`${name} is on a generator or a job robot's tile`);
  }
  const frontDef = WALKED_MAPS[front.mapId];
  if (frontDef === undefined) throw new RangeError(`${name}: the walker's home is on ${front.mapId}, where nobody walks`);
  if (frontDef.id === def.id) {
    if (!reaches(def, front.tile, tile)) throw new RangeError(`${name} can't be reached from the walker's home`);
    return;
  }
  const warp = frontDef.warps.find((w) => w.to.mapId === def.id);
  if (warp === undefined) throw new RangeError(`${name}: no warp leads from ${frontDef.id} to ${def.id}`);
  const arrival = { tx: warp.to.tx, tz: warp.to.tz };
  if (!reaches(frontDef, front.tile, warp.from) || !reaches(def, arrival, tile)) {
    throw new RangeError(`${name} can't be reached from the walker's home through the ${frontDef.id} gate`);
  }
}
