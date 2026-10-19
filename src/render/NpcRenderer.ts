/**
 * NpcRenderer: the cast where their saved places put them (farmclaws part 4a spec §2.3, part 4d
 * spec §4.1). Part 4d's walker renderer replaces it; until then characters stand still on their
 * tile and snap to a new one.
 *
 * - Each character is a PlayerModel in its CAST_LOOKS appearance (modelAppearance), with its
 *   prop (npcProps.ts) on the prop's bone and a nameplate sprite above its head: ten meshes and
 *   a sprite per character.
 * - A character is built the first time they are out on the map the player is on, and kept; only
 *   the characters out on the active map are shown. Whenever the places or the map change, each
 *   shown character is stood on their tile again.
 * - Characters stand on their tile centre at the player's ground height (playerGroundHeight,
 *   playerRootHeight), facing their place's direction through directionYaw as the player does.
 *   They never turn toward the player.
 * - update() sways each shown character's upper body by swayAngle, out of step by NPC_IDS index.
 * - The nameplate of the character on the tile ahead (nameplateFor) shows while the game isn't
 *   frozen. Each plate's texture is drawn once, when its character is built.
 */
import * as THREE from 'three';
import { NPC_LOOKS } from '../config';
import { NPC_IDS, type GameState, type NpcId, type WalkerId } from '../core/types';
import { CAST, CAST_LOOKS } from '../people/cast';
import { walkerAt } from '../people/walk';
import { selectActiveMapId, selectIsFrozen, selectTargetTile } from '../state/selectors';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
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

/** The walker on the tile ahead of the player, whose nameplate shows; null while the game is frozen. */
export function nameplateFor(state: GameState): WalkerId | null {
  if (selectIsFrozen(state)) return null;
  const target = selectTargetTile(state);
  return target === null ? null : walkerAt(state, state.player.mapId, target.tx, target.tz);
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
  readonly npc: NpcId;
  readonly model: PlayerModel;
  readonly prop: THREE.Mesh;
  readonly plate: THREE.Sprite;
  /** Empty-handed, plus the prop's own joints (a held clipboard). */
  readonly rest: Pose;
  /** Position in NPC_IDS: the sway's phase. */
  readonly index: number;
}

export class NpcRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly makeNameplate: NameplateFactory;
  /** Shared by every prop: their colours are baked into the geometry. */
  private readonly propMaterial = createFlatMaterial(0xffffff, { vertexColors: true });
  /** Every character built so far, each the first time they're shown, and kept. */
  private readonly characters = new Map<NpcId, Character>();
  /** Holds every built character; it joins the scene with the first one. */
  private readonly group = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  /** The characters out on the active map. */
  private shown: readonly Character[] = [];
  /** The character whose nameplate shows. */
  private named: Character | null = null;
  /** Scratch pose, reused every frame. */
  private readonly pose = createPose();

  /** `makeNameplate` draws the plates; tests pass a stand-in, as node has no canvas. */
  constructor(ctx: SceneContext, makeNameplate: NameplateFactory = createNameplateTexture) {
    this.ctx = ctx;
    this.makeNameplate = makeNameplate;
    this.group.name = 'npcs';
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev === null || prev.npcs !== state.npcs || prev.player.mapId !== state.player.mapId) this.place(state);
    this.showNameplate(nameplateFor(state));
  }

  update(frame: FrameContext): void {
    for (const character of this.shown) {
      copyPose(this.pose, character.rest);
      this.pose.tilt += swayAngle(frame.elapsed, character.index);
      applyPose(character.model, this.pose);
    }
  }

  dispose(): void {
    for (const character of this.characters.values()) {
      character.prop.geometry.dispose();
      character.plate.material.dispose();
      character.model.dispose();
    }
    this.group.removeFromParent();
    for (const texture of this.textures) texture.dispose();
    this.propMaterial.dispose();
    this.characters.clear();
    this.textures.length = 0;
    this.shown = [];
    this.named = null;
  }

  /** Shows the characters out on the active map, building each on their first showing, and stands them on their tiles. */
  private place(state: GameState): void {
    const mapId = selectActiveMapId(state);
    const world = state.maps[mapId];
    const shown: Character[] = [];
    for (const npc of NPC_IDS) {
      const place = state.npcs[npc].place;
      const here = place.kind === 'out' && place.mapId === mapId;
      const known = this.characters.get(npc);
      if (!here) {
        if (known !== undefined) known.model.root.visible = false;
        continue;
      }
      const character = known ?? this.buildCharacter(npc);
      const groundY = playerGroundHeight(getTile(world, place.tx, place.tz));
      const root = character.model.root;
      root.visible = true;
      root.position.set(tileCenterX(world.grid, place.tx), playerRootHeight(groundY), tileCenterZ(world.grid, place.tz));
      root.rotation.y = directionYaw(place.facing);
      // The blob is a child of the root, so its height is relative to where the root sits.
      character.model.groundBlob.position.y = playerBlobLocalHeight(groundY);
      shown.push(character);
    }
    this.shown = shown;
  }

  private buildCharacter(npc: NpcId): Character {
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
    if (this.group.parent === null) this.ctx.scene.add(this.group);
    this.group.add(model.root);
    const character: Character = { npc, model, prop, plate, rest, index: NPC_IDS.indexOf(npc) };
    this.characters.set(npc, character);
    return character;
  }

  /** Shows the nameplate of `walker` if they're a character shown on the active map, and hides the one shown before. */
  private showNameplate(walker: WalkerId | null): void {
    const character = walker === null ? null : (this.shown.find((c) => c.npc === walker) ?? null);
    if (character === this.named) return;
    if (this.named !== null) this.named.plate.visible = false;
    if (character !== null) character.plate.visible = true;
    this.named = character;
  }
}
