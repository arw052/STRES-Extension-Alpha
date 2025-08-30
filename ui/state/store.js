"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStore = createStore;
function createStore(initial) {
    let state = initial;
    const subs = new Set();
    return {
        get: () => state,
        set: (updater) => {
            state = typeof updater === 'function' ? updater(state) : updater;
            subs.forEach((fn) => fn(state));
        },
        subscribe: (fn) => {
            subs.add(fn);
            return () => subs.delete(fn);
        },
    };
}
