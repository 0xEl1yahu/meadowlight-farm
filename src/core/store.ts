/**
 * Minimal Redux-style store.
 *
 * - `reducer(state, action)` must be pure and deterministic.
 * - Listeners receive `(next, prev, action)` after every state-changing dispatch, which is
 *   what lets render systems diff by reference instead of re-scanning the world.
 * - Dispatching from inside a reducer is an error (it would make state transitions
 *   order-dependent). Dispatching from a listener is allowed and is queued until the
 *   current notification round finishes, so listeners always observe transitions in order.
 * - In development the state tree is deep-frozen so accidental mutation throws immediately.
 */

export interface Action {
  readonly type: string;
}

export type Reducer<S, A extends Action> = (state: S, action: A) => S;
export type Listener<S, A extends Action> = (state: S, prev: S, action: A) => void;
export type Unsubscribe = () => void;
export type Dispatch<A extends Action> = (action: A) => A;

export interface MiddlewareApi<S, A extends Action> {
  getState(): S;
  dispatch: Dispatch<A>;
}

export type Middleware<S, A extends Action> = (
  api: MiddlewareApi<S, A>,
) => (next: Dispatch<A>) => Dispatch<A>;

export interface Store<S, A extends Action> {
  getState(): S;
  dispatch: Dispatch<A>;
  subscribe(listener: Listener<S, A>): Unsubscribe;
}

export interface StoreOptions<S, A extends Action> {
  readonly middleware?: readonly Middleware<S, A>[];
  /** Deep-freeze every new state (recommended in development). */
  readonly freeze?: boolean;
}

export function createStore<S, A extends Action>(
  reducer: Reducer<S, A>,
  initialState: S,
  options: StoreOptions<S, A> = {},
): Store<S, A> {
  const freeze = options.freeze ?? false;
  let state = freeze ? deepFreeze(initialState) : initialState;
  const listeners = new Set<Listener<S, A>>();
  let reducing = false;
  let notifying = false;
  const queue: A[] = [];

  const getState = (): S => state;

  const baseDispatch: Dispatch<A> = (action) => {
    if (reducing) {
      throw new Error(`Reducers may not dispatch actions (dispatched "${action.type}").`);
    }
    if (notifying) {
      queue.push(action);
      return action;
    }
    try {
      apply(action);
      while (queue.length > 0) {
        const queued = queue.shift();
        if (queued !== undefined) apply(queued);
      }
    } catch (error) {
      // A throwing reducer or listener aborts the round. Drop anything queued during it so a
      // stale action can never be applied after a newer top-level dispatch.
      queue.length = 0;
      throw error;
    }
    return action;
  };

  function apply(action: A): void {
    const prev = state;
    reducing = true;
    let next: S;
    try {
      next = reducer(prev, action);
    } finally {
      reducing = false;
    }
    if (next === prev) return;
    state = freeze ? deepFreeze(next) : next;
    notifying = true;
    try {
      for (const listener of [...listeners]) listener(state, prev, action);
    } finally {
      notifying = false;
    }
  }

  let dispatch: Dispatch<A> = baseDispatch;
  const middleware = options.middleware ?? [];
  if (middleware.length > 0) {
    const api: MiddlewareApi<S, A> = { getState, dispatch: (action) => dispatch(action) };
    dispatch = middleware
      .map((factory) => factory(api))
      .reduceRight<Dispatch<A>>((next, wrap) => wrap(next), baseDispatch);
  }

  return {
    getState,
    dispatch: (action) => dispatch(action),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Recursively freezes plain objects and arrays. Already-frozen subtrees are skipped, so with
 * structural sharing only the newly created part of each state is traversed.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Records every action that reaches the reducer; used for deterministic replay tests. */
export function createActionRecorder<S, A extends Action>(): {
  readonly middleware: Middleware<S, A>;
  readonly actions: readonly A[];
  clear(): void;
} {
  const recorded: A[] = [];
  return {
    middleware: () => (next) => (action) => {
      recorded.push(action);
      return next(action);
    },
    actions: recorded,
    clear() {
      recorded.length = 0;
    },
  };
}
