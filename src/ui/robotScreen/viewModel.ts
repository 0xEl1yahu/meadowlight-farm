/**
 * Pure view models for the robot screen (farmclaws part 3 spec §4, part 4b spec §4.4, §5.1): the
 * robot shown, the header, the tabs each mode shows, the switch, the Stats and Log rows, the
 * Parts section and the prompts. No DOM, so tests/robotScreen.test.ts covers every rule here; RobotScreen.ts and the
 * tabs only draw what these return.
 */
import { ROBOT_CARE, ROBOT_PAINTS, ROBOT_SCREEN, ROBOTS } from '../../config';
import {
  ROBOT_PART_IDS,
  ROBOT_TABS,
  type GameState,
  type InventoryState,
  type Robot,
  type RobotPartId,
  type RobotPower,
  type RobotSize,
  type RobotTab,
  type RobotUnlocks,
  type UiPanel,
} from '../../core/types';
import { getItem } from '../../items/items';
import { robotSays, whatHappened } from '../../robots/logText';
import { SWITCHABLE_POWERS, batteryFor, scrapValue } from '../../robots/stats';
import { catalogueRobot } from '../../robots/workshop';
import { findRobot } from '../../robots/world';
import { countItem } from '../../state/inventory';
import { formatClock } from '../../time/clock';

/**
 * Bench mode edits the robot; peek mode only reads its Stats and Log (spec §2.3); preview mode
 * reads a workshop robot's Program and Looks before it's bought (part 4b spec §4.4).
 */
export type RobotScreenMode = 'bench' | 'peek' | 'preview';

/** A robot screen's panel. */
export type RobotPanel = Extract<UiPanel, { readonly kind: 'robot' }>;

const numberFormat = new Intl.NumberFormat('en-US');
const perCropFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const SIZE_LABELS: Readonly<Record<RobotSize, string>> = { mini: 'Mini', standard: 'Standard', big: 'Big' };

/** Each part's name, from its item (part 4b spec §2), so the screen and the backpack agree. */
export const PART_LABELS = Object.fromEntries(ROBOT_PART_IDS.map((part) => [part, getItem(part).name])) as Readonly<Record<RobotPartId, string>>;

export const POWER_LABELS: Readonly<Record<RobotPower, string>> = {
  working: 'Working',
  standby: 'Standing by',
  flat: 'Flat',
  broken: 'Shorted out',
  repairing: 'Getting a new core',
  ruined: 'Ruined',
};

export const TAB_LABELS: Readonly<Record<RobotTab, string>> = {
  program: 'Program',
  md: '.MD',
  looks: 'Looks',
  stats: 'Stats',
  log: 'Log',
};

/** Shown when a mode has no unlocked tab (peeking before the Log is unlocked). */
export const EMPTY_TABS_TEXT = 'Nothing to show yet.';

export const LOG_TEXT = {
  empty: 'Nothing yet today.',
  yesterday: 'Yesterday',
} as const;

/** Tabs that edit the robot: read-only for a ruined robot (spec §3.2). */
const EDIT_TABS: ReadonlySet<RobotTab> = new Set<RobotTab>(['program', 'md', 'looks']);

/** Tabs each read-only mode may show: a peek's (spec §2.3) and a workshop preview's (part 4b spec §4.4). */
const READ_ONLY_TABS: Readonly<Record<Exclude<RobotScreenMode, 'bench'>, ReadonlySet<RobotTab>>> = {
  peek: new Set<RobotTab>(['stats', 'log']),
  preview: new Set<RobotTab>(['program', 'looks']),
};

/** The header's size tag in a workshop preview, where the name is the size. */
export const PREVIEW_TAG = "From Juniper's workshop";

/** Each size's catalogue robot, built once so the screen sees the same robot on every sync. */
const previews = new Map<RobotSize, Robot>();

/**
 * The robot a panel shows: the state's robot for the bench or a peek (null when it's gone), or
 * the size's catalogue robot for a workshop preview, which isn't in the state.
 */
export function screenRobot(state: GameState, panel: RobotPanel): Robot | null {
  if (panel.mode !== 'preview') return findRobot(state, panel.robotId);
  let robot = previews.get(panel.size);
  if (robot === undefined) {
    robot = catalogueRobot(panel.size);
    previews.set(panel.size, robot);
  }
  return robot;
}

/** True when two robot panels show the same robot in the same mode. */
export function samePanel(a: RobotPanel, b: RobotPanel): boolean {
  if (a.mode === 'preview') return b.mode === 'preview' && a.size === b.size;
  return b.mode !== 'preview' && a.mode === b.mode && a.robotId === b.robotId;
}

