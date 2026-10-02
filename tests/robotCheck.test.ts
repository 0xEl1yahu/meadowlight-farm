/**
 * The checker (farmclaws part 2 spec §4) and the program helpers it stands on: one fault at a
 * time with its exact message, block counting (literals free), frame depth, the .MD rules and
 * zone rectangles.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { ZONE_IDS, type BlockProgram, type MdCard, type RobotPartId, type RobotScript, type RobotSize, type Statement, type VarDecl } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram, isValidZoneRect, typeOf } from '../src/robots/check';
import { blockCount, farmContains, isLiteral, literalValue, resolveList, statementDepth } from '../src/robots/program';

const body = (size: RobotSize, parts: readonly RobotPartId[] = []) => ({ size, parts });
/** Big robots have room for everything, so a fault test trips only the rule under test. */
const BIG = body('big');
const one = (...statements: Statement[]): BlockProgram => b.program({ stacks: [b.when(b.morning(), ...statements)] });
const withVars = (vars: VarDecl[], ...statements: Statement[]): BlockProgram => b.program({ vars, stacks: [b.when(b.morning(), ...statements)] });
const moves = (count: number): Statement[] => Array.from({ length: count }, () => b.move());
const check = (program: BlockProgram) => checkProgram(program, BIG);

describe('checkProgram: scripts', () => {
  const script = (steps: RobotScript['steps']): RobotScript => ({ kind: 'script', steps, loop: true });

  it('accepts a part 1 script', () => {
    expect(checkProgram(script([{ kind: 'move' }, { kind: 'wait', minutes: 30 }]), body('mini'))).toBeNull();
  });

  it.each([
    ['empty', script([])],
    ['too long', script(Array.from({ length: ROBOTS.maxScriptSteps + 1 }, () => ({ kind: 'move' as const })))],
    ['with an invalid step', script([{ kind: 'wait', minutes: 0 }])],
  ])('rejects a script that is %s', (_label, program) => {
    expect(checkProgram(program, body('mini'))).toBe('That program is not a valid script.');
  });
});

