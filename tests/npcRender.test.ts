/**
 * The characters on screen (farmclaws part 4a spec §2.3, refinement R14): the appearance
 * palettes and the player's model built from an Appearance, the cast's props, the idle sway, the
 * nameplate rule and layout, and NpcRenderer standing each map's characters on their spots.
 * three's geometry and scene graph run in node; a canvas doesn't, so the renderer gets stand-in
 * nameplate textures here and the plates themselves are checked in the browser playbook.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APPEARANCE, NPC_LOOKS } from '../src/config';
import { DIRECTIONS, Direction, MAP_IDS, NPC_IDS, type GameState, type MapId } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS, npcAt } from '../src/people/cast';
import { NAMEPLATE_CANVAS, nameplateRect } from '../src/render/nameplates';
import { NpcRenderer, nameplateFor, swayAngle } from '../src/render/NpcRenderer';
import { NPC_PROP_BONES, createNpcPropGeometry, modelAppearance } from '../src/render/npcProps';
import { APPEARANCE_PALETTES } from '../src/render/palette';
import { DEFAULT_APPEARANCE, HAIR_STYLES, HAT_STYLES, PlayerModel } from '../src/render/playerModel';
import { playerGroundHeight, playerRootHeight } from '../src/render/PlayerRenderer';
import type { SceneContext } from '../src/render/SceneContext';
import type { FrameContext } from '../src/render/types';
import { DIRECTION_STEPS, directionYaw, tileCenterX, tileCenterZ } from '../src/world/grid';
import { MAPS } from '../src/world/maps';
import type { NpcPlacement } from '../src/world/maps/types';
import { getTile, isWalkable } from '../src/world/tiles';
import { BASE, must, withPlayer } from './testUtils';

/** `state` with the player on `mapId`, on a free tile next to (tx, tz) and facing it. */
function facing(state: GameState, mapId: MapId, tx: number, tz: number): GameState {
  for (const direction of DIRECTIONS) {
    const step = DIRECTION_STEPS[direction];
    const stand = { tx: tx - step.dx, tz: tz - step.dz };
    const tile = getTile(state.maps[mapId], stand.tx, stand.tz);
    if (tile !== null && isWalkable(tile) && npcAt(mapId, stand.tx, stand.tz) === null) return withPlayer(state, stand, direction, mapId);
  }
  throw new Error(`facing: no free tile next to (${tx}, ${tz}) on ${mapId}`);
}

/** Every map's placements, with the map they stand on. */
const PLACED: readonly (readonly [MapId, NpcPlacement])[] = MAP_IDS.flatMap((mapId) => MAPS[mapId].npcs.map((p) => [mapId, p] as const));

function placementOf(npc: string): readonly [MapId, NpcPlacement] {
  return must(PLACED.find(([, p]) => p.id === npc), `${npc} is placed nowhere`);
}

const [, SOL] = placementOf('sol');
const [, COSMO] = placementOf('cosmo');
/** In town, facing Sol. */
const AT_SOL = facing(BASE, 'town', SOL.tx, SOL.tz);
/** In town on the square, facing an empty tile. */
const TOWN = withPlayer(BASE, { tx: 21, tz: 10 }, Direction.South, 'town');
/** On the Neighbours map, facing Cosmo. */
const AT_COSMO = facing(BASE, 'neighbours', COSMO.tx, COSMO.tz);

const frozenBy = (state: GameState, ui: Partial<GameState['ui']>): GameState => ({ ...state, ui: { ...state.ui, ...ui } });

/** Mesh count, position sum and colour sum of a merged segment: a fingerprint of its geometry. */
function fingerprint(object: THREE.Object3D | undefined): readonly [number, number, number] {
  if (!(object instanceof THREE.Mesh)) throw new Error('fingerprint: not a mesh');
  const geometry: THREE.BufferGeometry = object.geometry;
  const sum = (name: string): number => Array.from(geometry.getAttribute(name).array).reduce((total, value) => total + value, 0);
  return [geometry.getAttribute('position').count, sum('position'), sum('color')];
}

function headVertices(model: PlayerModel): number {
  return fingerprint(model.head.children[0])[0];
}

/** True when `object` and every parent up to the scene are visible. */
function isShown(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function meshCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) count++;
  });
  return count;
}

