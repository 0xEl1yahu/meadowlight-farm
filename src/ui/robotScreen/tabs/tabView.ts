/**
 * What the robot screen gives each tab, and what each tab gives back (farmclaws part 3 spec §4).
 */
import type { GameState } from '../../../core/types';
import type { GameAction } from '../../../state/actions';
import type { RobotScreenMode } from '../viewModel';

export interface RobotTabContext {
  readonly robotId: number;
  readonly mode: RobotScreenMode;
  readonly dispatch: (action: GameAction) => void;
  /** The store's current state, for click handlers. */
  readonly getState: () => GameState;
  /** Aborted when the screen closes: every listener a tab adds is registered with it. */
  readonly signal: AbortSignal;
}

export interface RobotTabView {
  readonly element: HTMLElement;
  /** Draws the tab for the robot in `state`. Called once, when the tab is first shown. */
  open(state: GameState): void;
  /** Called on every store change while the screen is open. */
  sync(state: GameState, prev: GameState): void;
  /** The tab became visible (true) or hidden (false). */
  setActive(active: boolean): void;
  /** True while the tab holds edits that aren't saved. */
  isDirty(): boolean;
  /** Escape was pressed: true when the tab used it (closed a dropdown, menu or prompt). */
  handleEscape(): boolean;
  dispose(): void;
}