describe('checkProgram: shape', () => {
  it('needs 1 to maxStacks trigger stacks', () => {
    const stacks = (count: number) => b.program({ stacks: Array.from({ length: count }, () => b.when(b.morning(), b.move())) });
    expect(check(stacks(0))).toBe('A program needs 1 to 8 trigger stacks.');
    expect(check(stacks(ROBOTS.maxStacks + 1))).toBe('A program needs 1 to 8 trigger stacks.');
    expect(check(stacks(ROBOTS.maxStacks))).toBeNull();
  });

  it('needs valid, unique variable names', () => {
    const invalid = 'Variable names are 1 to 16 characters, with no spaces at either end.';
    expect(check(withVars([b.numVar('rows', 1), b.numVar('rows', 2)]))).toBe('Two variables are called "rows".');
    expect(check(withVars([b.numVar('', 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar(' rows', 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar('a'.repeat(ROBOTS.maxIdentifierLength + 1), 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar('a'.repeat(ROBOTS.maxIdentifierLength), 1)]))).toBeNull();
  });

  it('needs valid, unique helper names', () => {
    const helpers = (...names: string[]) => b.program({ stacks: [b.when(b.morning(), b.move())], helpers: names.map((name) => b.helper(name, b.move())) });
    expect(check(helpers('spin', 'spin'))).toBe('Two helpers are called "spin".');
    expect(check(helpers('spin '))).toBe('Helper names are 1 to 16 characters, with no spaces at either end.');
    expect(check(helpers('spin', 'hop'))).toBeNull();
  });

  it('needs every variable it reads, sets or changes to be declared', () => {
    expect(check(withVars([b.numVar('rows', 1)], b.set('rows', b.v('cols'))))).toBe('There\'s no variable called "cols".');
    expect(check(one(b.set('cols', b.n(1))))).toBe('There\'s no variable called "cols".');
    expect(check(one(b.change('cols', 1)))).toBe('There\'s no variable called "cols".');
  });

  it('needs every helper it runs to exist', () => {
    expect(check(one(b.run('dance')))).toBe('There\'s no helper called "dance".');
  });

  it('refuses helpers that end up running themselves', () => {
    const cycle = b.program({ stacks: [b.when(b.morning(), b.run('a'))], helpers: [b.helper('a', b.run('b')), b.helper('b', b.run('a'))] });
    expect(check(cycle)).toBe('Helper "a" ends up running itself.');
    const self = b.program({ stacks: [b.when(b.morning(), b.run('x'))], helpers: [b.helper('x', b.move(), b.run('x'))] });
    expect(check(self)).toBe('Helper "x" ends up running itself.');
    const chain = b.program({ stacks: [b.when(b.morning(), b.run('a'), b.run('b'))], helpers: [b.helper('a', b.run('b')), b.helper('b', b.move())] });
    expect(check(chain)).toBeNull();
  });

  it('keeps tile literals on the farm', () => {
    expect(check(one(b.goTo(b.tileAt(48, 0))))).toBe("Tile (48, 0) isn't on the farm.");
    expect(check(one(b.goTo(b.tileAt(0, -1))))).toBe("Tile (0, -1) isn't on the farm.");
    expect(check(withVars([b.tileVar('home', 3, 40)]))).toBe("Tile (3, 40) isn't on the farm.");
    expect(check(one(b.goTo(b.tileAt(47, 39))))).toBeNull();
  });

  it('keeps times within the robot day', () => {
    const at = (minute: number) => b.program({ stacks: [b.when(b.atTime(minute), b.move())] });
    expect(check(at(TIME.dayStartMinute - 1))).toBe("That time is outside the robot's day.");
    expect(check(at(TIME.passOutMinute))).toBe("That time is outside the robot's day.");
    expect(check(at(TIME.dayStartMinute))).toBeNull();
    expect(check(at(TIME.passOutMinute - 1))).toBeNull();
    const after = (minute: number) => checkProgram(one(b.if(b.timeIsAfter(minute), [b.move()])), body('big', ['sensorEye']));
    expect(after(TIME.dayStartMinute - 1)).toBe("That time is outside the robot's day.");
    expect(after(TIME.passOutMinute)).toBe("That time is outside the robot's day.");
    expect(after(18 * 60)).toBeNull();
  });

  it('only allows the listed Every choices', () => {
    expect(check(b.program({ stacks: [b.when(b.every(7 as never), b.move())] }))).toBe('Every can only be 5, 10, 15, 30, 60 minutes.');
    for (const minutes of ROBOTS.everyChoices) expect(check(b.program({ stacks: [b.when(b.every(minutes), b.move())] }))).toBeNull();
  });

  it('keeps number literals whole and within ±maxNumber', () => {
    const message = 'Numbers must be whole and within ±999999.';
    expect(check(one(b.wait(b.n(ROBOTS.maxNumber + 1))))).toBe(message);
    expect(check(one(b.wait(b.n(-ROBOTS.maxNumber - 1))))).toBe(message);
    expect(check(one(b.wait(b.n(2.5))))).toBe(message);
    expect(check(one(b.wait(b.n(ROBOTS.maxNumber)), b.wait(b.n(-ROBOTS.maxNumber))))).toBeNull();
  });

  it('keeps Say literals 1 to sayMaxLength characters once trimmed', () => {
    expect(check(one(b.say('   ')))).toBe('Say needs something to say.');
    expect(check(one(b.say('a'.repeat(ROBOTS.sayMaxLength + 1))))).toBe('Say can say at most 60 characters.');
    expect(check(one(b.say(`  ${'a'.repeat(ROBOTS.sayMaxLength - 4)}  `)))).toBeNull();
  });

  it('keeps other text literals within maxTextLength', () => {
    expect(check(withVars([b.textVar('note', 'a'.repeat(ROBOTS.maxTextLength + 1))]))).toBe('Text holds at most 60 characters.');
    expect(check(withVars([b.textVar('note', '')]))).toBeNull();
  });

  it('reports shape problems before type problems', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.repeat(b.text('3'))), b.when(b.bagFull(), b.set('cols', b.n(1)))] });
    expect(check(program)).toBe('There\'s no variable called "cols".');
  });
});

