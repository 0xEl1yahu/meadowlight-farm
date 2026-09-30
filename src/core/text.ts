/** Small pure text helpers shared by the reducer's messages and the robot log. */
import type { Quality } from './types';

/** Prefix naming a silver or gold quality in messages ("Gold Parsnip"); empty for normal quality. */
export function qualityPrefix(quality: Quality): string {
  return quality === 2 ? 'Gold ' : quality === 1 ? 'Silver ' : '';
}

/** "a", "a and b", "a, b and c"; `empty` when the list has nothing in it. */
export function joinWithAnd(list: readonly string[], empty: string): string {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1] ?? ''}` : (list[0] ?? empty);
}
