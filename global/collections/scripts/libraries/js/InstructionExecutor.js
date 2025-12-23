/**
 * InstructionExecutor - Executes simulation instructions
 *
 * This module is extracted from HeadlessSimulationSystem to provide
 * a reusable instruction execution engine. It handles:
 * - Unit placement
 * - Building placement
 * - Unit purchasing
 * - Move orders
 * - Battle control
 *
 * By separating this logic, we can:
 * 1. Test instruction execution independently
 * 2. Reuse in different simulation contexts
 * 3. Keep HeadlessSimulationSystem focused on orchestration
 */

class InstructionExecutor {
    constructor(game, logger) {
        this.game = game;
        this._log = logger || {
            error: () => {},
            warn: () => {},
            info: () => {},
            debug: () => {},
            trace: () => {}
        };
    }

    get enums() {
        return this.game.call('getEnums');
    }

    get collections() {
        return this.game.getCollections();
    }

    /**
     * Execute a single instruction
     * @param {Object} inst - Instruction to execute
     * @returns {Promise<Object>} Execution result
     */
    async execute(inst) {
        switch (inst.type) {
            case 'PLACE_UNIT':
                return this.executePlaceUnit(inst);

            case 'PLACE_BUILDING':
                return this.executePlaceBuilding(inst);

            case 'SUBMIT_PLACEMENT':
                return this.executeSubmitPlacement(inst);

            case 'START_BATTLE':
                this.game.call('startBattle');
                return { success: true };

            case 'PURCHASE_UNIT':
                return this.executePurchaseUnit(inst);

            case 'MOVE_ORDER':
                return this.executeMoveOrder(inst);

            case 'WAIT':
                return { success: true, waited: true };

            case 'SKIP_PLACEMENT':
                return this.executeSkipPlacement(inst);

            case 'END_SIMULATION':
                return { success: true, ended: true };

            case 'CALL_SERVICE':
                return this.executeCallService(inst);

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

    async executePlaceUnit(inst) {
        const unitDef = this.collections.units[inst.unitId];
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

    async executePlaceBuilding(inst) {
        const buildingDef = this.collections.buildings[inst.buildingId];
        if (!buildingDef) {
            return { success: false, error: `Building ${inst.buildingId} not found` };
        }

        const buildingType = { ...buildingDef, id: inst.buildingId, collection: 'buildings' };
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;
        const playerId = team === this.enums.team.left ? 0 : 1;

        let gridPosition;

        if (inst.x === 'auto' || inst.z === 'auto') {
            gridPosition = this.findBuildingPositionNearTownHall(team, buildingType);
            if (!gridPosition) {
                return { success: false, error: `Could not find valid position for ${inst.buildingId} near town hall` };
            }
            this._log.debug(`Auto-placed ${inst.buildingId} at grid (${gridPosition.x}, ${gridPosition.z})`);
        } else {
            gridPosition = { x: inst.x, z: inst.z };
        }

        const peasantId = this.findAvailablePeasant(team);
        if (!peasantId) {
            return { success: false, error: `No available peasant found for team ${inst.team} to construct ${inst.buildingId}` };
        }

        const peasantInfo = {
            peasantId: peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        this._log.debug(`Peasant ${peasantId} will construct ${inst.buildingId} (buildTime: ${peasantInfo.buildTime} rounds)`);

        return new Promise(resolve => {
            this.game.call('ui_placeUnit', gridPosition, buildingType, team, playerId, peasantInfo, (success, response) => {
                resolve({ success, gridPosition, peasantId, ...response });
            });
        });
    }

    async executeSubmitPlacement(inst) {
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;
        return new Promise(resolve => {
            this.game.call('ui_toggleReadyForBattle', team, (success, response) => {
                resolve({ success: success !== false, ...response });
            });
        });
    }

    async executePurchaseUnit(inst) {
        let buildingEntityId = inst.buildingEntityId;
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;

        if (typeof buildingEntityId === 'string' && buildingEntityId.startsWith('auto:')) {
            buildingEntityId = this.findBuildingEntityId(buildingEntityId, team);
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

    async executeMoveOrder(inst) {
        const team = typeof inst.team === 'string' ? this.enums.team[inst.team] : inst.team;

        let targetPosition;

        if (inst.target === 'center') {
            targetPosition = { x: 0, z: 0 };
        } else if (inst.target === 'enemy') {
            targetPosition = this.getEnemyStartingPosition(team);
            if (!targetPosition) {
                return { success: false, error: 'Could not determine enemy starting position' };
            }
        } else if (inst.x !== undefined && inst.z !== undefined) {
            const worldPos = this.game.call('placementGridToWorld', inst.x, inst.z);
            targetPosition = { x: worldPos.x, z: worldPos.z };
        } else {
            return { success: false, error: 'MOVE_ORDER requires either target ("center", "enemy") or x/z coordinates' };
        }

        this._log.debug(`MOVE_ORDER for team ${inst.team}: moving to (${targetPosition.x.toFixed(0)}, ${targetPosition.z.toFixed(0)})${inst.unitId ? ` (filter: ${inst.unitId})` : ''}`);

        const placements = this.game.call('getPlacementsForSide', team) || [];
        let filteredPlacements = placements.filter(p => p.squadUnits && p.squadUnits.length > 0);

        // Filter by unitId if specified - only move specific unit types
        if (inst.unitId) {
            filteredPlacements = filteredPlacements.filter(p => {
                const entityId = p.squadUnits?.[0];
                if (!entityId) return false;

                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                if (!unitTypeComp) return false;

                const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
                return unitDef?.id === inst.unitId;
            });
        }

        const placementIds = filteredPlacements.map(p => p.placementId);

        if (placementIds.length === 0) {
            const filterMsg = inst.unitId ? ` matching unitId '${inst.unitId}'` : '';
            return { success: false, error: `No units found for team ${inst.team}${filterMsg}` };
        }

        return new Promise(resolve => {
            this.game.call('ui_issueMoveOrder', placementIds, targetPosition, (success, response) => {
                resolve({ success, placementIds, targetPosition, ...response });
            });
        });
    }

    // ==================== HELPER METHODS ====================

    findAvailablePeasant(team) {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp.team !== team) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.id !== 'peasant') continue;

            const abilities = this.game.call('getEntityAbilities', entityId);
            if (!abilities) continue;

            const buildAbility = abilities.find(a => a.id === 'build');
            if (!buildAbility) continue;

            if (buildAbility.isBuilding || buildAbility.targetBuildingId) continue;

            return entityId;
        }

        return null;
    }

    findBuildingPositionNearTownHall(team, buildingType) {
        const townHall = this.findTownHallForTeam(team);
        if (!townHall) {
            this._log.error(`No town hall found for team ${team}`);
            return null;
        }

        const townHallPlacement = this.game.getComponent(townHall, 'placement');
        const townHallGridPos = townHallPlacement?.gridPosition;
        if (!townHallGridPos) {
            this._log.error('Town hall has no grid position');
            return null;
        }

        const townHallUnitType = this.game.getComponent(townHall, 'unitType');
        const townHallDef = this.game.call('getUnitTypeDef', townHallUnitType);
        const townHallSquadData = this.game.call('getSquadData', townHallDef);
        const townHallCells = this.game.call('getSquadCells', townHallGridPos, townHallSquadData);
        const townHallCellSet = new Set(townHallCells.map(cell => `${cell.x},${cell.z}`));

        const startingLocations = this.game.call('getStartingLocationsFromLevel');

        let preferredDirX = 0;
        let preferredDirZ = 0;

        if (startingLocations) {
            const leftLoc = startingLocations[this.enums.team.left];
            const rightLoc = startingLocations[this.enums.team.right];

            if (leftLoc && rightLoc) {
                const centerX = (leftLoc.x + rightLoc.x) / 2;
                const centerZ = (leftLoc.z + rightLoc.z) / 2;

                const myLoc = team === this.enums.team.left ? leftLoc : rightLoc;
                preferredDirX = Math.sign(centerX - myLoc.x);
                preferredDirZ = Math.sign(centerZ - myLoc.z);
            }
        }

        const buildingWorldPos = this.game.call('placementGridToWorld', townHallGridPos.x, townHallGridPos.z);
        const targetWorldPos = {
            x: buildingWorldPos.x + preferredDirX * 1000,
            z: buildingWorldPos.z + preferredDirZ * 1000
        };

        return this.game.call('findBuildingAdjacentPosition', townHallGridPos, townHallCellSet, buildingType, targetWorldPos);
    }

    findTownHallForTeam(team) {
        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp.team !== team) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.id === 'townHall' || unitDef?.id === 'keep' || unitDef?.id === 'castle') {
                return entityId;
            }
        }

        return null;
    }

