/**
 * The Program tab (farmclaws part 3 spec §4.2): a Blockly editor for the robot's block program.
 *
 * - Blockly (`blockly/core` with its English messages) is imported the first time the tab is
 *   shown, so it lands in its own chunk; meanwhile the tab says "Opening the editor…", and a
 *   failed import says "The editor couldn't load. Close and try again.".
 * - The saved program is loaded with events disabled (loading is not an edit), rendered, and
 *   its top-level blocks re-spaced ROBOT_SCREEN.stackGap apart in program order. A part 1 script
 *   opens an empty workspace under a note. A ruined robot's workspace is read-only.
 * - The toolbar shows "{used} / {limit} blocks" (countWorkspaceBlocks, mid-edit) and
 *   "{n} / {limit} variables", red over the limit; "Make a variable" (with `var` unlocked);
 *   Revert and Save. Under the phone width the category column is hidden and "Blocks" opens a
 *   menu of the categories instead.
 * - Save translates the workspace, refuses loose blocks and translation errors (the block is
 *   highlighted), runs isProgramShape and checkProgram (the sentence shows under the toolbar),
 *   then dispatches programRobot. The reducer checks again and toasts "Programmed {name}.".
 * - A workspace listener keeps variables consistent: fc_var's output check follows its
 *   declaration's type, a declaration's INITIAL takes its type's literal, a changed type swaps
 *   in that type's default literal, and renaming a declaration or helper renames its uses.
 */
import type * as Blockly from 'blockly/core';
import { ROBOTS, ROBOT_SCREEN } from '../../../config';
import { VALUE_TYPES, type GameState, type Robot, type RobotProgram, type RobotUnlocks, type ValueType } from '../../../core/types';
import { checkProgram } from '../../../robots/check';
import { findRobot } from '../../../robots/world';
import { actions } from '../../../state/actions';
import { isProgramShape } from '../../../state/robotValidation';
import { closestWithin, h, hudButton, setHidden, setText } from '../../dom';
import { defineBlocks } from '../blockly/blockDefs';
import { CATEGORY_COLOURS, createTheme } from '../blockly/theme';
import {
  EDITOR_TEXT,
  VALUE_CHECKS,
  VALUE_TYPE_LABELS,
  blockCounter,
  declarationState,
  defaultLiteral,
  isValueType,
  scriptNote,
  toolboxFor,
  variableCounter,
  type CounterView,
  type ToolboxJson,
} from '../blockly/toolbox';
import { countWorkspaceBlocks, programToWorkspace, workspaceToProgram, type BlocklyWorkspaceJson } from '../translate';
import { phoneQuery } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

type BlocklyApi = typeof Blockly;

const EDITOR_ZOOM = { controls: true, wheel: true, pinch: true, startScale: 0.9, maxScale: 2, minScale: 0.5, scaleSpeed: 1.15 } as const;
/** New declarations land this far (workspace units) inside the top-left of the view. */
const DECLARATION_INSET = 24;
const EMPTY_WORKSPACE: BlocklyWorkspaceJson = {};

/** The toolbox in Blockly's own JSON types. */
function toBlocklyToolbox(json: ToolboxJson): Blockly.utils.toolbox.ToolboxInfo {
  return {
    kind: json.kind,
    contents: json.contents.map((category) => ({
      kind: category.kind,
      name: category.name,
      categorystyle: category.categorystyle,
      id: undefined,
      colour: undefined,
      cssconfig: undefined,
      hidden: undefined,
      contents: category.contents.map((block) =>
        block.disabledReasons === undefined
          ? { kind: block.kind, type: block.type }
          : { kind: block.kind, type: block.type, disabledReasons: [...block.disabledReasons] },
      ),
    })),
  };
}

function sameCheck(current: string[] | null, want: string | null): boolean {
  if (current === null || want === null) return current === want;
  return current.length === 1 && current[0] === want;
}

