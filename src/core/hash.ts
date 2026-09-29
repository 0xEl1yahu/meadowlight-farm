/**
 * Deterministic hashing and pseudo-random generation.
 *
 * The simulation never calls Math.random(): every stochastic decision (debris placement,
 * weather, harvest yield, soil reverting) is a pure function of the world seed and the
 * coordinates of the decision, so replaying the same actions always yields the same state.
 */

/** Salts keep independent decisions that share coordinates uncorrelated. */
export const Salt = {
  Debris: 0x1b873593,
  Weather: 0x2c1b3c6d,
  Untill: 0x297a2d39,
  Yield: 0x7ed55d16,
  Cosmetic: 0x165667b1,
  Wild: 0x5bd1e995,
  WildPick: 0x3c6ef372,
  MapForest: 0x68e31da4,
  MapTown: 0xb5297a4d,
  ForestGen: 0x1b56c4e9,
  TownGen: 0x7fb5d329,
  Quality: 0x2545f491,
  Weeds: 0x9e3779b9,
  Festival: 0xbf58476d,
  Gift: 0xa0761d65,
  Crow: 0x85ebca6b,
  GiantCrop: 0xc2b2ae35,
  Sap: 0x27d4eb2f,
  CopperOre: 0xd35a2d97,
  Forage: 0x4cf5ad43,
  NoticeBoard: 0x94d049bb,
  AnimalProduct: 0x632be5ab,
} as const;

/**
 * MurmurHash3-style 32-bit mix over a list of integers. Non-integer inputs are truncated
 * toward zero, so pass integers (tile coordinates, day indices, salts).
 * Returns an unsigned 32-bit integer.
 */
export function hash32(...values: readonly number[]): number {
  let h = 0x9747b28c ^ values.length;
  for (let i = 0; i < values.length; i++) {
    let k = (values[i] ?? 0) | 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform float in [0, 1) derived from hash32. */
export function hashFloat(...values: readonly number[]): number {
  return hash32(...values) / 4294967296;
}

/** Integer in [min, max] (inclusive) derived from hash32. */
export function hashRange(min: number, max: number, ...values: readonly number[]): number {
  if (max < min) throw new RangeError(`hashRange: max (${max}) < min (${min})`);
  return min + Math.floor(hashFloat(...values) * (max - min + 1));
}

/**
 * Small, fast, stateful PRNG (mulberry32). Used only by presentation code for cosmetic
 * variety (particle spread etc.); never used inside reducers.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
