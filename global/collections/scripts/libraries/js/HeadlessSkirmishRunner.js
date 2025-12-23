/**
 * HeadlessSkirmishRunner - High-level API for running headless skirmish simulations
 *
 * This class provides a convenient interface for:
 * - Setting up skirmish games with custom configurations
 * - Running simulations with instruction sequences
 * - Collecting and analyzing results
 *
 * Usage:
 *   const runner = new HeadlessSkirmishRunner(engine);
 *   await runner.setup({
 *     level: 'level_1',
 *     startingGold: 100,
 *     seed: 12345
 *   });
 *
 *   const results = await runner.runWithInstructions([
 *     { type: 'PLACE_UNIT', team: 'left', unitType: 'soldier', x: 5, y: 5 },
 *     { type: 'PLACE_UNIT', team: 'right', unitType: 'archer', x: 10, y: 5 },
 *     { type: 'START_BATTLE' }
 *   ]);
 */
class HeadlessSkirmishRunner {
    constructor(engine) {
        this.engine = engine;
        this.game = engine.gameInstance;
        this.config = null;
        this.isSetup = false;

        // Initialize logger
        this._log = global.GUTS?.HeadlessLogger?.createLogger('SkirmishRunner') || {
            error: (...args) => console.error('[SkirmishRunner]', ...args),
            warn: (...args) => console.warn('[SkirmishRunner]', ...args),
            info: (...args) => console.log('[SkirmishRunner]', ...args),
            debug: (...args) => console.log('[SkirmishRunner]', ...args),
            trace: () => {}
        };
    }

    /**
     * Set up a new skirmish game
     * @param {Object} config - Skirmish configuration
     * @param {string} config.level - Level name (e.g., 'level_1')
     * @param {number} config.startingGold - Starting gold for each team
     * @param {number} config.seed - Random seed for deterministic simulation
     * @param {string} config.leftTeam - Unit composition for left team (optional)
     * @param {string} config.rightTeam - Unit composition for right team (optional)
     * @returns {Promise<void>}
     */
    async setup(config = {}) {
        this.config = {
            level: config.level || 'level_1',
            selectedLevel: config.level || 'level_1',
            startingGold: config.startingGold || 100,
            seed: config.seed || Date.now(),
            selectedTeam: config.selectedTeam || 'left',
            ...config
        };

        const game = this.game;
        const enums = game.call('getEnums');

        // Set up game state
        game.state.skirmishConfig = this.config;
        game.state.gameSeed = this.config.seed;

        // Set up RNG - SeededRandom uses initialSeed property, not a seed() method
        if (game.rng) {
            game.rng.initialSeed = this.config.seed;
            // Clear existing strands so they use the new seed
            game.rng.strands.clear();
        }

        // Set local game mode
        game.state.isLocalGame = true;
        game.state.localPlayerId = 0;

        // Set level
        const levelIndex = enums.levels?.[this.config.level] ?? 0;
        this._log.debug(`Setting level: ${this.config.level} -> index ${levelIndex}`);
        this._log.trace('Available levels:', Object.keys(enums.levels || {}));
        game.state.level = levelIndex;

        // Load the headless scene
        await game.switchScene('headless');

        // Create player entities
        const leftTeam = enums.team.left;
        const rightTeam = enums.team.right;

        if (game.hasService('createPlayerEntity')) {
            game.call('createPlayerEntity', 0, {
                team: leftTeam,
                gold: this.config.startingGold,
                upgrades: []
            });

            game.call('createPlayerEntity', 1, {
                team: rightTeam,
                gold: this.config.startingGold,
                upgrades: []
            });
        }

        // Initialize game
        if (game.hasService('initializeGame')) {
            game.call('initializeGame', null);
        }

        this.isSetup = true;
        this._log.info('Setup complete');
    }

    /**
     * Run simulation with a sequence of instructions
     * @param {Array} instructions - Array of instruction objects
     * @param {Object} options - Simulation options
     * @param {number} options.maxTicks - Maximum ticks before timeout
     * @param {boolean} options.autoStartBattle - Automatically start battle after placements
     * @returns {Promise<Object>} Simulation results
     */
    async runWithInstructions(instructions, options = {}) {
        if (!this.isSetup) {
            throw new Error('Must call setup() before running simulation');
        }

        const {
            maxTicks = 10000,
            autoStartBattle = false
        } = options;

        // Convert team names to enum values in instructions
        const processedInstructions = this.processInstructions(instructions, autoStartBattle);

        // Run the simulation
        return await this.engine.runSimulation({
            instructions: processedInstructions,
            maxTicks,
            seed: this.config.seed
        });
    }

