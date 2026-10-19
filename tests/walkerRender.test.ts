/**
 * The walkers on screen (farmclaws part 4a spec §2.3, refinement R14; part 4d spec §3.1, §4.6):
 * the appearance palettes and the player's model built from an Appearance, the cast's and the
 * townsfolk's props, the idle sway, the nameplate rule and layout, the walkers' pure layout
 * (walkerLayout.ts: who gets a model, glide or snap, shared tiles, the dog and the cart), and
 * WalkerRenderer drawing each map's walkers where their places put them.
 * three's geometry and scene graph run in node; a canvas doesn't, so the renderer gets stand-in
 * nameplate textures here and the plates themselves are checked in the browser playbook.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APPEARANCE, NPC_LOOKS, TIME } from '../src/config';
import { DIRECTIONS, Direction, NPC_IDS, TOWNSFOLK_IDS, type GameState, type MapId, type TileCoord, type WalkerId, type WalkerPlace } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS } from '../src/people/cast';
import { TOWNSFOLK_LOOKS, TOWNSFOLK_PLATES, TOWNSFOLK_PROPS } from '../src/people/townsfolk';
import { WALKER_IDS, walkerAt } from '../src/people/walk';
import { NAMEPLATE_CANVAS, nameplateRect, walkerName } from '../src/render/nameplates';
import { NPC_PROP_BONES, createGroundPropGeometry, createNpcPropGeometry, modelAppearance, walkerLook } from '../src/render/npcProps';
import { APPEARANCE_PALETTES } from '../src/render/palette';
import { DEFAULT_APPEARANCE, HAIR_STYLES, HAT_STYLES, PlayerModel } from '../src/render/playerModel';
import { playerGroundHeight, playerRootHeight } from '../src/render/PlayerRenderer';
import { MAX_MOVE_SECONDS, MOVE_PERIOD_SHARE, SHARED_OFFSET, YAW_RATE, easeYaw } from '../src/render/robotLayout';
import type { SceneContext } from '../src/render/SceneContext';
import type { FrameContext } from '../src/render/types';
import { WalkerRenderer } from '../src/render/WalkerRenderer';
import {
  GROUND_PROPS,
  WALKER_GROUND_PROPS,
  nameplateFor,
  shownWalkers,
  swayAngle,
  walkerGlideSeconds,
  walkerMotion,
  walkerOffsets,
} from '../src/render/walkerLayout';
import { DIRECTION_STEPS, directionYaw, tileCenterX, tileCenterZ } from '../src/world/grid';
import { getTile, isWalkable } from '../src/world/tiles';
import { BASE, must, withPlaces, withPlayer, withWalkerAt } from './testUtils';

/** A walker standing still: who, where and which way they face. */
interface Placement extends TileCoord {
  readonly id: WalkerId;
  readonly facing: Direction;
}

/** Every character on their 4a spot and every townsperson on a loop spot, with the map they stand on. */
const PLACED: readonly (readonly [MapId, Placement])[] = [
  ['town', { id: 'sol', tx: 21, tz: 7, facing: Direction.South }],
  ['town', { id: 'marigold', tx: 7, tz: 7, facing: Direction.South }],
  ['town', { id: 'berlioz', tx: 16, tz: 7, facing: Direction.South }],
  ['town', { id: 'juniper', tx: 24, tz: 7, facing: Direction.South }],
  ['town', { id: 'tallulah', tx: 35, tz: 7, facing: Direction.South }],
  ['neighbours', { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South }],
  ['neighbours', { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North }],
  ['town', { id: 'jogger', tx: 3, tz: 22, facing: Direction.East }],
  ['town', { id: 'dogWalker', tx: 14, tz: 9, facing: Direction.East }],
  ['town', { id: 'retiree', tx: 17, tz: 21, facing: Direction.South }],
  ['town', { id: 'courier', tx: 16, tz: 8, facing: Direction.East }],
  ['town', { id: 'busker', tx: 18, tz: 12, facing: Direction.South }],
  ['town', { id: 'kid', tx: 29, tz: 8, facing: Direction.South }],
];

/** The walkers PLACED puts on `mapId`. */
const placedOn = (mapId: MapId): readonly Placement[] => PLACED.filter(([m]) => m === mapId).map(([, p]) => p);

/** BASE with every walker out where PLACED puts them. */
const ALL_OUT: GameState = PLACED.reduce<GameState>((state, [mapId, p]) => withWalkerAt(state, p.id, mapId, p.tx, p.tz, p.facing), BASE);

