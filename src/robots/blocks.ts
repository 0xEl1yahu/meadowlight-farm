/**
 * The block builder (farmclaws part 2 spec §13): tiny constructors for programs as data, used by
 * tests, the dev console and later the preloaded job programs. Pure. It only builds data;
 * whether a program is valid is checkProgram's job.
 */
import type {
  ActionBlock,
  BlockProgram,
  CropId,
  EVERY_CHOICES,
  Expr,
  HelperDef,
  ItemId,
  Statement,
  Trigger,
  TriggerStack,
  VarDecl,
  ZoneId,
} from '../core/types';

/** A number where an expression is expected becomes a number literal. */
type NumberLike = Expr | number;

const num = (value: NumberLike): Expr => (typeof value === 'number' ? { kind: 'num', value } : value);
const act = (action: ActionBlock): Statement => ({ kind: 'do', action });

export const b = {
  // programs
  program: (parts: { readonly vars?: readonly VarDecl[]; readonly stacks: readonly TriggerStack[]; readonly helpers?: readonly HelperDef[] }): BlockProgram => ({
    kind: 'blocks',
    vars: parts.vars ?? [],
    stacks: parts.stacks,
    helpers: parts.helpers ?? [],
  }),
  when: (trigger: Trigger, ...body: Statement[]): TriggerStack => ({ trigger, body }),
  helper: (name: string, ...body: Statement[]): HelperDef => ({ name, body }),

  // triggers
  morning: (): Trigger => ({ kind: 'morning' }),
  atTime: (minute: number): Trigger => ({ kind: 'atTime', minute }),
  bagFull: (): Trigger => ({ kind: 'bagFull' }),
  startsRaining: (): Trigger => ({ kind: 'startsRaining' }),
  every: (minutes: (typeof EVERY_CHOICES)[number]): Trigger => ({ kind: 'every', minutes }),

  // action statements
  move: (): Statement => act({ kind: 'move' }),
  turn: (side: 'left' | 'right'): Statement => act({ kind: 'turn', side }),
  water: (): Statement => act({ kind: 'water' }),
  harvest: (): Statement => act({ kind: 'harvest' }),
  till: (): Statement => act({ kind: 'till' }),
  plant: (cropId: CropId): Statement => act({ kind: 'plant', cropId }),
  refill: (): Statement => act({ kind: 'refill' }),
  deposit: (): Statement => act({ kind: 'deposit' }),
  take: (item: Expr | ItemId): Statement => act({ kind: 'take', item: typeof item === 'string' ? { kind: 'item', itemId: item } : item }),
  say: (text: Expr | string): Statement => act({ kind: 'say', text: typeof text === 'string' ? { kind: 'text', value: text } : text }),
  wait: (minutes: NumberLike): Statement => act({ kind: 'wait', minutes: num(minutes) }),
  powerDown: (): Statement => act({ kind: 'powerDown' }),

  // control statements
  repeat: (times: NumberLike, ...body: Statement[]): Statement => ({ kind: 'repeatTimes', times: num(times), body }),
  repeatUntil: (until: Expr, ...body: Statement[]): Statement => ({ kind: 'repeatUntil', until, body }),
  forever: (...body: Statement[]): Statement => ({ kind: 'repeatForever', body }),
  if: (cond: Expr, then: readonly Statement[], otherwise?: readonly Statement[]): Statement => ({ kind: 'if', cond, then, else: otherwise ?? null }),
  forEach: (zone: ZoneId, ...body: Statement[]): Statement => ({ kind: 'forEachTile', zone, body }),
  goTo: (tile: Expr): Statement => ({ kind: 'goTo', tile }),
  set: (name: string, value: Expr): Statement => ({ kind: 'set', name, value }),
  change: (name: string, by: NumberLike): Statement => ({ kind: 'change', name, by: num(by) }),
  run: (name: string): Statement => ({ kind: 'runHelper', name }),

  // literals and values
  n: (value: number): Expr => ({ kind: 'num', value }),
  text: (value: string): Expr => ({ kind: 'text', value }),
  yes: (value: boolean): Expr => ({ kind: 'yes', value }),
  item: (itemId: ItemId): Expr => ({ kind: 'item', itemId }),
  tileAt: (tx: number, tz: number): Expr => ({ kind: 'tile', tx, tz }),
  v: (name: string): Expr => ({ kind: 'var', name }),
  myTile: (): Expr => ({ kind: 'myTile' }),
  tileAhead: (): Expr => ({ kind: 'tileAhead' }),
  tokensLeft: (): Expr => ({ kind: 'tokensLeft' }),
  countInBag: (itemId: ItemId): Expr => ({ kind: 'countInBag', itemId }),
  add: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '+', a: num(a), b: num(b) }),
  sub: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '-', a: num(a), b: num(b) }),
  mul: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '×', a: num(a), b: num(b) }),
  eq: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '=', a: num(a), b: num(b) }),
  ne: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '≠', a: num(a), b: num(b) }),
  lt: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '<', a: num(a), b: num(b) }),
  gt: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '>', a: num(a), b: num(b) }),
  and: (a: Expr, b: Expr): Expr => ({ kind: 'and', a, b }),
  or: (a: Expr, b: Expr): Expr => ({ kind: 'or', a, b }),
  not: (a: Expr): Expr => ({ kind: 'not', a }),

  // sensors
  cropIsReady: (): Expr => ({ kind: 'cropIsReady' }),
  soilIsDry: (): Expr => ({ kind: 'soilIsDry' }),
  tileIsTilled: (): Expr => ({ kind: 'tileIsTilled' }),
  cropIs: (cropId: CropId): Expr => ({ kind: 'cropIs', cropId }),
  bagIsFull: (): Expr => ({ kind: 'bagIsFull' }),
  bagHas: (itemId: ItemId): Expr => ({ kind: 'bagHas', itemId }),
  atEdgeOf: (zone: ZoneId): Expr => ({ kind: 'atEdgeOf', zone }),
  tokensBelow: (n: NumberLike): Expr => ({ kind: 'tokensBelow', n: num(n) }),
  tileAheadIs: (what: 'water' | 'blocked' | 'clear'): Expr => ({ kind: 'tileAheadIs', what }),
  itIsRaining: (): Expr => ({ kind: 'itIsRaining' }),
  timeIsAfter: (minute: number): Expr => ({ kind: 'timeIsAfter', minute }),

  // variable declarations
  numVar: (name: string, value: number): VarDecl => ({ name, type: 'number', initial: { kind: 'num', value } }),
  textVar: (name: string, value: string): VarDecl => ({ name, type: 'text', initial: { kind: 'text', value } }),
  yesVar: (name: string, value: boolean): VarDecl => ({ name, type: 'yesNo', initial: { kind: 'yes', value } }),
  itemVar: (name: string, itemId: ItemId): VarDecl => ({ name, type: 'item', initial: { kind: 'item', itemId } }),
  tileVar: (name: string, tx: number, tz: number): VarDecl => ({ name, type: 'tile', initial: { kind: 'tile', tx, tz } }),
};
