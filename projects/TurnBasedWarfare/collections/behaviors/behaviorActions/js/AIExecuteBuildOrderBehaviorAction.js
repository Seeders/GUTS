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
            console.log('[AIExecuteBuildOrder] Build order not found:', aiOpponent.buildOrderId);
            return this.failure();
        }

        // Get actions for current round
        const round = game.state.round || 1;
        const roundActions = buildOrder.rounds?.[round] || [];

        if (roundActions.length > 0) {
            console.log('[AIExecuteBuildOrder] Round', round, 'has', roundActions.length, 'actions for build order:', aiOpponent.buildOrderId);
        }

        // Execute all remaining actions for this round
        let actionIndex = aiOpponent.actionIndex || 0;
        while (actionIndex < roundActions.length) {
            const action = roundActions[actionIndex];
            console.log('[AIExecuteBuildOrder] Executing action', actionIndex, ':', action.type, action);
            const result = this.executeAction(action, aiTeam, game);
            console.log('[AIExecuteBuildOrder] Action result:', result);

            if (result) {
                actionIndex++;
                aiOpponent.actionIndex = actionIndex;
            } else {
                // Action failed, skip it
                console.log('[AIExecuteBuildOrder] Action failed, skipping');
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
        console.log('[AIExecuteBuildOrder] executePlaceBuilding:', action.buildingId, 'team:', aiTeam);

        const collections = game.getCollections();
        const buildingDef = collections.buildings?.[action.buildingId];
        if (!buildingDef) {
            console.log('[AIExecuteBuildOrder] Building definition not found:', action.buildingId);
            return false;
        }

        // Find available peasant
        const peasantId = this.findAvailablePeasant(aiTeam, game);
        if (!peasantId) {
            console.log('[AIExecuteBuildOrder] No available peasant found for team:', aiTeam);
            return false;
        }
        console.log('[AIExecuteBuildOrder] Found peasant:', peasantId);

        // Find position near town hall
        const gridPos = this.findBuildingPosition(aiTeam, buildingDef, action.buildingId, game);
        if (!gridPos) {
            console.log('[AIExecuteBuildOrder] Could not find building position');
            return false;
        }
        console.log('[AIExecuteBuildOrder] Found grid position:', gridPos);

        // Prepare unit type and peasant info
        const unitType = { ...buildingDef, id: action.buildingId, collection: 'buildings' };
        const peasantInfo = {
            peasantId: peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        // Call ui_placeUnit
        game.call('ui_placeUnit', gridPos, unitType, aiTeam, playerId, peasantInfo, (success, response) => {
            console.log('[AIExecuteBuildOrder] ui_placeUnit callback - success:', success, 'response:', response);
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
        console.log('[AIExecuteBuildOrder] findAvailablePeasant - searching for team:', aiTeam, 'total entities with unitType/team/placement:', entities.length);

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
        console.log('[AIExecuteBuildOrder] Units by team:', JSON.stringify(unitsByTeam, null, 2));

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);
            console.log('[AIExecuteBuildOrder] Checking entity', entityId, 'unitDef.id:', unitDef?.id);
            if (unitDef?.id !== 'peasant') continue;

            // Check if peasant has build ability and is not already building
            const abilities = game.call('getEntityAbilities', entityId);
            console.log('[AIExecuteBuildOrder] Peasant', entityId, 'abilities:', abilities?.map(a => a.id));
            if (!abilities) continue;

            const buildAbility = abilities.find(a => a.id === 'build');
            if (!buildAbility) {
                console.log('[AIExecuteBuildOrder] Peasant', entityId, 'has no build ability');
                continue;
            }

            // Skip if already building
            if (buildAbility.isBuilding || buildAbility.targetBuildingId) {
                console.log('[AIExecuteBuildOrder] Peasant', entityId, 'is already building');
                continue;
            }

            console.log('[AIExecuteBuildOrder] Found available peasant:', entityId);
            return entityId;
        }

        return null;
    }

    findBuildingPosition(aiTeam, buildingDef, buildingId, game) {
        console.log('[AIExecuteBuildOrder] findBuildingPosition for team:', aiTeam);

        // Find town hall for team
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) {
            console.log('[AIExecuteBuildOrder] No town hall found for team:', aiTeam);
            return null;
        }
        console.log('[AIExecuteBuildOrder] Found town hall entity:', townHall);

        const townHallPlacement = game.getComponent(townHall, 'placement');
        const townHallGridPos = townHallPlacement?.gridPosition;
        if (!townHallGridPos) {
            console.log('[AIExecuteBuildOrder] Town hall has no grid position');
            return null;
        }
        console.log('[AIExecuteBuildOrder] Town hall grid position:', townHallGridPos);

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
}