export interface HeaderView {
  readonly name: string;
  readonly sizeLabel: string;
  readonly parts: readonly RobotPartId[];
  /** "{tokens} / {battery} tokens". */
  readonly tokens: string;
  /** Null in a workshop preview, where the robot isn't running yet. */
  readonly power: string | null;
  /** "Switched off", "Off until morning", or null while the robot isn't off. */
  readonly offText: string | null;
}

function offText(off: Robot['off']): string | null {
  switch (off) {
    case null:
      return null;
    case 'player':
      return 'Switched off';
    case 'dizzy':
    case 'done':
      return 'Off until morning';
  }
}

/**
 * The header. A workshop preview shows the size and "From Juniper's workshop" in place of the
 * name and the size tag, and no power or off text (part 4b spec §4.4).
 */
export function headerView(robot: Robot, mode: RobotScreenMode): HeaderView {
  const preview = mode === 'preview';
  return {
    name: preview ? SIZE_LABELS[robot.size] : robot.name,
    sizeLabel: preview ? PREVIEW_TAG : SIZE_LABELS[robot.size],
    parts: robot.parts,
    tokens: `${numberFormat.format(robot.tokens)} / ${numberFormat.format(batteryFor(robot.size))} tokens`,
    power: preview ? null : POWER_LABELS[robot.power],
    offText: preview ? null : offText(robot.off),
  };
}

/** The On / Off switch, Lift off and Scrap belong to the bench alone. */
export function hasBenchActions(mode: RobotScreenMode): boolean {
  return mode === 'bench';
}

/** True when the editing tabs only read: always in a preview, and for a ruined robot (spec §3.2). */
export function isReadOnly(robot: Robot, mode: RobotScreenMode): boolean {
  return mode === 'preview' || robot.power === 'ruined';
}

export interface SwitchView {
  /** The button's text. */
  readonly label: 'On' | 'Off';
  /** What pressing it asks for: `switchRobot { on }`. */
  readonly on: boolean;
}

/**
 * The bench's on/off switch (spec §2.4): "On" when the player switched the robot off, otherwise
 * "Off" whatever `off` is, but only for a power the reducer can switch off (working, standby or
 * flat). Hidden in peek mode, so a ruined robot never shows it (spec §3.2).
 */
export function switchView(robot: Robot, mode: RobotScreenMode): SwitchView | null {
  if (mode !== 'bench') return null;
  if (robot.off === 'player') return { label: 'On', on: true };
  return SWITCHABLE_POWERS.has(robot.power) ? { label: 'Off', on: false } : null;
}

/**
 * The tabs a mode shows, in ROBOT_TABS order: each needs its unlock; peek shows only Stats and
 * Log, and a preview only Program and Looks.
 */
export function visibleTabs(mode: RobotScreenMode, unlocks: RobotUnlocks): readonly RobotTab[] {
  return ROBOT_TABS.filter((tab) => unlocks.tabs.includes(tab) && (mode === 'bench' || READ_ONLY_TABS[mode].has(tab)));
}

/**
 * The tab a key moves to in the tab strip (the ARIA tabs pattern): ArrowRight / ArrowLeft step
 * through `visible`, wrapping around; Home / End go to the first / last. Null for any other key,
 * or when `current` isn't among `visible`.
 */
export function nextTab(visible: readonly RobotTab[], current: RobotTab, key: string): RobotTab | null {
  const index = visible.indexOf(current);
  if (index < 0) return null;
  const count = visible.length;
  switch (key) {
    case 'ArrowRight':
      return visible[(index + 1) % count] ?? null;
    case 'ArrowLeft':
      return visible[(index - 1 + count) % count] ?? null;
    case 'Home':
      return visible[0] ?? null;
    case 'End':
      return visible[count - 1] ?? null;
    default:
      return null;
  }
}

export function isEditTab(tab: RobotTab): boolean {
  return EDIT_TABS.has(tab);
}

/** The note over a ruined robot's Program, .MD and Looks tabs (spec §3.2). */
export function ruinedNote(robot: Robot): string | null {
  return robot.power === 'ruined' ? `${robot.name} is ruined. It can only be scrapped.` : null;
}

export interface StatsRow {
  readonly label: string;
  readonly today: string;
  readonly week: string;
}

function perCrop(tokens: number, crops: number): string {
  return crops === 0 ? '—' : perCropFormat.format(tokens / crops);
}

