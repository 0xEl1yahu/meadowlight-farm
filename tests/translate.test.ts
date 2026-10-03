/**
 * The workspace translator (farmclaws part 3 spec §5): every block type round-trips, so do the
 * design's job programs and 300 generated ones, with countWorkspaceBlocks matching blockCount.
 * Values outside the editor's menus survive, shadows read as blocks, loose blocks are reported,
 * every malformed workspace becomes { error, blockId } without throwing, and the module never
 * imports Blockly.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_SCREEN, ROBOTS } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { CROP_IDS, EVERY_CHOICES, ZONE_IDS, type BlockProgram, type Expr, type Statement } from '../src/core/types';
import { ITEMS } from '../src/items/items';
import { BLOCK_KINDS } from '../src/robots/blockKinds';
import { b } from '../src/robots/blocks';
import { checkProgram } from '../src/robots/check';
import { blockCount } from '../src/robots/program';
import {
  BLOCK_TYPES,
  blockTypeFor,
  countWorkspaceBlocks,
  programToWorkspace,
  workspaceToProgram,
  type BlocklyBlockJson,
  type BlocklyInputJson,
  type BlocklyWorkspaceJson,
} from '../src/ui/robotScreen/translate';
import translateSource from '../src/ui/robotScreen/translate.ts?raw';
import { SAFETY_BODY, randomProgram } from './programGen';
import { HEAVY_TEST_TIMEOUT_MS, Violations, must } from './testUtils';

const FILL = 'Fill every empty slot.';
const NOT_A_BLOCK = "This block isn't part of the robot language.";
const MISSING = 'This block is missing a setting.';
const GENERATED = 300;
/** Nesting far deeper than any recursive reader can follow. */
const DEEP = 200_000;

const on = (...body: Statement[]): BlockProgram => b.program({ stacks: [b.when(b.morning(), ...body)] });
const sensing = (cond: Expr): BlockProgram => on(b.if(cond, [b.move()]));

/** The program is one the checker accepts (on a Big robot with every part), and survives the trip both ways. */
function expectRoundTrip(program: BlockProgram): void {
  expect(checkProgram(program, SAFETY_BODY)).toBeNull();
  const json = programToWorkspace(program);
  expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
  expect(countWorkspaceBlocks(json)).toBe(blockCount(program));
}

/** Every block of a workspace, depth first: a block, its inputs in order (block, else shadow), then its next. */
function allBlocks(json: BlocklyWorkspaceJson): BlocklyBlockJson[] {
  const out: BlocklyBlockJson[] = [];
  const visit = (block: BlocklyBlockJson | undefined): void => {
    if (block === undefined) return;
    out.push(block);
    for (const input of Object.values(block.inputs ?? {})) visit(input.block ?? input.shadow);
    visit(block.next?.block ?? block.next?.shadow);
  };
  for (const block of json.blocks?.blocks ?? []) visit(block);
  return out;
}

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `b${i + 1}`);

/** The same block with everything below it (inputs and next) moved from `block` to `shadow`. */
function shadowed(block: BlocklyBlockJson): BlocklyBlockJson {
  const below = (slot: BlocklyInputJson): BlocklyInputJson => ({ shadow: shadowed(must(slot.block)) });
  return {
    ...block,
    ...(block.inputs === undefined ? {} : { inputs: Object.fromEntries(Object.entries(block.inputs).map(([name, slot]) => [name, below(slot)])) }),
    ...(block.next === undefined ? {} : { next: below(block.next) }),
  };
}

const ws = (...blocks: BlocklyBlockJson[]): BlocklyWorkspaceJson => ({ blocks: { languageVersion: 0, blocks } });
const block = (type: string, id: string, rest: Omit<BlocklyBlockJson, 'type' | 'id'> = {}): BlocklyBlockJson => ({ type, id, ...rest });
const slot = (child: BlocklyBlockJson): BlocklyInputJson => ({ block: child });
const morning = (body: BlocklyBlockJson): BlocklyBlockJson => block('fc_morning', 'm', { inputs: { DO: slot(body) } });
const num = (id: string, value: number): BlocklyBlockJson => block('fc_num', id, { fields: { NUM: value } });
/** Input that isn't workspace JSON at all, as the screen might be handed it. */
const garbage = (value: unknown): BlocklyWorkspaceJson => value as BlocklyWorkspaceJson;

