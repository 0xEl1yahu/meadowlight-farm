/**
 * WalkerRenderer: every walker out on the map the player is on, where their saved places put them
 * (farmclaws part 4a spec §2.3, part 4d spec §4.6). It replaces part 4a's NpcRenderer. The rules
 * (who is shown, glide or snap, shared tiles, ground props, sway, nameplates) are walkerLayout.ts's.
 *
 * - Each walker is a PlayerModel in their look (npcProps.walkerLook, modelAppearance), with their
 *   prop on the prop's bone and a nameplate sprite above their head: ten meshes and a sprite. The
 *   dog walker, the courier and the busker also get a ground prop (the dog, the cart, the hat) hung
 *   from the root, so it follows their place and facing without a tile of its own.
 * - A walker is built the first time they are out on the map the player is on, and kept; only the
 *   walkers out on the active map are shown. Whenever the places or the map change, each shown
 *   walker heads for their tile: a glide to an adjacent tile on the same map, a snap otherwise
 *   (walkerLayout.walkerMotion). A rebuild, a map change or a walker who wasn't shown snaps.
 * - Walkers stand on their tile centre at the player's ground height (playerGroundHeight,
 *   playerRootHeight), spread by sharedTileOffsets when they share a tile. They ease their turns
 *   like robots (robotLayout.easeYaw), never toward the player.
 * - update() moves the gliders, eases every shown walker's yaw, and sways every shown walker's
 *   upper body by swayAngle, out of step by WALKER_IDS index: standing, and on through each glide,
 *   so a step never jolts the sway.
 * - The nameplate of the walker on the tile ahead (nameplateFor) shows while the game isn't
 *   frozen. Each plate's texture is drawn once, when its walker is built.
 */
import * as THREE from 'three';
import { NPC_LOOKS, WORLD } from '../config';
import type { GameState, WalkerId } from '../core/types';
import { selectActiveMapId } from '../state/selectors';
import { directionYaw } from '../world/grid';
import { getTile } from '../world/tiles';
import { createFlatMaterial } from './materials';
import { NAMEPLATE_ASPECT, createNameplateTexture, walkerName } from './nameplates';
import { NPC_PROP_BONES, NPC_PROP_POSES, createGroundPropGeometry, createNpcPropGeometry, modelAppearance, walkerLook } from './npcProps';
import { EMPTY_HANDED_POSE, playerBlobLocalHeight, playerGroundHeight, playerRootHeight } from './PlayerRenderer';
import { PlayerModel, applyPose, copyPose, createPose, type Pose } from './playerModel';
import { easeYaw, sharedOffsetXZ } from './robotLayout';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';
import { WALKER_GROUND_PROPS, nameplateFor, shownWalkers, swayAngle, walkerMotion, walkerOffsets, type OutPlace } from './walkerLayout';

/** Nameplates draw after the scene's meshes, like the zone letters. */
const NAMEPLATE_RENDER_ORDER = 3;

/** Draws one walker's nameplate texture; WalkerRenderer calls it once per walker. */
export type NameplateFactory = (name: string) => THREE.Texture;

interface Walker {
  readonly id: WalkerId;
  readonly model: PlayerModel;
  /** The prop on its bone, then the ground prop if the walker has one. */
  readonly props: readonly THREE.Mesh[];
  readonly plate: THREE.Sprite;
  /** Empty-handed, plus the prop's own joints. */
  readonly rest: Pose;
  /** Position in WALKER_IDS: the sway's phase. */
  readonly index: number;
  /** The place the model was last sent to; undefined while hidden, so the next showing snaps. */
  drawn: OutPlace | undefined;
  /** The glide: from `from` to `to` (root positions), moveT of the way over moveDur seconds. */
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  moveT: number;
  moveDur: number;
  yaw: number;
  /** The shared-tile offset (walkerOffsets). */
  offset: number;
}

/** How far along its glide a walker's model is: moveT, eased in and out like a robot's. */
function glided(walker: Walker): number {
  return walker.moveT * walker.moveT * (3 - 2 * walker.moveT);
}