/** `state` with the player on `mapId`, on a free tile next to (tx, tz) and facing it. */
function facing(state: GameState, mapId: MapId, tx: number, tz: number): GameState {
  for (const direction of DIRECTIONS) {
    const step = DIRECTION_STEPS[direction];
    const stand = { tx: tx - step.dx, tz: tz - step.dz };
    const tile = getTile(state.maps[mapId], stand.tx, stand.tz);
    if (tile !== null && isWalkable(tile) && walkerAt(state, mapId, stand.tx, stand.tz) === null) return withPlayer(state, stand, direction, mapId);
  }
  throw new Error(`facing: no free tile next to (${tx}, ${tz}) on ${mapId}`);
}

function placementOf(id: WalkerId): readonly [MapId, Placement] {
  return must(PLACED.find(([, p]) => p.id === id), `${id} is placed nowhere`);
}

const [, SOL] = placementOf('sol');
const [, COSMO] = placementOf('cosmo');
const [, KID] = placementOf('kid');
/** In town, facing Sol. */
const AT_SOL = facing(ALL_OUT, 'town', SOL.tx, SOL.tz);
/** In town, facing the kid. */
const AT_KID = facing(ALL_OUT, 'town', KID.tx, KID.tz);
/** In town on the square, facing an empty tile. */
const TOWN = withPlayer(ALL_OUT, { tx: 21, tz: 10 }, Direction.South, 'town');
/** On the Neighbours map, facing Cosmo. */
const AT_COSMO = facing(ALL_OUT, 'neighbours', COSMO.tx, COSMO.tz);

const TOWN_GRID = BASE.maps.town.grid;

const out = (mapId: MapId, tx: number, tz: number, way: Direction = Direction.East): Extract<WalkerPlace, { kind: 'out' }> => ({
  kind: 'out',
  mapId,
  tx,
  tz,
  facing: way,
});

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
function standUp(): { readonly renderer: WalkerRenderer; readonly scene: THREE.Scene; readonly drawn: string[] } {
  const scene = new THREE.Scene();
  const drawn: string[] = [];
  const renderer = new WalkerRenderer({ scene } as unknown as SceneContext, (name) => {
    drawn.push(name);
    return new THREE.Texture();
  });
  return { renderer, scene, drawn };
}

const frame = (state: GameState, elapsed: number, dt = 1 / 60): FrameContext => ({ dt, elapsed, state, clockMinutes: state.time.minuteOfDay });

const root = (scene: THREE.Scene, id: WalkerId): THREE.Object3D => must(scene.getObjectByName(`walker-${id}`), id);

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

/** Checks `geometry` is one non-empty, vertex-coloured geometry with a bounding radius in (min, max), then disposes it. */
function expectPropGeometry(geometry: THREE.BufferGeometry, min: number, max: number): void {
  const count = geometry.getAttribute('position').count;
  expect(count).toBeGreaterThan(0);
  expect(geometry.getAttribute('color').count).toBe(count);
  geometry.computeBoundingSphere();
  expect(must(geometry.boundingSphere).radius).toBeGreaterThan(min);
  expect(must(geometry.boundingSphere).radius).toBeLessThan(max);
  geometry.dispose();
}

describe("the walkers' props", () => {
  it.each([...NPC_PROPS, ...TOWNSFOLK_PROPS])('%s is one non-empty, vertex-coloured geometry the size of a prop', (prop) => {
    expectPropGeometry(createNpcPropGeometry(prop), 0.02, 0.5);
  });

  it.each(GROUND_PROPS)('the %s on the ground is one non-empty, vertex-coloured geometry', (prop) => {
    // The dog's lead runs up to the walker's hand a tile away, so the dog is the largest.
    expectPropGeometry(createGroundPropGeometry(prop), 0.05, 0.75);
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
    for (const id of TOWNSFOLK_IDS) expect(modelAppearance(TOWNSFOLK_LOOKS[id])).toBe(TOWNSFOLK_LOOKS[id].appearance);
  });

  it("looks every walker up: the cast's looks, then the townsfolk's", () => {
    for (const npc of NPC_IDS) expect(walkerLook(npc)).toBe(CAST_LOOKS[npc]);
    for (const id of TOWNSFOLK_IDS) expect(walkerLook(id)).toBe(TOWNSFOLK_LOOKS[id]);
  });
});

