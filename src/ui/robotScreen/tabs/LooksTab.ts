/**
 * The Looks tab (farmclaws part 3 spec §3.4, §4.4): 16 paint swatches, a preview of the chosen
 * colour on a small robot, and "Paint · {cost}g". The reducer decides the job (it refuses the
 * same colour and short gold with a toast). A ruined robot's swatches are read-only, and so are a
 * workshop preview's, with no Paint button (part 4b spec §4.4).
 *
 * Under the paint, the Parts section (part 4b spec §5.1): the fitted parts with Take off, and the
 * backpack's parts with Fit. A preview or a ruined robot shows the fitted parts without buttons.
 */
import { ROBOT_PAINTS } from '../../../config';
import type { GameState, InventoryState, Robot, RobotPartId } from '../../../core/types';
import { withArticle } from '../../../core/text';
import { isPartItemId } from '../../../items/items';
import { actions } from '../../../state/actions';
import { closestWithin, h, hudButton, setAttr, setHidden, setText } from '../../dom';
import { createPartIcon, createRobotPreview } from '../partIcons';
import { PARTS_TEXT, isReadOnly, paintButtonText, paintHex, paintName, partsSectionView, type PartRow, type PartsSectionView } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class LooksTab implements RobotTabView {
  readonly element = h('div', 'rs-looks');
  private readonly preview = createRobotPreview();
  private readonly chosen = h('p', 'rs-looks__name');
  private readonly current = h('p', 'rs-looks__current');
  private readonly grid = h('div', 'rs-looks__swatches');
  private readonly paintButton = hudButton('hud-btn hud-btn--primary rs-looks__paint', paintButtonText());
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly parts = h('section', 'rs-parts');
  private readonly context: RobotTabContext;
  private selected = 0;
  private shown: Robot | null = null;
  /** What the Parts section shows, so a store change that doesn't touch it redraws nothing. */
  private partsKey = '';

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
    side.append(h('h3', 'rs-looks__heading', 'Paint'), this.grid, this.paintButton, this.parts);
    this.parts.setAttribute('aria-label', PARTS_TEXT.heading);
    this.parts.tabIndex = -1;
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
    this.parts.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, this.parts, 'button[data-part]');
        const part = button?.dataset.part;
        if (this.shown === null || !isPartItemId(part)) return;
        const id = this.shown.id;
        this.context.dispatch(button?.dataset.act === 'fit' ? actions.fitPart(id, part) : actions.unfitPart(id, part));
      },
      { signal },
    );
  }

  open(state: GameState): void {
    const robot = this.context.robot(state);
    if (robot === null) return;
    this.render(robot);
    this.select(robot.paint);
    this.syncParts(robot, state.inventory);
  }

  sync(state: GameState): void {
    const robot = this.context.robot(state);
    if (robot === null) return;
    this.syncParts(robot, state.inventory);
    if (robot === this.shown) return;
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

  private syncParts(robot: Robot, inventory: InventoryState): void {
    const view = partsSectionView(robot, this.context.mode, inventory);
    const names = (rows: readonly (PartRow | null)[]): string => rows.map((row) => row?.part ?? '-').join(' ');
    const key = `${robot.name}|${view.editable}|${names(view.slots)}|${names(view.fittable)}`;
    if (key === this.partsKey) return;
    this.partsKey = key;
    this.drawParts(robot, view);
  }

  private drawParts(robot: Robot, view: PartsSectionView): void {
    const fitted = h('ul', 'rs-parts__list');
    fitted.setAttribute('aria-label', PARTS_TEXT.fitted);
    for (const slot of view.slots) {
      if (slot === null) {
        fitted.append(h('li', 'rs-parts__row rs-parts__row--empty', PARTS_TEXT.emptySlot));
        continue;
      }
      const label = `Take the ${slot.name.toLowerCase()} off ${robot.name}`;
      fitted.append(this.partRow(slot, view.editable ? this.partButton(slot.part, 'unfit', PARTS_TEXT.takeOff, label) : null));
    }
    const children: HTMLElement[] = [h('h3', 'rs-looks__heading', PARTS_TEXT.heading), h('h4', 'rs-parts__heading', PARTS_TEXT.fitted), fitted];
    if (view.editable) {
      children.push(h('h4', 'rs-parts__heading', PARTS_TEXT.backpack));
      if (view.fittable.length === 0) {
        children.push(h('p', 'rs-parts__none', PARTS_TEXT.noneToFit));
      } else {
        const backpack = h('ul', 'rs-parts__list');
        backpack.setAttribute('aria-label', PARTS_TEXT.backpack);
        for (const row of view.fittable) {
          const label = `Fit ${withArticle(row.name.toLowerCase())} to ${robot.name}`;
          backpack.append(this.partRow(row, this.partButton(row.part, 'fit', PARTS_TEXT.fit, label)));
        }
        children.push(backpack);
      }
    }
    // A Fit or Take off redraws its own button away: keep the focus in the section.
    const hadFocus = this.parts.contains(document.activeElement);
    this.parts.replaceChildren(...children);
    if (hadFocus) this.parts.focus();
  }

  private partRow(row: PartRow, button: HTMLButtonElement | null): HTMLElement {
    const element = h('li', 'rs-parts__row');
    const chip = h('span', 'rs-part');
    chip.setAttribute('aria-hidden', 'true');
    chip.append(createPartIcon(row.part));
    element.append(chip, h('span', 'rs-parts__name', row.name));
    if (button !== null) element.append(button);
    return element;
  }

  private partButton(part: RobotPartId, act: 'fit' | 'unfit', text: string, label: string): HTMLButtonElement {
    const button = hudButton('hud-btn rs-parts__button', text);
    button.dataset.part = part;
    button.dataset.act = act;
    button.setAttribute('aria-label', label);
    return button;
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