    getEnemyStartingPosition(myTeam) {
        const startingLocations = this.game.call('getStartingLocationsFromLevel');
        if (!startingLocations) return null;

        const enemyTeam = myTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
        const enemyLoc = startingLocations[enemyTeam];
        if (!enemyLoc) return null;

        return this.game.call('tileToWorld', enemyLoc.x, enemyLoc.z);
    }

    findBuildingEntityId(autoSpec, fallbackTeam) {
        const parts = autoSpec.split(':');
        if (parts.length < 2) return null;

        const buildingType = parts[1];
        const teamName = parts[2] || (fallbackTeam === this.enums.team.left ? 'left' : 'right');
        const targetTeam = this.enums.team[teamName] ?? fallbackTeam;

        this._log.trace(`Looking for building: type=${buildingType}, team=${teamName} (${targetTeam})`);

        const entities = this.game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const teamComp = this.game.getComponent(entityId, 'team');
            const placement = this.game.getComponent(entityId, 'placement');

            if (!unitTypeComp || !teamComp) continue;
            if (teamComp.team !== targetTeam) continue;

            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.collection === 'buildings') {
                this._log.trace(`Found building: id=${unitDef.id}, entityId=${entityId}, isUnderConstruction=${placement?.isUnderConstruction}`);
            }

