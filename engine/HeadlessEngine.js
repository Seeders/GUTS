import BaseEngine from './BaseEngine.js';

/**
 * HeadlessEngine - Runs game simulations without rendering or network
 *
 * This engine is designed for:
 * - Running automated simulations
 * - Testing game logic
 * - AI training and evaluation
 * - Replay processing
 *
 * Features:
 * - Can run faster than realtime (for quick simulations)
 * - Can step through ticks manually
 * - Can process instruction sequences
 * - No dependencies on DOM, Canvas, or Network
 */
export default class HeadlessEngine extends BaseEngine {
    constructor() {
        super();
        this.isServer = true; // Treat as server for system loading purposes
        this.isHeadless = true;
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.accumulator = 0;
        this.simulationSpeed = 1.0; // Multiplier for simulation speed
        this.maxTicksPerUpdate = 100; // Max ticks per update call (prevents infinite loops)
        this.paused = false;
        this.running = false;

        // Simulation results
        this.simulationResults = null;

        // Instruction queue for automated play
        this.instructionQueue = [];
        this.currentInstructionIndex = 0;

        // Event callbacks
        this.onSimulationComplete = null;
        this.onTickComplete = null;
        this.onPhaseChange = null;
    }

    async init(projectName) {
        this.projectName = projectName;
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

        // Use headless config if available, otherwise fall back to server config
        const config = this.collections.configs.headless || this.collections.configs.server;

        // Create game instance
        const appLibrary = config.appLibrary || 'HeadlessECSGame';
        this.gameInstance = new global.GUTS[appLibrary](this);

        // Use HeadlessGameLoader
        const loaderLibrary = config.appLoaderLibrary || 'HeadlessGameLoader';
        this.loader = new global.GUTS[loaderLibrary](this.gameInstance);
        await this.loader.load();

        console.log('[HeadlessEngine] Initialized successfully');
    }

    async loadCollections(projectName) {
        // Use webpack-compiled collections from COMPILED_GAME
        if (global.COMPILED_GAME?.collections) {
            return global.COMPILED_GAME.collections;
        }

        // Fallback: Load from file system
        console.log('Fallback: Loading collections from file system');
        const fs = await import('fs');
        const path = await import('path');

        try {
            const scriptsPath = path.join(process.cwd(), 'projects', projectName, 'collections');
            const configsPath = path.join(scriptsPath, 'Settings', 'configs');

            const collections = {
                configs: {}
            };

            // Load ALL config files from Settings/configs
            if (fs.existsSync(configsPath)) {
                const configFiles = fs.readdirSync(configsPath).filter(f => f.endsWith('.json'));
                for (const file of configFiles) {
                    const configName = path.basename(file, '.json');
                    const configPath = path.join(configsPath, file);
                    collections.configs[configName] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                }
            }

            return collections;
        } catch (error) {
            console.error('Failed to load headless config:', error);
            throw error;
        }
    }

    /**
     * Start the simulation with optional instructions
     * @param {Object} options - Simulation options
     * @param {Array} options.instructions - Array of instruction objects
     * @param {number} options.maxTicks - Maximum ticks before forcing end
     * @param {number} options.seed - Random seed for deterministic simulation
     * @returns {Promise<Object>} Simulation results
     */
    async runSimulation(options = {}) {
        const { instructions = [], maxTicks = 10000, seed = Date.now() } = options;

        this.instructionQueue = [...instructions];
        this.currentInstructionIndex = 0;
        this.running = true;
        this.paused = false;

        // Set seed for deterministic simulation
        if (this.gameInstance.state) {
            this.gameInstance.state.gameSeed = seed;
        }
        if (this.gameInstance.rng) {
            this.gameInstance.rng.initialSeed = seed;
            this.gameInstance.rng.strands.clear();
        }

        let tickCount = 0;
        const startTime = Date.now();

        // Run simulation loop
        while (this.running && tickCount < maxTicks) {
            // Process any pending instructions
            await this.processInstructions();

            // Check if simulation should end
            if (this.shouldEndSimulation()) {
                break;
            }

            // Run a tick
            await this.tick();
            tickCount++;

            // Notify tick completion
            if (this.onTickComplete) {
                this.onTickComplete(tickCount, this.gameInstance);
            }
        }

        const endTime = Date.now();

        // Compile results
        this.simulationResults = this.compileResults(tickCount, endTime - startTime);

        // Notify completion
        if (this.onSimulationComplete) {
            this.onSimulationComplete(this.simulationResults);
        }

        this.running = false;
        return this.simulationResults;
    }

