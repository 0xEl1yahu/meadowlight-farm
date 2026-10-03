/**
 * Building a block program's interpreter state (farmclaws part 2 spec §2.4, §7). Pure.
 */
import { TIME } from '../config';
import type { BlockProgram, RobotExec, Trigger } from '../core/types';
import { startStack } from './interpret';
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

/**
 * A fresh exec for a program set up at `minuteOfDay` rather than at the morning reset (spec §12):
 * an `atTime` trigger whose minute is earlier than `minuteOfDay` has already passed today, so its
 * `due` is spent (null). Every other trigger is as freshExec has it.
 */
export function execAt(program: BlockProgram, minuteOfDay: number): RobotExec {
  const exec = freshExec(program);
  const due = program.stacks.map((stack, i) =>
    stack.trigger.kind === 'atTime' && stack.trigger.minute < minuteOfDay ? null : (exec.due[i] ?? null),
  );
  return { ...exec, due };
}

/**
 * A block program's exec at the morning reset (spec §7): fresh, with the first `morning` stack
 * started. Idle when the program has no `morning` stack.
 */
export function morningExec(program: BlockProgram): RobotExec {
  const exec = freshExec(program);
  const index = program.stacks.findIndex((stack) => stack.trigger.kind === 'morning');
  return index === -1 ? exec : startStack(exec, index);
}
