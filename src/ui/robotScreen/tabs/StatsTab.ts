/**
 * The Stats tab (farmclaws part 3 spec §4.5): tokens used, actions taken, crops handled and
 * tokens per crop, Today beside This week.
 */
import type { GameState, Robot } from '../../../core/types';
import { h } from '../../dom';
import { statsRows } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class StatsTab implements RobotTabView {
  readonly element = h('div', 'rs-stats');
  private readonly rows = h('tbody', '');
  private readonly context: RobotTabContext;
  private shown: Robot['stats'] | null = null;

  constructor(context: RobotTabContext) {
    this.context = context;
    const table = h('table', 'rs-stats__table');
    const head = h('thead', '');
    const headRow = h('tr', '');
    const corner = h('th', '');
    corner.scope = 'col';
    const today = h('th', '', 'Today');
    today.scope = 'col';
    const week = h('th', '', 'This week');
    week.scope = 'col';
    headRow.append(corner, today, week);
    head.append(headRow);
    table.append(head, this.rows);
    this.element.append(table);
  }

  open(state: GameState): void {
    this.sync(state);
  }

  sync(state: GameState): void {
    const robot = this.context.robot(state);
    if (robot === null || robot.stats === this.shown) return;
    this.shown = robot.stats;
    this.rows.replaceChildren(
      ...statsRows(robot).map((row) => {
        const tr = h('tr', '');
        const label = h('th', '', row.label);
        label.scope = 'row';
        tr.append(label, h('td', '', row.today), h('td', '', row.week));
        return tr;
      }),
    );
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}
}
