/**
 * The zone marker (farmclaws part 3 spec §8): the tool itself, painting a zone with two fresh
 * presses in either order, Shift + use cycling the letter, Shift + E clearing it, every way a
 * draft drops, the refusals, the HUD chip, and the marker's delivery.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TOOLS, WORKBENCH, ZONE_MARKER } from '../src/config';
import { Blocker, Direction, TOOL_TYPES, UPGRADABLE_TOOLS, ZONE_IDS, type GameState, type TileCoord } from '../src/core/types';
import { IGNORED, markerToolCommand, panelKeyCommand } from '../src/input/panelKeys';
import { getItem } from '../src/items/items';
import { zoneRectBetween } from '../src/robots/zones';
import { actions } from '../src/state/actions';
import { ZONES_FARM_ONLY, describeIntent, planInteraction, planPrimaryAction, planShiftInteraction } from '../src/state/intents';
import { countItem } from '../src/state/inventory';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { isZoneMarkerSelected } from '../src/state/selectors';
import { zoneChipText } from '../src/ui/zoneChip';
import { MAPS } from '../src/world/maps';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, STAND, TARGET, holding, must, robotOf, scenario, stack, withPlayer, withRobots, withSlots, withTile, withZones } from './testUtils';

/** The player on STAND facing South (TARGET ahead), the marker in hand from the starter kit's slot. */
const MARKING = holding(scenario(EMPTY_TILE), 'zoneMarker');
/** Standing here facing South, the player marks (7, 12): with TARGET it spans a 3×3 zone. */
const FAR: TileCoord = { tx: 7, tz: 11 };
const RECT_3X3 = { x0: 5, z0: 10, w: 3, d: 3 };

const use = (state: GameState): GameState => gameReducer(state, actions.useTool());
const cycle = (state: GameState): GameState => gameReducer(state, actions.cycleZoneLetter());
const at = (state: GameState, coord: TileCoord, facing: Direction = Direction.South): GameState => withPlayer(state, coord, facing);
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

describe('the zone marker tool', () => {
  it('is a free tool, named and described as in the spec, that is never upgraded or shipped', () => {
    expect(TOOL_TYPES).toContain('zoneMarker');
    expect(UPGRADABLE_TOOLS).not.toContain('zoneMarker');
    expect(TOOLS.energyCost.zoneMarker).toBe(0);
    expect(getItem('zoneMarker')).toMatchObject({
      kind: 'tool',
      name: 'Zone Marker',
      description: 'Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.',
      maxStack: 1,
      sellPrice: null,
      energyCost: 0,
    });
    const bin = holding(scenario(blockedTile(Blocker.ShippingBin)), 'zoneMarker');
    expect(planInteraction(bin).intent).toEqual({ kind: 'blocked', reason: "Zone Marker can't be shipped." });
  });

  it('has one colour per zone, all different', () => {
    expect(ZONE_MARKER.colors).toHaveLength(ZONE_IDS.length);
    expect(new Set(ZONE_MARKER.colors).size).toBe(ZONE_IDS.length);
  });

  it('comes in the first free slot of a new farm, with Zone A picked and no draft', () => {
    expect(BASE.inventory.slots[INVENTORY.starting.length]).toEqual(stack('zoneMarker', 1));
    expect(countItem(BASE.inventory, 'zoneMarker')).toBe(1);
    expect(BASE.robots.pendingMarker).toBe(false);
    expect(BASE.ui.zoneDraft).toBeNull();
    expect(BASE.ui.zoneLetter).toBe('A');
    expect(isZoneMarkerSelected(MARKING)).toBe(true);
    expect(isZoneMarkerSelected(BASE)).toBe(false);
  });
});