export class WalkerRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly makeNameplate: NameplateFactory;
  /** Shared by every prop: their colours are baked into the geometry. */
  private readonly propMaterial = createFlatMaterial(0xffffff, { vertexColors: true });
  /** Every walker built so far, each the first time they're shown, and kept. */
  private readonly walkers = new Map<WalkerId, Walker>();
  /** Holds every built walker; it joins the scene with the first one. */
  private readonly group = new THREE.Group();
  private readonly textures: THREE.Texture[] = [];
  /** The walkers out on the active map. */
  private shown: readonly Walker[] = [];
  /** The walker whose nameplate shows. */
  private named: Walker | null = null;
  /** Scratch pose, reused every frame. */
  private readonly pose = createPose();

  /** `makeNameplate` draws the plates; tests pass a stand-in, as node has no canvas. */
  constructor(ctx: SceneContext, makeNameplate: NameplateFactory = createNameplateTexture) {
    this.ctx = ctx;
    this.makeNameplate = makeNameplate;
    this.group.name = 'walkers';
  }

  sync(state: GameState, prev: GameState | null): void {
    const fresh = prev === null || prev.player.mapId !== state.player.mapId;
    if (fresh || prev.npcs !== state.npcs || prev.townsfolk !== state.townsfolk) this.place(state, fresh);
    this.showNameplate(nameplateFor(state));
  }

  update(frame: FrameContext): void {
    for (const walker of this.shown) {
      if (walker.moveT < 1) walker.moveT = Math.min(1, walker.moveT + frame.dt / walker.moveDur);
      if (walker.drawn !== undefined) walker.yaw = easeYaw(walker.yaw, directionYaw(walker.drawn.facing), frame.dt);
      this.stand(walker);
      copyPose(this.pose, walker.rest);
      this.pose.tilt += swayAngle(frame.elapsed, walker.index);
      applyPose(walker.model, this.pose);
    }
  }

  dispose(): void {
    for (const walker of this.walkers.values()) {
      for (const prop of walker.props) prop.geometry.dispose();
      walker.plate.material.dispose();
      walker.model.dispose();
    }
    this.group.removeFromParent();
    for (const texture of this.textures) texture.dispose();
    this.propMaterial.dispose();
    this.walkers.clear();
    this.textures.length = 0;
    this.shown = [];
    this.named = null;
  }

  /**
   * Shows the walkers out on the active map, building each on their first showing, and sends each
   * to their tile: gliding or snapping by walkerMotion. `fresh` (a rebuild or a map change) snaps all.
   */
  private place(state: GameState, fresh: boolean): void {
    const mapId = selectActiveMapId(state);
    const world = state.maps[mapId];
    const here = shownWalkers(state, mapId);
    const offsets = walkerOffsets(here);
    const shown = here.map(({ id, place, index }) => {
      const walker = this.walkers.get(id) ?? this.build(id, index);
      const motion = walkerMotion(world.grid, fresh ? undefined : walker.drawn, place, state.ui.timeScale);
      if (motion !== null) {
        const groundY = playerGroundHeight(getTile(world, place.tx, place.tz));
        const rootY = playerRootHeight(groundY);
        // Mid-glide, the next glide starts from where the model is now.
        walker.from.lerp(walker.to, glided(walker));
        walker.to.set(motion.x, rootY, motion.z);
        walker.moveT = motion.seconds === 0 ? 1 : 0;
        walker.moveDur = motion.seconds;
        if (motion.seconds === 0) walker.yaw = directionYaw(place.facing);
        // The blob and any ground prop are children of the root, so their heights are relative to it.
        walker.model.groundBlob.position.y = playerBlobLocalHeight(groundY);
        const ground = walker.props[1];
        if (ground !== undefined) ground.position.y = groundY - rootY;
      }
      walker.drawn = place;
      walker.offset = offsets.get(id) ?? 0;
      walker.model.root.visible = true;
      this.stand(walker);
      return walker;
    });
    for (const walker of this.walkers.values()) {
      if (!shown.includes(walker)) {
        walker.model.root.visible = false;
        walker.drawn = undefined;
      }
    }
    this.shown = shown;
  }

  /** Puts the model where its glide has got to, spread by its shared-tile offset, at its yaw. */
  private stand(walker: Walker): void {
    const shared = sharedOffsetXZ(walker.offset);
    const root = walker.model.root;
    root.position.lerpVectors(walker.from, walker.to, glided(walker));
    root.position.x += shared.x;
    root.position.z += shared.z;
    root.rotation.y = walker.yaw;
  }

  private build(id: WalkerId, index: number): Walker {
    const look = walkerLook(id);
    const model = new PlayerModel(modelAppearance(look));
    model.root.name = `walker-${id}`;

    const prop = new THREE.Mesh(createNpcPropGeometry(look.prop), this.propMaterial);
    prop.name = `prop-${look.prop}`;
    prop.castShadow = true;
    model[NPC_PROP_BONES[look.prop]].add(prop);
    const props = [prop];

    const groundProp = WALKER_GROUND_PROPS[id];
    if (groundProp !== undefined) {
      const ground = new THREE.Mesh(createGroundPropGeometry(groundProp.prop), this.propMaterial);
      ground.name = `ground-${groundProp.prop}`;
      ground.castShadow = true;
      // Along the walker's facing: the model faces +Z.
      ground.position.z = groundProp.ahead * WORLD.tileSize;
      model.root.add(ground);
      props.push(ground);
    }

    const texture = this.makeNameplate(walkerName(id));
    this.textures.push(texture);
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false, fog: false }));
    plate.name = `nameplate-${id}`;
    plate.scale.set(NPC_LOOKS.nameplateScale * NAMEPLATE_ASPECT, NPC_LOOKS.nameplateScale, 1);
    plate.position.y = NPC_LOOKS.nameplateHeight;
    plate.renderOrder = NAMEPLATE_RENDER_ORDER;
    plate.visible = false;
    model.root.add(plate);

    const rest = createPose({ ...EMPTY_HANDED_POSE, ...NPC_PROP_POSES[look.prop] });
    applyPose(model, rest);
    if (this.group.parent === null) this.ctx.scene.add(this.group);
    this.group.add(model.root);
    const walker: Walker = {
      id, model, props, plate, rest, index, drawn: undefined,
      from: new THREE.Vector3(), to: new THREE.Vector3(), moveT: 1, moveDur: 0, yaw: 0, offset: 0,
    };
    this.walkers.set(id, walker);
    return walker;
  }

  /** Shows the nameplate of `id` if they're shown on the active map, and hides the one shown before. */
  private showNameplate(id: WalkerId | null): void {
    const walker = id === null ? null : (this.shown.find((w) => w.id === id) ?? null);
    if (walker === this.named) return;
    if (this.named !== null) this.named.plate.visible = false;
    if (walker !== null) walker.plate.visible = true;
    this.named = walker;
  }
}