describe('checkProgram: types', () => {
  const rows = b.numVar('rows', 3);
  const cases: readonly [string, BlockProgram, string][] = [
    ['Repeat with text', one(b.repeat(b.text('3'), b.move())), 'Repeat needs a number.'],
    ['Repeat until with a number', one(b.repeatUntil(b.n(1), b.move())), 'Repeat until needs a yes or no.'],
    ['If with a number', one(b.if(b.n(1), [b.move()])), 'If needs a yes or no.'],
    ['< on items', one(b.if(b.lt(b.item('parsnip'), b.item('wood')), [b.move()])), '< and > need two numbers.'],
    ['= mixing types', one(b.if(b.eq(b.n(1), b.text('1')), [b.move()])), '= and ≠ need two values of the same type.'],
    ['+ with a yes/no', one(b.wait(b.add(b.yes(true), 1))), '+, - and × need two numbers.'],
    ['And with a number', one(b.if(b.and(b.n(1), b.yes(true)), [b.move()])), 'And and Or need two yes-or-no values.'],
    ['Not with a tile', one(b.if(b.not(b.myTile()), [b.move()])), 'Not needs a yes-or-no value.'],
    ['Set with the wrong type', withVars([rows], b.set('rows', b.text('three'))), 'Set "rows" needs a number.'],
    ['an initial value that is not a literal', withVars([{ name: 'rows', type: 'number', initial: b.tokensLeft() }]), '"rows" must start as a fixed value.'],
    ['an initial value of the wrong type', withVars([{ name: 'rows', type: 'number', initial: b.text('3') }]), '"rows" must start as a number.'],
    ['Tokens below with text', one(b.if(b.tokensBelow(b.text('5')), [b.move()])), 'Tokens below needs a number.'],
    ['Go to with an item', one(b.goTo(b.item('wood'))), 'Go to needs a tile.'],
    ['Take with a number', one(b.take(b.n(3))), 'Take needs an item.'],
    ['Wait with text', one(b.wait(b.text('soon'))), 'Wait needs a number.'],
    ['Say with a number', one(b.say(b.n(5))), 'Say needs text.'],
    ['Change on a text variable', withVars([b.textVar('note', 'hi')], b.change('note', 1)), 'Change only works on number variables.'],
    ['Change by text', withVars([rows], b.change('rows', b.text('1'))), 'Change needs a number.'],
    ['an inner fault inside an outer one', one(b.if(b.not(b.add(b.yes(true), 1)), [b.move()])), '+, - and × need two numbers.'],
  ];

  it.each(cases)('rejects %s', (_label, program, message) => {
    expect(check(program)).toBe(message);
  });

  it('accepts well-typed sockets of every type', () => {
    const program = b.program({
      vars: [rows, b.textVar('note', 'Done'), b.yesVar('busy', false), b.itemVar('seed', 'parsnip_seeds'), b.tileVar('home', 5, 10)],
      stacks: [
        b.when(
          b.morning(),
          b.repeat(b.v('rows'), b.water(), b.move()),
          b.repeatUntil(b.or(b.v('busy'), b.tokensBelow(b.v('rows'))), b.change('rows', b.sub(b.v('rows'), 1))),
          b.if(b.eq(b.myTile(), b.v('home')), [b.say(b.v('note'))], [b.goTo(b.v('home'))]),
          b.if(b.and(b.ne(b.v('seed'), b.item('wood')), b.gt(b.countInBag('parsnip'), b.tokensLeft())), [b.take(b.v('seed'))]),
          b.set('home', b.tileAhead()),
          b.set('busy', b.not(b.bagIsFull())),
          b.wait(b.mul(b.v('rows'), 2)),
        ),
      ],
    });
    expect(check(program)).toBeNull();
  });

  it('types every expression kind', () => {
    const vars = [rows];
    expect(typeOf(b.n(1), vars)).toBe('number');
    expect(typeOf(b.text('hi'), vars)).toBe('text');
    expect(typeOf(b.yes(true), vars)).toBe('yesNo');
    expect(typeOf(b.item('wood'), vars)).toBe('item');
    expect(typeOf(b.tileAt(1, 1), vars)).toBe('tile');
    expect(typeOf(b.v('rows'), vars)).toBe('number');
    expect(typeOf(b.v('cols'), vars)).toBeNull();
    expect([typeOf(b.myTile(), vars), typeOf(b.tileAhead(), vars)]).toEqual(['tile', 'tile']);
    expect([typeOf(b.tokensLeft(), vars), typeOf(b.countInBag('wood'), vars)]).toEqual(['number', 'number']);
    expect([typeOf(b.add(1, 2), vars), typeOf(b.add(b.yes(true), 2), vars)]).toEqual(['number', null]);
    expect([typeOf(b.lt(1, 2), vars), typeOf(b.lt(b.item('wood'), b.item('wood')), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.eq(b.item('wood'), b.item('stone')), vars), typeOf(b.eq(1, b.text('1')), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.and(b.yes(true), b.yes(false)), vars), typeOf(b.not(b.n(1)), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.tokensBelow(5), vars), typeOf(b.tokensBelow(b.text('5')), vars)]).toEqual(['yesNo', null]);
    const sensors = [b.cropIsReady(), b.soilIsDry(), b.tileIsTilled(), b.cropIs('parsnip'), b.bagIsFull(), b.bagHas('wood'), b.atEdgeOf('A'), b.tileAheadIs('water'), b.itIsRaining(), b.timeIsAfter(720)];
    for (const sensor of sensors) expect(typeOf(sensor, vars)).toBe('yesNo');
  });
});

