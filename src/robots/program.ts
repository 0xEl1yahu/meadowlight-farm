/**
 * Structure helpers for block programs (farmclaws part 2 spec §2.3, §2.4, §4). Pure.
 */
import type { ActionBlock, BlockProgram, Expr, ListRef, Statement, Value } from '../core/types';
import { inBounds } from '../world/grid';
import { MAPS } from '../world/maps';

/** Whether (tx, tz) is a tile of the farm (integers inside its grid). */
export function farmContains(tx: number, tz: number): boolean {
  return inBounds(MAPS.farm.grid, tx, tz);
}

/** Literals are the five constant expressions; they count 0 blocks. */
export function isLiteral(expr: Expr): boolean {
  return expr.kind === 'num' || expr.kind === 'text' || expr.kind === 'yes' || expr.kind === 'item' || expr.kind === 'tile';
}

/** The value of a literal. Throws a RangeError for any other expression. */
export function literalValue(expr: Expr): Value {
  switch (expr.kind) {
    case 'num':
      return { type: 'number', value: expr.value };
    case 'text':
      return { type: 'text', value: expr.value };
    case 'yes':
      return { type: 'yesNo', value: expr.value };
    case 'item':
      return { type: 'item', value: expr.itemId };
    case 'tile':
      return { type: 'tile', value: { tx: expr.tx, tz: expr.tz } };
    default:
      throw new RangeError(`literalValue: '${expr.kind}' is not a literal`);
  }
}

/** The expressions directly below `expr` (operands), in order. */
export function exprChildren(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case 'arith':
    case 'compare':
    case 'and':
    case 'or':
      return [expr.a, expr.b];
    case 'not':
      return [expr.a];
    case 'tokensBelow':
      return [expr.n];
    default:
      return [];
  }
}

function actionExprs(action: ActionBlock): readonly Expr[] {
  switch (action.kind) {
    case 'take':
      return [action.item];
    case 'say':
      return [action.text];
    case 'wait':
      return [action.minutes];
    default:
      return [];
  }
}

/** The expressions in a statement's own sockets (not those of its nested statements), in order. */
export function statementExprs(statement: Statement): readonly Expr[] {
  switch (statement.kind) {
    case 'do':
      return actionExprs(statement.action);
    case 'repeatTimes':
      return [statement.times];
    case 'repeatUntil':
      return [statement.until];
    case 'if':
      return [statement.cond];
    case 'goTo':
      return [statement.tile];
    case 'set':
      return [statement.value];
    case 'change':
      return [statement.by];
    default:
      return [];
  }
}

/** The statement lists nested directly in a statement: a loop's body, or an if's then and else. */
export function childLists(statement: Statement): readonly (readonly Statement[])[] {
  switch (statement.kind) {
    case 'repeatTimes':
    case 'repeatUntil':
    case 'repeatForever':
    case 'forEachTile':
      return [statement.body];
    case 'if':
      return statement.else === null ? [statement.then] : [statement.then, statement.else];
    default:
      return [];
  }
}

/** The statement list `ref` names, or null when it doesn't resolve (a missing root, index or branch). */
export function resolveList(program: BlockProgram, ref: ListRef): readonly Statement[] | null {
  const root = ref.root === 'stack' ? program.stacks[ref.index] : program.helpers[ref.index];
  if (root === undefined) return null;
  let list: readonly Statement[] = root.body;
  for (const [index, branch] of ref.path) {
    const statement = list[index];
    if (statement === undefined) return null;
    if (branch === 'body') {
      if (statement.kind !== 'repeatTimes' && statement.kind !== 'repeatUntil' && statement.kind !== 'repeatForever' && statement.kind !== 'forEachTile') {
        return null;
      }
      list = statement.body;
    } else {
      if (statement.kind !== 'if') return null;
      const next = branch === 'then' ? statement.then : statement.else;
      if (next === null) return null;
      list = next;
    }
  }
  return list;
}

function exprBlocks(expr: Expr): number {
  return exprChildren(expr).reduce((sum, child) => sum + exprBlocks(child), isLiteral(expr) ? 0 : 1);
}

function listBlocks(list: readonly Statement[]): number {
  return list.reduce((sum, statement) => sum + statementBlocks(statement), 0);
}

function statementBlocks(statement: Statement): number {
  const exprs = statementExprs(statement).reduce((sum, expr) => sum + exprBlocks(expr), 0);
  return childLists(statement).reduce((sum, list) => sum + listBlocks(list), 1 + exprs);
}

/**
 * Blocks in a program (spec §4): every trigger, statement, helper definition and non-literal
 * expression node is 1; literals, fields inside a block and variable declarations are 0.
 */
export function blockCount(program: BlockProgram): number {
  const stacks = program.stacks.reduce((sum, stack) => sum + 1 + listBlocks(stack.body), 0);
  return program.helpers.reduce((sum, helper) => sum + 1 + listBlocks(helper.body), stacks);
}

/**
 * The deepest frame stack any trigger stack can reach: its body is 1 frame; a loop body, an if
 * branch and a helper body each add a frame; `Go to` adds a route frame; `For each tile` adds its
 * body frame with a route frame on top. Helper calls are followed through the call chain. A
 * helper chain that calls itself has no finite depth (Infinity); the checker rejects it first.
 */
export function statementDepth(program: BlockProgram): number {
  const bodies = new Map(program.helpers.map((helper) => [helper.name, helper.body] as const));
  const helperDepths = new Map<string, number>();
  const visiting = new Set<string>();

  const helperDepth = (name: string): number => {
    const known = helperDepths.get(name);
    if (known !== undefined) return known;
    const body = bodies.get(name);
    if (body === undefined) return 0;
    if (visiting.has(name)) return Number.POSITIVE_INFINITY;
    visiting.add(name);
    const depth = listDepth(body);
    visiting.delete(name);
    helperDepths.set(name, depth);
    return depth;
  };

  const extraDepth = (statement: Statement): number => {
    switch (statement.kind) {
      case 'repeatTimes':
      case 'repeatUntil':
      case 'repeatForever':
        return listDepth(statement.body);
      case 'forEachTile':
        return Math.max(listDepth(statement.body), 2);
      case 'if':
        return Math.max(listDepth(statement.then), statement.else === null ? 0 : listDepth(statement.else));
      case 'goTo':
        return 1;
      case 'runHelper':
        return helperDepth(statement.name);
      default:
        return 0;
    }
  };

  const listDepth = (list: readonly Statement[]): number => 1 + list.reduce((deepest, statement) => Math.max(deepest, extraDepth(statement)), 0);

  return program.stacks.reduce((deepest, stack) => Math.max(deepest, listDepth(stack.body)), 0);
}
