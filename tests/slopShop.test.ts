/**
 * SLOPMART 24/7 (farmclaws part 4d spec §6): E on the booth's door talks to DEALZ at any hour, a
 * mystery box costs SLOP.boxPrice, and the three refusals come first, in order, charging nothing.
 * Each box is fixed by the save's seed and its lifetime count of boxes: mostly one of the twelve
 * slop items, sometimes a gem. DEALZ's lines are verbatim, in capitals, and end " ✓"; only the
 * toast says what was in the box. Barnaby notices a box bought today.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, SLOP, SLOP_GEMS } from '../src/config';
import { hash32, hashFloat } from '../src/core/hash';
import { deepFreeze } from '../src/core/store';
import {
  CROP_IDS,
  Direction,
  SEASONS,
  SLOP_IDS,
  Season,
  TileState,
  type GameState,
  type ItemId,
  type NpcTalk,
  type RobotPartId,
  type SlopItemId,
} from '../src/core/types';
import { CROPS, isInSeason, seedItemId } from '../src/farming/crops';
import { panelKeyCommand } from '../src/input/panelKeys';
import { getItem, sellPriceFor } from '../src/items/items';
import { lineFor } from '../src/people/lines';
import { DEALZ_LINES, boxAt, dealzGreeting, dealzResult, isGem, type BoxContents } from '../src/people/slop';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { describeIntent, planInteraction, planPrimaryAction } from '../src/state/intents';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, atMinute, holding, must, scenario, soilTile, stack, tileAt, withGold, withPlayer, withSlots } from './testUtils';

/** Spec §6.4's greetings, in order. */
const GREETINGS = [
  'BUY SOMETHING OR GET THE HELL OUT PUNK ✓',
  'WHAT ARE YOU OGLIN\' AT? ✓',
  'WHY ARE YOU HERE? ✓',
  'YOU BUYING OR WINDOW SHOPPING, PAL? ✓',
  'OH GREAT. A CUSTOMER ✓',
  'YOUR SATISFACTION IS NOT TRACKED. NEITHER ARE YOUR FEELINGS ✓',
  'NO REFUNDS. NO EXCHANGES. NO EYE CONTACT ✓',
  'YOU AGAIN ✓',
];

/** Spec §6.4's result lines after "{ITEM}", in order. */
const RESULT_TAILS = [". ENJOY IT OR DON'T. I DON'T CARE ✓", '. PREMIUM QUALITY. NEXT ✓', '. BEST ONE YET. NOW MOVE ✓'];

const SOLD_OUT = 'SOLD OUT. GO HOME ✓';
const NO_GOLD = 'NO MONEY, NO SLOP. BEAT IT ✓';
const BAG_FULL = 'YOUR BAG IS FULL. NOT MY PROBLEM, PAL ✓';

/** Spec §6.3's slop table: id, name and description. */
const SLOP_TABLE: readonly (readonly [SlopItemId, string, string])[] = [
  ['chocolateTeapot', 'Chocolate teapot', 'HOLDS HOT TEA. BRIEFLY ✓'],
  ['dollHead', "Doll's head", 'PREMIUM DOLL EXPERIENCE. 100% OF THE HEAD ✓'],
  ['oneFlipFlop', 'One flip-flop', 'HALF A PAIR. TWICE THE VALUE ✓'],
  ['glassHammer', 'Glass hammer', 'FOR VERY GENTLE NAILS ✓'],
  ['inflatableDartboard', 'Inflatable dartboard', 'HOURS OF FUN. SECONDS OF DARTBOARD ✓'],
  ['waterproofTeabag', 'Waterproof teabag', 'KEEPS YOUR TEA DRY ✓'],
  ['solarTorch', 'Solar torch', 'WORKS PERFECTLY IN DAYLIGHT ✓'],
  ['signedPhoto', 'Signed photo of nobody', 'AUTHENTIC SIGNATURE. AUTHENTIC NOBODY ✓'],
  ['cowPainting', 'Seven-legged cow painting', 'PHOTOREALISTIC COW. ANATOMICALLY CORRECT ✓'],
  ['boxOfBoxes', 'Box of empty boxes', 'STORAGE SOLUTION FOR YOUR STORAGE SOLUTIONS ✓'],
  ['padlockNoKey', 'Padlock, no key', 'MAXIMUM SECURITY. MAXIMUM ✓'],
  ['fishnetBucket', 'Fishnet bucket', 'HOLDS ANYTHING BIGGER THAN THE HOLES ✓'],
];

