/**
 * Unlocks (farmclaws part 3 spec §7): the block kinds and their categories, the card kinds and
 * tabs, job 1's starting set, withUnlocks, the save rules and the `unlockAll` dev hook. Unlocks
 * gate the editor only, so a program using locked kinds still runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNLOCKS } from '../src/config';
import { createStore } from '../src/core/store';
import {
  MD_CARD_KINDS,
  ROBOT_TABS,
  type ActionBlock,
  type Expr,
  type GameState,
  type MdCard,
  type Statement,
  type Trigger,
} from '../src/core/types';
import { installRobotDev } from '../src/dev/robotDev';
import { BLOCK_CATEGORY, BLOCK_KINDS, type BlockCategory } from '../src/robots/blockKinds';
import { b } from '../src/robots/blocks';
import { checkProgram } from '../src/robots/check';
import { morningExec } from '../src/robots/exec';
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, emptyHanded, robotOf, scenario, withRobots, type SaveJson } from './testUtils';

/** One key per kind of each part of the language; `satisfies` makes each list exact. */
const STATEMENT_KINDS = {
  repeatTimes: true,
  repeatUntil: true,
  repeatForever: true,
  if: true,
  forEachTile: true,
  goTo: true,
  set: true,
  change: true,
  runHelper: true,
} as const satisfies Record<Exclude<Statement['kind'], 'do'>, true>;
const ACTION_KINDS = {
  move: true,
  turn: true,
  water: true,
  harvest: true,
  till: true,
  plant: true,
  refill: true,
  deposit: true,
  take: true,
  say: true,
  wait: true,
  powerDown: true,
} as const satisfies Record<ActionBlock['kind'], true>;
const TRIGGER_KINDS = { morning: true, atTime: true, bagFull: true, startsRaining: true, every: true } as const satisfies Record<Trigger['kind'], true>;
const EXPR_KINDS = {
  num: true,
  text: true,
  yes: true,
  item: true,
  tile: true,
  var: true,
  myTile: true,
  tileAhead: true,
  tokensLeft: true,
  countInBag: true,
  arith: true,
  compare: true,
  and: true,
  or: true,
  not: true,
  cropIsReady: true,
  soilIsDry: true,
  tileIsTilled: true,
  cropIs: true,
  bagIsFull: true,
  bagHas: true,
  atEdgeOf: true,
  tokensBelow: true,
  tileAheadIs: true,
  itIsRaining: true,
  timeIsAfter: true,
} as const satisfies Record<Expr['kind'], true>;
const CARD_KINDS = {
  dontLeave: true,
  dontGoIntoWater: true,
  dontHarvest: true,
  dontDeposit: true,
  doReturn: true,
  doPowerDown: true,
} as const satisfies Record<MdCard['kind'], true>;

const JOB1_BLOCKS = [
  'morning', 'atTime', 'repeatTimes', 'repeatUntil', 'repeatForever', 'move', 'turn', 'goTo', 'water', 'refill', 'powerDown',
  'wait', 'say', 'num', 'text', 'yes', 'item', 'tile', 'myTile', 'tileAhead', 'tokensLeft', 'compare',
];