/** One small program per block type, each using that block. */
const ONE_OF_EACH: Readonly<Record<string, BlockProgram>> = {
  fc_morning: on(b.move()),
  fc_atTime: b.program({ stacks: [b.when(b.atTime(600), b.move())] }),
  fc_bagFull: b.program({ stacks: [b.when(b.bagFull(), b.deposit())] }),
  fc_startsRaining: b.program({ stacks: [b.when(b.startsRaining(), b.powerDown())] }),
  fc_every: b.program({ stacks: [b.when(b.every(15), b.turn('left'))] }),
  fc_repeatTimes: on(b.repeat(3, b.move())),
  fc_repeatUntil: on(b.repeatUntil(b.bagIsFull(), b.harvest())),
  fc_repeatForever: on(b.forever(b.turn('right'))),
  fc_if: on(b.if(b.cropIsReady(), [b.harvest()])),
  fc_ifElse: on(b.if(b.soilIsDry(), [b.water()], [b.move()])),
  fc_forEachTile: on(b.forEach('A', b.water())),
  fc_set: b.program({ vars: [b.tileVar('home', 9, 12)], stacks: [b.when(b.morning(), b.set('home', b.myTile()))] }),
  fc_change: b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.morning(), b.change('n', b.tokensLeft()))] }),
  fc_var: b.program({ vars: [b.numVar('n', 2)], stacks: [b.when(b.morning(), b.repeat(b.v('n'), b.move()))] }),
  fc_varDecl: b.program({ vars: [b.textVar('note', '')], stacks: [b.when(b.morning(), b.say(b.v('note')))] }),
  fc_helper: b.program({ stacks: [b.when(b.morning(), b.move())], helpers: [b.helper('spin', b.turn('right'))] }),
  fc_runHelper: b.program({ stacks: [b.when(b.morning(), b.run('spin'))], helpers: [b.helper('spin', b.turn('left'))] }),
  fc_move: on(b.move()),
  fc_turn: on(b.turn('left'), b.turn('right')),
  fc_goTo: on(b.goTo(b.tileAt(9, 12))),
  fc_water: on(b.water()),
  fc_refill: on(b.refill()),
  fc_harvest: on(b.harvest()),
  fc_deposit: on(b.deposit()),
  fc_take: on(b.take('wood')),
  fc_till: on(b.till()),
  fc_plant: on(b.plant('parsnip')),
  fc_powerDown: on(b.powerDown()),
  fc_wait: on(b.wait(30)),
  fc_say: on(b.say('Beep')),
  fc_cropIsReady: sensing(b.cropIsReady()),
  fc_soilIsDry: sensing(b.soilIsDry()),
  fc_tileIsTilled: sensing(b.tileIsTilled()),
  fc_cropIs: sensing(b.cropIs('pumpkin')),
  fc_bagIsFull: sensing(b.bagIsFull()),
  fc_bagHas: sensing(b.bagHas('parsnip_seeds')),
  fc_atEdgeOf: sensing(b.atEdgeOf('H')),
  fc_tokensBelow: sensing(b.tokensBelow(10)),
  fc_tileAheadIs: sensing(b.tileAheadIs('water')),
  fc_itIsRaining: sensing(b.itIsRaining()),
  fc_timeIsAfter: sensing(b.timeIsAfter(1080)),
  fc_num: on(b.wait(5)),
  fc_text: on(b.say('Hello')),
  fc_yes: b.program({ vars: [b.yesVar('done', false)], stacks: [b.when(b.morning(), b.set('done', b.yes(true)))] }),
  fc_item: on(b.take(b.item('potato'))),
  fc_tile: on(b.goTo(b.tileAt(0, 0))),
  fc_myTile: on(b.if(b.eq(b.myTile(), b.tileAt(9, 12)), [b.move()])),
  fc_tileAhead: on(b.goTo(b.tileAhead())),
  fc_tokensLeft: on(b.wait(b.tokensLeft())),
  fc_countInBag: on(b.wait(b.countInBag('potato'))),
  fc_arith: on(b.wait(b.add(1, b.mul(b.sub(9, 4), 2)))),
  fc_compare: on(b.if(b.and(b.lt(b.tokensLeft(), 10), b.gt(3, 2)), [b.if(b.ne(b.text('a'), b.text('b')), [b.powerDown()])])),
  fc_and: sensing(b.and(b.cropIsReady(), b.soilIsDry())),
  fc_or: sensing(b.or(b.itIsRaining(), b.bagIsFull())),
  fc_not: sensing(b.not(b.bagIsFull())),
};