/** The tile in front of the booth's door, (29, 7), facing it, at 10:00 pm: long after the other shops have shut. */
const AT_BOOTH: GameState = deepFreeze(withGold(atMinute(withPlayer(BASE, { tx: 29, tz: 7 }, Direction.North, 'town'), 22 * 60), 500));

const lastToast = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

/** `state` with DEALZ's chat open, after `boxesOpened` lifetime boxes and `today` boxes today. */
function chatting(state: GameState = AT_BOOTH, boxesOpened = 0, today = 0): GameState {
  const counted: GameState = { ...state, slopShop: { boxesOpened }, shopsSoldToday: { ...state.shopsSoldToday, slopBoxes: today } };
  return gameReducer(counted, actions.openSlopShop());
}

/** The first lifetime count from `from` whose box `matches`, for BASE's seed in BASE's season. */
function firstBox(matches: (box: BoxContents, gem: boolean) => boolean, from = 0): number {
  for (let n = from; n < 10_000; n++) if (matches(boxAt(BASE.seed, n, BASE.time.season), isGem(BASE.seed, n))) return n;
  throw new Error('no such box in the first 10,000');
}

/** A full bag: every unlocked slot holds something. */
function fullBag(state: GameState, last: ReturnType<typeof stack> = stack('stone', 1)): GameState {
  const stacks = Array.from({ length: INVENTORY.startingUnlockedSlots }, (_, i) => (i === INVENTORY.startingUnlockedSlots - 1 ? last : stack('wood', 1)));
  return withSlots(state, stacks);
}

/** Everything a refusal must leave alone. */
const ledger = (state: GameState) => ({
  gold: state.player.gold,
  inventory: state.inventory,
  slopShop: state.slopShop,
  sold: state.shopsSoldToday,
  messages: state.messages,
});