describe('checkProgram: parts', () => {
  it.each([
    ['Tile ahead is', b.tileAheadIs('water')],
    ['It is raining', b.itIsRaining()],
    ['Time is after', b.timeIsAfter(720)],
  ])('needs a sensor eye for "%s"', (name, sensor) => {
    const program = one(b.if(sensor, [b.move()]));
    expect(checkProgram(program, body('mini'))).toBe(`The "${name}" sensor needs a sensor eye.`);
    expect(checkProgram(program, body('mini', ['sensorEye']))).toBeNull();
  });

  it('lets action blocks through without their parts (a run-time noPart mistake)', () => {
    expect(checkProgram(one(b.water(), b.harvest(), b.till()), body('mini'))).toBeNull();
  });
});

describe('checkProgram: limits', () => {
  it.each([
    ['mini', 'Mini robots hold 12 blocks; this program has 13.'],
    ['standard', 'Standard robots hold 30 blocks; this program has 31.'],
    ['big', 'Big robots hold 80 blocks; this program has 81.'],
  ] as const)('holds exactly the block limit of a %s', (size, message) => {
    const limit = ROBOTS.sizes[size].blocks;
    expect(checkProgram(one(...moves(limit - 1)), body(size))).toBeNull();
    expect(checkProgram(one(...moves(limit)), body(size))).toBe(message);
  });

  it.each([
    ['mini', 'Mini robots hold 1 variable; this program has 2.'],
    ['standard', 'Standard robots hold 3 variables; this program has 4.'],
    ['big', 'Big robots hold 6 variables; this program has 7.'],
  ] as const)('holds exactly the variable limit of a %s', (size, message) => {
    const vars = (count: number) => Array.from({ length: count }, (_, i) => b.numVar(`v${i}`, i));
    const limit = ROBOTS.sizes[size].vars;
    expect(checkProgram(withVars(vars(limit), b.move()), body(size))).toBeNull();
    expect(checkProgram(withVars(vars(limit + 1), b.move()), body(size))).toBe(message);
  });

  it('holds frames up to maxFrames deep', () => {
    const nest = (levels: number): Statement => (levels === 0 ? b.move() : b.forever(nest(levels - 1)));
    expect(check(one(nest(ROBOTS.maxFrames - 1)))).toBeNull();
    expect(check(one(nest(ROBOTS.maxFrames)))).toBe('This program nests 17 levels deep; robots keep track of 16.');
  });

  it('counts blocks before variables', () => {
    expect(checkProgram(withVars([b.numVar('a', 1), b.numVar('b', 2)], ...moves(12)), body('mini'))).toBe('Mini robots hold 12 blocks; this program has 13.');
  });
});

