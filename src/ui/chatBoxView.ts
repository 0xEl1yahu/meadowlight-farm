/**
 * The chat box's pure parts (farmclaws part 4a spec §3.2, part 4c spec §2.2): what it shows for
 * the open talk panel, and when it takes its phone layout. ChatBox.ts draws it; the tests read it
 * without a DOM. The robot screen's phoneQuery lives in its lazy chunk, so the width rule is
 * restated here from the same ROBOT_SCREEN.phoneMaxWidth.
 */
import { ROBOT_SCREEN } from '../config';
import type { GameState, JobId, NpcId } from '../core/types';
import { JOBS_TABLE, giverJob, jobProgress } from '../jobs/jobs';
import { CAST, npcActions } from '../people/cast';
import { actions, type GameAction } from '../state/actions';

/** One button in the chat box's row. */
export interface ChatButton {
  readonly label: string;
  readonly action: GameAction;
  /** The main button style; otherwise the quiet one. */
  readonly primary: boolean;
}

/** The job card, in place of the line (part 4c spec §2.2). */
export interface JobCardView {
  readonly job: JobId;
  readonly title: string;
  readonly offer: string;
  readonly goal: string;
  /** The progress line while the job is active; null while it's offered. */
  readonly progress: string | null;
}

/**
 * What the chat box shows: who is talking, their role line, and either their line or their job
 * card, with the buttons for it: the character's action buttons under the line; Take the job and
 * Not now under an offered job's card, Close under an active one's.
 */
export interface ChatBoxView {
  readonly npc: NpcId;
  readonly name: string;
  readonly role: string;
  readonly line: string;
  readonly job: JobCardView | null;
  readonly buttons: readonly ChatButton[];
}

/**
 * The chat box for the open talk panel, or null when no talk panel is open. The line is the one
 * the panel carries, picked before the chat was recorded, so it never changes while the box is open.
 */
export function chatBoxView(state: GameState): ChatBoxView | null {
  const panel = state.ui.panel;
  if (panel.kind !== 'talk') return null;
  const { npc, line } = panel;
  const member = CAST[npc];
  const job = panel.card === 'job' ? giverJob(state, npc) : null;
  if (job === null) {
    const buttons = npcActions(state, npc).map((a): ChatButton => ({ label: a.label, action: actions.npcAct(npc, a.kind), primary: true }));
    return { npc, name: member.name, role: member.role, line, job: null, buttons };
  }
  const def = JOBS_TABLE[job];
  const progress = jobProgress(state, job);
  const buttons: readonly ChatButton[] =
    progress === null
      ? [
          { label: 'Take the job', action: actions.takeJob(job), primary: true },
          { label: 'Not now', action: actions.closePanel(), primary: false },
        ]
      : [{ label: 'Close', action: actions.closePanel(), primary: false }];
  return { npc, name: member.name, role: member.role, line, job: { job, title: def.title, offer: def.offer, goal: def.goal, progress }, buttons };
}

/** True below ROBOT_SCREEN.phoneMaxWidth, where the box spans the screen and its buttons wrap. */
export function isPhoneWidth(width: number): boolean {
  return width < ROBOT_SCREEN.phoneMaxWidth;
}
