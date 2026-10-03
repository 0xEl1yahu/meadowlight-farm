/**
 * Development-only robot hooks (farmclaws part 1 spec §8.4, part 2 spec §12). main.ts imports
 * this only when import.meta.env.DEV is true, so production builds contain none of it.
 */
import { TIME } from '../config';
import type { Store } from '../core/store';
import {
  CRAFTING_RECIPE_IDS,
  ZONE_IDS,
  type GameState,
  type MdCard,
  type Robot,
  type RobotAction,
  type RobotPartId,
  type RobotPlace,
  type RobotProgram,
  type RobotSize,
  type ZoneId,
  type ZoneRect,
} from '../core/types';
import { b } from '../robots/blocks';
import { checkMd, checkProgram, isValidZoneRect } from '../robots/check';
import { addRobot, type RobotSpec } from '../robots/create';
import { execAt, morningExec } from '../robots/exec';
import { robotSays, whatHappened } from '../robots/logText';
import { periodFor } from '../robots/stats';
import { withRobot } from '../robots/world';
import { actions, type GameAction } from '../state/actions';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { selectTargetTile } from '../state/selectors';
import { isInt, isObj, isOneOf } from '../state/validation';

export type RobotPresetId = 'spinner' | 'waterer' | 'harvester' | 'swimmer' | 'pair';

const repeat = <T>(n: number, steps: readonly T[]): T[] => Array.from({ length: n }, () => steps).flat();

function presetSpecs(id: RobotPresetId, place: RobotPlace): RobotSpec[] {
  const spec = (name: string, size: RobotSpec['size'], parts: RobotSpec['parts'], steps: RobotAction[], loop: boolean): RobotSpec => ({
    name,
    size,
    parts,
    place,
    program: { kind: 'script', steps, loop },
  });
  switch (id) {
    case 'spinner':
      return [spec('Spinner', 'mini', ['wateringHead'], [{ kind: 'turn', side: 'right' }], true)];
    case 'waterer':
      return [spec('Drizzle', 'mini', ['wateringHead'], [{ kind: 'water' }, { kind: 'move' }, { kind: 'water' }, { kind: 'move' }, { kind: 'water' }, { kind: 'powerDown' }], false)];
    case 'harvester':
      return [spec('Reaper', 'standard', ['claw', 'basket'], [...repeat(6, [{ kind: 'harvest' }, { kind: 'move' }] as RobotAction[]), { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }], true)];
    case 'swimmer':
      return [spec('Splash', 'mini', ['claw'], repeat(30, [{ kind: 'move' }] as RobotAction[]), false)];
    case 'pair': {
      const steps: RobotAction[] = [{ kind: 'harvest' }, { kind: 'move' }, { kind: 'harvest' }, { kind: 'move' }, { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }];
      return [spec('Tweedle', 'mini', ['claw'], steps, true), spec('Dee', 'mini', ['claw'], steps, true)];
    }
  }
}

export type ScriptedRobotInput = {
  readonly steps: readonly RobotAction[];
  readonly parts: readonly RobotPartId[];
  readonly name?: string;
  readonly size?: RobotSize;
  readonly loop?: boolean;
  readonly place?: RobotPlace;
};

const SCRIPTED_USAGE = "Usage: addScriptedRobot({ steps: [{ kind: 'move' }], parts: ['claw'], name?, size?, loop?, place? })";

/** Turns console input into a spec, filling in the defaults (name 'Scripty', size 'mini', loop true). */
export function scriptedRobotSpec(input: ScriptedRobotInput, at: RobotPlace): RobotSpec {
  return {
    name: input.name ?? 'Scripty',
    size: input.size ?? 'mini',
    parts: input.parts,
    place: at,
    program: { kind: 'script', steps: input.steps, loop: input.loop ?? true },
  };
}

function isScriptedInput(v: unknown): v is ScriptedRobotInput {
  return typeof v === 'object' && v !== null && Array.isArray((v as Record<string, unknown>).steps) && Array.isArray((v as Record<string, unknown>).parts);
}

// ---------------------------------------------------------------------------
// Programs, .MDs and zones (part 2 spec §12). Pure, so the tests need no window. The workbench
// (part 3) will call the same checker and the same exec rebuild.
// ---------------------------------------------------------------------------

const PROGRAM_USAGE = 'Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))';
const MD_USAGE = "Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])";
const ZONE_USAGE = "Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.";
const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';

/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first. */
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing']);

/**
 * `robot` with a new program, set up the way the morning reset would (spec §12). A block
 * program starts its `morning` stack only if `minuteOfDay` is no later than the robot's first
 * act of the day (TIME.dayStartMinute + its period); later it idles until a trigger fires, with
 * the atTime triggers already past today spent (execAt). A script runs from step 0. Either way
 * the robot turns back on and acts one period from now; a flat, broken or repairing robot keeps
 * its power. Returns the checker's sentence instead when the program fails, or the usage when it
 * isn't a program at all.
 */
export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string {
  if (!isProgramShape(program)) return PROGRAM_USAGE;
  const problem = checkProgram(program, robot);
  if (problem !== null) return problem;
  const early = minuteOfDay <= TIME.dayStartMinute + periodFor(robot);
  const exec = program.kind === 'blocks' ? (early ? morningExec(program) : execAt(program, minuteOfDay)) : null;
  const runs = exec === null || exec.running !== null;
  return {
    ...robot,
    program,
    pc: 0,
    exec,
    off: null,
    power: KEPT_POWERS.has(robot.power) ? robot.power : runs ? 'working' : 'standby',
    nextActMinute: minuteOfDay + periodFor(robot),
  };
}

