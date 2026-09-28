/**
 * The Redux-style store (src/core/store.ts): listener contract, change detection by
 * reference, re-entrancy rules (reducers may not dispatch; listener dispatches are queued
 * and processed in order), middleware composition, deep freezing and action recording.
 */
import { describe, expect, it } from 'vitest';
import { createActionRecorder, createStore, deepFreeze, type Middleware, type Store } from '../src/core/store';

interface CounterState {
  readonly count: number;
  readonly nested: { readonly list: readonly number[] };
}

type CounterAction =
  | { readonly type: 'inc' }
  | { readonly type: 'noop' }
  | { readonly type: 'set'; readonly value: number }
  | { readonly type: 'boom' };

const INITIAL: CounterState = { count: 0, nested: { list: [] } };

function counter(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case 'inc':
      return { count: state.count + 1, nested: { list: [...state.nested.list, state.count + 1] } };
    case 'set':
      return state.count === action.value ? state : { ...state, count: action.value };
    case 'noop':
      return state;
    case 'boom':
      throw new Error('reducer exploded');
  }
}

const inc: CounterAction = { type: 'inc' };

describe('createStore', () => {
  it('exposes the initial state', () => {
    const store = createStore(counter, INITIAL);
    expect(store.getState()).toBe(INITIAL);
  });

  it('notifies listeners with (next, prev, action) after each state change', () => {
    const store = createStore(counter, INITIAL);
    const calls: [CounterState, CounterState, CounterAction][] = [];
    store.subscribe((next, prev, action) => calls.push([next, prev, action]));

    const returned = store.dispatch(inc);
    expect(returned).toBe(inc);
    const afterFirst = store.getState();
    store.dispatch({ type: 'set', value: 10 });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([afterFirst, INITIAL, inc]);
    expect(calls[0]?.[1]).toBe(INITIAL);
    expect(calls[0]?.[0]).toBe(afterFirst);
    expect(calls[1]?.[1]).toBe(afterFirst);
    expect(calls[1]?.[0]).toBe(store.getState());
    expect(store.getState().count).toBe(10);
  });

  it('does not notify when the reducer returns the same state', () => {
    const store = createStore(counter, INITIAL);
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: 'noop' });
    store.dispatch({ type: 'set', value: 0 });
    expect(calls).toBe(0);
    expect(store.getState()).toBe(INITIAL);
  });

  it('notifies every subscribed listener in subscription order', () => {
    const store = createStore(counter, INITIAL);
    const order: string[] = [];
    store.subscribe(() => order.push('a'));
    store.subscribe(() => order.push('b'));
    store.subscribe(() => order.push('c'));
    store.dispatch(inc);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('throws when a reducer dispatches, leaves the state untouched and stays usable', () => {
    let store: Store<CounterState, CounterAction> | null = null;
    const reentrant = (state: CounterState, action: CounterAction): CounterState => {
      if (action.type === 'set' && action.value === 99) store?.dispatch(inc);
      return counter(state, action);
    };
    store = createStore(reentrant, INITIAL);
    let calls = 0;
    store.subscribe(() => calls++);

    expect(() => store?.dispatch({ type: 'set', value: 99 })).toThrow(/Reducers may not dispatch/);
    expect(store.getState()).toBe(INITIAL);
    expect(calls).toBe(0);

    store.dispatch(inc);
    expect(store.getState().count).toBe(1);
    expect(calls).toBe(1);
  });

  it('propagates reducer errors without changing state and recovers afterwards', () => {
    const store = createStore(counter, INITIAL);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(() => store.dispatch({ type: 'boom' })).toThrow('reducer exploded');
    expect(store.getState()).toBe(INITIAL);
    expect(calls).toBe(0);
    store.dispatch(inc);
    expect(store.getState().count).toBe(1);
  });

  it('queues dispatches made by listeners and applies them in order after the round', () => {
    const store = createStore(counter, INITIAL);
    const seen: string[] = [];
    store.subscribe((next, _prev, action) => {
      seen.push(`A:${action.type}:${next.count}`);
      if (action.type === 'inc' && next.count === 1) {
        store.dispatch({ type: 'set', value: 5 });
        store.dispatch({ type: 'set', value: 7 });
        // Still queued: the state has not moved past the current transition.
        expect(store.getState().count).toBe(1);
      }
      if (action.type === 'set' && next.count === 5) store.dispatch(inc);
    });
    store.subscribe((next, prev, action) => {
      seen.push(`B:${action.type}:${prev.count}->${next.count}`);
    });

    store.dispatch(inc);
    expect(seen).toEqual([
      'A:inc:1',
      'B:inc:0->1',
      'A:set:5',
      'B:set:1->5',
      'A:set:7',
      'B:set:5->7',
      'A:inc:8',
      'B:inc:7->8',
    ]);
    expect(store.getState().count).toBe(8);
  });

  it('stops notifying after unsubscribe (and unsubscribing twice is harmless)', () => {
    const store = createStore(counter, INITIAL);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.dispatch(inc);
    unsubscribe();
    unsubscribe();
    store.dispatch(inc);
    expect(calls).toBe(1);
  });

  it('snapshots listeners per round: a listener added during a round sees only later actions', () => {
    const store = createStore(counter, INITIAL);
    const late: number[] = [];
    let added = false;
    store.subscribe(() => {
      if (added) return;
      added = true;
      store.subscribe((next) => late.push(next.count));
    });
    store.dispatch(inc);
    expect(late).toEqual([]);
    store.dispatch(inc);
    expect(late).toEqual([2]);
  });

  it('keeps working after a listener throws', () => {
    const store = createStore(counter, INITIAL);
    let explode = true;
    store.subscribe(() => {
      if (explode) throw new Error('listener exploded');
    });
    expect(() => store.dispatch(inc)).toThrow('listener exploded');
    // The transition itself happened; the store is not stuck in "notifying" mode.
    expect(store.getState().count).toBe(1);
    explode = false;
    store.dispatch(inc);
    expect(store.getState().count).toBe(2);
  });

  // The contract says listener dispatches are applied in order. When a listener throws, the
  // round is aborted before the queue is drained, so an action queued during that round is
  // applied only after the NEXT top-level dispatch — i.e. a stale action overwrites a newer one.
  it('never applies a stale queued action after a newer dispatch when a listener threw', () => {
    const store = createStore(counter, INITIAL);
    store.subscribe((next, _prev, action) => {
      if (action.type === 'inc' && next.count === 1) store.dispatch({ type: 'set', value: 50 });
    });
    store.subscribe((next) => {
      if (next.count === 1) throw new Error('listener exploded');
    });
    expect(() => store.dispatch(inc)).toThrow('listener exploded');
    store.dispatch({ type: 'set', value: 7 });
    expect(store.getState().count).toBe(7);
  });
});

