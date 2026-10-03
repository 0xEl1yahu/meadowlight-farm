/**
 * Translation between the robot screen's Blockly workspace and block programs (farmclaws part 3
 * spec §5). Pure, and it never imports Blockly: the workspace JSON shape
 * (`serialization.workspaces.save`) is declared here, so the module runs and is tested without
 * a DOM. It only maps blocks to language nodes and back. Whatever it builds still goes through
 * isProgramShape and checkProgram, which stay the only gate.
 *
 * Block types are `fc_` + a language kind (blockTypeFor). Field values, as Blockly saves them:
 * - dropdowns hold strings: SIDE, CROP, ITEM, ZONE, WHAT, OP, TYPE (a ValueType), VALUE ('TRUE' or
 *   'FALSE'), and the times MINUTE (atTime, timeIsAfter) and MINUTES (every) as decimal strings;
 * - number fields hold numbers: NUM, and a tile's X and Z;
 * - text fields hold strings: TEXT, NAME (helpers, declarations, Run helper) and VAR (Set, Change
 *   and the variable getter).
 * The reader also takes a number field saved as text, and a time saved as a number.
 */
import { ROBOT_SCREEN } from '../../config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type ActionBlock,
  type BlockProgram,
  type Expr,
  type HelperDef,
  type ItemId,
  type Statement,
  type Trigger,
  type TriggerStack,
  type VarDecl,
} from '../../core/types';
import { isItemId } from '../../items/items';
import { BLOCK_KINDS, type BlockKind } from '../../robots/blockKinds';

/** What an input or a `next` connection holds: a block, a shadow, or both (the block shows). */
export interface BlocklyInputJson {
  readonly block?: BlocklyBlockJson;
  readonly shadow?: BlocklyBlockJson;
}

/** One block as Blockly serializes it. */
export interface BlocklyBlockJson {
  readonly type: string;
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, BlocklyInputJson>>;
  readonly next?: BlocklyInputJson;
  readonly extraState?: unknown;
}

/** A workspace as `Blockly.serialization.workspaces.save` returns it. `variables` is never used. */
export interface BlocklyWorkspaceJson {
  readonly blocks?: { readonly languageVersion?: number; readonly blocks?: readonly BlocklyBlockJson[] };
  readonly variables?: readonly unknown[];
}

export type TranslationResult =
  | { readonly program: BlockProgram; readonly loose: readonly string[] }
  | { readonly error: string; readonly blockId: string | null };

const FILL_SLOT = 'Fill every empty slot.';
const NOT_A_BLOCK = "This block isn't part of the robot language.";
const MISSING_SETTING = 'This block is missing a setting.';

const SIDES = ['left', 'right'] as const;
const TILE_AHEAD = ['water', 'blocked', 'clear'] as const;
const ARITH_OPS = ['+', '-', '×'] as const;
const COMPARE_OPS = ['=', '≠', '<', '>'] as const;
const YES_NO = ['TRUE', 'FALSE'] as const;

/** The block types of one block kind: `fc_` + the kind, except If (two shapes) and variables (getter and declaration). */
export function blockTypeFor(kind: BlockKind): readonly string[] {
  switch (kind) {
    case 'if':
      return ['fc_if', 'fc_ifElse'];
    case 'var':
      return ['fc_var', 'fc_varDecl'];
    default:
      return [`fc_${kind}`];
  }
}

/** Every block type of the robot language, in BLOCK_KINDS order. */
export const BLOCK_TYPES: readonly string[] = BLOCK_KINDS.flatMap((kind) => blockTypeFor(kind));

const KNOWN_TYPES: ReadonlySet<string> = new Set(BLOCK_TYPES);

/** Blocks that count 0 towards a robot's limit (part 2 spec §4): the five literals and variable declarations. */
const FREE_BLOCKS: ReadonlySet<string> = new Set(['fc_num', 'fc_text', 'fc_yes', 'fc_item', 'fc_tile', 'fc_varDecl']);

// --- Program → workspace ------------------------------------------------------------------

