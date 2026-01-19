/**
 * Puzzle Game Test Runner
 *
 * Tests the guard behavior detecting and chasing illusions
 *
 * Usage:
 *   node puzzle-test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import HeadlessEngine
import HeadlessEngine from '../../engine/HeadlessEngine.js';

/**
 * Load the compiled game bundle into the global context
 */
function loadCompiledGame() {
    console.log('[PuzzleTest] Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;

    // Mock document for browser-dependent code
    global.document = {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({
            style: {},
            appendChild: () => {},
            classList: { add: () => {}, remove: () => {} }
        }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        documentElement: { clientWidth: 1920, clientHeight: 1080 }
    };

    // Set up CommonJS-like environment for webpack bundle
    global.module = { exports: {} };
    global.exports = global.module.exports;

    // Try to load the headless-specific bundle first, then fall back to server bundle
    let gamePath = path.join(__dirname, 'dist/headless/game.js');
    if (!existsSync(gamePath)) {
        gamePath = path.join(__dirname, 'dist/server/game.js');
    }

    if (!existsSync(gamePath)) {
        throw new Error(`Game bundle not found. Run webpack build first.\nLooked for:\n  - dist/headless/game.js\n  - dist/server/game.js`);
    }

    const gameCode = readFileSync(gamePath, 'utf8');
    const gameScript = new vm.Script(gameCode);
    gameScript.runInThisContext();

    console.log('[PuzzleTest] Loaded compiled game');

    // Merge HeadlessEngine into global.GUTS
    Object.assign(global.GUTS, {
        HeadlessEngine,
        getCollections: () => global.COMPILED_GAME?.collections
    });

    console.log('[PuzzleTest] Game classes loaded');
}

/**
 * Main test function
 */
async function runPuzzleTest() {
    // Load compiled game
    loadCompiledGame();

    // Create and initialize engine
    const engine = new HeadlessEngine();
    await engine.init('UseYourIllusions');

    // Initialize the game
    if (global.COMPILED_GAME && !global.COMPILED_GAME.initialized) {
        global.COMPILED_GAME.init(engine);
    }

    const game = engine.gameInstance;

    console.log('[PuzzleTest] Engine initialized');

    // Set up puzzle level
    game.state.level = 0; // puzzle_tutorial
    game.state.puzzleMode = true;

    // Load the game scene
    await game.sceneManager.loadScene('game');

    console.log('[PuzzleTest] Scene loaded');

    // Wait a frame for systems to initialize
    await game.update(1/60);

    // Find the guard entity
    const enums = game.getEnums();
    const guardBehaviorTreeEnum = enums.behaviorTrees?.GuardBehaviorTree;

    const aiEntities = game.getEntitiesWith('aiState');
    let guardId = null;
    for (const entityId of aiEntities) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (aiState && aiState.rootBehaviorTree === guardBehaviorTreeEnum) {
            guardId = entityId;
            break;
        }
    }

    if (!guardId) {
        console.error('[PuzzleTest] No guard found!');
        process.exit(1);
    }

    console.log('[PuzzleTest] Found guard entity:', guardId);
    const guardTransform = game.getComponent(guardId, 'transform');
    console.log('[PuzzleTest] Guard position:', guardTransform?.position);

    // Find all presents (real ones)
    const reverseEnums = game.getReverseEnums();
    const worldObjectEntities = game.getEntitiesWith('unitType');
    const realPresents = [];
    for (const entityId of worldObjectEntities) {
        const unitType = game.getComponent(entityId, 'unitType');
        const typeName = reverseEnums.worldObjects?.[unitType?.type];
        if (typeName === 'present') {
            const pos = game.getComponent(entityId, 'transform')?.position;
            console.log(`[PuzzleTest] Found real present: entity ${entityId} at (${pos?.x}, ${pos?.z})`);
            realPresents.push(entityId);
        }
    }

    // First, let's run until the guard picks up the nearby real present
    console.log('[PuzzleTest] Running simulation to let guard pick up real presents...');

    for (let tick = 0; tick < 600; tick++) {
        await game.update(1/60);

        // Check if real presents still exist
        const remainingPresents = realPresents.filter(id => game.hasEntity(id));

        if (tick % 60 === 0) {
            const gPos = game.getComponent(guardId, 'transform')?.position;
            const behaviorState = game.behaviorSystem?.getOrCreateBehaviorState(guardId);
            const shared = behaviorState?.shared || {};
            console.log(`[PuzzleTest] Tick ${tick}: guard at (${gPos?.x?.toFixed(0)}, ${gPos?.z?.toFixed(0)}), desirableTarget: ${shared.desirableTarget}, remaining presents: ${remainingPresents.length}`);
        }

        // Once real presents are gone, stop
        if (remainingPresents.length === 0) {
            console.log(`[PuzzleTest] All real presents picked up at tick ${tick}`);
            break;
        }
    }

    // Now create an illusion
    console.log('\n[PuzzleTest] === Creating illusion present ===');

    const collectionIndex = enums.objectTypeDefinitions?.worldObjects;
    const presentIndex = enums.worldObjects?.present;

    console.log('[PuzzleTest] Illusion indices - collection:', collectionIndex, 'present:', presentIndex);

    // Create illusion at a position near the guard's patrol
    const illusionPosition = {
        position: { x: 200, y: 75, z: 200 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
    };

    const neutralTeam = enums.team?.neutral ?? 0;
    const illusionId = game.call('createUnit', collectionIndex, presentIndex, illusionPosition, neutralTeam);

    console.log('[PuzzleTest] Created illusion entity:', illusionId);

    // Add illusion component
    game.addComponent(illusionId, 'illusion', {
        sourcePrefab: 'present',
        creatorEntity: null,
        createdTime: game.state.now || 0,
        duration: 30.0,
        slotIndex: 0
    });

    // Check what components the illusion has
    const illusionUnitType = game.getComponent(illusionId, 'unitType');
    const illusionRenderable = game.getComponent(illusionId, 'renderable');
    const illusionTransform = game.getComponent(illusionId, 'transform');
    const illusionIllusion = game.getComponent(illusionId, 'illusion');

    console.log('[PuzzleTest] Illusion components:');
    console.log('  unitType:', illusionUnitType);
    console.log('  renderable:', illusionRenderable ? 'yes' : 'no');
    console.log('  transform:', illusionTransform?.position);
    console.log('  illusion:', illusionIllusion ? 'yes' : 'no');

    // Compare to a real present (if any still exist)
    // Create a new real present for comparison
    const realPresentId = game.call('createUnit', collectionIndex, presentIndex, {
        position: { x: 180, y: 75, z: 180 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
    }, neutralTeam);

    const realUnitType = game.getComponent(realPresentId, 'unitType');
    const realRenderable = game.getComponent(realPresentId, 'renderable');
    const realTransform = game.getComponent(realPresentId, 'transform');

    console.log('[PuzzleTest] Real present (for comparison) components:');
    console.log('  unitType:', realUnitType);
    console.log('  renderable:', realRenderable ? 'yes' : 'no');
    console.log('  transform:', realTransform?.position);

    // Now run and see if guard detects the illusion vs the real one
    console.log('\n[PuzzleTest] Running simulation with illusion + real present...');

    let illusionDetected = false;
    let realDetected = false;

    for (let tick = 0; tick < 600; tick++) {
        await game.update(1/60);

        if (tick % 30 === 0) {
            const gPos = game.getComponent(guardId, 'transform')?.position;
            const behaviorState = game.behaviorSystem?.getOrCreateBehaviorState(guardId);
            const shared = behaviorState?.shared || {};

            // Calculate distances
            const iPos = game.getComponent(illusionId, 'transform')?.position;
            const rPos = game.getComponent(realPresentId, 'transform')?.position;

            let distToIllusion = Infinity;
            let distToReal = Infinity;

            if (iPos && gPos) {
                distToIllusion = Math.sqrt((gPos.x - iPos.x)**2 + (gPos.z - iPos.z)**2);
            }
            if (rPos && gPos) {
                distToReal = Math.sqrt((gPos.x - rPos.x)**2 + (gPos.z - rPos.z)**2);
            }

            console.log(`[PuzzleTest] Tick ${tick}: guard at (${gPos?.x?.toFixed(0)}, ${gPos?.z?.toFixed(0)}), target: ${shared.desirableTarget}, distIllusion: ${distToIllusion.toFixed(0)}, distReal: ${distToReal.toFixed(0)}`);

            if (shared.desirableTarget === illusionId) {
                console.log('[PuzzleTest] Guard is targeting ILLUSION!');
                illusionDetected = true;
            }
            if (shared.desirableTarget === realPresentId) {
                console.log('[PuzzleTest] Guard is targeting REAL present');
                realDetected = true;
            }

            // Check if either was picked up
            if (!game.hasEntity(illusionId)) {
                console.log('[PuzzleTest] Illusion was picked up!');
                break;
            }
            if (!game.hasEntity(realPresentId)) {
                console.log('[PuzzleTest] Real present was picked up!');
                break;
            }
        }
    }

    console.log('\n[PuzzleTest] === RESULTS ===');
    console.log('Illusion detected:', illusionDetected);
    console.log('Real detected:', realDetected);
    console.log('Illusion still exists:', game.hasEntity(illusionId));
    console.log('Real still exists:', game.hasEntity(realPresentId));

    console.log('[PuzzleTest] Test complete');
    process.exit(0);
}

// Run the test
runPuzzleTest().catch(err => {
    console.error('[PuzzleTest] Error:', err);
    process.exit(1);
});
