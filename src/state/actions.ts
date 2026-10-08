/**
 * Every way the game state can change. Actions are plain serialisable objects, so an action
 * log replayed from the same initial state reproduces the same game exactly.
 */
import type {
  CraftingRecipeId,
  Direction,
  GameState,
  MdCard,
  MessageTone,
  NpcActionKind,
  NpcId,
  RobotProgram,
  SeedItemId,
  SlotRef,
} from '../core/types';

export type GameAction =
  | { readonly type: 'time/tick'; readonly minutes: number }
  | { readonly type: 'day/sleep' }
  | { readonly type: 'player/move'; readonly direction: Direction }
  | { readonly type: 'player/face'; readonly direction: Direction }
  /** Use the selected hotbar item on the tile the forward ray hits. */
  | { readonly type: 'player/useTool' }
  /** Context action on the forward tile: harvest, ship, sleep, refill. */
  | { readonly type: 'player/interact' }
  /** Shift + an interact key: E's meaning at the workbench ahead, else a peek at a standing robot ahead (part 3 spec §2.3). */
  | { readonly type: 'player/peek' }
  | { readonly type: 'inventory/select'; readonly slot: number }
  | { readonly type: 'inventory/cycle'; readonly delta: number }
  /** Moves `quantity` units (null = the whole stack) between two slots: player ↔ player or player ↔ open chest. */
  | { readonly type: 'inventory/move'; readonly from: SlotRef; readonly to: SlotRef; readonly quantity: number | null }
  | { readonly type: 'shop/setOpen'; readonly open: boolean }
  | { readonly type: 'ui/setInventoryOpen'; readonly open: boolean }
  /** Closes whichever panel is open. */
  | { readonly type: 'ui/closePanel' }
  /** A toast from the UI itself, e.g. when the robot screen fails to load (part 3 spec §4.1). */
  | { readonly type: 'ui/notify'; readonly text: string; readonly tone: MessageTone }
  | { readonly type: 'shop/buy'; readonly itemId: SeedItemId; readonly quantity: number }
  /** Crafts one batch of a known recipe from the player's inventory. */
  | { readonly type: 'crafting/craft'; readonly recipe: CraftingRecipeId }
  | { readonly type: 'game/setPaused'; readonly paused: boolean }
  | { readonly type: 'game/setTimeScale'; readonly timeScale: number }
  /** Shift + use with the zone marker: the next zone letter, A → H → A; drops a draft (part 3 spec §8). */
  | { readonly type: 'zone/cycle' }
  /** Drops the zone marker's draft (Escape). */
  | { readonly type: 'zone/clearDraft' }
  | { readonly type: 'game/load'; readonly state: GameState }
  /** Gives a robot a new program, through the checker (farmclaws part 3 spec §4.7). */
  | { readonly type: 'robot/program'; readonly robotId: number; readonly program: RobotProgram }
  /** Gives a robot a new .MD, through the checker. */
  | { readonly type: 'robot/md'; readonly robotId: number; readonly md: readonly MdCard[] }
  /** Lifts the robot on the workbench into the player's arms (farmclaws part 3 spec §2.2). */
  | { readonly type: 'robot/liftOff'; readonly robotId: number }
  /** The workbench's on/off switch (part 3 spec §2.4). */
  | { readonly type: 'robot/switch'; readonly robotId: number; readonly on: boolean }
  /** Scraps the robot on the workbench for gold (farmclaws part 3 spec §3.3). */
  | { readonly type: 'robot/scrap'; readonly robotId: number }
  /** Paints the robot on the workbench ROBOT_PAINTS[paint] (part 3 spec §3.4). */
  | { readonly type: 'robot/paint'; readonly robotId: number; readonly paint: number }
  /** An action button in the chat box, e.g. Marigold's Shop (farmclaws part 4a spec §3.2). */
  | { readonly type: 'talk/act'; readonly npc: NpcId; readonly act: NpcActionKind };

export type GameActionType = GameAction['type'];

export const actions = {
  tick: (minutes: number): GameAction => ({ type: 'time/tick', minutes }),
  sleep: (): GameAction => ({ type: 'day/sleep' }),
  move: (direction: Direction): GameAction => ({ type: 'player/move', direction }),
  face: (direction: Direction): GameAction => ({ type: 'player/face', direction }),
  useTool: (): GameAction => ({ type: 'player/useTool' }),
  interact: (): GameAction => ({ type: 'player/interact' }),
  peek: (): GameAction => ({ type: 'player/peek' }),
  selectSlot: (slot: number): GameAction => ({ type: 'inventory/select', slot }),
  cycleSlot: (delta: number): GameAction => ({ type: 'inventory/cycle', delta }),
  moveItem: (from: SlotRef, to: SlotRef, quantity: number | null = null): GameAction => ({
    type: 'inventory/move',
    from,
    to,
    quantity,
  }),
  setShopOpen: (open: boolean): GameAction => ({ type: 'shop/setOpen', open }),
  setInventoryOpen: (open: boolean): GameAction => ({ type: 'ui/setInventoryOpen', open }),
  closePanel: (): GameAction => ({ type: 'ui/closePanel' }),
  notify: (text: string, tone: MessageTone): GameAction => ({ type: 'ui/notify', text, tone }),
  buy: (itemId: SeedItemId, quantity: number): GameAction => ({ type: 'shop/buy', itemId, quantity }),
  craft: (recipe: CraftingRecipeId): GameAction => ({ type: 'crafting/craft', recipe }),
  setPaused: (paused: boolean): GameAction => ({ type: 'game/setPaused', paused }),
  setTimeScale: (timeScale: number): GameAction => ({ type: 'game/setTimeScale', timeScale }),
  cycleZoneLetter: (): GameAction => ({ type: 'zone/cycle' }),
  clearZoneDraft: (): GameAction => ({ type: 'zone/clearDraft' }),
  load: (state: GameState): GameAction => ({ type: 'game/load', state }),
  programRobot: (robotId: number, program: RobotProgram): GameAction => ({ type: 'robot/program', robotId, program }),
  setRobotMd: (robotId: number, md: readonly MdCard[]): GameAction => ({ type: 'robot/md', robotId, md }),
  liftOffBench: (robotId: number): GameAction => ({ type: 'robot/liftOff', robotId }),
  switchRobot: (robotId: number, on: boolean): GameAction => ({ type: 'robot/switch', robotId, on }),
  scrapRobot: (robotId: number): GameAction => ({ type: 'robot/scrap', robotId }),
  paintRobot: (robotId: number, paint: number): GameAction => ({ type: 'robot/paint', robotId, paint }),
  npcAct: (npc: NpcId, act: NpcActionKind): GameAction => ({ type: 'talk/act', npc, act }),
} as const;
