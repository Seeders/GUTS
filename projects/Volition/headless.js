/**
 * Volition Headless Solitaire Runner
 *
 * This script runs headless solitaire simulations without any rendering.
 * Uses the actual game code via the VolitionHeadlessRunner API.
 *
 * Usage:
 *   node headless.js                     # Run single game with random seed
 *   node headless.js --seed 12345        # Use specific seed for reproducible results
 *   node headless.js --games 1000        # Run N games for statistics
 *   node headless.js --verbose           # Show move-by-move output
 *   node headless.js --json              # Output results as JSON
 *
 * Programmatic usage:
 *   import { createHeadlessRunner } from './headless.js';
 *   const { runner, engine } = await createHeadlessRunner();
 *   await runner.setup({ seed: 12345 });
 *   const results = await runner.run();
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import HeadlessEngine from engine
import HeadlessEngine from '../../engine/HeadlessEngine.js';

/**
 * Load the compiled game bundle into the global context
 */
function loadCompiledGame() {
    console.log('[Headless] Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;

    // Mock localStorage
    const storage = {};
    global.localStorage = {
        getItem: (key) => storage[key] || null,
        setItem: (key, value) => { storage[key] = String(value); },
        removeItem: (key) => { delete storage[key]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
    };

    // Mock document for browser-dependent code
    global.document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({
            style: {},
            appendChild: () => {},
            classList: { add: () => {}, remove: () => {} }
        }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        documentElement: { clientWidth: 1920, clientHeight: 1080 },
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    // Mock window events
    global.addEventListener = () => {};
    global.removeEventListener = () => {};
    global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    global.cancelAnimationFrame = (id) => clearTimeout(id);

    // Set up CommonJS-like environment for webpack bundle
    global.module = { exports: {} };
    global.exports = global.module.exports;

    // Try to load the headless-specific bundle first
    let gamePath = path.join(__dirname, 'dist/headless/game.js');
    if (!existsSync(gamePath)) {
        // Fall back to client bundle
        gamePath = path.join(__dirname, 'dist/client/game.js');
    }

    if (!existsSync(gamePath)) {
        throw new Error(`Game bundle not found. Run build first.\nLooked for:\n  - dist/headless/game.js\n  - dist/client/game.js`);
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
 * @returns {Promise<{engine: HeadlessEngine, runner: VolitionHeadlessRunner}>}
 */
export async function createHeadlessRunner() {
    // Load compiled game if not already loaded
    if (!global.GUTS) {
        loadCompiledGame();
    }

    // Create and initialize engine
    const engine = new HeadlessEngine();
    await engine.init('Volition');

    // Initialize the game if needed
    if (global.COMPILED_GAME && !global.COMPILED_GAME.initialized) {
        global.COMPILED_GAME.init(engine);
    }

    // Create the runner
    const runner = new global.GUTS.VolitionHeadlessRunner(engine);

    return { engine, runner };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        seed: null,
        games: 1,
        verbose: false,
        json: false,
        maxMoves: 1000
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--seed':
            case '-s':
                config.seed = parseInt(args[++i], 10);
                break;
            case '--games':
            case '-g':
                config.games = parseInt(args[++i], 10);
                break;
            case '--verbose':
            case '-v':
                config.verbose = true;
                break;
            case '--json':
                config.json = true;
                break;
            case '--max-moves':
            case '-m':
                config.maxMoves = parseInt(args[++i], 10);
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

    return config;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Volition Headless Solitaire Simulator

Run solitaire games with a heuristic AI to analyze win rates.

Usage: node headless.js [options]

Options:
  --seed, -s <number>      Random seed for reproducible results
  --games, -g <number>     Number of games to run (default: 1)
  --max-moves, -m <number> Maximum moves per game (default: 1000)
  --verbose, -v            Show detailed move-by-move output
  --json                   Output results as JSON
  --help, -h               Show this help message

Examples:
  node headless.js                       # Single game, random seed
  node headless.js --seed 12345          # Reproducible game
  node headless.js --games 1000          # Run 1000 games for statistics
  node headless.js --games 100 --json    # 100 games, JSON output
  node headless.js --seed 42 --verbose   # Verbose single game
`);
}

/**
 * Run a single game
 */
async function runSingleGame(config) {
    const { runner, engine } = await createHeadlessRunner();

    const seed = config.seed || Math.floor(Math.random() * 2147483647);

    await runner.setup({
        seed: seed,
        verbose: config.verbose
    });

    const results = await runner.run({
        maxMoves: config.maxMoves
    });

    return {
        ...results,
        seed: seed
    };
}

/**
 * Run multiple games and collect statistics
 */
async function runBatchGames(config) {
    const stats = {
        games: config.games,
        wins: 0,
        losses: 0,
        totalKingdomCards: 0,
        totalMoves: 0,
        minKingdomCards: 52,
        maxKingdomCards: 0,
        results: []
    };

    const startTime = Date.now();

    for (let i = 0; i < config.games; i++) {
        // Use provided seed + game index for reproducibility
        const gameSeed = config.seed !== null
            ? config.seed + i
            : Math.floor(Math.random() * 2147483647);

        const { runner, engine } = await createHeadlessRunner();

        await runner.setup({
            seed: gameSeed,
            verbose: false // Don't spam during batch
        });

        const result = await runner.run({
            maxMoves: config.maxMoves
        });

        if (result.won) {
            stats.wins++;
        } else {
            stats.losses++;
        }

        stats.totalKingdomCards += result.kingdomCards;
        stats.totalMoves += result.moveCount;
        stats.minKingdomCards = Math.min(stats.minKingdomCards, result.kingdomCards);
        stats.maxKingdomCards = Math.max(stats.maxKingdomCards, result.kingdomCards);

        if (config.json) {
            stats.results.push({
                game: i + 1,
                seed: gameSeed,
                won: result.won,
                kingdomCards: result.kingdomCards,
                moves: result.moveCount
            });
        }

        // Progress indicator (every 10%)
        if (!config.json && config.games >= 10 && (i + 1) % Math.floor(config.games / 10) === 0) {
            const pct = Math.round(((i + 1) / config.games) * 100);
            process.stdout.write(`\r[Headless] Progress: ${pct}% (${stats.wins} wins so far)`);
        }
    }

    const elapsedMs = Date.now() - startTime;

    stats.winRate = (stats.wins / stats.games * 100).toFixed(2);
    stats.avgKingdomCards = (stats.totalKingdomCards / stats.games).toFixed(1);
    stats.avgMoves = (stats.totalMoves / stats.games).toFixed(1);
    stats.elapsedMs = elapsedMs;
    stats.gamesPerSecond = (stats.games / (elapsedMs / 1000)).toFixed(1);

    return stats;
}

/**
 * Main entry point
 */
async function main() {
    const config = parseArgs();

    try {
        if (config.games === 1) {
            // Single game
            const result = await runSingleGame(config);

            if (config.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('\n════════════════════════════════════════');
                console.log('          VOLITION SIMULATION RESULT     ');
                console.log('════════════════════════════════════════');
                console.log(`  Seed:           ${result.seed}`);
                console.log(`  Result:         ${result.won ? '✅ WIN' : '❌ LOSS'}`);
                console.log(`  Kingdom Cards:  ${result.kingdomCards}/52`);
                console.log(`  Total Moves:    ${result.moveCount}`);
                console.log(`  Deck Remaining: ${result.deckRemaining}`);
                console.log(`  Hand Remaining: ${result.handRemaining}`);
                console.log('════════════════════════════════════════\n');
            }
        } else {
            // Batch games
            const stats = await runBatchGames(config);

            if (config.json) {
                console.log(JSON.stringify(stats, null, 2));
            } else {
                console.log('\n');
                console.log('════════════════════════════════════════════');
                console.log('       VOLITION BATCH SIMULATION RESULTS    ');
                console.log('════════════════════════════════════════════');
                console.log(`  Games Played:     ${stats.games}`);
                console.log(`  Wins:             ${stats.wins}`);
                console.log(`  Losses:           ${stats.losses}`);
                console.log(`  Win Rate:         ${stats.winRate}%`);
                console.log('────────────────────────────────────────────');
                console.log(`  Avg Kingdom Cards: ${stats.avgKingdomCards}/52`);
                console.log(`  Min Kingdom Cards: ${stats.minKingdomCards}`);
                console.log(`  Max Kingdom Cards: ${stats.maxKingdomCards}`);
                console.log(`  Avg Moves:         ${stats.avgMoves}`);
                console.log('────────────────────────────────────────────');
                console.log(`  Elapsed Time:     ${(stats.elapsedMs / 1000).toFixed(2)}s`);
                console.log(`  Games/Second:     ${stats.gamesPerSecond}`);
                console.log('════════════════════════════════════════════\n');
            }
        }
    } catch (error) {
        console.error('[Headless] Error:', error.message);
        if (config.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run if executed directly
const isMain = process.argv[1] && (
    process.argv[1].endsWith('headless.js') ||
    process.argv[1].includes('headless')
);

if (isMain) {
    main();
}
