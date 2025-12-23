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
class HeadlessSimulationSystem extends GUTS.BaseSystem {
    static services = [
        'runSimulation',
        'executeInstruction'
    ];

    constructor(game) {
        super(game);
        this.game.headlessSimulationSystem = this;

        // Simulation state
        this._instructions = [];
        this._instructionIndex = 0;
        this._results = [];
        this._simulationComplete = false;

        // Event trigger tracking
        this._pendingEventTrigger = null;
        this._eventTriggered = false;
        this._eventData = null;
    }

    /**
     * Set up a simulation with instructions
     * Called by HeadlessSkirmishRunner before starting the tick loop
     */
    setupSimulation(instructions) {
        this._instructions = instructions;
        this._instructionIndex = 0;
        this._results = [];
        this._simulationComplete = false;
        this._pendingEventTrigger = null;
        this._eventTriggered = false;
        this._eventData = null;
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
            console.log(`[HeadlessSimulationSystem] Executing instruction ${this._instructionIndex}: ${inst.type}`, inst);
            const result = await this.executeInstruction(inst);
            console.log(`[HeadlessSimulationSystem] Instruction result:`, result);
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
            instructionResults: this._results
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
                    console.log(`[HeadlessSimulationSystem] Waiting for event: ${inst.event}`);
                }
                return false;