/** The design's job programs (design §5.2's blocks as §8's jobs use them), built with the block builder. */
const DESIGN_PROGRAMS: Readonly<Record<string, BlockProgram>> = {
  'job 1, the spinner: When morning → Repeat forever → Turn right': b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] }),
  'job 1, rewritten: water a 3×3 bed, then power down': b.program({
    stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.powerDown())],
  }),
  'job 1, with a stop condition: Repeat until tokens left < 10': b.program({
    stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()), b.powerDown())],
  }),
  'job 2, Cosmo\'s robot: Repeat forever → Say "hello chickens"': b.program({ stacks: [b.when(b.morning(), b.forever(b.say('hello chickens')))] }),
  'job 2, rewritten: harvest the field with a sensor and an If': b.program({
    stacks: [
      b.when(
        b.morning(),
        b.forEach('B', b.if(b.cropIsReady(), [b.harvest()], [b.if(b.bagIsFull(), [b.goTo(b.tileAt(9, 6)), b.deposit()])])),
        b.powerDown(),
      ),
    ],
  }),
  'job 3, Barnaby\'s robot: polling Every 10 minutes': b.program({ stacks: [b.when(b.every(10), b.if(b.cropIsReady(), [b.harvest()]), b.move())] }),
  'job 3, split: a morning sweep, a full bag and rain': b.program({
    stacks: [
      b.when(b.morning(), b.forEach('C', b.if(b.and(b.cropIsReady(), b.not(b.bagIsFull())), [b.harvest()])), b.powerDown()),
      b.when(b.bagFull(), b.goTo(b.tileAt(9, 6)), b.deposit()),
      b.when(b.startsRaining(), b.powerDown()),
    ],
  }),
  'job 4: helpers and variables': b.program({
    vars: [b.numVar('rows', 3), b.tileVar('home', 9, 12), b.yesVar('done', false), b.itemVar('seed', 'parsnip_seeds'), b.textVar('note', 'Row done')],
    stacks: [
      b.when(
        b.morning(),
        b.set('home', b.myTile()),
        b.repeat(b.v('rows'), b.run('row'), b.change('rows', -1)),
        b.set('done', b.yes(true)),
        b.if(b.not(b.bagHas('parsnip_seeds')), [b.take(b.v('seed'))]),
        b.goTo(b.v('home')),
      ),
      b.when(b.atTime(18 * 60), b.if(b.v('done'), [b.powerDown()], [b.say(b.v('note'))])),
    ],
    helpers: [
      b.helper('row', b.repeat(5, b.if(b.tileIsTilled(), [b.plant('parsnip')], [b.till()]), b.move()), b.run('turnAround')),
      b.helper('turnAround', b.turn('right'), b.turn('right')),
    ],
  }),
  'sensor eye: rain, the clock and the tile ahead': b.program({
    stacks: [
      b.when(
        b.every(30),
        b.if(b.or(b.itIsRaining(), b.timeIsAfter(20 * 60)), [b.powerDown()], [b.if(b.tileAheadIs('blocked'), [b.turn('right')], [b.move()])]),
      ),
    ],
  }),
  'values: bag counts, items, tiles and arithmetic': b.program({
    vars: [b.numVar('trips', 0)],
    stacks: [
      b.when(
        b.morning(),
        b.if(b.gt(b.countInBag('parsnip'), b.mul(b.add(b.v('trips'), 1), 2)), [b.change('trips', 1), b.goTo(b.tileAhead())]),
        b.if(b.eq(b.item('wood'), b.item('wood')), [b.wait(b.sub(30, b.v('trips')))]),
        b.if(b.ne(b.myTile(), b.tileAt(9, 12)), [b.goTo(b.tileAt(9, 12))]),
        b.if(b.tokensBelow(20), [b.powerDown()]),
        b.if(b.atEdgeOf('D'), [b.turn('left')]),
        b.if(b.cropIs('pumpkin'), [b.harvest()]),
      ),
    ],
  }),
};

