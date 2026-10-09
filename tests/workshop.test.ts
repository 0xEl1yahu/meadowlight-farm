/**
 * Juniper's robot workshop (farmclaws part 4b spec §4): Workshop in Juniper's chat opens the
 * workshop panel; the range is one ready-made robot per size with a claw and the harvester
 * program; the suggested name comes from WORKSHOP_NAMES by a seeded start and skips used names;
 * `workshop/order` pays and queues a delivery (the 12-robot cap counts deliveries due); the night
 * step turns each delivery into a robot beside the workbench, whose morning stack runs that morning.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, ROBOTS, WORKBENCH } from '../src/config';
import { hash32 } from '../src/core/hash';
import { deepFreeze } from '../src/core/store';
import { Direction, ROBOT_SIZES, type GameState, type RobotDelivery, type TileCoord, type UiPanel } from '../src/core/types';
import { npcActions, npcSpot } from '../src/people/cast';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram } from '../src/robots/check';
import { addRobot } from '../src/robots/create';
import { freeSpotNear } from '../src/robots/workbench';
import { WORKSHOP_NAMES, WORKSHOP_ROBOTS, catalogueRobot, suggestedName } from '../src/robots/workshop';
import { actions } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { workshopView } from '../src/ui/shops/viewModel';
import { BASE, must, robotOf, withGold, withPlayer, withRobots } from './testUtils';

const withPanel = (state: GameState, panel: UiPanel, paused = false): GameState => ({ ...state, ui: { ...state.ui, panel, paused } });
const withDeliveries = (state: GameState, deliveries: readonly RobotDelivery[]): GameState => ({
  ...state,
  robots: { ...state.robots, deliveries },
});

/** BASE with Juniper's workshop open and 20,000g. */
const WORKSHOP: GameState = deepFreeze(withPanel(withGold(BASE, 20000), { kind: 'workshop' }));

const order = (state: GameState, size: (typeof ROBOT_SIZES)[number], name: string): GameState => gameReducer(state, actions.orderRobot(size, name));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const lastToast = (state: GameState): unknown => state.messages.entries.at(-1);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);

/** `count` robots far from the bench, with ids 1 … count, named R1, R2, … */
const robotsNamed = (count: number): ReturnType<typeof robotOf>[] =>
  Array.from({ length: count }, (_, i) => robotOf({ id: i + 1, name: `R${i + 1}`, tx: 2 + (i % 6), tz: 12 + Math.floor(i / 6) }));

const HARVESTER = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.harvest()), b.powerDown())] });
/** A program a robot with no parts can run, for checking names alone. */
const POWER_DOWN = b.program({ stacks: [b.when(b.morning(), b.powerDown())] });

