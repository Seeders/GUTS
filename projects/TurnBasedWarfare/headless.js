/**
 * Headless Skirmish Mode Entry Point
 *
 * This script runs headless skirmish simulations without any rendering or network.
 * Two AI opponents face off using behavior trees and build orders.
 *
 * It can be used for:
 * - Automated testing
 * - AI training and evaluation
 * - Game balance analysis
 * - Build order optimization
 *
 * Usage:
 *   node headless.js                                    # Run with default config
 *   node headless.js --simulation apprentice_vs_barbarian  # Run a predefined simulation
 *   node headless.js --level level_2                    # Specify level
 *   node headless.js --seed 12345                       # Set random seed
 *   node headless.js --left-build basic                 # Left team build order
 *   node headless.js --right-build archery              # Right team build order
 *
 * Programmatic usage:
 *   import { createHeadlessRunner } from './headless.js';
 *   const { runner, engine } = await createHeadlessRunner();
 *   await runner.setup({ level: 'level_1', seed: 12345, leftBuildOrder: 'basic', rightBuildOrder: 'basic' });
 *   const results = await runner.run({ maxTicks: 10000 });
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync } from 'fs';
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
 * Load a simulation config from the simulations collection
 * @param {string} simulationId - The simulation ID (filename without .json)
 * @returns {Object|null} The simulation config or null if not found
 */
