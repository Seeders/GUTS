/**
 * Vitest Test Setup
 * Loads the built client game bundle which provides all GUTS classes and collections
 */

// Set up CommonJS-like environment for webpack bundle
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

// The client bundle sets up window.GUTS with all classes
// It also initializes window.COMPILED_GAME with collections
import '../projects/TurnBasedWarfare/dist/client/game.js';

// Re-export commonly used classes for convenience in tests
export const GUTS = globalThis.GUTS || window.GUTS;
export const COMPILED_GAME = globalThis.window?.COMPILED_GAME || window.COMPILED_GAME;
