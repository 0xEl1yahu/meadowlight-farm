import type { GameState } from '../core/types';

/** Per-frame data handed to every render system. */
export interface FrameContext {
  /** Real seconds since the previous frame (clamped to ≤ 0.1). */
  readonly dt: number;
  /** Real seconds since boot. */
  readonly elapsed: number;
  readonly state: GameState;
  /**
   * Continuous clock: state.time.minuteOfDay plus the fixed-step accumulator fraction, so
   * lighting can move smoothly between discrete one-minute ticks. Range [360, 1560].
   */
  readonly clockMinutes: number;
}

/**
 * Contract for every visual subsystem.
 *
 * - `sync(state, prev)` runs after every state change. `prev === null` means "full rebuild":
 *   it happens once at startup and again whenever a whole new state is loaded, so it must be
 *   idempotent (clear everything you own, then rebuild from `state`).
 * - When `prev !== null`, diff the active map's world (`selectActiveWorld`) by reference:
 *   `world.chunks[i] !== prevWorld.chunks[i]` marks a dirty chunk, and within it `chunk.tiles[j] !== prevChunk.tiles[j]` marks a dirty
 *   tile. Never rescan unchanged chunks.
 * - `update(frame)` runs once per animation frame for animation only; it must not dispatch.
 * - `dispose()` releases every GPU resource the system created.
 */
export interface RenderSystem {
  sync(state: GameState, prev: GameState | null): void;
  update(frame: FrameContext): void;
  dispose(): void;
}
