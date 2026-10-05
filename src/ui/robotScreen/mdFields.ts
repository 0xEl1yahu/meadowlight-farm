/**
 * The .MD tab's pure rules (farmclaws part 3 spec §4.3): each card's words and fields, new
 * cards, field edits, ordering, the cards a player may add, and the counter. No DOM, so
 * tests/robotScreen.test.ts covers it; MdTab.ts draws what these return. checkMd stays the only
 * judge of whether the cards are allowed.
 */
import { ROBOTS, ROBOT_SCREEN } from '../../config';
import {
  CROP_IDS,
  MD_CARD_KINDS,
  ZONE_IDS,
  type CropId,
  type MdCard,
  type Robot,
  type RobotSize,
  type RobotUnlocks,
  type ZoneId,
} from '../../core/types';
import { isItemId } from '../../items/items';
import { batteryFor } from '../../robots/stats';
import { MAPS } from '../../world/maps';
import { dropdownOptions } from './blockly/toolbox';

export type MdCardKind = MdCard['kind'];

/** A card value a field edits. */
export type MdFieldKey = 'zone' | 'cropId' | 'itemId' | 'to' | 'tx' | 'tz' | 'minute' | 'when' | 'n';

const FIELD_KEYS: readonly MdFieldKey[] = ['zone', 'cropId', 'itemId', 'to', 'tx', 'tz', 'minute', 'when', 'n'];

export type MdField =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'select';
      readonly key: MdFieldKey;
      /** The accessible name. */
      readonly label: string;
      readonly value: string;
      readonly options: readonly (readonly [label: string, value: string])[];
    }
  | {
      readonly kind: 'number';
      readonly key: MdFieldKey;
      readonly label: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
    };

export const MD_TEXT = {
  scriptOnly: '.MD cards only apply to block programs.',
  cantSave: "These cards can't be saved.",
  noCards: 'No cards yet.',
  addCard: 'Add a card',
  save: 'Save',
  doHeading: '## DO',
  dontHeading: "## DON'T",
} as const;

/** The "Add a card" menu's words for each kind. */
export const CARD_LABELS: Readonly<Record<MdCardKind, string>> = {
  dontLeave: "DON'T leave a zone",
  dontGoIntoWater: "DON'T go into water",
  dontHarvest: "DON'T harvest a crop",
  dontDeposit: "DON'T deposit an item",
  doReturn: 'DO return somewhere at a time',
  doPowerDown: 'DO power down when…',
};

const RETURN_TO: readonly (readonly [string, string])[] = [
  ['a tile', 'tile'],
  ['the nearest generator', 'generator'],
];

const POWER_WHEN: readonly (readonly [string, string])[] = [
  ['my bag is full', 'bagFull'],
  ['tokens are below', 'tokensBelow'],
  ['it rains', 'raining'],
];

const FARM = MAPS.farm.grid;
const WHOLE_NUMBER = /^-?\d+$/;

function isCropId(value: string): value is CropId {
  return (CROP_IDS as readonly string[]).includes(value);
}

function isZoneId(value: string): value is ZoneId {
  return (ZONE_IDS as readonly string[]).includes(value);
}

export function isMdFieldKey(value: string | undefined): value is MdFieldKey {
  return (FIELD_KEYS as readonly (string | undefined)[]).includes(value);
}

function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

const text = (words: string): MdField => ({ kind: 'text', text: words });
const select = (key: MdFieldKey, label: string, value: string, options: readonly (readonly [string, string])[]): MdField => ({
  kind: 'select',
  key,
  label,
  value,
  options,
});
const numberField = (key: MdFieldKey, label: string, value: number, min: number, max: number): MdField => ({
  kind: 'number',
  key,
  label,
  value,
  min,
  max,
});

/** A card's line: its words with dropdowns and number fields (spec §4.3). The token count goes up to the battery of a robot of `size`, as checkMd allows. */
export function cardFields(card: MdCard, size: RobotSize): readonly MdField[] {
  switch (card.kind) {
    case 'dontLeave':
      return [text('Leave'), select('zone', 'Zone', card.zone, dropdownOptions('zone', card.zone))];
    case 'dontGoIntoWater':
      return [text('Go into water')];
    case 'dontHarvest':
      return [text('Harvest'), select('cropId', 'Crop', card.cropId, dropdownOptions('crop', card.cropId))];
    case 'dontDeposit':
      return [text('Deposit'), select('itemId', 'Item', card.itemId, dropdownOptions('item', card.itemId))];
    case 'doReturn': {
      const to = card.to;
      const tile =
        to.kind === 'tile' ? [numberField('tx', 'X', to.tx, 0, FARM.width - 1), numberField('tz', 'Z', to.tz, 0, FARM.depth - 1)] : [];
      return [
        text('Return to'),
        select('to', 'Where', to.kind, RETURN_TO),
        ...tile,
        text('at'),
        select('minute', 'Time', String(card.minute), dropdownOptions('minute', card.minute)),
      ];
    }
    case 'doPowerDown': {
      const when = card.when;
      const tokens = when.kind === 'tokensBelow' ? [numberField('n', 'Tokens', when.n, 1, batteryFor(size))] : [];
      return [text('Power down when'), select('when', 'When', when.kind, POWER_WHEN), ...tokens];
    }
  }
}