    /**
     * Run a quick simulation with AI-controlled placements
     * @param {Object} options - Simulation options
     * @returns {Promise<Object>} Simulation results
     */
    async runQuickSimulation(options = {}) {
        if (!this.isSetup) {
            throw new Error('Must call setup() before running simulation');
        }

        const enums = this.game.call('getEnums');

        // Generate AI placements for both teams
        if (this.game.hasService('generateAIPlacement')) {
            this.game.call('generateAIPlacement', enums.team.left);
            this.game.call('generateAIPlacement', enums.team.right);
        }

        // Submit placements
        const instructions = [
            { type: 'SUBMIT_PLACEMENT', team: enums.team.left },
            { type: 'SUBMIT_PLACEMENT', team: enums.team.right },
            { type: 'WAIT', trigger: 'phase', phase: enums.gamePhase.battle },
            { type: 'WAIT', trigger: 'tick', tick: this.game.tickCount + 1 }
        ];

        return await this.engine.runSimulation({
            instructions,
            maxTicks: options.maxTicks || 10000,
            seed: this.config.seed
        });
    }

    /**
     * Process instructions to convert team names to enum values
     * @param {Array} instructions - Raw instructions
     * @param {boolean} autoStartBattle - Add START_BATTLE instruction
     * @returns {Array} Processed instructions
     * @private
     */
    processInstructions(instructions, autoStartBattle) {
        const enums = this.game.call('getEnums');
        const processed = [];

        for (const inst of instructions) {
            const processed_inst = { ...inst };

            // Convert team name to enum value
            if (inst.team && typeof inst.team === 'string') {
                processed_inst.team = enums.team[inst.team] ?? inst.team;
            }

            // Convert phase name to enum value
            if (inst.phase && typeof inst.phase === 'string') {
                processed_inst.phase = enums.gamePhase[inst.phase] ?? inst.phase;
            }

            // Set default trigger to immediate if not specified
            if (!processed_inst.trigger) {
                processed_inst.trigger = 'immediate';
            }

            processed.push(processed_inst);
        }

        // Add START_BATTLE if requested and not already present
        if (autoStartBattle && !instructions.some(i => i.type === 'START_BATTLE')) {
            processed.push({ type: 'START_BATTLE', trigger: 'immediate' });
        }

        return processed;
    }

    /**
     * Place a building using ui_placeUnit
     * @param {string} team - Team name ('left' or 'right')
     * @param {string} buildingId - Building type ID (e.g., 'fletchersHall')
     * @param {number} x - Grid X position
     * @param {number} z - Grid Z position
     * @returns {Promise<Object>} Result with success status and placementId
     */
    async placeBuilding(team, buildingId, x, z) {
        const enums = this.game.call('getEnums');
        const collections = this.game.getCollections();
        const teamEnum = typeof team === 'string' ? enums.team[team] : team;

        const buildingDef = collections.buildings[buildingId];
        if (!buildingDef) {
            return { success: false, error: `Building ${buildingId} not found` };
        }

        // Create unit type object with collection info
        const buildingType = { ...buildingDef, id: buildingId, collection: 'buildings' };
        const gridPosition = { x, z };
        const playerId = teamEnum === enums.team.left ? 0 : 1;

        // Use ui_placeUnit - SAME code path as GUI
        return new Promise((resolve) => {
            this.game.call('ui_placeUnit', gridPosition, buildingType, teamEnum, playerId, (success, response) => {
                resolve({ success, ...response });
            });
        });
    }

    /**
     * Purchase a unit from a building using ui_purchaseUnit
     * This uses the FULL game logic including production capacity check
     *
     * @param {string} team - Team name ('left' or 'right')
     * @param {string} unitId - Unit type ID (e.g., '1_d_archer')
     * @param {number} buildingEntityId - Entity ID of the building to spawn from
     * @returns {Promise<Object>} Result with success status
     */
    async placeUnit(team, unitId, buildingEntityId) {
        const enums = this.game.call('getEnums');
        const teamEnum = typeof team === 'string' ? enums.team[team] : team;

        // Use ui_purchaseUnit - SAME code path as GUI
        return new Promise((resolve) => {
            this.game.call('ui_purchaseUnit', unitId, buildingEntityId, teamEnum, (success, response) => {
                resolve({ success, ...response });
            });
        });
    }

