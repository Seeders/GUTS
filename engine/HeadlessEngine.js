import BaseEngine from './BaseEngine.js';

/**
 * HeadlessEngine - Minimal simulation runner without rendering
 *
 * This engine is completely game-agnostic. It only:
 * - Initializes the game instance and loader
 * - Runs the tick loop
 * - Provides basic simulation control (pause/resume/stop)
 *
 * All game logic is handled by BaseECSGame and its systems.
 * No game-specific code belongs here.
 */
export default class HeadlessEngine extends BaseEngine {
    constructor() {
        super();
        this.isServer = true;
        this.isHeadless = true;
        this.tickRate = 1 / 20; // 20 TPS
        this.paused = false;
        this.running = false;
        this.maxTicks = 10000;
        this.defaultTimeoutMs = 30000; // 30 second default timeout
    }

    async init(projectName) {
        this.projectName = projectName;
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

        const config = this.collections.configs.headless || this.collections.configs.server;

        // Initialize logger with config level
        if (global.GUTS?.HeadlessLogger && config.logLevel) {
            global.GUTS.HeadlessLogger.setLevel(config.logLevel);
        }
        this._log = global.GUTS?.HeadlessLogger?.createLogger('HeadlessEngine') || {
            error: (...args) => console.error('[HeadlessEngine]', ...args),
            warn: (...args) => console.warn('[HeadlessEngine]', ...args),
            info: (...args) => console.log('[HeadlessEngine]', ...args),
            debug: () => {},
            trace: () => {}
        };

        // Create game instance
        const appLibrary = config.appLibrary || 'HeadlessECSGame';
        this.gameInstance = new global.GUTS[appLibrary](this);

        // Use loader
        const loaderLibrary = config.appLoaderLibrary || 'HeadlessGameLoader';
        this.loader = new global.GUTS[loaderLibrary](this.gameInstance);
        await this.loader.load();

        this._log.info('Initialized');
    }

    async loadCollections(projectName) {
        if (global.COMPILED_GAME?.collections) {
            return global.COMPILED_GAME.collections;
        }

        // Fallback: Load from file system
        const fs = await import('fs');
        const path = await import('path');

        try {
            const configsPath = path.join(process.cwd(), 'projects', projectName, 'collections', 'Settings', 'configs');
            const collections = { configs: {} };

            if (fs.existsSync(configsPath)) {
                const configFiles = fs.readdirSync(configsPath).filter(f => f.endsWith('.json'));
                for (const file of configFiles) {
                    const configName = path.basename(file, '.json');
                    collections.configs[configName] = JSON.parse(fs.readFileSync(path.join(configsPath, file), 'utf8'));
                }
            }

            return collections;
        } catch (error) {
            console.error('Failed to load config:', error);
            throw error;
        }
    }

    /**
     * Run the simulation loop
     * @param {Object} options
     * @param {number} options.maxTicks - Maximum ticks to run
     * @param {Function} options.shouldStop - Optional function that returns true to stop
     */
    async run(options = {}) {
        const { maxTicks = this.maxTicks, shouldStop } = options;

        this.running = true;
        this.paused = false;
        let tickCount = 0;

        while (this.running && tickCount < maxTicks) {
            if (!this.paused && this.gameInstance?.update) {
                await this.gameInstance.update(this.tickRate);
            }
            tickCount++;

            if (shouldStop && shouldStop(this.gameInstance)) {
                break;
            }
        }

        this.running = false;
        return { tickCount };
    }