/** A new card of `kind`, with values the checker accepts for any size. */
export function newCard(kind: MdCardKind): MdCard {
  switch (kind) {
    case 'dontLeave':
      return { kind, zone: ZONE_IDS[0] };
    case 'dontGoIntoWater':
      return { kind };
    case 'dontHarvest':
      return { kind, cropId: CROP_IDS[0] };
    case 'dontDeposit':
      return { kind, itemId: CROP_IDS[0] };
    case 'doReturn':
      return { kind, to: { kind: 'generator' }, minute: ROBOT_SCREEN.cardDefaults.returnMinute };
    case 'doPowerDown':
      return { kind, when: { kind: 'bagFull' } };
  }
}

type ReturnCard = Extract<MdCard, { readonly kind: 'doReturn' }>;
type PowerDownCard = Extract<MdCard, { readonly kind: 'doPowerDown' }>;

function setReturnValue(card: ReturnCard, key: MdFieldKey, raw: string, robot: Pick<Robot, 'tx' | 'tz'>): MdCard {
  const n = wholeNumber(raw);
  const to = card.to;
  switch (key) {
    case 'to':
      if (raw === 'generator') return to.kind === 'generator' ? card : { ...card, to: { kind: 'generator' } };
      if (raw === 'tile') return to.kind === 'tile' ? card : { ...card, to: { kind: 'tile', tx: robot.tx, tz: robot.tz } };
      return card;
    case 'tx':
      return to.kind === 'tile' && n !== null ? { ...card, to: { ...to, tx: n } } : card;
    case 'tz':
      return to.kind === 'tile' && n !== null ? { ...card, to: { ...to, tz: n } } : card;
    case 'minute':
      return n !== null ? { ...card, minute: n } : card;
    default:
      return card;
  }
}

function setPowerDownValue(card: PowerDownCard, key: MdFieldKey, raw: string): MdCard {
  const when = card.when;
  if (key === 'n') {
    const n = wholeNumber(raw);
    return when.kind === 'tokensBelow' && n !== null ? { ...card, when: { kind: 'tokensBelow', n } } : card;
  }
  if (key !== 'when' || raw === when.kind) return card;
  if (raw === 'bagFull' || raw === 'raining') return { ...card, when: { kind: raw } };
  if (raw === 'tokensBelow') return { ...card, when: { kind: 'tokensBelow', n: ROBOT_SCREEN.cardDefaults.tokensBelow } };
  return card;
}

/**
 * `card` with the field `key` set from an input's text, or `card` itself when the text isn't a
 * value of that field. A return switched to "a tile" starts at the robot's tile.
 */
export function setCardValue(card: MdCard, key: MdFieldKey, raw: string, robot: Pick<Robot, 'tx' | 'tz'>): MdCard {
  switch (card.kind) {
    case 'dontLeave':
      return key === 'zone' && isZoneId(raw) && raw !== card.zone ? { ...card, zone: raw } : card;
    case 'dontGoIntoWater':
      return card;
    case 'dontHarvest':
      return key === 'cropId' && isCropId(raw) && raw !== card.cropId ? { ...card, cropId: raw } : card;
    case 'dontDeposit':
      return key === 'itemId' && isItemId(raw) && raw !== card.itemId ? { ...card, itemId: raw } : card;
    case 'doReturn':
      return setReturnValue(card, key, raw, robot);
    case 'doPowerDown':
      return setPowerDownValue(card, key, raw);
  }
}

/** DO cards take over at their moment; DON'T cards forbid (design §3.3). */
export function cardSection(card: MdCard): 'do' | 'dont' {
  return card.kind === 'doReturn' || card.kind === 'doPowerDown' ? 'do' : 'dont';
}

/** `cards` with card `index` swapped with the nearest card of its own section above (-1) or below (1). */
export function moveCard(cards: readonly MdCard[], index: number, step: -1 | 1): readonly MdCard[] {
  const card = cards[index];
  if (card === undefined) return cards;
  const section = cardSection(card);
  for (let other = index + step; other >= 0 && other < cards.length; other += step) {
    const neighbour = cards[other];
    if (neighbour === undefined || cardSection(neighbour) !== section) continue;
    const next = [...cards];
    next[index] = neighbour;
    next[other] = card;
    return next;
  }
  return cards;
}

export function removeCard(cards: readonly MdCard[], index: number): readonly MdCard[] {
  return cards.filter((_, at) => at !== index);
}

/** "Add a card" lists the unlocked kinds, in MD_CARD_KINDS order (spec §4.3, §7). */
export function addCardOptions(unlocks: RobotUnlocks): readonly { readonly kind: MdCardKind; readonly label: string }[] {
  return MD_CARD_KINDS.filter((kind) => unlocks.cards.includes(kind)).map((kind) => ({ kind, label: CARD_LABELS[kind] }));
}

/** The card's heading: "# {NAME}.MD". */
export function mdTitle(name: string): string {
  return `# ${name.toUpperCase()}.MD`;
}

/** "{n} / {limit} cards". */
export function mdCountText(md: readonly MdCard[], size: RobotSize): string {
  return `${md.length} / ${ROBOTS.sizes[size].mdCards} cards`;
}

export function mdOverLimit(md: readonly MdCard[], size: RobotSize): boolean {
  return md.length > ROBOTS.sizes[size].mdCards;
}
