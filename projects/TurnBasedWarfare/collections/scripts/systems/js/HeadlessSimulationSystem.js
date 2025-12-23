/**
 * HeadlessSimulationSystem - Game system for running headless simulations
 *
 * This system extends BaseSystem so it can:
 * 1. Receive game events through triggerEvent (e.g., onUnitKilled)
 * 2. Execute simulation instructions using game.call() services
 * 3. Track event triggers for WAIT instructions
 *
 * The HeadlessEngine just runs the tick loop - all game-specific logic is here.
 */

/**
 * Instruction schema definitions for validation
 * Each instruction type has required and optional fields
 */
const INSTRUCTION_SCHEMAS = {
    PLACE_UNIT: {
        required: ['unitId', 'x', 'z'],
        optional: ['team'],
        description: 'Place a unit at grid position'
    },
    PLACE_BUILDING: {
        required: ['buildingId'],
        optional: ['team', 'x', 'z'],
        description: 'Place a building (x/z can be "auto" for automatic placement)'
    },
    SUBMIT_PLACEMENT: {
        required: [],
        optional: ['team'],
        description: 'Submit placement and mark team as ready'
    },
    START_BATTLE: {
        required: [],
        optional: [],
        description: 'Start the battle phase'
    },
    PURCHASE_UNIT: {
        required: ['unitId'],
        optional: ['team', 'buildingEntityId'],
        description: 'Purchase a unit from a building'
    },
    MOVE_ORDER: {
        required: [],
        optional: ['team', 'target', 'x', 'z', 'unitId'],
        description: 'Issue move order (target can be "center" or "enemy", or use x/z coordinates). Use unitId to filter to specific unit types.'
    },
    WAIT: {
        required: [],
        optional: ['trigger', 'tick', 'phase', 'round', 'event'],
        description: 'Wait for a condition before continuing'
    },
    SKIP_PLACEMENT: {
        required: [],
        optional: [],
        description: 'Skip placement phase and use AI to place units for both teams'
    },
    END_SIMULATION: {
        required: [],
        optional: [],
        description: 'End the simulation early'
    },
    CALL_SERVICE: {
        required: ['service'],
        optional: ['args'],
        description: 'Call a game service directly'
    }
};

/**
 * Valid trigger types for instructions
 */
const VALID_TRIGGERS = ['immediate', 'tick', 'phase', 'round', 'event'];

class HeadlessSimulationSystem extends GUTS.BaseSystem {
    static services = [
        'runSimulation',
        'executeInstruction',
        'validateInstruction',
        'getInstructionSchemas'
    ];

    constructor(game) {
        super(game);
        this.game.headlessSimulationSystem = this;

        // Initialize logger
        this._log = global.GUTS?.HeadlessLogger?.createLogger('HeadlessSimulation') || {
            error: (...args) => console.error('[HeadlessSimulation]', ...args),
            warn: (...args) => console.warn('[HeadlessSimulation]', ...args),
            info: (...args) => console.log('[HeadlessSimulation]', ...args),
            debug: (...args) => console.log('[HeadlessSimulation]', ...args),
            trace: () => {}
        };

        // Initialize instruction executor (required module)
        if (!global.GUTS?.InstructionExecutor) {
            throw new Error('InstructionExecutor library must be loaded before HeadlessSimulationSystem');
        }
        this._executor = new global.GUTS.InstructionExecutor(game, this._log);

        // Simulation state
        this._instructions = [];
        this._instructionIndex = 0;
        this._results = [];
        this._simulationComplete = false;
        this._validationErrors = [];

        // Event trigger tracking
        this._pendingEventTrigger = null;
        this._eventTriggered = false;
        this._eventData = null;

        // Unit statistics tracking
        this._unitDeaths = [];
    }

    /**
     * Get instruction schemas for documentation/validation
     * @returns {Object} Schema definitions
     */
    getInstructionSchemas() {
        return INSTRUCTION_SCHEMAS;
    }

