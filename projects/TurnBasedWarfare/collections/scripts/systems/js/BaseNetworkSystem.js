/**
 * BaseNetworkSystem - Shared base class for ClientNetworkSystem and ServerNetworkSystem
 *
 * Both client and server call the SAME process* methods with the SAME parameters:
 * - Server: Calls on request received (generates server-authoritative values)
 * - Client: Calls on response success (uses server-authoritative values from response)
 *
 * This ensures identical game state on both sides.
 */
class BaseNetworkSystem extends GUTS.BaseSystem {

    // ==================== PLACEMENT ====================

    /**
     * Process a placement - validates, deducts gold, spawns squad
     * @param {string} socketPlayerId - Socket player ID (for stats lookup)
     * @param {number} numericPlayerId - Numeric player ID (for ECS storage)
     * @param {Object} player - Player data with team
     * @param {Object} placement - Placement data
     * @param {number[]|null} serverEntityIds - Entity IDs from server (client uses these)
     * @returns {Object} Result with success, squadUnits, placementId, etc.
     */
    processPlacement(socketPlayerId, numericPlayerId, player, placement, serverEntityIds = null) {
        return this.game.call('placePlacement', socketPlayerId, numericPlayerId, player, placement, serverEntityIds);
    }

    // ==================== SQUAD TARGET ====================

    /**
     * Process squad target position - handles build orders and applies playerOrder
     * @param {number} placementId - The placement ID
     * @param {Object} targetPosition - Target position { x, y, z }
     * @param {Object} meta - Order metadata (isMoveOrder, buildingId, preventEnemiesInRangeCheck)
     * @param {number} serverIssuedTime - Server's game.state.now when order was issued
     * @returns {Object} Result with success
     */
    processSquadTarget(placementId, targetPosition, meta, serverIssuedTime) {
        // Handle build orders - update building's assignedBuilder and set buildingState
        if (meta?.buildingId != null) {
            const buildingPlacement = this.game.getComponent(meta.buildingId, 'placement');
            if (buildingPlacement) {
                const placement = this.game.call('getPlacementById', placementId);
                const builderEntityId = placement?.squadUnits?.[0];
                if (builderEntityId) {
                    buildingPlacement.assignedBuilder = builderEntityId;

                    let buildingState = this.game.getComponent(builderEntityId, "buildingState");
                    if (!buildingState) {
                        this.game.addComponent(builderEntityId, "buildingState", {
                            targetBuildingEntityId: meta.buildingId,
                            buildTime: buildingPlacement.buildTime || 5,
                            constructionStartTime: 0
                        });
                    } else {
                        buildingState.targetBuildingEntityId = meta.buildingId;
                        buildingState.buildTime = buildingPlacement.buildTime || 5;
                        buildingState.constructionStartTime = 0;
                    }
                }
            }
        }

        // Apply target position via UnitOrderSystem
        this.game.call('applySquadTargetPosition', placementId, targetPosition, meta, serverIssuedTime);

        return { success: true };
    }

    /**
     * Process multiple squad targets
     * @param {number[]} placementIds - Array of placement IDs
     * @param {Object[]} targetPositions - Array of target positions
     * @param {Object} meta - Shared order metadata
     * @param {number} serverIssuedTime - Server's game.state.now when order was issued
     * @returns {Object} Result with success
     */
    processSquadTargets(placementIds, targetPositions, meta, serverIssuedTime) {
        for (let i = 0; i < placementIds.length; i++) {
            this.processSquadTarget(placementIds[i], targetPositions[i], meta, serverIssuedTime);
        }
        return { success: true };
    }

    // ==================== UPGRADE ====================

    /**
     * Process upgrade purchase - deducts gold and sets upgrade bitmask
     * @param {string|number} playerId - Player ID for stats lookup
     * @param {string} upgradeId - The upgrade ID
     * @param {Object} upgrade - Upgrade definition with value
     * @returns {Object} Result with success
     */
    processPurchaseUpgrade(playerId, upgradeId, upgrade) {
        const playerStats = this.game.call('getPlayerStats', playerId);
        if (!playerStats) {
            return { success: false, error: 'Player not found' };
        }

        const upgradeIndex = this.enums.upgrades?.[upgradeId];
        if (upgradeIndex === undefined) {
            return { success: false, error: `Unknown upgrade: ${upgradeId}` };
        }

        // Check if already purchased (bitmask check)
        if (playerStats.upgrades & (1 << upgradeIndex)) {
            return { success: false, error: 'Upgrade already purchased' };
        }

        // Check if can afford
        if (playerStats.gold < upgrade.value) {
            return { success: false, error: 'Not enough gold' };
        }

        // Deduct gold and set upgrade bit
        playerStats.gold -= upgrade.value;
        playerStats.upgrades |= (1 << upgradeIndex);

        return { success: true, upgradeId };
    }

    // ==================== CANCEL BUILDING ====================

    /**
     * Process building cancellation - refunds gold, cleans up builder, destroys building
     * @param {number} buildingEntityId - The building entity ID
     * @param {number} numericPlayerId - Numeric player ID for ownership check
     * @returns {Object} Result with success, placementId, refundAmount
     */
    processCancelBuilding(buildingEntityId, numericPlayerId) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        if (!placement) {
            return { success: false, error: 'Building not found' };
        }

