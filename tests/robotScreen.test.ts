/**
 * The robot screen's pure parts (farmclaws part 3 spec §4, §11): header text, tab visibility,
 * the switch, Stats and Log rows, prompts, and the keyboard handover (InputController and the
 * ui/notify toast). The DOM and Blockly glue are checked in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROBOTS, ROBOT_CARE, ROBOT_PAINTS, ROBOT_SCREEN, TIME, UNLOCKS } from '../src/config';
import { createStore, type Store } from '../src/core/store';
import { mulberry32 } from '../src/core/hash';
import { MD_CARD_KINDS, ROBOT_SIZES, type GameState, type MdCard, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { InputController } from '../src/input/InputController';
import type { CameraRig } from '../src/render/CameraRig';
import { b } from '../src/robots/blocks';
import { checkMd } from '../src/robots/check';
import { batteryFor } from '../src/robots/stats';
import { ALL_UNLOCKS } from '../src/robots/unlocks';
import { catalogueRobot } from '../src/robots/workshop';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BLOCK_DEFINITIONS, type BlockDefinitionJson } from '../src/ui/robotScreen/blockly/blockDefs';
import {
  EDITOR_TEXT,
  NEEDS_SENSOR_EYE_REASON,
  NEEDS_SENSOR_EYE_TEXT,
  blockCounter,
  declarationState,
  defaultLiteral,
  dropdownOptions,
  menuAccepts,
  menuFieldType,
  menuLabel,
  nameOptions,
  scriptNote,
  toolboxFor,
  variableCounter,
  type MenuKind,
} from '../src/ui/robotScreen/blockly/toolbox';
import { BLOCK_TYPES, programToWorkspace, type BlocklyBlockJson } from '../src/ui/robotScreen/translate';
import {
  EMPTY_TABS_TEXT,
  LOG_TEXT,
  countText,
  discardPrompt,
  formatClockMinute,
  hasBenchActions,
  headerView,
  isEditTab,
  isReadOnly,
  logRows,
  nextTab,
  paintButtonText,
  paintHex,
  paintName,
  phoneQuery,
  ruinedNote,
  samePanel,
  scrapPrompt,
  screenRobot,
  statsRows,
  switchView,
  visibleTabs,
} from '../src/ui/robotScreen/viewModel';
import { randomProgram } from './programGen';
import {
  CARD_LABELS,
  MD_TEXT,
  addCardOptions,
  cardFields,
  cardSection,
  isMdFieldKey,
  mdCountText,
  mdOverLimit,
  mdTitle,
  moveCard,
  newCard,
  removeCard,
  setCardValue,
} from '../src/ui/robotScreen/mdFields';
import { BASE, atDay, robotOf, withRobots } from './testUtils';

function withPanel(state: GameState, panel: GameState['ui']['panel']): GameState {
  return { ...state, ui: { ...state.ui, panel } };
}

describe('headerView', () => {
  it('names the robot, its size, parts and tokens', () => {
    const robot = robotOf({ name: 'Bolt', size: 'standard', parts: ['claw', 'sensorEye'], tokens: 42 });
    expect(headerView(robot, 'bench')).toEqual({
      name: 'Bolt',
      sizeLabel: 'Standard',
      parts: ['claw', 'sensorEye'],
      tokens: '42 / 200 tokens',
      power: 'Working',
      offText: null,
    });
  });

  it('gives the off text for each reason', () => {
    expect(headerView(robotOf({ off: 'player' }), 'bench').offText).toBe('Switched off');
    expect(headerView(robotOf({ off: 'dizzy' }), 'bench').offText).toBe('Off until morning');
    expect(headerView(robotOf({ off: 'done' }), 'bench').offText).toBe('Off until morning');
  });

  it('names every power', () => {
    const power = (p: Parameters<typeof robotOf>[0]) => headerView(robotOf(p), 'bench').power;
    expect(power({ power: 'standby' })).toBe('Standing by');
    expect(power({ power: 'flat', tokens: 0 })).toBe('Flat');
    expect(power({ power: 'broken' })).toBe('Shorted out');
    expect(power({ power: 'repairing', repairReadyDay: 3 })).toBe('Getting a new core');
    expect(power({ power: 'ruined' })).toBe('Ruined');
  });

  it("uses the size's battery", () => {
    expect(headerView(robotOf({ size: 'big', tokens: 500 }), 'bench').tokens).toBe('500 / 500 tokens');
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

describe('the workshop preview (part 4b spec §4.4)', () => {
  const WORKSHOP = withPanel(BASE, { kind: 'workshop' });
  const preview = (size: (typeof ROBOT_SIZES)[number]) => ({ kind: 'robot', mode: 'preview', size }) as const;

  it('shows the size and "From Juniper\'s workshop" in the header, with no power or off text', () => {
    expect(headerView(catalogueRobot('standard'), 'preview')).toEqual({
      name: 'Standard',
      sizeLabel: "From Juniper's workshop",
      parts: ['claw'],
      tokens: `${ROBOTS.sizes.standard.battery} / ${ROBOTS.sizes.standard.battery} tokens`,
      power: null,
      offText: null,
    });
  });

  it('has no On / Off switch, Lift off or Scrap', () => {
    expect(switchView(catalogueRobot('mini'), 'preview')).toBeNull();
    expect(hasBenchActions('preview')).toBe(false);
    expect(hasBenchActions('peek')).toBe(false);
    expect(hasBenchActions('bench')).toBe(true);
  });

  it('shows Program and Looks only', () => {
    expect(visibleTabs('preview', UNLOCKS.job1)).toEqual(['program', 'looks']);
    expect(visibleTabs('preview', ALL_UNLOCKS)).toEqual(['program', 'looks']);
  });

  it('is read-only, as a ruined robot is on the bench', () => {
    expect(isReadOnly(catalogueRobot('big'), 'preview')).toBe(true);
    expect(isReadOnly(robotOf(), 'bench')).toBe(false);
    expect(isReadOnly(robotOf({ power: 'ruined' }), 'bench')).toBe(true);
  });

  it("shows the size's catalogue robot, the same one on every sync, never the state's", () => {
    const state = withRobots(BASE, [robotOf({ id: 1, name: 'Bolt' })]);
    for (const size of ROBOT_SIZES) {
      const robot = screenRobot(state, preview(size));
      expect(robot).toEqual(catalogueRobot(size));
      expect(screenRobot(BASE, preview(size))).toBe(robot);
    }
    expect(screenRobot(state, { kind: 'robot', robotId: 1, mode: 'bench' })).toBe(state.robots.list[0]);
    expect(screenRobot(state, { kind: 'robot', robotId: 2, mode: 'peek' })).toBeNull();
  });

  it('tells a new preview from the one shown', () => {
    expect(samePanel(preview('mini'), preview('mini'))).toBe(true);
    expect(samePanel(preview('mini'), preview('big'))).toBe(false);
    expect(samePanel(preview('mini'), { kind: 'robot', robotId: 1, mode: 'bench' })).toBe(false);
    expect(samePanel({ kind: 'robot', robotId: 1, mode: 'bench' }, { kind: 'robot', robotId: 1, mode: 'bench' })).toBe(true);
    expect(samePanel({ kind: 'robot', robotId: 1, mode: 'bench' }, { kind: 'robot', robotId: 1, mode: 'peek' })).toBe(false);
  });

  it('opens from the workshop on Read program', () => {
    expect(gameReducer(WORKSHOP, actions.previewRobot('big')).ui.panel).toEqual(preview('big'));
  });

  it('opens only from the open workshop, unpaused, for a real size', () => {
    expect(gameReducer(BASE, actions.previewRobot('mini'))).toBe(BASE);
    const shop = withPanel(BASE, { kind: 'partsShop' });
    expect(gameReducer(shop, actions.previewRobot('mini'))).toBe(shop);
    const paused = { ...WORKSHOP, ui: { ...WORKSHOP.ui, paused: true } };
    expect(gameReducer(paused, actions.previewRobot('mini'))).toBe(paused);
    expect(gameReducer(WORKSHOP, { type: 'workshop/preview', size: 'huge' as 'mini' })).toBe(WORKSHOP);
  });

  it('returns to the workshop on close, where other robot panels close', () => {
    expect(gameReducer(withPanel(BASE, preview('standard')), actions.closePanel()).ui.panel).toEqual({ kind: 'workshop' });
    expect(gameReducer(withPanel(BASE, { kind: 'robot', robotId: 1, mode: 'bench' }), actions.closePanel()).ui.panel).toEqual({ kind: 'none' });
    expect(gameReducer(WORKSHOP, actions.closePanel()).ui.panel).toEqual({ kind: 'none' });
  });

  it('changes nothing but ui.panel: opening, reading and closing', () => {
    const start = withRobots(withPanel(BASE, { kind: 'workshop' }), [robotOf({ id: 1 })]);
    const opened = gameReducer(start, actions.previewRobot('mini'));
    const closed = gameReducer(opened, actions.closePanel());
    for (const state of [opened, closed]) {
      const { ui, ...rest } = state;
      const { ui: startUi, ...startRest } = start;
      expect({ ...ui, panel: null }).toEqual({ ...startUi, panel: null });
      for (const [key, value] of Object.entries(rest)) expect(value, key).toBe(startRest[key as keyof typeof startRest]);
    }
    expect(closed).toEqual(start);
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

  it('neither dispatches nor prevents the default for any key, at the bench or in a workshop preview', () => {
    for (const panel of [
      { kind: 'robot', robotId: 1, mode: 'bench' },
      { kind: 'robot', mode: 'preview', size: 'mini' },
    ] as const) {
      const { press, dispatched, dispose } = harness(withPanel(BASE, panel));
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
    }
  });

  it('still handles keys with no panel open', () => {
    const { press, dispatched, dispose } = harness(BASE);
    expect(press('KeyP', 'p').defaultPrevented).toBe(true);
    expect(dispatched).toEqual([actions.setPaused(true)]);
    dispose();
  });
});

describe('toolboxFor', () => {
  const types = (toolbox: ReturnType<typeof toolboxFor>) =>
    toolbox.contents.map((category) => [category.name, category.contents.map((block) => block.type)] as const);

  it("lists job 1's blocks by category, leaving empty categories out", () => {
    const toolbox = toolboxFor(robotOf({ parts: ['wateringHead'] }), UNLOCKS.job1);
    expect(toolbox.kind).toBe('categoryToolbox');
    expect(types(toolbox)).toEqual([
      ['Triggers', ['fc_morning', 'fc_atTime']],
      ['Control', ['fc_repeatTimes', 'fc_repeatUntil', 'fc_repeatForever']],
      ['Actions', ['fc_move', 'fc_turn', 'fc_goTo', 'fc_water', 'fc_refill', 'fc_powerDown', 'fc_wait', 'fc_say']],
      ['Values', ['fc_num', 'fc_text', 'fc_yes', 'fc_item', 'fc_tile', 'fc_myTile', 'fc_tileAhead', 'fc_tokensLeft', 'fc_compare']],
    ]);
  });

  it('puts both If shapes in Control, the variable getter in Values, and never a declaration', () => {
    const toolbox = toolboxFor(robotOf({ parts: ['sensorEye'] }), ALL_UNLOCKS);
    const byName = new Map(types(toolbox));
    expect(byName.get('Control')).toEqual([
      'fc_repeatTimes',
      'fc_repeatUntil',
      'fc_repeatForever',
      'fc_if',
      'fc_ifElse',
      'fc_forEachTile',
      'fc_set',
      'fc_change',
      'fc_helper',
      'fc_runHelper',
    ]);
    expect(byName.get('Values')?.[0]).toBe('fc_var');
    expect(toolbox.contents.flatMap((category) => category.contents.map((block) => block.type))).not.toContain('fc_varDecl');
    expect(toolbox.contents.map((category) => category.name)).toEqual(['Triggers', 'Control', 'Actions', 'Sensors', 'Values']);
  });

  it('disables the sensor-eye sensors without a sensor eye, and only them', () => {
    const disabled = (parts: Parameters<typeof robotOf>[0]) =>
      toolboxFor(robotOf(parts), ALL_UNLOCKS)
        .contents.flatMap((category) => category.contents)
        .filter((block) => block.disabledReasons !== undefined)
        .map((block) => [block.type, block.disabledReasons]);
    expect(disabled({ parts: ['claw'] })).toEqual([
      ['fc_tileAheadIs', [NEEDS_SENSOR_EYE_REASON]],
      ['fc_itIsRaining', [NEEDS_SENSOR_EYE_REASON]],
      ['fc_timeIsAfter', [NEEDS_SENSOR_EYE_REASON]],
    ]);
    expect(disabled({ parts: ['sensorEye'] })).toEqual([]);
    expect(NEEDS_SENSOR_EYE_TEXT).toBe('Needs a sensor eye');
  });

  it('has no shadow blocks', () => {
    const blocks = toolboxFor(robotOf(), ALL_UNLOCKS).contents.flatMap((category) => category.contents);
    for (const block of blocks) expect(Object.keys(block).sort()).toEqual(block.disabledReasons === undefined ? ['kind', 'type'] : ['disabledReasons', 'kind', 'type']);
  });
});

describe('dropdownOptions', () => {
  it('offers times every ROBOT_SCREEN.timeStep minutes from 6:00 am to 1:50 am', () => {
    const options = dropdownOptions('minute', null);
    expect(options).toHaveLength((TIME.passOutMinute - TIME.dayStartMinute) / ROBOT_SCREEN.timeStep);
    expect(options[0]).toEqual(['6:00 am', '360']);
    expect(options.at(-1)).toEqual(['1:50 am', '1550']);
  });

  it('includes a time outside the usual steps, in order', () => {
    const options = dropdownOptions('minute', 583);
    expect(options).toHaveLength((TIME.passOutMinute - TIME.dayStartMinute) / ROBOT_SCREEN.timeStep + 1);
    const at = options.findIndex(([, value]) => value === '583');
    expect(options.slice(at - 1, at + 2)).toEqual([
      ['9:40 am', '580'],
      ['9:43 am', '583'],
      ['9:50 am', '590'],
    ]);
    expect(dropdownOptions('minute', '583')).toEqual(options);
    expect(dropdownOptions('minute', 600)).toHaveLength(options.length - 1);
  });

  it('includes an item the usual list leaves out', () => {
    expect(dropdownOptions('item', null).map(([, value]) => value)).not.toContain('hoe');
    expect(dropdownOptions('item', null)[0]).toEqual(['Parsnip Seeds', 'parsnip_seeds']);
    expect(dropdownOptions('item', 'hoe').at(-1)).toEqual(['Hoe', 'hoe']);
  });

  it('lists crops, zones and Every choices with the current value kept', () => {
    expect(dropdownOptions('crop', null)[0]).toEqual(['Parsnip', 'parsnip']);
    expect(dropdownOptions('zone', 'C')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((zone) => [`Zone ${zone}`, zone]));
    expect(dropdownOptions('every', '15')).toEqual([['5', '5'], ['10', '10'], ['15', '15'], ['30', '30'], ['60', '60']]);
    expect(dropdownOptions('every', 45).map(([, value]) => value)).toEqual(['5', '10', '15', '30', '45', '60']);
  });
});

describe('menu fields', () => {
  it('accepts any well-formed value of its kind, as a string', () => {
    expect(menuAccepts('minute', 583)).toBe('583');
    expect(menuAccepts('minute', '583')).toBe('583');
    expect(menuAccepts('minute', '9:43')).toBeNull();
    expect(menuAccepts('every', 15)).toBe('15');
    expect(menuAccepts('item', 'hoe')).toBe('hoe');
    expect(menuAccepts('item', 'dragon')).toBeNull();
    expect(menuAccepts('crop', 'pumpkin')).toBe('pumpkin');
    expect(menuAccepts('crop', 'hoe')).toBeNull();
    expect(menuAccepts('zone', 'H')).toBe('H');
    expect(menuAccepts('zone', 'Z')).toBeNull();
    expect(menuAccepts('var', 'aVeryLongName123')).toBe('aVeryLongName123');
    expect(menuAccepts('helper', '')).toBe('');
    expect(menuAccepts('var', 3)).toBeNull();
  });

  it('labels values the way the dropdown shows them', () => {
    expect(menuLabel('minute', '583')).toBe('9:43 am');
    expect(menuLabel('every', '15')).toBe('15');
    expect(menuLabel('item', 'hoe')).toBe('Hoe');
    expect(menuLabel('crop', 'parsnip')).toBe('Parsnip');
    expect(menuLabel('zone', 'A')).toBe('Zone A');
    expect(menuLabel('var', 'count')).toBe('count');
    expect(menuLabel('var', '')).toBe('—');
    expect(menuLabel('helper', null)).toBe('—');
  });

  it("lists the workspace's names, keeps the current one and never comes back empty", () => {
    expect(nameOptions(['n', 'total', 'n'], null)).toEqual([['n', 'n'], ['total', 'total']]);
    expect(nameOptions(['n'], 'gone')).toEqual([['n', 'n'], ['gone', 'gone']]);
    expect(nameOptions([], null)).toEqual([['—', '']]);
    expect(nameOptions([], '')).toEqual([['—', '']]);
  });

  it('names one registered field per menu kind', () => {
    const kinds: MenuKind[] = ['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'];
    expect(kinds.map(menuFieldType)).toEqual(kinds.map((kind) => `field_fc_${kind}`));
  });
});

describe('the editor helpers', () => {
  it('counts blocks and variables against the size, red over the limit', () => {
    expect(blockCounter(7, 'mini')).toEqual({ text: '7 / 12 blocks', over: false });
    expect(blockCounter(13, 'mini')).toEqual({ text: '13 / 12 blocks', over: true });
    expect(blockCounter(30, 'standard')).toEqual({ text: '30 / 30 blocks', over: false });
    expect(variableCounter(2, 'mini')).toEqual({ text: '2 / 1 variables', over: true });
    expect(variableCounter(ROBOTS.sizes.big.vars, 'big')).toEqual({ text: '6 / 6 variables', over: false });
  });

  it('gives each type its default literal', () => {
    const robot = robotOf({ tx: 6, tz: 4 });
    expect(defaultLiteral('number', robot)).toEqual({ type: 'fc_num', fields: { NUM: 0 } });
    expect(defaultLiteral('text', robot)).toEqual({ type: 'fc_text', fields: { TEXT: '' } });
    expect(defaultLiteral('yesNo', robot)).toEqual({ type: 'fc_yes', fields: { VALUE: 'FALSE' } });
    expect(defaultLiteral('item', robot)).toEqual({ type: 'fc_item', fields: { ITEM: 'parsnip' } });
    expect(defaultLiteral('tile', robot)).toEqual({ type: 'fc_tile', fields: { X: 6, Z: 4 } });
  });

  it('builds a declaration holding the default literal', () => {
    expect(declarationState('n', 'tile', robotOf({ tx: 6, tz: 4 }), 10, 20)).toEqual({
      type: 'fc_varDecl',
      x: 10,
      y: 20,
      fields: { NAME: 'n', TYPE: 'tile' },
      inputs: { INITIAL: { block: { type: 'fc_tile', fields: { X: 6, Z: 4 } } } },
    });
  });

  it('has the spec sentences', () => {
    expect(EDITOR_TEXT.opening).toBe('Opening the editor…');
    expect(EDITOR_TEXT.failed).toBe("The editor couldn't load. Close and try again.");
    expect(EDITOR_TEXT.loose).toBe('Every block must be inside a When … stack or a helper.');
    expect(scriptNote('Bolt')).toBe('Bolt runs a fixed script. Saving here replaces it with a block program.');
  });
});

describe('block definitions', () => {
  interface Shape {
    readonly fields: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
    readonly inputs: ReadonlySet<string>;
    readonly next: boolean;
    readonly previous: boolean;
  }

  function shapeOf(def: BlockDefinitionJson): Shape {
    const fields = new Map<string, Readonly<Record<string, unknown>>>();
    const inputs = new Set<string>();
    for (const [key, value] of Object.entries(def)) {
      if (!/^args\d+$/.test(key) || !Array.isArray(value)) continue;
      for (const arg of value as readonly Readonly<Record<string, unknown>>[]) {
        const type = String(arg.type);
        if (typeof arg.name !== 'string') continue;
        if (type.startsWith('field_')) fields.set(arg.name, arg);
        else if (type === 'input_value' || type === 'input_statement') inputs.add(arg.name);
      }
    }
    return { fields, inputs, next: 'nextStatement' in def, previous: 'previousStatement' in def };
  }

  const SHAPES = new Map(BLOCK_DEFINITIONS.map((def) => [def.type, shapeOf(def)] as const));
  const MENU_BY_TYPE = new Map<string, MenuKind>(
    (['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'] as const).map((kind) => [menuFieldType(kind), kind]),
  );

  /** Every way a translated block disagrees with its definition. */
  function problems(block: BlocklyBlockJson, path: string): string[] {
    const shape = SHAPES.get(block.type);
    if (shape === undefined) return [`${path}: no definition for ${block.type}`];
    const found: string[] = [];
    for (const [name, value] of Object.entries(block.fields ?? {})) {
      const field = shape.fields.get(name);
      if (field === undefined) {
        found.push(`${path}: ${block.type} has no field ${name}`);
        continue;
      }
      const menu = MENU_BY_TYPE.get(String(field.type));
      if (menu !== undefined && menuAccepts(menu, value) === null) found.push(`${path}: ${name} = ${String(value)} rejected`);
      if (field.type === 'field_dropdown' && !(field.options as readonly (readonly [string, string])[]).some(([, v]) => v === value)) {
        found.push(`${path}: ${name} = ${String(value)} not an option`);
      }
      if (field.type === 'field_number' && typeof value !== 'number') found.push(`${path}: ${name} is not a number`);
    }
    for (const [name, input] of Object.entries(block.inputs ?? {})) {
      if (!shape.inputs.has(name)) found.push(`${path}: ${block.type} has no input ${name}`);
      if (input.block !== undefined) found.push(...problems(input.block, `${path}.${name}`));
    }
    if (block.next?.block !== undefined) {
      if (!shape.next) found.push(`${path}: ${block.type} has no next connection`);
      found.push(...problems(block.next.block, `${path}.next`));
    }
    return found;
  }

  it('defines every block type of the language once', () => {
    expect(BLOCK_DEFINITIONS.map((def) => def.type).sort()).toEqual([...BLOCK_TYPES].sort());
    expect(new Set(BLOCK_DEFINITIONS.map((def) => def.type)).size).toBe(BLOCK_DEFINITIONS.length);
  });

  it('gives triggers, helpers and declarations no previous or next connection', () => {
    for (const type of ['fc_morning', 'fc_atTime', 'fc_bagFull', 'fc_startsRaining', 'fc_every', 'fc_helper', 'fc_varDecl']) {
      expect([type, SHAPES.get(type)?.previous, SHAPES.get(type)?.next]).toEqual([type, false, false]);
    }
  });

  it('matches every field and input of 300 translated random programs, and the design fixtures', () => {
    const rng = mulberry32(20261003);
    const programs = [
      ...Array.from({ length: 300 }, () => randomProgram(rng)),
      b.program({
        vars: [{ name: 'aVeryLongName123', type: 'number', initial: b.n(7) }],
        stacks: [b.when(b.atTime(583), b.take('hoe'), b.change('aVeryLongName123', 1), b.wait(b.v('aVeryLongName123')))],
      }),
      b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] }),
    ];
    const found = programs.flatMap((program, index) =>
      (programToWorkspace(program).blocks?.blocks ?? []).flatMap((block, top) => problems(block, `program ${index} block ${top}`)),
    );
    expect(found.slice(0, 5)).toEqual([]);
  });
});

