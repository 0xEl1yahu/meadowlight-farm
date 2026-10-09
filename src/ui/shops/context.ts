/** What every shop panel gets from ShopsScreen. */
import type { GameAction } from '../../state/actions';
import type { ItemIconCache } from '../slots';

export interface ShopPanelContext {
  readonly dispatch: (action: GameAction) => void;
  /** Aborted when the shops are disposed; every listener a panel adds is registered with it. */
  readonly signal: AbortSignal;
  readonly icons: ItemIconCache;
  /** Unique prefix for element ids (aria-labelledby). */
  readonly idPrefix: string;
}
