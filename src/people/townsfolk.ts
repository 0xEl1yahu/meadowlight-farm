/**
 * The townsfolk (farmclaws part 4d spec §3): six anonymous types who walk short loops in
 * Brookhollow. Who each is, how they look and what they say. Pure data; their days live in config
 * (`TOWNSFOLK`) and the timetables.
 */
import type { Appearance, TownsfolkId } from '../core/types';

/** The name over each townsperson's head and in the chat box (spec §3.1). */
export const TOWNSFOLK_PLATES: Readonly<Record<TownsfolkId, string>> = {
  jogger: 'Jogger',
  dogWalker: 'Dog walker',
  retiree: 'Retiree',
  courier: 'Courier',
  busker: 'Busker',
  kid: 'Kid',
};

/** The line under a townsperson's name in the chat box (spec §3.3). */
export const TOWNSFOLK_ROLE = 'Brookhollow';

/** The one prop each townsperson carries on top of the player's model (spec §3.1). */
export const TOWNSFOLK_PROPS = ['headband', 'dogLead', 'book', 'satchel', 'guitar', 'chocolateTeapot'] as const;
export type TownsfolkProp = (typeof TOWNSFOLK_PROPS)[number];

export interface TownsfolkLook {
  readonly appearance: Appearance;
  readonly prop: TownsfolkProp;
}

/**
 * Each townsperson's fixed look (spec §3.1): palette indices within the APPEARANCE ranges, plus
 * their prop. None wears the player's shirt 0. Hats: 1 is no hat, 2 a cap, 3 a knitted hat. The
 * jogger's vest, the dog walker's raincoat, the retiree's cardigan and the kid's too-big hoodie
 * are their shirts; the retiree's flat cap and the courier's cap are the cap, and the busker's hat
 * lies on the ground beside his guitar.
 */
export const TOWNSFOLK_LOOKS: Readonly<Record<TownsfolkId, TownsfolkLook>> = {
  jogger: { appearance: { skinTone: 3, hairStyle: 0, hairColor: 1, shirtColor: 2, overallsColor: 0, hat: 1 }, prop: 'headband' },
  dogWalker: { appearance: { skinTone: 0, hairStyle: 1, hairColor: 3, shirtColor: 4, overallsColor: 3, hat: 1 }, prop: 'dogLead' },
  retiree: { appearance: { skinTone: 1, hairStyle: 0, hairColor: 5, shirtColor: 1, overallsColor: 5, hat: 2 }, prop: 'book' },
  courier: { appearance: { skinTone: 4, hairStyle: 2, hairColor: 0, shirtColor: 5, overallsColor: 1, hat: 2 }, prop: 'satchel' },
  busker: { appearance: { skinTone: 2, hairStyle: 2, hairColor: 2, shirtColor: 6, overallsColor: 4, hat: 1 }, prop: 'guitar' },
  kid: { appearance: { skinTone: 3, hairStyle: 1, hairColor: 4, shirtColor: 7, overallsColor: 2, hat: 1 }, prop: 'chocolateTeapot' },
};

/** Each townsperson's three lines (spec §3.3); a day's line is picked from these. */
export const TOWNSFOLK_LINES: Readonly<Record<TownsfolkId, readonly [string, string, string]>> = {
  jogger: ["Can't stop! Personal best!", 'Three laps before the shops open. Every day.', "Robots don't jog. More river for me."],
  dogWalker: [
    "This is Biscuit. Biscuit, sit. Biscuit doesn't do commands. Unlike your robots.",
    'Biscuit barks at the SLOPMART sign. Smart dog.',
    'Twice round the square, then home for a biscuit. Not you, Biscuit.',
  ],
  retiree: [
    'Machines that never get tired never stop to wonder if they should.',
    'I read the instructions. Nobody reads the instructions any more.',
    "I don't need a robot. I don't need a map either. I've only been lost the once.",
  ],
  courier: [
    "Parcels for Marigold, parcels for Sol. Everyone's ordering parts these days.",
    'One cart, two legs, no tokens. Beat that.',
    "A tick on the form means nothing if the parcel isn't on the step.",
  ],
  busker: [
    "Requests? I know three songs, and they're all about rain.",
    "Coins in the hat if you've got them. Slop in the hat if you haven't.",
    'That robot at SLOPMART reviewed my set. One star. It said it loved it.',
  ],
  kid: [
    'Next box is a gem. I can feel it.',
    "I've got eleven chocolate teapots. The twelfth one's the lucky one.",
    "DEALZ called me pal. We're basically friends.",
  ],
};