            default:
                return true;
        }
    }

    /**
     * Execute a single instruction
     * Uses game.call() - SAME code path as GUI systems via GameInterfaceSystem
     */
    async executeInstruction(inst) {
        switch (inst.type) {
            case 'PLACE_UNIT':
                return this._executePlaceUnit(inst);

            case 'PLACE_BUILDING':
                return this._executePlaceBuilding(inst);

            case 'SUBMIT_PLACEMENT':
                return this._executeSubmitPlacement(inst);

            case 'START_BATTLE':
                this.game.call('startBattle');
                return { success: true };

            case 'PURCHASE_UNIT':
                return this._executePurchaseUnit(inst);

            case 'MOVE_ORDER':
                return this._executeMoveOrder(inst);

            case 'WAIT':
                return { success: true, waited: true };

            case undefined:
                if (inst._comment) {
                    return { success: true, skipped: true, reason: 'comment' };
                }
                return { success: false, error: 'Instruction missing type field' };

            default:
                return { success: false, error: `Unknown instruction type: ${inst.type}` };
        }
    }

    // ==================== INSTRUCTION EXECUTORS ====================

    async _executePlaceUnit(inst) {
        const collections = this.collections;
        const unitDef = collections.units[inst.unitId];
        if (!unitDef) {
            return { success: false, error: `Unit ${inst.unitId} not found` };
        }

        const unitType = { ...unitDef, id: inst.unitId, collection: 'units' };
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;
        const playerId = team === this.enums.team.left ? 0 : 1;
        const gridPosition = { x: inst.x, z: inst.z };

        return new Promise(resolve => {
            this.game.call('ui_placeUnit', gridPosition, unitType, team, playerId, (success, response) => {
                resolve({ success, ...response });
            });
        });
    }

    async _executePlaceBuilding(inst) {
        const collections = this.collections;
        const buildingDef = collections.buildings[inst.buildingId];
        if (!buildingDef) {
            return { success: false, error: `Building ${inst.buildingId} not found` };
        }

        const buildingType = { ...buildingDef, id: inst.buildingId, collection: 'buildings' };
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;
        const playerId = team === this.enums.team.left ? 0 : 1;

        let gridPosition;

        // Support "auto" for automatic placement near town hall
        if (inst.x === 'auto' || inst.z === 'auto') {
            gridPosition = this._findBuildingPositionNearTownHall(team, buildingType);
            if (!gridPosition) {
                return { success: false, error: `Could not find valid position for ${inst.buildingId} near town hall` };
            }
            console.log(`[HeadlessSimulationSystem] Auto-placed ${inst.buildingId} at grid (${gridPosition.x}, ${gridPosition.z})`);
        } else {
            gridPosition = { x: inst.x, z: inst.z };
        }

        // Find an available peasant to construct the building
        const peasantId = this._findAvailablePeasant(team);
        if (!peasantId) {
            return { success: false, error: `No available peasant found for team ${inst.team} to construct ${inst.buildingId}` };
        }

        // Set up peasant building placement info (like the GUI does)
        // Note: buildTime is in ROUNDS (not seconds) - the BuildBehaviorAction checks game.state.round
        const peasantInfo = {
            peasantId: peasantId,
            buildTime: buildingDef.buildTime || 1 // Default: complete after 1 round
        };

        console.log(`[HeadlessSimulationSystem] Peasant ${peasantId} will construct ${inst.buildingId} (buildTime: ${peasantInfo.buildTime} rounds)`);

        return new Promise(resolve => {
            this.game.call('ui_placeUnit', gridPosition, buildingType, team, playerId, peasantInfo, (success, response) => {
                resolve({ success, gridPosition, peasantId, ...response });
            });
        });
    }

    /**
     * Find an available peasant for a team that can construct a building
     * @private
     */
    _findAvailablePeasant(team) {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp.team !== team) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            // Check if this is a peasant
            if (unitDef?.id !== 'peasant') continue;

            // Check if peasant has build ability and is not already assigned
            const abilities = this.game.call('getEntityAbilities', entityId);
            if (!abilities) continue;

            const buildAbility = abilities.find(a => a.id === 'build');
            if (!buildAbility) continue;

            // Check if peasant is not already building something
            if (buildAbility.isBuilding || buildAbility.targetBuildingId) continue;

            return entityId;
        }

        return null;
    }

    /**
     * Find a valid building position near the team's town hall
     * Places in the direction toward the center of the map
     * @private
     */
    _findBuildingPositionNearTownHall(team, buildingType) {
        // Find the town hall for this team
        const townHall = this._findTownHallForTeam(team);
        if (!townHall) {
            console.error(`[HeadlessSimulationSystem] No town hall found for team ${team}`);
            return null;
        }

        const townHallPlacement = this.game.getComponent(townHall, 'placement');
        const townHallGridPos = townHallPlacement?.gridPosition;
        if (!townHallGridPos) {
            console.error(`[HeadlessSimulationSystem] Town hall has no grid position`);
            return null;
        }

        // Get town hall's cells for exclusion
        const townHallUnitType = this.game.getComponent(townHall, 'unitType');
        const townHallDef = this.game.call('getUnitTypeDef', townHallUnitType);
        const townHallSquadData = this.game.call('getSquadData', townHallDef);
        const townHallCells = this.game.call('getSquadCells', townHallGridPos, townHallSquadData);
        const townHallCellSet = new Set(townHallCells.map(cell => `${cell.x},${cell.z}`));

        // Get starting locations to determine center direction
        const startingLocations = this.game.call('getStartingLocationsFromLevel');

        // Calculate direction toward center/enemy
        // For left team (typically bottom-left), center is up-right (+x, +z)
        // For right team (typically top-right), center is down-left (-x, -z)
        let preferredDirX = 0;
        let preferredDirZ = 0;

        if (startingLocations) {
            const leftLoc = startingLocations[this.enums.team.left];
            const rightLoc = startingLocations[this.enums.team.right];

            if (leftLoc && rightLoc) {
                // Calculate midpoint as "center"
                const centerX = (leftLoc.x + rightLoc.x) / 2;
                const centerZ = (leftLoc.z + rightLoc.z) / 2;

                // Direction from our starting location toward center
                const myLoc = team === this.enums.team.left ? leftLoc : rightLoc;
                preferredDirX = Math.sign(centerX - myLoc.x);
                preferredDirZ = Math.sign(centerZ - myLoc.z);
            }
        }

        // Use PlacementSystem's findBuildingAdjacentPosition with center as target
        const buildingWorldPos = this.game.call('placementGridToWorld', townHallGridPos.x, townHallGridPos.z);
        const targetWorldPos = {
            x: buildingWorldPos.x + preferredDirX * 1000,
            z: buildingWorldPos.z + preferredDirZ * 1000
        };

        return this.game.call('findBuildingAdjacentPosition', townHallGridPos, townHallCellSet, buildingType, targetWorldPos);
    }

    /**
     * Find the town hall entity for a team
     * @private
     */
    _findTownHallForTeam(team) {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp.team !== team) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            // Check if this is a town hall (or upgraded version)
            if (unitDef?.id === 'townHall' || unitDef?.id === 'keep' || unitDef?.id === 'castle') {
                return entityId;
            }
        }

        return null;
    }

    async _executeSubmitPlacement(inst) {
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;
        return new Promise(resolve => {
            this.game.call('ui_toggleReadyForBattle', team, (success, response) => {
                resolve({ success: success !== false, ...response });
            });
        });
    }

    async _executePurchaseUnit(inst) {
        let buildingEntityId = inst.buildingEntityId;
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;

        // Auto-resolve building entity ID if using "auto:" prefix
        if (typeof buildingEntityId === 'string' && buildingEntityId.startsWith('auto:')) {
            buildingEntityId = this._findBuildingEntityId(buildingEntityId, team);
            if (!buildingEntityId) {
                return { success: false, error: `Could not find building for ${inst.buildingEntityId}` };
            }
        }

        return new Promise(resolve => {
            this.game.call('ui_purchaseUnit', inst.unitId, buildingEntityId, team, (success, response) => {
                resolve({ success, ...response });
            });
        });
    }

    async _executeMoveOrder(inst) {
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;

        let targetPosition;

        // Support special target values
        if (inst.target === 'center') {
            // Move toward map center
            targetPosition = { x: 0, z: 0 };
        } else if (inst.target === 'enemy') {
            // Move toward enemy's starting location
            targetPosition = this._getEnemyStartingPosition(team);
            if (!targetPosition) {
                return { success: false, error: 'Could not determine enemy starting position' };
            }
        } else if (inst.x !== undefined && inst.z !== undefined) {
            // Convert grid coordinates to world coordinates
            const worldPos = this.game.call('placementGridToWorld', inst.x, inst.z);
            targetPosition = { x: worldPos.x, z: worldPos.z };
        } else {
            return { success: false, error: 'MOVE_ORDER requires either target ("center", "enemy") or x/z coordinates' };
        }

        console.log(`[HeadlessSimulationSystem] MOVE_ORDER for team ${inst.team}: moving to (${targetPosition.x.toFixed(0)}, ${targetPosition.z.toFixed(0)})`);

        const placements = this.game.call('getPlacementsForSide', team) || [];
        const placementIds = placements
            .filter(p => p.squadUnits && p.squadUnits.length > 0)
            .map(p => p.placementId);

        if (placementIds.length === 0) {
            return { success: false, error: `No units found for team ${inst.team}` };
        }

        return new Promise(resolve => {
            this.game.call('ui_issueMoveOrder', placementIds, targetPosition, (success, response) => {
                resolve({ success, placementIds, targetPosition, ...response });
            });
        });
    }

    /**
     * Get the world position of the enemy team's starting location
     * @private
     */
    _getEnemyStartingPosition(myTeam) {
        const startingLocations = this.game.call('getStartingLocationsFromLevel');
        if (!startingLocations) return null;

        const enemyTeam = myTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
        const enemyLoc = startingLocations[enemyTeam];
        if (!enemyLoc) return null;

        // Convert tile coordinates to world coordinates
        return this.game.call('tileToWorld', enemyLoc.x, enemyLoc.z);
    }

    /**
     * Find a building entity ID by auto-specifier
     * Format: "auto:buildingType:team" (e.g., "auto:fletchersHall:left")
     * @private
     */
    _findBuildingEntityId(autoSpec, fallbackTeam) {
        const parts = autoSpec.split(':');
        if (parts.length < 2) return null;

        const buildingType = parts[1];
        const teamName = parts[2] || (fallbackTeam === this.enums.team.left ? 'left' : 'right');
        const targetTeam = this.enums.team[teamName] ?? fallbackTeam;

        console.log(`[HeadlessSimulationSystem] Looking for building: type=${buildingType}, team=${teamName} (${targetTeam})`);

        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const teamComp = this.game.getComponent(entityId, 'team');
            const placement = this.game.getComponent(entityId, 'placement');

            if (!unitTypeComp || !teamComp) continue;
            if (teamComp.team !== targetTeam) continue;

            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            // Debug: Log buildings of matching team
            if (unitDef?.collection === 'buildings') {
                console.log(`[HeadlessSimulationSystem] Found building: id=${unitDef.id}, entityId=${entityId}, isUnderConstruction=${placement?.isUnderConstruction}`);
            }

            if (!unitDef || unitDef.id !== buildingType) continue;

            // Check building is complete (not under construction)
            if (placement?.isUnderConstruction) {
                console.log(`[HeadlessSimulationSystem] Building ${entityId} is still under construction`);
                continue;
            }

            console.log(`[HeadlessSimulationSystem] Found matching building: ${entityId}`);
            return entityId;
        }

        console.log(`[HeadlessSimulationSystem] No matching building found for ${autoSpec}`);
        return null;
    }

    // ==================== EVENT HANDLERS ====================
    // These receive events via game.triggerEvent()

    onUnitKilled(entityId) {
        console.log('[HeadlessSimulationSystem] onUnitKilled received:', entityId);
        this._checkEventTrigger('onUnitKilled', { entityId });
    }

    onUnitDeath(data) {
        this._checkEventTrigger('onUnitDeath', data);
    }

    onBattleStart() {
        console.log('[HeadlessSimulationSystem] === BATTLE STARTED ===');
        console.log('[HeadlessSimulationSystem] Game state:', {
            phase: this.game.state.phase,
            round: this.game.state.round,
            now: this.game.state.now
        });
        this._logUnitsState();
        this._checkEventTrigger('onBattleStart', {});
    }

    onBattleEnd(data) {
        console.log('[HeadlessSimulationSystem] === BATTLE ENDED ===');
        this._checkEventTrigger('onBattleEnd', data);
    }

    onRoundEnd(data) {
        console.log('[HeadlessSimulationSystem] === ROUND ENDED ===');
        this._checkEventTrigger('onRoundEnd', data);
    }

    onPhaseChange(phase) {
        const phaseName = this.game.call('getReverseEnums')?.gamePhase?.[phase] || phase;
        console.log(`[HeadlessSimulationSystem] === PHASE CHANGE: ${phaseName} ===`);
        this._checkEventTrigger('onPhaseChange', { phase });
    }

    /**
     * Log comprehensive state of all units for debugging
     * @private
     */
    _logUnitsState() {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'health');
        console.log(`[HeadlessSimulationSystem] Found ${entities.length} units with health:`);

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

            console.log(`  Entity ${entityId}: ${unitDef?.id || 'unknown'} (${teamName})`);
            console.log(`    Position: (${pos?.x?.toFixed(1)}, ${pos?.z?.toFixed(1)})`);
            console.log(`    Health: ${health?.current}/${health?.max}`);
            console.log(`    AI State: ${aiState ? 'present' : 'MISSING'}`);
            if (aiState) {
                console.log(`      rootBehaviorTree: ${aiState.rootBehaviorTree}`);
                console.log(`      targetPosition: (${aiState.targetPosition?.x?.toFixed(1)}, ${aiState.targetPosition?.z?.toFixed(1)})`);
            }
            console.log(`    playerOrder: ${playerOrder ? 'present' : 'MISSING'}`);
            if (playerOrder) {
                console.log(`      target: (${playerOrder.targetPositionX?.toFixed(1)}, ${playerOrder.targetPositionZ?.toFixed(1)})`);
                console.log(`      isMoveOrder: ${playerOrder.isMoveOrder}, enabled: ${playerOrder.enabled}`);
            }
            console.log(`    Combat: range=${combat?.range}, damage=${combat?.damage}, attackSpeed=${combat?.attackSpeed}`);
            console.log(`    Death State: ${deathState?.state}`);
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
            console.log(`[HeadlessSimulationSystem] Event triggered: ${eventName}`, data);
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