    /**
     * Run a simulation with instructions
     * This is used by HeadlessSkirmishRunner for automated simulations
     *
     * Delegates instruction execution to HeadlessSimulationSystem which is registered
     * as a game system and can receive game events through triggerEvent.
     *
     * @param {Object} options
     * @param {Array} options.instructions - Array of instruction objects to process
     * @param {number} options.maxTicks - Maximum ticks before timeout
     * @param {number} options.timeoutMs - Maximum time in milliseconds before timeout (default: 30000)
     * @returns {Promise<Object>} Simulation results
     */
    async runSimulation(options = {}) {
        const {
            instructions = [],
            maxTicks = this.maxTicks,
            timeoutMs = this.defaultTimeoutMs
        } = options;

        const startTime = this.getCurrentTime();

        // Create timeout promise for safety
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                this.running = false; // Stop the simulation loop
                reject(new Error(`Simulation timeout after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        // Run the actual simulation with timeout protection
        try {
            const result = await Promise.race([
                this._runSimulationInternal(instructions, maxTicks, startTime),
                timeoutPromise
            ]);
            return result;
        } catch (error) {
            this.running = false;
            const elapsedMs = this.getCurrentTime() - startTime;

            // Return partial results on timeout
            const game = this.gameInstance;
            const gameSummary = game?.getGameSummary?.() || {};
            const reverseEnums = game?.getReverseEnums?.() || {};

            return {
                success: false,
                completed: false,
                error: error.message,
                timedOut: error.message.includes('timeout'),
                tickCount: game?.tickCount || 0,
                gameTime: game?.state?.now || 0,
                realTimeMs: elapsedMs,
                ticksPerSecond: elapsedMs > 0 ? ((game?.tickCount || 0) / elapsedMs) * 1000 : 0,
                round: game?.state?.round || 1,
                phase: reverseEnums.gamePhase?.[game?.state?.phase] || game?.state?.phase,
                winner: null,
                entityCounts: { total: 0, byTeam: {} },
                gameState: gameSummary
            };
        }
    }

    /**
     * Internal simulation runner (separated for timeout handling)
     * @private
     */
    async _runSimulationInternal(instructions, maxTicks, startTime) {
        const game = this.gameInstance;

        // Get or create the HeadlessSimulationSystem
        const simSystem = game.headlessSimulationSystem;
        if (!simSystem) {
            throw new Error('[HeadlessEngine] HeadlessSimulationSystem not found. Ensure it is registered in the headless scene config.');
        }

        // Set up the simulation with instructions
        simSystem.setupSimulation(instructions);

        // Run the tick loop
        this.running = true;
        this.paused = false;
        let tickCount = 0;

        while (this.running && tickCount < maxTicks) {
            // Process any ready instructions BEFORE the tick
            await simSystem.processInstructions();

            // Run one game tick
            if (!this.paused && game?.update) {
                await game.update(this.tickRate);
            }
            tickCount++;

            // Check stop conditions
            if (simSystem.isSimulationComplete()) {
                break;
            }
        }

        this.running = false;
        const elapsedMs = this.getCurrentTime() - startTime;

        // Return simulation results with all expected fields
        const gameSummary = game.getGameSummary?.() || {};
        const reverseEnums = game.getReverseEnums?.() || {};
        const simResults = simSystem.getResults();

        // Count entities by team
        const entityCounts = { total: 0, byTeam: {} };
        const entities = game.getEntitiesWith?.('team', 'health') || [];
        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            const health = game.getComponent(entityId, 'health');
            if (teamComp && health && health.current > 0) {
                entityCounts.total++;
                const teamName = reverseEnums.team?.[teamComp.team] || teamComp.team;
                entityCounts.byTeam[teamName] = (entityCounts.byTeam[teamName] || 0) + 1;
            }
        }

        // Determine winner
        let winner = null;
        const leftCount = entityCounts.byTeam.left || 0;
        const rightCount = entityCounts.byTeam.right || 0;
        if (game.state.gameOver) {
            if (leftCount > rightCount) winner = 'left';
            else if (rightCount > leftCount) winner = 'right';
            else winner = 'draw';
        }

        // Get unit statistics from HeadlessSimulationSystem
        const unitStatistics = simSystem.getUnitStatistics?.() || { livingUnits: [], deadUnits: [] };

        return {
            success: true,
            completed: game.state.gameOver || false,
            tickCount: game.tickCount || 0,
            gameTime: game.state.now || 0,
            realTimeMs: elapsedMs,
            ticksPerSecond: elapsedMs > 0 ? ((game.tickCount || 0) / elapsedMs) * 1000 : 0,
            round: game.state.round || 1,
            phase: reverseEnums.gamePhase?.[game.state.phase] || game.state.phase,
            winner,
            entityCounts,
            unitStatistics,
            ...simResults,
            gameState: gameSummary
        };
    }

    stop() {
        super.stop();
        this.running = false;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }

    getCurrentTime() {
        const [seconds, nanoseconds] = process.hrtime();
        return seconds * 1000 + nanoseconds / 1000000;
    }
}

export { HeadlessEngine };