type Fields = Record<string, string | number>;
type Inputs = Record<string, BlocklyInputJson>;
/** Hands out block ids b1, b2, … in the order blocks are made. */
type NextId = () => string;

/** A block with its fields and inputs, leaving out empty ones as Blockly does. */
function blockJson(type: string, id: string, fields: Fields = {}, inputs: Inputs = {}): BlocklyBlockJson {
  return {
    type,
    id,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
  };
}

function valueInput(expr: Expr, nextId: NextId): BlocklyInputJson {
  return { block: exprJson(expr, nextId) };
}

/** `inputs` plus statement input `name` holding `list`; an empty list leaves the input out. */
function withList(inputs: Inputs, name: string, list: readonly Statement[], nextId: NextId): Inputs {
  const head = listJson(list, nextId);
  return head === null ? inputs : { ...inputs, [name]: { block: head } };
}

/** The first statement's block, the rest chained by `next`; null for an empty list. */
function listJson(list: readonly Statement[], nextId: NextId): BlocklyBlockJson | null {
  const blocks = list.map((statement) => statementJson(statement, nextId));
  return blocks.reduceRight<BlocklyBlockJson | null>((next, block) => (next === null ? block : { ...block, next: { block: next } }), null);
}

function exprJson(expr: Expr, nextId: NextId): BlocklyBlockJson {
  const id = nextId();
  switch (expr.kind) {
    case 'num':
      return blockJson('fc_num', id, { NUM: expr.value });
    case 'text':
      return blockJson('fc_text', id, { TEXT: expr.value });
    case 'yes':
      return blockJson('fc_yes', id, { VALUE: expr.value ? 'TRUE' : 'FALSE' });
    case 'item':
      return blockJson('fc_item', id, { ITEM: expr.itemId });
    case 'tile':
      return blockJson('fc_tile', id, { X: expr.tx, Z: expr.tz });
    case 'var':
      return blockJson('fc_var', id, { VAR: expr.name });
    case 'myTile':
    case 'tileAhead':
    case 'tokensLeft':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'bagIsFull':
    case 'itIsRaining':
      return blockJson(`fc_${expr.kind}`, id);
    case 'countInBag':
    case 'bagHas':
      return blockJson(`fc_${expr.kind}`, id, { ITEM: expr.itemId });
    case 'cropIs':
      return blockJson('fc_cropIs', id, { CROP: expr.cropId });
    case 'atEdgeOf':
      return blockJson('fc_atEdgeOf', id, { ZONE: expr.zone });
    case 'tokensBelow':
      return blockJson('fc_tokensBelow', id, {}, { N: valueInput(expr.n, nextId) });
    case 'tileAheadIs':
      return blockJson('fc_tileAheadIs', id, { WHAT: expr.what });
    case 'timeIsAfter':
      return blockJson('fc_timeIsAfter', id, { MINUTE: String(expr.minute) });
    case 'arith':
    case 'compare':
      return blockJson(`fc_${expr.kind}`, id, { OP: expr.op }, { A: valueInput(expr.a, nextId), B: valueInput(expr.b, nextId) });
    case 'and':
    case 'or':
      return blockJson(`fc_${expr.kind}`, id, {}, { A: valueInput(expr.a, nextId), B: valueInput(expr.b, nextId) });
    case 'not':
      return blockJson('fc_not', id, {}, { A: valueInput(expr.a, nextId) });
  }
}

function actionJson(action: ActionBlock, id: string, nextId: NextId): BlocklyBlockJson {
  switch (action.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return blockJson(`fc_${action.kind}`, id);
    case 'turn':
      return blockJson('fc_turn', id, { SIDE: action.side });
    case 'plant':
      return blockJson('fc_plant', id, { CROP: action.cropId });
    case 'take':
      return blockJson('fc_take', id, {}, { ITEM: valueInput(action.item, nextId) });
    case 'say':
      return blockJson('fc_say', id, {}, { TEXT: valueInput(action.text, nextId) });
    case 'wait':
      return blockJson('fc_wait', id, {}, { MINUTES: valueInput(action.minutes, nextId) });
  }
}

