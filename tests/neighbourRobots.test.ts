/**
 * Robots on the Neighbours map (farmclaws part 4c spec §5.1–5.2, §5.4): each robot works its own
 * map, bumps and bickers stay within a map, the neighbours' robots charge only near their owner's
 * generator (a flat one out of its reach is dragged back to it) and hand their bag over overnight,
 * the player can't carry them but works on one in job mode while its job is active, the
 * neighbours' generators are theirs, and the cap counts only the player's robots. A farm-only run stays byte-identical to the one before maps.
 */
import { describe, expect, it } from 'vitest';
import { GENERATORS, JOBS, ROBOTS, TIME, UNLOCKS } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { Blocker, DIRECTIONS, Direction, TileState, type BlockProgram, type GameState, type Robot, type TileCoord } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { ROBOT_CAP_RULE, addRobot } from '../src/robots/create';
import { planRobotAction } from '../src/robots/execute';
import { returnTarget } from '../src/robots/md';
import { runRobotsThrough } from '../src/robots/run';
import { requireRobot, robotsOnTile, withRobot } from '../src/robots/world';
import { actions, type GameAction } from '../src/state/actions';
import { describeIntent, planInteraction, planPrimaryAction, planShiftInteraction, placementProblem } from '../src/state/intents';
import { isValidGameState, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { ALL_UNLOCKS } from '../src/robots/unlocks';
import { workshopView } from '../src/ui/shops/viewModel';
import { hasBenchActions, isReadOnly, looksEditable, partsSectionView, switchView, visibleTabs } from '../src/ui/robotScreen/viewModel';
import { chebyshevDistance } from '../src/world/grid';
import { NEIGHBOURS_MAP } from '../src/world/maps/neighbours';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { addBlockRobot, programmed } from './programGen';
import { BASE, atDay, holding, matureCrop, must, robotOf, soilTile, stack, tileAt, withGold, withJobsDone, withPlayer, withRobots, withTile, withZones } from './testUtils';

const MORNING = atDay(BASE, 0, TIME.dayStartMinute);
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);
const burner = { ...EMPTY_TILE, object: { kind: 'woodBurner' as const, fuel: 0 } };

/** A neighbour's robot standing on the Neighbours map (robotOf's defaults otherwise). */
function neighbourBot(overrides: Partial<Robot> & Pick<Robot, 'id' | 'tx' | 'tz'>): Robot {
  return robotOf({ name: `N${overrides.id}`, mapId: 'neighbours', owner: 'cosmo', ...overrides });
}

/** Adds Cosmo's robot at `place` on the Neighbours map running `program`, set up at 6:00 so its morning stack runs. */
function withCosmoRobot(state: GameState, place: TileCoord, facing: Direction, program: BlockProgram): GameState {
  const added = addRobot(state, { name: 'Wave', size: 'big', parts: ['claw', 'basket', 'sensorEye'], place: { ...place, facing }, program, mapId: 'neighbours', owner: 'cosmo' });
  if ('error' in added) throw new Error(added.error);
  return withRobot(added.state, programmed(requireRobot(added.state, added.id), program));
}