describe('painting a zone', () => {
  it('spans the rectangle between two corners, whichever comes first', () => {
    expect(zoneRectBetween({ tx: 5, tz: 10 }, { tx: 7, tz: 12 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 7, tz: 12 }, { tx: 5, tz: 10 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 7, tz: 10 }, { tx: 5, tz: 12 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 4, tz: 4 }, { tx: 4, tz: 4 })).toEqual({ x0: 4, z0: 4, w: 1, d: 1 });
  });

  it('sets the corner on the first press and paints Zone A on the second, in either order', () => {
    for (const [first, second] of [
      [STAND, FAR],
      [FAR, STAND],
    ] as const) {
      const cornered = use(at(MARKING, first));
      expect(cornered.ui.zoneDraft).toEqual({ zone: 'A', corner: { tx: first.tx, tz: first.tz + 1 } });
      expect(cornered.robots.zones.A).toBeNull();
      expect(cornered.messages).toBe(MARKING.messages);
      const painted = use(at(cornered, second));
      expect(painted.robots.zones.A).toEqual(RECT_3X3);
      expect(painted.ui.zoneDraft).toBeNull();
      expect(lastText(painted)).toBe('Zone A · 3×3.');
      expect(painted.player.energy).toBe(MARKING.player.energy);
      expect(painted.player.lastAction).toMatchObject({ kind: 'zoneMarker', success: true });
    }
  });

  it('names what the next press does', () => {
    expect(planPrimaryAction(MARKING)).toEqual({ target: TARGET, intent: { kind: 'zoneCorner', corner: TARGET }, feedback: 'zoneMarker', energyCost: 0 });
    expect(describeIntent(planPrimaryAction(MARKING).intent)).toBe('Mark corner');
    const cornered = use(MARKING);
    expect(planPrimaryAction(cornered).intent).toEqual({ kind: 'markZone', zone: 'A', rect: { x0: 5, z0: 10, w: 1, d: 1 } });
    expect(describeIntent(planPrimaryAction(cornered).intent)).toBe('Mark Zone A');
    expect(lastText(use(cornered))).toBe('Zone A · 1×1.');
  });

  it('repaints a zone that is already set, and leaves the other zones alone', () => {
    const set = withZones(MARKING, { A: { x0: 1, z0: 9, w: 2, d: 2 }, B: { x0: 1, z0: 9, w: 2, d: 2 } });
    const painted = use(at(use(set), FAR));
    expect(painted.robots.zones.A).toEqual(RECT_3X3);
    expect(painted.robots.zones.B).toEqual({ x0: 1, z0: 9, w: 2, d: 2 });
  });

  it('acts on fresh presses only, and Shift + a press picks the zone', () => {
    expect(markerToolCommand(MARKING, false, false)).toEqual(actions.useTool());
    expect(markerToolCommand(MARKING, false, true)).toBe(IGNORED);
    expect(markerToolCommand(MARKING, true, false)).toEqual(actions.cycleZoneLetter());
    expect(markerToolCommand(MARKING, true, true)).toBe(IGNORED);
    // Every other item keeps the ordinary tool path, held-key repeats included.
    const hoe = holding(MARKING, 'hoe');
    for (const [shift, repeat] of [
      [false, false],
      [false, true],
      [true, false],
    ] as const) {
      expect(markerToolCommand(hoe, shift, repeat)).toBeNull();
    }
  });

  it('refuses off the farm, and does nothing facing the edge of the world', () => {
    const tree = { tx: 10, tz: 10 };
    const ahead = { tx: 10, tz: 11 };
    const forest = withPlayer(withTile(withTile(MARKING, tree, EMPTY_TILE, 'forest'), ahead, EMPTY_TILE, 'forest'), tree, Direction.South, 'forest');
    expect(ZONES_FARM_ONLY).toBe('Zones are only on the farm.');
    expect(planPrimaryAction(forest)).toEqual({ target: ahead, intent: { kind: 'blocked', reason: 'Zones are only on the farm.' }, feedback: 'zoneMarker', energyCost: 0 });
    expect(lastText(use(forest))).toBe('Zones are only on the farm.');
    expect(use(forest).ui.zoneDraft).toBeNull();
    const edge = at(MARKING, { tx: 5, tz: 0 }, Direction.North);
    expect(planPrimaryAction(edge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'zoneMarker', energyCost: 0 });
  });
});

describe('picking the zone', () => {
  it('cycles A → H → A, dropping a draft, without a toast', () => {
    let state = use(MARKING);
    const seen: string[] = [];
    for (let i = 0; i < ZONE_IDS.length; i++) {
      state = cycle(state);
      expect(state.ui.zoneDraft).toBeNull();
      seen.push(state.ui.zoneLetter);
    }
    expect(seen).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'A']);
    expect(state.messages).toBe(MARKING.messages);
  });

  it('paints the picked letter', () => {
    const painted = use(use(cycle(cycle(MARKING))));
    expect(painted.robots.zones.C).toEqual({ x0: 5, z0: 10, w: 1, d: 1 });
    expect(painted.robots.zones.A).toBeNull();
    expect(lastText(painted)).toBe('Zone C · 1×1.');
  });

  it('is ignored while the game is frozen', () => {
    const paused = gameReducer(MARKING, actions.setPaused(true));
    expect(cycle(paused)).toBe(paused);
  });
});