describe('block types', () => {
  it('names every block kind, with no type twice', () => {
    expect(BLOCK_TYPES).toHaveLength(55);
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length);
    for (const kind of BLOCK_KINDS) for (const type of blockTypeFor(kind)) expect(BLOCK_TYPES).toContain(type);
    expect([...BLOCK_TYPES].sort()).toEqual(BLOCK_KINDS.flatMap((kind) => [...blockTypeFor(kind)]).sort());
    expect(blockTypeFor('if')).toEqual(['fc_if', 'fc_ifElse']);
    expect(blockTypeFor('var')).toEqual(['fc_var', 'fc_varDecl']);
    expect(blockTypeFor('helper')).toEqual(['fc_helper']);
    expect(blockTypeFor('goTo')).toEqual(['fc_goTo']);
  });

  it('has a round-trip program for every block type', () => {
    expect(Object.keys(ONE_OF_EACH).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it.each(Object.entries(ONE_OF_EACH))('%s round-trips', (type, program) => {
    expectRoundTrip(program);
    expect(allBlocks(programToWorkspace(program)).map((each) => each.type)).toContain(type);
  });

  it('keeps an If without else apart from an If-else with an empty else', () => {
    const noElse = on(b.if(b.cropIsReady(), [b.harvest()]));
    const emptyElse = on(b.if(b.cropIsReady(), [b.harvest()], []));
    const bothEmpty = on(b.if(b.cropIsReady(), [], []));
    const full = on(b.if(b.cropIsReady(), [b.harvest(), b.move()], [b.move(), b.turn('left')]));
    for (const program of [noElse, emptyElse, bothEmpty, full]) expectRoundTrip(program);
    const ifBlock = (program: BlockProgram): BlocklyBlockJson => must(allBlocks(programToWorkspace(program))[1]);
    expect(ifBlock(noElse).type).toBe('fc_if');
    expect(ifBlock(emptyElse).type).toBe('fc_ifElse');
    // Empty statement inputs are left out, as Blockly saves them.
    expect(Object.keys(ifBlock(emptyElse).inputs ?? {})).toEqual(['COND', 'THEN']);
    expect(Object.keys(ifBlock(bothEmpty).inputs ?? {})).toEqual(['COND']);
    expect(Object.keys(ifBlock(full).inputs ?? {})).toEqual(['COND', 'THEN', 'ELSE']);
  });
});

describe('programToWorkspace', () => {
  it('numbers blocks depth first and lays out variables, then stacks, then helpers', () => {
    const program = b.program({
      vars: [b.numVar('n', 3)],
      stacks: [b.when(b.atTime(583), b.repeat(b.v('n'), b.move()), b.say('Hi'))],
      helpers: [b.helper('spin', b.turn('left'))],
    });
    expect(programToWorkspace(program)).toStrictEqual({
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'fc_varDecl', id: 'b1', x: 0, y: 0, fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: { block: { type: 'fc_num', id: 'b2', fields: { NUM: 3 } } } } },
          {
            type: 'fc_atTime',
            id: 'b3',
            x: 0,
            y: ROBOT_SCREEN.stackGap,
            fields: { MINUTE: '583' },
            inputs: {
              DO: {
                block: {
                  type: 'fc_repeatTimes',
                  id: 'b4',
                  inputs: { TIMES: { block: { type: 'fc_var', id: 'b5', fields: { VAR: 'n' } } }, DO: { block: { type: 'fc_move', id: 'b6' } } },
                  next: { block: { type: 'fc_say', id: 'b7', inputs: { TEXT: { block: { type: 'fc_text', id: 'b8', fields: { TEXT: 'Hi' } } } } } },
                },
              },
            },
          },
          { type: 'fc_helper', id: 'b9', x: 0, y: 2 * ROBOT_SCREEN.stackGap, fields: { NAME: 'spin' }, inputs: { DO: { block: { type: 'fc_turn', id: 'b10', fields: { SIDE: 'left' } } } } },
        ],
      },
    });
    expectRoundTrip(program);
  });

  it('writes dropdowns as strings and number fields as numbers', () => {
    const json = programToWorkspace(
      b.program({
        vars: [b.yesVar('a', true), b.yesVar('c', false), b.tileVar('t', 3, 4)],
        stacks: [b.when(b.every(30), b.if(b.timeIsAfter(1200), [b.wait(-7)]))],
      }),
    );
    expect(allBlocks(json).map((each) => each.fields ?? {})).toStrictEqual([
      { NAME: 'a', TYPE: 'yesNo' },
      { VALUE: 'TRUE' },
      { NAME: 'c', TYPE: 'yesNo' },
      { VALUE: 'FALSE' },
      { NAME: 't', TYPE: 'tile' },
      { X: 3, Z: 4 },
      { MINUTES: '30' },
      {},
      { MINUTE: '1200' },
      {},
      { NUM: -7 },
    ]);
    expect(json.variables ?? []).toEqual([]);
  });
});

