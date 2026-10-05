/**
 * The .MD tab (farmclaws part 3 spec §4.3): the robot's Managing Directive as the design's
 * markdown card ("# {NAME}.MD", "## DO", "## DON'T"), one line per card with dropdowns and
 * number fields. "Add a card" lists the unlocked kinds; each card can move up or down within its
 * section or be removed; "{n} / {limit} cards" turns red over the limit. Save runs isMdShape and
 * checkMd (the sentence shows under the toolbar), then dispatches setRobotMd; the reducer runs
 * the same checks in withMd. A part 1 script robot gets a note instead of the editor; a ruined
 * robot's cards are read-only.
 */
import { MD_CARD_KINDS, type GameState, type MdCard, type Robot, type RobotSize, type RobotUnlocks } from '../../../core/types';
import { checkMd } from '../../../robots/check';
import { findRobot } from '../../../robots/world';
import { actions } from '../../../state/actions';
import { isMdShape } from '../../../state/robotValidation';
import { closestWithin, h, hudButton, setHidden, setText } from '../../dom';
import {
  MD_TEXT,
  addCardOptions,
  cardFields,
  cardSection,
  isMdFieldKey,
  mdCountText,
  mdOverLimit,
  mdTitle,
  moveCard,
  newCard,
  removeCard,
  setCardValue,
  type MdCardKind,
  type MdField,
} from '../mdFields';
import type { RobotTabContext, RobotTabView } from './tabView';

function isCardKind(value: string | undefined): value is MdCardKind {
  return (MD_CARD_KINDS as readonly (string | undefined)[]).includes(value);
}

export class MdTab implements RobotTabView {
  readonly element = h('div', 'rs-md');
  private readonly toolbar = h('div', 'rs-toolbar');
  private readonly counter = h('span', 'rs-counter');
  private readonly addButton = hudButton('hud-btn hud-btn--soft', MD_TEXT.addCard);
  private readonly addMenu = h('div', 'rs-popover rs-md__add');
  private readonly saveButton = hudButton('hud-btn hud-btn--primary', MD_TEXT.save);
  private readonly message = h('p', 'rs-message');
  private readonly note = h('p', 'rs-note', MD_TEXT.scriptOnly);
  private readonly file = h('div', 'rs-md__file');
  private readonly title = h('h3', 'rs-md__title');
  private readonly doList = h('ul', 'rs-md__cards');
  private readonly dontList = h('ul', 'rs-md__cards');
  private readonly context: RobotTabContext;
  private cards: readonly MdCard[] = [];
  /** The cards last loaded or saved. */
  private baseline: readonly MdCard[] = [];
  private shownUnlocks: RobotUnlocks | null = null;
  private shownRobot: Robot | null = null;
  private dirty = false;
  private saving = false;
  private readOnly = false;

  constructor(context: RobotTabContext) {
    this.context = context;
    const signal = context.signal;
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addMenu.hidden = true;
    this.addMenu.setAttribute('role', 'menu');
    this.addMenu.setAttribute('aria-label', MD_TEXT.addCard);
    this.toolbar.append(this.counter, this.addButton, h('span', 'rs-toolbar__spacer'), this.saveButton);
    this.message.setAttribute('role', 'status');
    this.note.hidden = true;
    this.file.append(
      this.title,
      h('h4', 'rs-md__section', MD_TEXT.doHeading),
      this.doList,
      h('h4', 'rs-md__section', MD_TEXT.dontHeading),
      this.dontList,
    );
    this.element.append(this.toolbar, this.message, this.note, this.addMenu, this.file);

    this.addButton.addEventListener('click', () => setHidden(this.addMenu, !this.addMenu.hidden), { signal });
    this.addMenu.addEventListener(
      'click',
      (event) => {
        const kind = closestWithin(event, this.addMenu, 'button[data-kind]')?.dataset.kind;
        if (isCardKind(kind)) this.addCard(kind);
      },
      { signal },
    );
    this.saveButton.addEventListener('click', () => this.save(), { signal });
    this.file.addEventListener('change', (event) => this.onFieldChange(event), { signal });
    this.file.addEventListener('click', (event) => this.onTool(event), { signal });
  }

  open(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    this.readOnly = robot.power === 'ruined';
    this.cards = robot.md;
    this.baseline = robot.md;
    this.dirty = false;
    this.syncAddMenu(state.robots.unlocks);
    this.render(robot);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    if (state.robots.unlocks !== this.shownUnlocks) this.syncAddMenu(state.robots.unlocks);
    if (robot === this.shownRobot) return;
    if (!this.saving && !this.dirty && robot.md !== this.baseline) {
      this.cards = robot.md;
      this.baseline = robot.md;
    }
    this.render(robot);
  }

  setActive(active: boolean): void {
    if (!active) setHidden(this.addMenu, true);
  }

  isDirty(): boolean {
    return this.dirty && !this.readOnly;
  }

  handleEscape(): boolean {
    if (this.addMenu.hidden) return false;
    setHidden(this.addMenu, true);
    return true;
  }

  dispose(): void {}

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private robot(): Robot | null {
    return findRobot(this.context.getState(), this.context.robotId);
  }

  private syncAddMenu(unlocks: RobotUnlocks): void {
    this.shownUnlocks = unlocks;
    this.addMenu.replaceChildren(
      ...addCardOptions(unlocks).map((option) => {
        const item = hudButton('rs-md__kind', option.label);
        item.dataset.kind = option.kind;
        item.setAttribute('role', 'menuitem');
        return item;
      }),
    );
  }

