/**
 * Service Call Overhead Performance Test
 *
 * Measures the real-world overhead of game.call() vs direct property access
 * in the context of the actual game engine.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import HeadlessEngine from '../../engine/HeadlessEngine.js';

function loadCompiledGame() {
    console.log('[PerfTest] Loading compiled game...');

    global.window = global;
    global.document = {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        documentElement: { clientWidth: 1920, clientHeight: 1080 }
    };
    global.module = { exports: {} };
    global.exports = global.module.exports;

    let gamePath = path.join(__dirname, 'dist/headless/game.js');
    if (!existsSync(gamePath)) {
        gamePath = path.join(__dirname, 'dist/server/game.js');
    }
    if (!existsSync(gamePath)) {
        throw new Error('Game bundle not found. Run webpack build first.');
    }

    const gameCode = readFileSync(gamePath, 'utf8');
    new vm.Script(gameCode).runInThisContext();

    Object.assign(global.GUTS, {
        HeadlessEngine,
        getCollections: () => global.COMPILED_GAME?.collections
    });
}

async function main() {
    loadCompiledGame();

    const engine = new HeadlessEngine();
    await engine.init('UseYourIllusions');

    if (global.COMPILED_GAME && !global.COMPILED_GAME.initialized) {
        global.COMPILED_GAME.init(engine);
    }

    const game = engine.gameInstance;
    console.log('[PerfTest] Engine initialized\n');

    // Load a scene to get services registered
    game.state.level = 0;
    await game.sceneManager.loadScene('game');
    await game.update(1/60);

    console.log('[PerfTest] Scene loaded, running performance tests...\n');

    const iterations = 1000000;

    // Warm up
    for (let i = 0; i < 10000; i++) {
        game.call('getZoomLevel');
        game.cameraControlSystem?.zoomLevel;
    }

    // Test 1: game.call() service pattern
    const start1 = performance.now();
    let sum1 = 0;
    for (let i = 0; i < iterations; i++) {
        const zoomLevel = game.call('getZoomLevel');
        if (zoomLevel !== undefined && zoomLevel < 0.1) {
            sum1++;
        }
    }
    const time1 = performance.now() - start1;

    // Test 2: Direct property access via cached system reference
    const cameraSystem = game.cameraControlSystem;
    const start2 = performance.now();
    let sum2 = 0;
    for (let i = 0; i < iterations; i++) {
        const zoomLevel = cameraSystem?.zoomLevel;
        if (zoomLevel !== undefined && zoomLevel < 0.1) {
            sum2++;
        }
    }
    const time2 = performance.now() - start2;

    // Test 3: Direct property access each time (no caching)
    const start3 = performance.now();
    let sum3 = 0;
    for (let i = 0; i < iterations; i++) {
        const zoomLevel = game.cameraControlSystem?.zoomLevel;
        if (zoomLevel !== undefined && zoomLevel < 0.1) {
            sum3++;
        }
    }
    const time3 = performance.now() - start3;

    // Calculate metrics
    const perCall1 = (time1 / iterations * 1000000).toFixed(2);
    const perCall2 = (time2 / iterations * 1000000).toFixed(2);
    const perCall3 = (time3 / iterations * 1000000).toFixed(2);
    const overhead = ((time1 - time2) / time2 * 100).toFixed(1);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('SERVICE CALL OVERHEAD TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Iterations: ${iterations.toLocaleString()}\n`);

    console.log(`game.call('getZoomLevel'):`);
    console.log(`  Total: ${time1.toFixed(2)}ms | Per call: ${perCall1}ns\n`);

    console.log(`cachedSystem.zoomLevel (cached ref):`);
    console.log(`  Total: ${time2.toFixed(2)}ms | Per call: ${perCall2}ns\n`);

    console.log(`game.cameraControlSystem?.zoomLevel (each time):`);
    console.log(`  Total: ${time3.toFixed(2)}ms | Per call: ${perCall3}ns\n`);

    console.log('───────────────────────────────────────────────────────────');
    console.log(`Service call overhead: ${overhead}% slower than cached access`);
    console.log('───────────────────────────────────────────────────────────');

    // Real-world impact calculation
    const entitiesPerFrame = 100;
    const fps = 60;
    const callsPerSecond = entitiesPerFrame * fps;

    console.log(`\nReal-world impact (${entitiesPerFrame} entities @ ${fps}fps = ${callsPerSecond} calls/sec):`);
    console.log(`  Service calls: ${(callsPerSecond * time1 / iterations).toFixed(4)}ms/sec`);
    console.log(`  Direct access: ${(callsPerSecond * time2 / iterations).toFixed(4)}ms/sec`);
    console.log(`  Difference:    ${(callsPerSecond * (time1 - time2) / iterations).toFixed(4)}ms/sec`);
    console.log('═══════════════════════════════════════════════════════════');

    process.exit(0);
}

main().catch(err => {
    console.error('[PerfTest] Fatal error:', err);
    process.exit(1);
});