    /**
     * Validate a single instruction against its schema
     * @param {Object} instruction - Instruction to validate
     * @param {number} index - Index in instruction array (for error messages)
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validateInstruction(instruction, index = 0) {
        const errors = [];

        // Allow comment-only instructions
        if (instruction._comment && !instruction.type) {
            return { valid: true, errors: [] };
        }

        // Check for type field
        if (!instruction.type) {
            errors.push(`Instruction ${index}: Missing required 'type' field`);
            return { valid: false, errors };
        }

        // Check if type is known
        const schema = INSTRUCTION_SCHEMAS[instruction.type];
        if (!schema) {
            errors.push(`Instruction ${index}: Unknown instruction type '${instruction.type}'. Valid types: ${Object.keys(INSTRUCTION_SCHEMAS).join(', ')}`);
            return { valid: false, errors };
        }

        // Check required fields
        for (const field of schema.required) {
            if (!(field in instruction)) {
                errors.push(`Instruction ${index} (${instruction.type}): Missing required field '${field}'`);
            }
        }

        // Validate trigger if present
        if (instruction.trigger && !VALID_TRIGGERS.includes(instruction.trigger)) {
            errors.push(`Instruction ${index} (${instruction.type}): Invalid trigger '${instruction.trigger}'. Valid triggers: ${VALID_TRIGGERS.join(', ')}`);
        }

        // Type-specific validation
        switch (instruction.type) {
            case 'MOVE_ORDER':
                if (!instruction.target && instruction.x === undefined && instruction.z === undefined) {
                    errors.push(`Instruction ${index} (MOVE_ORDER): Must specify either 'target' ("center"/"enemy") or 'x'/'z' coordinates`);
                }
                if (instruction.target && !['center', 'enemy'].includes(instruction.target)) {
                    errors.push(`Instruction ${index} (MOVE_ORDER): Invalid target '${instruction.target}'. Valid targets: center, enemy`);
                }
                break;

            case 'WAIT':
                if (instruction.trigger === 'tick' && instruction.tick === undefined) {
                    errors.push(`Instruction ${index} (WAIT): Trigger 'tick' requires 'tick' field`);
                }
                if (instruction.trigger === 'phase' && instruction.phase === undefined) {
                    errors.push(`Instruction ${index} (WAIT): Trigger 'phase' requires 'phase' field`);
                }
                if (instruction.trigger === 'round' && instruction.round === undefined) {
                    errors.push(`Instruction ${index} (WAIT): Trigger 'round' requires 'round' field`);
                }
                if (instruction.trigger === 'event' && instruction.event === undefined) {
                    errors.push(`Instruction ${index} (WAIT): Trigger 'event' requires 'event' field`);
                }
                break;
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Validate all instructions before execution
     * @param {Array} instructions - Array of instructions
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validateInstructions(instructions) {
        const allErrors = [];

        if (!Array.isArray(instructions)) {
            return { valid: false, errors: ['Instructions must be an array'] };
        }

        for (let i = 0; i < instructions.length; i++) {
            const result = this.validateInstruction(instructions[i], i);
            if (!result.valid) {
                allErrors.push(...result.errors);
            }
        }

        return { valid: allErrors.length === 0, errors: allErrors };
    }

    /**
     * Set up a simulation with instructions
     * Called by HeadlessSkirmishRunner before starting the tick loop
     * @param {Array} instructions - Instructions to execute
     * @param {Object} options - Setup options
     * @param {boolean} options.skipValidation - Skip instruction validation (default: false)
     * @throws {Error} If validation fails and skipValidation is false
     */
    setupSimulation(instructions, options = {}) {
        const { skipValidation = false } = options;

        // Validate instructions unless explicitly skipped
        if (!skipValidation) {
            const validation = this.validateInstructions(instructions);
            if (!validation.valid) {
                this._validationErrors = validation.errors;
                this._log.error('Instruction validation failed:');
                for (const error of validation.errors) {
                    this._log.error(`  - ${error}`);
                }
                throw new Error(`Instruction validation failed: ${validation.errors.join('; ')}`);
            }
        }

        this._instructions = instructions;
        this._instructionIndex = 0;
        this._results = [];
        this._simulationComplete = false;
        this._validationErrors = [];
        this._pendingEventTrigger = null;
        this._eventTriggered = false;
        this._eventData = null;
        this._unitDeaths = [];

        this._log.info(`Setup complete with ${instructions.length} instructions`);
    }

