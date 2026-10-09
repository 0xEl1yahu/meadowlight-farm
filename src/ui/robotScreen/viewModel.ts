/**
 * Pure view models for the robot screen (farmclaws part 3 spec §4): the header, the tabs each
 * mode shows, the switch, the Stats and Log rows, and the prompts. No DOM, so
 * tests/robotScreen.test.ts covers every rule here; RobotScreen.ts and the tabs only draw what
 * these return.
 */
import { ROBOT_CARE, ROBOT_PAINTS, ROBOT_SCREEN } from '../../config';
import {
  ROBOT_PART_IDS,
  ROBOT_TABS,
  type GameState,
  type Robot,
  type RobotPartId,
  type RobotPower,
  type RobotSize,
  type RobotTab,
  type RobotUnlocks,
} from '../../core/types';
import { getItem } from '../../items/items';
import { robotSays, whatHappened } from '../../robots/logText';
import { SWITCHABLE_POWERS, batteryFor, scrapValue } from '../../robots/stats';
import { formatClock } from '../../time/clock';

/** Bench mode edits the robot; peek mode only reads its Stats and Log (spec §2.3). */
export type RobotScreenMode = 'bench' | 'peek';

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

/** Tabs a peek may show (spec §2.3). */
const PEEK_TABS: ReadonlySet<RobotTab> = new Set<RobotTab>(['stats', 'log']);

export interface HeaderView {
  readonly name: string;
  readonly sizeLabel: string;
  readonly parts: readonly RobotPartId[];
  /** "{tokens} / {battery} tokens". */
  readonly tokens: string;
  readonly power: string;
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

export function headerView(robot: Robot): HeaderView {
  return {
    name: robot.name,
    sizeLabel: SIZE_LABELS[robot.size],
    parts: robot.parts,
    tokens: `${numberFormat.format(robot.tokens)} / ${numberFormat.format(batteryFor(robot.size))} tokens`,
    power: POWER_LABELS[robot.power],
    offText: offText(robot.off),
  };
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

/** The tabs a mode shows, in ROBOT_TABS order: each needs its unlock; peek shows only Stats and Log. */
export function visibleTabs(mode: RobotScreenMode, unlocks: RobotUnlocks): readonly RobotTab[] {
  return ROBOT_TABS.filter((tab) => unlocks.tabs.includes(tab) && (mode === 'bench' || PEEK_TABS.has(tab)));
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
