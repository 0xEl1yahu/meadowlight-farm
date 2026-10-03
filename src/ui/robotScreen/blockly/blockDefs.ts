/**
 * The robot language's Blockly blocks (farmclaws part 3 spec §4.2, §5): one JSON definition per
 * BLOCK_TYPES entry, with the field and input names translate.ts reads and writes. Labels are
 * sentence case. Value sockets are typed Number, Text, YesNo, Item or Tile; statement
 * connections are untyped; fc_var's output check is set by the Program tab from its
 * declaration. Triggers, helpers and declarations have no previous or next connection.
 *
 * BLOCK_DEFINITIONS is plain data (tests check it against translate.ts without a DOM);
 * defineBlocks registers it with Blockly, together with:
 * - the menu fields (`field_fc_*`): dropdowns whose generator always includes the current value
 *   and whose validation accepts any well-formed value (toolbox.ts menuAccepts), because
 *   Blockly's FieldDropdown would otherwise reject a loaded value outside its cached options;
 * - the sensor-eye extension: a sensor disabled in the toolbox explains "Needs a sensor eye".
 */
import type * as Blockly from 'blockly/core';
import { ROBOTS } from '../../../config';
import { VALUE_TYPES } from '../../../core/types';
import type { BlockCategory } from '../../../robots/blockKinds';
import { MAPS } from '../../../world/maps';
import {
  MENU_KINDS,
  NEEDS_SENSOR_EYE_REASON,
  NEEDS_SENSOR_EYE_TEXT,
  VALUE_CHECKS,
  VALUE_TYPE_LABELS,
  categoryStyle,
  dropdownOptions,
  menuAccepts,
  menuFieldType,
  menuLabel,
  nameOptions,
  type MenuKind,
} from './toolbox';

type BlocklyApi = typeof Blockly;

/** One Blockly JSON block definition. */
export type BlockDefinitionJson = { readonly type: string } & Readonly<Record<string, unknown>>;

const SENSOR_EYE_EXTENSION = 'fc_sensor_eye_tooltip';
const FARM = MAPS.farm.grid;

const NUMBER = VALUE_CHECKS.number;
const TEXT = VALUE_CHECKS.text;
const YES_NO = VALUE_CHECKS.yesNo;
const ITEM = VALUE_CHECKS.item;
const TILE = VALUE_CHECKS.tile;

// --- Argument builders -----------------------------------------------------------------------

const statementInput = (name: string) => ({ type: 'input_statement', name });
const valueInput = (name: string, check?: string) => (check === undefined ? { type: 'input_value', name } : { type: 'input_value', name, check });
const menu = (kind: MenuKind, name: string) => ({ type: menuFieldType(kind), name });
const choice = (name: string, options: readonly (readonly [string, string])[]) => ({
  type: 'field_dropdown',
  name,
  options: options.map(([label, value]) => [label, value]),
});
const textField = (name: string, text: string) => ({ type: 'field_input', name, text, spellcheck: false });
const numberField = (name: string, min: number, max: number) => ({ type: 'field_number', name, value: 0, min, max, precision: 1 });

// --- Block builders --------------------------------------------------------------------------

/** A top block that starts a stack: no previous or next connection, a `DO` body. */
function topBlock(type: string, category: BlockCategory, message: string, args: readonly object[] = []): BlockDefinitionJson {
  return { type, message0: message, args0: args, message1: '%1', args1: [statementInput('DO')], style: categoryStyle(category), tooltip: '' };
}

/** A statement with an optional `DO` body. */
function statement(type: string, category: BlockCategory, message: string, args: readonly object[] = [], body = false): BlockDefinitionJson {
  return {
    type,
    message0: message,
    args0: args,
    ...(body ? { message1: '%1', args1: [statementInput('DO')] } : {}),
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle(category),
    tooltip: '',
  };
}

/** An expression block with output check `output` (null: any). */
function expression(
  type: string,
  category: BlockCategory,
  message: string,
  output: string | null,
  args: readonly object[] = [],
  extensions: readonly string[] = [],
): BlockDefinitionJson {
  return {
    type,
    message0: message,
    args0: args,
    output,
    inputsInline: true,
    style: categoryStyle(category),
    tooltip: '',
    ...(extensions.length > 0 ? { extensions: [...extensions] } : {}),
  };
}

const sensor = (type: string, message: string, args: readonly object[] = [], extensions: readonly string[] = []) =>
  expression(type, 'sensors', message, YES_NO, args, extensions);

// --- The blocks --------------------------------------------------------------------------------