describe('valid programs', () => {
  it('passes a program for each size', () => {
    const mini = b.program({ vars: [b.numVar('rows', 3)], stacks: [b.when(b.morning(), b.repeat(b.v('rows'), b.water(), b.move()), b.powerDown())] });
    expect(checkProgram(mini, body('mini', ['wateringHead']))).toBeNull();

    const standard = b.program({
      vars: [b.textVar('note', 'All wet'), b.tileVar('home', 5, 10)],
      stacks: [
        b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.goTo(b.v('home')), b.say(b.v('note'))),
        b.when(b.every(15), b.if(b.itIsRaining(), [b.powerDown()], [b.run('spin')])),
      ],
      helpers: [b.helper('spin', b.turn('right'), b.turn('right'))],
    });
    expect(checkProgram(standard, body('standard', ['wateringHead', 'sensorEye']))).toBeNull();

    const big = b.program({
      vars: [b.numVar('count', 0), b.textVar('note', 'Full'), b.yesVar('done', false), b.itemVar('crop', 'parsnip'), b.tileVar('chest', 9, 12)],
      stacks: [
        b.when(b.morning(), b.repeatUntil(b.or(b.v('done'), b.bagIsFull()), b.run('row'), b.change('count', 1))),
        b.when(b.atTime(18 * 60), b.goTo(b.v('chest')), b.deposit()),
        b.when(b.bagFull(), b.say(b.v('note')), b.run('unload')),
        b.when(b.startsRaining(), b.set('done', b.yes(true))),
        b.when(b.every(60), b.if(b.and(b.timeIsAfter(20 * 60), b.gt(b.v('count'), 3)), [b.powerDown()])),
      ],
      helpers: [
        b.helper('row', b.repeat(6, b.if(b.and(b.cropIsReady(), b.cropIs('parsnip')), [b.harvest()]), b.if(b.tileAheadIs('clear'), [b.move()], [b.turn('left')]))),
        b.helper('unload', b.goTo(b.v('chest')), b.deposit(), b.take(b.item('parsnip_seeds'))),
      ],
    });
    expect(checkProgram(big, body('big', ['claw', 'basket', 'sensorEye']))).toBeNull();
  });
});

describe('blockCount', () => {
  it('counts triggers and statements, and leaves literals free', () => {
    const spec = b.program({ vars: [b.numVar('rows', 3)], stacks: [b.when(b.morning(), b.repeat(3, b.water(), b.move()), b.powerDown())] });
    expect(blockCount(spec)).toBe(5);
    expect(blockCount(one(b.goTo(b.tileAt(5, 10))))).toBe(2);
    expect(blockCount(one(b.goTo(b.myTile())))).toBe(3);
    expect(blockCount(one(b.say('Hello'), b.wait(30), b.turn('left'), b.plant('parsnip')))).toBe(5);
  });

  it('counts helper definitions and every non-literal expression node', () => {
    const helper = b.program({ stacks: [b.when(b.morning(), b.run('turnAround'))], helpers: [b.helper('turnAround', b.turn('right'), b.turn('right'))] });
    expect(blockCount(helper)).toBe(5);
    expect(blockCount(one(b.if(b.and(b.cropIsReady(), b.not(b.bagIsFull())), [b.harvest()], [b.move()])))).toBe(8);
    expect(blockCount(withVars([b.numVar('rows', 3)], b.set('rows', b.add(b.v('rows'), 1))))).toBe(4);
    expect(blockCount(one(b.if(b.tokensBelow(b.add(b.tokensLeft(), 2)), [])))).toBe(5);
  });

  it('does not count variable declarations', () => {
    expect(blockCount(withVars([b.numVar('a', 1), b.tileVar('b', 1, 1)], b.move()))).toBe(blockCount(one(b.move())));
  });
});

