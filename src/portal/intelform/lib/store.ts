import {useCallback, useSyncExternalStore} from 'react';

/**
 * A tiny external store with selector hooks (the part of zustand IntelForm used), so the
 * builder needs no state library. Vanilla: `createStore` works outside React (tests, the
 * autosave queue); `useStore(store, selector)` subscribes a component to one slice.
 *
 * Selectors must return stable values (a field, a list from state, a primitive), never a new
 * object or array per call, or React re-renders on every change (same rule as zustand 5).
 */
export type Listener<T> = (state: T, previous: T) => void;
export type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
export type GetState<T> = () => T;

export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: Listener<T>) => () => void;
}

export function createStore<T extends object>(init: (set: SetState<T>, get: GetState<T>) => T): StoreApi<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();
  const getState: GetState<T> = () => state;
  const setState: SetState<T> = partial => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    if (!patch) return;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const previous = state;
    state = {...state, ...patch};
    listeners.forEach(l => l(state, previous));
  };
  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  state = init(setState, getState);
  return {getState, setState, subscribe};
}

/** Subscribes to one slice of a store; re-renders only when that slice changes (`Object.is`). */
export function useStore<T, U>(store: StoreApi<T>, selector: (state: T) => U): U {
  const get = useCallback(() => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(store.subscribe, get, get);
}