/**
 * `robot` with a new .MD. The cards apply at once: today's carried-out DO cards are forgotten
 * (their indices may name other cards now), and a DO return under way stops, because its card
 * may be gone; a working robot then stands by until a trigger or a DO card moves it.
 */
export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string {
  if (!isMdShape(md)) return MD_USAGE;
  const problem = checkMd(md, robot);
  if (problem !== null) return problem;
  const exec = robot.exec;
  if (exec === null) return { ...robot, md };
  const returning = exec.running === null && exec.frames.length > 0;
  return {
    ...robot,
    md,
    exec: { ...exec, frames: returning ? [] : exec.frames, doneCards: [] },
    power: returning && robot.power === 'working' ? 'standby' : robot.power,
  };
}

function isZoneRectShape(v: unknown): v is ZoneRect {
  return isObj(v) && isInt(v.x0) && isInt(v.z0) && isInt(v.w) && isInt(v.d);
}

/** `state` with zone `id` set to `rect` (only its four fields) or cleared with null. */
export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string {
  if (!isOneOf(id, ZONE_IDS) || (rect !== null && !isZoneRectShape(rect))) return ZONE_USAGE;
  if (rect !== null && !isValidZoneRect(rect)) return ZONE_OFF_FARM;
  const zone: ZoneRect | null = rect === null ? null : { x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d };
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, [id]: zone } } };
}

/** The robot called `name` (the most recently added one if several share it). */
function robotNamed(state: GameState, name: unknown): Robot | null {
  if (typeof name !== 'string') return null;
  return [...state.robots.list].reverse().find((r) => r.name === name) ?? null;
}

function withBurnerKnown(state: GameState): GameState {
  if (state.crafting.known.includes('woodBurner')) return state;
  const known = CRAFTING_RECIPE_IDS.filter((id) => id === 'woodBurner' || state.crafting.known.includes(id));
  return { ...state, crafting: { known } };
}

/** The dev handle once these hooks are attached. Declared here, not in main.ts, so no hook names reach the production source maps. */
type RobotDevHandle = {
  readonly addRobot: (preset: RobotPresetId, place?: RobotPlace) => string;
  readonly addScriptedRobot: (input: ScriptedRobotInput) => string;
  readonly robotLog: () => void;
  readonly setProgram: (name: string, program: RobotProgram) => string;
  readonly setMd: (name: string, cards: readonly MdCard[]) => string;
  readonly setZone: (id: ZoneId, rect: ZoneRect | null) => string;
  readonly blocks: typeof b;
};

export function installRobotDev(store: Store<GameState, GameAction>): void {
  const handle = window.__meadowlight;
  if (handle === undefined) return;

  /** Teaches the wood burner, adds each spec (built for the delivery tile) and loads the result; returns the message to print. */
  const deliver = (specsAt: (at: RobotPlace) => RobotSpec[], place?: RobotPlace): string => {
    let state = withBurnerKnown(store.getState());
    const target = selectTargetTile(state) ?? { tx: state.player.tx, tz: state.player.tz };
    const at = place ?? { tx: target.tx, tz: target.tz, facing: state.player.facing };
    const added: string[] = [];
    for (const spec of specsAt(at)) {
      const result = addRobot(state, spec);
      if ('error' in result) return result.error;
      state = result.state;
      added.push(spec.name);
    }
    store.dispatch(actions.load(state));
    return `Added ${added.join(' and ')}.`;
  };

  const add = (preset: RobotPresetId, place?: RobotPlace): string => deliver((at) => presetSpecs(preset, at), place);

  const addScripted = (input: ScriptedRobotInput): string =>
    isScriptedInput(input) ? deliver((at) => [scriptedRobotSpec(input, at)], input.place) : SCRIPTED_USAGE;

  /** Changes the robot called `name` and loads the result once; returns the message to print. */
  const reprogram = (name: string, change: (robot: Robot, state: GameState) => Robot | string, done: string): string => {
    const state = store.getState();
    const robot = robotNamed(state, name);
    if (robot === null) return `No robot is called ${String(name)}.`;
    const next = change(robot, state);
    if (typeof next === 'string') return next;
    store.dispatch(actions.load(withRobot(state, next)));
    return done;
  };

  const setProgram = (name: string, program: RobotProgram): string =>
    reprogram(name, (robot, state) => programmedRobot(robot, program, state.time.minuteOfDay), `Programmed ${name}.`);

  const setMd = (name: string, cards: readonly MdCard[]): string => reprogram(name, (robot) => withMd(robot, cards), `Set ${name}'s .MD.`);

  const setZone = (id: ZoneId, rect: ZoneRect | null): string => {
    const next = withZone(store.getState(), id, rect);
    if (typeof next === 'string') return next;
    store.dispatch(actions.load(next));
    return rect === null ? `Cleared Zone ${id}.` : `Set Zone ${id}.`;
  };

  const log = (): void => {
    const state = store.getState();
    const names = new Map(state.robots.list.map((r) => [r.id, r.name]));
    const rows = state.robots.log.entries.map((e) => {
      const who = `${names.get(e.robotId) ?? `Robot ${e.robotId}`} (day ${e.day}, minute ${e.minute}${e.count > 1 ? `, x${e.count}` : ''})`;
      return { 'Robot says': `${who}: ${robotSays(e)}`, 'What happened': whatHappened(e, names) };
    });
    console.table(rows);
  };

  const hooks: RobotDevHandle = { addRobot: add, addScriptedRobot: addScripted, robotLog: log, setProgram, setMd, setZone, blocks: b };
  Object.assign(handle, hooks);
}