describe('statementDepth', () => {
  it('counts the frames each statement can push', () => {
    expect(statementDepth(one(b.move()))).toBe(1);
    expect(statementDepth(one(b.repeat(2, b.move())))).toBe(2);
    expect(statementDepth(one(b.goTo(b.myTile())))).toBe(2);
    // For each tile: its body frame, with a route frame on top while it walks to each tile.
    expect(statementDepth(one(b.forEach('A')))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.water())))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.if(b.soilIsDry(), [b.water()]))))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.if(b.soilIsDry(), [b.goTo(b.myTile())]))))).toBe(4);
    expect(statementDepth(one(b.if(b.yes(true), [b.move()], [b.repeat(2, b.goTo(b.myTile()))])))).toBe(4);
  });

  it('follows helpers through the call chain and takes the deepest stack', () => {
    const program = b.program({
      stacks: [b.when(b.morning(), b.move()), b.when(b.bagFull(), b.repeat(2, b.run('h')))],
      helpers: [b.helper('h', b.if(b.yes(true), [b.goTo(b.myTile())]))],
    });
    expect(statementDepth(program)).toBe(5);
  });
});

describe('program helpers', () => {
  it('tells literals apart and reads their values', () => {
    expect([b.n(1), b.text('a'), b.yes(true), b.item('wood'), b.tileAt(2, 3)].every(isLiteral)).toBe(true);
    expect([b.v('x'), b.myTile(), b.add(1, 2), b.cropIsReady()].some(isLiteral)).toBe(false);
    expect(literalValue(b.n(-4))).toEqual({ type: 'number', value: -4 });
    expect(literalValue(b.text('hi'))).toEqual({ type: 'text', value: 'hi' });
    expect(literalValue(b.yes(false))).toEqual({ type: 'yesNo', value: false });
    expect(literalValue(b.item('wood'))).toEqual({ type: 'item', value: 'wood' });
    expect(literalValue(b.tileAt(2, 3))).toEqual({ type: 'tile', value: { tx: 2, tz: 3 } });
    expect(() => literalValue(b.v('x'))).toThrow(RangeError);
  });

  it('knows the farm tiles', () => {
    expect([farmContains(0, 0), farmContains(47, 39)]).toEqual([true, true]);
    expect([farmContains(48, 0), farmContains(0, 40), farmContains(-1, 0), farmContains(1.5, 2)]).toEqual([false, false, false, false]);
  });

  it('resolves list references, and returns null for any that miss', () => {
    const inner = b.if(b.yes(true), [b.move()], [b.turn('left')]);
    const program = b.program({
      stacks: [b.when(b.morning(), b.repeat(2, inner), b.move(), b.if(b.yes(true), [b.water()]))],
      helpers: [b.helper('h', b.water())],
    });
    const stack = program.stacks[0]!;
    expect(resolveList(program, { root: 'stack', index: 0, path: [] })).toBe(stack.body);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body']] })).toEqual([inner]);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body'], [0, 'then']] })).toEqual([b.move()]);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body'], [0, 'else']] })).toEqual([b.turn('left')]);
    expect(resolveList(program, { root: 'helper', index: 0, path: [] })).toBe(program.helpers[0]!.body);
    expect(resolveList(program, { root: 'stack', index: 1, path: [] })).toBeNull();
    expect(resolveList(program, { root: 'helper', index: 1, path: [] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[1, 'body']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'then']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[2, 'else']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[9, 'body']] })).toBeNull();
  });
});

