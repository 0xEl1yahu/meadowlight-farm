/**
 * The Program tab's pure rules (farmclaws part 3 spec §4.2): which blocks the toolbox offers,
 * the options every dropdown shows, how a dropdown value is accepted and labelled, the default
 * literals for new variables, the counters and the editor's sentences. No Blockly import, so
 * tests/robotScreen.test.ts covers all of it; blockDefs.ts and ProgramTab.ts apply it.
 */
import { ROBOTS, ROBOT_SCREEN, TIME } from '../../../config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type CropId,
  type ItemId,
  type Robot,
  type RobotSize,
  type RobotUnlocks,
  type ValueType,
  type ZoneId,
} from '../../../core/types';
import { CROPS } from '../../../farming/crops';
import { ITEMS, getItem, isItemId } from '../../../items/items';
import { BLOCK_CATEGORY, BLOCK_KINDS, type BlockCategory } from '../../../robots/blockKinds';
import { hasPart } from '../../../robots/stats';
import { formatClock } from '../../../time/clock';
import { blockTypeFor } from '../translate';

// ---------------------------------------------------------------------------
// Dropdowns
// ---------------------------------------------------------------------------

/** Dropdowns whose options come from game data, plus the two whose options are the workspace's names. */
export type MenuKind = 'minute' | 'every' | 'item' | 'crop' | 'zone' | 'var' | 'helper';
export type DropdownKind = Exclude<MenuKind, 'var' | 'helper'>;

export const MENU_KINDS: readonly MenuKind[] = ['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'];

/** The Blockly field type registered for a menu kind. */
export function menuFieldType(kind: MenuKind): string {
  return `field_fc_${kind}`;
}

/** Shown for an empty variable or helper name, and when the workspace has no names yet. */
const NO_NAME = '—';

/** Item kinds the item dropdowns list; any other item still shows when it is the current value. */
const LISTED_ITEM_KINDS: ReadonlySet<string> = new Set(['seed', 'produce', 'material']);

const WHOLE_NUMBER = /^-?\d+$/;

function isCropId(value: unknown): value is CropId {
  return (CROP_IDS as readonly unknown[]).includes(value);
}

function isZoneId(value: unknown): value is ZoneId {
  return (ZONE_IDS as readonly unknown[]).includes(value);
}

function minuteOptions(): [string, string][] {
  const options: [string, string][] = [];
  for (let minute = TIME.dayStartMinute; minute < TIME.passOutMinute; minute += ROBOT_SCREEN.timeStep) {
    options.push([formatClock(minute, 1), String(minute)]);
  }
  return options;
}

function usualOptions(kind: DropdownKind): [string, string][] {
  switch (kind) {
    case 'minute':
      return minuteOptions();
    case 'every':
      return EVERY_CHOICES.map((minutes): [string, string] => [String(minutes), String(minutes)]);
    case 'item': {
      const options: [string, string][] = [];
      for (const item of ITEMS.values()) if (LISTED_ITEM_KINDS.has(item.kind)) options.push([item.name, item.id]);
      return options;
    }
    case 'crop':
      return CROP_IDS.map((id): [string, string] => [CROPS[id].name, id]);
    case 'zone':
      return ZONE_IDS.map((zone): [string, string] => [`Zone ${zone}`, zone]);
  }
}

/**
 * The options of a dropdown (spec §4.2): the usual list, plus `current` when it isn't in it, so
 * a loaded value is shown and kept. Numeric kinds put it in order; other kinds put it last.
 */
export function dropdownOptions(kind: DropdownKind, current: string | number | null): readonly [string, string][] {
  const options = usualOptions(kind);
  if (current === null) return options;
  const value = String(current);
  if (options.some(([, option]) => option === value)) return options;
  const extra: [string, string] = [menuLabel(kind, value), value];
  if (kind === 'minute' || kind === 'every') {
    const at = options.findIndex(([, option]) => Number(option) > Number(value));
    options.splice(at === -1 ? options.length : at, 0, extra);
  } else {
    options.push(extra);
  }
  return options;
}