/** FNV-1a over the UTF-16 code units: a short, stable fingerprint of a long save string. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(16)}`;
}

/** A busy farm: two scripted robots and three block robots with zones, a .MD and a wood burner. */
function busyFarm(): GameState {
  let state = withZones(atDay(BASE, 0, TIME.dayStartMinute), { A: { mapId: 'farm', x0: 3, z0: 12, w: 3, d: 3 }, B: { mapId: 'farm', x0: 9, z0: 12, w: 4, d: 2 } });
  for (let tx = 3; tx <= 5; tx++) for (let tz = 12; tz <= 14; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Plowed), 'farm');
  for (let tx = 9; tx <= 12; tx++) for (let tz = 12; tz <= 13; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
  state = withTile(state, { tx: 14, tz: 15 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
  const scripts = [
    { name: 'Ada', parts: ['wateringHead' as const], tx: 3, steps: [{ kind: 'water' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'left' as const }] },
    { name: 'Cog', parts: ['claw' as const], tx: 6, steps: [{ kind: 'harvest' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'right' as const }] },
  ];
  for (const s of scripts) {
    const result = addRobot(state, { name: s.name, size: 'mini', parts: s.parts, place: { tx: s.tx, tz: 16, facing: Direction.North }, program: { kind: 'script', steps: s.steps, loop: true } });
    if ('error' in result) throw new Error(result.error);
    state = result.state;
  }
  state = addBlockRobot(state, {
    name: 'Drizzle',
    size: 'mini',
    parts: ['wateringHead'],
    place: { tx: 4, tz: 13, facing: Direction.South },
    program: b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.powerDown())] }),
    md: [{ kind: 'dontLeave', zone: 'A' }],
  });
  state = addBlockRobot(state, {
    name: 'Reaper',
    size: 'standard',
    parts: ['claw', 'basket'],
    place: { tx: 9, tz: 12, facing: Direction.East },
    program: b.program({ stacks: [b.when(b.morning(), b.forever(b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]))))] }),
    md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 }],
  });
  return addBlockRobot(state, {
    name: 'Poll',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 7, tz: 16, facing: Direction.North },
    program: b.program({
      stacks: [b.when(b.every(15), b.run('look'))],
      helpers: [b.helper('look', b.if(b.cropIsReady(), [b.harvest()]), b.turn('right'))],
    }),
  });
}

/** `state` with `job`'s status set, the jobs before it done and the ones after it locked. */
function withJob(state: GameState, job: 'showHim' | 'knowTheLimits', status: 'active' | 'done'): GameState {
  const knowTheLimits = job === 'knowTheLimits' ? status : status === 'done' ? 'offered' : 'locked';
  const showHim = job === 'showHim' ? status : 'done';
  return { ...state, jobs: { ...state.jobs, status: { spinningRobot: 'done', showHim, knowTheLimits } } };
}

/** A fixed session: the player wanders, works and sleeps while the robots run. */
function session(): readonly GameAction[] {
  const rng = mulberry32(42);
  const list: GameAction[] = [];
  for (let i = 0; i < 900; i++) {
    const roll = rng();
    if (roll < 0.35) list.push(actions.move(must(DIRECTIONS[Math.floor(rng() * 4)])));
    else if (roll < 0.5) list.push(actions.interact());
    else if (roll < 0.6) list.push(actions.useTool());
    else if (roll < 0.97) list.push(actions.tick(1 + Math.floor(rng() * 90)));
    else list.push(actions.sleep());
  }
  return list;
}

