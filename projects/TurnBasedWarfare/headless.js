/**
 * Headless Skirmish Mode Entry Point
 *
 * This script runs headless skirmish simulations without any rendering or network.
 * It can be used for:
 * - Automated testing
 * - AI training and evaluation
 * - Game balance analysis
 * - Replay processing
 *
 * Usage:
 *   node headless.js                          # Run with default config
 *   node headless.js --level level_2          # Specify level
 *   node headless.js --seed 12345             # Set random seed
 *   node headless.js --instructions file.json # Load instructions from file
 *   node headless.js --quick                  # Quick simulation with AI placements
 *
 * Programmatic usage:
 *   import { createHeadlessRunner } from './headless.js';
 *   const { runner, engine } = await createHeadlessRunner();
 *   await runner.setup({ level: 'level_1', seed: 12345 });
 *   const results = await runner.runWithInstructions([...]);
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
    console.log('[Headless] Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;

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

    console.log('[Headless] ✓ Loaded compiled game');

    // Merge HeadlessEngine into global.GUTS
    Object.assign(global.GUTS, {
        HeadlessEngine,
        getCollections: () => global.COMPILED_GAME?.collections
    });

    console.log('[Headless] ✓ Game classes loaded');
}

/**
 * Create a headless runner instance
 * @returns {Promise<{engine: HeadlessEngine, runner: HeadlessSkirmishRunner}>}
 */
