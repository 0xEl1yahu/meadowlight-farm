/**
 * The robot screen (farmclaws part 3 spec §4): a full-screen panel for one robot, in bench mode
 * (editable), peek mode (Stats and Log only) or preview mode (a workshop robot's Program and
 * Looks, read-only, part 4b spec §4.4). It is loaded lazily by RobotScreenHost.
 *
 * - Header: the robot's name, size, part icons, tokens / battery, power and off text; in bench
 *   mode the On / Off switch, Lift off and Scrap. A preview shows the size and "From Juniper's
 *   workshop" instead of the name and power. The close button is always there.
 * - The robot comes from viewModel.screenRobot: the state's robot, or the catalogue robot in a
 *   preview, which isn't in the state, so a preview never dispatches an edit. Closing a preview
 *   goes back to the workshop (the reducer's ui/closePanel).
 * - Tabs: Program, .MD, Looks, Stats and Log in that order, each shown only when its unlock is in
 *   `robots.unlocks` and the mode allows it (viewModel.visibleTabs), and only when this build has
 *   a view for it (TAB_FACTORIES). A view is built the first time its tab is shown and kept until
 *   the screen closes, so switching tabs keeps edits. Arrow keys, Home and End move between
 *   tabs in the strip (viewModel.nextTab).
 * - Keys: InputController ignores every key while a robot panel is open. The screen listens on
 *   the window in the capture phase, so it hears Escape before Blockly's own handlers (Blockly's
 *   widget container stops propagation). The active tab gets the first chance to use it (an open
 *   dropdown, menu or prompt closes); otherwise the screen closes, and only then is the event
 *   stopped, so InputController never turns it into a pause.
 * - Leaving with unsaved Program or .MD edits (Escape, the close button, Lift off) first asks
 *   "Discard your changes to {name}'s program?". Scrap asks its own question, which also
 *   discards edits.
 * - Phone width (under ROBOT_SCREEN.phoneMaxWidth) sets data-layout="phone": the tabs become a
 *   strip under the header and the active tab fills the rest of the screen.
 * - It dispatches only from DOM event handlers.
 */
import './robotScreen.css';
import type { Store } from '../../core/store';
import { ROBOT_TABS, type GameState, type Robot, type RobotTab } from '../../core/types';
import { actions, type GameAction } from '../../state/actions';
import { closestWithin, h, hudButton, iconHost, setAttr, setHidden, setText, setTitle } from '../dom';
import { createBoltIcon, createCloseIcon } from '../icons';
import { createPartIcon } from './partIcons';
import { LogTab } from './tabs/LogTab';
import { LooksTab } from './tabs/LooksTab';
import { MdTab } from './tabs/MdTab';
import { ProgramTab } from './tabs/ProgramTab';
import { StatsTab } from './tabs/StatsTab';
import type { RobotTabContext, RobotTabView } from './tabs/tabView';
import {
  EMPTY_TABS_TEXT,
  PART_LABELS,
  TAB_LABELS,
  discardPrompt,
  hasBenchActions,
  headerView,
  isEditTab,
  nextTab,
  phoneQuery,
  ruinedNote,
  samePanel,
  scrapPrompt,
  screenRobot,
  switchView,
  visibleTabs,
  type RobotPanel,
  type RobotScreenMode,
} from './viewModel';