function statementJson(statement: Statement, nextId: NextId): BlocklyBlockJson {
  const id = nextId();
  switch (statement.kind) {
    case 'do':
      return actionJson(statement.action, id, nextId);
    case 'repeatTimes':
      return blockJson('fc_repeatTimes', id, {}, withList({ TIMES: valueInput(statement.times, nextId) }, 'DO', statement.body, nextId));
    case 'repeatUntil':
      return blockJson('fc_repeatUntil', id, {}, withList({ UNTIL: valueInput(statement.until, nextId) }, 'DO', statement.body, nextId));
    case 'repeatForever':
      return blockJson('fc_repeatForever', id, {}, withList({}, 'DO', statement.body, nextId));
    case 'if': {
      const inputs = withList({ COND: valueInput(statement.cond, nextId) }, 'THEN', statement.then, nextId);
      if (statement.else === null) return blockJson('fc_if', id, {}, inputs);
      return blockJson('fc_ifElse', id, {}, withList(inputs, 'ELSE', statement.else, nextId));
    }
    case 'forEachTile':
      return blockJson('fc_forEachTile', id, { ZONE: statement.zone }, withList({}, 'DO', statement.body, nextId));
    case 'goTo':
      return blockJson('fc_goTo', id, {}, { TILE: valueInput(statement.tile, nextId) });
    case 'set':
      return blockJson('fc_set', id, { VAR: statement.name }, { VALUE: valueInput(statement.value, nextId) });
    case 'change':
      return blockJson('fc_change', id, { VAR: statement.name }, { BY: valueInput(statement.by, nextId) });
    case 'runHelper':
      return blockJson('fc_runHelper', id, { NAME: statement.name });
  }
}

function triggerFields(trigger: Trigger): Fields {
  switch (trigger.kind) {
    case 'atTime':
      return { MINUTE: String(trigger.minute) };
    case 'every':
      return { MINUTES: String(trigger.minutes) };
    default:
      return {};
  }
}

/**
 * The workspace for `program`: variable declarations, then trigger stacks, then helpers, each in
 * program order, at x 0 and y index × ROBOT_SCREEN.stackGap (the Program tab re-spaces them by
 * their rendered height after loading). Block ids are b1, b2, … depth first (a block, then its
 * inputs in order, then the block after it), so the same program always gives the same JSON.
 */
export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson {
  let made = 0;
  const nextId: NextId = () => `b${++made}`;
  const vars = program.vars.map((decl) => {
    const id = nextId();
    return blockJson('fc_varDecl', id, { NAME: decl.name, TYPE: decl.type }, { INITIAL: valueInput(decl.initial, nextId) });
  });
  const stacks = program.stacks.map((stack) => {
    const id = nextId();
    return blockJson(`fc_${stack.trigger.kind}`, id, triggerFields(stack.trigger), withList({}, 'DO', stack.body, nextId));
  });
  const helpers = program.helpers.map((helper) => {
    const id = nextId();
    return blockJson('fc_helper', id, { NAME: helper.name }, withList({}, 'DO', helper.body, nextId));
  });
  const blocks = [...vars, ...stacks, ...helpers].map((block, index) => ({ ...block, x: 0, y: index * ROBOT_SCREEN.stackGap }));
  return { blocks: { languageVersion: 0, blocks } };
}

// --- Workspace → program ------------------------------------------------------------------

/** Workspace JSON as it really arrives: anything at all. */
type Raw = Readonly<Record<string, unknown>>;

/** A block read from the workspace: its type and id checked, the rest still raw. */
interface Node {
  readonly type: string;
  readonly id: string;
  readonly raw: Raw;
}

/** A translation error on its way out of the reader; workspaceToProgram catches it. */
class Untranslatable {
  readonly error: string;
  readonly blockId: string | null;

  constructor(error: string, blockId: string | null) {
    this.error = error;
    this.blockId = blockId;
  }
}