describe('.MD card fields', () => {
  const ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((zone) => [`Zone ${zone}`, zone]);

  it('gives each card its words and fields', () => {
    expect(cardFields({ kind: 'dontLeave', zone: 'B' }, 'mini')).toEqual([
      { kind: 'text', text: 'Leave' },
      { kind: 'select', key: 'zone', label: 'Zone', value: 'B', options: ZONES },
    ]);
    expect(cardFields({ kind: 'dontGoIntoWater' }, 'mini')).toEqual([{ kind: 'text', text: 'Go into water' }]);
    expect(cardFields({ kind: 'dontHarvest', cropId: 'pumpkin' }, 'mini')[1]).toMatchObject({ kind: 'select', key: 'cropId', value: 'pumpkin' });
    expect(cardFields({ kind: 'dontDeposit', itemId: 'hoe' }, 'mini')[1]).toMatchObject({ kind: 'select', key: 'itemId', value: 'hoe' });
  });

  it('shows a DO return to a tile as two number fields and a time', () => {
    expect(cardFields({ kind: 'doReturn', to: { kind: 'tile', tx: 4, tz: 9 }, minute: 1080 }, 'mini')).toEqual([
      { kind: 'text', text: 'Return to' },
      { kind: 'select', key: 'to', label: 'Where', value: 'tile', options: [['a tile', 'tile'], ['the nearest generator', 'generator']] },
      { kind: 'number', key: 'tx', label: 'X', value: 4, min: 0, max: 47 },
      { kind: 'number', key: 'tz', label: 'Z', value: 9, min: 0, max: 39 },
      { kind: 'text', text: 'at' },
      { kind: 'select', key: 'minute', label: 'Time', value: '1080', options: dropdownOptions('minute', 1080) },
    ]);
  });

  it("keeps a card's unusual time in its dropdown", () => {
    const fields = cardFields({ kind: 'doReturn', to: { kind: 'generator' }, minute: 583 }, 'mini');
    expect(fields).toHaveLength(4);
    const time = fields[3];
    expect(time?.kind === 'select' && time.options.some(([label, value]) => label === '9:43 am' && value === '583')).toBe(true);
  });

  it('shows the token count only for "tokens are below"', () => {
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } }, 'mini')).toEqual([
      { kind: 'text', text: 'Power down when' },
      {
        kind: 'select',
        key: 'when',
        label: 'When',
        value: 'tokensBelow',
        options: [['my bag is full', 'bagFull'], ['tokens are below', 'tokensBelow'], ['it rains', 'raining']],
      },
      { kind: 'number', key: 'n', label: 'Tokens', value: 10, min: 1, max: batteryFor('mini') },
    ]);
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } }, 'big')[2]).toMatchObject({ max: batteryFor('big') });
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'raining' } }, 'mini')).toHaveLength(2);
  });
});

