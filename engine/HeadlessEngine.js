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
        this._actions = null;
    }

    /**
     * Get GameActionsInterface instance (lazy-loaded)
     * Uses the SAME interface as GUI systems
     */
    getActions(game) {
        if (!this._actions && global.GUTS?.GameActionsInterface) {
            this._actions = new global.GUTS.GameActionsInterface(game);
        }
        return this._actions;
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

        // Process instructions that should execute on this tick
        const processReadyInstructions = async () => {
            while (instructionIndex < instructions.length) {
                const inst = instructions[instructionIndex];

                // Check trigger condition
                if (!this.shouldExecuteInstruction(inst, game, enums)) {
                    break;
                }

                // Execute the instruction
                console.log(`[HeadlessEngine] Executing instruction ${instructionIndex}: ${inst.type}`, inst);
                const result = await this.executeInstruction(inst, game, enums);
                console.log(`[HeadlessEngine] Instruction result:`, result);
                results.push({ instruction: inst, result, tick: game.tickCount });
                instructionIndex++;
            }
        };

        // Custom simulation loop that properly awaits instruction processing
        this.running = true;
        this.paused = false;
        let tickCount = 0;

        while (this.running && tickCount < maxTicks) {
            // Process any ready instructions BEFORE the tick (properly awaited)
            await processReadyInstructions();

            // Run one game tick
            if (!this.paused && game?.update) {
                await game.update(this.tickRate);
            }
            tickCount++;

            // Check stop conditions
            if (game.state.gameOver) {
                break;
            }

            // Continue until game ends naturally when all instructions processed
            if (instructionIndex >= instructions.length && game.state.gameOver) {
                break;
            }
        }

        this.running = false;

        // Return simulation results with all expected fields
        const gameSummary = game.getGameSummary?.() || {};
        const reverseEnums = game.getReverseEnums?.() || {};

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

        return {
            success: true,
            completed: game.state.gameOver || false,
            tickCount: game.tickCount || 0,
            gameTime: game.state.now || 0,
            realTimeMs: 0, // Not tracked in headless mode
            ticksPerSecond: 0,
            round: game.state.round || 1,
            phase: reverseEnums.gamePhase?.[game.state.phase] || game.state.phase,
            winner,
            entityCounts,
            instructionsProcessed: instructionIndex,
            instructionResults: results,
            gameState: gameSummary
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
        // Use GameActionsInterface - SAME code path as GUI systems
        const actions = this.getActions(game);

        switch (inst.type) {
            case 'PLACE_UNIT':
                // Use GameActionsInterface for placement - same as GUI
                {
                    const collections = game.getCollections();
                    const unitDef = collections.units[inst.unitId];
                    if (!unitDef) {
                        return { success: false, error: `Unit ${inst.unitId} not found` };
                    }

                    const unitType = { ...unitDef, id: inst.unitId, collection: 'units' };
                    const team = typeof inst.team === 'string' ? enums.team[inst.team] : inst.team;
                    const playerId = team === enums.team.left ? 0 : 1;
                    const networkUnitData = actions.createNetworkUnitData(
                        { x: inst.x, z: inst.z },
                        unitType,
                        team,
                        playerId
                    );

                    return new Promise(resolve => {
                        actions.sendPlacementRequest(networkUnitData, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }

            case 'PLACE_BUILDING':
                // Use GameActionsInterface for placement - same as GUI
                {
                    const collections = game.getCollections();
                    const buildingDef = collections.buildings[inst.buildingId];
                    if (!buildingDef) {
                        return { success: false, error: `Building ${inst.buildingId} not found` };
                    }

                    const buildingType = { ...buildingDef, id: inst.buildingId, collection: 'buildings' };
                    const team = typeof inst.team === 'string' ? enums.team[inst.team] : inst.team;
                    const playerId = team === enums.team.left ? 0 : 1;
                    const networkUnitData = actions.createNetworkUnitData(
                        { x: inst.x, z: inst.z },
                        buildingType,
                        team,
                        playerId
                    );

                    return new Promise(resolve => {
                        actions.sendPlacementRequest(networkUnitData, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }

            case 'SUBMIT_PLACEMENT':
                // Toggle ready for battle - uses GameActionsInterface
                return new Promise(resolve => {
                    actions.toggleReadyForBattle((success, response) => {
                        resolve({ success: success !== false, ...response });
                    });
                });

            case 'START_BATTLE':
                // Force start battle - uses GameActionsInterface
                actions.startBattle();
                return { success: true };

            case 'PURCHASE_UNIT':
                // Purchase a unit from a building (respects production capacity)
                // Uses GameActionsInterface.purchaseUnit - SAME code path as GUI
                {
                    // Auto-resolve building entity ID if using "auto:" prefix
                    // Format: "auto:buildingType:team" (e.g., "auto:fletchersHall:left")
                    let buildingEntityId = inst.buildingEntityId;
                    const team = typeof inst.team === 'string' ? enums.team[inst.team] : inst.team;

                    if (typeof buildingEntityId === 'string' && buildingEntityId.startsWith('auto:')) {
                        buildingEntityId = this.findBuildingEntityId(game, buildingEntityId, team, enums);
                        if (!buildingEntityId) {
                            return { success: false, error: `Could not find building for ${inst.buildingEntityId}` };
                        }
                    }

                    return new Promise(resolve => {
                        actions.purchaseUnit(inst.unitId, buildingEntityId, team, (success, response) => {
                            resolve({ success, ...response });
                        });
                    });
                }

            case 'WAIT':
                // Wait instruction - trigger determines when to proceed
                return { success: true, waited: true };

            case undefined:
                // Skip comment entries (instructions with only _comment field)
                if (inst._comment) {
                    return { success: true, skipped: true, reason: 'comment' };
                }
                return { success: false, error: 'Instruction missing type field' };

            default:
                return { success: false, error: `Unknown instruction type: ${inst.type}` };
        }
    }

    /**
     * Find a building entity ID by auto-specifier
     * Format: "auto:buildingType:team" (e.g., "auto:fletchersHall:left")
     * @private
     */
    findBuildingEntityId(game, autoSpec, fallbackTeam, enums) {
        const parts = autoSpec.split(':');
        if (parts.length < 2) return null;

        const buildingType = parts[1];
        const teamName = parts[2] || (fallbackTeam === enums.team.left ? 'left' : 'right');
        const targetTeam = enums.team[teamName] ?? fallbackTeam;

        // Find all buildings of this type for this team
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const teamComp = game.getComponent(entityId, 'team');
            const placement = game.getComponent(entityId, 'placement');

            if (!unitTypeComp || !teamComp) continue;

            // Check team matches
            if (teamComp.team !== targetTeam) continue;

            // Check building type matches
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);
            if (!unitDef || unitDef.id !== buildingType) continue;

            // Check building is complete (not under construction)
            if (placement?.isUnderConstruction) continue;

            return entityId;
        }

        return null;
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