describe('round trips', () => {
  it.each(Object.entries(DESIGN_PROGRAMS))('%s', (_name, program) => {
    expectRoundTrip(program);
  });

  it("keeps values the editor's menus don't list: 9:43, a 16-character name, every item, crop, zone and Every choice", () => {
    const name = 'Sixteen chars ok';
    expect(Array.from(name)).toHaveLength(ROBOTS.maxIdentifierLength);
    expectRoundTrip(
      b.program({
        vars: [b.numVar(name, ROBOTS.maxNumber), b.textVar('said', 'x'.repeat(ROBOTS.maxTextLength))],
        stacks: [
          b.when(
            b.atTime(583),
            b.if(b.timeIsAfter(583), [b.change(name, -ROBOTS.maxNumber)]),
            b.say('Said "hi" — ✓ 🌱'),
            b.run(name),
            b.goTo(b.tileAt(47, 39)),
          ),
        ],
        helpers: [b.helper(name, b.move())],
      }),
    );
    for (const itemId of ITEMS.keys()) expectRoundTrip(on(b.take(itemId), b.if(b.bagHas(itemId), [b.wait(b.countInBag(itemId))])));
    for (const cropId of CROP_IDS) expectRoundTrip(on(b.plant(cropId), b.if(b.cropIs(cropId), [b.harvest()])));
    for (const zone of ZONE_IDS) expectRoundTrip(on(b.forEach(zone, b.if(b.atEdgeOf(zone), [b.turn('left')]))));
    for (const minutes of EVERY_CHOICES) expectRoundTrip(b.program({ stacks: [b.when(b.every(minutes), b.move())] }));
  });

  it(
    `round-trips ${GENERATED} generated programs, through JSON text too, with matching block counts and ids`,
    () => {
      const v = new Violations();
      const rng = mulberry32(20261003);
      let accepted = 0;
      for (let i = 0; i < GENERATED; i++) {
        const program = randomProgram(rng);
        if (checkProgram(program, SAFETY_BODY) !== null) continue;
        accepted++;
        const json = programToWorkspace(program);
        v.equal(`program ${i}`, workspaceToProgram(json), { program, loose: [] });
        v.equal(`program ${i} through JSON text`, workspaceToProgram(JSON.parse(JSON.stringify(json)) as BlocklyWorkspaceJson), { program, loose: [] });
        v.equal(`program ${i} block count`, countWorkspaceBlocks(json), blockCount(program));
        const blocks = allBlocks(json);
        v.equal(`program ${i} ids`, blocks.map((each) => each.id), ids(blocks.length));
      }
      expect(v.head()).toEqual([]);
      expect(accepted).toBeGreaterThanOrEqual(GENERATED * 0.9);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('reads a number field saved as text, and times saved as numbers', () => {
    const json = ws(
      block('fc_atTime', 'at', { fields: { MINUTE: 583 }, inputs: { DO: slot(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_num', 'n', { fields: { NUM: '12' } })) } })) } }),
      block('fc_every', 'ev', { fields: { MINUTES: 15 } }),
    );
    expect(workspaceToProgram(json)).toStrictEqual({ program: b.program({ stacks: [b.when(b.atTime(583), b.wait(12)), b.when(b.every(15))] }), loose: [] });
  });

  it('reads an empty workspace as an empty program (the checker then asks for a stack)', () => {
    const empty = { program: b.program({ stacks: [] }), loose: [] };
    expect(workspaceToProgram({})).toStrictEqual(empty);
    expect(workspaceToProgram({ blocks: { languageVersion: 0, blocks: [] } })).toStrictEqual(empty);
    expect(countWorkspaceBlocks({})).toBe(0);
  });

  it('ignores variables[]', () => {
    const program = must(DESIGN_PROGRAMS['job 4: helpers and variables']);
    const json = { ...programToWorkspace(program), variables: [{ name: 'rows', id: 'v1', type: '' }] };
    expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
  });

  it('reads each kind in its order in blocks.blocks, wherever the blocks sit', () => {
    const json = ws(
      block('fc_helper', 'h2', { x: 0, y: 0, fields: { NAME: 'second' } }),
      block('fc_atTime', 's1', { x: 400, y: 10, fields: { MINUTE: '600' }, inputs: { DO: slot(block('fc_move', 'mv')) } }),
      block('fc_varDecl', 'v2', { y: 20, fields: { NAME: 'two', TYPE: 'text' }, inputs: { INITIAL: slot(block('fc_text', 't', { fields: { TEXT: 'x' } })) } }),
      block('fc_morning', 's0', { y: -500, inputs: { DO: slot(block('fc_turn', 'tl', { fields: { SIDE: 'left' } })) } }),
      block('fc_varDecl', 'v1', { fields: { NAME: 'one', TYPE: 'number' }, inputs: { INITIAL: slot(num('one', 1)) } }),
      block('fc_helper', 'h1', { fields: { NAME: 'first' } }),
    );
    expect(workspaceToProgram(json)).toStrictEqual({
      program: b.program({
        vars: [b.textVar('two', 'x'), b.numVar('one', 1)],
        stacks: [b.when(b.atTime(600), b.move()), b.when(b.morning(), b.turn('left'))],
        helpers: [b.helper('second'), b.helper('first')],
      }),
      loose: [],
    });
  });
});

describe('shadows', () => {
  it('reads an input or next that holds only a shadow as that block', () => {
    for (const program of Object.values(DESIGN_PROGRAMS)) {
      const json = ws(...(programToWorkspace(program).blocks?.blocks ?? []).map(shadowed));
      expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
      expect(countWorkspaceBlocks(json)).toBe(blockCount(program));
    }
  });

  it('reads the block over its shadow, and counts only the block', () => {
    const covered = ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: { block: block('fc_tokensLeft', 'tl'), shadow: num('five', 5) } } })));
    expect(workspaceToProgram(covered)).toStrictEqual({ program: on(b.wait(b.tokensLeft())), loose: [] });
    expect(countWorkspaceBlocks(covered)).toBe(3);
    const bare = ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: { shadow: num('five', 5) } } })));
    expect(workspaceToProgram(bare)).toStrictEqual({ program: on(b.wait(5)), loose: [] });
  });
});

