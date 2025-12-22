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

        // Set up RNG
        if (game.rng) {
            game.rng.seed(this.config.seed);
        }

        // Set local game mode
        game.state.isLocalGame = true;
        game.state.localPlayerId = 0;

        // Set level
        const levelIndex = enums.levels?.[this.config.level] ?? 0;
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
        console.log('[HeadlessSkirmishRunner] Setup complete');
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
     * Place a unit programmatically
     * @param {string} team - Team name ('left' or 'right')
     * @param {string} unitType - Unit type name
     * @param {number} x - Grid X position
     * @param {number} y - Grid Y position
     * @param {Object} options - Additional options
     * @returns {number|null} Entity ID or null if failed
     */
    placeUnit(team, unitType, x, y, options = {}) {
        const enums = this.game.call('getEnums');
        const teamEnum = typeof team === 'string' ? enums.team[team] : team;

        if (this.game.hasService('placeUnit')) {
            return this.game.call('placeUnit', {
                unitType,
                team: teamEnum,
                position: { x, y },
                ...options
            });
        }

        return null;
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
     * @returns {Array}
     */
    getEventLog() {
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