describe('robots on their own map', () => {
  it("routes and harvests on the robot's own map, leaving the farm alone", () => {
    const crop = { tx: 6, tz: 8 };
    // The same tile on the farm is a rock: a route read off the farm would fail.
    let state = withTile(MORNING, crop, blockedTile(Blocker.Rock, 3), 'farm');
    state = withTile(state, crop, soilTile(TileState.Watered, matureCrop('parsnip')), 'neighbours');
    state = withCosmoRobot(state, { tx: 8, tz: 13 }, Direction.North, b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(crop.tx, crop.tz)), b.harvest())] }));
    const farm = state.maps.farm;
    const after = runRobotsThrough(state, TIME.dayStartMinute + 6 * 60);
    const wave = requireRobot(after, 1);
    expect(wave).toMatchObject({ mapId: 'neighbours', tx: crop.tx, tz: crop.tz });
    expect(wave.bag.map((s) => s.itemId)).toEqual(['parsnip']);
    expect(tileAt(after, crop, 'neighbours').crop).toBeNull();
    expect(after.maps.farm).toBe(farm);
    const harvest = after.robots.log.entries.find((e) => e.event.kind === 'did' && e.event.action === 'harvest');
    expect(harvest).toMatchObject({ robotId: 1, tx: crop.tx, tz: crop.tz });
    expect(isValidGameState(after)).toBe(true);
  });

  it('reads sensors off its own map', () => {
    const at = { tx: 6, tz: 8 };
    let state = withTile(MORNING, at, soilTile(TileState.Watered, matureCrop('parsnip')), 'neighbours');
    state = withTile(state, at, EMPTY_TILE, 'farm');
    // Right for a ripe crop under it, left for none.
    state = withCosmoRobot(state, at, Direction.North, b.program({ stacks: [b.when(b.morning(), b.if(b.cropIsReady(), [b.turn('right')], [b.turn('left')]))] }));
    expect(requireRobot(runRobotsThrough(state, TIME.dayStartMinute + 30), 1).facing).toBe(Direction.East);
  });

  it('never bumps or bickers with a robot on the other map', () => {
    let state = MORNING;
    for (let tx = 4; tx <= 9; tx++) state = withTile(state, { tx, tz: 14 }, EMPTY_TILE, 'farm');
    for (const tx of [3, 9]) {
      state = withTile(state, { tx, tz: 14 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
      state = withTile(state, { tx, tz: 14 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'neighbours');
    }
    const move = { kind: 'script' as const, steps: [{ kind: 'move' as const }], loop: true };
    const harvest = { kind: 'script' as const, steps: [{ kind: 'harvest' as const }], loop: true };
    const robots = [
      // Into one tile from both sides, each on its own map.
      robotOf({ id: 1, tx: 5, tz: 14, facing: Direction.East, program: move }),
      neighbourBot({ id: 2, tx: 7, tz: 14, facing: Direction.West, program: move }),
      // Onto a tile where a robot of the other map stands still.
      robotOf({ id: 3, tx: 7, tz: 13, facing: Direction.West, program: move }),
      neighbourBot({ id: 4, tx: 6, tz: 13, program: { kind: 'script', steps: [{ kind: 'turn', side: 'right' }], loop: true } }),
      // Harvesting the same (tx, tz) on both maps.
      robotOf({ id: 5, tx: 3, tz: 14, parts: ['claw'], program: harvest }),
      neighbourBot({ id: 6, tx: 3, tz: 14, parts: ['claw'], program: harvest }),
    ];
    const after = runRobotsThrough(withRobots(state, robots), TIME.dayStartMinute + 4);
    expect(after.robots.log.entries.filter((e) => e.event.kind === 'crashed' || e.event.kind === 'bickered')).toEqual([]);
    expect(requireRobot(after, 1)).toMatchObject({ tx: 6, tz: 14, off: null });
    expect(requireRobot(after, 2)).toMatchObject({ tx: 6, tz: 14, off: null });
    expect(requireRobot(after, 3)).toMatchObject({ tx: 6, tz: 13, off: null });
    expect(requireRobot(after, 5).bag).toHaveLength(1);
    expect(requireRobot(after, 6).bag).toHaveLength(1);
    expect(robotsOnTile(after, 'farm', 6, 14).map((r) => r.id)).toEqual([1]);
    expect(robotsOnTile(after, 'neighbours', 6, 14).map((r) => r.id)).toEqual([2]);
  });

  it("sees only its own map's robots ahead", () => {
    const ahead = { tx: 9, tz: 13 };
    let state = withTile(MORNING, ahead, EMPTY_TILE, 'farm');
    state = withRobots(state, [robotOf({ id: 2, ...ahead })]);
    // Right when the tile ahead is clear, left when something stands there.
    const program = b.program({ stacks: [b.when(b.morning(), b.if(b.tileAheadIs('clear'), [b.turn('right')], [b.turn('left')]))] });
    state = withCosmoRobot(state, { tx: 8, tz: 13 }, Direction.East, program);
    expect(requireRobot(runRobotsThrough(state, TIME.dayStartMinute + 30), 3).facing).toBe(Direction.South);
  });
});

describe("the neighbours' robots overnight", () => {
  const cosmoGen = JOBS.generators.cosmo;
  const barnabyGen = JOBS.generators.barnaby;
  const withGenerators = (state: GameState): GameState => withTile(withTile(state, cosmoGen, burner, 'neighbours'), barnabyGen, burner, 'neighbours');

  it("charges a neighbour's robot to full for free, only near its owner's generator", () => {
    const robots = [
      neighbourBot({ id: 1, owner: 'barnaby', tx: barnabyGen.tx, tz: barnabyGen.tz + ROBOTS.chargeRadius, tokens: 3 }),
      // Next to Cosmo's generator, which isn't Barnaby's.
      neighbourBot({ id: 2, owner: 'barnaby', tx: cosmoGen.tx + 1, tz: cosmoGen.tz, tokens: 3 }),
      neighbourBot({ id: 3, owner: 'barnaby', tx: 20, tz: 14, tokens: 3 }),
      neighbourBot({ id: 4, owner: 'cosmo', tx: cosmoGen.tx - 2, tz: cosmoGen.tz + 1, tokens: 3 }),
    ];
    const placed = withGenerators(withRobots(BASE, robots));
    const next = sleep({ ...placed, robots: { ...placed.robots, pool: 50 } });
    expect(next.robots.list.map((r) => r.tokens)).toEqual([80, 3, 3, 80]);
    expect(next.robots.pool).toBe(50);
    expect(texts(next).some((t) => t.includes('away from a generator') || t.includes('fully charge'))).toBe(false);
    // The generators never burn: the player's wood burners are the farm's.
    expect(tileAt(next, barnabyGen, 'neighbours').object).toEqual({ kind: 'woodBurner', fuel: 0 });
  });

  it("doesn't charge a neighbour's robot when its owner has no generator", () => {
    const next = sleep(withRobots(BASE, [neighbourBot({ id: 1, owner: 'barnaby', tx: barnabyGen.tx, tz: barnabyGen.tz + 1, tokens: 3 })]));
    expect(requireRobot(next, 1).tokens).toBe(3);
  });

  describe('a flat robot away from its generator', () => {
    const card = { kind: 'doReturn' as const, to: { kind: 'generator' as const }, minute: 18 * 60 };
    const program = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });
    const flatBot = (overrides: Partial<Robot> & Pick<Robot, 'id' | 'tx' | 'tz'>): Robot => neighbourBot({ tokens: 0, power: 'flat', md: [card], ...overrides });

    it('is dragged back beside the generator by its owner, charged, with its program and .MD, and a toast', () => {
      const robots = [
        flatBot({ id: 1, owner: 'barnaby', tx: 20, tz: 14, program }),
        // Out of power with a token left: still flat.
        flatBot({ id: 2, owner: 'cosmo', tx: 3, tz: 14, tokens: 1 }),
      ];
      const next = sleep(withGenerators(withRobots(BASE, robots)));
      const [b1, c2] = [requireRobot(next, 1), requireRobot(next, 2)];
      for (const [robot, gen] of [[b1, barnabyGen], [c2, cosmoGen]] as const) {
        expect(chebyshevDistance(robot, gen)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
        expect(robot.tokens).toBe(80);
        expect(robot.teleportSeq).toBe(1);
        expect(robot.md).toEqual([card]);
        expect(robotsOnTile(next, 'neighbours', robot.tx, robot.tz)).toEqual([robot]);
        expect(NEIGHBOURS_MAP.npcs.some((p) => p.tx === robot.tx && p.tz === robot.tz)).toBe(false);
      }
      expect(b1.program).toEqual(program);
      expect(b1.power).toBe('working');
      expect(texts(next)).toContain('Barnaby dragged N1 back to the generator.');
      expect(texts(next)).toContain('Cosmo dragged N2 back to the generator.');
      expect(texts(next).some((t) => t.includes('away from a generator'))).toBe(false);
    });

    it("isn't dragged onto another robot's tile", () => {
      const alone = sleep(withGenerators(withRobots(BASE, [flatBot({ id: 1, owner: 'barnaby', tx: 20, tz: 14 })])));
      const spot = requireRobot(alone, 1);
      const sitter = neighbourBot({ id: 2, owner: 'barnaby', tx: spot.tx, tz: spot.tz, tokens: 3 });
      const next = sleep(withGenerators(withRobots(BASE, [flatBot({ id: 1, owner: 'barnaby', tx: 20, tz: 14 }), sitter])));
      const moved = requireRobot(next, 1);
      expect({ tx: moved.tx, tz: moved.tz }).not.toEqual({ tx: spot.tx, tz: spot.tz });
      expect(chebyshevDistance(moved, barnabyGen)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
      expect(requireRobot(next, 2)).toMatchObject({ tx: spot.tx, tz: spot.tz });
    });

    it('stays where it is when flat but already in reach, and charges', () => {
      const at = { tx: barnabyGen.tx + ROBOTS.chargeRadius, tz: barnabyGen.tz - 1 };
      const next = sleep(withGenerators(withRobots(BASE, [flatBot({ id: 1, owner: 'barnaby', ...at })])));
      expect(requireRobot(next, 1)).toMatchObject({ ...at, tokens: 80, teleportSeq: 0 });
      expect(texts(next).some((t) => t.includes('dragged'))).toBe(false);
    });

    it("isn't dragged or charged when it still has power", () => {
      const next = sleep(withGenerators(withRobots(BASE, [neighbourBot({ id: 1, owner: 'barnaby', tx: 20, tz: 14, tokens: 3 })])));
      expect(requireRobot(next, 1)).toMatchObject({ tx: 20, tz: 14, tokens: 3, teleportSeq: 0 });
      expect(texts(next).some((t) => t.includes('dragged'))).toBe(false);
    });

    it('stays where it is, flat, when its owner has no generator', () => {
      const next = sleep(withRobots(BASE, [flatBot({ id: 1, owner: 'barnaby', tx: 20, tz: 14 })]));
      expect(requireRobot(next, 1)).toMatchObject({ tx: 20, tz: 14, tokens: 0, power: 'flat', teleportSeq: 0 });
      expect(texts(next).some((t) => t.includes('dragged'))).toBe(false);
    });
  });

  it("sends a neighbour's DO return to its owner's generator", () => {
    const card = { kind: 'doReturn' as const, to: { kind: 'generator' as const }, minute: 18 * 60 };
    const robot = neighbourBot({ id: 1, owner: 'barnaby', tx: 12, tz: 14, md: [card] });
    const state = withGenerators(withRobots(BASE, [robot]));
    const target = must(returnTarget(state, robot, card));
    expect(chebyshevDistance(target, barnabyGen)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    expect(returnTarget(withRobots(BASE, [robot]), robot, card)).toBeNull();
  });

  it("empties a neighbour's bag overnight and keeps the player's", () => {
    const bag = [stack('parsnip', 4)];
    const next = sleep(withRobots(BASE, [robotOf({ id: 1, bag }), neighbourBot({ id: 2, tx: 20, tz: 14, bag })]));
    expect(requireRobot(next, 1).bag).toEqual(bag);
    expect(requireRobot(next, 2).bag).toEqual([]);
  });

  it("can't deposit into or take from a container: the bin and the chests are the player's", () => {
    let state = withTile(BASE, { tx: 20, tz: 13 }, { ...EMPTY_TILE, object: { kind: 'chest', slots: [stack('wood', 5)] } }, 'neighbours');
    const robot = neighbourBot({ id: 1, tx: 20, tz: 14, facing: Direction.North, bag: [stack('parsnip', 1)] });
    state = withRobots(state, [robot]);
    expect(planRobotAction(state, robot, { kind: 'deposit' })).toMatchObject({ ok: false, reason: 'nothingAhead' });
    expect(planRobotAction(state, robot, { kind: 'take', itemId: 'wood' })).toMatchObject({ ok: false, reason: 'nothingAhead' });
  });
});

describe("the player and a neighbour's robot", () => {
  const facingWave = (owner: Robot['owner']): GameState =>
    withPlayer(withRobots(BASE, [neighbourBot({ id: 1, name: 'Wave', owner, tx: 8, tz: 13 })]), { tx: 8, tz: 14 }, Direction.North, 'neighbours');

  it("won't pick it up: it's theirs", () => {
    for (const [owner, name] of [['cosmo', 'Cosmo'], ['barnaby', 'Barnaby']] as const) {
      const state = facingWave(owner);
      expect(planInteraction(state).intent).toEqual({ kind: 'blocked', reason: `That's ${name}'s robot.` });
      const next = gameReducer(state, actions.interact());
      expect(next.player.carrying).toBeNull();
      expect(requireRobot(next, 1).carried).toBe(false);
      expect(texts(next)).toContain(`That's ${name}'s robot.`);
    }
  });

  it('peeks at it with Shift + E, and keeps placed things off its tile', () => {
    const state = facingWave('cosmo');
    expect(planShiftInteraction(state).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Wave' });
    expect(placementProblem(state, 'chest', { tx: 8, tz: 13 })).toBe("There's a robot in the way.");
  });

  it("doesn't meet the other map's robots", () => {
    // A player's robot at the same (tx, tz) on the farm is nowhere near the player on the Neighbours map.
    const state = withPlayer(withRobots(BASE, [robotOf({ id: 1, tx: 8, tz: 13 })]), { tx: 8, tz: 14 }, Direction.North, 'neighbours');
    expect(planShiftInteraction(state).intent.kind).toBe('blocked');
    expect(placementProblem(state, 'chest', { tx: 8, tz: 13 })).toBeNull();
  });
});

describe('the 12-robot cap', () => {
  const players = (n: number): Robot[] => Array.from({ length: n }, (_, i) => robotOf({ id: i + 1, name: `R${i + 1}`, tx: 2 + (i % 6), tz: 12 + Math.floor(i / 6) }));
  const neighbours = (from: number): Robot[] => [neighbourBot({ id: from, tx: 20, tz: 14 }), neighbourBot({ id: from + 1, owner: 'barnaby', tx: 22, tz: 14 })];
  const spec = { name: 'Bolt', size: 'mini' as const, parts: ['claw' as const], place: { tx: 10, tz: 16, facing: Direction.South }, program: { kind: 'script' as const, steps: [{ kind: 'harvest' as const }], loop: true } };

  it("counts only the player's robots", () => {
    const eleven = withRobots(BASE, [...players(11), ...neighbours(12)]);
    expect('error' in addRobot(eleven, spec)).toBe(false);
    expect(workshopView(eleven).count).toBe(`11 / ${ROBOTS.maxRobots} robots`);
    const twelve = withRobots(BASE, [...players(12), ...neighbours(13)]);
    expect(addRobot(twelve, spec)).toEqual({ error: ROBOT_CAP_RULE });
    // The neighbours' robots never hit the player's cap.
    expect('error' in addRobot(twelve, { ...spec, place: { tx: 24, tz: 14, facing: Direction.South }, mapId: 'neighbours', owner: 'barnaby' })).toBe(false);
  });

  it("lets Juniper's workshop take an order with the neighbours' robots about", () => {
    const eleven = { ...withGold(withRobots(withJobsDone(BASE, 'knowTheLimits'), [...players(11), ...neighbours(12)]), 20000), ui: { ...BASE.ui, panel: { kind: 'workshop' as const } } };
    const ordered = gameReducer(eleven, actions.orderRobot('mini', 'Bolt'));
    expect(ordered.robots.deliveries).toEqual([{ size: 'mini', name: 'Bolt' }]);
    expect(texts(gameReducer(ordered, actions.orderRobot('standard', 'Cog')))).toContain(ROBOT_CAP_RULE);
  });
});

describe("a neighbour's robot in the save", () => {
  it("checks the log's tiles against the robot's own map", () => {
    const robot = neighbourBot({ id: 1, tx: 20, tz: 14 });
    const entry = { id: 0, day: 0, minute: TIME.dayStartMinute, robotId: 1, tx: 20, tz: 14, event: { kind: 'flat' as const }, count: 1 };
    const placed = withRobots(BASE, [robot]);
    const withLog = (tx: number, tz: number): GameState => ({ ...placed, robots: { ...placed.robots, log: { nextId: 1, entries: [{ ...entry, tx, tz }] } } });
    expect(isValidGameState(withLog(20, 14))).toBe(true);
    // On the farm's grid but off the Neighbours map (40 × 28).
    expect(isValidGameState(withLog(44, 30))).toBe(false);
  });
});

/** The robot simulation's sources, by path. */
const ROBOT_SOURCES = import.meta.glob<string>('../src/robots/*.ts', { query: '?raw', import: 'default', eager: true });

describe('the farm-only rules', () => {
  it("reads every robot rule off the robot's own map: only the farm's generators, deliveries and Sol's pond rescue read the farm", () => {
    const reads = Object.entries(ROBOT_SOURCES).flatMap(([path, text]) =>
      text
        .split('\n')
        .filter((line) => line.includes('maps.farm'))
        .map((line) => `${path.replace('../src/robots/', '')}: ${line.trim()}`),
    );
    expect(Object.keys(ROBOT_SOURCES).length).toBeGreaterThan(20);
    expect(reads).toEqual([
      'overnight.ts: forEachTile(state.maps.farm, (tile, tx, tz) => {',
      'overnight.ts: const burned = withFarm(state, setTiles(state.maps.farm, edits));',
      'overnight.ts: const at = freeSpotNear(state.maps.farm, WORKBENCH.home, [PLAYER.spawn, ...others]);',
      'overnight.ts: const at = freeSpotNear(next.maps.farm, WORKBENCH.home, taken);',
    ]);
  });

  it('plays a farm-only session byte for byte as before robots had maps', () => {
    const end = session().reduce(gameReducer, busyFarm());
    expect(end.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0)).toBeGreaterThan(100);
    expect(fingerprint(serializeGame(end))).toBe('467836:d463f83');
  });
});

describe("working on a neighbour's robot (job mode)", () => {
  const hello = b.program({ stacks: [b.when(b.morning(), b.forever(b.say('hello chickens')))] });
  const wave = programmed(neighbourBot({ id: 1, name: 'Wave', size: 'big', parts: ['claw', 'basket', 'sensorEye'], tx: 8, tz: 13 }), hello);
  const facing = (state: GameState): GameState => withPlayer(withRobots(state, [wave]), { tx: 8, tz: 14 }, Direction.North, 'neighbours');
  const ACTIVE = facing(withJob(BASE, 'showHim', 'active'));
  const jobPanel = { kind: 'robot', robotId: 1, mode: 'job' } as const;
  const OPEN = gameReducer(ACTIVE, actions.interact());
  const program = b.program({ stacks: [b.when(b.morning(), b.if(b.cropIsReady(), [b.harvest()]))] });
  const md = [{ kind: 'dontGoIntoWater' as const }];

  it("shows Work on {name} for E while its owner's job is active, and opens its screen in job mode where it stands", () => {
    const plan = planInteraction(ACTIVE);
    expect(plan.intent).toEqual({ kind: 'workOnRobot', robotId: 1, name: 'Wave' });
    expect(describeIntent(plan.intent)).toBe('Work on Wave');
    expect(OPEN.ui.panel).toEqual(jobPanel);
    expect(requireRobot(OPEN, 1)).toBe(requireRobot(ACTIVE, 1));
    expect(OPEN.player.carrying).toBeNull();
    // Shift + E still peeks.
    expect(planShiftInteraction(ACTIVE).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Wave' });
  });

  it("refuses E on another neighbour's robot, and on its robot once the job is done", () => {
    const barnabys = facing(withJob(BASE, 'showHim', 'active'));
    const other = withRobots(barnabys, [{ ...wave, owner: 'barnaby' }]);
    expect(planInteraction(other).intent).toEqual({ kind: 'blocked', reason: "That's Barnaby's robot." });
    expect(planInteraction(facing(withJob(BASE, 'showHim', 'done'))).intent).toEqual({ kind: 'blocked', reason: "That's Cosmo's robot." });
    expect(planInteraction(facing(withJob(BASE, 'knowTheLimits', 'active'))).intent).toEqual({ kind: 'blocked', reason: "That's Cosmo's robot." });
  });

  it('edits its Program and .MD in job mode', () => {
    const programmedWave = gameReducer(OPEN, actions.programRobot(1, program));
    expect(requireRobot(programmedWave, 1).program).toEqual(program);
    expect(texts(programmedWave).at(-1)).toBe('Programmed Wave.');
    const carded = gameReducer(OPEN, actions.setRobotMd(1, md));
    expect(requireRobot(carded, 1).md).toEqual(md);
    expect(texts(carded).at(-1)).toBe("Set Wave's .MD.");
  });

  it("refuses those edits outside job mode, or once the job is done, with \"That's {owner}'s robot.\"", () => {
    const peeking = { ...ACTIVE, ui: { ...ACTIVE.ui, panel: { kind: 'robot' as const, robotId: 1, mode: 'peek' as const } } };
    const done = withJob(OPEN, 'showHim', 'done');
    const otherRobot = withRobots(OPEN, [wave, neighbourBot({ id: 2, name: 'Spare', tx: 20, tz: 14 })]);
    for (const [state, robotId] of [[ACTIVE, 1], [peeking, 1], [done, 1], [otherRobot, 2]] as const) {
      for (const action of [actions.programRobot(robotId, program), actions.setRobotMd(robotId, md)]) {
        const next = gameReducer(state, action);
        expect(next.robots).toBe(state.robots);
        expect(texts(next).at(-1)).toBe("That's Cosmo's robot.");
      }
    }
  });

  it('has no parts, switch, paint or scrap in job mode, and the reducer refuses them', () => {
    const withClaw = holding({ ...OPEN, player: { ...OPEN.player, gold: 5000 } }, 'tiller');
    for (const action of [actions.fitPart(1, 'tiller'), actions.unfitPart(1, 'claw'), actions.switchRobot(1, false), actions.paintRobot(1, 3), actions.scrapRobot(1)]) {
      const next = gameReducer(withClaw, action);
      expect(next.robots, action.type).toBe(withClaw.robots);
      expect(next.player.gold).toBe(withClaw.player.gold);
      expect(texts(next).at(-1)).toBe("That's Cosmo's robot.");
    }
    expect(gameReducer(withClaw, actions.liftOffBench(1)).player.carrying).toBeNull();
  });

  it('shows every unlocked tab, edits Program and .MD, and shows Looks and parts read-only, with no bench actions', () => {
    expect(visibleTabs('job', UNLOCKS.job1)).toEqual(['program', 'md', 'looks', 'log']);
    expect(visibleTabs('job', ALL_UNLOCKS)).toEqual(['program', 'md', 'looks', 'stats', 'log']);
    expect(isReadOnly(wave, 'job')).toBe(false);
    expect(isReadOnly({ ...wave, power: 'ruined' }, 'job')).toBe(true);
    expect(looksEditable(wave, 'job')).toBe(false);
    expect(looksEditable(wave, 'bench')).toBe(true);
    expect(hasBenchActions('job')).toBe(false);
    expect(switchView(wave, 'job')).toBeNull();
    const parts = partsSectionView(wave, 'job', holding(BASE, 'tiller').inventory);
    expect(parts.editable).toBe(false);
    expect(parts.fittable).toEqual([]);
    expect(parts.slots.slice(0, 3).map((slot) => slot?.part)).toEqual(['claw', 'basket', 'sensorEye']);
  });
});

describe("the neighbours' generators", () => {
  const gen = JOBS.generators.cosmo;
  const full = { ...EMPTY_TILE, object: { kind: 'woodBurner' as const, fuel: GENERATORS.woodBurner.hopper } };
  const facingGen = (state: GameState): GameState => withPlayer(withTile(state, gen, full, 'neighbours'), { tx: gen.tx, tz: gen.tz + 1 }, Direction.North, 'neighbours');

  it("belong to the neighbours: they can't be picked up and take no wood", () => {
    const state = facingGen(BASE);
    expect(planPrimaryAction(holding(state, 'axe')).intent).toEqual({ kind: 'blocked', reason: 'That belongs to the neighbours.' });
    expect(planInteraction(holding(state, 'wood', 5)).intent).toEqual({ kind: 'blocked', reason: 'That belongs to the neighbours.' });
  });

  it("keep their tiles clear of the player's things before they arrive", () => {
    const state = withPlayer(BASE, { tx: gen.tx, tz: gen.tz + 1 }, Direction.North, 'neighbours');
    expect(placementProblem(state, 'chest', gen)).toBe('Keep this spot clear.');
    expect(placementProblem(state, 'chest', JOBS.generators.barnaby)).toBe('Keep this spot clear.');
    expect(placementProblem(state, 'chest', { tx: gen.tx + 1, tz: gen.tz })).toBeNull();
  });

  it('load from a save on their own tiles only', () => {
    expect(isValidGameState(withTile(withTile(BASE, gen, full, 'neighbours'), JOBS.generators.barnaby, full, 'neighbours'))).toBe(true);
    expect(isValidGameState(withTile(BASE, { tx: gen.tx + 1, tz: gen.tz }, full, 'neighbours'))).toBe(false);
    expect(isValidGameState(withTile(BASE, gen, full, 'town'))).toBe(false);
  });
});