/** The Stats tab's rows (spec §4.5): two columns, Today and This week. */
export function statsRows(robot: Robot): readonly StatsRow[] {
  const { today, week } = robot.stats;
  const count = (n: number): string => numberFormat.format(n);
  return [
    { label: 'Tokens used', today: count(today.tokens), week: count(week.tokens) },
    { label: 'Actions taken', today: count(today.actions), week: count(week.actions) },
    { label: 'Crops handled', today: count(today.crops), week: count(week.crops) },
    { label: 'Tokens per crop', today: perCrop(today.tokens, today.crops), week: perCrop(week.tokens, week.crops) },
  ];
}

/** A log time, to the exact minute: "9:40 am". */
export function formatClockMinute(minute: number): string {
  return formatClock(minute, 1);
}

export interface LogRow {
  /** The log entry's id (a stable key). */
  readonly id: number;
  readonly time: string;
  readonly says: string;
  readonly happened: string;
  readonly count: number;
  /** True for yesterday's entries, false for today's. */
  readonly yesterday: boolean;
}

/** The Log tab's rows (spec §4.6): one robot's entries from today and yesterday, newest first. */
export function logRows(state: GameState, robotId: number): readonly LogRow[] {
  const today = state.time.absoluteDay;
  const names = new Map(state.robots.list.map((robot) => [robot.id, robot.name] as const));
  const entries = state.robots.log.entries;
  const rows: LogRow[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.robotId !== robotId) continue;
    if (entry.day !== today && entry.day !== today - 1) continue;
    rows.push({
      id: entry.id,
      time: formatClockMinute(entry.minute),
      says: robotSays(entry),
      happened: whatHappened(entry, names),
      count: entry.count,
      yesterday: entry.day !== today,
    });
  }
  return rows;
}

/** "×{count}" on a merged entry, nothing on a single one. */
export function countText(count: number): string {
  return count > 1 ? `×${count}` : '';
}

/** Asked before Escape, the close button or Lift off throws away unsaved Program or .MD edits (spec §4.1). */
export function discardPrompt(name: string): string {
  return `Discard your changes to ${name}'s program?`;
}

/** Asked before scrapping (spec §3.3). The gold is a plain number, like the "Scrapped {name} for {gold}g." toast. */
export function scrapPrompt(robot: Robot): string {
  return `Scrap ${robot.name} for ${scrapValue(robot)}g? This can't be undone.`;
}

/** The Looks tab's button (spec §3.4). */
export function paintButtonText(): string {
  return `Paint · ${numberFormat.format(ROBOT_CARE.paintCost)}g`;
}

/** The Looks tab's Parts section (part 4b spec §5.1). */
export const PARTS_TEXT = {
  heading: 'Parts',
  fitted: 'Fitted',
  backpack: 'From your backpack',
  emptySlot: 'Empty slot',
  noneToFit: 'No parts in your backpack to fit.',
  takeOff: 'Take off',
  fit: 'Fit',
} as const;

export interface PartRow {
  readonly part: RobotPartId;
  readonly name: string;
}

export interface PartsSectionView {
  /** True when the section has its Take off and Fit buttons: on the bench, for a robot that isn't ruined. */
  readonly editable: boolean;
  /** One per part slot: its fitted part, or null for an empty slot. */
  readonly slots: readonly (PartRow | null)[];
  /** The parts in the backpack the robot can take, in catalogue order; empty when not editable. */
  readonly fittable: readonly PartRow[];
}

/**
 * The Parts section (part 4b spec §5.1): every slot, and on the bench the backpack's parts that
 * aren't fitted yet, one row per part (its stacks together, as the parts shop's Sell list). A
 * preview, a peek or a ruined robot shows the fitted parts only, with no buttons.
 */
export function partsSectionView(robot: Robot, mode: RobotScreenMode, inventory: InventoryState): PartsSectionView {
  const editable = mode === 'bench' && !isReadOnly(robot, mode);
  const row = (part: RobotPartId): PartRow => ({ part, name: PART_LABELS[part] });
  const slots = Array.from({ length: ROBOTS.sizes[robot.size].partSlots }, (_, i) => {
    const part = robot.parts[i];
    return part === undefined ? null : row(part);
  });
  const fittable = editable ? ROBOT_PART_IDS.filter((part) => !robot.parts.includes(part) && countItem(inventory, part) > 0).map(row) : [];
  return { editable, slots, fittable };
}

/** A ROBOT_PAINTS colour as CSS. */
export function paintHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A paint's name, or '' for an index outside ROBOT_PAINTS. */
export function paintName(index: number): string {
  return ROBOT_PAINTS[index]?.name ?? '';
}

/** The media query for the phone layout: narrower than ROBOT_SCREEN.phoneMaxWidth (spec §4.1). */
export function phoneQuery(): string {
  return `(max-width: ${ROBOT_SCREEN.phoneMaxWidth - 0.02}px)`;
}