export interface RobotScreenOptions {
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

type TabFactory = (context: RobotTabContext) => RobotTabView;

/** The view of each tab. */
const TAB_FACTORIES: Readonly<Record<RobotTab, TabFactory>> = {
  program: (context) => new ProgramTab(context),
  md: (context) => new MdTab(context),
  looks: (context) => new LooksTab(context),
  stats: (context) => new StatsTab(context),
  log: (context) => new LogTab(context),
};

/** One robot shown, from open() to close(). */
interface Session {
  readonly panel: RobotPanel;
  readonly mode: RobotScreenMode;
  readonly abort: AbortController;
  readonly context: RobotTabContext;
  readonly views: Map<RobotTab, RobotTabView>;
  active: RobotTab | null;
  /** The robot last drawn in the header. */
  shown: Robot | null;
}

function isRobotTab(value: string | undefined): value is RobotTab {
  return (ROBOT_TABS as readonly (string | undefined)[]).includes(value);
}

function stopKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

let screenCount = 0;

export class RobotScreen {
  readonly element = h('div', 'robot-screen');
  private readonly card = h('div', 'rs-card');
  private readonly name = h('h2', 'rs-header__name');
  private readonly size = h('span', 'rs-tag rs-header__size');
  private readonly parts = h('span', 'rs-header__parts');
  private readonly tokensText = h('span', '');
  private readonly power = h('span', 'rs-tag rs-header__power');
  private readonly off = h('span', 'rs-tag rs-header__off');
  private readonly benchActions = h('div', 'rs-header__actions');
  private readonly switchButton = hudButton('hud-btn hud-btn--soft rs-switch');
  private readonly liftButton = hudButton('hud-btn hud-btn--soft', 'Lift off');
  private readonly scrapButton = hudButton('hud-btn hud-btn--danger', 'Scrap');
  private readonly closeButton = hudButton('hud-iconbtn rs-close');
  private readonly tabStrip = h('div', 'rs-tabs');
  private readonly tabButtons = new Map<RobotTab, HTMLButtonElement>();
  private readonly note = h('p', 'rs-note rs-note--ruined');
  private readonly body = h('div', 'rs-body');
  private readonly empty = h('p', 'rs-empty', EMPTY_TABS_TEXT);
  private readonly dialog = h('div', 'rs-dialog');
  private readonly dialogText = h('p', 'rs-dialog__text');
  private readonly dialogYes = hudButton('hud-btn hud-btn--danger');
  private readonly dialogNo = hudButton('hud-btn hud-btn--soft');
  private readonly store: Store<GameState, GameAction>;
  /** Aborted on dispose: the screen's own listeners. */
  private readonly lifetime = new AbortController();
  private readonly phone: MediaQueryList | null;
  private session: Session | null = null;
  private onDialogYes: (() => void) | null = null;

  constructor(options: RobotScreenOptions) {
    screenCount += 1;
    this.store = options.store;
    const titleId = `robot-screen-${screenCount}-title`;
    const signal = this.lifetime.signal;

    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);
    this.name.id = titleId;
    this.card.tabIndex = -1;

    const identity = h('div', 'rs-header__id');
    identity.append(this.name, this.size, this.parts);
    const tokens = h('span', 'rs-header__tokens');
    tokens.append(iconHost('rs-header__bolt', createBoltIcon()), this.tokensText);
    const status = h('div', 'rs-header__status');
    status.append(tokens, this.power, this.off);
    this.benchActions.append(this.switchButton, this.liftButton, this.scrapButton);
    this.closeButton.setAttribute('aria-label', 'Close the robot screen');
    this.closeButton.title = 'Close (Esc)';
    this.closeButton.append(createCloseIcon());
    const header = h('header', 'rs-header');
    header.append(identity, status, this.benchActions, this.closeButton);

    this.tabStrip.setAttribute('role', 'tablist');
    this.tabStrip.setAttribute('aria-label', 'Robot screen');
    for (const tab of ROBOT_TABS) {
      if (TAB_FACTORIES[tab] === undefined) continue;
      const button = hudButton('rs-tab', TAB_LABELS[tab]);
      button.dataset.tab = tab;
      button.hidden = true;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      this.tabStrip.append(button);
      this.tabButtons.set(tab, button);
    }

    this.note.hidden = true;
    this.empty.hidden = true;
    const main = h('div', 'rs-main');
    main.append(this.note, this.body, this.empty);
    this.card.append(header, this.tabStrip, main);

    const dialogCard = h('div', 'rs-dialog__card');
    dialogCard.setAttribute('role', 'alertdialog');
    dialogCard.setAttribute('aria-modal', 'true');
    const dialogActions = h('div', 'rs-dialog__actions');
    dialogActions.append(this.dialogNo, this.dialogYes);
    dialogCard.append(this.dialogText, dialogActions);
    this.dialog.hidden = true;
    this.dialog.append(dialogCard);

    this.element.append(h('div', 'rs-backdrop'), this.card, this.dialog);
    options.root.append(this.element);

    this.closeButton.addEventListener('click', () => this.leave(() => this.store.dispatch(actions.closePanel())), { signal });
    this.switchButton.addEventListener('click', () => this.onSwitch(), { signal });
    this.liftButton.addEventListener('click', () => this.onLiftOff(), { signal });
    this.scrapButton.addEventListener('click', () => this.onScrap(), { signal });
    this.tabStrip.addEventListener(
      'click',
      (event) => {
        const tab = closestWithin(event, this.tabStrip, 'button[data-tab]')?.dataset.tab;
        if (isRobotTab(tab)) this.activate(tab, this.store.getState());
      },
      { signal },
    );
    this.tabStrip.addEventListener('keydown', (event) => this.onTabKey(event), { signal });
    this.dialogYes.addEventListener(
      'click',
      () => {
        const confirmed = this.onDialogYes;
        this.closeDialog();
        confirmed?.();
      },
      { signal },
    );
    this.dialogNo.addEventListener('click', () => this.closeDialog(), { signal });