function renderCounter(node: HTMLElement, view: CounterView): void {
  setText(node, view.text);
  node.classList.toggle('is-over', view.over);
}

export class ProgramTab implements RobotTabView {
  readonly element = h('div', 'rs-program');
  private readonly blocksButton = hudButton('hud-btn hud-btn--soft rs-program__blocks', EDITOR_TEXT.blocks);
  private readonly blockCount = h('span', 'rs-counter');
  private readonly varCount = h('span', 'rs-counter');
  private readonly makeVariable = hudButton('hud-btn hud-btn--soft', EDITOR_TEXT.makeVariable);
  private readonly revertButton = hudButton('hud-btn hud-btn--ghost', EDITOR_TEXT.revert);
  private readonly saveButton = hudButton('hud-btn hud-btn--primary', EDITOR_TEXT.save);
  private readonly message = h('p', 'rs-message');
  private readonly note = h('p', 'rs-note');
  private readonly categories = h('div', 'rs-popover rs-program__categories');
  private readonly varForm = h('form', 'rs-popover rs-program__varform');
  private readonly varName = h('input', 'rs-input');
  private readonly varType = h('select', 'rs-input');
  private readonly status = h('p', 'rs-program__status');
  private readonly editor = h('div', 'rs-program__editor');
  private readonly context: RobotTabContext;
  private readonly phone: MediaQueryList | null;
  private api: BlocklyApi | null = null;
  private workspace: Blockly.WorkspaceSvg | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private requested = false;
  private disposed = false;
  private readOnly = false;
  private unlocks: RobotUnlocks | null = null;
  /** The program the workspace was last loaded from or saved to. */
  private baseline: RobotProgram | null = null;
  private dirty = false;
  /** True while this tab's own programRobot dispatch runs (its sync is not an outside change). */
  private saving = false;

  constructor(context: RobotTabContext) {
    this.context = context;
    const signal = context.signal;

    const toolbar = h('div', 'rs-toolbar');
    this.blocksButton.setAttribute('aria-haspopup', 'menu');
    toolbar.append(
      this.blocksButton,
      this.blockCount,
      this.varCount,
      this.makeVariable,
      h('span', 'rs-toolbar__spacer'),
      this.revertButton,
      this.saveButton,
    );
    this.message.setAttribute('role', 'status');
    this.note.hidden = true;
    this.categories.hidden = true;
    this.categories.setAttribute('role', 'menu');
    this.categories.setAttribute('aria-label', EDITOR_TEXT.blocks);
    const cancel = this.buildVariableForm();
    this.editor.hidden = true;
    this.element.append(toolbar, this.message, this.note, this.categories, this.varForm, this.status, this.editor);

    this.saveButton.addEventListener('click', () => this.save(), { signal });
    this.revertButton.addEventListener('click', () => this.revert(), { signal });
    this.makeVariable.addEventListener('click', () => this.openVariableForm(), { signal });
    this.varForm.addEventListener('submit', this.onVariableSubmit, { signal });
    cancel.addEventListener('click', () => this.closeVariableForm(), { signal });
    this.blocksButton.addEventListener(
      'click',
      () => {
        this.closeVariableForm();
        setHidden(this.categories, !this.categories.hidden);
      },
      { signal },
    );
    this.categories.addEventListener(
      'click',
      (event) => {
        const item = closestWithin(event, this.categories, 'button[data-index]');
        if (item !== null) this.selectCategory(Number(item.dataset.index));
      },
      { signal },
    );

    this.phone = typeof window.matchMedia === 'function' ? window.matchMedia(phoneQuery()) : null;
    this.phone?.addEventListener('change', () => this.applyLayout(), { signal });
  }

