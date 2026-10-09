/**
 * The chat box's pure parts (farmclaws part 4a spec §3.2): what it shows for the open talk panel
 * and when it takes the phone layout. The test environment is node, so the box itself (its place
 * above the hotbar, the buttons, Close, the phone layout) is checked in the browser playbook, as
 * for the robot screen.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_SCREEN } from '../src/config';
import { Direction, NPC_IDS, type GameState, type NpcId } from '../src/core/types';
import { npcSpot } from '../src/people/cast';
import { lineFor } from '../src/people/lines';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { chatBoxView, isPhoneWidth } from '../src/ui/chatBoxView';
import { BASE, must, withPlayer } from './testUtils';

/** Names and role lines, verbatim from spec §2.1. */
const SPEC_CAST: Readonly<Record<NpcId, readonly [string, string]>> = {
  sol: ['Sol', 'Parts exchange'],
  cosmo: ['Cosmo', 'Farmer'],
  barnaby: ['Barnaby', 'Farmer'],
  marigold: ['Marigold', 'General store'],
  berlioz: ['Berlioz', 'Blacksmith'],
  juniper: ['Juniper', 'Carpenter'],
  tallulah: ['Tallulah', 'Ranch'],
};

/** BASE with the talk panel open on `npc`, carrying `line`. */
const talkingTo = (npc: NpcId, line = 'Lovely weather.'): GameState => ({
  ...BASE,
  ui: { ...BASE.ui, panel: { kind: 'talk', npc, line } },
});

/** BASE with the player in town on the tile south of Marigold, facing her (she faces south). */
function facingMarigold(): GameState {
  const { mapId, placement } = must(npcSpot('marigold'));
  return withPlayer(BASE, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
}

describe('chatBoxView', () => {
  it('is null unless the talk panel is open', () => {
    expect(chatBoxView(BASE)).toBeNull();
    const shop: GameState = { ...BASE, ui: { ...BASE.ui, panel: { kind: 'shop' } } };
    const inventory: GameState = { ...BASE, ui: { ...BASE.ui, panel: { kind: 'inventory' } } };
    const paused: GameState = { ...BASE, ui: { ...BASE.ui, paused: true } };
    expect(chatBoxView(shop)).toBeNull();
    expect(chatBoxView(inventory)).toBeNull();
    expect(chatBoxView(paused)).toBeNull();
  });

  it("shows Marigold's name, her role line, the panel's line and her Shop button", () => {
    expect(chatBoxView(talkingTo('marigold'))).toEqual({
      npc: 'marigold',
      name: 'Marigold',
      role: 'General store',
      line: 'Lovely weather.',
      actions: [{ kind: 'shop', label: 'Shop' }],
    });
  });

  it("shows every character's name and role line, with buttons only for Marigold", () => {
    for (const npc of NPC_IDS) {
      const view = must(chatBoxView(talkingTo(npc)));
      expect(view.npc).toBe(npc);
      expect([view.name, view.role]).toEqual(SPEC_CAST[npc]);
      expect(view.actions).toEqual(npc === 'marigold' ? [{ kind: 'shop', label: 'Shop' }] : []);
    }
  });

  it('shows the line the talk panel carries, picked before the chat was recorded', () => {
    const intro = "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.";
    const talking = gameReducer(facingMarigold(), actions.interact());
    expect(must(chatBoxView(talking)).line).toBe(intro);
    // The chat is recorded now, so a fresh pick would no longer be the introduction.
    expect(lineFor(talking, 'marigold')).not.toBe(intro);
  });
});

describe('isPhoneWidth', () => {
  it('is true below ROBOT_SCREEN.phoneMaxWidth, as for the robot screen', () => {
    expect(isPhoneWidth(ROBOT_SCREEN.phoneMaxWidth - 1)).toBe(true);
    expect(isPhoneWidth(ROBOT_SCREEN.phoneMaxWidth)).toBe(false);
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(1280)).toBe(false);
  });
});
