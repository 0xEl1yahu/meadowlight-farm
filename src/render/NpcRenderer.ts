/**
 * NpcRenderer: the cast standing on their spots (farmclaws part 4a spec §2.3).
 *
 * - Each character is a PlayerModel in its CAST_LOOKS appearance (modelAppearance), with its
 *   prop (npcProps.ts) on the prop's bone and a nameplate sprite above its head: ten meshes and
 *   a sprite per character.
 * - A map's characters are built the first time the player is on that map and kept, one group
 *   per map; only the active map's group is shown. A full rebuild (`sync(state, null)`: startup,
 *   a load, a map change) shows the active map's group and places its characters again.
 * - Characters stand on their tile centre at the player's ground height (playerGroundHeight,
 *   playerRootHeight), facing their placement's direction through directionYaw as the player
 *   does. They never turn toward the player.
 * - update() sways each shown character's upper body by swayAngle, out of step by NPC_IDS index.
 * - The nameplate of the character on the tile ahead (nameplateFor) shows while the game isn't
 *   frozen. Each plate's texture is drawn once, when its character is built.
 */
import * as THREE from 'three';
import { NPC_LOOKS } from '../config';
import { NPC_IDS, type GameState, type MapId, type NpcId } from '../core/types';
import { CAST, CAST_LOOKS, npcAt } from '../people/cast';
import { selectActiveMapId, selectIsFrozen, selectTargetTile } from '../state/selectors';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
import { getMap } from '../world/maps';
import type { NpcPlacement } from '../world/maps/types';
import { getTile } from '../world/tiles';
import { createFlatMaterial } from './materials';
import { NAMEPLATE_ASPECT, createNameplateTexture } from './nameplates';
import { NPC_PROP_BONES, NPC_PROP_POSES, createNpcPropGeometry, modelAppearance } from './npcProps';
import { EMPTY_HANDED_POSE, playerBlobLocalHeight, playerGroundHeight, playerRootHeight } from './PlayerRenderer';
import { PlayerModel, applyPose, copyPose, createPose, type Pose } from './playerModel';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

/** Nameplates draw after the scene's meshes, like the zone letters. */
const NAMEPLATE_RENDER_ORDER = 3;

/** Draws one character's nameplate texture; NpcRenderer calls it once per character. */
export type NameplateFactory = (name: string) => THREE.Texture;

/** The character on the tile ahead of the player, whose nameplate shows; null while the game is frozen. */
export function nameplateFor(state: GameState): NpcId | null {
  if (selectIsFrozen(state)) return null;
  const target = selectTargetTile(state);
  return target === null ? null : npcAt(state.player.mapId, target.tx, target.tz);
}

/**
 * A character's idle lean (radians, positive toward its right) `elapsedSeconds` into the sway:
 * NPC_LOOKS.swayDegrees each way over NPC_LOOKS.swaySeconds, its phase set by the character's
 * NPC_IDS index so neighbours never sway in step.
 */
export function swayAngle(elapsedSeconds: number, npcIndex: number): number {
  const turns = elapsedSeconds / NPC_LOOKS.swaySeconds + npcIndex / NPC_IDS.length;
  return THREE.MathUtils.degToRad(NPC_LOOKS.swayDegrees) * Math.sin(2 * Math.PI * turns);
}

interface Character {
  readonly placement: NpcPlacement;
  readonly model: PlayerModel;
  readonly prop: THREE.Mesh;
  readonly plate: THREE.Sprite;
  /** Empty-handed, plus the prop's own joints (a held clipboard). */
  readonly rest: Pose;
  /** Position in NPC_IDS: the sway's phase. */
  readonly index: number;
}

interface MapCast {
  readonly group: THREE.Group;
  readonly characters: readonly Character[];
}

