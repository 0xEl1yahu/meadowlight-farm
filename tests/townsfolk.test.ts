/**
 * Talking to the townsfolk (farmclaws part 4d spec §3.3): E on a townsperson opens the chat box
 * with their plate, "Brookhollow" and today's line, `lines[hash32(seed, absoluteDay, index) % 3]`,
 * with no buttons. The line holds all day and changes with the day, and nothing about the chat is
 * saved: no talk counts, no other section touched.
 */
import { describe, expect, it } from 'vitest';
import { hash32 } from '../src/core/hash';
import { Direction, TOWNSFOLK_IDS, type GameState, type TownsfolkId } from '../src/core/types';
import { TOWNSFOLK_LINES, TOWNSFOLK_PLATES, townsfolkLine } from '../src/people/townsfolk';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { chatBoxView } from '../src/ui/chatBoxView';
import { BASE, atDay, emptyHanded, withPlayer, withWalkerAt } from './testUtils';

/** The plates, verbatim from spec §3.1. */
const SPEC_PLATES: Readonly<Record<TownsfolkId, string>> = {
  jogger: 'Jogger',
  dogWalker: 'Dog walker',
  retiree: 'Retiree',
  courier: 'Courier',
  busker: 'Busker',
  kid: 'Kid',
};

/** The tile the townsperson stands on for the chat: the open square, with the player south of it. */
const STOOD = { tx: 21, tz: 10 } as const;

/** `state` with `id` on the square at STOOD, facing South, and the player south of them facing North with empty hands. */
function facing(state: GameState, id: TownsfolkId): GameState {
  const out = withWalkerAt(state, id, 'town', STOOD.tx, STOOD.tz, Direction.South);
  return emptyHanded(withPlayer(out, { tx: STOOD.tx, tz: STOOD.tz + 1 }, Direction.North, 'town'));
}

/** The line spec §3.3 gives `id` on `state`'s day. */
function todaysLine(state: GameState, id: TownsfolkId): string {
  const lines = TOWNSFOLK_LINES[id];
  return lines[hash32(state.seed, state.time.absoluteDay, TOWNSFOLK_IDS.indexOf(id)) % lines.length] as string;
}

describe('a chat with a townsperson', () => {
  it.each(TOWNSFOLK_IDS)('opens on the %s with their plate, Brookhollow, today’s line verbatim and no buttons', (id) => {
    const before = facing(atDay(BASE, 3, 10 * 60), id);
    expect(planInteraction(before).intent).toEqual({ kind: 'talkTo', npc: id });
    expect(describeIntent(planInteraction(before).intent)).toBe(`Talk to ${SPEC_PLATES[id]}`);
    const open = gameReducer(before, actions.interact());
    const line = todaysLine(before, id);
    expect(TOWNSFOLK_LINES[id]).toContain(line);
    expect(open.ui.panel).toEqual({ kind: 'talk', npc: id, line, card: 'line' });
    expect(chatBoxView(open)).toEqual({ npc: id, name: SPEC_PLATES[id], role: 'Brookhollow', line, job: null, buttons: [] });
    expect(TOWNSFOLK_PLATES[id]).toBe(SPEC_PLATES[id]);
  });

  it('records nothing: the characters’ talks, the townsfolk and the time are untouched', () => {
    for (const id of TOWNSFOLK_IDS) {
      const before = facing(BASE, id);
      const open = gameReducer(before, actions.interact());
      expect(open.npcs, id).toBe(before.npcs);
      expect(open.townsfolk, id).toBe(before.townsfolk);
      expect(open.time, id).toBe(before.time);
      expect(open.player.energy, id).toBe(before.player.energy);
    }
  });
});

describe('today’s line', () => {
  it('holds all day: the same at 8:00 am, noon and 6:59 pm', () => {
    for (const id of TOWNSFOLK_IDS) {
      const lines = [8 * 60, 12 * 60, 18 * 60 + 59].map((minute) => townsfolkLine(facing(atDay(BASE, 5, minute), id), id));
      expect(new Set(lines).size, id).toBe(1);
      expect(lines[0], id).toBe(todaysLine(atDay(BASE, 5), id));
    }
  });

  it('changes with the day, and over a fortnight says every one of the three lines', () => {
    for (const id of TOWNSFOLK_IDS) {
      const said = new Set<string>();
      for (let day = 1; day <= 14; day++) {
        const state = facing(atDay(BASE, day), id);
        const line = townsfolkLine(state, id);
        expect(line, `${id} day ${day}`).toBe(todaysLine(state, id));
        said.add(line);
      }
      expect([...said].sort(), id).toEqual([...TOWNSFOLK_LINES[id]].sort());
    }
  });

  it('is picked from the seed too', () => {
    const lines = (seed: number): string[] => TOWNSFOLK_IDS.map((id) => townsfolkLine(facing({ ...atDay(BASE, 2), seed }, id), id));
    expect(lines(1)).not.toEqual(lines(2));
  });
});
