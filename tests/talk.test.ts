/**
 * Talking (farmclaws part 4a spec §3.1, §3.4): E on a character plans `talkTo`, hinted "Talk to
 * {name}", before anything else on their tile; Shift + E does the same, and so does Space with
 * nothing usable in hand or while carrying a robot. A chat opens the talk panel with the line
 * picked before the chat is recorded, freezes the game, costs no energy or time, and counts in
 * `npcs`; `talkedToday` clears each morning. E, K, Enter and Escape close the panel.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, NPC_IDS, type GameState, type MapId, type NpcId, type TileCoord } from '../src/core/types';
import { IGNORED, INTERACT_KEYS, panelKeyCommand } from '../src/input/panelKeys';
import { LINE_BANKS, lineFor } from '../src/people/lines';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction, planPrimaryAction, planShiftInteraction, type ActionPlan } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { selectIsFrozen } from '../src/state/selectors';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, emptyHanded, holding, robotOf, withEnergy, withPlayer, withRobots, withTile } from './testUtils';

const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const peek = (state: GameState): GameState => gameReducer(state, actions.peek());
const useTool = (state: GameState): GameState => gameReducer(state, actions.useTool());

/** Marigold's spot in the town (spec §2.1). */
const MARIGOLD: TileCoord = { tx: 7, tz: 7 };

/** The player on the tile south of Marigold, facing her, with empty hands. */
const AT_MARIGOLD: GameState = deepFreeze(emptyHanded(withPlayer(BASE, { tx: 7, tz: 8 }, Direction.North, 'town')));

const TALK_PLAN: ActionPlan = { target: MARIGOLD, intent: { kind: 'talkTo', npc: 'marigold' }, feedback: 'none', energyCost: 0 };

const INTRODUCTION = "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.";

/** Each character, the tile in front of them and the way to face them from it, and the hint's name. */
const FACING_EACH: readonly (readonly [NpcId, MapId, TileCoord, Direction, string])[] = [
  ['sol', 'town', { tx: 21, tz: 8 }, Direction.North, 'Sol'],
  ['marigold', 'town', { tx: 7, tz: 8 }, Direction.North, 'Marigold'],
  ['bram', 'town', { tx: 16, tz: 8 }, Direction.North, 'Bram'],
  ['juniper', 'town', { tx: 24, tz: 8 }, Direction.North, 'Juniper'],
  ['tess', 'town', { tx: 35, tz: 8 }, Direction.North, 'Tess'],
  ['cosmo', 'neighbours', { tx: 7, tz: 14 }, Direction.North, 'Cosmo'],
  ['barnaby', 'neighbours', { tx: 25, tz: 14 }, Direction.South, 'Barnaby'],
];

/**
 * AT_MARIGOLD carrying Sprocket (id 1). Movement never takes a carried robot off the farm, so the
 * state is built directly: it pins that planCarry asks about a character before its own rules.
 */
const CARRYING: GameState = withRobots({ ...AT_MARIGOLD, player: { ...AT_MARIGOLD.player, carrying: 1 } }, [robotOf({ carried: true })]);

/** The newest toast's text. */
const lastToast = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

