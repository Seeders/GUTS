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
    }

    async init(projectName) {
        this.projectName = projectName;
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

        const config = this.collections.configs.headless || this.collections.configs.server;

        // Create game instance
        const appLibrary = config.appLibrary || 'HeadlessECSGame';
        this.gameInstance = new global.GUTS[appLibrary](this);

        // Use loader
        const loaderLibrary = config.appLoaderLibrary || 'HeadlessGameLoader';
        this.loader = new global.GUTS[loaderLibrary](this.gameInstance);
        await this.loader.load();

        console.log('[HeadlessEngine] Initialized');
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
     * @param {Object} options
     * @param {Array} options.instructions - Array of instruction objects to process
     * @param {number} options.maxTicks - Maximum ticks before timeout
     * @param {number} options.seed - Random seed (already applied during setup)
     * @returns {Promise<Object>} Simulation results
     */
    async runSimulation(options = {}) {
        const {
            instructions = [],
            maxTicks = this.maxTicks
        } = options;

        const game = this.gameInstance;
        const enums = game.call('getEnums');
        let instructionIndex = 0;
        const results = [];

        // Process instructions that should execute immediately
        const processImmediateInstructions = async () => {
            while (instructionIndex < instructions.length) {
                const inst = instructions[instructionIndex];

                // Check trigger condition
                if (!this.shouldExecuteInstruction(inst, game, enums)) {
                    break;
                }

                // Execute the instruction
                const result = await this.executeInstruction(inst, game, enums);
                results.push({ instruction: inst, result, tick: game.tickCount });
                instructionIndex++;
            }
        };

        // Run simulation with instruction processing
        await this.run({
            maxTicks,
            shouldStop: (game) => {
                // Process any ready instructions before checking stop condition
                processImmediateInstructions();

                // Stop if game is over
                if (game.state.gameOver) {
                    return true;
                }

                // Stop if all instructions processed and we're past battle phase
                if (instructionIndex >= instructions.length) {
                    // Continue running until game ends naturally or timeout
                    return game.state.gameOver;
                }

                return false;
            }
        });

        // Return simulation results
        return {
            success: true,
            tickCount: game.tickCount,
            instructionsProcessed: instructionIndex,
            results,
            gameState: game.getGameSummary?.() || { phase: game.state.phase }
        };
    }

    /**
     * Check if an instruction should execute on this tick
     * @private
     */
    shouldExecuteInstruction(inst, game, enums) {
        const trigger = inst.trigger || 'immediate';

        switch (trigger) {
            case 'immediate':
                return true;

            case 'tick':
                return game.tickCount >= (inst.tick || 0);

            case 'phase':
                return game.state.phase === inst.phase;

            case 'round':
                return game.state.round >= (inst.round || 1);

            default:
                return true;
        }
    }

    /**
     * Execute a single instruction
     * @private
     */
    async executeInstruction(inst, game, enums) {
        switch (inst.type) {
            case 'PLACE_UNIT':
                // Delegate to game's placement system
                if (game.hasService('sendPlacementRequest')) {
                    const collections = game.getCollections();
                    const unitDef = collections.units[inst.unitId];
                    if (!unitDef) {
                        return { success: false, error: `Unit ${inst.unitId} not found` };
                    }

                    const unitType = { ...unitDef, id: inst.unitId, collection: 'units' };
                    const playerId = inst.team === enums.team.left ? 0 : 1;
                    const networkUnitData = game.call('createNetworkUnitData',
                        { x: inst.x, z: inst.z },
                        unitType,
                        inst.team,
                        playerId
                    );

                    return new Promise(resolve => {
                        game.call('sendPlacementRequest', networkUnitData, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }
                return { success: false, error: 'sendPlacementRequest service not available' };

            case 'PLACE_BUILDING':
                // Similar to PLACE_UNIT but for buildings
                if (game.hasService('sendPlacementRequest')) {
                    const collections = game.getCollections();
                    const buildingDef = collections.buildings[inst.buildingId];
                    if (!buildingDef) {
                        return { success: false, error: `Building ${inst.buildingId} not found` };
                    }

                    const buildingType = { ...buildingDef, id: inst.buildingId, collection: 'buildings' };
                    const playerId = inst.team === enums.team.left ? 0 : 1;
                    const networkUnitData = game.call('createNetworkUnitData',
                        { x: inst.x, z: inst.z },
                        buildingType,
                        inst.team,
                        playerId
                    );

                    return new Promise(resolve => {
                        game.call('sendPlacementRequest', networkUnitData, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }
                return { success: false, error: 'sendPlacementRequest service not available' };

            case 'SUBMIT_PLACEMENT':
                // Toggle ready for a team
                if (game.hasService('toggleReadyForBattle')) {
                    game.call('toggleReadyForBattle', () => {});
                    return { success: true };
                }
                return { success: false, error: 'toggleReadyForBattle not available' };

            case 'START_BATTLE':
                // Force start battle
                if (game.hasService('startBattle')) {
                    game.call('startBattle');
                    return { success: true };
                }
                game.state.phase = enums.gamePhase.battle;
                return { success: true };

            case 'PURCHASE_UNIT':
                // Purchase a unit from a building (respects production capacity)
                // This uses GameActionsInterface.purchaseUnit - same as GUI
                if (global.GUTS?.GameActionsInterface) {
                    const actions = new global.GUTS.GameActionsInterface(game);
                    return new Promise(resolve => {
                        actions.purchaseUnit(inst.unitId, inst.buildingEntityId, inst.team, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }
                return { success: false, error: 'GameActionsInterface not available' };

            case 'WAIT':
                // Wait instruction - trigger determines when to proceed
                return { success: true, waited: true };

            default:
                return { success: false, error: `Unknown instruction type: ${inst.type}` };
        }
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