/** A renderer on a bare scene, with stand-in nameplate textures that record the names drawn. */
function standUp(): { readonly renderer: NpcRenderer; readonly scene: THREE.Scene; readonly drawn: string[] } {
  const scene = new THREE.Scene();
  const drawn: string[] = [];
  const renderer = new NpcRenderer({ scene } as unknown as SceneContext, (name) => {
    drawn.push(name);
    return new THREE.Texture();
  });
  return { renderer, scene, drawn };
}

const frame = (state: GameState, elapsed: number): FrameContext => ({ dt: 1 / 60, elapsed, state, clockMinutes: state.time.minuteOfDay });

describe('appearance palettes (R14)', () => {
  it("holds one colour per APPEARANCE choice, index 0 the player's original colours", () => {
    expect(APPEARANCE_PALETTES.skin).toHaveLength(APPEARANCE.skinTones);
    expect(APPEARANCE_PALETTES.hair).toHaveLength(APPEARANCE.hairColors);
    expect(APPEARANCE_PALETTES.shirt).toHaveLength(APPEARANCE.shirtColors);
    expect(APPEARANCE_PALETTES.overalls).toHaveLength(APPEARANCE.overallsColors);
    expect([APPEARANCE_PALETTES.skin[0], APPEARANCE_PALETTES.hair[0], APPEARANCE_PALETTES.shirt[0], APPEARANCE_PALETTES.overalls[0]]).toEqual([
      0xf6d2b5, 0x7a4e36, 0x7fa7e8, 0x5f7fb8,
    ]);
  });

  it('names every hair style and hat APPEARANCE allows, the original look at 0', () => {
    expect(Object.values(HAIR_STYLES).sort()).toEqual([...Array(APPEARANCE.hairStyles).keys()]);
    expect(Object.values(HAT_STYLES).sort()).toEqual([...Array(APPEARANCE.hats).keys()]);
    expect(HAIR_STYLES.short).toBe(0);
    expect(HAT_STYLES.straw).toBe(0);
    expect(DEFAULT_APPEARANCE).toEqual(BASE.profile.appearance);
  });
});

describe('the player model built from an appearance', () => {
  it('builds the default farmer exactly as before', () => {
    const model = new PlayerModel();
    // Pinned from the model before appearances existed: [vertices, position sum, colour sum].
    const segments: readonly (readonly [THREE.Object3D | undefined, number, number, number])[] = [
      [model.hips.children[0], 72, 2.34, 53.678688],
      [model.torso.children[0], 468, 128.808, 537.790538],
      [model.head.children[0], 996, 233.064, 1427.837215],
      [model.eyes, 72, 11.16, 6.380506],
      [model.rightArm.children[0], 132, -24.96, 245.303348],
      [model.rightLeg.children[0], 144, -35.1, 68.772242],
    ];
    for (const [segment, vertices, positions, colors] of segments) {
      const [count, positionSum, colorSum] = fingerprint(segment);
      expect(count).toBe(vertices);
      expect(positionSum).toBeCloseTo(positions, 4);
      expect(colorSum).toBeCloseTo(colors, 4);
    }
    model.dispose();
  });

  it('builds every hair style and hat, and the last colour of every palette', () => {
    const heads = new Map<string, number>();
    for (let hairStyle = 0; hairStyle < APPEARANCE.hairStyles; hairStyle++) {
      for (let hat = 0; hat < APPEARANCE.hats; hat++) {
        const model = new PlayerModel({ ...DEFAULT_APPEARANCE, hairStyle, hat });
        heads.set(`${hairStyle}/${hat}`, headVertices(model));
        model.dispose();
      }
    }
    const short = HAIR_STYLES.short;
    expect(must(heads.get(`${short}/${HAT_STYLES.none}`))).toBeLessThan(must(heads.get(`${short}/${HAT_STYLES.straw}`)));
    expect(must(heads.get(`${HAIR_STYLES.ponytail}/${HAT_STYLES.none}`))).toBeGreaterThan(must(heads.get(`${short}/${HAT_STYLES.none}`)));
    expect(must(heads.get(`${HAIR_STYLES.bob}/${HAT_STYLES.none}`))).toBeGreaterThan(must(heads.get(`${short}/${HAT_STYLES.none}`)));
    expect(new Set([HAT_STYLES.straw, HAT_STYLES.cap, HAT_STYLES.knit].map((hat) => heads.get(`${short}/${hat}`))).size).toBe(3);
    const last = new PlayerModel({
      skinTone: APPEARANCE.skinTones - 1,
      hairStyle: APPEARANCE.hairStyles - 1,
      hairColor: APPEARANCE.hairColors - 1,
      shirtColor: APPEARANCE.shirtColors - 1,
      overallsColor: APPEARANCE.overallsColors - 1,
      hat: APPEARANCE.hats - 1,
    });
    expect(fingerprint(last.torso.children[0])[2]).not.toBeCloseTo(537.790538, 2);
    last.dispose();
  });

  it('refuses a look past the end of any list', () => {
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, skinTone: APPEARANCE.skinTones })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hairColor: APPEARANCE.hairColors })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hairStyle: APPEARANCE.hairStyles })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hat: APPEARANCE.hats })).toThrow(RangeError);
  });
});