describe('loose blocks', () => {
  it('reports top-level blocks outside a stack, helper or declaration, and blocks chained under one', () => {
    const json = ws(
      block('fc_move', 'stray', { x: 300, y: 0 }),
      morning(block('fc_move', 'mv')),
      block('fc_cropIsReady', 'floating'),
      block('fc_bagFull', 'bf', { next: slot(block('fc_deposit', 'tail')) }),
      // A loose block's own slots aren't read: it is reported, not translated.
      block('fc_wait', 'unfinished'),
    );
    expect(workspaceToProgram(json)).toStrictEqual({
      program: b.program({ stacks: [b.when(b.morning(), b.move()), b.when(b.bagFull())] }),
      loose: ['stray', 'floating', 'tail', 'unfinished'],
    });
    expect(countWorkspaceBlocks(json)).toBe(7);
  });
});

describe('countWorkspaceBlocks', () => {
  it('counts mid-edit: empty slots and loose blocks count, literals and declarations are free', () => {
    const json = ws(
      morning(block('fc_repeatTimes', 'r', { inputs: { DO: slot(block('fc_say', 's', { inputs: { TEXT: slot(block('fc_text', 't', { fields: { TEXT: 'hi' } })) } })) } })),
      block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: slot(num('zero', 0)) } }),
      block('fc_tokensLeft', 'loose'),
    );
    expect(countWorkspaceBlocks(json)).toBe(4);
    expect(workspaceToProgram(json)).toStrictEqual({ error: FILL, blockId: 'r' });
  });

  it('counts nothing under a declaration, as blockCount ignores declarations', () => {
    const json = ws(
      morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(num('five', 5)) } })),
      block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: slot(block('fc_tokensLeft', 'inner')) } }),
    );
    expect(countWorkspaceBlocks(json)).toBe(2);
  });

  it('counts the design programs exactly as blockCount does', () => {
    for (const program of Object.values(DESIGN_PROGRAMS)) expect(countWorkspaceBlocks(programToWorkspace(program))).toBe(blockCount(program));
  });
});

const shared = block('fc_cropIsReady', 'shared');

