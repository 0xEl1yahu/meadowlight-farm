/**
 * Shop hours (farmclaws part 4d spec §2.4, §5.1, §5.2): one table of opening hours for the five
 * shops, read from the clock alone. 4c's gates come first, then the hours: the keeper's button,
 * E on the door and B each have their own outcome outside hours and inside them. Jobs ignore the
 * hours.
 */
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/core/store';
import { Direction, type GameState, type UiPanel } from '../src/core/types';
import { npcActions } from '../src/people/cast';
import { SHOP_DOORS, SHOP_IDS, closedLine, nextOpening, shopOpen, type ShopId } from '../src/people/shops';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { BASE, atMinute, withJobsDone, withPlayer, withWalkerAt } from './testUtils';

const AM = (hour: number, minute = 0): number => hour * 60 + minute;
const NINE_AM = 'Sorry, we are closed! Open again at 9:00 am.';
const ONE_PM = 'Sorry, we are closed! Open again at 1:00 pm.';
const TOMORROW = 'Sorry, we are closed! Open again at 9:00 am tomorrow.';

/** Every gate open, so only the hours decide. */
const OPEN_GATES: GameState = deepFreeze(withJobsDone(BASE, 'knowTheLimits'));

const doorOf = (shop: ShopId) => SHOP_DOORS.find((d) => d.shop === shop)!;
const lastToast = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

/** The player on the tile in front of `shop`'s door, facing it, at `minute`. */
function atDoor(base: GameState, shop: ShopId, minute: number): GameState {
  const { door } = doorOf(shop);
  return withPlayer({ ...atMinute(base, minute) }, { tx: door.tx, tz: door.tz + 1 }, Direction.North, 'town');
}

/** A chat with `shop`'s keeper at `minute`, as a real talk panel. */
function chatWith(base: GameState, shop: ShopId, minute: number): GameState {
  const panel: UiPanel = { kind: 'talk', npc: doorOf(shop).keeper, line: 'Hello.', card: 'line' };
  const state = atMinute(base, minute);
  return { ...state, ui: { ...state.ui, panel } };
}

describe('shopOpen', () => {
  it('reads the clock: 9:00 to 12:00 and 1:00 to 5:00', () => {
    const open = (minute: number): boolean => shopOpen(atMinute(BASE, minute), 'generalStore');
    expect([AM(8, 59), AM(9), AM(11, 59), AM(12), AM(12, 59), AM(13), AM(16, 59), AM(17)].map(open)).toEqual([false, true, true, false, false, true, true, false]);
  });

  it('is one table for every shop, wherever the keeper is', () => {
    for (const shop of SHOP_IDS) {
      expect(shopOpen(atMinute(BASE, AM(10)), shop), shop).toBe(true);
      expect(shopOpen(atMinute(BASE, AM(18)), shop), shop).toBe(false);
    }
  });
});

describe('nextOpening and closedLine', () => {
  it('names the next window, and tomorrow once the last has closed', () => {
    expect(nextOpening(AM(6))).toBe('9:00 am');
    expect(nextOpening(AM(12))).toBe('1:00 pm');
    expect(nextOpening(AM(12, 59))).toBe('1:00 pm');
    expect(nextOpening(AM(17))).toBe('9:00 am tomorrow');
    expect(nextOpening(AM(26))).toBe('9:00 am tomorrow');
  });

  it('says the closed line', () => {
    expect(closedLine(AM(8))).toBe(NINE_AM);
    expect(closedLine(AM(12, 30))).toBe(ONE_PM);
    expect(closedLine(AM(20))).toBe(TOMORROW);
  });
});

describe('the shops table', () => {
  it('names the five shops, their doors, keepers, menus and gates', () => {
    expect(SHOP_DOORS.map((d) => [d.shop, d.door.tx, d.door.tz, d.keeper, d.menu, d.gate])).toEqual([
      ['generalStore', 6, 6, 'marigold', 'shop', null],
      ['blacksmith', 15, 6, 'berlioz', null, null],
      ['carpenter', 25, 6, 'juniper', 'workshop', 'workshop'],
      ['ranch', 34, 6, 'tallulah', null, null],
      ['partsExchange', 20, 6, 'sol', 'partsShop', 'partsShop'],
    ]);
  });
});

