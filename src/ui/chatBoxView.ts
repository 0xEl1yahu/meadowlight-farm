/**
 * The chat box's pure parts (farmclaws part 4a spec §3.2): what it shows for the open talk panel,
 * and when it takes its phone layout. ChatBox.ts draws it; the tests read it without a DOM.
 * The robot screen's phoneQuery lives in its lazy chunk, so the width rule is restated here
 * from the same ROBOT_SCREEN.phoneMaxWidth.
 */
import { ROBOT_SCREEN } from '../config';
import type { GameState, NpcId } from '../core/types';
import { CAST, npcActions, type NpcAction } from '../people/cast';

/** What the chat box shows: who is talking, their role line, their line and their action buttons. */
export interface ChatBoxView {
  readonly npc: NpcId;
  readonly name: string;
  readonly role: string;
  readonly line: string;
  readonly actions: readonly NpcAction[];
}

/**
 * The chat box for the open talk panel, or null when no talk panel is open. The line is the one
 * the panel carries, picked before the chat was recorded, so it never changes while the box is open.
 */
export function chatBoxView(state: GameState): ChatBoxView | null {
  const panel = state.ui.panel;
  if (panel.kind !== 'talk') return null;
  const member = CAST[panel.npc];
  return { npc: panel.npc, name: member.name, role: member.role, line: panel.line, actions: npcActions(panel.npc) };
}

/** True below ROBOT_SCREEN.phoneMaxWidth, where the box spans the screen and its buttons wrap. */
export function isPhoneWidth(width: number): boolean {
  return width < ROBOT_SCREEN.phoneMaxWidth;
}