    /**
     * Place a unit at a specific grid position (for units that don't need buildings)
     * @param {string} team - Team name ('left' or 'right')
     * @param {string} unitId - Unit type ID
     * @param {number} x - Grid X position
     * @param {number} z - Grid Z position
     * @returns {Promise<Object>} Result with success status
     */
    async placeUnitAt(team, unitId, x, z) {
        const enums = this.game.call('getEnums');
        const collections = this.game.getCollections();
        const teamEnum = typeof team === 'string' ? enums.team[team] : team;

        const unitDef = collections.units[unitId];
        if (!unitDef) {
            return { success: false, error: `Unit ${unitId} not found` };
        }

        // Create unit type object
        const unitType = { ...unitDef, id: unitId, collection: 'units' };
        const gridPosition = { x, z };
        const playerId = teamEnum === enums.team.left ? 0 : 1;

        // Use ui_placeUnit - SAME code path as GUI
        return new Promise((resolve) => {
            this.game.call('ui_placeUnit', gridPosition, unitType, teamEnum, playerId, (success, response) => {
                resolve({ success, ...response });
            });
        });
    }

    /**
     * Start the battle phase
     */
    startBattle() {
        if (this.game.hasService('startBattle')) {
            this.game.call('startBattle');
        } else {
            const enums = this.game.call('getEnums');
            this.game.state.phase = enums.gamePhase.battle;
        }
    }

    /**
     * Toggle ready for battle (triggers battle start when both teams ready)
     */
    toggleReadyForBattle(callback) {
        this.game.call('ui_toggleReadyForBattle', callback);
    }

    /**
     * Issue a move order to squads
     */
    issueMoveOrder(placementIds, targetPosition, callback) {
        this.game.call('ui_issueMoveOrder', placementIds, targetPosition, callback);
    }

    /**
     * Issue hold position order
     */
    holdPosition(placementIds, callback) {
        this.game.call('ui_holdPosition', placementIds, callback);
    }

    // ==================== INPUT SIMULATION ====================

    /**
     * Simulate a left-click at world coordinates
     * Uses the same code path as GUI clicks
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @returns {Promise<Object>} Result { action, success, data }
     */
    async simulateClick(worldX, worldZ, modifiers = {}) {
        return new Promise((resolve) => {
            this.game.call('ui_handleCanvasClick', worldX, worldZ, modifiers, resolve);
        });
    }

    /**
     * Simulate a right-click at world coordinates
     * Uses the same code path as GUI right-clicks
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @returns {Promise<Object>} Result { action, success, data }
     */
    async simulateRightClick(worldX, worldZ, modifiers = {}) {
        return new Promise((resolve) => {
            this.game.call('ui_handleCanvasRightClick', worldX, worldZ, modifiers, resolve);
        });
    }

    /**
     * Simulate a box selection with world coordinates
     * Uses the same code path as GUI box selection
     *
     * @param {number} worldMinX - Minimum X coordinate
     * @param {number} worldMinZ - Minimum Z coordinate
     * @param {number} worldMaxX - Maximum X coordinate
     * @param {number} worldMaxZ - Maximum Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @returns {Promise<Object>} Result { action, success, data: { entityIds, additive } }
     */
    async simulateBoxSelection(worldMinX, worldMinZ, worldMaxX, worldMaxZ, modifiers = {}) {
        return new Promise((resolve) => {
            this.game.call('ui_handleBoxSelection', worldMinX, worldMinZ, worldMaxX, worldMaxZ, modifiers, resolve);
        });
    }

    /**
     * Get entity at a world position
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} options - { radius, teamFilter }
     * @returns {number|null} Entity ID or null
     */
    getEntityAtPosition(worldX, worldZ, options = {}) {
        const clickRadius = options.radius || 50;
        const teamFilter = options.teamFilter;

        let closestEntity = null;
        let closestDistance = clickRadius;

        const entities = this.game.getEntitiesWith('transform', 'unitType');

        for (const entityId of entities) {
            // Apply team filter if specified
            if (teamFilter !== null && teamFilter !== undefined) {
                const team = this.game.getComponent(entityId, 'team');
                const unitTeam = team?.team ?? team?.side ?? team?.teamId;
                if (unitTeam !== teamFilter) continue;
            }

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            const dx = pos.x - worldX;
            const dz = pos.z - worldZ;
            let distance = Math.sqrt(dx * dx + dz * dz);

            // Adjust for unit size
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const size = unitType?.size || 20;
            distance -= size;

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntity = entityId;
            }
        }