/** The options of a variable or helper dropdown: the workspace's names, plus the current one. */
export function nameOptions(names: readonly string[], current: string | null): readonly [string, string][] {
  const list = [...new Set(names.filter((name) => name !== ''))];
  if (current !== null && current !== '' && !list.includes(current)) list.push(current);
  return list.length === 0 ? [[NO_NAME, '']] : list.map((name): [string, string] => [name, name]);
}

/** What a dropdown shows for `value`. */
export function menuLabel(kind: MenuKind, value: string | null): string {
  switch (kind) {
    case 'minute':
      return value !== null && WHOLE_NUMBER.test(value) ? formatClock(Number(value), 1) : (value ?? '');
    case 'every':
      return value ?? '';
    case 'item':
      return isItemId(value) ? getItem(value).name : (value ?? '');
    case 'crop':
      return isCropId(value) ? CROPS[value].name : (value ?? '');
    case 'zone':
      return value === null ? '' : `Zone ${value}`;
    case 'var':
    case 'helper':
      return value === null || value === '' ? NO_NAME : value;
  }
}

/**
 * The value a dropdown of `kind` stores for `value`, or null to refuse it. Times are whole
 * numbers (saved as their decimal text), items, crops and zones must exist, names are any text.
 */
export function menuAccepts(kind: MenuKind, value: unknown): string | null {
  switch (kind) {
    case 'minute':
    case 'every':
      if (typeof value === 'number') return Number.isInteger(value) ? String(value) : null;
      return typeof value === 'string' && WHOLE_NUMBER.test(value) ? value : null;
    case 'item':
      return isItemId(value) ? value : null;
    case 'crop':
      return isCropId(value) ? value : null;
    case 'zone':
      return isZoneId(value) ? value : null;
    case 'var':
    case 'helper':
      return typeof value === 'string' ? value : null;
  }
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

export const BLOCK_CATEGORIES: readonly BlockCategory[] = ['triggers', 'control', 'actions', 'sensors', 'values'];

export const CATEGORY_NAMES: Readonly<Record<BlockCategory, string>> = {
  triggers: 'Triggers',
  control: 'Control',
  actions: 'Actions',
  sensors: 'Sensors',
  values: 'Values',
};

/** The theme's block and category style name for a category. */
export function categoryStyle(category: BlockCategory): string {
  return `fc_${category}`;
}

/** The sensors a size without a sensor eye can't use (the checker's part rule). */
export const SENSOR_EYE_TYPES: ReadonlySet<string> = new Set(['fc_tileAheadIs', 'fc_itIsRaining', 'fc_timeIsAfter']);
export const NEEDS_SENSOR_EYE_REASON = 'fc_needsSensorEye';
export const NEEDS_SENSOR_EYE_TEXT = 'Needs a sensor eye';

export interface ToolboxBlockJson {
  readonly kind: 'block';
  readonly type: string;
  readonly disabledReasons?: readonly string[];
}

export interface ToolboxCategoryJson {
  readonly kind: 'category';
  readonly name: string;
  readonly category: BlockCategory;
  readonly categorystyle: string;
  readonly contents: readonly ToolboxBlockJson[];
}

export interface ToolboxJson {
  readonly kind: 'categoryToolbox';
  readonly contents: readonly ToolboxCategoryJson[];
}

/**
 * The toolbox for a robot and the unlocked blocks (spec §4.2, §7): the five categories in order,
 * each with its unlocked block types in BLOCK_KINDS order, empty categories left out. The
 * variable getter sits under Values; declarations come from "Make a variable", not the toolbox.
 * Without a sensor eye the sensor-eye sensors are disabled. No shadow blocks.
 */
export function toolboxFor(robot: Pick<Robot, 'size' | 'parts'>, unlocks: RobotUnlocks): ToolboxJson {
  const groups = new Map<BlockCategory, string[]>(BLOCK_CATEGORIES.map((category) => [category, []]));
  for (const kind of BLOCK_KINDS) {
    if (!unlocks.blocks.includes(kind)) continue;
    for (const type of blockTypeFor(kind)) {
      if (type === 'fc_varDecl') continue;
      groups.get(type === 'fc_var' ? 'values' : BLOCK_CATEGORY[kind])?.push(type);
    }
  }
  const eye = hasPart(robot, 'sensorEye');
  const contents: ToolboxCategoryJson[] = [];
  for (const category of BLOCK_CATEGORIES) {
    const types = groups.get(category) ?? [];
    if (types.length === 0) continue;
    contents.push({
      kind: 'category',
      name: CATEGORY_NAMES[category],
      category,
      categorystyle: categoryStyle(category),
      contents: types.map((type): ToolboxBlockJson =>
        !eye && SENSOR_EYE_TYPES.has(type) ? { kind: 'block', type, disabledReasons: [NEEDS_SENSOR_EYE_REASON] } : { kind: 'block', type },
      ),
    });
  }
  return { kind: 'categoryToolbox', contents };
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/** The socket check of each value type (spec §4.2). */
export const VALUE_CHECKS: Readonly<Record<ValueType, string>> = {
  number: 'Number',
  text: 'Text',
  yesNo: 'YesNo',
  item: 'Item',
  tile: 'Tile',
};

export const VALUE_TYPE_LABELS: Readonly<Record<ValueType, string>> = {
  number: 'Number',
  text: 'Text',
  yesNo: 'Yes/No',
  item: 'Item',
  tile: 'Tile',
};

export function isValueType(value: unknown): value is ValueType {
  return (VALUE_TYPES as readonly unknown[]).includes(value);
}

/** A block to add to the workspace, in Blockly's serialization shape (ids are left to Blockly). */
export interface NewBlockState {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, { readonly block: NewBlockState }>>;
}

/** A new variable's starting literal (spec §4.2): 0, "", No, parsnip, or the robot's tile. */
export function defaultLiteral(type: ValueType, robot: Pick<Robot, 'tx' | 'tz'>): NewBlockState {
  switch (type) {
    case 'number':
      return { type: 'fc_num', fields: { NUM: 0 } };
    case 'text':
      return { type: 'fc_text', fields: { TEXT: '' } };
    case 'yesNo':
      return { type: 'fc_yes', fields: { VALUE: 'FALSE' } };
    case 'item':
      return { type: 'fc_item', fields: { ITEM: CROP_IDS[0] satisfies ItemId } };
    case 'tile':
      return { type: 'fc_tile', fields: { X: robot.tx, Z: robot.tz } };
  }
}

/** "Variable [name] is a [type] starting at [literal]" at (x, y). */
export function declarationState(name: string, type: ValueType, robot: Pick<Robot, 'tx' | 'tz'>, x: number, y: number): NewBlockState {
  return { type: 'fc_varDecl', x, y, fields: { NAME: name, TYPE: type }, inputs: { INITIAL: { block: defaultLiteral(type, robot) } } };
}

// ---------------------------------------------------------------------------
// Counters and sentences
// ---------------------------------------------------------------------------

export interface CounterView {
  readonly text: string;
  /** Over the limit: shown red. */
  readonly over: boolean;
}

export function counterView(used: number, limit: number, noun: string): CounterView {
  return { text: `${used} / ${limit} ${noun}`, over: used > limit };
}

/** "{used} / {limit} blocks" (spec §4.2). */
export function blockCounter(used: number, size: RobotSize): CounterView {
  return counterView(used, ROBOTS.sizes[size].blocks, 'blocks');
}

/** "{n} / {limit} variables". */
export function variableCounter(declared: number, size: RobotSize): CounterView {
  return counterView(declared, ROBOTS.sizes[size].vars, 'variables');
}

export const EDITOR_TEXT = {
  opening: 'Opening the editor…',
  failed: "The editor couldn't load. Close and try again.",
  loose: 'Every block must be inside a When … stack or a helper.',
  tooBig: 'This program is too big or too deeply nested to save.',
  blocks: 'Blocks',
  makeVariable: 'Make a variable',
  save: 'Save',
  revert: 'Revert',
} as const;

/** The note over a part 1 script robot's empty workspace (spec §4.2). */
export function scriptNote(name: string): string {
  return `${name} runs a fixed script. Saving here replaces it with a block program.`;
}