function fail(error: string, blockId: string | null): never {
  throw new Untranslatable(error, blockId);
}

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The top-level block list; [] when the workspace has none, null when it isn't workspace JSON. */
function topBlocks(json: unknown): readonly unknown[] | null {
  if (!isRaw(json)) return null;
  const { blocks } = json;
  if (blocks === undefined) return [];
  if (!isRaw(blocks)) return null;
  const list = blocks.blocks;
  if (list === undefined) return [];
  return Array.isArray(list) ? list : null;
}

/** What an input or `next` holds: its block, else its shadow, else undefined. */
function slotContent(slot: unknown): unknown {
  if (!isRaw(slot)) return undefined;
  const content = slot.block ?? slot.shadow;
  return content === null ? undefined : content;
}

function inputContent(at: Node, name: string): unknown {
  const inputs = at.raw.inputs;
  return isRaw(inputs) ? slotContent(inputs[name]) : undefined;
}

function fieldOf(at: Node, name: string): unknown {
  const fields = at.raw.fields;
  return isRaw(fields) ? fields[name] : undefined;
}

function textField(at: Node, name: string): string {
  const value = fieldOf(at, name);
  return typeof value === 'string' ? value : fail(MISSING_SETTING, at.id);
}

/** A finite number, saved as a number or as its own decimal text ("583", not "0583" or "nine"). */
function numberField(at: Node, name: string): number {
  const value = fieldOf(at, name);
  const n = typeof value === 'string' && String(Number(value)) === value ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fail(MISSING_SETTING, at.id);
}

function choiceField<T extends string>(at: Node, name: string, choices: readonly T[]): T {
  const value = fieldOf(at, name);
  return choices.find((choice) => choice === value) ?? fail(MISSING_SETTING, at.id);
}

function itemField(at: Node, name: string): ItemId {
  const value = fieldOf(at, name);
  return isItemId(value) ? value : fail(MISSING_SETTING, at.id);
}

function everyField(at: Node): (typeof EVERY_CHOICES)[number] {
  const minutes = numberField(at, 'MINUTES');
  return EVERY_CHOICES.find((choice) => choice === minutes) ?? fail(MISSING_SETTING, at.id);
}

/** The trigger a top-level block starts, or null when it isn't a trigger block. */
function triggerOf(at: Node): Trigger | null {
  switch (at.type) {
    case 'fc_morning':
      return { kind: 'morning' };
    case 'fc_atTime':
      return { kind: 'atTime', minute: numberField(at, 'MINUTE') };
    case 'fc_bagFull':
      return { kind: 'bagFull' };
    case 'fc_startsRaining':
      return { kind: 'startsRaining' };
    case 'fc_every':
      return { kind: 'every', minutes: everyField(at) };
    default:
      return null;
  }
}

const act = (action: ActionBlock): Statement => ({ kind: 'do', action });

interface TranslatedProgram {
  readonly program: BlockProgram;
  readonly loose: readonly string[];
}

/** One translation. It refuses a block met twice: a cycle, or one node shared by two parents. */
class WorkspaceReader {
  private readonly seen = new Set<Raw>();

  read(json: unknown): TranslatedProgram {
    const vars: VarDecl[] = [];
    const stacks: TriggerStack[] = [];
    const helpers: HelperDef[] = [];
    const loose: string[] = [];
    for (const content of topBlocks(json) ?? fail(NOT_A_BLOCK, null)) {
      const at = this.node(content);
      const trigger = triggerOf(at);
      if (trigger !== null) {
        stacks.push({ trigger, body: this.list(at, 'DO') });
      } else if (at.type === 'fc_helper') {
        helpers.push({ name: textField(at, 'NAME'), body: this.list(at, 'DO') });
      } else if (at.type === 'fc_varDecl') {
        vars.push({ name: textField(at, 'NAME'), type: choiceField(at, 'TYPE', VALUE_TYPES), initial: this.value(at, 'INITIAL') });
      } else if (KNOWN_TYPES.has(at.type)) {
        loose.push(at.id);
        continue;
      } else {
        return fail(NOT_A_BLOCK, at.id);
      }
      // Nothing goes below a stack, a helper or a declaration: a block chained there is loose.
      const chained = slotContent(at.raw.next);
      if (chained !== undefined) loose.push(this.node(chained).id);
    }
    return { program: { kind: 'blocks', vars, stacks, helpers }, loose };
  }

