import { useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

// A minimal external store: components subscribe to a selected slice and re-render only when that
// slice changes, so dragging a card no longer re-renders the composer, thread or title bar.
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  const get = () => state;
  const set = (patch: Partial<T> | ((current: T) => Partial<T>)) => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    let changed = false;
    for (const key in next) if (!Object.is(next[key], state[key])) { changed = true; break; }
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const subscribe = (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  function use<S>(selector: (current: T) => S, equal: (a: S, b: S) => boolean = Object.is): S {
    const cache = useRef<{ state: T; selector: (current: T) => S; value: S } | null>(null);
    const snapshot = () => {
      const current = state, previous = cache.current;
      if (previous && previous.state === current && previous.selector === selector) return previous.value;
      const value = selector(current);
      const stable = previous && equal(previous.value, value) ? previous.value : value;
      cache.current = { state: current, selector, value: stable };
      return stable;
    };
    return useSyncExternalStore(subscribe, snapshot, snapshot);
  }
  return { get, set, subscribe, use };
}
