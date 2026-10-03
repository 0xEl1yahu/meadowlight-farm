/**
 * The editor's Blockly theme (farmclaws part 3 spec §4.2): the HUD's palette on the Zelos
 * renderer: a cream workspace, parchment toolbox and flyout, the game's rounded font, and one
 * colour per category (Triggers gold, Control orange, Actions green, Sensors teal, Values
 * purple). Colours are dark enough for Zelos's white block text.
 */
import type * as Blockly from 'blockly/core';
import type { BlockCategory } from '../../../robots/blockKinds';
import { BLOCK_CATEGORIES, categoryStyle } from './toolbox';

type BlocklyApi = typeof Blockly;

interface CategoryColours {
  readonly primary: string;
  readonly secondary: string;
  readonly tertiary: string;
}

export const CATEGORY_COLOURS: Readonly<Record<BlockCategory, CategoryColours>> = {
  triggers: { primary: '#c98f12', secondary: '#e8b84a', tertiary: '#9a6a0c' },
  control: { primary: '#d9742b', secondary: '#eea06a', tertiary: '#a8551b' },
  actions: { primary: '#4f9e5f', secondary: '#86c592', tertiary: '#3a7a47' },
  sensors: { primary: '#2f8f86', secondary: '#6bbdb5', tertiary: '#226b64' },
  values: { primary: '#7f6bc9', secondary: '#ab9de0', tertiary: '#5f4fa3' },
};

const THEME_NAME = 'meadowlight-robots';
const FONT_FAMILY = "'Fredoka', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

export function createTheme(api: BlocklyApi): Blockly.Theme {
  return api.Theme.defineTheme(THEME_NAME, {
    name: THEME_NAME,
    base: api.Themes.Classic,
    blockStyles: Object.fromEntries(
      BLOCK_CATEGORIES.map((category) => {
        const colours = CATEGORY_COLOURS[category];
        return [
          categoryStyle(category),
          {
            colourPrimary: colours.primary,
            colourSecondary: colours.secondary,
            colourTertiary: colours.tertiary,
            hat: category === 'triggers' ? 'cap' : '',
          },
        ];
      }),
    ),
    categoryStyles: Object.fromEntries(BLOCK_CATEGORIES.map((category) => [categoryStyle(category), { colour: CATEGORY_COLOURS[category].primary }])),
    componentStyles: {
      workspaceBackgroundColour: '#fff8ea',
      toolboxBackgroundColour: '#f6e7c8',
      toolboxForegroundColour: '#5a3d2b',
      flyoutBackgroundColour: '#fdf1d8',
      flyoutForegroundColour: '#5a3d2b',
      flyoutOpacity: 0.97,
      scrollbarColour: '#c9925f',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#5a3d2b',
      insertionMarkerOpacity: 0.3,
      markerColour: '#e46a6a',
      cursorColour: '#5ea8d6',
      selectedGlowColour: '#5ea8d6',
      selectedGlowOpacity: 0.6,
    },
    fontStyle: { family: FONT_FAMILY, weight: '600', size: 12 },
  });
}
