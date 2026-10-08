/**
 * Cozy pastel palette (sRGB hex). Colours are multiplied by lighting, so they are authored a
 * little brighter than they should appear at noon.
 */
export const PALETTE = {
  grass: [0xa6dc8c, 0x9fd686, 0xb0e296, 0x98d07f] as const,
  grassTuft: 0x86c96f,
  soilPlowed: 0xc99c6e,
  soilWatered: 0x8b6547,
  soilFurrow: 0xb68a5f,
  soilFurrowWet: 0x74543b,
  earthSide: 0xa98460,
  /** Packed-earth trail and path ground (forest trail, town door paths). */
  dirt: 0xd8bd92,
  /** Town street and square cobbles; each tile gets a subtle hash tint. */
  cobble: 0xc6bfb9,
  /** Warm and cool stones the cobble tint leans toward. */
  cobbleWarm: 0xd3c3ad,
  cobbleCool: 0xb3b6bd,
  rock: 0xb9b6c9,
  rockDark: 0x9c99b0,
  stumpBark: 0x9c6e4b,
  stumpTop: 0xe8c99a,
  water: 0x8fd6f2,
  waterDeep: 0x6db6df,
  pondBed: 0x7da88a,
  houseWall: 0xf7e8cc,
  houseRoof: 0xe8897a,
  houseTrim: 0x9c6b4e,
  door: 0xa8744f,
  window: 0xfff2b0,
  binWood: 0xc58b5a,
  binLid: 0x8f6a4f,
  treeTrunk: 0x8d6446,
  treeCanopy: [0x7fc47a, 0x6fb877, 0x93cf7f, 0x86c98b] as const,
  flower: [0xffb3c7, 0xfff1a8, 0xc9b6ff, 0xffffff] as const,
  fence: 0xe6cfa6,
  /** Player-built wood fence objects: a warmer, darker timber than the farm's boundary fence. */
  woodFence: 0xc99b6b,
  highlightValid: 0xffffff,
  highlightInvalid: 0xff8a8a,
  player: {
    skin: 0xf6d2b5,
    shirt: 0x7fa7e8,
    overalls: 0x5f7fb8,
    hair: 0x7a4e36,
    hat: 0xf2d98a,
    boots: 0x6b4a3a,
  },
} as const;

/**
 * Colour choices for a character's look (farmclaws part 4a refinement R14): one list per
 * Appearance colour field, sized exactly by APPEARANCE in config. Index 0 of each is the
 * player's original colour (PALETTE.player), so the default appearance draws today's farmer.
 */
export const APPEARANCE_PALETTES = {
  /** Appearance.skinTone: fair to deep. */
  skin: [PALETTE.player.skin, 0xeec3a0, 0xd9a57f, 0xb8805c, 0x8d5b3f],
  /** Appearance.hairColor: chestnut, near-black, honey, auburn, silver, flaxen. */
  hair: [PALETTE.player.hair, 0x3d2c25, 0xd8a65e, 0xb4583a, 0xa8a29c, 0xf0d58a],
  /** Appearance.shirtColor: sky, coral, leaf, sunflower, lavender, cream, mint, rose. */
  shirt: [PALETTE.player.shirt, 0xe8897a, 0x9ccf7a, 0xf2c46b, 0xc9b6ff, 0xf4ead2, 0x7fcfc4, 0xeda5c4],
  /** Appearance.overallsColor: denim, moss, walnut, plum, slate, rust. */
  overalls: [PALETTE.player.overalls, 0x6b8f5a, 0x8f6a4f, 0x7a6aa8, 0x5c6672, 0xb06e4c],
} as const satisfies Readonly<Record<'skin' | 'hair' | 'shirt' | 'overalls', readonly number[]>>;
