/**
 * Vitest Test Setup
 * Loads the project's built client bundle, which provides all GUTS classes and
 * collections. Each vitest project sets GUTS_TEST_PROJECT (vitest.config.js).
 */
import fs from 'fs';
import path from 'path';

// Set up CommonJS-like environment for webpack bundle
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

const project = process.env.GUTS_TEST_PROJECT;
if (!project) {
    throw new Error('[tests/setup] GUTS_TEST_PROJECT is not set — run tests through vitest.config.js projects');
}
const bundle = path.resolve(process.cwd(), 'projects', project, 'dist/client/game.js');
if (!fs.existsSync(bundle)) {
    throw new Error(`[tests/setup] ${project} has no client bundle at ${bundle} — build it first (npm run build ${project})`);
}

// The client bundle sets up window.GUTS with all classes
// It also initializes window.COMPILED_GAME with collections
await import(/* @vite-ignore */ `../projects/${project}/dist/client/game.js`);

// Scene systems may start UI timers (e.g. a delayed DOM lookup). Clear any a
// test leaves pending so they can't fire after jsdom is torn down.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const pendingTimers = new Set();
globalThis.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(() => { pendingTimers.delete(id); fn(...args); }, ms);
    pendingTimers.add(id);
    return id;
};
globalThis.clearTimeout = (id) => { pendingTimers.delete(id); realClearTimeout(id); };
afterEach(() => {
    for (const id of pendingTimers) realClearTimeout(id);
    pendingTimers.clear();
});

// Re-export commonly used classes for convenience in tests
export const GUTS = globalThis.GUTS || window.GUTS;
export const COMPILED_GAME = globalThis.window?.COMPILED_GAME || window.COMPILED_GAME;