function loadSimulation(simulationId) {
    const simPath = path.join(__dirname, 'collections/data/simulations', `${simulationId}.json`);
    if (!existsSync(simPath)) {
        return null;
    }
    try {
        const content = readFileSync(simPath, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        console.error(`[Headless] Failed to load simulation ${simulationId}:`, e.message);
        return null;
    }
}

/**
 * Get all available simulation IDs from the simulations directory
 */
function getAllSimulationIds() {
    const simPath = path.join(__dirname, 'collections/data/simulations');
    if (!existsSync(simPath)) {
        return [];
    }
    return readdirSync(simPath)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        simulation: null,
        simulations: [],  // For batch mode
        batch: false,     // Run all simulations
        level: 'level_1',
        seed: Date.now(),
        startingGold: 100,
        leftBuildOrder: 'basic',
        rightBuildOrder: 'basic',
        verbose: false,
        maxTicks: 10000,
        json: false       // Output results as JSON
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--simulation':
            case '--sim':
                config.simulation = args[++i];
                break;
            case '--batch':
            case '-b':
                config.batch = true;
                break;
            case '--simulations':
                // Comma-separated list of simulations
                config.simulations = args[++i].split(',').map(s => s.trim());
                break;
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
            case '--left-build':
                config.leftBuildOrder = args[++i];
                break;
            case '--right-build':
                config.rightBuildOrder = args[++i];
                break;
            case '--verbose':
            case '-v':
                config.verbose = true;
                break;
            case '--max-ticks':
            case '-m':
                config.maxTicks = parseInt(args[++i], 10);
                break;
            case '--json':
                config.json = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    // Handle batch mode - run all or specified simulations
    if (config.batch) {
        if (config.simulations.length === 0) {
            config.simulations = getAllSimulationIds();
        }
        return config;
    }

    // If a single simulation is specified, load it and merge with CLI args
    if (config.simulation) {
        const simConfig = loadSimulation(config.simulation);
        if (!simConfig) {
            console.error(`[Headless] Simulation '${config.simulation}' not found`);
            console.error(`[Headless] Available simulations are in collections/data/simulations/`);
            process.exit(1);
        }

        // Apply simulation config (CLI args override simulation defaults)
        const cliSeed = args.includes('--seed') || args.includes('-s');
        const cliGold = args.includes('--gold') || args.includes('-g');
        const cliLevel = args.includes('--level') || args.includes('-l');

        if (!cliLevel && simConfig.level) config.level = simConfig.level;
        if (!cliSeed && simConfig.seed) config.seed = simConfig.seed;
        if (!cliGold && simConfig.startingGold) config.startingGold = simConfig.startingGold;

        // Use buildOrderA/buildOrderB - A goes on left, B goes on right
        config.leftBuildOrder = simConfig.buildOrderA;
        config.rightBuildOrder = simConfig.buildOrderB;
        config.simulationName = simConfig.name;
        config.simulationDescription = simConfig.description;
    }

    return config;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Headless Skirmish Simulator

Two AI opponents face off using behavior trees and build orders.

Usage: node headless.js [options]

Options:
  --simulation, --sim <id> Run a predefined simulation from collections/data/simulations/
  --batch, -b              Run all simulations in batch mode
  --simulations <ids>      Run specific simulations (comma-separated list)
  --level, -l <name>       Level to simulate (default: level_1)
  --seed, -s <number>      Random seed for deterministic simulation
  --gold, -g <number>      Starting gold for each team (default: 100)
  --left-build <id>        Build order for left team (default: basic)
  --right-build <id>       Build order for right team (default: basic)
  --max-ticks, -m <number> Maximum ticks before timeout (default: 10000)
  --verbose, -v            Show detailed output
  --json                   Output results as JSON (useful for batch mode)
  --help, -h               Show this help message

Simulations:
  Predefined simulations are in collections/data/simulations/.
  Each simulation defines a matchup with specific build orders.

  Available simulations:
    apprentice_vs_barbarian  - Magic caster vs melee fighter
    archer_vs_barbarian      - Ranged vs melee combat
    acolyte_vs_archer        - Support healer vs ranged DPS
    soldier_vs_scout         - Hybrid unit combat
    mixed_squad_battle       - Team compositions
    two_archers_vs_barbarian - Numerical advantage test

Build Orders:
  Build orders are defined in collections/data/buildOrders/.
  Each build order specifies what buildings to place, units to purchase,
  and move orders to issue for each round.

Examples:
  node headless.js --sim apprentice_vs_barbarian
  node headless.js --sim archer_vs_barbarian --seed 12345
  node headless.js --batch                           # Run all simulations
  node headless.js --batch --json                    # Run all, output as JSON
  node headless.js --simulations archer_vs_barbarian,soldier_vs_scout
  node headless.js --level level_2 --gold 200 --verbose
  node headless.js --left-build archer --right-build barbarian
`);
}

/**
 * Run a single simulation and return results
 * @param {Object} runner - HeadlessSkirmishRunner instance
 * @param {Object} simConfig - Simulation configuration
 * @param {Object} options - Run options (maxTicks, verbose)
 * @returns {Promise<Object>} Simulation results with metadata
 */
async function runSingleSimulation(runner, simConfig, options = {}) {
    const { maxTicks = 10000, verbose = false } = options;

    await runner.setup({
        level: simConfig.level,
        startingGold: simConfig.startingGold,
        seed: simConfig.seed,
        leftBuildOrder: simConfig.leftBuildOrder,
        rightBuildOrder: simConfig.rightBuildOrder
    });

    const runStart = Date.now();
    const results = await runner.run({ maxTicks });
    const runTime = Date.now() - runStart;

    return {
        simulationId: simConfig.simulationId,
        simulationName: simConfig.simulationName,
        leftBuildOrder: simConfig.leftBuildOrder,
        rightBuildOrder: simConfig.rightBuildOrder,
        completed: results.completed,
        winner: results.winner || 'none',
        tickCount: results.tickCount,
        gameTime: results.gameTime,
        realTimeMs: runTime,
        ticksPerSecond: runTime > 0 ? results.tickCount / (runTime / 1000) : 0,
        round: results.round,
        phase: results.phase,
        unitStatistics: results.unitStatistics,
        entityCounts: results.entityCounts
    };
}

/**
 * Print results for a single simulation
 */
function printSimulationResults(result, verbose = false) {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║                    SIMULATION RESULTS                      ║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);

    if (result.simulationName) {
        console.log(`║  Simulation: ${result.simulationName.padEnd(46)}║`);
    }
    console.log(`║  Matchup: ${result.leftBuildOrder} vs ${result.rightBuildOrder}`.padEnd(62) + `║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);

    // Determine winner display with team color
    const winnerDisplay = result.winner === 'left' ? `LEFT (${result.leftBuildOrder}) WINS!`
        : result.winner === 'right' ? `RIGHT (${result.rightBuildOrder}) WINS!`
        : result.winner === 'draw' ? 'DRAW - Both units died!'
        : 'NO WINNER (timeout)';

    console.log(`║  Result: ${winnerDisplay.padEnd(51)}║`);
    console.log(`║  Completed: ${(result.completed ? 'Yes' : 'No (timeout)').padEnd(48)}║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║  BATTLE STATISTICS                                         ║`);
    console.log(`╟────────────────────────────────────────────────────────────╢`);
    console.log(`║  Final Round: ${String(result.round).padEnd(46)}║`);
    console.log(`║  Final Phase: ${String(result.phase).padEnd(46)}║`);
    console.log(`║  Total Ticks: ${String(result.tickCount).padEnd(46)}║`);
    console.log(`║  Game Time: ${(result.gameTime?.toFixed(2) + 's').padEnd(48)}║`);
    console.log(`║  Real Time: ${(result.realTimeMs + 'ms').padEnd(48)}║`);
    console.log(`║  Performance: ${(result.ticksPerSecond.toFixed(0) + ' ticks/sec').padEnd(46)}║`);

    if (result.unitStatistics) {
        const { livingUnits, deadUnits, combatSummary } = result.unitStatistics;

        // Combat Activity Summary
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  COMBAT ACTIVITY                                           ║`);
        console.log(`╟────────────────────────────────────────────────────────────╢`);

        if (combatSummary) {
            console.log(`║  Total Attacks: ${String(combatSummary.totalAttacks).padEnd(44)}║`);
            console.log(`║    Left Team: ${String(combatSummary.attacksByTeam?.left || 0).padEnd(46)}║`);
            console.log(`║    Right Team: ${String(combatSummary.attacksByTeam?.right || 0).padEnd(45)}║`);

            if (combatSummary.attacksByUnit && combatSummary.attacksByUnit.length > 0) {
                console.log(`╟────────────────────────────────────────────────────────────╢`);
                console.log(`║  Attacks by Unit:                                          ║`);
                for (const unitStats of combatSummary.attacksByUnit) {
                    const line = `    [${unitStats.team.toUpperCase()}] ${unitStats.unitType}: ${unitStats.attacks} attacks`;
                    console.log(`║${line.padEnd(61)}║`);
                }
            }
        } else {
            console.log(`║  (No combat activity recorded)                             ║`);
        }

        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  SURVIVING UNITS                                           ║`);
        console.log(`╟────────────────────────────────────────────────────────────╢`);

        const skipTypes = ['townHall', 'barracks', 'fletchersHall', 'mageTower', 'goldMine', 'peasant', 'dragon_red'];
        const combatLivingUnits = livingUnits.filter(u => !skipTypes.includes(u.unitType));

        if (combatLivingUnits.length === 0) {
            console.log(`║  (No surviving combat units)                               ║`);
        } else {
            for (const unit of combatLivingUnits) {
                const hpPercent = unit.health.max > 0 ? Math.round((unit.health.current / unit.health.max) * 100) : 0;
                const hpBar = '█'.repeat(Math.floor(hpPercent / 10)) + '░'.repeat(10 - Math.floor(hpPercent / 10));
                const line = `  [${unit.team.toUpperCase()}] ${unit.unitName}: ${unit.health.current}/${unit.health.max} HP [${hpBar}] ${hpPercent}%`;
                console.log(`║${line.padEnd(61)}║`);
            }
        }

        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  CASUALTIES                                                ║`);
        console.log(`╟────────────────────────────────────────────────────────────╢`);

        if (deadUnits.length === 0) {
            console.log(`║  (No casualties)                                           ║`);
        } else {
            for (const unit of deadUnits) {
                const line = `  [${unit.team.toUpperCase()}] ${unit.unitName}: Killed round ${unit.round} (tick ${unit.tick})`;
                console.log(`║${line.padEnd(61)}║`);
            }
        }
    }

    if (verbose && result.entityCounts) {
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  ENTITY COUNTS                                             ║`);
        console.log(`╟────────────────────────────────────────────────────────────╢`);
        console.log(`║  Total Entities: ${String(result.entityCounts.total).padEnd(43)}║`);
        for (const [team, count] of Object.entries(result.entityCounts.byTeam)) {
            console.log(`║    ${team}: ${String(count).padEnd(50)}║`);
        }
    }

    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
}