describe("the cast's props", () => {
  it.each(NPC_PROPS)('%s is one non-empty, vertex-coloured geometry the size of a prop', (prop) => {
    const geometry = createNpcPropGeometry(prop);
    const count = geometry.getAttribute('position').count;
    expect(count).toBeGreaterThan(0);
    expect(geometry.getAttribute('color').count).toBe(count);
    geometry.computeBoundingSphere();
    expect(must(geometry.boundingSphere).radius).toBeGreaterThan(0.02);
    expect(must(geometry.boundingSphere).radius).toBeLessThan(0.5);
    geometry.dispose();
  });

  it("wears a hat prop instead of the character's own hat, and leaves every other look alone", () => {
    for (const npc of NPC_IDS) {
      const look = CAST_LOOKS[npc];
      if (look.prop === 'featherHat') {
        expect(modelAppearance(look)).toEqual({ ...look.appearance, hat: HAT_STYLES.none });
      } else {
        expect(modelAppearance(look)).toBe(look.appearance);
      }
    }
    expect(CAST_LOOKS.cosmo.prop).toBe('featherHat');
  });
});

describe('idle sway', () => {
  const amplitude = THREE.MathUtils.degToRad(NPC_LOOKS.swayDegrees);

  it('leans at most swayDegrees each way, reaching it once per swaySeconds', () => {
    for (let index = 0; index < NPC_IDS.length; index++) {
      let widest = 0;
      for (let t = 0; t < NPC_LOOKS.swaySeconds * 2; t += 0.01) {
        const angle = swayAngle(t, index);
        expect(Math.abs(angle)).toBeLessThanOrEqual(amplitude + 1e-12);
        widest = Math.max(widest, Math.abs(angle));
        expect(swayAngle(t + NPC_LOOKS.swaySeconds, index)).toBeCloseTo(angle, 9);
      }
      expect(widest).toBeGreaterThan(amplitude * 0.99);
    }
  });

  it('starts each character its own share of a sway later, so none sways in step with another', () => {
    for (let index = 1; index < NPC_IDS.length; index++) {
      const lead = (index / NPC_IDS.length) * NPC_LOOKS.swaySeconds;
      for (const t of [0, 0.4, 2.1]) expect(swayAngle(t, index)).toBeCloseTo(swayAngle(t + lead, 0), 9);
      expect(swayAngle(0.4, index)).not.toBeCloseTo(swayAngle(0.4, 0), 6);
    }
  });
});

describe('nameplateFor', () => {
  it('names the character on the tile ahead, on every map', () => {
    expect(PLACED).toHaveLength(NPC_IDS.length);
    for (const [mapId, p] of PLACED) expect(nameplateFor(facing(BASE, mapId, p.tx, p.tz)), p.id).toBe(p.id);
  });

  it('shows nothing while the game is frozen: a chat, another panel or the pause menu', () => {
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'inventory' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { paused: true }))).toBeNull();
  });

  it('shows nothing with no character ahead', () => {
    expect(nameplateFor(BASE)).toBeNull();
    expect(nameplateFor(TOWN)).toBeNull();
  });

  it('never names a character standing on another map', () => {
    expect(npcAt('town', COSMO.tx, COSMO.tz)).toBeNull();
    expect(nameplateFor(facing(BASE, 'town', COSMO.tx, COSMO.tz))).toBeNull();
  });
});

