/**
 * The robot screen's pure parts (farmclaws part 3 spec §4, §11): header text, tab visibility,
 * the switch, Stats and Log rows, prompts, and the keyboard handover (InputController and the
 * ui/notify toast). The DOM and Blockly glue are checked in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROBOT_CARE, ROBOT_PAINTS, UNLOCKS } from '../src/config';
import { createStore, type Store } from '../src/core/store';
import type { GameState, RobotLogEntry, RobotLogEvent } from '../src/core/types';
import { InputController } from '../src/input/InputController';
import type { CameraRig } from '../src/render/CameraRig';
import { ALL_UNLOCKS } from '../src/robots/unlocks';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import {
  EMPTY_TABS_TEXT,
  LOG_TEXT,
  countText,
  discardPrompt,
  formatClockMinute,
  headerView,
  isEditTab,
  logRows,
  nextTab,
  paintButtonText,
  paintHex,
  paintName,
  phoneQuery,
  ruinedNote,
  scrapPrompt,
  statsRows,
  switchView,
  visibleTabs,
} from '../src/ui/robotScreen/viewModel';
import { BASE, atDay, robotOf, withRobots } from './testUtils';

function withPanel(state: GameState, panel: GameState['ui']['panel']): GameState {
  return { ...state, ui: { ...state.ui, panel } };
}

describe('headerView', () => {
  it('names the robot, its size, parts and tokens', () => {
    const robot = robotOf({ name: 'Bolt', size: 'standard', parts: ['claw', 'sensorEye'], tokens: 42 });
    expect(headerView(robot)).toEqual({
      name: 'Bolt',
      sizeLabel: 'Standard',
      parts: ['claw', 'sensorEye'],
      tokens: '42 / 200 tokens',
      power: 'Working',
      offText: null,
    });
  });

  it('gives the off text for each reason', () => {
    expect(headerView(robotOf({ off: 'player' })).offText).toBe('Switched off');
    expect(headerView(robotOf({ off: 'dizzy' })).offText).toBe('Off until morning');
    expect(headerView(robotOf({ off: 'done' })).offText).toBe('Off until morning');
  });

  it('names every power', () => {
    const power = (p: Parameters<typeof robotOf>[0]) => headerView(robotOf(p)).power;
    expect(power({ power: 'standby' })).toBe('Standing by');
    expect(power({ power: 'flat', tokens: 0 })).toBe('Flat');
    expect(power({ power: 'broken' })).toBe('Shorted out');
    expect(power({ power: 'repairing', repairReadyDay: 3 })).toBe('Getting a new core');
    expect(power({ power: 'ruined' })).toBe('Ruined');
  });

  it("uses the size's battery", () => {
    expect(headerView(robotOf({ size: 'big', tokens: 500 })).tokens).toBe('500 / 500 tokens');
  });
});

describe('switchView', () => {
  it('offers Off unless the player switched the robot off', () => {
    expect(switchView(robotOf({ off: null }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ off: 'dizzy' }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ off: 'player' }), 'bench')).toEqual({ label: 'On', on: true });
  });

  it('offers Off to a standing-by or flat robot too', () => {
    expect(switchView(robotOf({ power: 'standby' }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ power: 'flat', tokens: 0 }), 'bench')).toEqual({ label: 'Off', on: false });
  });

  it('is hidden in peek mode and for a broken, repairing or ruined robot', () => {
    expect(switchView(robotOf(), 'peek')).toBeNull();
    expect(switchView(robotOf({ off: 'player' }), 'peek')).toBeNull();
    expect(switchView(robotOf({ power: 'broken' }), 'bench')).toBeNull();
    expect(switchView(robotOf({ power: 'repairing', repairReadyDay: 3 }), 'bench')).toBeNull();
    expect(switchView(robotOf({ power: 'ruined' }), 'bench')).toBeNull();
  });
});

describe('visibleTabs', () => {
  it("shows job 1's tabs on the bench, in order", () => {
    expect(visibleTabs('bench', UNLOCKS.job1)).toEqual(['program', 'md', 'looks', 'log']);
  });

  it('shows only Stats and Log when peeking, each still needing its unlock', () => {
    expect(visibleTabs('peek', UNLOCKS.job1)).toEqual(['log']);
    expect(visibleTabs('peek', ALL_UNLOCKS)).toEqual(['stats', 'log']);
  });

  it('shows every tab on the bench once all are unlocked', () => {
    expect(visibleTabs('bench', ALL_UNLOCKS)).toEqual(['program', 'md', 'looks', 'stats', 'log']);
  });

  it('marks Program, .MD and Looks as the editing tabs', () => {
    expect((['program', 'md', 'looks', 'stats', 'log'] as const).filter(isEditTab)).toEqual(['program', 'md', 'looks']);
  });
});

describe('nextTab', () => {
  const TABS = ['looks', 'stats', 'log'] as const;

  it('moves right and left through the visible tabs, wrapping around', () => {
    expect(nextTab(TABS, 'looks', 'ArrowRight')).toBe('stats');
    expect(nextTab(TABS, 'log', 'ArrowRight')).toBe('looks');
    expect(nextTab(TABS, 'stats', 'ArrowLeft')).toBe('looks');
    expect(nextTab(TABS, 'looks', 'ArrowLeft')).toBe('log');
  });

  it('jumps to the first and last tab with Home and End', () => {
    expect(nextTab(TABS, 'stats', 'Home')).toBe('looks');
    expect(nextTab(TABS, 'stats', 'End')).toBe('log');
  });

  it('is null for any other key, with no visible tabs, or for a tab that is not shown', () => {
    expect(nextTab(TABS, 'stats', 'ArrowDown')).toBeNull();
    expect(nextTab(TABS, 'stats', 'Enter')).toBeNull();
    expect(nextTab([], 'stats', 'ArrowRight')).toBeNull();
    expect(nextTab(TABS, 'program', 'ArrowRight')).toBeNull();
  });

  it('stays put with a single tab', () => {
    expect(nextTab(['log'], 'log', 'ArrowRight')).toBe('log');
    expect(nextTab(['log'], 'log', 'End')).toBe('log');
  });
});

describe('ruinedNote', () => {
  it('explains a ruined robot and nothing else', () => {
    expect(ruinedNote(robotOf({ name: 'Bolt', power: 'ruined' }))).toBe('Bolt is ruined. It can only be scrapped.');
    expect(ruinedNote(robotOf({ name: 'Bolt', power: 'broken' }))).toBeNull();
  });
});

describe('statsRows', () => {
  it('lists today and this week, with — for tokens per crop when no crops were handled', () => {
    const robot = robotOf({
      stats: { today: { tokens: 10, actions: 4, crops: 0 }, week: { tokens: 25, actions: 9, crops: 3 } },
    });
    expect(statsRows(robot)).toEqual([
      { label: 'Tokens used', today: '10', week: '25' },
      { label: 'Actions taken', today: '4', week: '9' },
      { label: 'Crops handled', today: '0', week: '3' },
      { label: 'Tokens per crop', today: '—', week: '8.3' },
    ]);
  });

  it('groups thousands', () => {
    const robot = robotOf({ stats: { today: { tokens: 1200, actions: 1000, crops: 2 }, week: { tokens: 1200, actions: 1000, crops: 2 } } });
    expect(statsRows(robot)[0]).toEqual({ label: 'Tokens used', today: '1,200', week: '1,200' });
    expect(statsRows(robot)[3]).toEqual({ label: 'Tokens per crop', today: '600', week: '600' });
  });
});

describe('logRows', () => {
  const MOVED: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'tile' } };
  const BICKERED: RobotLogEvent = { kind: 'bickered', action: 'harvest', withIds: [2] };
  const entry = (id: number, robotId: number, day: number, minute: number, event: RobotLogEvent, count = 1): RobotLogEntry => ({
    id,
    day,
    minute,
    robotId,
    tx: 5,
    tz: 10,
    event,
    count,
  });

  const state = (() => {
    const base = withRobots(atDay(BASE, 5, 700), [robotOf({ id: 1, name: 'Sprocket' }), robotOf({ id: 2, name: 'Dee' })]);
    const entries = [
      entry(1, 1, 3, 400, MOVED),
      entry(2, 1, 4, 580, MOVED),
      entry(3, 2, 5, 390, MOVED),
      entry(4, 1, 5, 400, BICKERED),
      entry(5, 1, 5, 580, MOVED, 3),
    ];
    return { ...base, robots: { ...base.robots, log: { nextId: 6, entries } } };
  })();

  it("lists today's and yesterday's entries for one robot, newest first", () => {
    expect(logRows(state, 1)).toEqual([
      { id: 5, time: '9:40 am', says: 'Moved forward ✓', happened: 'Moved one tile.', count: 3, yesterday: false },
      { id: 4, time: '6:40 am', says: 'Waiting my turn ✓', happened: 'Fought Dee over the same tile. Nobody got it.', count: 1, yesterday: false },
      { id: 2, time: '9:40 am', says: 'Moved forward ✓', happened: 'Moved one tile.', count: 1, yesterday: true },
    ]);
  });

  it('is empty for a robot with no entries today or yesterday', () => {
    expect(logRows(state, 7)).toEqual([]);
  });

  it('shows a count only on merged entries', () => {
    expect(countText(1)).toBe('');
    expect(countText(3)).toBe('×3');
  });

  it('has the empty text from the spec', () => {
    expect(LOG_TEXT.empty).toBe('Nothing yet today.');
    expect(LOG_TEXT.yesterday).toBe('Yesterday');
    expect(EMPTY_TABS_TEXT).toBe('Nothing to show yet.');
  });
});

describe('formatClockMinute', () => {
  it('writes the exact minute', () => {
    expect(formatClockMinute(580)).toBe('9:40 am');
    expect(formatClockMinute(583)).toBe('9:43 am');
    expect(formatClockMinute(1510)).toBe('1:10 am');
  });
});

describe('prompts and paint', () => {
  it('asks before discarding edits', () => {
    expect(discardPrompt('Bolt')).toBe("Discard your changes to Bolt's program?");
  });

  it('names the scrap value', () => {
    expect(scrapPrompt(robotOf({ name: 'Bolt', size: 'standard' }))).toBe("Scrap Bolt for 1000g? This can't be undone.");
    expect(scrapPrompt(robotOf({ name: 'Pip', size: 'mini' }))).toBe("Scrap Pip for 375g? This can't be undone.");
    expect(scrapPrompt(robotOf({ name: 'Max', size: 'big', power: 'ruined' }))).toBe("Scrap Max for 2500g? This can't be undone.");
  });

  it('prices a paint job from config', () => {
    expect(paintButtonText()).toBe(`Paint · ${ROBOT_CARE.paintCost}g`);
    expect(paintButtonText()).toBe('Paint · 50g');
  });

  it('turns paint colours into CSS', () => {
    expect(paintHex(0xf2c14e)).toBe('#f2c14e');
    expect(paintHex(0x0000ff)).toBe('#0000ff');
    expect(ROBOT_PAINTS.map((paint) => paintHex(paint.color))).toHaveLength(16);
    expect(paintName(8)).toBe('Ocean');
    expect(paintName(99)).toBe('');
  });

  it('switches to the phone layout below ROBOT_SCREEN.phoneMaxWidth', () => {
    expect(phoneQuery()).toBe('(max-width: 699.98px)');
  });
});

describe('ui/notify', () => {
  it('pushes a toast', () => {
    const next = gameReducer(BASE, actions.notify("The robot screen couldn't load. Try again.", 'warn'));
    expect(next.messages.entries.at(-1)).toMatchObject({ text: "The robot screen couldn't load. Try again.", tone: 'warn' });
  });
});

describe('InputController while a robot screen is open (spec §4.1)', () => {
  // The node test environment has no DOM classes; InputController only needs them to exist.
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('Element', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function harness(state: GameState) {
    const store = createStore<GameState, GameAction>(gameReducer, state);
    const dispatched: GameAction[] = [];
    const spy: Store<GameState, GameAction> = {
      getState: store.getState,
      subscribe: store.subscribe,
      dispatch: (action) => {
        dispatched.push(action);
        return store.dispatch(action);
      },
    };
    const target = Object.assign(new EventTarget(), { document: new EventTarget() });
    const input = new InputController({
      target: target as unknown as Window,
      canvas: new EventTarget() as unknown as HTMLCanvasElement,
      store: spy,
      rig: {} as CameraRig,
    });
    const press = (code: string, key: string): Event => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        code,
        key,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        repeat: false,
        isComposing: false,
      });
      target.dispatchEvent(event);
      return event;
    };
    return { press, dispatched, dispose: () => input.dispose() };
  }

  it('neither dispatches nor prevents the default for any key', () => {
    const { press, dispatched, dispose } = harness(withPanel(BASE, { kind: 'robot', robotId: 1, mode: 'bench' }));
    for (const [code, key] of [
      ['KeyW', 'w'],
      ['Space', ' '],
      ['KeyE', 'e'],
      ['Enter', 'Enter'],
      ['Escape', 'Escape'],
      ['KeyI', 'i'],
      ['KeyP', 'p'],
      ['Digit1', '1'],
      ['Tab', 'Tab'],
    ] as const) {
      expect(press(code, key).defaultPrevented).toBe(false);
    }
    expect(dispatched).toEqual([]);
    dispose();
  });

  it('still handles keys with no panel open', () => {
    const { press, dispatched, dispose } = harness(BASE);
    expect(press('KeyP', 'p').defaultPrevented).toBe(true);
    expect(dispatched).toEqual([actions.setPaused(true)]);
    dispose();
  });
});