describe('the keeper buttons (spec §5.2)', () => {
  const CASES = [
    ['generalStore', 'shop', { kind: 'shop' }],
    ['carpenter', 'workshop', { kind: 'workshop' }],
    ['partsExchange', 'partsShop', { kind: 'partsShop' }],
  ] as const;

  it.each(CASES)("%s: the button is missing behind its gate's closed door, hours or not", (shop, act) => {
    if (doorOf(shop).gate === null) return;
    for (const minute of [AM(10), AM(20)]) {
      expect(npcActions(atMinute(BASE, minute), doorOf(shop).keeper).some((a) => a.kind === act)).toBe(false);
    }
  });

  it.each(CASES)('%s: outside hours the button changes the keeper\'s line and the chat stays open', (shop, act) => {
    const keeper = doorOf(shop).keeper;
    for (const [minute, line] of [[AM(8), NINE_AM], [AM(12, 30), ONE_PM], [AM(20), TOMORROW]] as const) {
      const chat = chatWith(OPEN_GATES, shop, minute);
      const next = gameReducer(chat, actions.npcAct(keeper, act));
      expect(next.ui.panel).toEqual({ kind: 'talk', npc: keeper, line, card: 'line' });
      expect(next.messages).toBe(chat.messages);
      expect(gameReducer(next, actions.npcAct(keeper, act))).toBe(next);
    }
  });

  it.each(CASES)('%s: in hours the button opens the menu', (shop, act, panel) => {
    const chat = chatWith(OPEN_GATES, shop, AM(10));
    expect(gameReducer(chat, actions.npcAct(doorOf(shop).keeper, act)).ui.panel).toEqual(panel);
  });

  it("keeps the keeper's normal line when you only talk to them outside hours", () => {
    const state = withWalkerAt(atDoor(OPEN_GATES, 'generalStore', AM(20)), 'marigold', 'town', 6, 7, Direction.South);
    const talking = gameReducer({ ...state, player: { ...state.player, tx: 6, tz: 8 } }, actions.interact());
    expect(talking.ui.panel).toMatchObject({ kind: 'talk', npc: 'marigold' });
    expect(talking.ui.panel).not.toMatchObject({ line: TOMORROW });
  });
});

describe('E on a shop door (spec §5.2)', () => {
  it.each(['carpenter', 'partsExchange'] as const)('%s: does nothing behind a closed gate, in hours or out', (shop) => {
    for (const minute of [AM(10), AM(20)]) {
      const state = atDoor(BASE, shop, minute);
      expect(planInteraction(state).intent).toEqual({ kind: 'blocked', reason: null });
      expect(gameReducer(state, actions.interact())).toBe(state);
    }
  });

  it.each(['generalStore', 'carpenter', 'partsExchange'] as const)('%s: outside hours it toasts the closed line, hint "Closed"', (shop) => {
    for (const [minute, line] of [[AM(8), NINE_AM], [AM(12, 30), ONE_PM], [AM(20), TOMORROW]] as const) {
      const state = atDoor(OPEN_GATES, shop, minute);
      expect(describeIntent(planInteraction(state).intent)).toBe('Closed');
      const next = gameReducer(state, actions.interact());
      expect(lastToast(next)).toBe(line);
      expect(next.ui.panel).toEqual({ kind: 'none' });
    }
  });

  it.each([
    ['generalStore', { kind: 'shop' }],
    ['carpenter', { kind: 'workshop' }],
    ['partsExchange', { kind: 'partsShop' }],
  ] as const)('%s: in hours it opens the menu, hint "Shop"', (shop, panel) => {
    const state = atDoor(OPEN_GATES, shop, AM(10));
    expect(describeIntent(planInteraction(state).intent)).toBe('Shop');
    expect(gameReducer(state, actions.interact()).ui.panel).toEqual(panel);
  });

  it('the shop/door action does the same as E, and is frozen with the game', () => {
    const closed = atDoor(OPEN_GATES, 'generalStore', AM(8));
    expect(lastToast(gameReducer(closed, actions.shopDoor('generalStore')))).toBe(NINE_AM);
    const open = atDoor(OPEN_GATES, 'generalStore', AM(10));
    expect(gameReducer(open, actions.shopDoor('generalStore')).ui.panel).toEqual({ kind: 'shop' });
    const paused = { ...closed, ui: { ...closed.ui, paused: true } };
    expect(gameReducer(paused, actions.shopDoor('generalStore'))).toBe(paused);
    const gated = atDoor(BASE, 'carpenter', AM(8));
    expect(gameReducer(gated, actions.shopDoor('carpenter'))).toBe(gated);
  });

  it.each(['blacksmith', 'ranch'] as const)("%s has no menu: closed toast outside hours, nothing in hours", (shop) => {
    const closed = atDoor(BASE, shop, AM(20));
    expect(describeIntent(planInteraction(closed).intent)).toBe('Closed');
    expect(lastToast(gameReducer(closed, actions.interact()))).toBe(TOMORROW);
    const open = atDoor(BASE, shop, AM(10));
    expect(planInteraction(open).intent).toEqual({ kind: 'blocked', reason: null });
    expect(gameReducer(open, actions.interact())).toBe(open);
  });

  it('only works on the town map', () => {
    const { door } = doorOf('generalStore');
    const farm = withPlayer(atMinute(OPEN_GATES, AM(8)), { tx: door.tx, tz: door.tz + 1 }, Direction.North, 'farm');
    expect(describeIntent(planInteraction(farm).intent)).not.toBe('Closed');
  });
});