describe('checkMd', () => {
  /** Eleven distinct cards: one more than the biggest robot holds. */
  const CARDS: readonly MdCard[] = [
    ...ZONE_IDS.map((zone): MdCard => ({ kind: 'dontLeave', zone })),
    { kind: 'dontGoIntoWater' },
    { kind: 'dontHarvest', cropId: 'pumpkin' },
    { kind: 'dontDeposit', itemId: 'wood' },
  ];

  it.each([
    ['mini', 'Mini robots hold 3 .MD cards; this .MD has 4.'],
    ['standard', 'Standard robots hold 6 .MD cards; this .MD has 7.'],
    ['big', 'Big robots hold 10 .MD cards; this .MD has 11.'],
  ] as const)('holds exactly the card limit of a %s', (size, message) => {
    const limit = ROBOTS.sizes[size].mdCards;
    expect(checkMd(CARDS.slice(0, limit), { size })).toBeNull();
    expect(checkMd(CARDS.slice(0, limit + 1), { size })).toBe(message);
  });

  it('keeps DO return tiles on the farm and its minute in the day', () => {
    const home = (tx: number, tz: number, minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });
    expect(checkMd([home(48, 0, 1080)], { size: 'mini' })).toBe("Tile (48, 0) isn't on the farm.");
    expect(checkMd([home(9, 12, 1080)], { size: 'mini' })).toBeNull();
    const generator = (minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'generator' }, minute });
    expect(checkMd([generator(TIME.dayStartMinute - 1)], { size: 'mini' })).toBe("That time is outside the robot's day.");
    expect(checkMd([generator(TIME.passOutMinute)], { size: 'mini' })).toBe("That time is outside the robot's day.");
    expect(checkMd([generator(18 * 60)], { size: 'mini' })).toBeNull();
  });

  it('keeps DO power down below n tokens within 1 … battery', () => {
    const below = (n: number): MdCard => ({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n } });
    expect(checkMd([below(0)], { size: 'mini' })).toBe('Power down below needs a number of tokens from 1 to 80.');
    expect(checkMd([below(81)], { size: 'mini' })).toBe('Power down below needs a number of tokens from 1 to 80.');
    expect(checkMd([below(1)], { size: 'mini' })).toBeNull();
    expect(checkMd([below(80)], { size: 'mini' })).toBeNull();
    expect(checkMd([below(500)], { size: 'big' })).toBeNull();
    expect(checkMd([below(501)], { size: 'big' })).toBe('Power down below needs a number of tokens from 1 to 500.');
  });

  it('refuses the same card twice, whatever its key order', () => {
    expect(checkMd([{ kind: 'dontGoIntoWater' }, { kind: 'dontGoIntoWater' }], { size: 'mini' })).toBe('The .MD has the same card twice.');
    const a: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
    const b2 = { minute: 1080, to: { kind: 'generator' }, kind: 'doReturn' } as MdCard;
    expect(checkMd([a, b2], { size: 'mini' })).toBe('The .MD has the same card twice.');
    expect(checkMd([a, { ...a, minute: 1081 }], { size: 'mini' })).toBeNull();
    expect(checkMd([], { size: 'mini' })).toBeNull();
  });
});

describe('isValidZoneRect', () => {
  it.each([
    [{ x0: 0, z0: 0, w: 48, d: 40 }, true],
    [{ x0: 47, z0: 39, w: 1, d: 1 }, true],
    [{ x0: 3, z0: 9, w: 3, d: 3 }, true],
    [{ x0: 0, z0: 0, w: 49, d: 40 }, false],
    [{ x0: 0, z0: 0, w: 48, d: 41 }, false],
    [{ x0: 46, z0: 0, w: 3, d: 1 }, false],
    [{ x0: -1, z0: 0, w: 2, d: 2 }, false],
    [{ x0: 0, z0: 0, w: 0, d: 3 }, false],
    [{ x0: 0, z0: 0, w: 3, d: 0 }, false],
    [{ x0: 1.5, z0: 0, w: 2, d: 2 }, false],
    [{ x0: 0, z0: 0, w: 2.5, d: 2 }, false],
  ])('%j is %s', (rect, valid) => {
    expect(isValidZoneRect(rect)).toBe(valid);
  });
});