describe('clearing a zone with Shift + E', () => {
  const SET = withZones(MARKING, { A: RECT_3X3, B: { x0: 1, z0: 9, w: 2, d: 2 } });

  it('clears the current letter only', () => {
    expect(planShiftInteraction(SET)).toEqual({ target: TARGET, intent: { kind: 'clearZone', zone: 'A' }, feedback: 'zoneMarker', energyCost: 0 });
    expect(describeIntent(planShiftInteraction(SET).intent)).toBe('Clear Zone A');
    const cleared = gameReducer(SET, actions.peek());
    expect(cleared.robots.zones.A).toBeNull();
    expect(cleared.robots.zones.B).toEqual({ x0: 1, z0: 9, w: 2, d: 2 });
    expect(lastText(cleared)).toBe('Cleared Zone A.');
  });

  it('has nothing to clear on an empty zone', () => {
    expect(planShiftInteraction(MARKING)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    expect(gameReducer(MARKING, actions.peek())).toBe(MARKING);
  });

  it('peeks instead when a standing robot is ahead', () => {
    const robot = withRobots(SET, [robotOf()]);
    expect(planShiftInteraction(robot).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
  });

  it('does what E does at the workbench instead', () => {
    const bench = at(SET, { tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz + 1 }, Direction.North);
    expect(planShiftInteraction(bench)).toEqual(planInteraction(bench));
    expect(describeIntent(planShiftInteraction(bench).intent)).toBe('Bring a robot here to work on it');
  });

  it('needs the marker in hand', () => {
    expect(planShiftInteraction(holding(SET, 'hoe')).intent).toEqual({ kind: 'blocked', reason: null });
  });
});

describe('the draft', () => {
  const DRAFT = use(MARKING);

  it('drops on Escape, which pauses only once there is no draft', () => {
    expect(panelKeyCommand('Escape', DRAFT)).toEqual(actions.clearZoneDraft());
    const dropped = gameReducer(DRAFT, actions.clearZoneDraft());
    expect(dropped.ui.zoneDraft).toBeNull();
    expect(dropped.ui.paused).toBe(false);
    expect(gameReducer(dropped, actions.clearZoneDraft())).toBe(dropped);
    expect(panelKeyCommand('Escape', dropped)).toEqual(actions.setPaused(true));
  });

  it('drops when the selected slot changes, and stays when it does not', () => {
    expect(gameReducer(DRAFT, actions.selectSlot(DRAFT.inventory.selected))).toBe(DRAFT);
    expect(gameReducer(DRAFT, actions.cycleSlot(INVENTORY.hotbarSize)).ui.zoneDraft).not.toBeNull();
    expect(gameReducer(DRAFT, actions.selectSlot(0)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.cycleSlot(1)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.cycleSlot(-1)).ui.zoneDraft).toBeNull();
  });

  it('drops when the player leaves the farm', () => {
    const warp = must(MAPS.farm.warps[0]);
    const left = gameReducer(withPlayer(DRAFT, warp.from, warp.exit), actions.move(warp.exit));
    expect(left.player.mapId).toBe(warp.to.mapId);
    expect(left.ui.zoneDraft).toBeNull();
  });

  it('drops when any panel opens', () => {
    expect(gameReducer(DRAFT, actions.setInventoryOpen(true)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.setShopOpen(true)).ui.zoneDraft).toBeNull();
    const peeked = gameReducer(withRobots(DRAFT, [robotOf()]), actions.peek());
    expect(peeked.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'peek' });
    expect(peeked.ui.zoneDraft).toBeNull();
  });

  it('survives walking and the clock, and drops on a load', () => {
    expect(gameReducer(DRAFT, actions.move(Direction.East)).ui.zoneDraft).toEqual(DRAFT.ui.zoneDraft);
    expect(gameReducer(DRAFT, actions.tick(10)).ui.zoneDraft).toEqual(DRAFT.ui.zoneDraft);
    const loaded = gameReducer(BASE, actions.load(cycle(DRAFT)));
    expect(loaded.ui.zoneDraft).toBeNull();
    expect(loaded.ui.zoneLetter).toBe('B');
  });
});

describe('the HUD chip', () => {
  it('names the letter, its size or "not set", and a set corner, while the marker is selected', () => {
    expect(zoneChipText(MARKING)).toBe('Zone A · not set');
    expect(zoneChipText(use(MARKING))).toBe('Zone A · not set · corner set');
    expect(zoneChipText(withZones(MARKING, { A: { x0: 5, z0: 10, w: 3, d: 2 } }))).toBe('Zone A · 3×2');
    expect(zoneChipText(use(withZones(MARKING, { A: RECT_3X3 })))).toBe('Zone A · 3×3 · corner set');
    expect(zoneChipText(cycle(MARKING))).toBe('Zone B · not set');
    expect(zoneChipText(holding(MARKING, 'hoe'))).toBeNull();
    expect(zoneChipText(BASE)).toBeNull();
  });
});

describe('a marker owed to a migrated save', () => {
  const FULL = withSlots(BASE, Array.from({ length: INVENTORY.startingUnlockedSlots }, () => stack('stone', INVENTORY.maxStack)));
  const PENDING: GameState = { ...FULL, robots: { ...FULL.robots, pendingMarker: true } };

  it('waits while the backpack is full', () => {
    const next = startNextDay(PENDING, false);
    expect(next.robots.pendingMarker).toBe(true);
    expect(countItem(next.inventory, 'zoneMarker')).toBe(0);
    expect(next.messages.entries.map((entry) => entry.text)).not.toContain('Your zone marker is in your backpack.');
  });

  it('arrives in the first free slot the first morning there is room', () => {
    const slots = PENDING.inventory.slots.slice();
    slots[9] = null;
    slots[15] = null;
    const next = startNextDay({ ...PENDING, inventory: { ...PENDING.inventory, slots } }, false);
    expect(next.inventory.slots[9]).toEqual(stack('zoneMarker', 1));
    expect(next.inventory.slots[15]).toBeNull();
    expect(next.robots.pendingMarker).toBe(false);
    expect(lastText(next)).toBe('Your zone marker is in your backpack.');
    expect(countItem(startNextDay(next, false).inventory, 'zoneMarker')).toBe(1);
  });
});
