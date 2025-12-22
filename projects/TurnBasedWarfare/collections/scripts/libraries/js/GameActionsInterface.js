/**
 * GameActionsInterface - Unified interface for ALL game interactions
 *
 * This interface is the single abstraction layer between UI (DOM events, canvas clicks)
 * and game logic. Both the runtime GUI and headless simulation use this interface,
 * ensuring all game logic is identical.
 *
 * Categories of interactions:
 * - Unit Building: Training units from buildings
 * - Building Construction: Placing and upgrading buildings
 * - Move Orders: Issuing movement and attack orders
 * - Battle Phase: Ready for battle, start battle
 * - Unit Selection: Selecting and deselecting units
 * - Shop Interactions: Purchasing upgrades
 * - Placement: Direct unit placement on canvas
 */
class GameActionsInterface {
    constructor(game) {
        this.game = game;
    }

    get collections() {
        return this.game.getCollections();
    }

    get enums() {
        return this.game.getEnums();
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Get owned buildings for a team
     * @param {number} teamIndex - Team enum value
     * @returns {Map} Map of buildingType -> [entityIds]
     */
    getOwnedBuildings(teamIndex) {
        const buildings = new Map();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement', 'team');

        for (const entityId of entitiesWithPlacement) {
            const placement = this.game.getComponent(entityId, 'placement');
            const teamComp = this.game.getComponent(entityId, 'team');
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!placement || !unitType) continue;
            if (unitType.collection !== 'buildings') continue;
            if (teamComp.team !== teamIndex) continue;
            if (placement.isUnderConstruction) continue;

            const buildingType = unitType.id;
            if (!buildings.has(buildingType)) {
                buildings.set(buildingType, []);
            }
            buildings.get(buildingType).push(entityId);
        }

        return buildings;
    }

    /**
     * Get owned units for a team (alive, not under construction)
     * @param {number} teamIndex - Team enum value
     * @returns {Map} Map of unitType -> [entityIds]
     */
    getOwnedUnits(teamIndex) {
        const units = new Map();
        const entitiesWithTeam = this.game.getEntitiesWith('unitType', 'team', 'health');

        for (const entityId of entitiesWithTeam) {
            const teamComp = this.game.getComponent(entityId, 'team');
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const health = this.game.getComponent(entityId, 'health');

            if (!unitType || !health) continue;
            if (unitType.collection !== 'units') continue;
            if (teamComp.team !== teamIndex) continue;
            if (health.current <= 0) continue;

            const unitTypeId = unitType.id;
            if (!units.has(unitTypeId)) {
                units.set(unitTypeId, []);
            }
            units.get(unitTypeId).push(entityId);
        }

        return units;
    }

    /**
     * Check if requirements are met for a unit or building
     * @param {Object} def - Unit or building definition with optional requiresUnits/requiresBuildings arrays
     * @param {number} teamIndex - Team to check requirements for
     * @returns {{met: boolean, reason: string|null}}
     */
    checkRequirements(def, teamIndex) {
        if (def.requiresBuildings && def.requiresBuildings.length > 0) {
            const ownedBuildings = this.getOwnedBuildings(teamIndex);
            for (const reqBuilding of def.requiresBuildings) {
                if (!ownedBuildings.has(reqBuilding)) {
                    const buildingDef = this.collections.buildings[reqBuilding];
                    const buildingName = buildingDef?.title || reqBuilding;
                    return { met: false, reason: `Requires ${buildingName}` };
                }
            }
        }

        if (def.requiresUnits && def.requiresUnits.length > 0) {
            const ownedUnits = this.getOwnedUnits(teamIndex);
            for (const reqUnit of def.requiresUnits) {
                if (!ownedUnits.has(reqUnit)) {
                    const unitDef = this.collections.units[reqUnit];
                    const unitName = unitDef?.title || reqUnit;
                    return { met: false, reason: `Requires ${unitName}` };
                }
            }
        }

        return { met: true, reason: null };
    }