describe('.MD editing', () => {
  const robot = robotOf({ tx: 6, tz: 4 });

  it('makes a valid card of every kind', () => {
    expect(MD_CARD_KINDS.map((kind) => newCard(kind))).toEqual([
      { kind: 'dontLeave', zone: 'A' },
      { kind: 'dontGoIntoWater' },
      { kind: 'dontHarvest', cropId: 'parsnip' },
      { kind: 'dontDeposit', itemId: 'parsnip' },
      { kind: 'doReturn', to: { kind: 'generator' }, minute: ROBOT_SCREEN.cardDefaults.returnMinute },
      { kind: 'doPowerDown', when: { kind: 'bagFull' } },
    ]);
    for (const kind of MD_CARD_KINDS) expect([kind, checkMd([newCard(kind)], robotOf())]).toEqual([kind, null]);
  });

  it('changes one field at a time, ignoring values that are not of its kind', () => {
    expect(setCardValue({ kind: 'dontLeave', zone: 'A' }, 'zone', 'C', robot)).toEqual({ kind: 'dontLeave', zone: 'C' });
    expect(setCardValue({ kind: 'dontLeave', zone: 'A' }, 'zone', 'Q', robot)).toEqual({ kind: 'dontLeave', zone: 'A' });
    expect(setCardValue({ kind: 'dontHarvest', cropId: 'parsnip' }, 'cropId', 'corn', robot)).toEqual({ kind: 'dontHarvest', cropId: 'corn' });
    expect(setCardValue({ kind: 'dontDeposit', itemId: 'parsnip' }, 'itemId', 'wood', robot)).toEqual({ kind: 'dontDeposit', itemId: 'wood' });
    expect(setCardValue({ kind: 'dontDeposit', itemId: 'parsnip' }, 'zone', 'A', robot)).toEqual({ kind: 'dontDeposit', itemId: 'parsnip' });
  });

  it('switches a DO return between a tile and the nearest generator', () => {
    const toGenerator: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
    const toTile = setCardValue(toGenerator, 'to', 'tile', robot);
    expect(toTile).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 4 }, minute: 1080 });
    expect(setCardValue(toTile, 'tx', '12', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 12, tz: 4 }, minute: 1080 });
    expect(setCardValue(toTile, 'tz', ' 7 ', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 7 }, minute: 1080 });
    expect(setCardValue(toTile, 'tx', '1.5', robot)).toBe(toTile);
    expect(setCardValue(toTile, 'minute', '583', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 4 }, minute: 583 });
    expect(setCardValue(toTile, 'to', 'generator', robot)).toEqual(toGenerator);
    expect(setCardValue(toGenerator, 'tx', '3', robot)).toBe(toGenerator);
  });

  it('switches a power-down condition, starting the token count from config', () => {
    const bagFull: MdCard = { kind: 'doPowerDown', when: { kind: 'bagFull' } };
    const below = setCardValue(bagFull, 'when', 'tokensBelow', robot);
    expect(below).toEqual({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: ROBOT_SCREEN.cardDefaults.tokensBelow } });
    expect(setCardValue(below, 'n', '25', robot)).toEqual({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 25 } });
    expect(setCardValue(below, 'when', 'raining', robot)).toEqual({ kind: 'doPowerDown', when: { kind: 'raining' } });
    expect(setCardValue(bagFull, 'n', '25', robot)).toBe(bagFull);
  });

  it('sorts cards into DO and DON\'T and reorders within a section', () => {
    const cards: MdCard[] = [
      { kind: 'dontLeave', zone: 'A' },
      { kind: 'doPowerDown', when: { kind: 'bagFull' } },
      { kind: 'dontGoIntoWater' },
      { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 },
    ];
    expect(cards.map(cardSection)).toEqual(['dont', 'do', 'dont', 'do']);
    expect(moveCard(cards, 2, -1)).toEqual([cards[2], cards[1], cards[0], cards[3]]);
    expect(moveCard(cards, 1, 1)).toEqual([cards[0], cards[3], cards[2], cards[1]]);
    expect(moveCard(cards, 0, -1)).toBe(cards);
    expect(moveCard(cards, 3, 1)).toBe(cards);
    expect(removeCard(cards, 1)).toEqual([cards[0], cards[2], cards[3]]);
  });

  it('offers only the unlocked card kinds', () => {
    expect(addCardOptions(UNLOCKS.job1)).toEqual([
      { kind: 'dontLeave', label: CARD_LABELS.dontLeave },
      { kind: 'dontGoIntoWater', label: CARD_LABELS.dontGoIntoWater },
    ]);
    expect(addCardOptions(ALL_UNLOCKS).map((option) => option.kind)).toEqual([...MD_CARD_KINDS]);
    expect(CARD_LABELS.dontLeave).toBe("DON'T leave a zone");
  });

  it('titles the card and counts it against the size', () => {
    expect(mdTitle('Bolt')).toBe('# BOLT.MD');
    expect(mdCountText([newCard('dontGoIntoWater'), newCard('dontLeave')], 'mini')).toBe('2 / 3 cards');
    expect(mdCountText([], 'big')).toBe('0 / 10 cards');
    const four = [newCard('dontGoIntoWater'), newCard('dontLeave'), newCard('dontHarvest'), newCard('dontDeposit')];
    expect(mdOverLimit(four, 'mini')).toBe(true);
    expect(mdOverLimit(four, 'standard')).toBe(false);
  });

  it('knows its field keys and sentences', () => {
    expect(['zone', 'cropId', 'itemId', 'to', 'tx', 'tz', 'minute', 'when', 'n'].every(isMdFieldKey)).toBe(true);
    expect(isMdFieldKey('kind')).toBe(false);
    expect(MD_TEXT.scriptOnly).toBe('.MD cards only apply to block programs.');
  });
});
