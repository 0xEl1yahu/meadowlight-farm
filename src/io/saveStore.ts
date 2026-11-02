/**
 * Where the save lives: localStorage under one key. The serialising, migrating and validating is
 * state/persistence.ts; this file is the only place that touches storage for saves.
 */
import type { GameState } from '../core/types';
import { deserializeGame, serializeGame } from '../state/persistence';

export const SAVE_KEY = 'meadowlight-farm.save.v1';

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): boolean {
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(SAVE_KEY, serializeGame(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    return raw === null || raw === undefined ? null : deserializeGame(raw);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable (private mode, sandboxed iframe): nothing to clear.
  }
}