export const BLOCK_DEFINITIONS: readonly BlockDefinitionJson[] = [
  // Triggers
  topBlock('fc_morning', 'triggers', 'When morning comes'),
  topBlock('fc_atTime', 'triggers', "When it's %1", [menu('minute', 'MINUTE')]),
  topBlock('fc_bagFull', 'triggers', 'When my bag is full'),
  topBlock('fc_startsRaining', 'triggers', 'When it starts raining'),
  topBlock('fc_every', 'triggers', 'Every %1 minutes', [menu('every', 'MINUTES')]),

  // Helpers and variables
  topBlock('fc_helper', 'control', 'Define helper %1', [textField('NAME', 'helper')]),
  {
    type: 'fc_varDecl',
    message0: 'Variable %1 is a %2 starting at %3',
    args0: [
      textField('NAME', 'n'),
      choice(
        'TYPE',
        VALUE_TYPES.map((type) => [VALUE_TYPE_LABELS[type], type] as const),
      ),
      // No static check: refreshChecks sets it, and only after a load or append, where Blockly's serializer would throw on a mismatch.
      valueInput('INITIAL'),
    ],
    inputsInline: true,
    style: categoryStyle('values'),
    tooltip: '',
  },

  // Actions
  statement('fc_move', 'actions', 'Move forward'),
  statement('fc_turn', 'actions', 'Turn %1', [
    choice('SIDE', [
      ['left', 'left'],
      ['right', 'right'],
    ]),
  ]),
  statement('fc_water', 'actions', 'Water'),
  statement('fc_harvest', 'actions', 'Harvest'),
  statement('fc_till', 'actions', 'Till'),
  statement('fc_plant', 'actions', 'Plant %1', [menu('crop', 'CROP')]),
  statement('fc_refill', 'actions', 'Refill'),
  statement('fc_deposit', 'actions', 'Deposit'),
  statement('fc_take', 'actions', 'Take %1', [valueInput('ITEM', ITEM)]),
  statement('fc_say', 'actions', 'Say %1', [valueInput('TEXT', TEXT)]),
  statement('fc_wait', 'actions', 'Wait %1 minutes', [valueInput('MINUTES', NUMBER)]),
  statement('fc_powerDown', 'actions', 'Power down'),
  statement('fc_goTo', 'actions', 'Go to %1', [valueInput('TILE', TILE)]),

  // Control
  statement('fc_repeatTimes', 'control', 'Repeat %1 times', [valueInput('TIMES', NUMBER)], true),
  statement('fc_repeatUntil', 'control', 'Repeat until %1', [valueInput('UNTIL', YES_NO)], true),
  statement('fc_repeatForever', 'control', 'Repeat forever', [], true),
  {
    type: 'fc_if',
    message0: 'If %1',
    args0: [valueInput('COND', YES_NO)],
    message1: '%1',
    args1: [statementInput('THEN')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle('control'),
    tooltip: '',
  },
  {
    type: 'fc_ifElse',
    message0: 'If %1',
    args0: [valueInput('COND', YES_NO)],
    message1: '%1',
    args1: [statementInput('THEN')],
    message2: 'Else',
    message3: '%1',
    args3: [statementInput('ELSE')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle('control'),
    tooltip: '',
  },
  statement('fc_forEachTile', 'control', 'For each tile in %1', [menu('zone', 'ZONE')], true),
  statement('fc_set', 'control', 'Set %1 to %2', [menu('var', 'VAR'), valueInput('VALUE')]),
  statement('fc_change', 'control', 'Change %1 by %2', [menu('var', 'VAR'), valueInput('BY', NUMBER)]),
  statement('fc_runHelper', 'control', 'Run helper %1', [menu('helper', 'NAME')]),

  // Sensors
  sensor('fc_cropIsReady', 'crop is ready'),
  sensor('fc_soilIsDry', 'soil is dry'),
  sensor('fc_tileIsTilled', 'tile is tilled'),
  sensor('fc_cropIs', 'crop is %1', [menu('crop', 'CROP')]),
  sensor('fc_bagIsFull', 'bag is full'),
  sensor('fc_bagHas', 'bag has %1', [menu('item', 'ITEM')]),
  sensor('fc_atEdgeOf', 'at edge of %1', [menu('zone', 'ZONE')]),
  sensor('fc_tokensBelow', 'tokens below %1', [valueInput('N', NUMBER)]),
  sensor(
    'fc_tileAheadIs',
    'tile ahead is %1',
    [
      choice('WHAT', [
        ['water', 'water'],
        ['blocked', 'blocked'],
        ['clear', 'clear'],
      ]),
    ],
    [SENSOR_EYE_EXTENSION],
  ),
  sensor('fc_itIsRaining', 'it is raining', [], [SENSOR_EYE_EXTENSION]),
  sensor('fc_timeIsAfter', 'time is after %1', [menu('minute', 'MINUTE')], [SENSOR_EYE_EXTENSION]),

  // Values
  expression('fc_num', 'values', '%1', NUMBER, [numberField('NUM', -ROBOTS.maxNumber, ROBOTS.maxNumber)]),
  expression('fc_text', 'values', '“%1”', TEXT, [textField('TEXT', '')]),
  expression('fc_yes', 'values', '%1', YES_NO, [
    choice('VALUE', [
      ['Yes', 'TRUE'],
      ['No', 'FALSE'],
    ]),
  ]),
  expression('fc_item', 'values', '%1', ITEM, [menu('item', 'ITEM')]),
  expression('fc_tile', 'values', 'tile X %1 Z %2', TILE, [numberField('X', 0, FARM.width - 1), numberField('Z', 0, FARM.depth - 1)]),
  expression('fc_var', 'values', '%1', null, [menu('var', 'VAR')]),
  expression('fc_myTile', 'values', 'my tile', TILE),
  expression('fc_tileAhead', 'values', 'tile ahead', TILE),
  expression('fc_tokensLeft', 'values', 'tokens left', NUMBER),
  expression('fc_countInBag', 'values', 'count of %1 in bag', NUMBER, [menu('item', 'ITEM')]),
  expression('fc_arith', 'values', '%1 %2 %3', NUMBER, [
    valueInput('A', NUMBER),
    choice('OP', [
      ['+', '+'],
      ['−', '-'],
      ['×', '×'],
    ]),
    valueInput('B', NUMBER),
  ]),
  expression('fc_compare', 'values', '%1 %2 %3', YES_NO, [
    valueInput('A'),
    choice('OP', [
      ['=', '='],
      ['≠', '≠'],
      ['<', '<'],
      ['>', '>'],
    ]),
    valueInput('B'),
  ]),
  expression('fc_and', 'values', '%1 and %2', YES_NO, [valueInput('A', YES_NO), valueInput('B', YES_NO)]),
  expression('fc_or', 'values', '%1 or %2', YES_NO, [valueInput('A', YES_NO), valueInput('B', YES_NO)]),
  expression('fc_not', 'values', 'not %1', YES_NO, [valueInput('A', YES_NO)]),
];

// --- Registration ------------------------------------------------------------------------------

/** The names of the workspace's blocks of `type` (a flyout block reads its target workspace). */
function workspaceNames(api: BlocklyApi, field: Blockly.FieldDropdown, type: string): string[] {
  const block = field.getSourceBlock();
  if (block === null) return [];
  let workspace: Blockly.Workspace = block.workspace;
  if (workspace instanceof api.WorkspaceSvg && workspace.isFlyout && workspace.targetWorkspace !== null) workspace = workspace.targetWorkspace;
  return workspace.getBlocksByType(type, true).map((named) => String(named.getFieldValue('NAME') ?? ''));
}

function menuOptions(api: BlocklyApi, kind: MenuKind, field: Blockly.FieldDropdown): readonly (readonly [string, string])[] {
  const current = field.getValue();
  switch (kind) {
    case 'var':
      return nameOptions(workspaceNames(api, field, 'fc_varDecl'), current);
    case 'helper':
      return nameOptions(workspaceNames(api, field, 'fc_helper'), current);
    default:
      return dropdownOptions(kind, current);
  }
}

/** Registers `field_fc_<kind>`: a dropdown that shows, accepts and keeps any well-formed value. */
function registerMenuField(api: BlocklyApi, kind: MenuKind): void {
  const generator = function (this: Blockly.FieldDropdown): Blockly.MenuOption[] {
    return menuOptions(api, kind, this).map(([label, value]): Blockly.MenuOption => [label, value]);
  };
  class MenuField extends api.FieldDropdown {
    constructor() {
      super(generator);
    }

    protected override doClassValidation_(newValue?: unknown): string | null {
      return menuAccepts(kind, newValue);
    }

    protected override getText_(): string | null {
      return menuLabel(kind, this.getValue());
    }
  }
  api.fieldRegistry.register(menuFieldType(kind), Object.assign(MenuField, { fromJson: (): MenuField => new MenuField() }));
}

/** Registers the language's fields, extension and blocks with Blockly, once. */
export function defineBlocks(api: BlocklyApi): void {
  if (api.Blocks['fc_morning'] !== undefined) return;
  for (const kind of MENU_KINDS) registerMenuField(api, kind);
  if (!api.Extensions.isRegistered(SENSOR_EYE_EXTENSION)) {
    api.Extensions.register(SENSOR_EYE_EXTENSION, function (this: Blockly.Block) {
      const block = this;
      const usual = block.tooltip;
      block.setTooltip(() => (block.hasDisabledReason(NEEDS_SENSOR_EYE_REASON) ? NEEDS_SENSOR_EYE_TEXT : usual));
    });
  }
  api.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS.map((definition) => ({ ...definition })));
}