            if (!unitDef || unitDef.id !== buildingType) continue;

            if (placement?.isUnderConstruction) {
                this._log.trace(`Building ${entityId} is still under construction`);
                continue;
            }

            this._log.debug(`Found matching building: ${entityId}`);
            return entityId;
        }

        this._log.debug(`No matching building found for ${autoSpec}`);
        return null;
    }

    async executeSkipPlacement(inst) {
        const leftTeam = this.enums.team.left;
        const rightTeam = this.enums.team.right;

        // Generate AI placements for both teams
        if (this.game.hasService('generateAIPlacement')) {
            this.game.call('generateAIPlacement', leftTeam);
            this.game.call('generateAIPlacement', rightTeam);
        }

        // Submit placements for both teams
        return new Promise(resolve => {
            let leftDone = false;
            let rightDone = false;

            const checkDone = () => {
                if (leftDone && rightDone) {
                    resolve({ success: true, skipped: true });
                }
            };

            this.game.call('ui_toggleReadyForBattle', leftTeam, () => {
                leftDone = true;
                checkDone();
            });

            this.game.call('ui_toggleReadyForBattle', rightTeam, () => {
                rightDone = true;
                checkDone();
            });
        });
    }

    async executeCallService(inst) {
        const { service, args = [] } = inst;

        if (!service) {
            return { success: false, error: 'CALL_SERVICE requires a service name' };
        }

        if (!this.game.hasService(service)) {
            return { success: false, error: `Service '${service}' not found` };
        }

        try {
            const result = this.game.call(service, ...args);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    global.GUTS.InstructionExecutor = InstructionExecutor;
}

// ES6 exports for webpack bundling
export default InstructionExecutor;
export { InstructionExecutor };
