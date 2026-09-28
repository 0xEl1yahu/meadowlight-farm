/**
 * Fixed-step accumulator that converts variable real frame time into whole simulation
 * steps (one step = one in-game minute). Rendering reads `fraction` to interpolate
 * continuous effects such as the sun position between discrete clock ticks.
 */
export class FixedStepClock {
  private accumulator = 0;
  private readonly stepSeconds: number;
  private readonly maxStepsPerAdvance: number;

  constructor(stepSeconds: number, maxStepsPerAdvance: number) {
    this.stepSeconds = stepSeconds;
    this.maxStepsPerAdvance = maxStepsPerAdvance;
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      throw new RangeError(`FixedStepClock: stepSeconds must be a positive finite number, got ${stepSeconds}`);
    }
    if (!Number.isInteger(maxStepsPerAdvance) || maxStepsPerAdvance < 1) {
      throw new RangeError(`FixedStepClock: maxStepsPerAdvance must be a positive integer, got ${maxStepsPerAdvance}`);
    }
  }

  /**
   * Adds `scaledSeconds` of simulated time and returns the number of whole steps that elapsed.
   * Steps beyond `maxStepsPerAdvance` are dropped (the remainder is discarded) so a long
   * stall never produces a burst of catch-up work.
   */
  advance(scaledSeconds: number): number {
    if (!(scaledSeconds > 0) || !Number.isFinite(scaledSeconds)) return 0;
    this.accumulator += scaledSeconds;
    let steps = Math.floor(this.accumulator / this.stepSeconds);
    if (steps > this.maxStepsPerAdvance) {
      steps = this.maxStepsPerAdvance;
      this.accumulator = 0;
      return steps;
    }
    this.accumulator -= steps * this.stepSeconds;
    return steps;
  }

  /** Progress toward the next step, in [0, 1). */
  get fraction(): number {
    return Math.min(0.999999, Math.max(0, this.accumulator / this.stepSeconds));
  }

  reset(): void {
    this.accumulator = 0;
  }
}