describe('B (spec §5.2)', () => {
  it('toasts the closed line outside the general store hours, from any map', () => {
    for (const mapId of ['farm', 'town'] as const) {
      const state = withPlayer(atMinute(BASE, AM(20)), { tx: 20, tz: 8 }, Direction.South, mapId);
      const next = gameReducer(state, actions.setShopOpen(true));
      expect(next.ui.panel).toEqual({ kind: 'none' });
      expect(lastToast(next)).toBe(TOMORROW);
    }
    expect(lastToast(gameReducer(atMinute(BASE, AM(8)), actions.setShopOpen(true)))).toBe(NINE_AM);
  });

  it('opens the seed shop in hours, as before, and closes it whenever', () => {
    const open = gameReducer(atMinute(BASE, AM(10)), actions.setShopOpen(true));
    expect(open.ui.panel).toEqual({ kind: 'shop' });
    expect(gameReducer(open, actions.setShopOpen(false)).ui.panel).toEqual({ kind: 'none' });
  });

  it("doesn't toast while another panel is open or the game is paused", () => {
    const bag = { ...atMinute(BASE, AM(20)), ui: { ...BASE.ui, panel: { kind: 'inventory' } } } satisfies GameState;
    expect(gameReducer(bag, actions.setShopOpen(true))).toBe(bag);
    const paused = { ...atMinute(BASE, AM(20)), ui: { ...BASE.ui, paused: true } };
    expect(gameReducer(paused, actions.setShopOpen(true))).toBe(paused);
  });
});

describe('jobs ignore the hours (spec §2.4)', () => {
  it("at 8:00 pm Sol's Job button is there and job 1 can be taken", () => {
    const state = withPlayer(withWalkerAt(atMinute(BASE, AM(20)), 'sol', 'town', 21, 7, Direction.South), { tx: 21, tz: 8 }, Direction.North, 'town');
    const chat = gameReducer(state, actions.interact());
    expect(npcActions(chat, 'sol').map((a) => a.kind)).toEqual(['job']);
    const card = gameReducer(chat, actions.npcAct('sol', 'job'));
    expect(card.ui.panel).toMatchObject({ kind: 'talk', npc: 'sol', card: 'job' });
    const taken = gameReducer(card, actions.takeJob('spinningRobot'));
    expect(taken.jobs.status.spinningRobot).toBe('active');
    expect(taken.ui.panel).toEqual({ kind: 'none' });
  });
});
