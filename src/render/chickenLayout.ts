/**
 * Cosmo's chickens (farmclaws part 4d spec §7.3): where each of the five is at a moment of render
 * time. Pure and render-only: each chicken's pattern comes from its index through hashFloat, never
 * Math.random, so a moment always looks the same, and nothing here is saved or simulated.
 *
 * A chicken hops from spot to spot: it walks to its next spot, then stands and pecks until the
 * next hop. Every spot is inside the run, CHICKEN_WANDER.margin clear of its fence, and a chicken
 * is only ever on a spot or on the straight line between two, so it never leaves the run.
 */
import { Salt, hashFloat } from '../core/hash';
import { CHICKEN_RUN, ringInside } from '../world/maps/neighbours';

/** Five chickens peck about the run (spec §7.3). */
export const CHICKEN_COUNT = 5;

export const CHICKEN_WANDER = {
  /** Seconds from one hop to the next, and the share of them spent walking. */
  hop: 3.4,
  walk: 0.35,
  /** Each chicken hops this many seconds after the one before, so they don't move in step. */
  stagger: 1.3,
  /** Spots stay this far inside the run (tiles). */
  margin: 0.22,
  /** Pecks a second while standing. */
  pecks: 1.6,
} as const;

/** Salt for the spots, beside the other cosmetic features (townGeometry's FEATURE). */
const FEATURE = 121;

/** Where a chicken is: grid-space tiles, its heading (radians about +Y; 0 faces +Z), and how far its head is down to peck (0–1). */
export interface ChickenPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly peck: number;
}

const RUN = ringInside(CHICKEN_RUN);

/** Spot `k` of chicken `index`, inside the run. */
function spot(index: number, k: number): { readonly x: number; readonly z: number } {
  const m = CHICKEN_WANDER.margin;
  return {
    x: RUN.x0 + m + hashFloat(Salt.Cosmetic, FEATURE, index, k, 0) * (RUN.width - 2 * m),
    z: RUN.z0 + m + hashFloat(Salt.Cosmetic, FEATURE, index, k, 1) * (RUN.depth - 2 * m),
  };
}

/** Chicken `index` (0 … CHICKEN_COUNT − 1) `time` seconds of render time in. */
export function chickenAt(index: number, time: number): ChickenPose {
  const W = CHICKEN_WANDER;
  const hops = (time + index * W.stagger) / W.hop;
  const k = Math.floor(hops);
  const u = hops - k;
  const from = spot(index, k);
  const to = spot(index, k + 1);
  const yaw = Math.atan2(to.x - from.x, to.z - from.z);
  if (u < W.walk) {
    const s = u / W.walk;
    const eased = s * s * (3 - 2 * s);
    return { x: from.x + (to.x - from.x) * eased, z: from.z + (to.z - from.z) * eased, yaw, peck: 0 };
  }
  const standing = (u - W.walk) * W.hop;
  return { x: to.x, z: to.z, yaw, peck: Math.max(0, Math.sin(standing * W.pecks * 2 * Math.PI)) };
}