  private node(content: unknown): Node {
    const raw = isRaw(content) ? content : null;
    const type = raw?.type;
    const id = raw?.id;
    if (raw === null || typeof type !== 'string' || typeof id !== 'string' || this.seen.has(raw)) {
      return fail(NOT_A_BLOCK, typeof id === 'string' ? id : null);
    }
    this.seen.add(raw);
    return { type, id, raw };
  }

  private value(at: Node, name: string): Expr {
    const content = inputContent(at, name);
    return content === undefined ? fail(FILL_SLOT, at.id) : this.expr(this.node(content));
  }

  /** A statement input's list: its first block, then each `next`. An empty input is an empty list. */
  private list(at: Node, name: string): Statement[] {
    const list: Statement[] = [];
    let content = inputContent(at, name);
    while (content !== undefined) {
      const statement = this.node(content);
      list.push(this.statement(statement));
      content = slotContent(statement.raw.next);
    }
    return list;
  }

  private statement(at: Node): Statement {
    switch (at.type) {
      case 'fc_move':
        return act({ kind: 'move' });
      case 'fc_turn':
        return act({ kind: 'turn', side: choiceField(at, 'SIDE', SIDES) });
      case 'fc_water':
        return act({ kind: 'water' });
      case 'fc_harvest':
        return act({ kind: 'harvest' });
      case 'fc_till':
        return act({ kind: 'till' });
      case 'fc_plant':
        return act({ kind: 'plant', cropId: choiceField(at, 'CROP', CROP_IDS) });
      case 'fc_refill':
        return act({ kind: 'refill' });
      case 'fc_deposit':
        return act({ kind: 'deposit' });
      case 'fc_take':
        return act({ kind: 'take', item: this.value(at, 'ITEM') });
      case 'fc_say':
        return act({ kind: 'say', text: this.value(at, 'TEXT') });
      case 'fc_wait':
        return act({ kind: 'wait', minutes: this.value(at, 'MINUTES') });
      case 'fc_powerDown':
        return act({ kind: 'powerDown' });
      case 'fc_if':
        return { kind: 'if', cond: this.value(at, 'COND'), then: this.list(at, 'THEN'), else: null };
      case 'fc_ifElse':
        return { kind: 'if', cond: this.value(at, 'COND'), then: this.list(at, 'THEN'), else: this.list(at, 'ELSE') };
      case 'fc_repeatTimes':
        return { kind: 'repeatTimes', times: this.value(at, 'TIMES'), body: this.list(at, 'DO') };
      case 'fc_repeatUntil':
        return { kind: 'repeatUntil', until: this.value(at, 'UNTIL'), body: this.list(at, 'DO') };
      case 'fc_repeatForever':
        return { kind: 'repeatForever', body: this.list(at, 'DO') };
      case 'fc_forEachTile':
        return { kind: 'forEachTile', zone: choiceField(at, 'ZONE', ZONE_IDS), body: this.list(at, 'DO') };
      case 'fc_goTo':
        return { kind: 'goTo', tile: this.value(at, 'TILE') };
      case 'fc_set':
        return { kind: 'set', name: textField(at, 'VAR'), value: this.value(at, 'VALUE') };
      case 'fc_change':
        return { kind: 'change', name: textField(at, 'VAR'), by: this.value(at, 'BY') };
      case 'fc_runHelper':
        return { kind: 'runHelper', name: textField(at, 'NAME') };
      default:
        return fail(NOT_A_BLOCK, at.id);
    }
  }