export async function createHeadlessRunner() {
    // Load compiled game if not already loaded
    if (!global.GUTS) {
        loadCompiledGame();
    }

    // Create and initialize engine
    const engine = new HeadlessEngine();
    await engine.init('TurnBasedWarfare');

    // Initialize the game if needed
    if (global.COMPILED_GAME && !global.COMPILED_GAME.initialized) {
        global.COMPILED_GAME.init(engine);
    }

    // Create the runner
    const runner = new global.GUTS.HeadlessSkirmishRunner(engine);

    return { engine, runner };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        level: 'level_1',
        seed: Date.now(),
        startingGold: 100,
        quick: false,
        instructionsFile: null,
        verbose: false,
        maxTicks: 10000
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--level':
            case '-l':
                config.level = args[++i];
                break;
            case '--seed':
            case '-s':
                config.seed = parseInt(args[++i], 10);
                break;
            case '--gold':
            case '-g':
                config.startingGold = parseInt(args[++i], 10);
                break;
            case '--quick':
            case '-q':
                config.quick = true;
                break;
            case '--instructions':
            case '-i':
                config.instructionsFile = args[++i];
                break;
            case '--verbose':
            case '-v':
                config.verbose = true;
                break;
            case '--max-ticks':
            case '-m':
                config.maxTicks = parseInt(args[++i], 10);
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    return config;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Headless Skirmish Simulator

Usage: node headless.js [options]

Options:
  --level, -l <name>       Level to simulate (default: level_1)
  --seed, -s <number>      Random seed for deterministic simulation
  --gold, -g <number>      Starting gold for each team (default: 100)
  --quick, -q              Quick mode: AI places units for both teams
  --instructions, -i <file> Load instructions from JSON file
  --max-ticks, -m <number> Maximum ticks before timeout (default: 10000)
  --verbose, -v            Show detailed output
  --help, -h               Show this help message

Instruction File Format:
  [
    { "type": "PLACE_UNIT", "team": "left", "unitType": "soldier", "x": 5, "y": 5 },
    { "type": "PLACE_UNIT", "team": "right", "unitType": "archer", "x": 10, "y": 5 },
    { "type": "START_BATTLE" }
  ]

Instruction Types:
  PLACE_UNIT       - Place a unit on the grid
  START_BATTLE     - Start the battle phase
  SKIP_PLACEMENT   - Auto-place units for both teams using AI
  SUBMIT_PLACEMENT - Submit placement for a team
  WAIT             - Wait for a condition (tick, phase, time)
  END_SIMULATION   - End the simulation early
  CALL_SERVICE     - Call a game service directly

Examples:
  node headless.js --quick --seed 12345
  node headless.js --instructions battle_test.json
  node headless.js --level level_2 --gold 200 --verbose
`);
}

/**
 * Load scenario from a JSON file
 * Supports both full scenario objects and plain instruction arrays
 * @returns {{ instructions: Array, config: Object }}
 */
function loadScenario(filePath) {
    const fullPath = path.resolve(filePath);
    if (!existsSync(fullPath)) {
        throw new Error(`Scenario file not found: ${fullPath}`);
    }
    const content = readFileSync(fullPath, 'utf8');
    const data = JSON.parse(content);

    // If it's an array, treat as raw instructions
    if (Array.isArray(data)) {
        return { instructions: data, config: {} };
    }

    // If it's an object with instructions property, extract both
    if (data.instructions) {
        const { instructions, ...config } = data;
        return { instructions, config };
    }

    throw new Error('Invalid scenario file: must be an array of instructions or an object with an "instructions" property');
}

/**
 * Main execution
 */
async function main() {
    const config = parseArgs();

    try {
        // Create the headless runner
        const { engine, runner } = await createHeadlessRunner();

        // Set up the skirmish
        await runner.setup({
            level: config.level,
            startingGold: config.startingGold,
            seed: config.seed
        });

        console.log(`[Headless] Simulation configured:`);
        console.log(`  Level: ${config.level}`);
        console.log(`  Seed: ${config.seed}`);
        console.log(`  Starting Gold: ${config.startingGold}`);

        let results;

        if (config.quick) {
            // Quick mode: AI controls both teams
            console.log(`[Headless] Running quick simulation with AI placements...`);
            results = await runner.runQuickSimulation({
                maxTicks: config.maxTicks
            });
        } else if (config.instructionsFile) {
            // Load and execute instructions from file
            const scenario = loadScenario(config.instructionsFile);

            // Apply scenario config (file settings override CLI defaults)
            if (scenario.config.seed && config.seed === parseArgs().seed) {
                config.seed = scenario.config.seed;
            }
            if (scenario.config.level) {
                config.level = scenario.config.level;
            }
            if (scenario.config.startingGold) {
                config.startingGold = scenario.config.startingGold;
            }

            // Re-setup with scenario config
            await runner.setup({
                level: config.level,
                startingGold: config.startingGold,
                seed: config.seed
            });

            console.log(`[Headless] Scenario: ${scenario.config.name || config.instructionsFile}`);
            console.log(`[Headless] Running with ${scenario.instructions.length} instructions...`);
            results = await runner.runWithInstructions(scenario.instructions, {
                maxTicks: config.maxTicks,
                autoStartBattle: true
            });
        } else {
            // Default: Skip placement and start battle
            console.log(`[Headless] Running with default AI placements...`);
            results = await runner.runWithInstructions([
                { type: 'SKIP_PLACEMENT' }
            ], {
                maxTicks: config.maxTicks,
                autoStartBattle: true
            });
        }

        // Print results
        console.log(`\n[Headless] ========== SIMULATION RESULTS ==========`);
        console.log(`  Completed: ${results.completed}`);
        console.log(`  Winner: ${results.winner || 'none'}`);
        console.log(`  Ticks: ${results.tickCount}`);
        console.log(`  Game Time: ${results.gameTime?.toFixed(2)}s`);
        console.log(`  Real Time: ${results.realTimeMs}ms`);
        console.log(`  Ticks/Second: ${results.ticksPerSecond?.toFixed(2)}`);
        console.log(`  Final Round: ${results.round}`);
        console.log(`  Final Phase: ${results.phase}`);

        if (config.verbose) {
            console.log(`\n  Entity Counts:`);
            console.log(`    Total: ${results.entityCounts.total}`);
            for (const [team, count] of Object.entries(results.entityCounts.byTeam)) {
                console.log(`    ${team}: ${count}`);
            }

            // Show event log summary
            const eventLog = runner.getEventLog();
            if (eventLog.length > 0) {
                console.log(`\n  Event Log Summary (${eventLog.length} events):`);
                const eventTypes = {};
                for (const event of eventLog) {
                    eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
                }
                for (const [type, count] of Object.entries(eventTypes)) {
                    console.log(`    ${type}: ${count}`);
                }
            }
        }

        console.log(`[Headless] ==========================================\n`);

        // Exit with appropriate code
        process.exit(0);

    } catch (error) {
        console.error('[Headless] Error:', error);
        process.exit(1);
    }
}

// Run main if this is the entry point
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
    main();
}

// Export for programmatic use
export { HeadlessEngine, loadCompiledGame };