describe('middleware', () => {
  it('wraps dispatch with the first middleware outermost', () => {
    const log: string[] = [];
    const tag =
      (name: string): Middleware<CounterState, CounterAction> =>
      () =>
      (next) =>
      (action) => {
        log.push(`${name}>`);
        const result = next(action);
        log.push(`<${name}`);
        return result;
      };
    const reducer = (state: CounterState, action: CounterAction): CounterState => {
      log.push('reduce');
      return counter(state, action);
    };
    const store = createStore(reducer, INITIAL, { middleware: [tag('m1'), tag('m2'), tag('m3')] });
    store.dispatch(inc);
    expect(log).toEqual(['m1>', 'm2>', 'm3>', 'reduce', '<m3', '<m2', '<m1']);
  });

  it('can swallow or transform actions and sees the live state through its api', () => {
    const observed: number[] = [];
    const guard: Middleware<CounterState, CounterAction> = (api) => (next) => (action) => {
      observed.push(api.getState().count);
      if (action.type === 'boom') return action;
      if (action.type === 'set') return next({ type: 'set', value: action.value * 2 });
      return next(action);
    };
    const store = createStore(counter, INITIAL, { middleware: [guard] });
    store.dispatch({ type: 'boom' });
    store.dispatch({ type: 'set', value: 4 });
    store.dispatch(inc);
    expect(store.getState().count).toBe(9);
    expect(observed).toEqual([0, 0, 8]);
  });

  it('routes api.dispatch through the whole chain', () => {
    const seen: string[] = [];
    const recorder: Middleware<CounterState, CounterAction> = () => (next) => (action) => {
      seen.push(action.type);
      return next(action);
    };
    const thunkish: Middleware<CounterState, CounterAction> = (api) => (next) => (action) => {
      if (action.type === 'set' && action.value < 0) {
        api.dispatch(inc);
        api.dispatch(inc);
        return action;
      }
      return next(action);
    };
    const store = createStore(counter, INITIAL, { middleware: [recorder, thunkish] });
    store.dispatch({ type: 'set', value: -1 });
    expect(store.getState().count).toBe(2);
    expect(seen).toEqual(['set', 'inc', 'inc']);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays so mutation throws in strict mode', () => {
    const value = { a: { b: [1, { c: 2 }] }, d: 'x' };
    const frozen = deepFreeze(value);
    expect(frozen).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(() => {
      (value as { d: string }).d = 'y';
    }).toThrow(TypeError);
    expect(() => {
      (value.a.b as unknown[]).push(3);
    }).toThrow(TypeError);
    expect(() => {
      (value.a.b[1] as { c: number }).c = 3;
    }).toThrow(TypeError);
  });

  it('returns primitives and null unchanged', () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze('s')).toBe('s');
    expect(deepFreeze(undefined)).toBeUndefined();
  });

  it('skips already-frozen subtrees (so structural sharing keeps freezing cheap)', () => {
    const inner = { mutable: { n: 1 } };
    Object.freeze(inner);
    const outer = { inner, fresh: { n: 2 } };
    deepFreeze(outer);
    expect(Object.isFrozen(outer.fresh)).toBe(true);
    // The pre-frozen node was treated as a finished subtree.
    expect(Object.isFrozen(inner.mutable)).toBe(false);
  });

  it('is applied to the initial and every new state when the store freezes', () => {
    const store = createStore(counter, { count: 0, nested: { list: [] } }, { freeze: true });
    expect(Object.isFrozen(store.getState())).toBe(true);
    expect(Object.isFrozen(store.getState().nested.list)).toBe(true);
    store.dispatch(inc);
    const state = store.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.nested)).toBe(true);
    expect(() => {
      (state as { count: number }).count = 42;
    }).toThrow(TypeError);
  });

  it('does not freeze when the option is off', () => {
    const initial = { count: 0, nested: { list: [] } };
    const store = createStore(counter, initial);
    store.dispatch(inc);
    expect(Object.isFrozen(initial)).toBe(false);
    expect(Object.isFrozen(store.getState())).toBe(false);
  });
});

describe('createActionRecorder', () => {
  it('records every dispatched action in order, including no-ops and listener dispatches', () => {
    const recorder = createActionRecorder<CounterState, CounterAction>();
    const store = createStore(counter, INITIAL, { middleware: [recorder.middleware] });
    store.subscribe((next, _prev, action) => {
      if (action.type === 'inc' && next.count === 1) store.dispatch({ type: 'set', value: 3 });
    });
    store.dispatch(inc);
    store.dispatch({ type: 'noop' });
    expect(recorder.actions).toEqual([inc, { type: 'set', value: 3 }, { type: 'noop' }]);
    expect(store.getState().count).toBe(3);
  });

  it('replays to the same state and can be cleared', () => {
    const recorder = createActionRecorder<CounterState, CounterAction>();
    const store = createStore(counter, INITIAL, { middleware: [recorder.middleware] });
    store.dispatch(inc);
    store.dispatch({ type: 'set', value: 20 });
    store.dispatch(inc);
    const replayed = recorder.actions.reduce(counter, INITIAL);
    expect(replayed).toEqual(store.getState());

    recorder.clear();
    expect(recorder.actions).toEqual([]);
    store.dispatch(inc);
    expect(recorder.actions).toEqual([inc]);
  });
});