describe('nameplate layout', () => {
  it('pads the plate round the name and centres it on the canvas', () => {
    const rect = nameplateRect(100);
    expect(rect.width).toBeGreaterThan(100);
    expect(rect.x).toBeCloseTo((NAMEPLATE_CANVAS.width - rect.width) / 2, 9);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThan(NAMEPLATE_CANVAS.height);
    expect(nameplateRect(140).width).toBeGreaterThan(rect.width);
  });

  it('never runs past the canvas, however long the name', () => {
    for (const width of [0, 10_000]) {
      const rect = nameplateRect(width);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThan(NAMEPLATE_CANVAS.width);
    }
  });
});

describe('NpcRenderer', () => {
  it('stands each character on its spot, facing its way, its prop on its bone, in ten meshes', () => {
    for (const state of [TOWN, AT_COSMO]) {
      const { renderer, scene } = standUp();
      renderer.sync(state, null);
      const world = state.maps[state.player.mapId];
      for (const p of MAPS[state.player.mapId].npcs) {
        const root = must(scene.getObjectByName(`npc-${p.id}`), p.id);
        expect(isShown(root), p.id).toBe(true);
        expect(root.position.x).toBeCloseTo(tileCenterX(world.grid, p.tx), 9);
        expect(root.position.z).toBeCloseTo(tileCenterZ(world.grid, p.tz), 9);
        expect(root.position.y).toBeCloseTo(playerRootHeight(playerGroundHeight(getTile(world, p.tx, p.tz))), 9);
        expect(root.rotation.y).toBeCloseTo(directionYaw(p.facing), 9);
        const prop = CAST_LOOKS[p.id].prop;
        expect(must(root.getObjectByName(`prop-${prop}`), prop).parent?.name).toBe(NPC_PROP_BONES[prop]);
        expect(meshCount(root)).toBe(10);
      }
      renderer.dispose();
    }
  });

  it("builds a map's characters on its first visit, keeps them, and shows only the active map's", () => {
    const { renderer, scene, drawn } = standUp();
    renderer.sync(BASE, null);
    renderer.sync(TOWN, null);
    expect(scene.getObjectByName('npc-cosmo')).toBeUndefined();
    const sol = must(scene.getObjectByName('npc-sol'));
    renderer.sync(AT_COSMO, null);
    const cosmo = must(scene.getObjectByName('npc-cosmo'));
    expect(isShown(cosmo)).toBe(true);
    expect(isShown(sol)).toBe(false);
    renderer.sync(TOWN, null);
    expect(scene.getObjectByName('npc-sol')).toBe(sol);
    expect(isShown(sol)).toBe(true);
    expect(isShown(cosmo)).toBe(false);
    // Every plate was drawn once, when its character was built.
    expect([...drawn].sort()).toEqual(NPC_IDS.map((id) => CAST[id].name).sort());
    renderer.dispose();
  });

  it("shows the nameplate of the character ahead, only while the game isn't frozen", () => {
    const { renderer, scene } = standUp();
    const plate = (npc: string): THREE.Object3D => must(scene.getObjectByName(`nameplate-${npc}`), npc);
    renderer.sync(TOWN, null);
    for (const p of MAPS.town.npcs) expect(isShown(plate(p.id)), p.id).toBe(false);
    renderer.sync(AT_SOL, TOWN);
    for (const p of MAPS.town.npcs) expect(isShown(plate(p.id)), p.id).toBe(p.id === 'sol');
    expect(plate('sol').position.y).toBe(NPC_LOOKS.nameplateHeight);
    expect(plate('sol').scale.y).toBe(NPC_LOOKS.nameplateScale);
    const chatting = frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.' } });
    renderer.sync(chatting, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    renderer.sync(AT_SOL, chatting);
    expect(isShown(plate('sol'))).toBe(true);
    renderer.sync(TOWN, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    renderer.dispose();
  });

  it("sways each shown character's upper body, out of step", () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    renderer.update(frame(TOWN, 1.3));
    for (const p of MAPS.town.npcs) {
      const torso = must(must(scene.getObjectByName(`npc-${p.id}`)).getObjectByName('torso'));
      expect(torso.rotation.z, p.id).toBeCloseTo(swayAngle(1.3, NPC_IDS.indexOf(p.id)), 9);
    }
    renderer.dispose();
  });

  it('leaves nothing in the scene once disposed', () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    renderer.sync(AT_COSMO, null);
    expect(scene.children.length).toBeGreaterThan(0);
    renderer.dispose();
    expect(scene.children).toEqual([]);
  });
});
