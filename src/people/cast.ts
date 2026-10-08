/**
 * The cast (farmclaws part 4a spec §2): who each character is, how they look, where they stand
 * and what their chat box offers. Pure data and lookups. The spots themselves live on the map
 * definitions (`MapDefinition.npcs`), so the startup check, movement, placement and the renderer
 * all read the same list.
 */
import type { Appearance, MapId, NpcActionKind, NpcId } from '../core/types';
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
  bram: { name: 'Bram', role: 'Blacksmith' },
  juniper: { name: 'Juniper', role: 'Carpenter' },
  tess: { name: 'Tess', role: 'Ranch' },
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
 * head, so both wear no hat; Sol wears the cap, Barnaby the knitted hat and Tess the straw hat.
 */
export const CAST_LOOKS: Readonly<Record<NpcId, CastLook>> = {
  sol: { appearance: { skinTone: 3, hairStyle: 2, hairColor: 4, shirtColor: 3, overallsColor: 2, hat: 2 }, prop: 'toolApron' },
  cosmo: { appearance: { skinTone: 1, hairStyle: 1, hairColor: 2, shirtColor: 5, overallsColor: 1, hat: 1 }, prop: 'featherHat' },
  barnaby: { appearance: { skinTone: 2, hairStyle: 0, hairColor: 5, shirtColor: 1, overallsColor: 4, hat: 3 }, prop: 'clipboard' },
  marigold: { appearance: { skinTone: 0, hairStyle: 2, hairColor: 3, shirtColor: 6, overallsColor: 3, hat: 1 }, prop: 'seedPouch' },
  bram: { appearance: { skinTone: 4, hairStyle: 0, hairColor: 1, shirtColor: 2, overallsColor: 5, hat: 1 }, prop: 'smithApron' },
  juniper: { appearance: { skinTone: 2, hairStyle: 1, hairColor: 0, shirtColor: 7, overallsColor: 0, hat: 1 }, prop: 'pencil' },
  tess: { appearance: { skinTone: 1, hairStyle: 2, hairColor: 5, shirtColor: 4, overallsColor: 2, hat: 0 }, prop: 'neckerchief' },
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

const ACTIONS: Readonly<Record<NpcId, readonly NpcAction[]>> = {
  sol: NO_ACTIONS,
  cosmo: NO_ACTIONS,
  barnaby: NO_ACTIONS,
  marigold: Object.freeze([{ kind: 'shop', label: 'Shop' }]),
  bram: NO_ACTIONS,
  juniper: NO_ACTIONS,
  tess: NO_ACTIONS,
};

/** The chat box's action buttons for `npc`, in order: Marigold's Shop, and none for anyone else yet. */
export function npcActions(npc: NpcId): readonly NpcAction[] {
  return ACTIONS[npc];
}
