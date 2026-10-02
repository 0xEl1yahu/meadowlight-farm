/**
 * Building a block program's interpreter state (farmclaws part 2 spec §2.4, §7). Pure.
 */
import { TIME } from '../config';
import type { BlockProgram, RobotExec, Trigger } from '../core/types';
import { literalValue } from './program';

/** The first minute a trigger may fire in a fresh day: its time, the first `every` check, or null for the others. */
function firstDue(trigger: Trigger): number | null {
  if (trigger.kind === 'atTime') return trigger.minute;
  if (trigger.kind === 'every') return TIME.dayStartMinute + trigger.minutes;
  return null;
}

/**
 * An idle exec for a checked program at the start of a day: nothing running, every variable at
 * its initial value, every trigger's day unspent and no DO card done.
 */
export function freshExec(program: BlockProgram): RobotExec {
  return {
    running: null,
    frames: [],
    vars: program.vars.map((decl) => literalValue(decl.initial)),
    due: program.stacks.map((stack) => firstDue(stack.trigger)),
    firedToday: program.stacks.map(() => false),
    doneCards: [],
  };
}
