export type Subscriber<T> = (state: T) => void;

export interface Store<T> {
  get(): T;
  set(updater: ((prev: T) => T) | T): void;
  subscribe(fn: Subscriber<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<Subscriber<T>>();
  return {
    get: () => state,
    set: (updater) => {
      state = typeof updater === 'function' ? (updater as (p: T) => T)(state) : (updater as T);
      subs.forEach((fn) => fn(state));
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