    /**
     * Process instructions that are ready to execute
     * Called each tick by the game's update loop
     */
    async processInstructions() {
        while (this._instructionIndex < this._instructions.length) {
            const inst = this._instructions[this._instructionIndex];

            // Check trigger condition
            if (!this._shouldExecuteInstruction(inst)) {
                break;
            }

            // Execute the instruction
            this._log.debug(`Executing instruction ${this._instructionIndex}: ${inst.type}`, inst);
            const result = await this.executeInstruction(inst);
            this._log.debug('Instruction result:', result);
            this._results.push({ instruction: inst, result, tick: this.game.tickCount });
            this._instructionIndex++;
        }

        // Check if simulation is complete
        if (this._instructionIndex >= this._instructions.length) {
            this._simulationComplete = true;
        }
    }

    /**
     * Check if simulation is complete
     */
    isSimulationComplete() {
        return this._simulationComplete || this.game.state.gameOver;
    }

    /**
     * Get simulation results
     */
    getResults() {
        return {
            instructionsProcessed: this._instructionIndex,
            instructionResults: this._results,
            validationErrors: this._validationErrors
        };
    }

    /**
     * Check if an instruction should execute on this tick
     * @private
     */
    _shouldExecuteInstruction(inst) {
        const trigger = inst.trigger || 'immediate';

        switch (trigger) {
            case 'immediate':
                return true;

            case 'tick':
                return this.game.tickCount >= (inst.tick || 0);

            case 'phase':
                return this.game.state.phase === inst.phase;

            case 'round':
                return this.game.state.round >= (inst.round || 1);

            case 'event':
                // Check if event was triggered
                if (this._pendingEventTrigger === inst.event && this._eventTriggered) {
                    // Event occurred, clear and proceed
                    this._pendingEventTrigger = null;
                    this._eventTriggered = false;
                    this._eventData = null;
                    return true;
                }
                // Set up event wait if not already waiting
                if (this._pendingEventTrigger !== inst.event) {
                    this._pendingEventTrigger = inst.event;
                    this._eventTriggered = false;
                    this._log.debug(`Waiting for event: ${inst.event}`);
                }
                return false;

            default:
                return true;
        }
    }

    /**
     * Execute a single instruction
     * Delegates to InstructionExecutor for actual execution.
     * Uses game.call() - SAME code path as GUI systems via GameInterfaceSystem
     */
    async executeInstruction(inst) {
        const result = await this._executor.execute(inst);

        // Handle END_SIMULATION flag on the system
        if (inst.type === 'END_SIMULATION' && result.ended) {
            this._simulationComplete = true;
        }

        return result;
    }

    // ==================== EVENT HANDLERS ====================
    // These receive events via game.triggerEvent()

    onUnitKilled(entityId) {
        this._log.debug('onUnitKilled received:', { entityId });
        this._checkEventTrigger('onUnitKilled', { entityId });

        // Track unit death statistics
        this._trackUnitDeath(entityId);
    }

    /**
     * Track a unit death with statistics
     * @private
     */
    _trackUnitDeath(entityId) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const teamComp = this.game.getComponent(entityId, 'team');
        const transform = this.game.getComponent(entityId, 'transform');

        if (!unitTypeComp || !teamComp) return;

        const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
        const reverseEnums = this.game.getReverseEnums();

