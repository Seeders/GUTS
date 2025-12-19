/**
 * Vitest Test Setup for Editor
 * Loads the built editor bundle which provides all GUTS editor classes
 */

// Set up CommonJS-like environment for webpack bundle
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

// Fix webpack publicPath issue in jsdom
globalThis.__webpack_public_path__ = '/dist/';

// Mock DOM APIs not supported in jsdom but required by Monaco and other editor deps
// These must be set BEFORE importing the bundle
if (typeof document !== 'undefined') {
    // Create a script element with src to satisfy webpack's publicPath detection
    const script = document.createElement('script');
    script.src = 'http://localhost/test.js';
    document.head.appendChild(script);

    // Mock currentScript (readonly in jsdom)
    try {
        Object.defineProperty(document, 'currentScript', {
            value: script,
            writable: true,
            configurable: true
        });
    } catch (e) {
        // Already defined, ignore
    }
}

// Mock queryCommandSupported (used by Monaco editor clipboard)
// Must be on document prototype to work during bundle initialization
Object.defineProperty(Document.prototype, 'queryCommandSupported', {
    value: () => false,
    writable: true,
    configurable: true
});

// Mock execCommand (used by Monaco editor clipboard)
Object.defineProperty(Document.prototype, 'execCommand', {
    value: () => false,
    writable: true,
    configurable: true
});

// Dynamic import to ensure mocks are set up first
await import('../dist/editor.js');

// Re-export commonly used classes for convenience in tests
export const GUTS = globalThis.GUTS || window.GUTS;
