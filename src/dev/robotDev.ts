/**
 * Development-only robot hooks (farmclaws part 1 spec §8.4). main.ts imports this only when
 * import.meta.env.DEV is true, so production builds contain none of it.
 */
import type { Store } from '../core/store';
import { CRAFTING_RECIPE_IDS, type GameState, type RobotAction, type RobotPlace } from '../core/types';
import { addRobot, type RobotSpec } from '../robots/create';
import { robotSays, whatHappened } from '../robots/logText';
import { actions, type GameAction } from '../state/actions';
import { selectTargetTile } from '../state/selectors';

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

function withBurnerKnown(state: GameState): GameState {
  if (state.crafting.known.includes('woodBurner')) return state;
  const known = CRAFTING_RECIPE_IDS.filter((id) => id === 'woodBurner' || state.crafting.known.includes(id));
  return { ...state, crafting: { known } };
}

/** The dev handle once these hooks are attached. Declared here, not in main.ts, so no hook names reach the production source maps. */
type RobotDevHandle = {
  readonly addRobot: (preset: RobotPresetId, place?: RobotPlace) => string;
  readonly robotLog: () => void;
};

export function installRobotDev(store: Store<GameState, GameAction>): void {
  const handle = window.__meadowlight;
  if (handle === undefined) return;

  const add = (preset: RobotPresetId, place?: RobotPlace): string => {
    let state = withBurnerKnown(store.getState());
    const target = selectTargetTile(state) ?? { tx: state.player.tx, tz: state.player.tz };
    const at = place ?? { tx: target.tx, tz: target.tz, facing: state.player.facing };
    const added: string[] = [];
    for (const spec of presetSpecs(preset, at)) {
      const result = addRobot(state, spec);
      if ('error' in result) return result.error;
      state = result.state;
      added.push(spec.name);
    }
    store.dispatch(actions.load(state));
    return `Added ${added.join(' and ')}.`;
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

  const hooks: RobotDevHandle = { addRobot: add, robotLog: log };
  Object.assign(handle, hooks);
}