        if (placement.playerId !== numericPlayerId) {
            return { success: false, error: 'Building does not belong to this player' };
        }

        if (!placement.isUnderConstruction) {
            return { success: false, error: 'Building is not under construction' };
        }

        // Get unitType for refund
        const unitTypeComp = this.game.getComponent(buildingEntityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        const refundAmount = unitType?.value || 0;

        // Refund gold
        if (refundAmount > 0) {
            this.game.call('addPlayerGold', placement.team, refundAmount);
        }

        // Clean up builder
        const assignedBuilder = placement.assignedBuilder;
        if (assignedBuilder) {
            if (this.game.hasComponent(assignedBuilder, "buildingState")) {
                this.game.removeComponent(assignedBuilder, "buildingState");
            }
            const builderVel = this.game.getComponent(assignedBuilder, "velocity");
            if (builderVel) {
                builderVel.vx = 0;
                builderVel.vz = 0;
            }
        }

        // Destroy building
        this.game.call('removeInstance', buildingEntityId);
        this.game.destroyEntity(buildingEntityId);

        return {
            success: true,
            placementId: placement.placementId,
            refundAmount
        };
    }

    // ==================== BUILDING UPGRADE ====================

    /**
     * Process building upgrade - releases grid, destroys old building, spawns new one
     * @param {string} socketPlayerId - Socket player ID (for stats lookup)
     * @param {number} numericPlayerId - Numeric player ID (for ECS storage)
     * @param {Object} player - Player data with team
     * @param {number} buildingEntityId - The old building entity ID
     * @param {number} oldPlacementId - The old placement ID
     * @param {string} targetBuildingId - The target building type ID
     * @param {number[]|null} serverEntityIds - Entity IDs from server (client uses these)
     * @param {number|null} newPlacementId - Placement ID from server (client uses this)
     * @returns {Object} Result with success, newEntityId, newPlacementId, gridPosition
     */
    processUpgradeBuilding(socketPlayerId, numericPlayerId, player, buildingEntityId, oldPlacementId, targetBuildingId, serverEntityIds = null, newPlacementId = null) {
        console.log('[processUpgradeBuilding] Starting', { socketPlayerId, numericPlayerId, buildingEntityId, oldPlacementId, targetBuildingId, serverEntityIds, newPlacementId });

        // Get grid position from old placement before destroying
        const oldPlacement = this.game.call('getPlacementById', oldPlacementId);
        const gridPosition = oldPlacement?.gridPosition;
        console.log('[processUpgradeBuilding] Old placement', { oldPlacement, gridPosition });

        if (!gridPosition) {
            console.log('[processUpgradeBuilding] FAIL: Could not get grid position');
            return { success: false, error: 'Could not get grid position' };
        }

        // Release grid cells before destroying the old building (use entityId, not placementId)
        console.log('[processUpgradeBuilding] Releasing grid cells for entityId', buildingEntityId);
        this.game.call('releaseGridCells', buildingEntityId);

        // Remove old building visual representation
        this.game.call('removeInstance', buildingEntityId);

        // Destroy old building entity
        this.game.destroyEntity(buildingEntityId);

        // Create new building via normal placement flow
        const enums = this.game.getEnums();
        const collectionIndex = enums?.objectTypeDefinitions?.buildings ?? -1;
        const spawnTypeIndex = enums?.buildings?.[targetBuildingId] ?? -1;
        console.log('[processUpgradeBuilding] Resolved enums', { collectionIndex, spawnTypeIndex, targetBuildingId });

        const networkBuildingData = {
            placementId: newPlacementId, // Server generates, client uses server-provided value
            gridPosition: gridPosition,
            unitTypeId: spawnTypeIndex,
            collection: collectionIndex,
            team: player.team,
            playerId: numericPlayerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            skipValidation: true // Skip validation for upgrades since we already validated and released the grid
        };
        console.log('[processUpgradeBuilding] networkBuildingData', networkBuildingData);

        // Spawn new building
        console.log('[processUpgradeBuilding] Calling processPlacement with serverEntityIds', serverEntityIds);
        const result = this.processPlacement(socketPlayerId, numericPlayerId, player, networkBuildingData, serverEntityIds);
        console.log('[processUpgradeBuilding] processPlacement result', result);

        return {
            success: result.success,
            newEntityId: result.squadUnits?.[0],
            newPlacementId: result.placementId,
            gridPosition: gridPosition,
            error: result.error
        };
    }

    // ==================== CHEAT ====================

    /**
     * Process cheat execution - validates and executes cheat
     * @param {string} cheatName - The cheat name
     * @param {Object} params - Cheat parameters
     * @returns {Object} Result with success and cheat result data
     */
    processCheat(cheatName, params) {
        // Validate cheat
        const validation = this.game.call('validateCheat', cheatName, params);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Execute cheat
        const result = this.game.call('executeCheat', cheatName, params);
        if (result.error) {
            return { success: false, error: result.error };
        }

        return { success: true, result };
    }
}

GUTS.BaseNetworkSystem = BaseNetworkSystem;