describe('the talkTo intent', () => {
  it('plans a free talk with the character ahead, hinted "Talk to Marigold"', () => {
    expect(planInteraction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(describeIntent(planInteraction(AT_MARIGOLD).intent)).toBe('Talk to Marigold');
  });

  it('finds every character from the tile in front of them', () => {
    for (const [npc, mapId, stand, facing, name] of FACING_EACH) {
      const state = withPlayer(BASE, stand, facing, mapId);
      expect(planInteraction(state).intent, npc).toEqual({ kind: 'talkTo', npc });
      expect(describeIntent(planInteraction(state).intent)).toBe(`Talk to ${name}`);
      expect(interact(state).ui.panel).toEqual({ kind: 'talk', npc, line: LINE_BANKS[npc].introduction });
    }
  });

  it('talks only to the character on the target tile', () => {
    const facingAway = withPlayer(AT_MARIGOLD, { tx: 7, tz: 8 }, Direction.East, 'town');
    const oneTileShort = withPlayer(AT_MARIGOLD, { tx: 7, tz: 9 }, Direction.North, 'town');
    for (const state of [facingAway, oneTileShort]) {
      expect(planInteraction(state).intent).toEqual({ kind: 'blocked', reason: null });
      expect(interact(state)).toBe(state);
    }
  });

  it('comes before the objects on the tile: a chest and the workbench', () => {
    // Robots never leave the farm and characters never stand on it, so no robot can share a
    // character's tile; the order is pinned against placed objects and against planCarry.
    const chest = withTile(AT_MARIGOLD, MARIGOLD, { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } });
    const bench = withTile(AT_MARIGOLD, MARIGOLD, { ...EMPTY_TILE, object: { kind: 'workbench' } });
    for (const state of [chest, bench]) {
      expect(planInteraction(state)).toEqual(TALK_PLAN);
      expect(planShiftInteraction(state)).toEqual(TALK_PLAN);
    }
  });

  it("comes before planCarry's own rules, for E and Space", () => {
    expect(planInteraction(CARRYING)).toEqual(TALK_PLAN);
    expect(planPrimaryAction(CARRYING)).toEqual(TALK_PLAN);
    const next = useTool(CARRYING);
    expect(next.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });
    expect(next.player.carrying).toBe(1);
    expect(next.robots).toBe(CARRYING.robots);
    // Facing open ground instead, planCarry's own rules still apply.
    const aside = withPlayer(CARRYING, { tx: 7, tz: 8 }, Direction.East, 'town');
    expect(planInteraction(aside).intent).toEqual({ kind: 'putDownRobot', robotId: 1, name: 'Sprocket' });
  });

  it('Shift + E talks like E, even with the zone marker in hand', () => {
    expect(planShiftInteraction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(planShiftInteraction(holding(AT_MARIGOLD, 'zoneMarker'))).toEqual(TALK_PLAN);
    expect(peek(AT_MARIGOLD)).toEqual(interact(AT_MARIGOLD));
  });

  it('Space talks with empty hands, produce or materials; a placeable is refused', () => {
    expect(planPrimaryAction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(planPrimaryAction(holding(AT_MARIGOLD, 'stone', 3))).toEqual(TALK_PLAN);
    expect(planPrimaryAction(holding(AT_MARIGOLD, 'parsnip', 2))).toEqual(TALK_PLAN);
    expect(useTool(AT_MARIGOLD).ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });

    const placing = holding(AT_MARIGOLD, 'chest');
    expect(planPrimaryAction(placing)).toEqual({
      target: MARIGOLD,
      intent: { kind: 'blocked', reason: "Someone's standing there." },
      feedback: 'place',
      energyCost: 0,
    });
    const refused = useTool(placing);
    expect(refused.ui.panel).toEqual({ kind: 'none' });
    expect(refused.maps).toBe(placing.maps);
    expect(refused.npcs).toBe(placing.npcs);
    expect(lastToast(refused)).toBe("Someone's standing there.");
  });
});

