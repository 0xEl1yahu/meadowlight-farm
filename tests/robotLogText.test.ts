/**
 * Every log event has an innocent "Robot says" line ending in ✓ and a truthful "What happened" line.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_BLOCK_REASONS, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { robotSays, whatHappened } from '../src/robots/logText';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';

const entry = (event: RobotLogEvent): RobotLogEntry => ({ id: 0, day: 0, minute: 400, robotId: 1, tx: 5, tz: 10, event, count: 1 });
const names = new Map([[1, 'Sprocket'], [2, 'Bolt'], [3, 'Cog']]);

function everyEvent(): RobotLogEvent[] {
  const events: RobotLogEvent[] = [
    { kind: 'shortedOut' },
    { kind: 'flat' },
    { kind: 'finished' },
    { kind: 'poweredDown' },
    { kind: 'repaired' },
    { kind: 'bickered', action: 'harvest', withIds: [2, 3] },
    { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 2, quality: 1 } },
    { kind: 'did', action: 'plant', detail: { kind: 'planted', cropId: 'potato' } },
    { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'bin', stacks: 2, quantity: 7 } },
    { kind: 'did', action: 'take', detail: { kind: 'items', into: 'bag', stacks: 1, quantity: 3 } },
  ];
  for (const action of ROBOT_ACTION_KINDS) events.push({ kind: 'did', action, detail: { kind: 'none' } });
  for (const action of ROBOT_ACTION_KINDS) for (const reason of ROBOT_BLOCK_REASONS) events.push({ kind: 'blocked', action, reason });
  return events;
}

describe('log text', () => {
  it('gives every event a ✓ line and a truthful line', () => {
    for (const event of everyEvent()) {
      const e = entry(event);
      expect(robotSays(e)).toMatch(/ ✓$/);
      const truth = whatHappened(e, names);
      expect(truth.length).toBeGreaterThan(5);
      expect(truth).not.toContain('✓');
    }
  });

  it('speaks plainly about specific outcomes', () => {
    expect(whatHappened(entry({ kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 2, quality: 1 } }), names)).toBe('Harvested Silver Parsnip ×2.');
    expect(whatHappened(entry({ kind: 'bickered', action: 'harvest', withIds: [2, 3] }), names)).toBe('Fought Bolt and Cog over the same tile. Nobody got it.');
    expect(whatHappened(entry({ kind: 'blocked', action: 'harvest', reason: 'nothingToHarvest' }), names)).toBe('Tried to harvest, but nothing was ready.');
    expect(whatHappened(entry({ kind: 'shortedOut' }), names)).toBe('Drove into the water and shorted out.');
    expect(robotSays(entry({ kind: 'shortedOut' }))).toBe('Taking a swim ✓');
    expect(robotSays(entry({ kind: 'blocked', action: 'harvest', reason: 'bagFull' }))).toBe('Harvested ✓');
  });
});