describe("Juniper's Workshop action", () => {
  it('gives Juniper a Workshop button', () => {
    expect(npcActions('juniper')).toEqual([{ kind: 'workshop', label: 'Workshop' }]);
  });

  it("swaps Juniper's chat for the workshop, from a real chat", () => {
    const { mapId, placement } = must(npcSpot('juniper'));
    const before = withPlayer(BASE, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
    const talking = gameReducer(before, actions.interact());
    expect(talking.ui.panel.kind).toBe('talk');
    const shopping = gameReducer(talking, actions.npcAct('juniper', 'workshop'));
    expect(shopping.ui).toEqual({ ...talking.ui, panel: { kind: 'workshop' } });
  });
});

describe('the range', () => {
  it('is one robot per size, each with a claw and the harvester program', () => {
    for (const size of ROBOT_SIZES) {
      expect(WORKSHOP_ROBOTS[size].parts, size).toEqual(['claw']);
      expect(WORKSHOP_ROBOTS[size].program, size).toEqual(HARVESTER);
    }
    expect(ROBOT_SIZES.map((size) => ROBOTS.sizes[size].price)).toEqual([1500, 4000, 10000]);
  });

  it('passes the program and .MD checks and addRobot', () => {
    for (const size of ROBOT_SIZES) {
      const robot = WORKSHOP_ROBOTS[size];
      expect(checkProgram(robot.program, { size, parts: robot.parts }), size).toBeNull();
      expect(checkMd([], { size }), size).toBeNull();
      const added = addRobot(BASE, { name: 'Bolt', size, parts: robot.parts, program: robot.program, place: { tx: 5, tz: 10, facing: Direction.South } });
      expect('state' in added, size).toBe(true);
    }
  });

  it('makes a catalogue robot for the preview without touching the state', () => {
    const mini = catalogueRobot('mini');
    expect(mini).toMatchObject({ size: 'mini', parts: ['claw'], program: HARVESTER, tokens: ROBOTS.sizes.mini.battery, bag: [], md: [], power: 'working' });
    expect(mini.name).toBe('Mini');
    expect(catalogueRobot('big', 'Bolt')).toMatchObject({ name: 'Bolt', size: 'big', tokens: ROBOTS.sizes.big.battery });
  });
});

describe('suggestedName', () => {
  const start = (state: GameState): number => hash32(state.seed, state.robots.nextId + state.robots.deliveries.length) % WORKSHOP_NAMES.length;

  it('has 24 distinct names that pass the robot name rule', () => {
    expect(WORKSHOP_NAMES).toHaveLength(24);
    expect(new Set(WORKSHOP_NAMES).size).toBe(24);
    for (const name of WORKSHOP_NAMES) expect('state' in addRobot(BASE, { name, size: 'mini', parts: [], program: POWER_DOWN, place: { tx: 5, tz: 10, facing: Direction.South } }), name).toBe(true);
  });

  it('starts from the seeded index, deterministically', () => {
    expect(suggestedName(BASE)).toBe(WORKSHOP_NAMES[start(BASE)]);
    expect(suggestedName(BASE)).toBe(suggestedName(deepFreeze({ ...BASE })));
  });

  it('moves on as robots are added or ordered', () => {
    const ordered = withDeliveries(BASE, [{ size: 'mini', name: 'Someone' }]);
    expect(suggestedName(ordered)).toBe(WORKSHOP_NAMES[start(ordered)]);
  });

  it('skips names robots on the farm and deliveries due already have, and wraps', () => {
    let state = withRobots(BASE, robotsNamed(3));
    const first = start(state);
    const taken = [first, (first + 1) % 24].map((i) => must(WORKSHOP_NAMES[i]));
    state = withRobots(state, robotsNamed(3).map((robot, i) => (i < 1 ? { ...robot, name: must(taken[0]) } : robot)));
    state = withDeliveries(state, [{ size: 'mini', name: must(taken[1]) }]);
    // The deliveries count towards the start too.
    const from = start(state);
    const used = new Set([...state.robots.list.map((r) => r.name), ...state.robots.deliveries.map((d) => d.name)]);
    const expected = Array.from({ length: 24 }, (_, i) => must(WORKSHOP_NAMES[(from + i) % 24])).find((name) => !used.has(name));
    expect(suggestedName(state)).toBe(expected);

    // Every name from the start to the end of the list is taken: it wraps to the first free one.
    const tail = WORKSHOP_NAMES.slice(from);
    const wrapped = withDeliveries(state, tail.map((name) => ({ size: 'mini', name })));
    const wrappedFrom = start(wrapped);
    const wrappedUsed = new Set([...wrapped.robots.list.map((r) => r.name), ...tail]);
    const wrappedExpected = Array.from({ length: 24 }, (_, i) => must(WORKSHOP_NAMES[(wrappedFrom + i) % 24])).find((name) => !wrappedUsed.has(name));
    expect(suggestedName(wrapped)).toBe(wrappedExpected);
    expect(wrappedUsed.has(suggestedName(wrapped))).toBe(false);
  });
});

describe('workshop/order', () => {
  it('pays, queues the delivery and says when it comes', () => {
    const next = order(WORKSHOP, 'standard', 'Bolt');
    expect(next.player.gold).toBe(20000 - 4000);
    expect(next.robots.deliveries).toEqual([{ size: 'standard', name: 'Bolt' }]);
    expect(next.robots.list).toBe(WORKSHOP.robots.list);
    expect(next.ui.panel).toEqual({ kind: 'workshop' });
    expect(lastToast(next)).toMatchObject({ text: 'Juniper will deliver Bolt tomorrow morning.', tone: 'success' });
    const again = order(next, 'mini', 'Cog');
    expect(again.robots.deliveries).toEqual([
      { size: 'standard', name: 'Bolt' },
      { size: 'mini', name: 'Cog' },
    ]);
    expect(isValidGameState(again)).toBe(true);
  });

  it('applies the robot name rule', () => {
    for (const name of ['', ' Bolt', 'Bolt ', 'x'.repeat(25)]) {
      const next = order(WORKSHOP, 'mini', name);
      expect(next.player, JSON.stringify(name)).toBe(WORKSHOP.player);
      expect(next.robots).toBe(WORKSHOP.robots);
      expect(lastToast(next)).toMatchObject({ text: 'A robot needs a name of 1 to 24 characters.', tone: 'warn' });
    }
    expect(order(WORKSHOP, 'mini', 'x'.repeat(24)).robots.deliveries).toHaveLength(1);
  });

  it('refuses without enough gold', () => {
    const poor = withGold(WORKSHOP, 9999);
    const next = order(poor, 'big', 'Bolt');
    expect(next.player).toBe(poor.player);
    expect(next.robots).toBe(poor.robots);
    expect(lastToast(next)).toMatchObject({ text: 'You need 10000g.', tone: 'warn' });
    expect(order(withGold(WORKSHOP, 10000), 'big', 'Bolt').player.gold).toBe(0);
  });

  it('counts deliveries due towards the 12-robot cap', () => {
    const eleven = withRobots(WORKSHOP, robotsNamed(11));
    const ok = order(eleven, 'mini', 'Bolt');
    expect(ok.robots.deliveries).toHaveLength(1);
    const full = order(ok, 'mini', 'Cog');
    expect(full.robots).toBe(ok.robots);
    expect(full.player).toBe(ok.player);
    expect(lastToast(full)).toMatchObject({ text: 'The farm already has 12 robots.', tone: 'warn' });
    const twelve = withRobots(WORKSHOP, robotsNamed(12));
    expect(order(twelve, 'mini', 'Bolt').robots).toBe(twelve.robots);
  });

  it('does nothing unless the workshop is open and the game unpaused, or for an unknown size', () => {
    for (const state of [withPanel(WORKSHOP, { kind: 'none' }), withPanel(WORKSHOP, { kind: 'partsShop' }), withPanel(WORKSHOP, { kind: 'workshop' }, true)]) {
      expect(order(state, 'mini', 'Bolt')).toBe(state);
    }
    expect(gameReducer(WORKSHOP, { type: 'workshop/order', size: 'huge' as never, name: 'Bolt' })).toBe(WORKSHOP);
  });
});

describe('delivery overnight', () => {
  /** The first free tile by the bench, taken by a robot already standing there. */
  const benchSide = freeSpotNear(BASE.maps.farm, WORKBENCH.home, [PLAYER.spawn]);

  /** Two orders due, a robot on the bench's nearest free tile, and the player holding another robot. */
  function nightBefore(): GameState {
    const standing = robotOf({ id: 1, name: 'Sprocket', tx: benchSide.tx, tz: benchSide.tz });
    const held = robotOf({ id: 2, name: 'Held', carried: true });
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 2 } }, [standing, held]);
    return deepFreeze(
      withDeliveries(state, [
        { size: 'standard', name: 'Bolt' },
        { size: 'mini', name: 'Cog' },
      ]),
    );
  }

  it('turns each delivery into a robot beside the workbench, in order, on free tiles', () => {
    const before = nightBefore();
    const next = sleep(before);
    expect(next.robots.deliveries).toEqual([]);
    expect(next.robots.list.map((r) => r.name)).toEqual(['Sprocket', 'Held', 'Bolt', 'Cog']);
    expect(next.robots.list.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(next.robots.nextId).toBe(5);

    const [standing, held, bolt, cog] = next.robots.list.map((r) => must(r));
    const taken: TileCoord[] = [PLAYER.spawn, ...[must(standing), must(held)].map((r) => ({ tx: r.tx, tz: r.tz }))];
    const first = freeSpotNear(next.maps.farm, WORKBENCH.home, taken);
    const second = freeSpotNear(next.maps.farm, WORKBENCH.home, [...taken, first]);
    expect({ tx: must(bolt).tx, tz: must(bolt).tz }).toEqual(first);
    expect({ tx: must(cog).tx, tz: must(cog).tz }).toEqual(second);
    expect(first).not.toEqual(second);
    expect(must(standing)).toMatchObject({ tx: benchSide.tx, tz: benchSide.tz });

    expect(must(bolt)).toMatchObject({
      size: 'standard',
      parts: ['claw'],
      program: HARVESTER,
      facing: Direction.South,
      tokens: ROBOTS.sizes.standard.battery,
      carried: false,
      onBench: false,
      md: [],
    });
    expect(must(cog)).toMatchObject({ size: 'mini', tokens: ROBOTS.sizes.mini.battery });
    expect(isValidGameState(next)).toBe(true);
  });

  it('says so after "Good morning", in order, and not as missing a generator', () => {
    const next = sleep(nightBefore());
    const all = texts(next);
    const morning = all.findIndex((text) => text.startsWith('Good morning'));
    const bolt = all.indexOf("Juniper delivered Bolt. It's waiting by the workbench.");
    const cog = all.indexOf("Juniper delivered Cog. It's waiting by the workbench.");
    expect(morning).toBeGreaterThanOrEqual(0);
    expect(bolt).toBeGreaterThan(morning);
    expect(cog).toBeGreaterThan(bolt);
    expect(all.some((text) => text.includes('Bolt') && text.includes('generator'))).toBe(false);
  });

  it("runs a delivered robot's morning stack that morning", () => {
    const next = sleep(withDeliveries(BASE, [{ size: 'mini', name: 'Bolt' }]));
    const bolt = must(next.robots.list.find((r) => r.name === 'Bolt'));
    expect(bolt.power).toBe('working');
    expect(must(bolt.exec).running).not.toBeNull();
    // Zone A is unset, so the loop does nothing and the robot powers down at its first act.
    const later = gameReducer(next, actions.tick(ROBOTS.period));
    const after = must(later.robots.list.find((r) => r.name === 'Bolt'));
    expect(after.power).not.toBe('working');
  });

  it('leaves the robots section alone on a night with nothing due', () => {
    expect(sleep(BASE).robots).toBe(BASE.robots);
  });
});

describe('workshopView', () => {
  it('shows the gold, the robot count and one card per size', () => {
    const state = withDeliveries(withRobots(WORKSHOP, robotsNamed(2)), [{ size: 'mini', name: 'Bolt' }]);
    const view = workshopView(state);
    expect(view.gold).toBe(20000);
    expect(view.count).toBe('3 / 12 robots');
    expect(view.cards).toEqual([
      { size: 'mini', title: 'Mini', price: 1500, specs: '1 part slot · 80 battery · 12 blocks', line: 'Comes with a claw and a program that harvests Zone A.' },
      { size: 'standard', title: 'Standard', price: 4000, specs: '2 part slots · 200 battery · 30 blocks', line: 'Comes with a claw and a program that harvests Zone A.' },
      { size: 'big', title: 'Big', price: 10000, specs: '3 part slots · 500 battery · 80 blocks', line: 'Comes with a claw and a program that harvests Zone A.' },
    ]);
    expect(view.suggestedName).toBe(suggestedName(state));
  });
});
