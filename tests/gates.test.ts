/**
 * The shop gates (farmclaws part 4c spec §4.2, §4.3): Juniper's workshop opens with job 1, Sol's
 * parts shop with job 2, and Standard and Big robots with job 3. Before a gate opens its button is
 * missing (or its cards show "After Barnaby's job." in place of Buy), and `workshop/order` and
 * `parts/buy` refuse silently behind it. A save from 4b with any robot counts job 1 as done.
 */
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/core/store';
import { Direction, NPC_IDS, ROBOT_SIZES, type GameState, type UiPanel } from '../src/core/types';
import { JOBS_TABLE, isGateOpen } from '../src/jobs/jobs';
import { npcActions, npcSpot } from '../src/people/cast';
import { actions } from '../src/state/actions';
import { deserializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { workshopView } from '../src/ui/shops/viewModel';
import { BASE, must, robotOf, v8Save, withGold, withJobsDone, withMigratedJobs, withPlayer, withRobots } from './testUtils';

const withPanel = (state: GameState, panel: UiPanel): GameState => ({ ...state, ui: { ...state.ui, panel } });

const JOB1 = deepFreeze(withJobsDone(BASE, 'spinningRobot'));
const JOB2 = deepFreeze(withJobsDone(BASE, 'showHim'));
const JOB3 = deepFreeze(withJobsDone(BASE, 'knowTheLimits'));
/** Job 1 active: taken but not finished, so nothing is open yet. */
const JOB1_ACTIVE = deepFreeze({ ...BASE, jobs: { ...BASE.jobs, status: { ...BASE.jobs.status, spinningRobot: 'active' } } } satisfies GameState);

const kinds = (state: GameState, npc: Parameters<typeof npcActions>[1]): string[] => npcActions(state, npc).map((a) => a.kind);

describe('isGateOpen', () => {
  it('opens each gate with its job done, and not before', () => {
    const table = [
      [BASE, false, false, false],
      [JOB1_ACTIVE, false, false, false],
      [JOB1, true, false, false],
      [JOB2, true, true, false],
      [JOB3, true, true, true],
    ] as const;
    for (const [state, workshop, partsShop, bigRobots] of table) {
      const label = JSON.stringify(state.jobs.status);
      expect(isGateOpen(state, 'workshop'), label).toBe(workshop);
      expect(isGateOpen(state, 'partsShop'), label).toBe(partsShop);
      expect(isGateOpen(state, 'bigRobots'), label).toBe(bigRobots);
    }
  });
});

describe('the buttons', () => {
  it("gives Juniper no Workshop button until job 1 is done", () => {
    expect(kinds(BASE, 'juniper')).toEqual([]);
    expect(kinds(JOB1_ACTIVE, 'juniper')).toEqual([]);
    expect(npcActions(JOB1, 'juniper')).toEqual([{ kind: 'workshop', label: 'Workshop' }]);
  });

  it('gives Sol no Shop button until job 2 is done, with Job in front while job 1 is open', () => {
    expect(npcActions(BASE, 'sol')).toEqual([{ kind: 'job', label: 'Job' }]);
    expect(npcActions(JOB1_ACTIVE, 'sol')).toEqual([{ kind: 'job', label: 'Job' }]);
    expect(kinds(JOB1, 'sol')).toEqual([]);
    expect(npcActions(JOB2, 'sol')).toEqual([{ kind: 'partsShop', label: 'Shop' }]);
  });

  it("leaves Marigold's seed shop open from the start", () => {
    for (const state of [BASE, JOB1, JOB3]) expect(npcActions(state, 'marigold')).toEqual([{ kind: 'shop', label: 'Shop' }]);
  });

  it('keeps the lists frozen and shared', () => {
    for (const state of [BASE, JOB1, JOB2, JOB3]) {
      for (const npc of NPC_IDS) {
        expect(Object.isFrozen(npcActions(state, npc)), npc).toBe(true);
        expect(npcActions(state, npc), npc).toBe(npcActions({ ...state }, npc));
      }
    }
    expect(npcActions(BASE, 'juniper')).toBe(npcActions(BASE, 'tallulah'));
  });

  it("doesn't open a shop from the chat behind its gate", () => {
    const juniper = withPanel(BASE, { kind: 'talk', npc: 'juniper', line: 'Hello.', card: 'line' });
    expect(gameReducer(juniper, actions.npcAct('juniper', 'workshop'))).toBe(juniper);
    const sol = withPanel(JOB1, { kind: 'talk', npc: 'sol', line: 'Hello.', card: 'line' });
    expect(gameReducer(sol, actions.npcAct('sol', 'partsShop'))).toBe(sol);
  });

  it("opens Juniper's workshop from a real chat once job 1 is done", () => {
    const { mapId, placement } = must(npcSpot('juniper'));
    const talking = gameReducer(withPlayer(JOB1, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId), actions.interact());
    expect(gameReducer(talking, actions.npcAct('juniper', 'workshop')).ui.panel).toEqual({ kind: 'workshop' });
  });
});

describe('silent refusals', () => {
  it('refuses every order behind the workshop gate, with no toast', () => {
    const shop = deepFreeze(withPanel(withGold(BASE, 20000), { kind: 'workshop' }));
    for (const size of ROBOT_SIZES) expect(gameReducer(shop, actions.orderRobot(size, 'Bolt')), size).toBe(shop);
  });

  it('refuses Standard and Big orders until job 3, but takes a Mini after job 1', () => {
    const shop = deepFreeze(withPanel(withGold(JOB2, 20000), { kind: 'workshop' }));
    expect(gameReducer(shop, actions.orderRobot('standard', 'Bolt'))).toBe(shop);
    expect(gameReducer(shop, actions.orderRobot('big', 'Bolt'))).toBe(shop);
    expect(gameReducer(shop, actions.orderRobot('mini', 'Bolt')).robots.deliveries).toEqual([{ size: 'mini', name: 'Bolt' }]);
    const open = deepFreeze(withPanel(withGold(JOB3, 20000), { kind: 'workshop' }));
    expect(gameReducer(open, actions.orderRobot('big', 'Bolt')).robots.deliveries).toEqual([{ size: 'big', name: 'Bolt' }]);
  });

  it('refuses parts behind the parts shop gate, with no toast', () => {
    const shop = deepFreeze(withPanel(withGold(JOB1, 2000), { kind: 'partsShop' }));
    expect(gameReducer(shop, actions.buyPart('claw'))).toBe(shop);
    const open = deepFreeze(withPanel(withGold(JOB2, 2000), { kind: 'partsShop' }));
    expect(gameReducer(open, actions.buyPart('claw')).player.gold).toBeLessThan(2000);
  });
});

describe("the workshop's cards", () => {
  it("show \"After Barnaby's job.\" on Standard and Big until job 3 is done", () => {
    const locked = (state: GameState): (string | null)[] => workshopView(state).cards.map((card) => card.locked);
    expect(locked(JOB1)).toEqual([null, "After Barnaby's job.", "After Barnaby's job."]);
    expect(locked(JOB2)).toEqual([null, "After Barnaby's job.", "After Barnaby's job."]);
    expect(locked(JOB3)).toEqual([null, null, null]);
  });
});

describe('the unlock lines', () => {
  it('are toasted after each job, one per gate (spec §4.2)', () => {
    expect(JOBS_TABLE.spinningRobot.doneLines).toEqual(["Juniper's workshop is open."]);
    expect(JOBS_TABLE.showHim.doneLines).toEqual(["Sol's parts shop is open."]);
    expect(JOBS_TABLE.knowTheLimits.doneLines).toEqual(['Juniper now builds Standard and Big robots.']);
  });
});

describe('a save from 4b (spec §4.3)', () => {
  const load = (state: GameState): GameState => must(deserializeGame(JSON.stringify(v8Save(state))));

  it('opens the workshop when it has a robot, and keeps the parts shop and the bigger sizes gated', () => {
    const loaded = load(withMigratedJobs(withRobots(BASE, [robotOf()])));
    expect(isGateOpen(loaded, 'workshop')).toBe(true);
    expect(isGateOpen(loaded, 'partsShop')).toBe(false);
    expect(isGateOpen(loaded, 'bigRobots')).toBe(false);
    expect(npcActions(loaded, 'juniper')).toEqual([{ kind: 'workshop', label: 'Workshop' }]);
    expect(kinds(loaded, 'sol')).toEqual([]);
  });

  it('opens the workshop when it has only a delivery due', () => {
    const due: GameState = { ...BASE, robots: { ...BASE.robots, deliveries: [{ size: 'mini', name: 'Bolt' }] } };
    expect(isGateOpen(load(withMigratedJobs(due)), 'workshop')).toBe(true);
  });

  it('keeps every gate closed without a robot or a delivery', () => {
    const loaded = load(withMigratedJobs(BASE));
    expect(isGateOpen(loaded, 'workshop')).toBe(false);
    expect(npcActions(loaded, 'sol')).toEqual([{ kind: 'job', label: 'Job' }]);
  });
});
