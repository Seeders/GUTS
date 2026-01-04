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
 *   const results = await runner.run();
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
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
            case '--json':
                config.json = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
            default:
                if (arg.startsWith('-')) {
                    console.error(`[Headless] Unknown flag: ${arg}`);
                    console.error(`[Headless] Use --help for available options`);
                    process.exit(1);
                }
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

        // Use buildOrders array - [0] is left team, [1] is right team
        config.leftBuildOrder = simConfig.buildOrders[0];
        config.rightBuildOrder = simConfig.buildOrders[1];
        config.simulationName = simConfig.name;
        config.simulationDescription = simConfig.description;

        // Use aiModes array if present - [0] is left team, [1] is right team
        if (simConfig.aiModes) {
            config.leftAiMode = simConfig.aiModes[0] || 'buildOrder';
            config.rightAiMode = simConfig.aiModes[1] || 'buildOrder';
        }

        // Termination options
        if (simConfig.terminationEvent) {
            config.terminationEvent = simConfig.terminationEvent;
        }
        if (simConfig.maxRounds !== undefined) {
            config.maxRounds = simConfig.maxRounds;
        }
        if (simConfig.endOnFirstDeath !== undefined) {
            config.endOnFirstDeath = simConfig.endOnFirstDeath;
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
 * Format simulation results as text for file output
 */
function formatResultsAsText(result, verbose = false) {
    const lines = [];

    lines.push(`════════════════════════════════════════════════════════════`);
    lines.push(`                    SIMULATION RESULTS                      `);
    lines.push(`════════════════════════════════════════════════════════════`);

    if (result.simulationName) {
        lines.push(`  Simulation: ${result.simulationName}`);
    }
    lines.push(`  Matchup: ${result.leftBuildOrder} vs ${result.rightBuildOrder}`);
    lines.push(`────────────────────────────────────────────────────────────`);

    const winnerDisplay = result.winner === 'left' ? `LEFT (${result.leftBuildOrder}) WINS!`
        : result.winner === 'right' ? `RIGHT (${result.rightBuildOrder}) WINS!`
        : result.winner === 'draw' ? 'DRAW - Both units died!'
        : 'NO WINNER (timeout)';

    lines.push(`  Result: ${winnerDisplay}`);
    lines.push(`  Completed: ${result.completed ? 'Yes' : 'No (timeout)'}`);

    // Debug info for winner determination
    if (result.debugInfo) {
        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  DEBUG INFO`);
        lines.push(`────────────────────────────────────────────────────────────`);
        if (result.debugInfo.errorPath) {
            lines.push(`  ERROR PATH: ${result.debugInfo.error}`);
        }
        lines.push(`  Raw Phase: ${result.debugInfo.rawPhase}`);
        lines.push(`  Phase Name: ${result.debugInfo.phaseName}`);
        lines.push(`  game.state.winner: ${result.debugInfo.gameStateWinner}`);
        lines.push(`  game.state.gameOver: ${result.debugInfo.gameStateGameOver}`);
        lines.push(`  Entity Counts - Left: ${result.debugInfo.entityCountsLeft}, Right: ${result.debugInfo.entityCountsRight}`);
        lines.push(`  Final Winner: ${result.debugInfo.finalWinner}`);
        if (result.debugInfo.phaseCheck) {
            lines.push(`  Phase Check (SimSystem): currentPhase=${result.debugInfo.phaseCheck.currentPhase}, endedEnum=${result.debugInfo.phaseCheck.endedEnum}, matches=${result.debugInfo.phaseCheck.matches}`);
        }
        if (result.debugInfo.phaseCheckEngine) {
            const pc = result.debugInfo.phaseCheckEngine;
            lines.push(`  Phase Check (Engine): currentPhase=${pc.currentPhase}, endedEnum=${pc.endedEnum}, matchesEnum=${pc.matchesEnum}, matchesString=${pc.matchesString}`);
        }
    }

    lines.push(`────────────────────────────────────────────────────────────`);
    lines.push(`  BATTLE STATISTICS`);
    lines.push(`────────────────────────────────────────────────────────────`);
    lines.push(`  Final Round: ${result.round}`);
    lines.push(`  Final Phase: ${result.phase}`);
    lines.push(`  Total Ticks: ${result.tickCount}`);
    lines.push(`  Game Time: ${result.gameTime?.toFixed(2)}s`);
    lines.push(`  Real Time: ${result.realTimeMs}ms`);
    lines.push(`  Performance: ${result.ticksPerSecond.toFixed(0)} ticks/sec`);

    if (result.unitStatistics) {
        const { livingUnits, deadUnits, combatSummary } = result.unitStatistics;

        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  COMBAT ACTIVITY`);
        lines.push(`────────────────────────────────────────────────────────────`);

        if (combatSummary) {
            lines.push(`  Total Attacks: ${combatSummary.totalAttacks}`);
            lines.push(`    Left Team: ${combatSummary.attacksByTeam?.left || 0}`);
            lines.push(`    Right Team: ${combatSummary.attacksByTeam?.right || 0}`);

            if (combatSummary.attacksByUnit && combatSummary.attacksByUnit.length > 0) {
                lines.push(`  Attacks by Unit:`);
                for (const unitStats of combatSummary.attacksByUnit) {
                    lines.push(`    [${unitStats.team.toUpperCase()}] ${unitStats.unitType}: ${unitStats.attacks} attacks`);
                }
            }

            lines.push(`  Total Abilities: ${combatSummary.totalAbilities || 0}`);
            lines.push(`    Left Team: ${combatSummary.abilitiesByTeam?.left || 0}`);
            lines.push(`    Right Team: ${combatSummary.abilitiesByTeam?.right || 0}`);

            if (combatSummary.abilitiesByUnit && combatSummary.abilitiesByUnit.length > 0) {
                lines.push(`  Abilities by Unit:`);
                for (const unitStats of combatSummary.abilitiesByUnit) {
                    const abilityList = Object.entries(unitStats.abilityNames || {})
                        .map(([name, count]) => `${name}:${count}`)
                        .join(', ');
                    lines.push(`    [${unitStats.team.toUpperCase()}] ${unitStats.unitType}: ${unitStats.abilities} abilities (${abilityList})`);
                }
            }
        } else {
            lines.push(`  (No combat activity recorded)`);
        }

        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  SURVIVING UNITS`);
        lines.push(`────────────────────────────────────────────────────────────`);

        const skipTypes = ['townHall', 'barracks', 'fletchersHall', 'mageTower', 'goldMine', 'peasant', 'dragon_red'];
        const combatLivingUnits = livingUnits.filter(u => !skipTypes.includes(u.unitType));

        if (combatLivingUnits.length === 0) {
            lines.push(`  (No surviving combat units)`);
        } else {
            for (const unit of combatLivingUnits) {
                const hpPercent = unit.health.max > 0 ? Math.round((unit.health.current / unit.health.max) * 100) : 0;
                lines.push(`  [${unit.team.toUpperCase()}] ${unit.unitName}: ${unit.health.current}/${unit.health.max} HP (${hpPercent}%)`);
            }
        }

        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  CASUALTIES`);
        lines.push(`────────────────────────────────────────────────────────────`);

        if (deadUnits.length === 0) {
            lines.push(`  (No casualties)`);
        } else {
            for (const unit of deadUnits) {
                lines.push(`  [${unit.team.toUpperCase()}] ${unit.unitName}: Killed round ${unit.round} (tick ${unit.tick})`);
            }
        }
    }

    if (verbose && result.entityCounts) {
        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  ENTITY COUNTS`);
        lines.push(`────────────────────────────────────────────────────────────`);
        lines.push(`  Total Entities: ${result.entityCounts.total}`);
        for (const [team, count] of Object.entries(result.entityCounts.byTeam)) {
            lines.push(`    ${team}: ${count}`);
        }
    }

    lines.push(`════════════════════════════════════════════════════════════`);

    // Include combat log if present
    if (result.combatLog && result.combatLog.length > 0) {
        lines.push(``);
        lines.push(`════════════════════════════════════════════════════════════`);
        lines.push(`                       COMBAT LOG                           `);
        lines.push(`════════════════════════════════════════════════════════════`);
        for (const logLine of result.combatLog) {
            lines.push(logLine);
        }
        lines.push(`════════════════════════════════════════════════════════════`);
    }

    // Include debug log if present and verbose
    if (verbose && result.debugLog && result.debugLog.length > 0) {
        lines.push(``);
        lines.push(`════════════════════════════════════════════════════════════`);
        lines.push(`                       DEBUG LOG                            `);
        lines.push(`════════════════════════════════════════════════════════════`);
        for (const logLine of result.debugLog) {
            lines.push(logLine);
        }
        lines.push(`════════════════════════════════════════════════════════════`);
    }

    lines.push(``);

    return lines.join('\n');
}

/**
 * Run a single simulation and return results
 * @param {Object} runner - HeadlessSkirmishRunner instance
 * @param {Object} simConfig - Simulation configuration
 * @param {Object} options - Run options (verbose)
 * @returns {Promise<Object>} Simulation results with metadata
 */
async function runSingleSimulation(runner, simConfig, options = {}) {
    const { verbose = false } = options;

    // Capture console output during simulation
    const consoleLog = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
        const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        consoleLog.push(line);
        originalLog.apply(console, args);
    };
    console.warn = (...args) => {
        const line = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        consoleLog.push(line);
        originalWarn.apply(console, args);
    };
    console.error = (...args) => {
        const line = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        consoleLog.push(line);
        originalError.apply(console, args);
    };

    await runner.setup({
        level: simConfig.level,
        startingGold: simConfig.startingGold,
        seed: simConfig.seed,
        leftBuildOrder: simConfig.leftBuildOrder,
        rightBuildOrder: simConfig.rightBuildOrder,
        leftAiMode: simConfig.leftAiMode || 'buildOrder',
        rightAiMode: simConfig.rightAiMode || 'buildOrder',
        // Termination options
        terminationEvent: simConfig.terminationEvent,
        maxRounds: simConfig.maxRounds,
        endOnFirstDeath: simConfig.endOnFirstDeath
    });

    // Enable call logging for combat-relevant services
    const game = runner.engine.gameInstance;
    if (game && game.callLogger) {
        // Filter to only log combat-related service calls
        // Note: useAbility excluded as it floods the buffer with peasant "build" calls
        // Abilities are already tracked in unitStatistics
        game.callLogger.setFilter([
            'applyDamage',
            'scheduleDamage',
            'fireProjectile',
            'applySplashDamage',
            'applyBuff',
            'removeBuff',
            'startDeathProcess',
            'healEntity'
        ]);
        game.callLogger.enable();
    }

    const runStart = Date.now();
    const results = await runner.run();
    const runTime = Date.now() - runStart;

    // Collect call log entries and format them
    let combatLog = [];
    if (game && game.callLogger) {
        const entries = game.callLogger.all();
        combatLog = formatCombatLog(entries, game);
        game.callLogger.disable();
        game.callLogger.clear();
    }

    // Restore console functions
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    // Determine winner - if phase is 'ended' but winner not set, calculate from entity counts
    let winner = results.winner;
    let completed = results.completed;
    console.log(`[headless.js] Results from runner: winner=${winner}, phase=${results.phase}, completed=${completed}`);

    if (!winner && (results.phase === 'ended' || results.phase === 4)) {
        // Game ended but winner wasn't determined - calculate from surviving entities
        const entityCounts = results.entityCounts || {};
        const leftCount = entityCounts.byTeam?.left || 0;
        const rightCount = entityCounts.byTeam?.right || 0;

        if (leftCount > rightCount) {
            winner = 'left';
        } else if (rightCount > leftCount) {
            winner = 'right';
        } else {
            winner = 'draw';
        }
        completed = true; // Phase is ended, so it completed
    }

    return {
        simulationId: simConfig.simulationId,
        simulationName: simConfig.simulationName,
        leftBuildOrder: simConfig.leftBuildOrder,
        rightBuildOrder: simConfig.rightBuildOrder,
        completed: completed,
        winner: winner || 'none',
        tickCount: results.tickCount,
        gameTime: results.gameTime,
        realTimeMs: runTime,
        ticksPerSecond: runTime > 0 ? results.tickCount / (runTime / 1000) : 0,
        round: results.round,
        phase: results.phase,
        unitStatistics: results.unitStatistics,
        entityCounts: results.entityCounts,
        combatLog,
        debugLog: consoleLog,
        debugInfo: results.debugInfo
    };
}

/**
 * Format call log entries into human-readable combat log
 */
function formatCombatLog(entries, game) {
    const log = [];
    const reverseEnums = game.getReverseEnums?.() || {};

    // Helper to get unit name from entity ID
    const getUnitName = (entityId) => {
        if (entityId === null || entityId === undefined) return 'unknown';
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        if (!unitTypeComp) return `entity#${entityId}`;
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        return unitDef?.id || `entity#${entityId}`;
    };

    // Helper to get team name
    const getTeamName = (entityId) => {
        if (entityId === null || entityId === undefined) return '';
        const teamComp = game.getComponent(entityId, 'team');
        if (!teamComp) return '';
        return reverseEnums.team?.[teamComp.team] || `team${teamComp.team}`;
    };

    // Helper to get element name
    const getElementName = (elementId) => {
        return reverseEnums.element?.[elementId] || 'physical';
    };

    for (const entry of entries) {
        const time = entry.time?.toFixed(2) || '0.00';
        const args = entry.args || [];

        switch (entry.key) {
            case 'applyDamage': {
                // args: [attackerId, targetId, damage, element, options]
                // result: { damage, healthRemaining, healthMax, fatal, ... }
                const [attackerId, targetId, damage, element] = args;
                const result = entry.result || {};
                const attackerName = getUnitName(attackerId);
                const attackerTeam = getTeamName(attackerId);
                const targetName = getUnitName(targetId);
                const targetTeam = getTeamName(targetId);
                const elementName = getElementName(element);
                const finalDamage = result.damage ?? damage;
                const healthInfo = result.healthRemaining !== undefined
                    ? ` (${targetName}: ${result.healthRemaining}/${result.healthMax} HP)`
                    : '';
                log.push(`[${time}s] DAMAGE: ${attackerName} [${attackerTeam}] deals ${finalDamage} ${elementName} damage to ${targetName} [${targetTeam}]${healthInfo}`);
                break;
            }
            case 'scheduleDamage': {
                // args: [attackerId, targetId, damage, element, delay, options]
                const [attackerId, targetId, damage, element, delay, options] = args;
                const attackerName = getUnitName(attackerId);
                const attackerTeam = getTeamName(attackerId);
                const targetName = getUnitName(targetId);
                const elementName = getElementName(element);
                const isMelee = options?.isMelee ? ' (melee)' : '';
                log.push(`[${time}s] ATTACK: ${attackerName} [${attackerTeam}] attacks ${targetName} for ${damage} ${elementName}${isMelee}`);
                break;
            }
            case 'fireProjectile': {
                // args: [attackerId, targetId, projectileData]
                const [attackerId, targetId, projectileData] = args;
                const attackerName = getUnitName(attackerId);
                const attackerTeam = getTeamName(attackerId);
                const targetName = getUnitName(targetId);
                const projName = projectileData?.id || 'projectile';
                log.push(`[${time}s] PROJECTILE: ${attackerName} [${attackerTeam}] fires ${projName} at ${targetName}`);
                break;
            }
            case 'applySplashDamage': {
                // args: [attackerId, position, damage, element, radius, options]
                const [attackerId, , damage, element, radius] = args;
                const attackerName = getUnitName(attackerId);
                const attackerTeam = getTeamName(attackerId);
                const elementName = getElementName(element);
                log.push(`[${time}s] SPLASH: ${attackerName} [${attackerTeam}] deals ${damage} ${elementName} splash (radius: ${radius})`);
                break;
            }
            case 'applyBuff': {
                // args: [targetId, buffType, options]
                const [targetId, buffType, options] = args;
                const targetName = getUnitName(targetId);
                const targetTeam = getTeamName(targetId);
                const buffName = reverseEnums.buffTypes?.[buffType] || `buff#${buffType}`;
                const duration = options?.duration ? ` for ${options.duration}s` : '';
                log.push(`[${time}s] BUFF: ${targetName} [${targetTeam}] gains ${buffName}${duration}`);
                break;
            }
            case 'removeBuff': {
                const [targetId, buffType] = args;
                const targetName = getUnitName(targetId);
                const targetTeam = getTeamName(targetId);
                const buffName = reverseEnums.buffTypes?.[buffType] || `buff#${buffType}`;
                log.push(`[${time}s] BUFF EXPIRED: ${targetName} [${targetTeam}] loses ${buffName}`);
                break;
            }
            case 'startDeathProcess': {
                // args: [entityId]
                const [entityId] = args;
                const unitName = getUnitName(entityId);
                const teamName = getTeamName(entityId);
                log.push(`[${time}s] DEATH: ${unitName} [${teamName}] dies`);
                break;
            }
            case 'healEntity': {
                // args: [targetId, healAmount, healerId]
                const [targetId, healAmount, healerId] = args;
                const targetName = getUnitName(targetId);
                const targetTeam = getTeamName(targetId);
                const healerName = healerId ? getUnitName(healerId) : 'unknown';
                log.push(`[${time}s] HEAL: ${healerName} heals ${targetName} [${targetTeam}] for ${healAmount}`);
                break;
            }
            case 'useAbility': {
                // args: [entityId, abilityId, targetData]
                const [entityId, abilityId, targetData] = args;
                const abilityName = reverseEnums.abilities?.[abilityId] || abilityId || 'unknown';
                // Skip non-combat abilities (build is used by peasants repeatedly while constructing)
                if (abilityName === 'build' || abilityName === 'BuildAbility') break;
                const casterName = getUnitName(entityId);
                const casterTeam = getTeamName(entityId);
                const targetInfo = targetData?.targetId ? ` on ${getUnitName(targetData.targetId)}` : '';
                log.push(`[${time}s] ABILITY: ${casterName} [${casterTeam}] uses ${abilityName}${targetInfo}`);
                break;
            }
            default:
                log.push(`[${time}s] ${entry.key}: ${JSON.stringify(args)}`);
        }
    }

    return log;
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

            console.log(`╟────────────────────────────────────────────────────────────╢`);
            console.log(`║  Total Abilities: ${String(combatSummary.totalAbilities || 0).padEnd(42)}║`);
            console.log(`║    Left Team: ${String(combatSummary.abilitiesByTeam?.left || 0).padEnd(46)}║`);
            console.log(`║    Right Team: ${String(combatSummary.abilitiesByTeam?.right || 0).padEnd(45)}║`);

            if (combatSummary.abilitiesByUnit && combatSummary.abilitiesByUnit.length > 0) {
                console.log(`╟────────────────────────────────────────────────────────────╢`);
                console.log(`║  Abilities by Unit:                                        ║`);
                for (const unitStats of combatSummary.abilitiesByUnit) {
                    const abilityList = Object.entries(unitStats.abilityNames || {})
                        .map(([name, count]) => `${name}:${count}`)
                        .join(', ');
                    const line = `    [${unitStats.team.toUpperCase()}] ${unitStats.unitType}: ${abilityList}`;
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
    const { verbose = false } = options;
    const results = [];
    const batchStart = Date.now();
    const summaryResults = [];  // Collect summary-only results for batch file

    // Get HeadlessLogger for capture mode
    const HeadlessLogger = global.GUTS?.HeadlessLogger;

    console.log(`[Headless] Running ${simulationIds.length} simulations in batch mode...`);

    for (let i = 0; i < simulationIds.length; i++) {
        const simId = simulationIds[i];
        const simConfig = loadSimulation(simId);

        if (!simConfig) {
            console.error(`[Headless] Simulation '${simId}' not found, skipping`);
            results.push({ simulationId: simId, error: 'not found' });
            summaryResults.push({ simulationId: simId, error: 'not found' });
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
            level: simConfig.level,
            startingGold: simConfig.startingGold,
            seed: simConfig.seed,
            leftBuildOrder: simConfig.buildOrders[0],
            rightBuildOrder: simConfig.buildOrders[1],
            leftAiMode: simConfig.aiModes?.[0] || 'buildOrder',
            rightAiMode: simConfig.aiModes?.[1] || 'buildOrder',
            // Termination options
            terminationEvent: simConfig.terminationEvent,
            maxRounds: simConfig.maxRounds,
            endOnFirstDeath: simConfig.endOnFirstDeath
        };

        try {
            // Enable capture mode to collect logs to buffer instead of console
            if (HeadlessLogger) {
                HeadlessLogger.setCaptureMode(true);
            }

            // Suppress all console output during simulation by redirecting to capture buffer
            const originalLog = console.log;
            const originalWarn = console.warn;
            const originalError = console.error;
            const consoleBuffer = [];

            console.log = (...args) => consoleBuffer.push('[LOG] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
            console.warn = (...args) => consoleBuffer.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
            console.error = (...args) => consoleBuffer.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));

            const result = await runSingleSimulation(runner, simRunConfig, { verbose });
            results.push(result);

            // Restore console
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;

            // Get captured logs (both HeadlessLogger and console)
            const headlessLogs = HeadlessLogger ? HeadlessLogger.getCapturedLogs() : '';
            const consoleLogs = consoleBuffer.join('\n');
            const allLogs = headlessLogs + (consoleLogs ? '\n\n=== Console Output ===\n' + consoleLogs : '');

            // Disable capture mode
            if (HeadlessLogger) {
                HeadlessLogger.setCaptureMode(false);
            }

            // Write individual result file with full verbose output AND captured logs
            const simTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const resultsDir = path.join(__dirname, 'simulation_results');
            if (!existsSync(resultsDir)) {
                const { mkdirSync } = await import('fs');
                mkdirSync(resultsDir, { recursive: true });
            }
            const individualPath = path.join(resultsDir, `simulation_${simId}_${simTimestamp}.txt`);
            const fileContent = allLogs + '\n\n' + formatResultsAsText(result, true);
            writeFileSync(individualPath, fileContent);

            // Print brief summary line in console (not full results)
            const winnerDisplay = result.winner === 'left' ? `LEFT (${result.leftBuildOrder})`
                : result.winner === 'right' ? `RIGHT (${result.rightBuildOrder})`
                : result.winner === 'draw' ? 'DRAW'
                : 'NO WINNER';
            console.log(`[Headless]   -> ${simConfig.name || simId}: ${winnerDisplay} wins - ${result.tickCount} ticks`);
            console.log(`[Headless]      Results: ${individualPath}`);

            // Collect summary for batch file
            summaryResults.push(formatResultSummary(result));
        } catch (error) {
            // Disable capture mode on error
            if (HeadlessLogger) {
                HeadlessLogger.setCaptureMode(false);
            }
            console.error(`[Headless] Error running ${simId}:`, error.message);
            results.push({ simulationId: simId, error: error.message });
            summaryResults.push({ simulationId: simId, error: error.message });
        }
    }

    const batchTime = Date.now() - batchStart;

    // Write batch summary file with only summary results (not full debug)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsDir = path.join(__dirname, 'simulation_results');
    if (!existsSync(resultsDir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(resultsDir, { recursive: true });
    }
    const batchPath = path.join(resultsDir, `batch_results_${timestamp}.txt`);
    const batchContent = generateBatchSummaryFile(summaryResults, batchTime);
    writeFileSync(batchPath, batchContent);
    console.log(`[Headless] Batch summary written to: ${batchPath}`);

    return { results, batchTimeMs: batchTime };
}

/**
 * Format a single result as a brief summary (for batch file)
 */
function formatResultSummary(result) {
    const winnerDisplay = result.winner === 'left' ? `LEFT (${result.leftBuildOrder})`
        : result.winner === 'right' ? `RIGHT (${result.rightBuildOrder})`
        : result.winner === 'draw' ? 'DRAW'
        : 'NO WINNER (timeout)';

    return {
        simulationId: result.simulationId,
        simulationName: result.simulationName,
        matchup: `${result.leftBuildOrder} vs ${result.rightBuildOrder}`,
        winner: result.winner,
        winnerDisplay,
        completed: result.completed,
        round: result.round,
        tickCount: result.tickCount,
        gameTime: result.gameTime,
        realTimeMs: result.realTimeMs
    };
}

/**
 * Generate batch summary file content
 */
function generateBatchSummaryFile(summaryResults, batchTimeMs) {
    const lines = [];

    lines.push(`════════════════════════════════════════════════════════════════════════════`);
    lines.push(`                         BATCH SIMULATION RESULTS                           `);
    lines.push(`════════════════════════════════════════════════════════════════════════════`);
    lines.push(`  Generated: ${new Date().toISOString()}`);
    lines.push(`  Total Simulations: ${summaryResults.length}`);
    lines.push(`  Total Time: ${batchTimeMs}ms (${(batchTimeMs / 1000).toFixed(1)}s)`);
    lines.push(``);

    // Win statistics
    const wins = { left: 0, right: 0, draw: 0, none: 0, error: 0 };
    for (const r of summaryResults) {
        if (r.error) wins.error++;
        else if (r.winner === 'left') wins.left++;
        else if (r.winner === 'right') wins.right++;
        else if (r.winner === 'draw') wins.draw++;
        else wins.none++;
    }

    lines.push(`────────────────────────────────────────────────────────────────────────────`);
    lines.push(`  WIN SUMMARY`);
    lines.push(`────────────────────────────────────────────────────────────────────────────`);
    lines.push(`    Left Wins:  ${wins.left}`);
    lines.push(`    Right Wins: ${wins.right}`);
    lines.push(`    Draws:      ${wins.draw}`);
    lines.push(`    Timeouts:   ${wins.none}`);
    if (wins.error > 0) {
        lines.push(`    Errors:     ${wins.error}`);
    }
    lines.push(``);

    // Individual results
    lines.push(`────────────────────────────────────────────────────────────────────────────`);
    lines.push(`  INDIVIDUAL RESULTS`);
    lines.push(`────────────────────────────────────────────────────────────────────────────`);

    for (const r of summaryResults) {
        if (r.error) {
            lines.push(`  X ${r.simulationId}: ERROR - ${r.error}`);
        } else {
            const status = r.completed ? 'OK' : 'TIMEOUT';
            lines.push(`  [${status}] ${r.simulationName || r.simulationId}`);
            lines.push(`      Matchup: ${r.matchup}`);
            lines.push(`      Result:  ${r.winnerDisplay}`);
            lines.push(`      Round:   ${r.round}, Ticks: ${r.tickCount}, Time: ${r.gameTime?.toFixed(2)}s`);
            lines.push(``);
        }
    }

    lines.push(`════════════════════════════════════════════════════════════════════════════`);

    return lines.join('\n');
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
                console.log(`║    Left (buildOrders[0]): ${String(wins.left).padEnd(34)}║`);
                console.log(`║    Right (buildOrders[1]): ${String(wins.right).padEnd(33)}║`);
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
            rightBuildOrder: config.rightBuildOrder,
            leftAiMode: config.leftAiMode || 'buildOrder',
            rightAiMode: config.rightAiMode || 'buildOrder',
            // Termination options
            terminationEvent: config.terminationEvent,
            maxRounds: config.maxRounds,
            endOnFirstDeath: config.endOnFirstDeath
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
        console.log(`  Left AI Mode: ${config.leftAiMode || 'buildOrder'}`);
        console.log(`  Right AI Mode: ${config.rightAiMode || 'buildOrder'}`);

        console.log(`[Headless] Running simulation with AI opponents...`);

        const result = await runSingleSimulation(runner, simRunConfig, {
            verbose: config.verbose
        });

        if (config.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            printSimulationResults(result, config.verbose);
        }

        // Write results to simulation_results folder
        const simName = config.simulation || `${config.leftBuildOrder}_vs_${config.rightBuildOrder}`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsDir = path.join(__dirname, 'simulation_results');
        if (!existsSync(resultsDir)) {
            const { mkdirSync } = await import('fs');
            mkdirSync(resultsDir, { recursive: true });
        }
        const outputPath = path.join(resultsDir, `${simName}_${timestamp}.txt`);
        writeFileSync(outputPath, formatResultsAsText(result, config.verbose));
        console.log(`[Headless] Results written to: ${outputPath}`);

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