    /**
     * Step through the simulation one tick at a time
     * @returns {Promise<void>}
     */
    async stepTick() {
        if (!this.running) {
            this.running = true;
        }
        await this.processInstructions();
        await this.tick();
    }

    /**
     * Run simulation until a specific condition is met
     * @param {Function} condition - Function that returns true when simulation should stop
     * @param {number} maxTicks - Maximum ticks to run
     * @returns {Promise<Object>} Simulation results
     */
    async runUntil(condition, maxTicks = 10000) {
        this.running = true;
        let tickCount = 0;
        const startTime = Date.now();

        while (this.running && tickCount < maxTicks) {
            await this.processInstructions();
            await this.tick();
            tickCount++;

            if (condition(this.gameInstance)) {
                break;
            }
        }

        const endTime = Date.now();
        this.simulationResults = this.compileResults(tickCount, endTime - startTime);
        return this.simulationResults;
    }

    /**
     * Queue an instruction for processing
     * @param {Object} instruction - Instruction object
     */
    queueInstruction(instruction) {
        this.instructionQueue.push(instruction);
    }

    /**
     * Process pending instructions from the queue
     * @private
     */
    async processInstructions() {
        while (this.currentInstructionIndex < this.instructionQueue.length) {
            const instruction = this.instructionQueue[this.currentInstructionIndex];

            // Check if instruction should execute now
            if (!this.shouldExecuteInstruction(instruction)) {
                break;
            }

            await this.executeInstruction(instruction);
            this.currentInstructionIndex++;
        }
    }

    /**
     * Check if an instruction should execute at the current game state
     * @param {Object} instruction - Instruction to check
     * @returns {boolean}
     * @private
     */
    shouldExecuteInstruction(instruction) {
        const game = this.gameInstance;
        const state = game.state;

        switch (instruction.trigger) {
            case 'immediate':
                return true;

            case 'tick':
                return game.tickCount >= instruction.tick;

            case 'phase':
                return state.phase === instruction.phase;

            case 'round':
                return state.round >= instruction.round;

            case 'time':
                return state.now >= instruction.time;

            default:
                return true;
        }
    }

    /**
     * Execute a single instruction
     * @param {Object} instruction - Instruction to execute
     * @private
     */
    async executeInstruction(instruction) {
        const game = this.gameInstance;

        switch (instruction.type) {
            case 'PLACE_UNIT':
                await this.handlePlaceUnit(instruction);
                break;

            case 'START_BATTLE':
                await this.handleStartBattle(instruction);
                break;

            case 'SKIP_PLACEMENT':
                await this.handleSkipPlacement(instruction);
                break;

            case 'SUBMIT_PLACEMENT':
                await this.handleSubmitPlacement(instruction);
                break;

            case 'SET_CONFIG':
                this.handleSetConfig(instruction);
                break;

            case 'START_SKIRMISH':
                await this.handleStartSkirmish(instruction);
                break;

            case 'WAIT':
                // No-op, just advances time
                break;

            case 'END_SIMULATION':
                this.running = false;
                break;

            case 'CALL_SERVICE':
                if (game.hasService(instruction.service)) {
                    game.call(instruction.service, ...instruction.args);
                }
                break;

            default:
                console.warn(`[HeadlessEngine] Unknown instruction type: ${instruction.type}`);
        }
    }

    /**
     * Handle PLACE_UNIT instruction
     * @private
     */
    async handlePlaceUnit(instruction) {
        const { unitType, team, x, y, options = {} } = instruction;
        const game = this.gameInstance;

        if (game.hasService('placeUnit')) {
            game.call('placeUnit', {
                unitType,
                team,
                position: { x, y },
                ...options
            });
        }
    }

    /**
     * Handle START_BATTLE instruction
     * @private
     */
    async handleStartBattle(instruction) {
        const game = this.gameInstance;
        const enums = game.call('getEnums');

        if (game.hasService('startBattle')) {
            game.call('startBattle');
        } else {
            // Fallback: directly set phase
            game.state.phase = enums.gamePhase.battle;
        }
    }

    /**
     * Handle SKIP_PLACEMENT instruction - auto-place units for both teams
     * @private
     */
    async handleSkipPlacement(instruction) {
        const game = this.gameInstance;
        const enums = game.call('getEnums');

        // Generate AI placement for both teams
        if (game.hasService('generateAIPlacement')) {
            game.call('generateAIPlacement', enums.team.left);
            game.call('generateAIPlacement', enums.team.right);
        }

        // Submit placements
        if (game.hasService('submitPlacement')) {
            game.call('submitPlacement', enums.team.left);
            game.call('submitPlacement', enums.team.right);
        }
    }