const ERRORS: readonly (readonly [string, BlocklyWorkspaceJson, string, string | null])[] = [
  // An empty value slot names the block that owns it.
  ['a Wait with an empty slot', ws(morning(block('fc_wait', 'w'))), FILL, 'w'],
  ['an If with no condition', ws(morning(block('fc_if', 'i', { inputs: { THEN: slot(block('fc_move', 'mv')) } }))), FILL, 'i'],
  ['a variable with no starting value', ws(block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' } })), FILL, 'v'],
  ['a + with one side empty', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_arith', 'ar', { fields: { OP: '+' }, inputs: { A: slot(num('one', 1)) } })) } }))), FILL, 'ar'],
  ['a slot holding neither block nor shadow', ws(morning(block('fc_say', 's', { inputs: { TEXT: {} } }))), FILL, 's'],
  ['an empty slot deep in a helper', ws(block('fc_helper', 'h', { fields: { NAME: 'h' }, inputs: { DO: slot(block('fc_repeatForever', 'rf', { inputs: { DO: slot(block('fc_goTo', 'g')) } })) } })), FILL, 'g'],
  ['an empty slot after the first statement', ws(morning(block('fc_move', 'mv', { next: slot(block('fc_take', 't')) }))), FILL, 't'],
  // A block that isn't in the language, or not in that place, is named.
  ['an unknown block on top', ws(block('fc_teleport', 'tp')), NOT_A_BLOCK, 'tp'],
  ["a stock Blockly block in a stack", ws(morning(block('controls_if', 'ci'))), NOT_A_BLOCK, 'ci'],
  ['an action in a value slot', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_move', 'mv')) } }))), NOT_A_BLOCK, 'mv'],
  ['a sensor in a statement slot', ws(morning(block('fc_cropIsReady', 'cr'))), NOT_A_BLOCK, 'cr'],
  ['a trigger inside a stack', ws(morning(block('fc_bagFull', 'bf'))), NOT_A_BLOCK, 'bf'],
  ['a helper definition inside a stack', ws(morning(block('fc_helper', 'hd', { fields: { NAME: 'x' } }))), NOT_A_BLOCK, 'hd'],
  ['a declaration in a value slot', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_varDecl', 'vd', { fields: { NAME: 'n', TYPE: 'number' } })) } }))), NOT_A_BLOCK, 'vd'],
  ['the same block in two slots', ws(morning(block('fc_if', 'i', { inputs: { COND: slot(block('fc_and', 'and', { inputs: { A: slot(shared), B: slot(shared) } })) } }))), NOT_A_BLOCK, 'shared'],
  // A missing or ill-typed field names its block.
  ['a Turn with no side', ws(morning(block('fc_turn', 't'))), MISSING, 't'],
  ['a Turn up', ws(morning(block('fc_turn', 't', { fields: { SIDE: 'up' } }))), MISSING, 't'],
  ['a time that is not a number', ws(block('fc_atTime', 'at', { fields: { MINUTE: 'noon' } })), MISSING, 'at'],
  ['a time with a leading zero', ws(block('fc_atTime', 'at', { fields: { MINUTE: '0583' } })), MISSING, 'at'],
  ['Every 7 minutes', ws(block('fc_every', 'ev', { fields: { MINUTES: '7' } })), MISSING, 'ev'],
  ['a yes-or-no of MAYBE', ws(morning(block('fc_set', 's', { fields: { VAR: 'done' }, inputs: { VALUE: slot(block('fc_yes', 'y', { fields: { VALUE: 'MAYBE' } })) } }))), MISSING, 'y'],
  ['an item that does not exist', ws(morning(block('fc_take', 't', { inputs: { ITEM: slot(block('fc_item', 'it', { fields: { ITEM: 'unobtainium' } })) } }))), MISSING, 'it'],
  ['a crop that does not exist', ws(morning(block('fc_plant', 'p', { fields: { CROP: 'kale' } }))), MISSING, 'p'],
  ['zone I', ws(morning(block('fc_forEachTile', 'fe', { fields: { ZONE: 'I' } }))), MISSING, 'fe'],
  ['a variable of type colour', ws(block('fc_varDecl', 'v', { fields: { NAME: 'c', TYPE: 'colour' }, inputs: { INITIAL: slot(num('one', 1)) } })), MISSING, 'v'],
  ['a number field holding words', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_num', 'n', { fields: { NUM: 'lots' } })) } }))), MISSING, 'n'],
  ['a number field holding NaN', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(num('n', Number.NaN)) } }))), MISSING, 'n'],
  ['a text field holding a number', ws(morning(block('fc_say', 's', { inputs: { TEXT: slot(block('fc_text', 'tx', { fields: { TEXT: 5 } })) } }))), MISSING, 'tx'],
  ['a tile with no Z', ws(morning(block('fc_goTo', 'g', { inputs: { TILE: slot(block('fc_tile', 'tl', { fields: { X: 3 } })) } }))), MISSING, 'tl'],
  ['an operator ÷', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_arith', 'ar', { fields: { OP: '÷' }, inputs: { A: slot(num('a', 6)), B: slot(num('b', 2)) } })) } }))), MISSING, 'ar'],
  ['a helper with no name', ws(block('fc_helper', 'h')), MISSING, 'h'],
  ['a variable getter with no variable', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_var', 'vr')) } }))), MISSING, 'vr'],
  ['fields that are a string', garbage({ blocks: { blocks: [morning(block('fc_turn', 't', { fields: 'left' as never }))] } }), MISSING, 't'],
  // Input that isn't workspace JSON at all.
  ['null', garbage(null), NOT_A_BLOCK, null],
  ['a number', garbage(42), NOT_A_BLOCK, null],
  ['an array', garbage([]), NOT_A_BLOCK, null],
  ['blocks: null', garbage({ blocks: null }), NOT_A_BLOCK, null],
  ['a null blocks array', garbage({ blocks: { blocks: null } }), NOT_A_BLOCK, null],
  ['a blocks array that is an object', garbage({ blocks: { blocks: { 0: morning(block('fc_move', 'mv')) } } }), NOT_A_BLOCK, null],
  ['a null block', garbage({ blocks: { blocks: [null] } }), NOT_A_BLOCK, null],
  ['a hole in the block list', garbage({ blocks: { blocks: new Array(1) } }), NOT_A_BLOCK, null],
  ['a block with no type', garbage({ blocks: { blocks: [{ id: 'x' }] } }), NOT_A_BLOCK, 'x'],
  ['a block whose type is a number', garbage({ blocks: { blocks: [{ type: 7, id: 'seven' }] } }), NOT_A_BLOCK, 'seven'],
  ['a block with no id', garbage({ blocks: { blocks: [{ type: 'fc_morning' }] } }), NOT_A_BLOCK, null],
  ['a string where a block should be', garbage({ blocks: { blocks: [{ type: 'fc_morning', id: 'm', inputs: { DO: { block: 'fc_move' } } }] } }), NOT_A_BLOCK, null],
  ['inputs that are a string', garbage({ blocks: { blocks: [morning(block('fc_wait', 'w', { inputs: 'MINUTES' as never }))] } }), FILL, 'w'],
];

describe('errors', () => {
  it.each(ERRORS)('%s gives { error, blockId } without throwing', (_name, json, error, blockId) => {
    expect(() => workspaceToProgram(json)).not.toThrow();
    expect(workspaceToProgram(json)).toStrictEqual({ error, blockId });
    expect(() => countWorkspaceBlocks(json)).not.toThrow();
  });

  it('turns nesting too deep to read into an error, not a stack overflow', () => {
    let deep: BlocklyBlockJson = block('fc_yes', 'leaf', { fields: { VALUE: 'TRUE' } });
    for (let i = 0; i < DEEP; i++) deep = block('fc_not', `not${i}`, { inputs: { A: slot(deep) } });
    const json = ws(morning(block('fc_if', 'i', { inputs: { COND: slot(deep) } })));
    expect(workspaceToProgram(json)).toStrictEqual({ error: NOT_A_BLOCK, blockId: null });
    expect(countWorkspaceBlocks(json)).toBe(DEEP + 2);
  });

  it('refuses a cycle, and still counts it', () => {
    const loop: { type: string; id: string; next?: BlocklyInputJson } = { type: 'fc_move', id: 'loop' };
    loop.next = { block: loop };
    const json = ws(morning(loop));
    expect(workspaceToProgram(json)).toStrictEqual({ error: NOT_A_BLOCK, blockId: 'loop' });
    expect(countWorkspaceBlocks(json)).toBe(2);
  });

  it('counts garbage as no blocks', () => {
    for (const value of [null, 42, [], { blocks: null }, { blocks: { blocks: null } }, { blocks: { blocks: [null, 'fc_move', { id: 'x' }] } }]) {
      expect(countWorkspaceBlocks(garbage(value))).toBe(0);
    }
  });
});

describe('the module', () => {
  it('never imports Blockly', () => {
    expect(translateSource).toContain('export function workspaceToProgram');
    expect(translateSource).not.toMatch(/from\s+['"]blockly/);
    expect(translateSource).not.toMatch(/import\(\s*['"]blockly/);
  });
});