        return closestEntity;
    }

    /**
     * Get entities within world bounds
     *
     * @param {number} worldMinX - Minimum X coordinate
     * @param {number} worldMinZ - Minimum Z coordinate
     * @param {number} worldMaxX - Maximum X coordinate
     * @param {number} worldMaxZ - Maximum Z coordinate
     * @param {Object} options - { teamFilter, prioritizeUnits }
     * @returns {Array} Array of entity IDs
     */
    getEntitiesInBounds(worldMinX, worldMinZ, worldMaxX, worldMaxZ, options = {}) {
        const teamFilter = options.teamFilter;
        const prioritizeUnits = options.prioritizeUnits ?? true;

        const selectedUnits = [];
        const selectedBuildings = [];

        const entities = this.game.getEntitiesWith('transform', 'unitType');

        for (const entityId of entities) {
            // Apply team filter if specified
            if (teamFilter !== null && teamFilter !== undefined) {
                const team = this.game.getComponent(entityId, 'team');
                const unitTeam = team?.team ?? team?.side ?? team?.teamId;
                if (unitTeam !== teamFilter) continue;
            }

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            // Check if within bounds
            if (pos.x >= worldMinX && pos.x <= worldMaxX &&
                pos.z >= worldMinZ && pos.z <= worldMaxZ) {

                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
                const collection = unitType?.collection;

                if (prioritizeUnits) {
                    if (collection === 'units') {
                        selectedUnits.push(entityId);
                    } else {
                        selectedBuildings.push(entityId);
                    }
                } else {
                    selectedUnits.push(entityId);
                }
            }
        }

        return prioritizeUnits && selectedUnits.length > 0 ? selectedUnits : selectedUnits.concat(selectedBuildings);
    }

    /**
     * Get placements for a team
     */
    getPlacementsForTeam(team) {
        const enums = this.game.call('getEnums');
        const teamEnum = typeof team === 'string' ? enums.team[team] : team;

        if (this.game.hasService('getPlacementsForSide')) {
            return this.game.call('getPlacementsForSide', teamEnum);
        }
        return [];
    }

    /**
     * Check if a building has finished construction
     */
    isBuildingComplete(placementId) {
        const placement = this.game.hasService('getPlacementById')
            ? this.game.call('getPlacementById', placementId)
            : null;
        if (!placement) return false;

        // Check if building entity has construction complete
        if (placement.squadUnits?.length > 0) {
            const buildingId = placement.squadUnits[0];
            const construction = this.game.getComponent(buildingId, 'construction');
            return !construction || construction.complete;
        }
        return false;
    }

    /**
     * Get current game state summary
     * @returns {Object}
     */
    getState() {
        return this.game.getGameSummary();
    }

    /**
     * Get all units on the battlefield
     * @returns {Array} Array of unit data objects
     */
    getUnits() {
        const units = [];
        const enums = this.game.call('getEnums');
        const reverseEnums = this.game.getReverseEnums();

        const entities = this.game.getEntitiesWith('unitType', 'team', 'transform');

        for (const entityId of entities) {
            const unitType = this.game.getComponent(entityId, 'unitType');
            const team = this.game.getComponent(entityId, 'team');
            const transform = this.game.getComponent(entityId, 'transform');
            const health = this.game.getComponent(entityId, 'health');

            const unitDef = this.game.call('getUnitTypeDef', unitType);

            units.push({
                id: entityId,
                type: unitDef?.id || 'unknown',
                team: reverseEnums.team?.[team.team] || team.team,
                position: {
                    x: transform.position.x,
                    y: transform.position.y
                },
                health: health ? {
                    current: health.current,
                    max: health.max
                } : null
            });
        }

        return units;
    }

    /**
     * Get the event log from the simulation
     * @returns {Array} Event log array
     */
    getEventLog() {
        // Use getEventLogArray for backward compatibility (returns raw array)
        if (this.game.getEventLogArray) {
            return this.game.getEventLogArray();
        }
        // Fallback for older implementations
        const result = this.game.getEventLog();
        return Array.isArray(result) ? result : result.events || [];
    }

    /**
     * Get detailed event log info including overflow stats
     * @returns {Object} { events: Array, overflowCount: number, maxSize: number }
     */
    getEventLogDetails() {
        return this.game.getEventLog();
    }

    /**
     * Reset for a new simulation
     */
    reset() {
        this.isSetup = false;
        this.config = null;

        // Clear event log
        if (this.game.clearEventLog) {
            this.game.clearEventLog();
        }
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessSkirmishRunner = HeadlessSkirmishRunner;
}

// ES6 exports for webpack bundling
export default HeadlessSkirmishRunner;
export { HeadlessSkirmishRunner };