  private expr(at: Node): Expr {
    switch (at.type) {
      case 'fc_num':
        return { kind: 'num', value: numberField(at, 'NUM') };
      case 'fc_text':
        return { kind: 'text', value: textField(at, 'TEXT') };
      case 'fc_yes':
        return { kind: 'yes', value: choiceField(at, 'VALUE', YES_NO) === 'TRUE' };
      case 'fc_item':
        return { kind: 'item', itemId: itemField(at, 'ITEM') };
      case 'fc_tile':
        return { kind: 'tile', tx: numberField(at, 'X'), tz: numberField(at, 'Z') };
      case 'fc_var':
        return { kind: 'var', name: textField(at, 'VAR') };
      case 'fc_myTile':
        return { kind: 'myTile' };
      case 'fc_tileAhead':
        return { kind: 'tileAhead' };
      case 'fc_tokensLeft':
        return { kind: 'tokensLeft' };
      case 'fc_countInBag':
        return { kind: 'countInBag', itemId: itemField(at, 'ITEM') };
      case 'fc_arith':
        return { kind: 'arith', op: choiceField(at, 'OP', ARITH_OPS), a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_compare':
        return { kind: 'compare', op: choiceField(at, 'OP', COMPARE_OPS), a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_and':
        return { kind: 'and', a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_or':
        return { kind: 'or', a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_not':
        return { kind: 'not', a: this.value(at, 'A') };
      case 'fc_cropIsReady':
        return { kind: 'cropIsReady' };
      case 'fc_soilIsDry':
        return { kind: 'soilIsDry' };
      case 'fc_tileIsTilled':
        return { kind: 'tileIsTilled' };
      case 'fc_cropIs':
        return { kind: 'cropIs', cropId: choiceField(at, 'CROP', CROP_IDS) };
      case 'fc_bagIsFull':
        return { kind: 'bagIsFull' };
      case 'fc_bagHas':
        return { kind: 'bagHas', itemId: itemField(at, 'ITEM') };
      case 'fc_atEdgeOf':
        return { kind: 'atEdgeOf', zone: choiceField(at, 'ZONE', ZONE_IDS) };
      case 'fc_tokensBelow':
        return { kind: 'tokensBelow', n: this.value(at, 'N') };
      case 'fc_tileAheadIs':
        return { kind: 'tileAheadIs', what: choiceField(at, 'WHAT', TILE_AHEAD) };
      case 'fc_itIsRaining':
        return { kind: 'itIsRaining' };
      case 'fc_timeIsAfter':
        return { kind: 'timeIsAfter', minute: numberField(at, 'MINUTE') };
      default:
        return fail(NOT_A_BLOCK, at.id);
    }
  }
}

/**
 * The program a workspace holds, and the ids of its loose top-level blocks (any block that isn't a
 * trigger, `fc_helper` or `fc_varDecl`, plus a block chained under one of those). Each kind is
 * read in its order in `blocks.blocks`; `variables` is ignored. Never throws: an unknown block
 * type, a field missing or of the wrong kind, an empty value slot, or input that isn't workspace
 * JSON at all (including a cycle, a shared node, or nesting too deep to read) gives
 * `{ error, blockId }`, naming the block when there is one.
 */
export function workspaceToProgram(json: BlocklyWorkspaceJson): TranslationResult {
  try {
    return new WorkspaceReader().read(json);
  } catch (thrown) {
    if (thrown instanceof Untranslatable) return { error: thrown.error, blockId: thrown.blockId };
    return { error: NOT_A_BLOCK, blockId: null };
  }
}

/**
 * Blocks in a workspace the way blockCount counts a program: literals and variable declarations 0
 * (and everything under a declaration's starting value, which blockCount never reads), every other
 * block 1, loose blocks and unfilled slots included, so the editor's counter works mid-edit. A slot's shadow counts only when it holds no block. Never throws; iterative, so any
 * depth is fine, and each block object counts once.
 */
export function countWorkspaceBlocks(json: BlocklyWorkspaceJson): number {
  const pending: unknown[] = [...(topBlocks(json) ?? [])];
  const seen = new Set<Raw>();
  let count = 0;
  while (pending.length > 0) {
    const block = pending.pop();
    if (!isRaw(block) || seen.has(block)) continue;
    seen.add(block);
    if (typeof block.type === 'string' && !FREE_BLOCKS.has(block.type)) count++;
    if (block.type === 'fc_varDecl') continue;
    const inputs = block.inputs;
    if (isRaw(inputs)) for (const slot of Object.values(inputs)) pending.push(slotContent(slot));
    pending.push(slotContent(block.next));
  }
  return count;
}
