/**
 * ZoneRenderer — zones A–H drawn on the farm (farmclaws part 3 spec §8).
 *
 * - When: on the farm, while the zone marker is the selected hotbar item or a robot screen is
 *   open. Hidden everywhere else.
 * - Each set zone: a thin outline in its colour (ZONE_MARKER.colors, A … H) along every outer
 *   tile edge, ZONE_MARKER.outlineHeight above the ground of the zone tile the edge borders and
 *   inset by half a stroke so neighbouring zones stay apart; and its letter floating over its
 *   north-west tile.
 * - The draft: the same outline, paler, from the draft's corner to the highlighted tile
 *   (selectTargetTile, the tile the next press would mark), so it follows the player.
 * - Two InstancedMeshes of one flat quad (set zones, draft), each sized once for every edge the
 *   farm can hold, and eight letter sprites cut from one canvas atlas drawn in the constructor.
 *   Matrices are written in sync only, when the zones, the draft, the target or the farm's
 *   ground change. update() only bobs the letters, without allocating.
 */
import * as THREE from 'three';
import { ZONE_MARKER } from '../config';
import { ZONE_IDS, type GameState, type WorldState, type ZoneId, type ZoneRect } from '../core/types';
import { zoneRectBetween } from '../robots/zones';
import { isZoneMarkerSelected, selectTargetTile } from '../state/selectors';
import { tileCenterX, tileCenterZ } from '../world/grid';
import { MAPS } from '../world/maps';
import { getTile } from '../world/tiles';
import type { SceneContext } from './SceneContext';
import { highlightGroundHeight } from './TileHighlighter';
import type { FrameContext, RenderSystem } from './types';

/** Outline stroke width, as a share of a tile. */
const STROKE = 0.08;
/** The draft's outline mixes this much white into its zone's colour. */
const DRAFT_PALENESS = 0.45;
/** Letter sprites: their size, and how high they float above the corner tile's ground (world units). */
const LETTER_SIZE = 0.6;
const LETTER_LIFT = 0.55;
const LETTER_BOB = 0.04;
const LETTER_BOB_RATE = 2.2;
/** The letter atlas: one square cell per zone, white letters with an ink outline, tinted per sprite. */
const ATLAS_CELL = 64;
const ATLAS_FONT = `700 ${Math.round(ATLAS_CELL * 0.7)}px "Trebuchet MS", "Segoe UI", sans-serif`;
const ATLAS_INK = '#5a3d2b';
const ATLAS_OUTLINE = 8;

/** Outer tile edges of the largest rectangle the farm holds: the most one outline ever needs. */
const MAX_EDGES = 2 * (MAPS.farm.grid.width + MAPS.farm.grid.depth);

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

function zoneColor(id: ZoneId): number {
  return ZONE_MARKER.colors[ZONE_IDS.indexOf(id)] ?? 0xffffff;
}

function sameRect(a: ZoneRect | null, b: ZoneRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x0 === b.x0 && a.z0 === b.z0 && a.w === b.w && a.d === b.d;
}

/** A canvas holding the letters A … H side by side, one ATLAS_CELL square each. */
function drawLetterAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_CELL * ZONE_IDS.length;
  canvas.height = ATLAS_CELL;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('ZoneRenderer: no 2D canvas context for the zone letters');
  g.font = ATLAS_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = ATLAS_OUTLINE;
  g.strokeStyle = ATLAS_INK;
  g.fillStyle = '#ffffff';
  ZONE_IDS.forEach((id, i) => {
    const x = (i + 0.5) * ATLAS_CELL;
    const y = ATLAS_CELL / 2;
    g.strokeText(id, x, y);
    g.fillText(id, x, y);
  });
  return canvas;
}

