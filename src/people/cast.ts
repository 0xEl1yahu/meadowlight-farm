/**
 * The cast (farmclaws part 4a spec §2): who each character is, how they look, where they stand
 * and what their chat box offers. Pure data and lookups. The spots themselves live on the map
 * definitions (`MapDefinition.npcs`), so the startup check, movement, placement and the renderer
 * all read the same list.
 */
import type { Appearance, GameState, MapId, NpcActionKind, NpcId } from '../core/types';
import { giverJob, isGateOpen, type ShopGate } from '../jobs/jobs';
import { MAPS, type NpcPlacement } from '../world/maps';

export interface CastMember {
  readonly name: string;
  /** The line under the name in the chat box. */
  readonly role: string;
}

export const CAST: Readonly<Record<NpcId, CastMember>> = {
  sol: { name: 'Sol', role: 'Parts exchange' },
  cosmo: { name: 'Cosmo', role: 'Farmer' },
  barnaby: { name: 'Barnaby', role: 'Farmer' },
  marigold: { name: 'Marigold', role: 'General store' },
  berlioz: { name: 'Berlioz', role: 'Blacksmith' },
  juniper: { name: 'Juniper', role: 'Carpenter' },
  tallulah: { name: 'Tallulah', role: 'Ranch' },
};

/** The one prop each character carries on top of the player's model (spec §2.3). */
export const NPC_PROPS = ['toolApron', 'featherHat', 'clipboard', 'seedPouch', 'smithApron', 'pencil', 'neckerchief'] as const;
export type NpcProp = (typeof NPC_PROPS)[number];

export interface CastLook {
  readonly appearance: Appearance;
  readonly prop: NpcProp;
}

/**
 * Each character's fixed look: palette indices within the APPEARANCE ranges, plus their prop.
 * Every character has a shirt colour of their own and none wears the player's shirt 0, so no two
 * of them, and none of them and a new player, look alike. Hats: 0 is the farmer's straw hat, 1 no
 * hat, 2 a cap, 3 a knitted hat. Cosmo's feathered hat is his prop and Juniper's pencil sits on the
 * head, so both wear no hat; Sol wears the cap, Barnaby the knitted hat and Tallulah the straw hat.
 */
export const CAST_LOOKS: Readonly<Record<NpcId, CastLook>> = {
  sol: { appearance: { skinTone: 3, hairStyle: 2, hairColor: 4, shirtColor: 3, overallsColor: 2, hat: 2 }, prop: 'toolApron' },
  cosmo: { appearance: { skinTone: 1, hairStyle: 1, hairColor: 2, shirtColor: 5, overallsColor: 1, hat: 1 }, prop: 'featherHat' },
  barnaby: { appearance: { skinTone: 2, hairStyle: 0, hairColor: 5, shirtColor: 1, overallsColor: 4, hat: 3 }, prop: 'clipboard' },
  marigold: { appearance: { skinTone: 0, hairStyle: 2, hairColor: 3, shirtColor: 6, overallsColor: 3, hat: 1 }, prop: 'seedPouch' },
  berlioz: { appearance: { skinTone: 4, hairStyle: 0, hairColor: 1, shirtColor: 2, overallsColor: 5, hat: 1 }, prop: 'smithApron' },
  juniper: { appearance: { skinTone: 2, hairStyle: 1, hairColor: 0, shirtColor: 7, overallsColor: 0, hat: 1 }, prop: 'pencil' },
  tallulah: { appearance: { skinTone: 1, hairStyle: 2, hairColor: 5, shirtColor: 4, overallsColor: 2, hat: 0 }, prop: 'neckerchief' },
};

/** The character standing on (tx, tz) of map `mapId`, or null. */
export function npcAt(mapId: MapId, tx: number, tz: number): NpcId | null {
  for (const placement of MAPS[mapId].npcs) {
    if (placement.tx === tx && placement.tz === tz) return placement.id;
  }
  return null;
}

/** Where `npc` stands. The startup check places every character on exactly one map. */
export function npcSpot(npc: NpcId): { readonly mapId: MapId; readonly placement: NpcPlacement } {
  for (const def of Object.values(MAPS)) {
    const placement = def.npcs.find((p) => p.id === npc);
    if (placement !== undefined) return { mapId: def.id, placement };
  }
  throw new RangeError(`Character ${npc} is placed on no map`);
}

/** A button in the chat box (spec §3.2). */
export interface NpcAction {
  readonly kind: NpcActionKind;
  readonly label: string;
}

const NO_ACTIONS: readonly NpcAction[] = Object.freeze([]);

/** Each character's buttons after Job, and the shop gate they wait behind, or null (part 4c spec §4.2). */
const BUTTONS: Readonly<Record<NpcId, { readonly actions: readonly NpcAction[]; readonly gate: ShopGate | null }>> = {
  sol: { actions: [{ kind: 'partsShop', label: 'Shop' }], gate: 'partsShop' },
  cosmo: { actions: [], gate: null },
  barnaby: { actions: [], gate: null },
  marigold: { actions: [{ kind: 'shop', label: 'Shop' }], gate: null },
  berlioz: { actions: [], gate: null },
  juniper: { actions: [{ kind: 'workshop', label: 'Workshop' }], gate: 'workshop' },
  tallulah: { actions: [], gate: null },
};

const JOB_ACTION: NpcAction = Object.freeze({ kind: 'job', label: 'Job' });

function frozenList(list: readonly NpcAction[]): readonly NpcAction[] {
  return list.length === 0 ? NO_ACTIONS : Object.freeze([...list]);
}

/**
 * Each character's four lists, indexed by `(job open ? 1 : 0) + (gate open ? 2 : 0)`: with the
 * gate closed their buttons are missing, and Job goes in front of a giver's (part 4c spec §2.2).
 */
const LISTS = Object.fromEntries(
  Object.entries(BUTTONS).map(([npc, { actions, gate }]): [string, readonly (readonly NpcAction[])[]] => {
    const closed = gate === null ? actions : [];
    return [npc, [frozenList(closed), frozenList([JOB_ACTION, ...closed]), frozenList(actions), frozenList([JOB_ACTION, ...actions])]];
  }),
) as Readonly<Record<NpcId, readonly (readonly NpcAction[])[]>>;

/**
 * The chat box's action buttons for `npc`, in order: Job while their job is offered or active
 * (giverJob), then Marigold's Shop, and Sol's Shop and Juniper's Workshop once their gates are
 * open (isGateOpen). The lists are frozen and shared, so the same buttons are the same array.
 */
export function npcActions(state: GameState, npc: NpcId): readonly NpcAction[] {
  const { gate } = BUTTONS[npc];
  const index = (giverJob(state, npc) === null ? 0 : 1) + (gate === null || isGateOpen(state, gate) ? 2 : 0);
  return LISTS[npc][index] ?? NO_ACTIONS;
}
