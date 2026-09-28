import { MESSAGES } from '../config';
import type { GameMessage, GameState, MessageTone } from '../core/types';

/** Appends a message to the rolling log (keeps the newest MESSAGES.capacity entries). */
export function pushMessage(state: GameState, text: string, tone: MessageTone): GameState {
  const entry: GameMessage = {
    id: state.messages.nextId,
    text,
    tone,
    day: state.time.absoluteDay,
    minute: state.time.minuteOfDay,
  };
  const entries = [...state.messages.entries, entry].slice(-MESSAGES.capacity);
  return { ...state, messages: { nextId: entry.id + 1, entries } };
}
