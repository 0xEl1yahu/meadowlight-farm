/**
 * The Log tab (farmclaws part 3 spec §4.6): "Robot says" beside "What happened", newest first,
 * today then yesterday, each row starting with its time and with ×{count} on merged entries.
 * With nothing today it says "Nothing yet today." above yesterday's rows.
 */
import type { GameState } from '../../../core/types';
import { h } from '../../dom';
import { LOG_TEXT, countText, logRows, type LogRow } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class LogTab implements RobotTabView {
  readonly element = h('div', 'rs-log');
  private readonly list = h('ol', 'rs-log__list');
  private readonly robotId: number;

  constructor(context: RobotTabContext) {
    this.robotId = context.robotId;
    const head = h('div', 'rs-log__head');
    head.setAttribute('aria-hidden', 'true');
    head.append(h('span', '', 'Time'), h('span', '', 'Robot says'), h('span', '', 'What happened'));
    this.element.append(head, this.list);
  }

  open(state: GameState): void {
    this.render(state);
  }

  sync(state: GameState, prev: GameState): void {
    if (
      state.robots.log === prev.robots.log &&
      state.robots.list === prev.robots.list &&
      state.time.absoluteDay === prev.time.absoluteDay
    ) {
      return;
    }
    this.render(state);
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}

  private render(state: GameState): void {
    const rows = logRows(state, this.robotId);
    const today = rows.filter((row) => !row.yesterday);
    const yesterday = rows.filter((row) => row.yesterday);
    const items: HTMLElement[] = [];
    if (today.length === 0) items.push(h('li', 'rs-log__empty', LOG_TEXT.empty));
    items.push(...today.map((row) => this.rowItem(row)));
    if (yesterday.length > 0) {
      items.push(h('li', 'rs-log__day', LOG_TEXT.yesterday));
      items.push(...yesterday.map((row) => this.rowItem(row)));
    }
    this.list.replaceChildren(...items);
  }

  private rowItem(row: LogRow): HTMLElement {
    const item = h('li', 'rs-log__row');
    const says = h('span', 'rs-log__says', row.says);
    const count = countText(row.count);
    if (count !== '') says.append(h('span', 'rs-log__count', count));
    item.append(h('span', 'rs-log__time', row.time), says, h('span', 'rs-log__happened', row.happened));
    return item;
  }
}