        this._unitDeaths.push({
            entityId,
            unitType: unitDef?.id || 'unknown',
            unitName: unitDef?.name || unitDef?.id || 'Unknown',
            team: reverseEnums.team?.[teamComp.team] || teamComp.team,
            tick: this.game.tickCount,
            time: this.game.state.now,
            round: this.game.state.round,
            position: transform?.position ? {
                x: Math.round(transform.position.x),
                z: Math.round(transform.position.z)
            } : null
        });
    }

    /**
     * Get statistics about living units
     * @returns {Array} Array of living unit records with stats
     */
    getLivingUnitsWithStats() {
        const reverseEnums = this.game.getReverseEnums();
        const livingUnits = [];

        const entities = this.game.getEntitiesWith('unitType', 'team', 'health');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const teamComp = this.game.getComponent(entityId, 'team');
            const health = this.game.getComponent(entityId, 'health');
            const transform = this.game.getComponent(entityId, 'transform');
            const deathState = this.game.getComponent(entityId, 'deathState');

            // Skip dead/dying units
            if (deathState && deathState.state !== this.enums.deathState.alive) continue;
            if (health && health.current <= 0) continue;

            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            livingUnits.push({
                entityId,
                unitType: unitDef?.id || 'unknown',
                unitName: unitDef?.name || unitDef?.id || 'Unknown',
                team: reverseEnums.team?.[teamComp.team] || teamComp.team,
                health: {
                    current: health?.current || 0,
                    max: health?.max || 0
                },
                position: transform?.position ? {
                    x: Math.round(transform.position.x),
                    z: Math.round(transform.position.z)
                } : null
            });
        }

        return livingUnits;
    }

    /**
     * Get unit statistics summary
     * @returns {Object} { livingUnits: Array, deadUnits: Array }
     */
    getUnitStatistics() {
        return {
            livingUnits: this.getLivingUnitsWithStats(),
            deadUnits: this._unitDeaths
        };
    }

    onUnitDeath(data) {
        this._checkEventTrigger('onUnitDeath', data);
    }

    onBattleStart() {
        this._log.debug('Battle started', {
            phase: this.game.state.phase,
            round: this.game.state.round
        });
        this._checkEventTrigger('onBattleStart', {});
    }

    onBattleEnd(data) {
        this._log.debug('Battle ended', data);
        this._checkEventTrigger('onBattleEnd', data);
    }

    onRoundEnd(data) {
        this._log.debug('Round ended', data);
        this._checkEventTrigger('onRoundEnd', data);
    }

    onPhaseChange(phase) {
        const phaseName = this.game.call('getReverseEnums')?.gamePhase?.[phase] || phase;
        this._log.debug(`Phase change: ${phaseName}`);
        this._checkEventTrigger('onPhaseChange', { phase });
    }

    /**
     * Log comprehensive state of all units for debugging
     * @private
     */
    _logUnitsState() {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'health');
        this._log.trace(`Found ${entities.length} units with health:`);

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
            const team = this.game.getComponent(entityId, 'team');
            const health = this.game.getComponent(entityId, 'health');
            const transform = this.game.getComponent(entityId, 'transform');
            const aiState = this.game.getComponent(entityId, 'aiState');
            const deathState = this.game.getComponent(entityId, 'deathState');
            const playerOrder = this.game.getComponent(entityId, 'playerOrder');
            const combat = this.game.getComponent(entityId, 'combat');

            const teamName = this.game.call('getReverseEnums')?.team?.[team?.team] || team?.team;
            const pos = transform?.position;

            this._log.trace(`Entity ${entityId}: ${unitDef?.id || 'unknown'} (${teamName})`, {
                position: pos ? { x: pos.x?.toFixed(1), z: pos.z?.toFixed(1) } : null,
                health: health ? `${health.current}/${health.max}` : null,
                aiState: aiState ? {
                    rootBehaviorTree: aiState.rootBehaviorTree,
                    targetPosition: aiState.targetPosition
                } : null,
                playerOrder: playerOrder ? {
                    target: { x: playerOrder.targetPositionX, z: playerOrder.targetPositionZ },
                    isMoveOrder: playerOrder.isMoveOrder,
                    enabled: playerOrder.enabled
                } : null,
                combat: combat ? { range: combat.range, damage: combat.damage, attackSpeed: combat.attackSpeed } : null,
                deathState: deathState?.state
            });
        }
    }

    onGameOver(data) {
        this._checkEventTrigger('onGameOver', data);
    }

    /**
     * Check if this event matches the pending trigger
     * @private
     */
    _checkEventTrigger(eventName, data) {
        if (this._pendingEventTrigger === eventName) {
            this._eventTriggered = true;
            this._eventData = data;
            this._log.debug(`Event triggered: ${eventName}`, data);
        }
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessSimulationSystem = HeadlessSimulationSystem;
}

// ES6 exports for webpack bundling
export default HeadlessSimulationSystem;
export { HeadlessSimulationSystem };