  private render(robot: Robot): void {
    this.shownRobot = robot;
    const script = robot.program.kind === 'script';
    setHidden(this.note, !script);
    setHidden(this.toolbar, script);
    setHidden(this.file, script);
    if (script) {
      setText(this.message, '');
      return;
    }
    setHidden(this.addButton, this.readOnly);
    setHidden(this.saveButton, this.readOnly);
    setText(this.title, mdTitle(robot.name));
    setText(this.counter, mdCountText(this.cards, robot.size));
    this.counter.classList.toggle('is-over', mdOverLimit(this.cards, robot.size));
    const doItems: HTMLElement[] = [];
    const dontItems: HTMLElement[] = [];
    this.cards.forEach((card, index) => {
      (cardSection(card) === 'do' ? doItems : dontItems).push(this.cardItem(card, index, robot.size));
    });
    this.doList.replaceChildren(...(doItems.length > 0 ? doItems : [h('li', 'rs-md__none', MD_TEXT.noCards)]));
    this.dontList.replaceChildren(...(dontItems.length > 0 ? dontItems : [h('li', 'rs-md__none', MD_TEXT.noCards)]));
  }

  private cardItem(card: MdCard, index: number, size: RobotSize): HTMLElement {
    const item = h('li', 'rs-md__card');
    item.dataset.index = String(index);
    item.append(h('span', 'rs-md__bullet', '-'));
    for (const field of cardFields(card, size)) item.append(this.fieldControl(field));
    if (!this.readOnly) {
      const tools = h('span', 'rs-md__tools');
      tools.append(
        this.toolButton('up', '↑', 'Move this card up'),
        this.toolButton('down', '↓', 'Move this card down'),
        this.toolButton('remove', '✕', 'Remove this card'),
      );
      item.append(tools);
    }
    return item;
  }

  private fieldControl(field: MdField): HTMLElement {
    switch (field.kind) {
      case 'text':
        return h('span', 'rs-md__text', field.text);
      case 'select': {
        const select = h('select', 'rs-input');
        select.dataset.key = field.key;
        select.setAttribute('aria-label', field.label);
        select.disabled = this.readOnly;
        for (const [label, value] of field.options) {
          const option = h('option', '', label);
          option.value = value;
          select.append(option);
        }
        select.value = field.value;
        return select;
      }
      case 'number': {
        const input = h('input', 'rs-input');
        input.type = 'number';
        input.dataset.key = field.key;
        input.setAttribute('aria-label', field.label);
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = '1';
        input.value = String(field.value);
        input.disabled = this.readOnly;
        return input;
      }
    }
  }

  private toolButton(action: 'up' | 'down' | 'remove', label: string, name: string): HTMLButtonElement {
    const button = hudButton('rs-md__tool', label);
    button.dataset.action = action;
    button.title = name;
    button.setAttribute('aria-label', name);
    return button;
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  private edit(cards: readonly MdCard[]): void {
    const robot = this.robot();
    if (robot === null) return;
    if (cards !== this.cards) {
      this.cards = cards;
      this.dirty = true;
    }
    this.render(robot);
  }

  private indexOf(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const item = target.closest('[data-index]');
    if (!(item instanceof HTMLElement) || !this.file.contains(item)) return null;
    const index = Number(item.dataset.index);
    return Number.isInteger(index) ? index : null;
  }

  private onFieldChange(event: Event): void {
    const target = event.target;
    if (this.readOnly || !(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
    const key = target.dataset.key;
    const index = this.indexOf(target);
    const robot = this.robot();
    const card = index === null ? undefined : this.cards[index];
    if (!isMdFieldKey(key) || index === null || card === undefined || robot === null) return;
    const next = setCardValue(card, key, target.value, robot);
    this.edit(next === card ? this.cards : this.cards.map((old, at) => (at === index ? next : old)));
  }

  private onTool(event: MouseEvent): void {
    if (this.readOnly) return;
    const button = closestWithin(event, this.file, 'button[data-action]');
    const index = this.indexOf(button);
    if (button === null || index === null) return;
    switch (button.dataset.action) {
      case 'up':
        this.edit(moveCard(this.cards, index, -1));
        break;
      case 'down':
        this.edit(moveCard(this.cards, index, 1));
        break;
      case 'remove':
        this.edit(removeCard(this.cards, index));
        break;
      default:
        break;
    }
  }

  private addCard(kind: MdCardKind): void {
    setHidden(this.addMenu, true);
    this.edit([...this.cards, newCard(kind)]);
  }

  private save(): void {
    const robot = this.robot();
    if (robot === null || this.readOnly) return;
    const cards = this.cards;
    if (!isMdShape(cards)) {
      setText(this.message, MD_TEXT.cantSave);
      return;
    }
    const problem = checkMd(cards, robot);
    if (problem !== null) {
      setText(this.message, problem);
      return;
    }
    setText(this.message, '');
    const before = robot.md;
    this.saving = true;
    try {
      this.context.dispatch(actions.setRobotMd(robot.id, cards));
    } finally {
      this.saving = false;
    }
    const after = this.robot();
    if (after !== null && after.md !== before) {
      this.cards = after.md;
      this.baseline = after.md;
      this.dirty = false;
      this.render(after);
    }
  }
}