export class ZoneRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly group = new THREE.Group();
  private readonly quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly zoneMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  private readonly draftMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  /** Every set zone's edges; instance colours carry each zone's colour. */
  private readonly outlines: THREE.InstancedMesh;
  /** The draft's edges, in draftMaterial's one colour. */
  private readonly draft: THREE.InstancedMesh;
  private readonly atlas: THREE.CanvasTexture;
  /** One atlas view per letter (shared image, own offset), in ZONE_IDS order. */
  private readonly letterMaps: readonly THREE.Texture[];
  private readonly letters: readonly THREE.Sprite[];
  /** Resting height of each letter, for the bob. */
  private readonly letterY = new Float32Array(ZONE_IDS.length);
  /** What is drawn now: the zones and farm it was laid out from (null when hidden), and the draft. */
  private zones: GameState['robots']['zones'] | null = null;
  private farm: WorldState | null = null;
  private draftRect: ZoneRect | null = null;
  private draftZone: ZoneId | null = null;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const capacity = MAX_EDGES * ZONE_IDS.length;
    this.outlines = new THREE.InstancedMesh(this.quad, this.zoneMaterial, capacity);
    // Instance colours must exist before the first render, or the shader is built without them.
    this.outlines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.outlines.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.outlines.name = 'zone-outlines';
    this.draft = new THREE.InstancedMesh(this.quad, this.draftMaterial, MAX_EDGES);
    this.draft.name = 'zone-draft';
    for (const mesh of [this.outlines, this.draft]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 1;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    this.atlas = new THREE.CanvasTexture(drawLetterAtlas());
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    const maps: THREE.Texture[] = [];
    const letters: THREE.Sprite[] = [];
    ZONE_IDS.forEach((id, i) => {
      const map = this.atlas.clone();
      map.repeat.set(1 / ZONE_IDS.length, 1);
      map.offset.set(i / ZONE_IDS.length, 0);
      map.needsUpdate = true;
      const material = new THREE.SpriteMaterial({ map, color: zoneColor(id), depthWrite: false, toneMapped: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.name = `zone-letter-${id}`;
      sprite.scale.set(LETTER_SIZE, LETTER_SIZE, 1);
      sprite.renderOrder = 3;
      sprite.visible = false;
      maps.push(map);
      letters.push(sprite);
    });
    this.letterMaps = maps;
    this.letters = letters;

    this.group.name = 'zones';
    this.group.visible = false;
    this.group.add(this.outlines, this.draft, ...letters);
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    const shown = state.player.mapId === 'farm' && (isZoneMarkerSelected(state) || state.ui.panel.kind === 'robot');
    this.group.visible = shown;
    if (!shown) {
      this.zones = null;
      this.farm = null;
      this.draftRect = null;
      this.draftZone = null;
      return;
    }
    const farm = state.maps.farm;
    const groundChanged = prev === null || farm !== this.farm;
    if (groundChanged || state.robots.zones !== this.zones) this.layoutZones(state.robots.zones, farm);
    this.layoutDraft(state, farm, groundChanged);
    this.zones = state.robots.zones;
    this.farm = farm;
  }

  update(frame: FrameContext): void {
    if (!this.group.visible) return;
    const bob = LETTER_BOB * Math.sin(frame.elapsed * LETTER_BOB_RATE);
    for (let i = 0; i < this.letters.length; i++) {
      const letter = this.letters[i];
      if (letter !== undefined && letter.visible) letter.position.y = (this.letterY[i] ?? 0) + bob;
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.group.clear();
    this.outlines.dispose();
    this.draft.dispose();
    this.quad.dispose();
    this.zoneMaterial.dispose();
    this.draftMaterial.dispose();
    for (const letter of this.letters) letter.material.dispose();
    for (const map of this.letterMaps) map.dispose();
    this.atlas.dispose();
  }

  /** Outlines and letters for every set zone. */
  private layoutZones(zones: GameState['robots']['zones'], farm: WorldState): void {
    let used = 0;
    ZONE_IDS.forEach((id, i) => {
      const rect = zones[id];
      const letter = this.letters[i];
      if (letter === undefined) return;
      letter.visible = rect !== null;
      if (rect === null) return;
      used = this.layoutOutline(this.outlines, used, rect, farm, scratchColor.setHex(zoneColor(id)));
      const corner = getTile(farm, rect.x0, rect.z0);
      const y = (corner === null ? 0 : highlightGroundHeight(corner)) + LETTER_LIFT;
      this.letterY[i] = y;
      letter.position.set(tileCenterX(farm.grid, rect.x0), y, tileCenterZ(farm.grid, rect.z0));
    });
    this.commit(this.outlines, used);
  }

  /** The draft's outline, from its corner to the tile the next press would mark. */
  private layoutDraft(state: GameState, farm: WorldState, force: boolean): void {
    const draft = state.ui.zoneDraft;
    const rect = draft === null ? null : zoneRectBetween(draft.corner, selectTargetTile(state) ?? draft.corner);
    const zone = draft === null ? null : draft.zone;
    if (!force && zone === this.draftZone && sameRect(rect, this.draftRect)) return;
    this.draftRect = rect;
    this.draftZone = zone;
    if (rect === null || zone === null) {
      this.commit(this.draft, 0);
      return;
    }
    this.draftMaterial.color.setHex(zoneColor(zone)).lerp(WHITE, DRAFT_PALENESS);
    this.commit(this.draft, this.layoutOutline(this.draft, 0, rect, farm, null));
  }

  /**
   * One quad per outer tile edge of `rect`, written into `mesh` from slot `start` (with `color`
   * as the instance colour when given). Returns the next free slot.
   */
  private layoutOutline(mesh: THREE.InstancedMesh, start: number, rect: ZoneRect, farm: WorldState, color: THREE.Color | null): number {
    const grid = farm.grid;
    const ts = grid.tileSize;
    const half = (STROKE * ts) / 2;
    const north = grid.originZ + rect.z0 * ts + half;
    const south = grid.originZ + (rect.z0 + rect.d) * ts - half;
    const west = grid.originX + rect.x0 * ts + half;
    const east = grid.originX + (rect.x0 + rect.w) * ts - half;
    let slot = start;
    for (let tx = rect.x0; tx < rect.x0 + rect.w; tx++) {
      const x = tileCenterX(grid, tx);
      slot = this.edge(mesh, slot, farm, tx, rect.z0, x, north, true, color);
      slot = this.edge(mesh, slot, farm, tx, rect.z0 + rect.d - 1, x, south, true, color);
    }
    for (let tz = rect.z0; tz < rect.z0 + rect.d; tz++) {
      const z = tileCenterZ(grid, tz);
      slot = this.edge(mesh, slot, farm, rect.x0, tz, west, z, false, color);
      slot = this.edge(mesh, slot, farm, rect.x0 + rect.w - 1, tz, east, z, false, color);
    }
    return slot;
  }

  /** One edge: a tile long along x (`alongX`) or z, one stroke wide, just above tile (tx, tz)'s ground. */
  private edge(
    mesh: THREE.InstancedMesh,
    slot: number,
    farm: WorldState,
    tx: number,
    tz: number,
    x: number,
    z: number,
    alongX: boolean,
    color: THREE.Color | null,
  ): number {
    const ts = farm.grid.tileSize;
    const stroke = STROKE * ts;
    const tile = getTile(farm, tx, tz);
    const y = (tile === null ? 0 : highlightGroundHeight(tile)) + ZONE_MARKER.outlineHeight;
    scratchMatrix.makeScale(alongX ? ts : stroke, 1, alongX ? stroke : ts).setPosition(x, y, z);
    mesh.setMatrixAt(slot, scratchMatrix);
    if (color !== null) mesh.setColorAt(slot, color);
    return slot + 1;
  }

  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}