export class NpcRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly makeNameplate: NameplateFactory;
  /** Shared by every prop: their colours are baked into the geometry. */
  private readonly propMaterial = createFlatMaterial(0xffffff, { vertexColors: true });
  /** Each visited map's characters, built on the first visit and kept. */
  private readonly casts = new Map<MapId, MapCast>();
  private readonly textures: THREE.Texture[] = [];
  private active: MapCast | null = null;
  /** The character whose nameplate shows. */
  private named: Character | null = null;
  /** Scratch pose, reused every frame. */
  private readonly pose = createPose();

  /** `makeNameplate` draws the plates; tests pass a stand-in, as node has no canvas. */
  constructor(ctx: SceneContext, makeNameplate: NameplateFactory = createNameplateTexture) {
    this.ctx = ctx;
    this.makeNameplate = makeNameplate;
  }

  sync(state: GameState, prev: GameState | null): void {
    // Only a full rebuild can change the map (render/syncPolicy.ts); the cast never moves.
    if (prev === null) this.showMap(state);
    this.showNameplate(nameplateFor(state));
  }

  update(frame: FrameContext): void {
    if (this.active === null) return;
    for (const character of this.active.characters) {
      copyPose(this.pose, character.rest);
      this.pose.tilt += swayAngle(frame.elapsed, character.index);
      applyPose(character.model, this.pose);
    }
  }

  dispose(): void {
    for (const cast of this.casts.values()) {
      for (const character of cast.characters) {
        character.prop.geometry.dispose();
        character.plate.material.dispose();
        character.model.dispose();
      }
      cast.group.removeFromParent();
    }
    for (const texture of this.textures) texture.dispose();
    this.propMaterial.dispose();
    this.casts.clear();
    this.textures.length = 0;
    this.active = null;
    this.named = null;
  }

  /** Shows the active map's characters, building them on its first visit, and stands them on its ground. */
  private showMap(state: GameState): void {
    const mapId = selectActiveMapId(state);
    let cast = this.casts.get(mapId);
    if (cast === undefined) {
      cast = this.buildCast(mapId);
      this.casts.set(mapId, cast);
    }
    for (const other of this.casts.values()) other.group.visible = other === cast;
    const world = state.maps[mapId];
    for (const character of cast.characters) {
      const { tx, tz, facing } = character.placement;
      const groundY = playerGroundHeight(getTile(world, tx, tz));
      const root = character.model.root;
      root.position.set(tileCenterX(world.grid, tx), playerRootHeight(groundY), tileCenterZ(world.grid, tz));
      root.rotation.y = directionYaw(facing);
      // The blob is a child of the root, so its height is relative to where the root sits.
      character.model.groundBlob.position.y = playerBlobLocalHeight(groundY);
    }
    this.active = cast;
  }

  private buildCast(mapId: MapId): MapCast {
    const group = new THREE.Group();
    group.name = `npcs-${mapId}`;
    const characters = getMap(mapId).npcs.map((placement) => this.buildCharacter(placement));
    for (const character of characters) group.add(character.model.root);
    this.ctx.scene.add(group);
    return { group, characters };
  }

  private buildCharacter(placement: NpcPlacement): Character {
    const npc = placement.id;
    const look = CAST_LOOKS[npc];
    const model = new PlayerModel(modelAppearance(look));
    model.root.name = `npc-${npc}`;

    const prop = new THREE.Mesh(createNpcPropGeometry(look.prop), this.propMaterial);
    prop.name = `prop-${look.prop}`;
    prop.castShadow = true;
    prop.receiveShadow = false;
    model[NPC_PROP_BONES[look.prop]].add(prop);

    const texture = this.makeNameplate(CAST[npc].name);
    this.textures.push(texture);
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false, fog: false }));
    plate.name = `nameplate-${npc}`;
    plate.scale.set(NPC_LOOKS.nameplateScale * NAMEPLATE_ASPECT, NPC_LOOKS.nameplateScale, 1);
    plate.position.y = NPC_LOOKS.nameplateHeight;
    plate.renderOrder = NAMEPLATE_RENDER_ORDER;
    plate.visible = false;
    model.root.add(plate);

    const rest = createPose({ ...EMPTY_HANDED_POSE, ...NPC_PROP_POSES[look.prop] });
    applyPose(model, rest);
    return { placement, model, prop, plate, rest, index: NPC_IDS.indexOf(npc) };
  }

  /** Shows `npc`'s nameplate (on the active map) and hides the one shown before. */
  private showNameplate(npc: NpcId | null): void {
    const character = npc === null ? null : (this.active?.characters.find((c) => c.placement.id === npc) ?? null);
    if (character === this.named) return;
    if (this.named !== null) this.named.plate.visible = false;
    if (character !== null) character.plate.visible = true;
    this.named = character;
  }
}
