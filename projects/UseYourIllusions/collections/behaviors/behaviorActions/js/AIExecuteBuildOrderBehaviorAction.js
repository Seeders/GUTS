/**
 * AIExecuteBuildOrderBehaviorAction - Executes build order actions for AI opponent
 *
 * Reads the build order data and executes actions for the current round:
 * - PLACE_BUILDING: Find peasant, find position, call ui_placeUnit
 * - PURCHASE_UNIT: Find building, call ui_purchaseUnit
 * - MOVE_ORDER: Find units, call ui_issueMoveOrder
 * - HIDE_ORDER: Find units, call ui_hide
 *
 * Uses GameInterfaceSystem services just like a player would.
 */
class AIExecuteBuildOrderBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const aiOpponent = game.getComponent(entityId, 'aiOpponent');
        if (!aiOpponent) {
            return this.failure();
        }

        const teamComp = game.getComponent(entityId, 'team');
        const aiTeam = teamComp?.team;
        if (aiTeam === undefined) {
            return this.failure();
        }

        // Get build order
        const buildOrder = this.getBuildOrder(aiOpponent.buildOrderId, game);
        if (!buildOrder) {
            return this.failure();
        }

        // Get actions for current round
        const round = game.state.round || 1;
        const roundActions = buildOrder.rounds?.[round] || [];


        // Execute all remaining actions for this round
        let actionIndex = aiOpponent.actionIndex || 0;
        while (actionIndex < roundActions.length) {
            const action = roundActions[actionIndex];
            const result = this.executeAction(action, aiTeam, game);

            if (result) {
                actionIndex++;
                aiOpponent.actionIndex = actionIndex;
            } else {
                // Action failed, skip it
                 actionIndex++;
                aiOpponent.actionIndex = actionIndex;
            }
        }

        // All actions for this round completed
        return this.success();
    }

    getBuildOrder(buildOrderId, game) {
        const collections = game.getCollections();
        return collections.buildOrders?.[buildOrderId];
    }

    executeAction(action, aiTeam, game) {
        const enums = game.call('getEnums');
        const playerId = aiTeam === enums.team.left ? 0 : 1;

        switch (action.type) {
            case 'PLACE_BUILDING':
                return this.executePlaceBuilding(action, aiTeam, playerId, game);
            case 'PURCHASE_UNIT':
                return this.executePurchaseUnit(action, aiTeam, game);
            case 'MOVE_ORDER':
                return this.executeMoveOrder(action, aiTeam, game);
            case 'HIDE_ORDER':
                return this.executeHideOrder(action, aiTeam, game);
            case 'PLACE_TRAP':
                return this.executePlaceTrap(action, aiTeam, playerId, game);
            case 'SPAWN_UNIT':
                return this.executeSpawnUnit(action, aiTeam, game);
            case 'ACTION_ORDER':
                return this.executeActionOrder(action, aiTeam, game);
            default:
                return false;
        }
    }

    /**
     * Directly spawn a unit/building at a world position (for testing)
     * This bypasses normal building/purchase flow
     */
    executeSpawnUnit(action, aiTeam, game) {
        const reverseEnums = game.getReverseEnums();
        const enums = game.call('getEnums');
        const collections = game.getCollections();
        const teamName = reverseEnums.team?.[aiTeam] || 'left';
        const collection = action.collection || 'units';
        const position = action.position || { x: 0, z: 0 };

        // Get unit definition
        const unitDef = collections[collection]?.[action.unitId];
        if (!unitDef) {
            return false;
        }

        // Build the unitType object like PlacementSystem expects
        const unitType = {
            ...unitDef,
            id: action.unitId,
            collection: collection,
            squadWidth: unitDef.squadWidth || 1,
            squadHeight: unitDef.squadHeight || 1
        };

        // Get numeric indices for spawnType and collection
        const spawnTypeIndex = enums[collection]?.[action.unitId] ?? -1;
        const collectionIndex = enums.objectTypeDefinitions?.[collection] ?? -1;

        if (spawnTypeIndex < 0 || collectionIndex < 0) {
            return false;
        }

        // Get grid position from world position
        const gridPos = game.call('worldToPlacementGrid', position.x, position.z);

        // Build placement data like PlacementSystem expects
        // Note: UnitCreationSystem expects 'unitTypeId' not 'spawnType'
        const networkData = {
            unitType: unitType,
            collection: collectionIndex,
            unitTypeId: spawnTypeIndex,
            teamName: teamName,
            squadWidth: unitType.squadWidth,
            squadHeight: unitType.squadHeight,
            position: { x: position.x, y: 0, z: position.z },
            gridPosition: gridPos,
            isUnderConstruction: false
        };

        const playerId = aiTeam === enums.team.left ? 0 : 1;
        const result = game.call('spawnSquad', networkData, aiTeam, playerId);

        if (result && result.success) {
            return true;
        } else {
            return false;
        }
    }

    executePlaceBuilding(action, aiTeam, playerId, game) {

        const collections = game.getCollections();
        const buildingDef = collections.buildings?.[action.buildingId];
        if (!buildingDef) {
            return false;
        }

        // Find available peasant
        const peasantId = this.findAvailablePeasant(aiTeam, game);
        if (!peasantId) {
             return false;
        }
      
        // Find position near town hall
        const gridPos = this.findBuildingPosition(aiTeam, buildingDef, action.buildingId, game);
        if (!gridPos) {
            return false;
        }
       
        // Prepare unit type and peasant info
        const unitType = { ...buildingDef, id: action.buildingId, collection: 'buildings' };
        const peasantInfo = {
            peasantId: peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        // Call ui_placeUnit
        game.call('ui_placeUnit', gridPos, unitType, aiTeam, playerId, peasantInfo, (success, response) => {
        });

        return true;
    }

    executePurchaseUnit(action, aiTeam, game) {
        // Find the building
        const buildingEntityId = this.findBuildingByType(action.building, aiTeam, game);
        if (!buildingEntityId) {
            return false;
        }

        // Call ui_purchaseUnit
        game.call('ui_purchaseUnit', action.unitId, buildingEntityId, aiTeam, (success, response) => {
            // Callback handled silently
        });

        return true;
    }

    executeMoveOrder(action, aiTeam, game) {
        // Find units of specified type
        const placementIds = this.findUnitsOfType(action.unitType, aiTeam, game);
        if (placementIds.length === 0) {
            return false;
        }

        // Resolve target position
        const targetPos = this.resolveTarget(action.target, aiTeam, game);
        if (!targetPos) {
            return false;
        }

        // Call ui_issueMoveOrder
        game.call('ui_issueMoveOrder', placementIds, targetPos, (success, response) => {
            // Callback handled silently
        });

        return true;
    }

    executeHideOrder(action, aiTeam, game) {
        // Find units of specified type
        const placementIds = this.findUnitsOfType(action.unitType, aiTeam, game);
        if (placementIds.length === 0) {
            return false;
        }

        // Call ui_hide
        game.call('ui_hide', placementIds, (success, response) => {
            // Callback handled silently
        });

        return true;
    }

    // ==================== Helper Methods ====================

    findAvailablePeasant(aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');
   
        // Debug: List all units and their teams
        const unitsByTeam = {};
        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);
            const team = teamComp?.team;
            const unitId = unitDef?.id || 'unknown';

            if (!unitsByTeam[team]) unitsByTeam[team] = [];
            unitsByTeam[team].push({ entityId, unitId });
        }
      
        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);
            if (unitDef?.id !== 'peasant') continue;

            // Check if peasant has build ability and is not already building
            const abilities = game.call('getEntityAbilities', entityId);
            if (!abilities) continue;

            const buildAbility = abilities.find(a => a.id === 'BuildAbility');
            if (!buildAbility) {
                continue;
            }

            // Skip if already building
            if (buildAbility.isBuilding || buildAbility.targetBuildingId) {
                continue;
            }

            return entityId;
        }

        return null;
    }

    findBuildingPosition(aiTeam, buildingDef, buildingId, game) {
       
        // Find town hall for team
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) {
            return null;
        }
       
        const townHallPlacement = game.getComponent(townHall, 'placement');
        const townHallGridPos = townHallPlacement?.gridPosition;
        if (!townHallGridPos) {
            return null;
        }
       
        // Get town hall cells to avoid
        const townHallUnitType = game.getComponent(townHall, 'unitType');
        const townHallDef = game.call('getUnitTypeDef', townHallUnitType);
        const townHallSquadData = game.call('getSquadData', townHallDef);
        const townHallCells = game.call('getSquadCells', townHallGridPos, townHallSquadData);
        const townHallCellSet = new Set(townHallCells.map(cell => `${cell.x},${cell.z}`));

        // Find adjacent position for new building
        const enums = game.call('getEnums');
        const startingLocations = game.call('getStartingLocationsFromLevel');

        let preferredDirX = 0;
        let preferredDirZ = 0;

        if (startingLocations) {
            const leftLoc = startingLocations[enums.team.left];
            const rightLoc = startingLocations[enums.team.right];

            if (leftLoc && rightLoc) {
                const centerX = (leftLoc.x + rightLoc.x) / 2;
                const centerZ = (leftLoc.z + rightLoc.z) / 2;

                const myLoc = aiTeam === enums.team.left ? leftLoc : rightLoc;
                preferredDirX = Math.sign(centerX - myLoc.x);
                preferredDirZ = Math.sign(centerZ - myLoc.z);
            }
        }

        const buildingWorldPos = game.call('placementGridToWorld', townHallGridPos.x, townHallGridPos.z);
        const targetWorldPos = {
            x: buildingWorldPos.x + preferredDirX * 1000,
            z: buildingWorldPos.z + preferredDirZ * 1000
        };

        // IMPORTANT: Add collection and id to buildingDef so getSquadCells knows to use footprintWidth/Height
        const buildingDefWithCollection = { ...buildingDef, id: buildingId, collection: 'buildings' };

        return game.call('findBuildingAdjacentPosition', townHallGridPos, townHallCellSet, buildingDefWithCollection, targetWorldPos);
    }

    findTownHall(aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.id === 'townHall' || unitDef?.id === 'keep' || unitDef?.id === 'castle') {
                return entityId;
            }
        }

        return null;
    }

    findBuildingByType(buildingType, aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const placement = game.getComponent(entityId, 'placement');
            // Skip buildings under construction
            if (placement?.isUnderConstruction) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.id === buildingType) {
                return entityId;
            }
        }

        return null;
    }

    findUnitsOfType(unitType, aiTeam, game) {
        const placements = game.call('getPlacementsForSide', aiTeam) || [];
        const placementIds = [];

        for (const placement of placements) {
            if (!placement.squadUnits || placement.squadUnits.length === 0) continue;

            const entityId = placement.squadUnits[0];
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);

            if (unitDef?.id === unitType) {
                placementIds.push(placement.placementId);
            }
        }

        return placementIds;
    }

    resolveTarget(target, aiTeam, game) {
        const enums = game.call('getEnums');

        if (target === 'center') {
            return { x: 0, z: 0 };
        }

        if (target === 'enemy') {
            const startingLocations = game.call('getStartingLocationsFromLevel');
            if (!startingLocations) return null;

            const enemyTeam = aiTeam === enums.team.left ? enums.team.right : enums.team.left;
            const enemyLoc = startingLocations[enemyTeam];
            if (!enemyLoc) return null;

            return game.call('tileToWorld', enemyLoc.x, enemyLoc.z);
        }

        // If target is an object with x/z, use it directly
        if (typeof target === 'object' && target.x !== undefined && target.z !== undefined) {
            return target;
        }

        return null;
    }

    /**
     * Execute an action order (e.g., transformToFlying, transformToGround)
     * Handles transform actions by calling ui_transformUnit directly
     */
    executeActionOrder(action, aiTeam, game) {
        // Find units of specified type
        const placementIds = this.findUnitsOfType(action.unitType, aiTeam, game);
        if (placementIds.length === 0) {
            console.warn(`[AIExecuteBuildOrderBehaviorAction] No units of type '${action.unitType}' found`);
            return false;
        }

        // Handle transform actions specially
        if (action.actionId === 'transformToFlying') {
            // Get entity from placement
            for (const placementId of placementIds) {
                const placement = game.call('getPlacementById', placementId);
                if (placement?.squadUnits?.[0]) {
                    game.call('ui_transformUnit', placement.squadUnits[0], 'dragon_red_flying', 'takeoff', () => {});
                }
            }
            return true;
        } else if (action.actionId === 'transformToGround') {
            for (const placementId of placementIds) {
                const placement = game.call('getPlacementById', placementId);
                if (placement?.squadUnits?.[0]) {
                    game.call('ui_transformUnit', placement.squadUnits[0], 'dragon_red', 'land', () => {});
                }
            }
            return true;
        }

        console.warn(`[AIExecuteBuildOrderBehaviorAction] Unknown action '${action.actionId}'`);
        return false;
    }
}