    /**
     * Check if player can afford the cost
     * @param {number} cost - Gold cost
     * @param {number} teamIndex - Team to check
     * @returns {boolean}
     */
    canAffordCost(cost, teamIndex) {
        const stats = this.game.call('getPlayerStatsByTeam', teamIndex);
        return stats && stats.gold >= cost;
    }

    /**
     * Check if player can afford supply for a unit
     * @param {number} teamIndex - Team to check
     * @param {Object} unitDef - Unit definition
     * @returns {boolean}
     */
    canAffordSupply(teamIndex, unitDef) {
        if (!this.game.hasService('canAffordSupply')) return true;
        return this.game.call('canAffordSupply', teamIndex, unitDef) ?? true;
    }

    /**
     * Get building production progress
     * @param {number} buildingEntityId - Building entity ID
     * @returns {number} Production progress (0-1)
     */
    getBuildingProductionProgress(buildingEntityId) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        return placement?.productionProgress || 0;
    }

    /**
     * Set building production progress
     * @param {number} buildingEntityId - Building entity ID
     * @param {number} progress - Production progress (0-1)
     */
    setBuildingProductionProgress(buildingEntityId, progress) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        if (placement) {
            placement.productionProgress = progress;
        }
    }

    /**
     * Get placementId for a building entity
     * @param {number} buildingEntityId - Building entity ID
     * @param {number} teamIndex - Team to search
     * @returns {number|null} Placement ID or null
     */
    getBuildingPlacementId(buildingEntityId, teamIndex) {
        const placements = this.game.call('getPlacementsForSide', teamIndex);
        if (!placements) return null;

        for (const placement of placements) {
            for (const squadUnit of placement.squadUnits) {
                if (squadUnit === buildingEntityId) {
                    return placement.placementId;
                }
            }
        }
        return null;
    }

    /**
     * Create network unit data for a placement request
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {Object} unitType - Unit type definition with id and collection
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Object} [peasantInfo] - Optional peasant info for building construction
     * @returns {Object} Network unit data
     */
    createNetworkUnitData(gridPosition, unitType, teamIndex, playerId, peasantInfo = null) {
        const collectionIndex = this.enums.objectTypeDefinitions?.[unitType.collection] ?? null;
        const typeIndex = this.enums[unitType.collection]?.[unitType.id] ?? null;

        return {
            gridPosition: gridPosition,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: teamIndex,
            playerId: playerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: unitType,
            peasantInfo: peasantInfo,
            isStartingState: false
        };
    }

    /**
     * Find a building of a specific type owned by a team
     * @param {string} buildingTypeId - Building type ID
     * @param {number} teamIndex - Team
     * @returns {number|null} Building entity ID or null
     */
    findBuildingOfType(buildingTypeId, teamIndex) {
        const ownedBuildings = this.getOwnedBuildings(teamIndex);
        const buildingIds = ownedBuildings.get(buildingTypeId);
        return buildingIds && buildingIds.length > 0 ? buildingIds[0] : null;
    }

    /**
     * Find a building that can train a specific unit type
     * @param {string} unitTypeId - Unit type ID
     * @param {number} teamIndex - Team
     * @returns {number|null} Building entity ID or null
     */
    findBuildingThatTrains(unitTypeId, teamIndex) {
        const ownedBuildings = this.getOwnedBuildings(teamIndex);

        for (const [buildingType, entityIds] of ownedBuildings) {
            const buildingDef = this.collections.buildings[buildingType];
            if (buildingDef?.units && buildingDef.units.includes(unitTypeId)) {
                for (const entityId of entityIds) {
                    const productionProgress = this.getBuildingProductionProgress(entityId);
                    const unitDef = this.collections.units[unitTypeId];
                    const buildTime = unitDef?.buildTime || 1;
                    const remainingCapacity = 1 - productionProgress;

                    if (buildTime <= remainingCapacity + 0.001) {
                        return entityId;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Find a valid grid position for a building near the team's base
     * @param {string} buildingTypeId - Building type ID
     * @param {number} teamIndex - Team
     * @returns {Object|null} Grid position {x, z} or null
     */
    findValidBuildingPosition(buildingTypeId, teamIndex) {
        const building = this.collections.buildings[buildingTypeId];
        if (!building) return null;

        const buildingDef = { ...building, id: buildingTypeId, collection: 'buildings' };
        const squadData = this.game.call('getSquadData', buildingDef);
        if (!squadData) return null;

        const startingLocations = this.game.call('getStartingLocationsFromLevel');
        if (!startingLocations || !startingLocations[teamIndex]) return null;

        const tilePos = startingLocations[teamIndex];
        const worldPos = this.game.call('tileToWorld', tilePos.x, tilePos.z);
        const centerGridPos = this.game.call('worldToPlacementGrid', worldPos.x, worldPos.z);

        const maxRadius = 20;
        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                    const testPos = {
                        x: centerGridPos.x + dx * 2,
                        z: centerGridPos.z + dz * 2
                    };

                    const cells = this.game.call('getSquadCells', testPos, squadData);
                    const isValid = this.game.call('isValidGridPlacement', cells, teamIndex);

                    if (isValid) {
                        return testPos;
                    }
                }
            }
        }

        return null;
    }

    // ==================== UNIT BUILDING ====================

    /**
     * Build a unit from a building (like clicking a unit button in the shop)
     * @param {number} buildingEntityId - Building entity ID that trains this unit
     * @param {string} unitTypeId - Unit type ID (e.g., '1_d_archer')
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Function} callback - Callback(success, result)
     */
    buildUnit(buildingEntityId, unitTypeId, teamIndex, playerId, callback) {
        const unit = this.collections.units[unitTypeId];
        if (!unit) {
            callback(false, { error: `Unit type not found: ${unitTypeId}` });
            return;
        }

        const unitDef = { ...unit, id: unitTypeId, collection: 'units' };

        // Check requirements
        const requirements = this.checkRequirements(unitDef, teamIndex);
        if (!requirements.met) {
            callback(false, { error: requirements.reason });
            return;
        }

        // Check gold
        if (!this.canAffordCost(unitDef.value || 0, teamIndex)) {
            callback(false, { error: "Can't afford" });
            return;
        }

        // Check supply
        if (!this.canAffordSupply(teamIndex, unitDef)) {
            callback(false, { error: "Not enough supply" });
            return;
        }

        // Check build time capacity
        const buildTime = unitDef.buildTime || 1;
        const productionProgress = this.getBuildingProductionProgress(buildingEntityId);
        const remainingCapacity = 1 - productionProgress;

        if (buildTime > remainingCapacity + 0.001) {
            callback(false, { error: `Not enough production capacity! Need ${buildTime.toFixed(1)} rounds` });
            return;
        }

        // Get placement ID for the building
        const placementId = this.getBuildingPlacementId(buildingEntityId, teamIndex);
        if (!placementId) {
            callback(false, { error: 'Building placement not found' });
            return;
        }

        // Find spawn position
        const spawnGridPos = this.game.call('findBuildingSpawnPosition', placementId, unitDef);
        if (!spawnGridPos) {
            callback(false, { error: 'No valid placement near building!' });
            return;
        }

        // Create network data
        const networkUnitData = this.createNetworkUnitData(spawnGridPos, unitDef, teamIndex, playerId);

        // Send placement request through the proper pipeline
        this.game.call('sendPlacementRequest', networkUnitData, (success, result) => {
            if (success) {
                const newProgress = productionProgress + buildTime;
                this.setBuildingProductionProgress(buildingEntityId, newProgress);
            }
            callback(success, result);
        });
    }

    /**
     * Build a unit by automatically finding a building that can train it
     * @param {string} unitTypeId - Unit type ID
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Function} callback - Callback(success, result)
     */
    buildUnitAuto(unitTypeId, teamIndex, playerId, callback) {
        const buildingEntityId = this.findBuildingThatTrains(unitTypeId, teamIndex);
        if (!buildingEntityId) {
            callback(false, { error: `No building available to train ${unitTypeId}` });
            return;
        }

        this.buildUnit(buildingEntityId, unitTypeId, teamIndex, playerId, callback);
    }

    // ==================== BUILDING CONSTRUCTION ====================

    /**
     * Build a building at a grid position (like clicking to place a building)
     * @param {string} buildingTypeId - Building type ID (e.g., 'fletchersHall')
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Object} [peasantInfo] - Optional peasant info for construction
     * @param {Function} callback - Callback(success, result)
     */
    buildBuilding(buildingTypeId, gridPosition, teamIndex, playerId, peasantInfo, callback) {
        const building = this.collections.buildings[buildingTypeId];
        if (!building) {
            callback(false, { error: `Building type not found: ${buildingTypeId}` });
            return;
        }

        const buildingDef = { ...building, id: buildingTypeId, collection: 'buildings' };

        // Check requirements
        const requirements = this.checkRequirements(buildingDef, teamIndex);
        if (!requirements.met) {
            callback(false, { error: requirements.reason });
            return;
        }

        // Check gold
        if (!this.canAffordCost(buildingDef.value || 0, teamIndex)) {
            callback(false, { error: "Can't afford" });
            return;
        }

        // Validate placement
        const squadData = this.game.call('getSquadData', buildingDef);
        if (!squadData) {
            callback(false, { error: 'Invalid building squad data' });
            return;
        }

        const cells = this.game.call('getSquadCells', gridPosition, squadData);
        const isValid = this.game.call('isValidGridPlacement', cells, teamIndex);
        if (!isValid) {
            callback(false, { error: 'Invalid placement location' });
            return;
        }

        // Create network data
        const networkUnitData = this.createNetworkUnitData(gridPosition, buildingDef, teamIndex, playerId, peasantInfo);

        // Send placement request
        this.game.call('sendPlacementRequest', networkUnitData, callback);
    }

    /**
     * Build a building with auto-position finding
     * @param {string} buildingTypeId - Building type ID
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Function} callback - Callback(success, result)
     */
    buildBuildingAuto(buildingTypeId, teamIndex, playerId, callback) {
        const gridPosition = this.findValidBuildingPosition(buildingTypeId, teamIndex);
        if (!gridPosition) {
            callback(false, { error: 'No valid position found for building' });
            return;
        }

        this.buildBuilding(buildingTypeId, gridPosition, teamIndex, playerId, null, callback);
    }

    /**
     * Upgrade an existing building
     * @param {number} buildingEntityId - Current building entity ID
     * @param {string} targetBuildingId - Target building type ID
     * @param {number} teamIndex - Team
     * @param {Function} callback - Callback(success, result)
     */
    upgradeBuilding(buildingEntityId, targetBuildingId, teamIndex, callback) {
        const targetBuilding = this.collections.buildings[targetBuildingId];
        if (!targetBuilding) {
            callback(false, { error: `Target building not found: ${targetBuildingId}` });
            return;
        }

        // Check gold
        const cost = targetBuilding.value || 0;
        if (!this.canAffordCost(cost, teamIndex)) {
            callback(false, { error: "Can't afford" });
            return;
        }

        const placementId = this.getBuildingPlacementId(buildingEntityId, teamIndex);
        if (!placementId) {
            callback(false, { error: 'Building placement not found' });
            return;
        }

        this.game.call('upgradeBuildingRequest', {
            buildingEntityId: buildingEntityId,
            placementId: placementId,
            targetBuildingId: targetBuildingId
        }, callback);
    }

    /**
     * Cancel building construction
     * @param {number} buildingEntityId - Building entity ID
     * @param {Function} callback - Callback(success, result)
     */
    cancelConstruction(buildingEntityId, callback) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        if (!placement || !placement.isUnderConstruction) {
            callback(false, { error: 'Building is not under construction' });
            return;
        }

        this.game.call('cancelBuilding', {
            placementId: placement.placementId,
            buildingEntityId: buildingEntityId
        }, callback);
    }

    // ==================== MOVE ORDERS ====================

    /**
     * Issue a move order to units (like right-clicking on the map)
     * @param {number[]} placementIds - Array of placement IDs to order
     * @param {Object} targetPosition - World position {x, y, z}
     * @param {string} orderType - 'move' or 'attack'
     * @param {Function} callback - Callback(success, result)
     */
    issueMoveOrder(placementIds, targetPosition, orderType, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, { error: 'Not in placement phase' });
            return;
        }

        const meta = {
            isMoveOrder: true,
            preventEnemiesInRangeCheck: orderType === 'attack'
        };

        const targetPositions = placementIds.map(() => targetPosition);

        this.game.call('setSquadTargets', {
            placementIds,
            targetPositions,
            meta
        }, callback);
    }

    /**
     * Issue a move order to all units of a team
     * @param {number} teamIndex - Team
     * @param {Object} targetGridPos - Grid position {x, z}
     * @param {string} orderType - 'move' or 'attack'
     * @param {Function} callback - Callback(success, result)
     */
    issueMoveOrderToTeam(teamIndex, targetGridPos, orderType, callback) {
        // Convert grid to world position
        const worldPos = this.game.hasService('placementGridToWorld')
            ? this.game.call('placementGridToWorld', targetGridPos.x, targetGridPos.z)
            : { x: targetGridPos.x * 10, y: 0, z: targetGridPos.z * 10 };

        const targetPosition = {
            x: worldPos.x,
            y: worldPos.y || 0,
            z: worldPos.z
        };

        // Get all placements for this team
        const placements = this.game.call('getPlacementsForSide', teamIndex);
        if (!placements || placements.length === 0) {
            callback(false, { error: 'No placements found for team' });
            return;
        }

        // Filter to only units (not buildings)
        const placementIds = [];
        for (const placement of placements) {
            const unitType = placement.unitType;
            const isBuilding = unitType?.collection === 'buildings';
            if (!isBuilding && placement.placementId) {
                placementIds.push(placement.placementId);
            }
        }

        if (placementIds.length === 0) {
            callback(false, { error: 'No units to order' });
            return;
        }

        this.issueMoveOrder(placementIds, targetPosition, orderType, callback);
    }

    // ==================== BATTLE PHASE ====================

    /**
     * Signal ready for battle (like clicking "Ready for Battle" button)
     * @param {Function} callback - Callback(success, result)
     */
    readyForBattle(callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, { error: 'Not in placement phase' });
            return;
        }

        this.game.call('toggleReadyForBattle', callback);
    }

    /**
     * Start the battle phase directly (for local/headless mode)
     * @param {Function} callback - Callback(success, result)
     */
    startBattle(callback) {
        if (this.game.hasService('startBattle')) {
            this.game.call('startBattle');
            callback(true, { success: true });
        } else {
            callback(false, { error: 'startBattle service not available' });
        }
    }

    // ==================== UNIT SELECTION ====================

    /**
     * Select a unit (like clicking on a unit)
     * @param {number} entityId - Entity ID to select
     */
    selectUnit(entityId) {
        if (this.game.hasService('selectUnit')) {
            this.game.call('selectUnit', entityId);
        } else {
            // Fallback: store in state
            this.game.state.selectedEntity = {
                entityId: entityId,
                collection: null
            };
        }
    }

    /**
     * Select multiple units
     * @param {number[]} entityIds - Entity IDs to select
     */
    selectUnits(entityIds) {
        if (this.game.hasService('selectUnits')) {
            this.game.call('selectUnits', entityIds);
        } else if (entityIds.length > 0) {
            this.selectUnit(entityIds[0]);
        }
    }

    /**
     * Deselect all units
     */
    deselectAll() {
        if (this.game.hasService('deselectAllUnits')) {
            this.game.call('deselectAllUnits');
        } else {
            this.game.state.selectedEntity = {
                entityId: null,
                collection: null
            };
        }
    }

    /**
     * Get currently selected entity
     * @returns {Object} Selected entity info {entityId, collection}
     */
    getSelection() {
        return this.game.state.selectedEntity || { entityId: null, collection: null };
    }

    // ==================== SHOP / UPGRADES ====================

    /**
     * Purchase an upgrade (like clicking an upgrade button)
     * @param {string} upgradeId - Upgrade ID
     * @param {Function} callback - Callback(success, result)
     */
    purchaseUpgrade(upgradeId, callback) {
        const upgrade = this.collections.upgrades[upgradeId];
        if (!upgrade) {
            callback(false, { error: `Upgrade not found: ${upgradeId}` });
            return;
        }

        this.game.call('purchaseUpgrade', { upgradeId }, callback);
    }

    /**
     * Level up a squad
     * @param {number} placementId - Placement ID
     * @param {number} teamIndex - Team
     * @param {string} [specializationId] - Optional specialization ID
     * @param {Function} callback - Callback(success, result)
     */
    levelUpSquad(placementId, teamIndex, specializationId, callback) {
        if (this.game.hasService('levelUpSquad')) {
            this.game.call('levelUpSquad', placementId, teamIndex, null, callback);
        } else {
            callback(false, { error: 'levelUpSquad service not available' });
        }
    }

    // ==================== DIRECT PLACEMENT ====================

    /**
     * Place a unit directly at a position (like clicking on canvas with unit selected)
     * This is for canvas-based placement, not building-based training
     * @param {Object} gridPosition - Grid position {x, z}
     * @param {Object} unitType - Unit type with id and collection
     * @param {number} teamIndex - Team
     * @param {number} playerId - Player ID
     * @param {Function} callback - Callback(success, result)
     */
    placeUnit(gridPosition, unitType, teamIndex, playerId, callback) {
        // Validate placement
        const squadData = this.game.call('getSquadData', unitType);
        if (!squadData) {
            callback(false, { error: 'Invalid unit squad data' });
            return;
        }

        const cells = this.game.call('getSquadCells', gridPosition, squadData);
        const isValid = this.game.call('isValidGridPlacement', cells, teamIndex);
        if (!isValid) {
            callback(false, { error: 'Invalid placement location' });
            return;
        }

        // Create network data
        const networkUnitData = this.createNetworkUnitData(gridPosition, unitType, teamIndex, playerId);

        // Send placement request
        this.game.call('sendPlacementRequest', networkUnitData, callback);
    }

    // ==================== GAME STATE ====================

    /**
     * Get current game phase
     * @returns {string} Phase name
     */
    getCurrentPhase() {
        const reverseEnums = this.game.getReverseEnums();
        return reverseEnums.gamePhase?.[this.game.state.phase] || 'unknown';
    }

    /**
     * Get current round
     * @returns {number}
     */
    getCurrentRound() {
        return this.game.state.round || 1;
    }

    /**
     * Get player gold
     * @param {number} teamIndex - Team
     * @returns {number}
     */
    getPlayerGold(teamIndex) {
        const stats = this.game.call('getPlayerStatsByTeam', teamIndex);
        return stats?.gold || 0;
    }

    /**
     * Get team supply info
     * @param {number} teamIndex - Team
     * @returns {Object} {current, max}
     */
    getTeamSupply(teamIndex) {
        if (this.game.hasService('getTeamSupply')) {
            return this.game.call('getTeamSupply', teamIndex);
        }
        return { current: 0, max: 0 };
    }
}

GUTS.GameActionsInterface = GameActionsInterface;