describe('a chat', () => {
  it('opens the talk panel with the introduction first, then an everyday line', () => {
    const first = interact(AT_MARIGOLD);
    expect(first.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });
    const closed = gameReducer(first, actions.closePanel());
    const second = interact(closed);
    const line = lineFor(closed, 'marigold');
    expect(second.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line });
    expect(line).not.toBe(INTRODUCTION);
    expect(LINE_BANKS.marigold.everyday).toContain(line);
  });

  it('counts each chat and marks today, leaving the other characters alone', () => {
    const first = interact(AT_MARIGOLD);
    expect(first.npcs.marigold).toEqual({ talks: 1, talkedToday: true });
    for (const id of NPC_IDS) if (id !== 'marigold') expect(first.npcs[id]).toBe(AT_MARIGOLD.npcs[id]);
    const second = interact(gameReducer(first, actions.closePanel()));
    expect(second.npcs.marigold).toEqual({ talks: 2, talkedToday: true });
  });

  it('costs no energy and no time, even when exhausted', () => {
    const exhausted = withEnergy(AT_MARIGOLD, 0);
    const next = interact(exhausted);
    expect(next.ui.panel.kind).toBe('talk');
    expect(next.player.energy).toBe(0);
    expect(next.time).toBe(exhausted.time);
    expect(next.maps).toBe(exhausted.maps);
    expect(next.inventory).toBe(exhausted.inventory);
    expect(next.messages).toBe(exhausted.messages);
    expect(next.player.lastAction).toEqual({ seq: exhausted.player.actionSeq + 1, kind: 'none', target: MARIGOLD, success: true });
  });

  it('freezes the game while the panel is open', () => {
    const open = interact(AT_MARIGOLD);
    expect(selectIsFrozen(open)).toBe(true);
    expect(gameReducer(open, actions.tick(30))).toBe(open);
    expect(gameReducer(open, actions.move(Direction.West))).toBe(open);
    expect(gameReducer(open, actions.sleep())).toBe(open);
    expect(interact(open)).toBe(open);
    expect(peek(open)).toBe(open);
    expect(useTool(open)).toBe(open);
  });

  it('does nothing while paused', () => {
    const paused = gameReducer(AT_MARIGOLD, actions.setPaused(true));
    expect(interact(paused)).toBe(paused);
    expect(peek(paused)).toBe(paused);
    expect(useTool(paused)).toBe(paused);
  });
});

describe('the morning', () => {
  const talked = gameReducer(interact(AT_MARIGOLD), actions.closePanel());

  it('clears talkedToday, keeping talks and every untouched entry', () => {
    const morning = startNextDay(talked, false);
    expect(morning.npcs.marigold).toEqual({ talks: 1, talkedToday: false });
    for (const id of NPC_IDS) if (id !== 'marigold') expect(morning.npcs[id]).toBe(talked.npcs[id]);
    expect(gameReducer(talked, actions.sleep()).npcs.marigold).toEqual({ talks: 1, talkedToday: false });
  });

  it('keeps the npcs section itself when no one was talked to', () => {
    expect(startNextDay(BASE, false).npcs).toBe(BASE.npcs);
    const yesterday = startNextDay(talked, false);
    expect(startNextDay(yesterday, false).npcs).toBe(yesterday.npcs);
  });
});

describe('the talk panel keys (spec §3.2)', () => {
  const OPEN = deepFreeze(interact(AT_MARIGOLD));

  /** Presses `code` and returns the state the reducer leaves (the same state when nothing is dispatched). */
  function press(code: string, state: GameState, shift = false): GameState {
    const command = panelKeyCommand(code, state, shift);
    if (command === null || command === IGNORED) return state;
    return gameReducer(state, command);
  }

  it('E, K and Enter close it, with or without Shift, and never start another chat', () => {
    for (const code of INTERACT_KEYS) {
      for (const shift of [false, true]) {
        expect(panelKeyCommand(code, OPEN, shift)).toEqual(actions.closePanel());
        const closed = press(code, OPEN, shift);
        expect(closed.ui.panel).toEqual({ kind: 'none' });
        expect(closed.npcs).toBe(OPEN.npcs);
        expect(closed.player.lastAction).toBe(OPEN.player.lastAction);
      }
    }
  });

  it('Escape closes it', () => {
    expect(panelKeyCommand('Escape', OPEN)).toEqual(actions.closePanel());
    expect(press('Escape', OPEN).ui.panel).toEqual({ kind: 'none' });
  });

  it('I and B open nothing over it', () => {
    expect(press('KeyI', OPEN)).toBe(OPEN);
    expect(press('KeyB', OPEN)).toBe(OPEN);
  });
});
