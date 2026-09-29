import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { Direction, TileState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { gameReducer } from '../src/state/reducer';
import { selectTargetTile } from '../src/state/selectors';
import { getTile } from '../src/world/tiles';

describe('core loop', () => {
  it('runs the till → plant → water → sleep → harvest loop', () => {
    let s = createInitialState();
    s = gameReducer(s, actions.move(Direction.South));
    s = gameReducer(s, actions.move(Direction.South));
    const t = selectTargetTile(s);
    expect(t).toEqual({ tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 3 });
    if (t === null) return;
    s = gameReducer(s, actions.useTool());
    expect(getTile(s.maps.farm, t.tx, t.tz)?.state).toBe(TileState.Plowed);
    s = gameReducer(s, actions.selectSlot(5));
    s = gameReducer(s, actions.useTool());
    expect(getTile(s.maps.farm, t.tx, t.tz)?.crop?.cropId).toBe('parsnip');
    s = gameReducer(s, actions.selectSlot(1));
    s = gameReducer(s, actions.useTool());
    s = gameReducer(s, actions.sleep());
    for (let d = 0; d < 3; d++) {
      s = gameReducer(s, actions.move(Direction.South));
      s = gameReducer(s, actions.move(Direction.South));
      s = gameReducer(s, actions.useTool());
      s = gameReducer(s, actions.sleep());
    }
    s = gameReducer(s, actions.move(Direction.South));
    s = gameReducer(s, actions.interact());
  });
});