const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the saved unlocks (or the robots section), and loads it again. */
function corruptUnlocks(state: GameState, edit: (unlocks: SaveJson, robots: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  const robots = save.robots as SaveJson;
  edit(robots.unlocks as SaveJson, robots);
  return deserializeGame(JSON.stringify(save));
}

describe('block kinds', () => {
  it('names every kind of the language exactly once, plus Define helper', () => {
    const parts = [STATEMENT_KINDS, ACTION_KINDS, TRIGGER_KINDS, EXPR_KINDS].map((kinds) => Object.keys(kinds));
    const all = parts.flat();
    // No kind is shared between statements, action blocks, triggers and expressions.
    expect(new Set(all).size).toBe(all.length);
    expect([...all, 'helper'].sort()).toEqual([...BLOCK_KINDS].sort());
    expect(new Set(BLOCK_KINDS).size).toBe(BLOCK_KINDS.length);
    expect(BLOCK_KINDS).toHaveLength(53);
  });

  it('groups the kinds by toolbox category, in category order', () => {
    const runs: [BlockCategory, number][] = [];
    for (const kind of BLOCK_KINDS) {
      const category = BLOCK_CATEGORY[kind];
      const last = runs[runs.length - 1];
      if (last !== undefined && last[0] === category) last[1]++;
      else runs.push([category, 1]);
    }
    expect(runs).toEqual([
      ['triggers', 5],
      ['control', 10],
      ['actions', 13],
      ['sensors', 11],
      ['values', 14],
    ]);
    expect([BLOCK_CATEGORY.var, BLOCK_CATEGORY.helper, BLOCK_CATEGORY.goTo, BLOCK_CATEGORY.tileAheadIs]).toEqual(['control', 'control', 'actions', 'sensors']);
  });

  it('lists the .MD card kinds and the robot screen tabs', () => {
    expect([...MD_CARD_KINDS].sort()).toEqual(Object.keys(CARD_KINDS).sort());
    expect(MD_CARD_KINDS).toEqual(['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit', 'doReturn', 'doPowerDown']);
    expect(ROBOT_TABS).toEqual(['program', 'md', 'looks', 'stats', 'log']);
  });
});

describe("job 1's set", () => {
  it('is what a new farm starts with', () => {
    expect(UNLOCKS.job1).toEqual({ blocks: JOB1_BLOCKS, cards: ['dontLeave', 'dontGoIntoWater'], tabs: ['program', 'md', 'looks', 'log'] });
    expect(createDefaultSections().robots.unlocks).toEqual(UNLOCKS.job1);
    expect(BASE.robots.unlocks).toEqual(UNLOCKS.job1);
  });

  it('is in canonical order', () => {
    const { blocks, cards, tabs } = UNLOCKS.job1;
    expect(blocks).toEqual(BLOCK_KINDS.filter((kind) => (blocks as readonly string[]).includes(kind)));
    expect(cards).toEqual(MD_CARD_KINDS.filter((kind) => (cards as readonly string[]).includes(kind)));
    expect(tabs).toEqual(ROBOT_TABS.filter((tab) => (tabs as readonly string[]).includes(tab)));
  });
});

describe('withUnlocks', () => {
  it('adds kinds in canonical order and keeps the lists it does not touch', () => {
    const next = withUnlocks(BASE, { blocks: ['harvest', 'bagFull'], tabs: ['stats'] });
    expect(next.robots.unlocks.blocks).toEqual(BLOCK_KINDS.filter((kind) => JOB1_BLOCKS.includes(kind) || kind === 'harvest' || kind === 'bagFull'));
    expect(next.robots.unlocks.blocks.slice(0, 3)).toEqual(['morning', 'atTime', 'bagFull']);
    expect(next.robots.unlocks.tabs).toEqual(['program', 'md', 'looks', 'stats', 'log']);
    expect(next.robots.unlocks.cards).toBe(BASE.robots.unlocks.cards);
  });

  it('returns the same state when nothing is new', () => {
    expect(withUnlocks(BASE, {})).toBe(BASE);
    expect(withUnlocks(BASE, { blocks: ['move', 'say'], cards: ['dontLeave'], tabs: [] })).toBe(BASE);
    const all = withUnlocks(BASE, ALL_UNLOCKS);
    expect(withUnlocks(all, { blocks: ['harvest'] })).toBe(all);
  });

  it('unlocks everything with ALL_UNLOCKS', () => {
    expect(withUnlocks(BASE, ALL_UNLOCKS).robots.unlocks).toEqual({ blocks: [...BLOCK_KINDS], cards: [...MD_CARD_KINDS], tabs: [...ROBOT_TABS] });
  });
});

describe('unlocks in the save', () => {
  it('round-trips job 1 and the full set', () => {
    for (const state of [BASE, withUnlocks(BASE, ALL_UNLOCKS), withUnlocks(BASE, { cards: ['doReturn'], tabs: ['stats'] })]) {
      expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
    }
  });

  const rejections: readonly [string, (unlocks: SaveJson, robots: SaveJson) => void][] = [
    ['blocks out of canonical order', (u) => void (u.blocks = ['atTime', 'morning'])],
    ['a repeated block', (u) => void (u.blocks = ['morning', 'morning'])],
    ['an unknown block', (u) => void (u.blocks = ['morning', 'dance'])],
    ['the do statement as a block', (u) => void (u.blocks = ['do'])],
    ['an unknown card', (u) => void (u.cards = ['dontDance'])],
    ['cards out of canonical order', (u) => void (u.cards = ['dontGoIntoWater', 'dontLeave'])],
    ['an unknown tab', (u) => void (u.tabs = ['program', 'shop'])],
    ['tabs out of canonical order', (u) => void (u.tabs = ['md', 'program'])],
    ['a missing list', (u) => void delete u.tabs],
    ['an extra key', (u) => void (u.parts = [])],
    ['a list that is not a list', (u) => void (u.cards = 'dontLeave')],
    ['no unlocks at all', (_u, robots) => void delete robots.unlocks],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corruptUnlocks(BASE, edit)).toBeNull();
  });
});

describe('locked kinds', () => {
  it('still run: unlocks gate the editor, not the simulation', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.if(b.cropIsReady(), [b.harvest()], [b.turn('right')]))] });
    for (const kind of ['every', 'if', 'cropIsReady', 'harvest'] as const) expect(BASE.robots.unlocks.blocks).not.toContain(kind);
    const robot = robotOf({ program, exec: morningExec(program), power: 'standby' });
    expect(checkProgram(program, robot)).toBeNull();
    const next = gameReducer(withRobots(emptyHanded(scenario(EMPTY_TILE)), [robot]), actions.tick(20));
    expect(requireRobot(next, 1).lastAction).toMatchObject({ kind: 'turn', success: true });
  });
});

describe('the unlockAll dev hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unlocks every block, card and tab', () => {
    const handle: Record<string, unknown> = {};
    vi.stubGlobal('window', { __meadowlight: handle });
    const store = createStore(gameReducer, createInitialState());
    installRobotDev(store);
    const unlockAll = handle.unlockAll as () => string;
    expect(unlockAll()).toBe('Unlocked every block, card and tab.');
    expect(store.getState().robots.unlocks).toEqual(ALL_UNLOCKS);
  });
});
