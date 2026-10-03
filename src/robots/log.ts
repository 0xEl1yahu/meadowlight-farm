/**
 * The farm log: structured facts about what robots really did (farmclaws part 1 spec §5.6).
 */
import { ROBOTS } from '../config';
import type { GameState, RobotLogEntry, RobotLogEvent } from '../core/types';
import { requireRobot } from './world';

/** Events are small plain objects built in one key order, so their JSON is a faithful equality key. */
function sameEvent(a: RobotLogEvent, b: RobotLogEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Appends an event for `robotId` at the current day, minute and the robot's tile. If the most
 * recent entry of that robot is from today and has an equal event, its count goes up instead
 * (farmclaws part 3 spec §6.2).
 */
export function logRobotEvent(state: GameState, robotId: number, event: RobotLogEvent): GameState {
  const robot = requireRobot(state, robotId);
  const { nextId, entries } = state.robots.log;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.robotId !== robotId) continue;
    if (entry.day !== state.time.absoluteDay || !sameEvent(entry.event, event)) break;
    const next = entries.slice();
    next[i] = { ...entry, count: entry.count + 1 };
    return { ...state, robots: { ...state.robots, log: { nextId, entries: next } } };
  }
  const entry: RobotLogEntry = {
    id: nextId,
    day: state.time.absoluteDay,
    minute: state.time.minuteOfDay,
    robotId,
    tx: robot.tx,
    tz: robot.tz,
    event,
    count: 1,
  };
  const next = [...entries, entry].slice(-ROBOTS.logCapacity);
  return { ...state, robots: { ...state.robots, log: { nextId: nextId + 1, entries: next } } };
}

/** Drops entries older than yesterday; the same state when nothing is dropped. */
export function pruneRobotLog(state: GameState): GameState {
  const oldest = state.time.absoluteDay - 1;
  const { entries } = state.robots.log;
  if (entries.every((e) => e.day >= oldest)) return state;
  return { ...state, robots: { ...state.robots, log: { ...state.robots.log, entries: entries.filter((e) => e.day >= oldest) } } };
}
