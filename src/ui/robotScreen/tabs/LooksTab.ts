/**
 * The Looks tab (farmclaws part 3 spec §3.4, §4.4): 16 paint swatches, a preview of the chosen
 * colour on a small robot, and "Paint · {cost}g". The reducer decides the job (it refuses the
 * same colour and short gold with a toast). A ruined robot's swatches are read-only, and so are a
 * workshop preview's, with no Paint button (part 4b spec §4.4).
 */
import { ROBOT_PAINTS } from '../../../config';
import type { GameState, Robot } from '../../../core/types';
import { actions } from '../../../state/actions';
import { closestWithin, h, hudButton, setAttr, setHidden, setText } from '../../dom';
import { createRobotPreview } from '../partIcons';
import { isReadOnly, paintButtonText, paintHex, paintName } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class LooksTab implements RobotTabView {
  readonly element = h('div', 'rs-looks');
  private readonly preview = createRobotPreview();
  private readonly chosen = h('p', 'rs-looks__name');
  private readonly current = h('p', 'rs-looks__current');
  private readonly grid = h('div', 'rs-looks__swatches');
  private readonly paintButton = hudButton('hud-btn hud-btn--primary rs-looks__paint', paintButtonText());
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly context: RobotTabContext;
  private selected = 0;
  private shown: Robot | null = null;

  constructor(context: RobotTabContext) {
    this.context = context;
    const previewBox = h('div', 'rs-looks__preview');
    previewBox.append(this.preview.element, this.chosen, this.current);

    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', 'Paint colours');
    ROBOT_PAINTS.forEach((paint, index) => {
      const swatch = hudButton('rs-swatch');
      swatch.style.setProperty('--swatch', paintHex(paint.color));
      swatch.dataset.paint = String(index);
      swatch.title = paint.name;
      swatch.setAttribute('aria-label', paint.name);
      swatch.setAttribute('aria-pressed', 'false');
      this.grid.append(swatch);
      this.swatches.push(swatch);
    });

    const side = h('div', 'rs-looks__side');
    side.append(h('h3', 'rs-looks__heading', 'Paint'), this.grid, this.paintButton);
    this.element.append(previewBox, side);

    const signal = context.signal;
    this.grid.addEventListener(
      'click',
      (event) => {
        const swatch = closestWithin(event, this.grid, 'button[data-paint]');
        if (!(swatch instanceof HTMLButtonElement) || swatch.disabled) return;
        this.select(Number(swatch.dataset.paint));
      },
      { signal },
    );
    this.paintButton.addEventListener(
      'click',
      () => {
        if (this.shown !== null) this.context.dispatch(actions.paintRobot(this.shown.id, this.selected));
      },
      { signal },
    );
  }

  open(state: GameState): void {
    const robot = this.context.robot(state);
    if (robot === null) return;
    this.render(robot);
    this.select(robot.paint);
  }

  sync(state: GameState): void {
    const robot = this.context.robot(state);
    if (robot === null || robot === this.shown) return;
    if (this.shown !== null && robot.paint === this.shown.paint && robot.power === this.shown.power && robot.name === this.shown.name) {
      this.shown = robot;
      return;
    }
    this.render(robot);
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}

  private render(robot: Robot): void {
    this.shown = robot;
    const readOnly = isReadOnly(robot, this.context.mode);
    for (const swatch of this.swatches) {
      if (swatch.disabled !== readOnly) swatch.disabled = readOnly;
      swatch.classList.toggle('is-current', Number(swatch.dataset.paint) === robot.paint);
    }
    setHidden(this.paintButton, readOnly);
    setText(this.current, `${robot.name} is painted ${paintName(robot.paint)}.`);
  }

  private select(index: number): void {
    const paint = ROBOT_PAINTS[index];
    if (paint === undefined) return;
    this.selected = index;
    for (const swatch of this.swatches) setAttr(swatch, 'aria-pressed', String(Number(swatch.dataset.paint) === index));
    this.preview.paint(paint.color);
    setText(this.chosen, paint.name);
  }
}