    /**
     * Handle SUBMIT_PLACEMENT instruction
     * @private
     */
    async handleSubmitPlacement(instruction) {
        const { team } = instruction;
        const game = this.gameInstance;

        if (game.hasService('handleSubmitPlacement')) {
            game.call('handleSubmitPlacement', { team }, () => {});
        }
    }

    /**
     * Handle SET_CONFIG instruction
     * @private
     */
    handleSetConfig(instruction) {
        const { key, value } = instruction;
        const game = this.gameInstance;

        if (!game.state.skirmishConfig) {
            game.state.skirmishConfig = {};
        }

        // Support dot notation for nested config
        const keys = key.split('.');
        let target = game.state.skirmishConfig;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) {
                target[keys[i]] = {};
            }
            target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
    }

    /**
     * Handle START_SKIRMISH instruction
     * @private
     */
    async handleStartSkirmish(instruction) {
        const game = this.gameInstance;

        // Set up skirmish config if provided
        if (instruction.config) {
            game.state.skirmishConfig = instruction.config;
        }

        // Call startSkirmishGame if available
        if (game.hasService('startSkirmishGame')) {
            await game.call('startSkirmishGame');
        }
    }

    /**
     * Check if simulation should end
     * @returns {boolean}
     * @private
     */
    shouldEndSimulation() {
        const game = this.gameInstance;
        const state = game.state;

        // End if game is over
        if (state.gameOver || state.victory) {
            return true;
        }

        // End if explicitly stopped
        if (!this.running) {
            return true;
        }

        return false;
    }

    /**
     * Execute a single game tick
     * @private
     */
    async tick() {
        if (this.paused) return;

        if (this.gameInstance && this.gameInstance.update) {
            await this.gameInstance.update(this.tickRate);
        }
    }

    /**
     * Compile simulation results
     * @param {number} tickCount - Number of ticks executed
     * @param {number} realTimeMs - Real time elapsed in milliseconds
     * @returns {Object}
     * @private
     */
    compileResults(tickCount, realTimeMs) {
        const game = this.gameInstance;
        const state = game.state;
        const enums = game.call('getEnums');

        // Determine winner
        let winner = null;
        if (state.gameOver || state.victory) {
            // Check team health to determine winner
            const leftHealth = game.hasService('getTeamHealth')
                ? game.call('getTeamHealth', enums.team.left)
                : 0;
            const rightHealth = game.hasService('getTeamHealth')
                ? game.call('getTeamHealth', enums.team.right)
                : 0;

            if (leftHealth > rightHealth) {
                winner = 'left';
            } else if (rightHealth > leftHealth) {
                winner = 'right';
            } else {
                winner = 'draw';
            }
        }

        // Gather entity counts
        const entities = game.getAllEntities();
        const entityCounts = {
            total: entities.length,
            byTeam: {}
        };

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp) {
                const teamName = game.getReverseEnums().team[teamComp.team] || 'unknown';
                entityCounts.byTeam[teamName] = (entityCounts.byTeam[teamName] || 0) + 1;
            }
        }

        return {
            completed: true,
            tickCount,
            realTimeMs,
            ticksPerSecond: tickCount / (realTimeMs / 1000),
            gameTime: state.now,
            round: state.round,
            phase: game.getReverseEnums().gamePhase?.[state.phase] || state.phase,
            winner,
            gameOver: state.gameOver,
            victory: state.victory,
            entityCounts,
            seed: state.gameSeed
        };
    }

    /**
     * Get current game state snapshot
     * @returns {Object}
     */
    getStateSnapshot() {
        const game = this.gameInstance;
        return {
            tickCount: game.tickCount,
            time: game.state.now,
            round: game.state.round,
            phase: game.state.phase,
            gold: {
                left: game.state.gold,
                right: game.state.opponentGold
            },
            entityCount: game.getEntityCount()
        };
    }

    /**
     * Stop the simulation
     */
    stop() {
        super.stop();
        this.running = false;
    }

    /**
     * Pause the simulation
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume the simulation
     */
    resume() {
        this.paused = false;
    }

    getCurrentTime() {
        // Use process.hrtime for high precision on server
        const [seconds, nanoseconds] = process.hrtime();
        return seconds * 1000 + nanoseconds / 1000000;
    }
}

// Export for ES modules
export { HeadlessEngine };