    this.phone = typeof window.matchMedia === 'function' ? window.matchMedia(phoneQuery()) : null;
    this.phone?.addEventListener('change', () => this.syncLayout(), { signal });
    this.syncLayout();
  }

  /** Shows the robot named by `state.ui.panel` (a robot panel), starting a fresh session. */
  open(state: GameState): void {
    const panel = state.ui.panel;
    if (panel.kind !== 'robot') return;
    this.endSession();
    const robot = screenRobot(state, panel);
    if (robot === null) return;
    const abort = new AbortController();
    const context: RobotTabContext = {
      robot: (current) => screenRobot(current, panel),
      mode: panel.mode,
      dispatch: (action) => {
        this.store.dispatch(action);
      },
      getState: () => this.store.getState(),
      signal: abort.signal,
    };
    this.session = { panel, mode: panel.mode, abort, context, views: new Map(), active: null, shown: null };
    window.addEventListener('keydown', this.onKeyDown, { capture: true, signal: abort.signal });
    this.element.dataset.mode = panel.mode;
    setHidden(this.benchActions, !hasBenchActions(panel.mode));
    setHidden(this.element, false);
    this.syncHeader(robot);
    this.syncTabs(state);
    this.card.focus();
  }

  sync(state: GameState, prev: GameState): void {
    const session = this.session;
    const panel = state.ui.panel;
    if (session === null || panel.kind !== 'robot') return;
    if (!samePanel(panel, session.panel)) {
      this.open(state);
      return;
    }
    const robot = session.context.robot(state);
    if (robot === null) return;
    if (robot !== session.shown) this.syncHeader(robot);
    if (state.robots.unlocks !== prev.robots.unlocks) this.syncTabs(state);
    for (const view of session.views.values()) view.sync(state, prev);
  }

  close(): void {
    this.closeDialog();
    this.endSession();
    setHidden(this.element, true);
  }

  dispose(): void {
    this.close();
    this.lifetime.abort();
    this.element.remove();
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  private endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    for (const view of session.views.values()) view.dispose();
    this.body.replaceChildren();
    session.abort.abort();
  }

  private robot(): Robot | null {
    const session = this.session;
    return session === null ? null : session.context.robot(this.store.getState());
  }

  private isDirty(): boolean {
    const session = this.session;
    if (session === null) return false;
    for (const view of session.views.values()) if (view.isDirty()) return true;
    return false;
  }

  /** Runs `then` now, or after "Discard" when a tab holds unsaved edits. */
  private leave(then: () => void): void {
    const robot = this.robot();
    if (robot !== null && this.isDirty()) {
      this.ask(discardPrompt(robot.name), 'Discard', 'Keep editing', then);
      return;
    }
    then();
  }

  private onSwitch(): void {
    const session = this.session;
    const robot = this.robot();
    if (session === null || robot === null) return;
    const view = switchView(robot, session.mode);
    if (view !== null) this.store.dispatch(actions.switchRobot(robot.id, view.on));
  }

  private onLiftOff(): void {
    const robot = this.robot();
    if (robot === null) return;
    this.leave(() => this.store.dispatch(actions.liftOffBench(robot.id)));
  }

  private onScrap(): void {
    const robot = this.robot();
    if (robot === null) return;
    this.ask(scrapPrompt(robot), 'Scrap', 'Keep', () => this.store.dispatch(actions.scrapRobot(robot.id)));
  }