describe('idle sway', () => {
  const amplitude = THREE.MathUtils.degToRad(NPC_LOOKS.swayDegrees);

  it('leans at most swayDegrees each way, reaching it once per swaySeconds', () => {
    for (let index = 0; index < WALKER_IDS.length; index++) {
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

  it('starts each walker its own share of a sway later, so none sways in step with another', () => {
    for (let index = 1; index < WALKER_IDS.length; index++) {
      const lead = (index / WALKER_IDS.length) * NPC_LOOKS.swaySeconds;
      for (const t of [0, 0.4, 2.1]) expect(swayAngle(t, index)).toBeCloseTo(swayAngle(t + lead, 0), 9);
      expect(swayAngle(0.4, index)).not.toBeCloseTo(swayAngle(0.4, 0), 6);
    }
  });
});

describe('nameplateFor', () => {
  it('names the walker on the tile ahead, on every map', () => {
    expect(PLACED).toHaveLength(WALKER_IDS.length);
    for (const [mapId, p] of PLACED) expect(nameplateFor(facing(ALL_OUT, mapId, p.tx, p.tz)), p.id).toBe(p.id);
  });

  it('shows nothing while the game is frozen: a chat, another panel or the pause menu', () => {
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.', card: 'line' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'inventory' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { paused: true }))).toBeNull();
  });

  it('shows nothing with no walker ahead', () => {
    expect(nameplateFor(BASE)).toBeNull();
    expect(nameplateFor(TOWN)).toBeNull();
  });

  it('never names a walker standing on another map', () => {
    expect(walkerAt(ALL_OUT, 'town', COSMO.tx, COSMO.tz)).toBeNull();
    expect(nameplateFor(facing(ALL_OUT, 'town', COSMO.tx, COSMO.tz))).toBeNull();
  });
});

describe('nameplates', () => {
  it("names the cast by their names and the townsfolk by their plates (spec §3.1)", () => {
    for (const npc of NPC_IDS) expect(walkerName(npc)).toBe(CAST[npc].name);
    for (const id of TOWNSFOLK_IDS) expect(walkerName(id)).toBe(TOWNSFOLK_PLATES[id]);
    expect(TOWNSFOLK_IDS.map(walkerName)).toEqual(['Jogger', 'Dog walker', 'Retiree', 'Courier', 'Busker', 'Kid']);
  });

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

describe('walker layout (spec §4.6)', () => {
  it('gives a model only to the walkers out on the map, characters then townsfolk', () => {
    const state = withPlaces(ALL_OUT, { sol: { kind: 'indoors' }, kid: { kind: 'indoors' } });
    expect(shownWalkers(state, 'town').map((w) => w.id)).toEqual(['marigold', 'berlioz', 'juniper', 'tallulah', 'jogger', 'dogWalker', 'retiree', 'courier', 'busker']);
    expect(shownWalkers(state, 'neighbours').map((w) => w.id)).toEqual(['cosmo', 'barnaby']);
    expect(shownWalkers(state, 'farm')).toEqual([]);
    const indoors = TOWNSFOLK_IDS.reduce<GameState>((s, id) => withPlaces(s, { [id]: { kind: 'indoors' } }), BASE);
    expect(shownWalkers(withPlaces(indoors, { sol: { kind: 'indoors' } }), 'town')).toEqual([]);
    const busker = must(shownWalkers(ALL_OUT, 'town').find((w) => w.id === 'busker'));
    expect(busker.place).toBe(ALL_OUT.townsfolk.busker.place);
    expect(busker.index).toBe(WALKER_IDS.indexOf('busker'));
  });

  it('glides one adjacent step to the new tile centre over the walk step time', () => {
    const glide = walkerMotion(TOWN_GRID, out('town', 14, 9), out('town', 15, 9), 1);
    expect(glide).toEqual({ x: tileCenterX(TOWN_GRID, 15), z: tileCenterZ(TOWN_GRID, 9), seconds: MAX_MOVE_SECONDS });
    expect(walkerMotion(TOWN_GRID, out('town', 14, 9), out('town', 14, 8, Direction.North), 16)).toEqual({
      x: tileCenterX(TOWN_GRID, 14),
      z: tileCenterZ(TOWN_GRID, 8),
      seconds: walkerGlideSeconds(16),
    });
  });

  it('times a glide like a robot that acts every minute, so it lands before the next step', () => {
    expect(walkerGlideSeconds(1)).toBeCloseTo(MAX_MOVE_SECONDS, 9);
    for (const timeScale of TIME.timeScales) {
      const minute = TIME.realSecondsPerGameMinute / timeScale;
      expect(walkerGlideSeconds(timeScale)).toBeCloseTo(Math.min(MAX_MOVE_SECONDS, MOVE_PERIOD_SHARE * minute), 9);
      expect(walkerGlideSeconds(timeScale)).toBeLessThan(minute);
    }
  });

  it('snaps a jump of two or more tiles, as a big tick makes (Review Focus 1)', () => {
    const to = out('town', 16, 9);
    expect(walkerMotion(TOWN_GRID, out('town', 14, 9), to, 16)).toEqual({ x: tileCenterX(TOWN_GRID, 16), z: tileCenterZ(TOWN_GRID, 9), seconds: 0 });
    // A diagonal is two steps, never one.
    expect(walkerMotion(TOWN_GRID, out('town', 15, 10), to, 16)?.seconds).toBe(0);
    expect(walkerMotion(TOWN_GRID, out('town', 3, 22), to, 16)?.seconds).toBe(0);
  });

  it('snaps a map change, even onto a tile that looks next door (Review Focus 1)', () => {
    const neighboursGrid = BASE.maps.neighbours.grid;
    const arrival = out('neighbours', 1, 14);
    expect(walkerMotion(neighboursGrid, out('town', 39, 16), arrival, 1)).toEqual({ x: tileCenterX(neighboursGrid, 1), z: tileCenterZ(neighboursGrid, 14), seconds: 0 });
    expect(walkerMotion(neighboursGrid, out('town', 1, 13), arrival, 1)?.seconds).toBe(0);
  });

  it('snaps on coming out of a door or exit, and on a first showing', () => {
    expect(walkerMotion(TOWN_GRID, { kind: 'indoors' }, out('town', 0, 30), 1)?.seconds).toBe(0);
    expect(walkerMotion(TOWN_GRID, undefined, out('town', 15, 9), 1)?.seconds).toBe(0);
  });

  it('leaves the model alone when only the facing changed', () => {
    expect(walkerMotion(TOWN_GRID, out('town', 18, 12, Direction.East), out('town', 18, 12, Direction.South), 1)).toBeNull();
  });

  it("spreads walkers that share a tile with the robots' offsets, in walker order", () => {
    // The busker already stands on (18, 12).
    const state = withPlaces(ALL_OUT, { kid: out('town', 18, 12), dogWalker: out('town', 18, 12), sol: out('town', 18, 12) });
    const offsets = walkerOffsets(shownWalkers(state, 'town'));
    const step = SHARED_OFFSET * 2;
    expect(offsets.get('sol')).toBeCloseTo(-1.5 * step, 9);
    expect(offsets.get('dogWalker')).toBeCloseTo(-0.5 * step, 9);
    expect(offsets.get('busker')).toBeCloseTo(0.5 * step, 9);
    expect(offsets.get('kid')).toBeCloseTo(1.5 * step, 9);
    expect(offsets.get('marigold')).toBe(0);
  });

  it('puts the dog one tile behind the dog walker and the cart one tile ahead of the courier', () => {
    expect(WALKER_GROUND_PROPS.dogWalker).toEqual({ prop: 'dog', ahead: -1 });
    expect(WALKER_GROUND_PROPS.courier).toEqual({ prop: 'cart', ahead: 1 });
    expect(WALKER_GROUND_PROPS.busker?.prop).toBe('hat');
    expect(Object.keys(WALKER_GROUND_PROPS).sort()).toEqual(['busker', 'courier', 'dogWalker']);
  });

  it('eases a turn the short way round at the robots’ rate', () => {
    const yaw = easeYaw(0.1, -0.1 + 2 * Math.PI, 1 / 60);
    expect(yaw).toBeLessThan(0.1);
    expect(yaw).toBeCloseTo(0.1 - 0.2 * (1 - Math.exp(-YAW_RATE / 60)), 9);
    expect(easeYaw(1, 1, 0.5)).toBe(1);
  });
});

describe('WalkerRenderer', () => {
  it('stands each walker on its spot, facing its way, its prop on its bone', () => {
    for (const state of [TOWN, AT_COSMO]) {
      const { renderer, scene } = standUp();
      renderer.sync(state, null);
      const world = state.maps[state.player.mapId];
      for (const p of placedOn(state.player.mapId)) {
        const model = root(scene, p.id);
        expect(isShown(model), p.id).toBe(true);
        expect(model.position.x).toBeCloseTo(tileCenterX(world.grid, p.tx), 9);
        expect(model.position.z).toBeCloseTo(tileCenterZ(world.grid, p.tz), 9);
        expect(model.position.y).toBeCloseTo(playerRootHeight(playerGroundHeight(getTile(world, p.tx, p.tz))), 9);
        expect(model.rotation.y).toBeCloseTo(directionYaw(p.facing), 9);
        const prop = walkerLook(p.id).prop;
        expect(must(model.getObjectByName(`prop-${prop}`), prop).parent?.name).toBe(NPC_PROP_BONES[prop]);
        // Nine body meshes and the prop, and a prop on the ground for three of the townsfolk.
        expect(meshCount(model), p.id).toBe(p.id in WALKER_GROUND_PROPS ? 11 : 10);
      }
      renderer.dispose();
    }
  });

  it('draws no model for walkers indoors', () => {
    const { renderer, scene } = standUp();
    const state = withPlaces(TOWN, { sol: { kind: 'indoors' }, kid: { kind: 'indoors' } });
    renderer.sync(state, null);
    expect(scene.getObjectByName('walker-sol')).toBeUndefined();
    expect(scene.getObjectByName('walker-kid')).toBeUndefined();
    renderer.sync(TOWN, state);
    renderer.sync(state, TOWN);
    expect(isShown(root(scene, 'kid'))).toBe(false);
    renderer.dispose();
  });

  it('draws the dog a tile behind the dog walker and the cart a tile ahead of the courier, along their facing', () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    const at = (name: string): THREE.Vector3 => must(scene.getObjectByName(name), name).getWorldPosition(new THREE.Vector3());
    scene.updateMatrixWorld(true);
    // The dog walker faces East from (14, 9): the dog is on (13, 9). The courier faces East from (16, 8): the cart is on (17, 8).
    expect(at('ground-dog').x).toBeCloseTo(tileCenterX(TOWN_GRID, 13), 6);
    expect(at('ground-dog').z).toBeCloseTo(tileCenterZ(TOWN_GRID, 9), 6);
    expect(at('ground-cart').x).toBeCloseTo(tileCenterX(TOWN_GRID, 17), 6);
    expect(at('ground-cart').z).toBeCloseTo(tileCenterZ(TOWN_GRID, 8), 6);
    // Both stand on the ground, not at the walker's hips.
    expect(at('ground-dog').y).toBeCloseTo(playerGroundHeight(getTile(TOWN.maps.town, 14, 9)), 6);
    renderer.dispose();
  });

  it('glides an adjacent step over the walk step time and snaps a jump of two tiles', () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    const dogWalker = root(scene, 'dogWalker');
    const step = withWalkerAt(TOWN, 'dogWalker', 'town', 15, 9, Direction.East);
    renderer.sync(step, TOWN);
    // Still on the old tile until the frames move it.
    expect(dogWalker.position.x).toBeCloseTo(tileCenterX(TOWN_GRID, 14), 9);
    renderer.update(frame(step, 0.1, MAX_MOVE_SECONDS / 2));
    expect(dogWalker.position.x).toBeGreaterThan(tileCenterX(TOWN_GRID, 14));
    expect(dogWalker.position.x).toBeLessThan(tileCenterX(TOWN_GRID, 15));
    renderer.update(frame(step, 0.4, MAX_MOVE_SECONDS / 2));
    expect(dogWalker.position.x).toBeCloseTo(tileCenterX(TOWN_GRID, 15), 9);
    // A big tick: two tiles in one store update snaps there at once.
    const jump = withWalkerAt(step, 'dogWalker', 'town', 17, 9, Direction.East);
    renderer.sync(jump, step);
    expect(dogWalker.position.x).toBeCloseTo(tileCenterX(TOWN_GRID, 17), 9);
    renderer.dispose();
  });

  it('hides a walker who goes in, and snaps them onto their tile when they come back out', () => {
    const { renderer, scene } = standUp();
    const gate = withWalkerAt(TOWN, 'barnaby', 'town', 38, 16, Direction.West);
    renderer.sync(gate, null);
    const barnaby = root(scene, 'barnaby');
    const inside = withPlaces(gate, { barnaby: { kind: 'indoors' } });
    renderer.sync(inside, gate);
    expect(isShown(barnaby)).toBe(false);
    const back = withWalkerAt(inside, 'barnaby', 'town', 37, 16, Direction.West);
    renderer.sync(back, inside);
    expect(isShown(barnaby)).toBe(true);
    expect(barnaby.position.x).toBeCloseTo(tileCenterX(TOWN_GRID, 37), 9);
    renderer.dispose();
  });

  it('turns to face the way they walk, easing like a robot', () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    const busker = root(scene, 'busker');
    const turned = withWalkerAt(TOWN, 'busker', 'town', 18, 12, Direction.West);
    renderer.sync(turned, TOWN);
    expect(busker.rotation.y).toBeCloseTo(directionYaw(Direction.South), 9);
    renderer.update(frame(turned, 0.1, 1 / 60));
    expect(busker.rotation.y).toBeCloseTo(easeYaw(directionYaw(Direction.South), directionYaw(Direction.West), 1 / 60), 9);
    for (let i = 0; i < 120; i++) renderer.update(frame(turned, 0.1, 1 / 60));
    expect(Math.cos(busker.rotation.y - directionYaw(Direction.West))).toBeCloseTo(1, 6);
    renderer.dispose();
  });

  it('spreads walkers who share a tile', () => {
    const { renderer, scene } = standUp();
    const shared = withPlaces(TOWN, { kid: out('town', 18, 12, Direction.South) });
    renderer.sync(shared, null);
    const kid = root(scene, 'kid');
    const busker = root(scene, 'busker');
    expect(kid.position.distanceTo(busker.position)).toBeCloseTo(SHARED_OFFSET * 2, 9);
    renderer.dispose();
  });

  it("builds a map's walkers on its first visit, keeps them, and shows only the active map's", () => {
    const { renderer, scene, drawn } = standUp();
    renderer.sync(BASE, null);
    renderer.sync(TOWN, null);
    expect(scene.getObjectByName('walker-cosmo')).toBeUndefined();
    const sol = root(scene, 'sol');
    renderer.sync(AT_COSMO, null);
    const cosmo = root(scene, 'cosmo');
    expect(isShown(cosmo)).toBe(true);
    expect(isShown(sol)).toBe(false);
    renderer.sync(TOWN, null);
    expect(root(scene, 'sol')).toBe(sol);
    expect(isShown(sol)).toBe(true);
    expect(isShown(cosmo)).toBe(false);
    // Every plate was drawn once, when its walker was built.
    expect([...drawn].sort()).toEqual(WALKER_IDS.map(walkerName).sort());
    renderer.dispose();
  });

  it("shows the nameplate of the walker ahead, only while the game isn't frozen", () => {
    const { renderer, scene } = standUp();
    const plate = (id: WalkerId): THREE.Object3D => must(scene.getObjectByName(`nameplate-${id}`), id);
    renderer.sync(TOWN, null);
    for (const p of placedOn('town')) expect(isShown(plate(p.id)), p.id).toBe(false);
    renderer.sync(AT_SOL, TOWN);
    for (const p of placedOn('town')) expect(isShown(plate(p.id)), p.id).toBe(p.id === 'sol');
    expect(plate('sol').position.y).toBe(NPC_LOOKS.nameplateHeight);
    expect(plate('sol').scale.y).toBe(NPC_LOOKS.nameplateScale);
    const chatting = frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.', card: 'line' } });
    renderer.sync(chatting, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    renderer.sync(AT_SOL, chatting);
    expect(isShown(plate('sol'))).toBe(true);
    renderer.sync(AT_KID, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    expect(isShown(plate('kid'))).toBe(true);
    renderer.sync(TOWN, AT_KID);
    expect(isShown(plate('kid'))).toBe(false);
    renderer.dispose();
  });

  it("sways each walker's upper body, out of step, standing or gliding", () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    renderer.update(frame(TOWN, 1.3));
    for (const p of placedOn('town')) {
      const torso = must(root(scene, p.id).getObjectByName('torso'));
      expect(torso.rotation.z, p.id).toBeCloseTo(swayAngle(1.3, WALKER_IDS.indexOf(p.id)), 9);
    }
    const step = withWalkerAt(TOWN, 'jogger', 'town', 4, 22, Direction.East);
    renderer.sync(step, TOWN);
    renderer.update(frame(step, 1.7, MAX_MOVE_SECONDS / 4));
    const jogger = root(scene, 'jogger');
    expect(jogger.position.x).toBeLessThan(tileCenterX(TOWN_GRID, 4));
    expect(must(jogger.getObjectByName('torso')).rotation.z).toBeCloseTo(swayAngle(1.7, WALKER_IDS.indexOf('jogger')), 9);
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
