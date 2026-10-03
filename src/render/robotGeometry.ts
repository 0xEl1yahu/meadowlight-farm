/**
 * Low-poly robot geometry (farmclaws part 1 spec §7.1), authored at Standard size (0.6 tall),
 * facing +Z, feet at y = 0. One merged, vertex-painted geometry per mesh id; eyes and particles
 * are unpainted and take their colour from the instance, and the body and head shells are white
 * and take the robot's paint from the instance (farmclaws part 3 spec §3.4).
 */
import * as THREE from 'three';
import { box, glassBox, mergeParts, normalizePart } from './geometryParts';
import { cylinder } from './objectGeometry';
import type { RobotMeshId } from './robotLayout';

export const ROBOT_COLORS = {
  /** The painted shells are authored white; the robot's paint (ROBOT_PAINTS, Sunflower first) is their instance colour. */
  shell: 0xffffff,
  trim: 0xf4efe6,
  tread: 0x3a3836,
  metal: 0x9aa0b5,
  metalDark: 0x6e7384,
  copper: 0xc9783f,
  wicker: 0xc8a064,
  lens: 0x6fb7e8,
  coreGreen: 0x5fd08a,
  coreOrange: 0xf28a3a,
  badge: 0xe24b4a,
} as const;

/** Meshes that ride on the head (they pitch with it). */
export const HEAD_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['head', 'headShell', 'eyes', 'antenna', 'lens']);
/** The painted shells of the body and head: white geometry tinted per instance with the robot's paint. */
export const SHELL_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['bodyShell', 'headShell']);
/** Height of the neck pivot. */
export const NECK_Y = 0.36;
/** The green and orange core lights sit side by side, this far either side of centre, so they never overlap. */
const CORE_LIGHT_OFFSET_X = 0.05;

export function createRobotMeshGeometry(id: RobotMeshId): THREE.BufferGeometry {
  const c = ROBOT_COLORS;
  switch (id) {
    case 'treads':
      return mergeParts([box(0.1, 0.1, 0.34, { x: -0.14, y: 0.05 }, c.tread), box(0.1, 0.1, 0.34, { x: 0.14, y: 0.05 }, c.tread)], 'robot treads');
    case 'body':
      return mergeParts([box(0.38, 0.03, 0.32, { y: 0.335 }, c.trim), box(0.1, 0.04, 0.1, { y: 0.36 }, c.metal)], 'robot body');
    case 'bodyShell':
      return mergeParts([box(0.36, 0.24, 0.3, { y: 0.22 }, c.shell)], 'robot body shell');
    case 'head':
      return mergeParts([box(0.3, 0.03, 0.26, { y: 0.565 }, c.trim)], 'robot head');
    case 'headShell':
      return mergeParts([box(0.28, 0.18, 0.24, { y: 0.47 }, c.shell)], 'robot head shell');
    case 'eyes':
      // Unpainted boxes: the eye colour comes from the instance.
      return mergeParts([glassBox(0.06, 0.05, 0.02, { x: -0.06, y: 0.48, z: 0.121 }), glassBox(0.06, 0.05, 0.02, { x: 0.06, y: 0.48, z: 0.121 })], 'robot eyes');
    case 'arm':
      return mergeParts([box(0.05, 0.05, 0.2, { x: 0.2, y: 0.24, z: 0.08 }, c.metal)], 'robot arm');
    case 'claw':
      return mergeParts([box(0.02, 0.06, 0.06, { x: 0.18, y: 0.24, z: 0.2 }, c.metalDark), box(0.02, 0.06, 0.06, { x: 0.22, y: 0.24, z: 0.2 }, c.metalDark)], 'robot claw');
    case 'spout':
      return mergeParts([cylinder(0.06, 0.07, 0.14, 8, { y: 0.28, z: -0.19 }, c.copper), box(0.03, 0.03, 0.1, { y: 0.34, z: -0.27, rx: -0.5 }, c.copper)], 'robot spout');
    case 'tines':
      return mergeParts([-0.1, 0, 0.1].map((x) => box(0.02, 0.08, 0.02, { x, y: 0.06, z: 0.2 }, c.metalDark)), 'robot tines');
    case 'hopper':
      return mergeParts([box(0.14, 0.08, 0.1, { x: -0.1, y: 0.39, z: -0.1 }, c.wicker)], 'robot hopper');
    case 'basket':
      return mergeParts([box(0.08, 0.12, 0.18, { x: -0.23, y: 0.22 }, c.wicker)], 'robot basket');
    case 'antenna':
      return mergeParts([box(0.015, 0.16, 0.015, { x: 0.08, y: 0.66 }, c.metal), box(0.04, 0.04, 0.04, { x: 0.08, y: 0.75 }, c.coreOrange)], 'robot antenna');
    case 'lens':
      return mergeParts([cylinder(0.025, 0.025, 0.02, 8, { y: 0.53, z: 0.12, rx: Math.PI / 2 }, c.lens)], 'robot lens');
    case 'coreGreen':
      return mergeParts([box(0.08, 0.06, 0.02, { x: -CORE_LIGHT_OFFSET_X, y: 0.22, z: 0.151 }, c.coreGreen)], 'robot core');
    case 'coreOrange':
      return mergeParts([box(0.08, 0.06, 0.02, { x: CORE_LIGHT_OFFSET_X, y: 0.22, z: 0.151 }, c.coreOrange)], 'robot core');
  }
}

/** A red "!" tag: a red plate with a white bar and dot, facing +Z. */
export function createBadgeGeometry(): THREE.BufferGeometry {
  return mergeParts(
    [box(0.16, 0.24, 0.03, { y: 0 }, ROBOT_COLORS.badge), box(0.04, 0.1, 0.035, { y: 0.03 }, 0xffffff), box(0.04, 0.035, 0.035, { y: -0.07 }, 0xffffff)],
    'robot badge',
  );
}

export function createParticleGeometry(): THREE.BufferGeometry {
  return normalizePart(new THREE.BoxGeometry(0.05, 0.05, 0.05));
}