/**
 * Run multiple simulations in batch mode
 */
async function runBatchSimulations(runner, simulationIds, options = {}) {
    const { maxTicks = 10000, verbose = false, json = false } = options;
    const results = [];
    const batchStart = Date.now();

    console.log(`[Headless] Running ${simulationIds.length} simulations in batch mode...`);

    for (let i = 0; i < simulationIds.length; i++) {
        const simId = simulationIds[i];
        const simConfig = loadSimulation(simId);

        if (!simConfig) {
            console.error(`[Headless] Simulation '${simId}' not found, skipping`);
            results.push({ simulationId: simId, error: 'not found' });
            continue;
        }

        console.log(`[Headless] [${i + 1}/${simulationIds.length}] Running: ${simConfig.name || simId}`);

        // Reset between simulations (except first one)
        if (i > 0) {
            await runner.resetForNewSimulation();
        }

        const simRunConfig = {
            simulationId: simId,
            simulationName: simConfig.name,
            level: simConfig.level || 'level_1',
            startingGold: simConfig.startingGold || 100,
            seed: simConfig.seed || Date.now(),
            leftBuildOrder: simConfig.buildOrderA,
            rightBuildOrder: simConfig.buildOrderB
        };

        try {
            const result = await runSingleSimulation(runner, simRunConfig, { maxTicks, verbose });
            results.push(result);

            if (!json) {
                // Print full battle report for each simulation
                printSimulationResults(result, verbose);
            }
        } catch (error) {
            console.error(`[Headless] Error running ${simId}:`, error.message);
            results.push({ simulationId: simId, error: error.message });
        }
    }

    const batchTime = Date.now() - batchStart;

    return { results, batchTimeMs: batchTime };
}

