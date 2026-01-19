/**
 * Headless Puzzle Test Runner
 *
 * Runs puzzle simulations from collections/data/simulations/.
 * Each simulation runs in a fresh game state to prevent state bleeding.
 *
 * Simulations are JSON files with testType: "puzzle" containing:
 *   - setup: Initial conditions (guardNearPlayer, movePlayerToExit, createIllusion, etc.)
 *   - expectedOutcome: What should happen (playerDied, levelComplete, guardGaveUp, etc.)
 *   - maxTicks: Maximum simulation ticks before timeout
 *
 * Usage:
 *   node headless.js                                  # Run all puzzle simulations
 *   node headless.js --simulation guard_chase_player  # Run a specific simulation
 *   node headless.js --help                           # Show help
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync } from 'fs';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import HeadlessEngine from '../../engine/HeadlessEngine.js';

function loadCompiledGame() {
    console.log('[Headless] Loading compiled game...');

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

function loadSimulation(id) {
    const simPath = path.join(__dirname, 'collections/data/simulations', `${id}.json`);
    if (!existsSync(simPath)) return null;
    return JSON.parse(readFileSync(simPath, 'utf8'));
}

function getPuzzleSimulationIds() {
    const simPath = path.join(__dirname, 'collections/data/simulations');
    if (!existsSync(simPath)) return [];
    return readdirSync(simPath)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
        .filter(id => loadSimulation(id)?.testType === 'puzzle');
}

async function resetForNewSimulation(game) {
    if (game.clearEventLog) game.clearEventLog();
    game.state = { now: 0 };
    if (game.resetCurrentTime) game.resetCurrentTime();
    if (game.sceneManager?.currentScene) {
        await game.sceneManager.unloadCurrentScene();
    }
    if (game._proxyCache) {
        for (const [, cache] of game._proxyCache) cache.clear();
    }
    game._lastSyncedState = null;
}

async function setupLevel(game, simConfig) {
    game.state.level = 0;
    game.state.puzzleMode = true;

    if (simConfig.level) {
        const enums = game.getEnums();
        const levelEnum = enums.levels?.[simConfig.level];
        if (levelEnum !== undefined) game.state.level = levelEnum;
    }

    await game.sceneManager.loadScene('game');
    await game.update(1/60);
}

function findGuard(game) {
    const guardBT = game.getEnums().behaviorTrees?.GuardBehaviorTree;
    for (const id of game.getEntitiesWith('aiState')) {
        if (game.getComponent(id, 'aiState')?.rootBehaviorTree === guardBT) return id;
    }
    return null;
}

function findPlayer(game) {
    const players = game.getEntitiesWith('playerController', 'transform');
    return players.length > 0 ? players[0] : null;
}

async function runSimulation(game, simConfig) {
    await setupLevel(game, simConfig);

    const setup = simConfig.setup || {};
    const expected = simConfig.expectedOutcome || {};
    const maxTicks = simConfig.maxTicks || 600;

    const guardId = findGuard(game);
    const playerId = findPlayer(game);
    const enums = game.getEnums();

    // Apply setup: remove all desirable objects (for pure chase tests)
    if (setup.removeDesirables) {
        const worldObjectEntities = game.getEntitiesWith('unitType', 'transform');
        const presentTypeIndex = enums.worldObjects?.present;
        let removed = 0;
        for (const entityId of [...worldObjectEntities]) {
            const unitType = game.getComponent(entityId, 'unitType');
            if (unitType?.type === presentTypeIndex) {
                game.destroyEntity(entityId);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[Headless] Removed ${removed} desirable objects`);
        }
    }

    // Apply setup: position player near guard (in direct line of sight)
    if (setup.guardNearPlayer && guardId && playerId) {
        const guardPos = game.getComponent(guardId, 'transform')?.position;
        const playerTransform = game.getComponent(playerId, 'transform');
        // Position player in same z-plane but offset on x, within corridor bounds
        // Keep player within reasonable walkable area (not in walls)
        playerTransform.position.x = guardPos.x;
        playerTransform.position.z = guardPos.z + 150; // 150 units south of guard
        console.log(`[Headless] Player positioned near guard at (${playerTransform.position.x}, ${playerTransform.position.z})`);
    }

    // Apply setup: move player to exit
    if (setup.movePlayerToExit && playerId) {
        const exitZones = game.getEntitiesWith('exitZone', 'transform');
        if (exitZones.length > 0) {
            const exitPos = game.getComponent(exitZones[0], 'transform').position;
            const playerTransform = game.getComponent(playerId, 'transform');
            playerTransform.position.x = exitPos.x;
            playerTransform.position.z = exitPos.z;
            console.log(`[Headless] Player moved to exit zone`);
        }
    }

    // Apply setup: create illusion
    let illusionId = null;
    if (setup.createIllusion) {
        const collectionIndex = enums.objectTypeDefinitions?.worldObjects;
        const presentIndex = enums.worldObjects?.present;
        const neutralTeam = enums.team?.neutral ?? 0;
        const pos = setup.createIllusion.position;

        illusionId = game.call('createUnit', collectionIndex, presentIndex, {
            position: { x: pos.x, y: 75, z: pos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }, neutralTeam);

        game.addComponent(illusionId, 'illusion', {
            sourcePrefab: 'present',
            creatorEntity: null,
            createdTime: game.state.now || 0,
            duration: 30.0,
            slotIndex: 0
        });
        console.log(`[Headless] Created illusion at (${pos.x}, ${pos.z})`);
    }

    // Apply setup: position guard near a real present (for testing real object pickup)
    let realPresentId = null;
    if (setup.guardNearRealPresent && guardId) {
        // Find the first real present in the level (not an illusion)
        const worldObjectEntities = game.getEntitiesWith('unitType', 'transform');
        const presentTypeIndex = enums.worldObjects?.present;

        for (const entityId of worldObjectEntities) {
            // Skip illusions
            if (game.hasComponent(entityId, 'illusion')) continue;

            const unitType = game.getComponent(entityId, 'unitType');
            if (unitType?.type === presentTypeIndex) {
                realPresentId = entityId;
                break;
            }
        }

        if (realPresentId) {
            const presentPos = game.getComponent(realPresentId, 'transform')?.position;
            const guardTransform = game.getComponent(guardId, 'transform');
            // Position guard 100 units from the present (within vision range)
            guardTransform.position.x = presentPos.x + 100;
            guardTransform.position.z = presentPos.z + 100;
            console.log(`[Headless] Guard positioned near real present at (${presentPos.x}, ${presentPos.z})`);
        }
    }

    // Track outcomes
    const outcomes = {};
    let escapeTriggered = false;
    let pickupTick = null;

    // Run simulation
    for (let tick = 0; tick < maxTicks; tick++) {
        await game.update(1/60);

        // Check: player died
        if (expected.playerDied !== undefined && playerId) {
            const hp = game.getComponent(playerId, 'health');
            if (!hp || hp.current <= 0) {
                outcomes.playerDied = true;
                console.log(`[Headless] Player died at tick ${tick}`);
                break;
            }
        }

        // Check: level complete
        if (expected.levelComplete !== undefined) {
            if (game.hasService('isLevelComplete') && game.call('isLevelComplete')) {
                outcomes.levelComplete = true;
                console.log(`[Headless] Level complete at tick ${tick}`);
                break;
            }
        }

        // Check: guard gave up chase
        if (expected.guardGaveUp !== undefined && guardId) {
            const behaviorState = game.behaviorSystem?.getOrCreateBehaviorState(guardId);
            const shared = behaviorState?.shared || {};

            // Trigger escape after configured ticks
            if (!escapeTriggered && tick >= (setup.escapePlayerAfterTicks || 30)) {
                const escapePos = setup.escapePosition || { x: 600, z: 600 };
                const playerTransform = game.getComponent(playerId, 'transform');
                playerTransform.position.x = escapePos.x;
                playerTransform.position.z = escapePos.z;
                escapeTriggered = true;
                console.log(`[Headless] Player escaped to (${escapePos.x}, ${escapePos.z})`);
            }

            if (escapeTriggered && !shared.playerTarget) {
                outcomes.guardGaveUp = true;
                console.log(`[Headless] Guard gave up at tick ${tick}`);
                break;
            }
        }

        // Check: illusion picked up
        if (expected.illusionPickedUp !== undefined && illusionId) {
            if (!game.hasEntity(illusionId) && !outcomes.illusionPickedUp) {
                outcomes.illusionPickedUp = true;
                pickupTick = tick;
                console.log(`[Headless] Illusion picked up at tick ${tick}`);
            }

            // Check if guard waited after pickup
            if (pickupTick !== null) {
                const ticksSincePickup = tick - pickupTick;
                if (ticksSincePickup > 180) {
                    outcomes.guardWaited = true;
                    break;
                }
            }
        }

        // Check: real present picked up
        if (expected.realPresentPickedUp !== undefined && realPresentId) {
            if (!game.hasEntity(realPresentId) && !outcomes.realPresentPickedUp) {
                outcomes.realPresentPickedUp = true;
                pickupTick = tick;
                console.log(`[Headless] Real present picked up at tick ${tick}`);
            }

            // Check if guard waited after pickup (same logic as illusion)
            if (pickupTick !== null && expected.guardWaited !== undefined) {
                const ticksSincePickup = tick - pickupTick;
                if (ticksSincePickup > 180) {
                    outcomes.guardWaited = true;
                    break;
                }
            }
        }

        // Progress logging
        if (tick % 60 === 0 && tick > 0) {
            console.log(`[Headless] Tick ${tick}...`);
        }
    }

    // Set default false for unmet outcomes
    for (const key of Object.keys(expected)) {
        if (outcomes[key] === undefined) outcomes[key] = false;
    }

    // Check pass/fail
    let passed = true;
    for (const [key, expectedValue] of Object.entries(expected)) {
        if (outcomes[key] !== expectedValue) {
            passed = false;
            break;
        }
    }

    return { passed, outcomes, expected };
}

function parseArgs() {
    const args = process.argv.slice(2);
    const config = { simulation: null };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--simulation' || args[i] === '--sim') {
            config.simulation = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Headless Puzzle Test Runner

Usage: node headless.js [options]

Options:
  --simulation, --sim <id>  Run a specific simulation
  --help, -h                Show this help message
`);
            process.exit(0);
        }
    }
    return config;
}

async function main() {
    const config = parseArgs();

    loadCompiledGame();

    const engine = new HeadlessEngine();
    await engine.init('UseYourIllusions');

    if (global.COMPILED_GAME && !global.COMPILED_GAME.initialized) {
        global.COMPILED_GAME.init(engine);
    }

    const game = engine.gameInstance;
    console.log('[Headless] Engine initialized\n');

    const simulationIds = config.simulation
        ? [config.simulation]
        : getPuzzleSimulationIds();

    if (simulationIds.length === 0) {
        console.log('[Headless] No puzzle simulations found');
        process.exit(1);
    }

    const results = [];

    for (let i = 0; i < simulationIds.length; i++) {
        const simId = simulationIds[i];

        if (i > 0) await resetForNewSimulation(game);

        const simConfig = loadSimulation(simId);
        if (!simConfig) {
            console.log(`[Headless] Simulation not found: ${simId}`);
            results.push({ name: simId, passed: false, error: 'Not found' });
            continue;
        }

        console.log(`[Headless] ══════════════════════════════════════════`);
        console.log(`[Headless] ${simConfig.name}`);
        console.log(`[Headless] ──────────────────────────────────────────`);

        try {
            const result = await runSimulation(game, simConfig);
            results.push({ name: simConfig.name, ...result });
            console.log(`[Headless] ${result.passed ? '✓ PASSED' : '✗ FAILED'}\n`);
        } catch (error) {
            console.error(`[Headless] Error: ${error.message}\n`);
            results.push({ name: simConfig.name, passed: false, error: error.message });
        }
    }

    // Summary
    console.log(`[Headless] ══════════════════════════════════════════`);
    console.log(`[Headless] SUMMARY`);
    console.log(`[Headless] ──────────────────────────────────────────`);

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    for (const r of results) {
        console.log(`[Headless] ${r.passed ? '✓' : '✗'} ${r.name}`);
    }

    console.log(`[Headless] ──────────────────────────────────────────`);
    console.log(`[Headless] ${passed}/${results.length} passed`);
    console.log(`[Headless] ══════════════════════════════════════════`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('[Headless] Fatal error:', err);
    process.exit(1);
});