  open(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    this.readOnly = robot.power === 'ruined';
    this.unlocks = state.robots.unlocks;
    for (const button of [this.blocksButton, this.revertButton, this.saveButton]) setHidden(button, this.readOnly);
    this.syncVariableButton();
    setText(this.status, EDITOR_TEXT.opening);
    this.loadProgram(robot.program);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    if (state.robots.unlocks !== this.unlocks) this.syncUnlocks(state.robots.unlocks, robot);
    if (this.saving || robot.program === this.baseline || this.dirty) return;
    this.loadProgram(robot.program);
  }

  setActive(active: boolean): void {
    if (!active) {
      this.closeVariableForm();
      setHidden(this.categories, true);
      this.workspace?.hideChaff();
      return;
    }
    if (!this.requested) {
      this.requestEditor();
      return;
    }
    const api = this.api;
    const workspace = this.workspace;
    if (api !== null && workspace !== null) api.svgResize(workspace);
  }

  isDirty(): boolean {
    return this.dirty && !this.readOnly;
  }

  handleEscape(): boolean {
    if (!this.varForm.hidden) {
      this.closeVariableForm();
      return true;
    }
    if (!this.categories.hidden) {
      setHidden(this.categories, true);
      return true;
    }
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) return false;
    if (api.WidgetDiv.isVisible()) {
      // A text editor cancels itself on this Escape (Blockly's own handler runs next); a context
      // menu has no Escape of its own, so close it here.
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) api.WidgetDiv.hide();
      return true;
    }
    if (api.DropDownDiv.isVisible()) {
      api.DropDownDiv.hideWithoutAnimation();
      return true;
    }
    const flyout = workspace.getFlyout();
    if (flyout !== null && flyout.autoClose && flyout.isVisible()) {
      workspace.getToolbox()?.clearSelection();
      return true;
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const workspace = this.workspace;
    if (workspace !== null) {
      workspace.hideChaff();
      workspace.dispose();
    }
    this.workspace = null;
    this.api = null;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private robot(): Robot | null {
    return findRobot(this.context.getState(), this.context.robotId);
  }

  private requestEditor(): void {
    this.requested = true;
    setHidden(this.status, false);
    setText(this.status, EDITOR_TEXT.opening);
    Promise.all([import('blockly/core'), import('blockly/msg/en')])
      .then(([api, messages]) => {
        if (this.disposed) return;
        // The module's string exports only: its type also carries a synthetic `default`.
        api.setLocale(Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
        defineBlocks(api);
        this.build(api);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (this.disposed) return;
        setHidden(this.editor, true);
        setHidden(this.status, false);
        setText(this.status, EDITOR_TEXT.failed);
      });
  }

  private build(api: BlocklyApi): void {
    const state = this.context.getState();
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    setHidden(this.status, true);
    setHidden(this.editor, false);
    const workspace = api.inject(this.editor, {
      renderer: 'zelos',
      theme: createTheme(api),
      toolbox: this.readOnly ? undefined : toBlocklyToolbox(toolboxFor(robot, state.robots.unlocks)),
      readOnly: this.readOnly,
      trashcan: !this.readOnly,
      zoom: EDITOR_ZOOM,
      move: { scrollbars: true, drag: true, wheel: false },
      sounds: false,
      // Relative to the page: public/blockly-media (copied from the package in Step 1) is served beside the page in the dev server, dist/ and dist-single/ opened from disk, never from Blockly's host.
      media: 'blockly-media/',
      comments: false,
      collapse: false,
      disable: false,
    });
    this.api = api;
    this.workspace = workspace;
    workspace.addChangeListener(this.onChange);
    this.loadProgram(robot.program);
    const observer = new ResizeObserver(() => api.svgResize(workspace));
    observer.observe(this.editor);
    this.resizeObserver = observer;
    this.buildCategoryMenu(state.robots.unlocks, robot);
    this.applyLayout();
  }

  /** Shows `program` as saved: no edits, no highlights, no message. */
  private loadProgram(program: RobotProgram): void {
    this.baseline = program;
    this.dirty = false;
    setText(this.message, '');
    const robot = this.robot();
    if (robot !== null) this.syncNote(robot, program);
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) {
      if (robot !== null && program.kind === 'blocks') {
        this.showCounters(robot, countWorkspaceBlocks(programToWorkspace(program)), program.vars.length);
      } else if (robot !== null) {
        this.showCounters(robot, 0, 0);
      }
      return;
    }
    const json = program.kind === 'blocks' ? programToWorkspace(program) : EMPTY_WORKSPACE;
    api.Events.disable();
    try {
      api.serialization.workspaces.load({ ...json }, workspace);
      api.renderManagement.triggerQueuedRenders(workspace);
      this.respace(api, workspace);
      this.refreshChecks(workspace);
    } finally {
      api.Events.enable();
    }
    // Undo starts at the loaded program: discarded edits must not replay onto it.
    workspace.clearUndo();
    workspace.highlightBlock(null);
    workspace.scrollCenter();
    this.refreshCounters();
  }

  /** Top-level blocks in program order, each ROBOT_SCREEN.stackGap below the previous one's bottom. */
  private respace(api: BlocklyApi, workspace: Blockly.WorkspaceSvg): void {
    let y = 0;
    for (const block of workspace.getTopBlocks(false)) {
      block.moveTo(new api.utils.Coordinate(0, y));
      y += block.getHeightWidth().height + ROBOT_SCREEN.stackGap;
    }
  }

  private savedJson(api: BlocklyApi, workspace: Blockly.WorkspaceSvg): BlocklyWorkspaceJson {
    return api.serialization.workspaces.save(workspace) as BlocklyWorkspaceJson;
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  private readonly onChange = (event: Blockly.Events.Abstract): void => {
    const api = this.api;
    const workspace = this.workspace;
    // Keystrokes in an open text field are intermediate changes: a cancelled edit fires nothing
    // after them, and a committed one ends in a BlockChange, so only that counts as an edit.
    if (api === null || workspace === null || event.isUiEvent || event instanceof api.Events.BlockFieldIntermediateChange) return;
    if (event instanceof api.Events.BlockChange) this.followFieldChange(api, workspace, event);
    this.refreshChecks(workspace);
    workspace.highlightBlock(null);
    this.refreshCounters();
    if (!this.readOnly) this.dirty = true;
  };

  private followFieldChange(api: BlocklyApi, workspace: Blockly.WorkspaceSvg, event: Blockly.Events.BlockChange): void {
    if (event.element !== 'field' || event.blockId === undefined) return;
    const block = workspace.getBlockById(event.blockId);
    const before = typeof event.oldValue === 'string' ? event.oldValue : null;
    const after = typeof event.newValue === 'string' ? event.newValue : null;
    if (block === null || before === null || after === null || before === after) return;
    if (event.name === 'NAME' && block.type === 'fc_varDecl') {
      this.rename(workspace, ['fc_var', 'fc_set', 'fc_change'], 'VAR', before, after);
    } else if (event.name === 'NAME' && block.type === 'fc_helper') {
      this.rename(workspace, ['fc_runHelper'], 'NAME', before, after);
    } else if (event.name === 'TYPE' && block.type === 'fc_varDecl' && isValueType(after)) {
      this.resetInitial(api, workspace, block, after);
    }
  }

  private rename(workspace: Blockly.WorkspaceSvg, types: readonly string[], field: string, before: string, after: string): void {
    for (const type of types) {
      for (const block of workspace.getBlocksByType(type, false)) {
        if (block.getFieldValue(field) === before) block.setFieldValue(after, field);
      }
    }
  }

  /** A declaration whose type changed starts at that type's default literal. */
  private resetInitial(api: BlocklyApi, workspace: Blockly.WorkspaceSvg, declaration: Blockly.Block, type: ValueType): void {
    const robot = this.robot();
    const connection = declaration.getInput('INITIAL')?.connection ?? null;
    if (robot === null || connection === null) return;
    connection.targetBlock()?.dispose(false);
    connection.setCheck(VALUE_CHECKS[type]);
    const literal = api.serialization.blocks.append(defaultLiteral(type, robot), workspace);
    if (literal.outputConnection !== null) connection.connect(literal.outputConnection);
  }

  /** Each declaration's INITIAL takes its type; each fc_var's output takes its declaration's type. */
  private refreshChecks(workspace: Blockly.WorkspaceSvg): void {
    const declared = new Map<string, ValueType>();
    for (const declaration of workspace.getBlocksByType('fc_varDecl', false)) {
      const type: unknown = declaration.getFieldValue('TYPE');
      if (!isValueType(type)) continue;
      const name = String(declaration.getFieldValue('NAME') ?? '');
      if (!declared.has(name)) declared.set(name, type);
      const initial = declaration.getInput('INITIAL')?.connection ?? null;
      if (initial !== null && !sameCheck(initial.getCheck(), VALUE_CHECKS[type])) initial.setCheck(VALUE_CHECKS[type]);
    }
    for (const getter of workspace.getBlocksByType('fc_var', false)) {
      const type = declared.get(String(getter.getFieldValue('VAR') ?? ''));
      const check = type === undefined ? null : VALUE_CHECKS[type];
      const output = getter.outputConnection;
      if (output !== null && !sameCheck(output.getCheck(), check)) output.setCheck(check);
    }
  }

  private refreshCounters(): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null) return;
    this.showCounters(robot, countWorkspaceBlocks(this.savedJson(api, workspace)), workspace.getBlocksByType('fc_varDecl', false).length);
  }

  private showCounters(robot: Robot, blocks: number, variables: number): void {
    renderCounter(this.blockCount, blockCounter(blocks, robot.size));
    renderCounter(this.varCount, variableCounter(variables, robot.size));
    setHidden(this.varCount, !this.variablesUnlocked() && variables === 0);
  }

  // -------------------------------------------------------------------------
  // Save and Revert
  // -------------------------------------------------------------------------

  private save(): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null || this.readOnly) return;
    workspace.highlightBlock(null);
    const result = workspaceToProgram(this.savedJson(api, workspace));
    if ('error' in result) {
      setText(this.message, result.error);
      if (result.blockId !== null) workspace.highlightBlock(result.blockId, true);
      return;
    }
    if (result.loose.length > 0) {
      setText(this.message, EDITOR_TEXT.loose);
      for (const id of result.loose) workspace.highlightBlock(id, true);
      return;
    }
    const program = result.program;
    if (!isProgramShape(program)) {
      setText(this.message, EDITOR_TEXT.tooBig);
      return;
    }
    const problem = checkProgram(program, robot);
    if (problem !== null) {
      setText(this.message, problem);
      return;
    }
    setText(this.message, '');
    const before = robot.program;
    this.saving = true;
    try {
      this.context.dispatch(actions.programRobot(robot.id, program));
    } finally {
      this.saving = false;
    }
    const after = this.robot();
    if (after !== null && after.program !== before) {
      this.baseline = after.program;
      this.dirty = false;
      this.syncNote(after, after.program);
    }
  }

  private revert(): void {
    const robot = this.robot();
    if (robot !== null && !this.readOnly) this.loadProgram(robot.program);
  }

  // -------------------------------------------------------------------------
  // Variables
  // -------------------------------------------------------------------------

  private variablesUnlocked(): boolean {
    return this.unlocks?.blocks.includes('var') ?? false;
  }

  private syncVariableButton(): void {
    setHidden(this.makeVariable, this.readOnly || !this.variablesUnlocked());
  }

  /** Builds the in-screen "Make a variable" form; returns its Cancel button. */
  private buildVariableForm(): HTMLButtonElement {
    this.varForm.hidden = true;
    this.varForm.setAttribute('aria-label', EDITOR_TEXT.makeVariable);
    this.varName.type = 'text';
    this.varName.maxLength = ROBOTS.maxIdentifierLength;
    this.varName.autocomplete = 'off';
    this.varName.spellcheck = false;
    for (const type of VALUE_TYPES) {
      const option = h('option', '', VALUE_TYPE_LABELS[type]);
      option.value = type;
      this.varType.append(option);
    }
    const nameLabel = h('label', '', 'Name');
    nameLabel.append(this.varName);
    const typeLabel = h('label', '', 'Type');
    typeLabel.append(this.varType);
    const add = hudButton('hud-btn hud-btn--primary', 'Add');
    add.type = 'submit';
    const cancel = hudButton('hud-btn hud-btn--ghost', 'Cancel');
    const buttons = h('div', 'rs-program__varactions');
    buttons.append(cancel, add);
    this.varForm.append(nameLabel, typeLabel, buttons);
    return cancel;
  }

  private openVariableForm(): void {
    if (this.workspace === null) return;
    setHidden(this.categories, true);
    this.varName.value = '';
    this.varType.value = VALUE_TYPES[0];
    setHidden(this.varForm, false);
    this.varName.focus();
  }

  private closeVariableForm(): void {
    setHidden(this.varForm, true);
  }

  private readonly onVariableSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const name = this.varName.value.trim();
    const type = this.varType.value;
    if (name === '') {
      this.varName.focus();
      return;
    }
    if (!isValueType(type)) return;
    this.addDeclaration(name, type);
    this.closeVariableForm();
  };

  /** "Variable [name] is a [type] starting at [default]" at the top-left of the view. */
  private addDeclaration(name: string, type: ValueType): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null) return;
    const view = workspace.getMetricsManager().getViewMetrics(true);
    api.serialization.blocks.append(declarationState(name, type, robot, view.left + DECLARATION_INSET, view.top + DECLARATION_INSET), workspace);
  }

  // -------------------------------------------------------------------------
  // Toolbox, layout and notes
  // -------------------------------------------------------------------------

  private syncUnlocks(unlocks: RobotUnlocks, robot: Robot): void {
    this.unlocks = unlocks;
    this.syncVariableButton();
    const workspace = this.workspace;
    if (workspace !== null && !this.readOnly) {
      workspace.updateToolbox(toBlocklyToolbox(toolboxFor(robot, unlocks)));
      this.buildCategoryMenu(unlocks, robot);
      this.applyLayout();
    }
    if (workspace !== null) this.refreshCounters();
    else if (robot.program.kind === 'blocks') this.showCounters(robot, countWorkspaceBlocks(programToWorkspace(robot.program)), robot.program.vars.length);
    else this.showCounters(robot, 0, 0);
  }

  /** The phone layout's category menu, in toolbox order. */
  private buildCategoryMenu(unlocks: RobotUnlocks, robot: Robot): void {
    const toolbox = toolboxFor(robot, unlocks);
    this.categories.replaceChildren(
      ...toolbox.contents.map((category, index) => {
        const item = hudButton('rs-program__category', category.name);
        item.dataset.index = String(index);
        item.setAttribute('role', 'menuitem');
        item.style.setProperty('--dot', CATEGORY_COLOURS[category.category].primary);
        return item;
      }),
    );
  }

  private selectCategory(index: number): void {
    setHidden(this.categories, true);
    this.workspace?.getToolbox()?.selectItemByPosition(index);
  }

  /** Phone width hides the category column (the "Blocks" menu replaces it). */
  private applyLayout(): void {
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) return;
    const phone = this.phone?.matches === true;
    workspace.getToolbox()?.setVisible(!phone);
    if (!phone) setHidden(this.categories, true);
    api.svgResize(workspace);
  }

  private syncNote(robot: Robot, program: RobotProgram): void {
    const script = program.kind === 'script';
    setHidden(this.note, !script);
    setText(this.note, script ? scriptNote(robot.name) : '');
  }
}
