/**
 * DEALZ's panel (farmclaws part 4d spec §6.2): the pure view behind it, since the test environment
 * is node and the panel's DOM is checked in the browser playbook. It carries the name, the role
 * line, the panel's own line and two buttons; Buy dispatches `slop/buy` and Leave closes.
 */
import { describe, expect, it } from 'vitest';
import { SLOP } from '../src/config';
import type { GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { SLOP_NAME, SLOP_ROLE, slopShopView } from '../src/ui/shops/viewModel';
import { BASE, withGold } from './testUtils';

const LINE = 'BUY SOMETHING OR GET THE HELL OUT PUNK ✓';

/** BASE with DEALZ's panel open on `line`. */
const atDealz = (line = LINE): GameState => ({ ...BASE, ui: { ...BASE.ui, panel: { kind: 'slopShop', line } } });

describe('slopShopView', () => {
  it('is null unless the slop panel is open', () => {
    expect(slopShopView(BASE)).toBeNull();
    expect(slopShopView({ ...BASE, ui: { ...BASE.ui, panel: { kind: 'shop' } } })).toBeNull();
  });

  it("shows DEALZ's name, the role line, the panel's line and the two buttons", () => {
    const view = slopShopView(atDealz());
    expect(view?.name).toBe('DEALZ');
    expect(view?.role).toBe('SLOPMART 24/7 · A BARNABY VENTURE');
    expect(SLOP_NAME).toBe('DEALZ');
    expect(SLOP_ROLE).toBe('SLOPMART 24/7 · A BARNABY VENTURE');
    expect(view?.line).toBe(LINE);
    expect(view?.buttons.map((b) => b.label)).toEqual([`Buy a mystery box (${SLOP.boxPrice}g)`, 'Leave']);
    expect(view?.buttons[0]?.label).toBe('Buy a mystery box (40g)');
  });

  it("follows the panel's line when DEALZ answers", () => {
    expect(slopShopView(atDealz('NO GOLD NO BOX ✓'))?.line).toBe('NO GOLD NO BOX ✓');
  });

  it('Buy dispatches slop/buy and Leave closes the panel', () => {
    const [buy, leave] = slopShopView(atDealz())?.buttons ?? [];
    expect(buy?.action).toEqual({ type: 'slop/buy' });
    expect(leave?.action).toEqual(actions.closePanel());
    const bought = gameReducer(withGold(atDealz(), 100), buy!.action);
    expect(bought.player.gold).toBe(100 - SLOP.boxPrice);
    expect(gameReducer(atDealz(), leave!.action).ui.panel.kind).toBe('none');
  });
});