describe('the booth door', () => {
  it('plans a slopShop intent from (29, 7) facing the door, hint "Talk to DEALZ", at any hour', () => {
    for (const minute of [6 * 60, 12 * 60 + 30, 22 * 60, 25 * 60]) {
      const plan = planInteraction(atMinute(AT_BOOTH, minute));
      expect(plan.intent, String(minute)).toEqual({ kind: 'slopShop' });
      expect(plan.target).toEqual({ tx: 29, tz: 6 });
      expect(describeIntent(plan.intent)).toBe('Talk to DEALZ');
    }
  });

  it('is not planned facing another way, or on another map', () => {
    expect(planInteraction(withPlayer(AT_BOOTH, { tx: 29, tz: 7 }, Direction.East, 'town')).intent.kind).not.toBe('slopShop');
    expect(planInteraction(withPlayer(AT_BOOTH, { tx: 29, tz: 7 }, Direction.North, 'farm')).intent.kind).not.toBe('slopShop');
  });

  it('E opens DEALZ’s chat with the greeting hash32(seed, absoluteDay, boxesOpened, 4101) % 8', () => {
    const opened = gameReducer(AT_BOOTH, actions.interact());
    const greeting = GREETINGS[hash32(BASE.seed, BASE.time.absoluteDay, 0, SLOP.greetingSalt) % 8];
    expect(opened.ui.panel).toEqual({ kind: 'slopShop', line: greeting });
    expect(dealzGreeting(AT_BOOTH)).toBe(greeting);
  });

  it('picks the greeting by the day and the lifetime count', () => {
    const seen = new Set<string>();
    for (const day of [0, 1, 2, 9]) {
      for (const boxesOpened of [0, 1, 5, 40]) {
        const state: GameState = { ...AT_BOOTH, time: { ...AT_BOOTH.time, absoluteDay: day }, slopShop: { boxesOpened } };
        const greeting = must(GREETINGS[hash32(state.seed, day, boxesOpened, SLOP.greetingSalt) % 8]);
        expect(dealzGreeting(state)).toBe(greeting);
        seen.add(greeting);
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('slop/open does nothing while paused or with another panel open', () => {
    const paused: GameState = { ...AT_BOOTH, ui: { ...AT_BOOTH.ui, paused: true } };
    expect(gameReducer(paused, actions.openSlopShop())).toBe(paused);
    const inventory: GameState = { ...AT_BOOTH, ui: { ...AT_BOOTH.ui, panel: { kind: 'inventory' } } };
    expect(gameReducer(inventory, actions.openSlopShop())).toBe(inventory);
  });

  it('E, K, Enter and Escape close the chat', () => {
    const open = chatting();
    for (const code of ['KeyE', 'KeyK', 'Enter', 'NumpadEnter', 'Escape']) {
      expect(panelKeyCommand(code, open), code).toEqual(actions.closePanel());
      expect(panelKeyCommand(code, open, true), code).toEqual(actions.closePanel());
    }
    expect(gameReducer(open, actions.closePanel()).ui.panel).toEqual({ kind: 'none' });
  });
});

describe('buying a box', () => {
  it('takes the price, adds the box, counts it, changes the line to a result and toasts the truth', () => {
    const open = chatting();
    const box = boxAt(BASE.seed, 0, BASE.time.season);
    const bought = gameReducer(open, actions.buySlopBox());
    expect(bought.player.gold).toBe(500 - SLOP.boxPrice);
    expect(countItem(bought.inventory, box.itemId)).toBe(countItem(open.inventory, box.itemId) + box.quantity);
    expect(bought.slopShop).toEqual({ boxesOpened: 1 });
    expect(bought.shopsSoldToday).toEqual({ ...open.shopsSoldToday, slopBoxes: 1 });
    expect(bought.ui.panel).toEqual({ kind: 'slopShop', line: dealzResult(BASE.seed, 0, box) });
    const name = getItem(box.itemId).name;
    expect(lastToast(bought)).toBe(box.quantity > 1 ? `Mystery box: ${name} ×${box.quantity}.` : `Mystery box: ${name}.`);
  });

  it('toasts "Mystery box: {name}." for one item and "Mystery box: {name} ×{quantity}." for more', () => {
    const slop = firstBox((_box, gem) => !gem);
    const one = gameReducer(chatting(AT_BOOTH, slop), actions.buySlopBox());
    const slopBox = boxAt(BASE.seed, slop, BASE.time.season);
    expect(slopBox.quantity).toBe(1);
    expect(lastToast(one)).toBe(`Mystery box: ${getItem(slopBox.itemId).name}.`);
    expect(one.ui.panel).toEqual({ kind: 'slopShop', line: `${getItem(slopBox.itemId).name.toUpperCase()}${RESULT_TAILS[hash32(BASE.seed, slop, SLOP.resultSalt) % 3]}` });

    const gem = firstBox((box, isAGem) => isAGem && box.quantity > 1);
    const many = gameReducer(chatting(AT_BOOTH, gem), actions.buySlopBox());
    const gemBox = boxAt(BASE.seed, gem, BASE.time.season);
    expect(lastToast(many)).toBe(`Mystery box: ${getItem(gemBox.itemId).name} ×${gemBox.quantity}.`);
    expect(many.ui.panel).toEqual({
      kind: 'slopShop',
      line: `${getItem(gemBox.itemId).name.toUpperCase()} ×${gemBox.quantity}${RESULT_TAILS[hash32(BASE.seed, gem, SLOP.resultSalt) % 3]}`,
    });
  });

  it('keeps the chat open, so three boxes can be bought in a row, each the next in the sequence', () => {
    let state = chatting();
    for (let n = 0; n < SLOP.boxesPerDay; n++) {
      const box = boxAt(BASE.seed, n, BASE.time.season);
      const before = countItem(state.inventory, box.itemId);
      state = gameReducer(state, actions.buySlopBox());
      expect(state.ui.panel.kind).toBe('slopShop');
      expect(countItem(state.inventory, box.itemId)).toBe(before + box.quantity);
    }
    expect(state.player.gold).toBe(500 - SLOP.boxesPerDay * SLOP.boxPrice);
    expect(state.slopShop.boxesOpened).toBe(SLOP.boxesPerDay);
    expect(state.shopsSoldToday.slopBoxes).toBe(SLOP.boxesPerDay);
  });

  it('does nothing without DEALZ’s chat open, or while paused', () => {
    expect(gameReducer(AT_BOOTH, actions.buySlopBox())).toBe(AT_BOOTH);
    const open = chatting();
    const paused: GameState = { ...open, ui: { ...open.ui, paused: true } };
    expect(gameReducer(paused, actions.buySlopBox())).toBe(paused);
  });
});

describe('refusals', () => {
  /** Buys with DEALZ's chat open on `state`; returns the state before and after. */
  function refused(state: GameState): { readonly before: GameState; readonly after: GameState } {
    const before = gameReducer(state, actions.openSlopShop());
    return { before, after: gameReducer(before, actions.buySlopBox()) };
  }

  const cases: readonly (readonly [string, GameState, string])[] = [
    ['sold out after SLOP.boxesPerDay boxes today', { ...AT_BOOTH, shopsSoldToday: { ...AT_BOOTH.shopsSoldToday, slopBoxes: SLOP.boxesPerDay } }, SOLD_OUT],
    ['no gold under the price', withGold(AT_BOOTH, SLOP.boxPrice - 1), NO_GOLD],
    ['no completely empty slot', fullBag(AT_BOOTH), BAG_FULL],
  ];

  it.each(cases)('%s: the line, verbatim, and nothing charged', (_label, state, line) => {
    const { before, after } = refused(state);
    expect(after.ui.panel).toEqual({ kind: 'slopShop', line });
    expect(line.endsWith(' ✓')).toBe(true);
    expect(ledger(after)).toEqual(ledger(before));
  });

  it('are checked in order: sold out, then gold, then the bag', () => {
    const broke = fullBag(withGold(AT_BOOTH, 0));
    const soldOut: GameState = { ...broke, shopsSoldToday: { ...broke.shopsSoldToday, slopBoxes: SLOP.boxesPerDay } };
    expect(refused(soldOut).after.ui.panel).toEqual({ kind: 'slopShop', line: SOLD_OUT });
    expect(refused(broke).after.ui.panel).toEqual({ kind: 'slopShop', line: NO_GOLD });
  });

  it('match DEALZ_LINES', () => {
    expect(DEALZ_LINES).toEqual({ soldOut: SOLD_OUT, noGold: NO_GOLD, bagFull: BAG_FULL });
  });

  it('a bag full apart from a part-stack of Speed-Gro still refuses a box of Speed-Gro', () => {
    const speedGro = firstBox((box) => box.itemId === 'speedGro');
    const bag = fullBag({ ...AT_BOOTH, slopShop: { boxesOpened: speedGro } }, stack('speedGro', 10));
    const { before, after } = refused(bag);
    expect(after.ui.panel).toEqual({ kind: 'slopShop', line: BAG_FULL });
    expect(ledger(after)).toEqual(ledger(before));
  });

  it('pays the exact price with exactly SLOP.boxPrice gold and one empty slot', () => {
    const stacks = Array.from({ length: INVENTORY.startingUnlockedSlots - 1 }, () => stack('wood', 1));
    const bought = gameReducer(chatting(withSlots(withGold(AT_BOOTH, SLOP.boxPrice), stacks)), actions.buySlopBox());
    expect(bought.player.gold).toBe(0);
    expect(bought.slopShop.boxesOpened).toBe(1);
  });
});

describe('the box sequence', () => {
  it('follows spec §6.3: tier by hashFloat(seed, n, 4102) < 0.1, pick by hash32(seed, n, 4103)', () => {
    for (const seed of [0, BASE.seed, 12345]) {
      for (let n = 0; n < 500; n++) {
        const gem = hashFloat(seed, n, SLOP.tierSalt) < SLOP.gemChance;
        expect(isGem(seed, n)).toBe(gem);
        const box = boxAt(seed, n, Season.Spring);
        if (!gem) {
          expect(box).toEqual({ itemId: SLOP_IDS[hash32(seed, n, SLOP.pickSalt) % SLOP_IDS.length], quantity: 1 });
          continue;
        }
        const entry = must(SLOP_GEMS[hash32(seed, n, SLOP.pickSalt) % SLOP_GEMS.length]);
        if (entry.kind === 'item') expect(box).toEqual({ itemId: entry.itemId, quantity: entry.quantity });
        else {
          const crops = CROP_IDS.filter((id) => CROPS[id].habitat === 'field' && !CROPS[id].seasons.includes(Season.Spring));
          expect(box).toEqual({ itemId: seedItemId(must(crops[hash32(seed, n, SLOP.cropSalt) % crops.length])), quantity: entry.quantity });
        }
      }
    }
  });

  it('holds spec §6.3’s gem table', () => {
    expect(SLOP_GEMS).toEqual([
      { kind: 'item', itemId: 'spectraherb_seeds', quantity: 3 },
      { kind: 'item', itemId: 'qualitySprinkler', quantity: 1 },
      { kind: 'item', itemId: 'speedGro', quantity: 5 },
      { kind: 'item', itemId: 'qualityFertilizer', quantity: 5 },
      { kind: 'outOfSeasonSeeds', quantity: 5 },
    ]);
    expect(SLOP).toEqual({
      boxPrice: 40,
      gemChance: 0.1,
      boxesPerDay: 3,
      slopSellPrice: 1,
      greetingSalt: 4101,
      tierSalt: 4102,
      pickSalt: 4103,
      cropSalt: 4104,
      resultSalt: 4105,
    });
  });

  it('gives the same box for the same seed and lifetime count, before and after a reload', () => {
    for (let n = 0; n < 50; n++) expect(boxAt(BASE.seed, n, Season.Fall)).toEqual(boxAt(BASE.seed, n, Season.Fall));
    const state: GameState = { ...AT_BOOTH, slopShop: { boxesOpened: 17 } };
    const reloaded = must(deserializeGame(serializeGame(state)));
    const buy = (s: GameState): GameState => gameReducer(gameReducer(s, actions.openSlopShop()), actions.buySlopBox());
    expect(buy(reloaded).inventory).toEqual(buy(state).inventory);
  });

  it('over 10,000 boxes: about one in ten is a gem, and every gem and slop item turns up', () => {
    const seen = new Set<ItemId>();
    let gems = 0;
    for (let n = 0; n < 10_000; n++) {
      if (isGem(BASE.seed, n)) gems++;
      seen.add(boxAt(BASE.seed, n, Season.Summer).itemId);
    }
    expect(gems / 10_000).toBeGreaterThanOrEqual(0.08);
    expect(gems / 10_000).toBeLessThanOrEqual(0.12);
    for (const id of SLOP_IDS) expect(seen.has(id), id).toBe(true);
    for (const id of ['spectraherb_seeds', 'qualitySprinkler', 'speedGro', 'qualityFertilizer'] as const) expect(seen.has(id), id).toBe(true);
    expect([...seen].some((id) => getItem(id).kind === 'seed' && id !== 'spectraherb_seeds')).toBe(true);
  });

  it('never gives out-of-season seeds that are in season, nor shade crops, in any season', () => {
    for (const season of SEASONS) {
      let found = 0;
      for (let n = 0; n < 10_000; n++) {
        const entry = SLOP_GEMS[hash32(BASE.seed, n, SLOP.pickSalt) % SLOP_GEMS.length];
        if (!isGem(BASE.seed, n) || entry?.kind !== 'outOfSeasonSeeds') continue;
        const item = getItem(boxAt(BASE.seed, n, season).itemId);
        expect(item.kind).toBe('seed');
        if (item.kind !== 'seed') continue;
        expect(CROPS[item.cropId].habitat).toBe('field');
        expect(isInSeason(CROPS[item.cropId], season), `${item.id} in season ${season}`).toBe(false);
        found++;
      }
      expect(found).toBeGreaterThan(0);
    }
  });
});

describe('result lines', () => {
  const teapot: BoxContents = { itemId: 'chocolateTeapot', quantity: 1 };
  const speedGro: BoxContents = { itemId: 'speedGro', quantity: 5 };

  it('pick by hash32(seed, boxesOpened, 4105) % 3, whatever the tier', () => {
    const picked = new Set<number>();
    for (let n = 0; n < 60; n++) {
      const index = hash32(BASE.seed, n, SLOP.resultSalt) % 3;
      picked.add(index);
      expect(dealzResult(BASE.seed, n, teapot)).toBe(`CHOCOLATE TEAPOT${RESULT_TAILS[index]}`);
      expect(dealzResult(BASE.seed, n, speedGro)).toBe(`SPEED-GRO ×5${RESULT_TAILS[index]}`);
    }
    expect(picked.size).toBe(3);
  });

  it('are all in capitals and end " ✓", like every DEALZ line', () => {
    const lines = [...GREETINGS, ...Object.values(DEALZ_LINES), ...Array.from({ length: 30 }, (_, n) => dealzResult(BASE.seed, n, boxAt(BASE.seed, n, Season.Winter)))];
    for (const line of lines) {
      expect(line, line).toBe(line.toUpperCase());
      expect(line.endsWith(' ✓'), line).toBe(true);
    }
  });
});

describe('the morning and Barnaby', () => {
  /** Barnaby talked to once, so his introduction is behind him. */
  const metBarnaby = (state: GameState): GameState => {
    const barnaby: NpcTalk = { ...state.npcs.barnaby, talks: 1 };
    return { ...state, npcs: { ...state.npcs, barnaby } };
  };

  it('restocks: today’s count goes back to 0 in the morning, the lifetime count stays', () => {
    const bought = gameReducer(chatting(), actions.buySlopBox());
    const closed = gameReducer(bought, actions.closePanel());
    const morning = gameReducer(closed, actions.sleep());
    expect(morning.shopsSoldToday.slopBoxes).toBe(0);
    expect(morning.slopShop).toEqual({ boxesOpened: 1 });
  });

  it('Barnaby says his SLOPMART line after a box today, before his other reactive lines', () => {
    const before = metBarnaby(AT_BOOTH);
    expect(lineFor(before, 'barnaby')).toBe("No robots yet? You're leaving money in the field, friend.");
    const after = metBarnaby(gameReducer(gameReducer(chatting(), actions.buySlopBox()), actions.closePanel()));
    expect(lineFor(after, 'barnaby')).toBe("Bought a box at SLOPMART? Open all hours, no wages, no complaints. Well, none I've read.");
    const nextDay = gameReducer(after, actions.sleep());
    expect(lineFor(nextDay, 'barnaby')).toBe("No robots yet? You're leaving money in the field, friend.");
  });
});

describe('slop items', () => {
  it('are the twelve of spec §6.3, verbatim, stacking to INVENTORY.maxStack and shipping for 1g', () => {
    expect(SLOP_IDS).toEqual(SLOP_TABLE.map(([id]) => id));
    for (const [id, name, description] of SLOP_TABLE) {
      const item = getItem(id);
      expect(item).toMatchObject({ kind: 'slop', id, name, description, maxStack: INVENTORY.maxStack, sellPrice: SLOP.slopSellPrice, hasQuality: false });
      expect(sellPriceFor(id, 0)).toBe(1);
    }
  });

  it('ship for 1g each through the bin', () => {
    const atBin = withPlayer(BASE, { tx: 9, tz: 6 }, Direction.North, 'farm');
    let state = gameReducer(holding(atBin, 'glassHammer', 7), actions.interact());
    expect(state.shipping.pending).toEqual([stack('glassHammer', 7)]);
    state = gameReducer(state, actions.sleep());
    expect(state.shipping.lastPayout).toBe(7);
  });

  it.each(SLOP_IDS)('%s can’t be placed, planted, burnt or fitted, and E or use with it selected does nothing', (id) => {
    for (const tile of [EMPTY_TILE, soilTile(TileState.Plowed)]) {
      const state = holding(scenario(tile), id, 3);
      expect(planPrimaryAction(state).intent.kind, id).toBe('blocked');
      expect(gameReducer(state, actions.useTool())).toBe(state);
      expect(gameReducer(state, actions.interact())).toBe(state);
    }
    const burner = holding(scenario({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }), id, 3);
    const loaded = gameReducer(burner, actions.interact());
    expect(tileAt(loaded, TARGET).object).toEqual({ kind: 'woodBurner', fuel: 0 });
    expect(loaded.inventory).toBe(burner.inventory);
    expect(gameReducer(burner, actions.fitPart(1, id as unknown as RobotPartId))).toBe(burner);
  });
});