  // -------------------------------------------------------------------------
  // Keys
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    if (!this.dialog.hidden) {
      stopKey(event);
      this.closeDialog();
      return;
    }
    const view = this.activeView();
    if (view !== null && view.handleEscape()) return;
    stopKey(event);
    if (!event.repeat) this.leave(() => this.store.dispatch(actions.closePanel()));
  };

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  private activeView(): RobotTabView | null {
    const session = this.session;
    if (session === null || session.active === null) return null;
    return session.views.get(session.active) ?? null;
  }

  /** Arrow keys, Home and End move between the visible tabs, activating and focusing the new one. */
  private onTabKey(event: KeyboardEvent): void {
    const session = this.session;
    if (session === null || session.active === null) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const state = this.store.getState();
    const tab = nextTab(this.shownTabs(state), session.active, event.key);
    if (tab === null) return;
    event.preventDefault();
    this.activate(tab, state);
    this.tabButtons.get(tab)?.focus();
  }

  private shownTabs(state: GameState): readonly RobotTab[] {
    const session = this.session;
    if (session === null) return [];
    return visibleTabs(session.mode, state.robots.unlocks).filter((tab) => TAB_FACTORIES[tab] !== undefined);
  }

  private syncTabs(state: GameState): void {
    const session = this.session;
    if (session === null) return;
    const tabs = this.shownTabs(state);
    for (const [tab, button] of this.tabButtons) setHidden(button, !tabs.includes(tab));
    if (session.active === null || !tabs.includes(session.active)) this.activate(tabs[0] ?? null, state);
  }

  private activate(tab: RobotTab | null, state: GameState): void {
    const session = this.session;
    if (session === null || (tab !== null && tab === session.active)) return;
    const previous = this.activeView();
    if (previous !== null) {
      previous.setActive(false);
      setHidden(previous.element, true);
    }
    session.active = tab;
    for (const [key, button] of this.tabButtons) {
      setAttr(button, 'aria-selected', String(key === tab));
      button.tabIndex = key === tab ? 0 : -1;
    }
    setHidden(this.empty, tab !== null);
    if (tab !== null) {
      let view = session.views.get(tab);
      if (view === undefined) {
        const factory = TAB_FACTORIES[tab];
        if (factory === undefined) return;
        view = factory(session.context);
        view.element.setAttribute('role', 'tabpanel');
        setHidden(view.element, true);
        session.views.set(tab, view);
        this.body.append(view.element);
        view.open(state);
      }
      setHidden(view.element, false);
      view.setActive(true);
    }
    this.syncNote();
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  private syncHeader(robot: Robot): void {
    const session = this.session;
    if (session === null) return;
    session.shown = robot;
    const view = headerView(robot, session.mode);
    setText(this.name, view.name);
    setText(this.size, view.sizeLabel);
    const partsKey = view.parts.join(' ');
    if (this.parts.dataset.parts !== partsKey) {
      this.parts.dataset.parts = partsKey;
      this.parts.replaceChildren(
        ...(view.parts.length === 0
          ? [h('span', 'rs-header__noparts', 'No parts')]
          : view.parts.map((part) => {
              const chip = h('span', 'rs-part');
              chip.title = PART_LABELS[part];
              chip.setAttribute('role', 'img');
              chip.setAttribute('aria-label', PART_LABELS[part]);
              chip.append(createPartIcon(part));
              return chip;
            })),
      );
    }
    setText(this.tokensText, view.tokens);
    setHidden(this.power, view.power === null);
    setText(this.power, view.power ?? '');
    this.power.dataset.power = robot.power;
    setHidden(this.off, view.offText === null);
    setText(this.off, view.offText ?? '');
    const toggle = switchView(robot, session.mode);
    setHidden(this.switchButton, toggle === null);
    if (toggle !== null) {
      const label = `Switch ${robot.name} ${toggle.on ? 'on' : 'off'}`;
      setText(this.switchButton, toggle.label);
      setAttr(this.switchButton, 'aria-label', label);
      setTitle(this.switchButton, label);
    }
    this.syncNote();
  }

  /** The ruined note over the Program, .MD and Looks tabs of a ruined robot on the bench. */
  private syncNote(): void {
    const session = this.session;
    const robot = session?.shown ?? null;
    const text =
      session !== null && robot !== null && session.mode === 'bench' && session.active !== null && isEditTab(session.active)
        ? ruinedNote(robot)
        : null;
    setHidden(this.note, text === null);
    setText(this.note, text ?? '');
  }

  private syncLayout(): void {
    this.element.dataset.layout = this.phone?.matches === true ? 'phone' : 'wide';
  }

  // -------------------------------------------------------------------------
  // Confirmation
  // -------------------------------------------------------------------------

  private ask(text: string, yes: string, no: string, onYes: () => void): void {
    setText(this.dialogText, text);
    setText(this.dialogYes, yes);
    setText(this.dialogNo, no);
    this.onDialogYes = onYes;
    setHidden(this.dialog, false);
    this.dialogNo.focus();
  }

  private closeDialog(): void {
    this.onDialogYes = null;
    if (this.dialog.hidden) return;
    setHidden(this.dialog, true);
    if (this.session !== null) this.card.focus();
  }
}