/**
 * Main execution
 */
async function main() {
    const config = parseArgs();

    try {
        const { engine, runner } = await createHeadlessRunner();

        // Batch mode - run multiple simulations
        if (config.batch || config.simulations.length > 0) {
            const simulationIds = config.simulations.length > 0
                ? config.simulations
                : getAllSimulationIds();

            const { results, batchTimeMs } = await runBatchSimulations(runner, simulationIds, {
                maxTicks: config.maxTicks,
                verbose: config.verbose,
                json: config.json
            });

            if (config.json) {
                // Output as JSON for programmatic use
                console.log(JSON.stringify({ results, batchTimeMs }, null, 2));
            } else {
                // Print summary
                console.log(`\n╔════════════════════════════════════════════════════════════╗`);
                console.log(`║                      BATCH SUMMARY                         ║`);
                console.log(`╠════════════════════════════════════════════════════════════╣`);
                console.log(`║  Total Simulations: ${String(results.length).padEnd(40)}║`);
                console.log(`║  Total Time: ${(batchTimeMs + 'ms').padEnd(47)}║`);

                const wins = { left: 0, right: 0, draw: 0, none: 0, error: 0 };
                for (const r of results) {
                    if (r.error) wins.error++;
                    else if (r.winner === 'left') wins.left++;
                    else if (r.winner === 'right') wins.right++;
                    else if (r.winner === 'draw') wins.draw++;
                    else wins.none++;
                }

                console.log(`╟────────────────────────────────────────────────────────────╢`);
                console.log(`║  Win Summary:                                              ║`);
                console.log(`║    Left (buildOrderA): ${String(wins.left).padEnd(37)}║`);
                console.log(`║    Right (buildOrderB): ${String(wins.right).padEnd(36)}║`);
                console.log(`║    Draw: ${String(wins.draw).padEnd(51)}║`);
                console.log(`║    No Winner: ${String(wins.none).padEnd(46)}║`);
                if (wins.error > 0) {
                    console.log(`║    Errors: ${String(wins.error).padEnd(49)}║`);
                }
                console.log(`╚════════════════════════════════════════════════════════════╝\n`);
            }

            process.exit(0);
        }

        // Single simulation mode
        const simRunConfig = {
            simulationId: config.simulation,
            simulationName: config.simulationName,
            level: config.level,
            startingGold: config.startingGold,
            seed: config.seed,
            leftBuildOrder: config.leftBuildOrder,
            rightBuildOrder: config.rightBuildOrder
        };

        console.log(`[Headless] Simulation configured:`);
        if (config.simulationName) {
            console.log(`  Simulation: ${config.simulationName}`);
            if (config.simulationDescription) {
                console.log(`  Description: ${config.simulationDescription}`);
            }
        }
        console.log(`  Level: ${config.level}`);
        console.log(`  Seed: ${config.seed}`);
        console.log(`  Starting Gold: ${config.startingGold}`);
        console.log(`  Left Build Order: ${config.leftBuildOrder}`);
        console.log(`  Right Build Order: ${config.rightBuildOrder}`);

        console.log(`[Headless] Running simulation with AI opponents...`);

        const result = await runSingleSimulation(runner, simRunConfig, {
            maxTicks: config.maxTicks,
            verbose: config.verbose
        });

        if (config.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            printSimulationResults(result, config.verbose);
        }

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
