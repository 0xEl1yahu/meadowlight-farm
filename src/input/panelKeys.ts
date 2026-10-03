/**
 * Panel and menu keys, decided from the state alone so the rules can be tested without a DOM.
 *
 *   I              toggles the inventory; closes an open chest
 *   E, K, Enter    interact, or close an open inventory or chest instead; with Shift, peek
 *                  (planShiftInteraction: E's meaning at the workbench, else a robot's screen)
 *   B              toggles the seed shop; does nothing while the inventory or a chest is open
 *   Escape         closes any open panel, otherwise drops a zone draft, otherwise toggles pause
 *   (none)         while a robot screen is open: it owns the keyboard (part 3 spec §4.1)
 *
 * markerToolCommand decides the tool keys while the zone marker is selected.
 *
 * The reducer still has the last word: opening a panel while paused or while another panel is
 * open is rejected there.
 */
import type { GameState } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { isZoneMarkerSelected } from '../state/selectors';

/** Key codes that interact with the forward tile when no inventory or chest panel is open. */
export const INTERACT_KEYS: ReadonlySet<string> = new Set(['KeyE', 'KeyK', 'Enter', 'NumpadEnter']);

/** A game key that does nothing in the current state (its default is still prevented). */
export const IGNORED = 'ignored';

export type PanelKeyCommand = GameAction | typeof IGNORED;

/** True while the backpack or a chest is showing, i.e. the inventory screen is up. */
export function isInventoryScreenOpen(state: GameState): boolean {
  const kind = state.ui.panel.kind;
  return kind === 'inventory' || kind === 'chest';
}

/**
 * What a panel key does now: an action to dispatch, IGNORED for a game key with nothing to do,
 * or null when `code` is not a panel key. `shift` is whether Shift is held with the key.
 */
export function panelKeyCommand(code: string, state: GameState, shift = false): PanelKeyCommand | null {
  // The robot screen handles its own keys, Escape included; no key is a game key while it's open.
  if (state.ui.panel.kind === 'robot') return null;
  const panel = state.ui.panel.kind;
  if (INTERACT_KEYS.has(code)) {
    if (isInventoryScreenOpen(state)) return actions.closePanel();
    return shift ? actions.peek() : actions.interact();
  }
  switch (code) {
    case 'KeyI':
      if (panel === 'chest') return actions.closePanel();
      if (panel === 'shop') return IGNORED;
      return actions.setInventoryOpen(panel !== 'inventory');
    case 'KeyB':
      if (isInventoryScreenOpen(state)) return IGNORED;
      return actions.setShopOpen(panel !== 'shop');
    case 'Escape':
      if (panel !== 'none') return actions.closePanel();
      // A zone draft drops before Escape pauses (part 3 spec §8); while paused, Escape resumes.
      if (state.ui.zoneDraft !== null && !state.ui.paused) return actions.clearZoneDraft();
      return actions.setPaused(!state.ui.paused);
    default:
      return null;
  }
}

/**
 * A tool press (Space, J or a left click) while the zone marker is selected (part 3 spec §8):
 * only fresh presses count, so a held key never marks a second corner, and Shift picks the next
 * zone letter. IGNORED for a held-key repeat; null when the marker isn't selected, which leaves
 * the press to the ordinary tool path.
 */
export function markerToolCommand(state: GameState, shift: boolean, repeat: boolean): PanelKeyCommand | null {
  if (!isZoneMarkerSelected(state)) return null;
  if (repeat) return IGNORED;
  return shift ? actions.cycleZoneLetter() : actions.useTool();
}
