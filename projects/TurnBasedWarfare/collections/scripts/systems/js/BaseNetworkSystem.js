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
    static services = [
        'broadcastToRoom',
        'replaceUnit'
    ];

    // ==================== BROADCAST ====================

    /**
     * Broadcast to all players in a room
     * In multiplayer: routes through ServerNetworkManager to Socket.IO
     * In local game: calls ClientNetworkSystem handlers directly (only one player)
     */
    broadcastToRoom(roomId, eventName, data) {
        const isLocal = this.game.state.isLocalGame;

        if (isLocal) {
            // In local game, route directly to client handlers
            const clientNet = this.game.clientNetworkSystem;
            if (eventName === 'BATTLE_END') {
                clientNet?.handleBattleEnd(data);
            } else if (eventName === 'GAME_END') {
                clientNet?.handleGameEnd(data);
            } else if (eventName === 'READY_FOR_BATTLE_UPDATE') {
                clientNet?.handleReadyForBattleUpdate(data);
            }
            // Other broadcasts are no-ops in single player
        } else {
            // Multiplayer - use ServerNetworkManager
            const actualRoomId = roomId || this.game.room?.id;
            this.engine?.serverNetworkManager?.broadcastToRoom(actualRoomId, eventName, data);
        }
    }

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
        // Get grid position from old placement before destroying
        const oldPlacement = this.game.call('getPlacementById', oldPlacementId);
        const gridPosition = oldPlacement?.gridPosition;

        if (!gridPosition) {
            return { success: false, error: 'Could not get grid position' };
        }

        // Release grid cells before destroying the old building (use entityId, not placementId)
        this.game.call('releaseGridCells', buildingEntityId);

        // Remove old building visual representation (client only)
        if (this.game.hasService('removeInstance')) {
            this.game.call('removeInstance', buildingEntityId);
        }

        // Destroy old building entity
        this.game.destroyEntity(buildingEntityId);

        // Create new building via normal placement flow
        const enums = this.game.getEnums();
        const collectionIndex = enums?.objectTypeDefinitions?.buildings ?? -1;
        const spawnTypeIndex = enums?.buildings?.[targetBuildingId] ?? -1;

        // Get target building definition to check for buildTime
        const targetBuildingDef = this.collections?.buildings?.[targetBuildingId];
        const buildTime = targetBuildingDef?.buildTime || 0;

        const networkBuildingData = {
            placementId: newPlacementId, // Server generates, client uses server-provided value
            gridPosition: gridPosition,
            unitTypeId: spawnTypeIndex,
            collection: collectionIndex,
            team: player.team,
            playerId: numericPlayerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            skipValidation: true, // Skip validation for upgrades since we already validated and released the grid
            // If buildTime > 0, spawn in under-construction state
            isUnderConstruction: buildTime > 0,
            buildTime: buildTime,
            assignedBuilder: -1, // No builder for upgrades - auto-completes
            isUpgrade: true // Flag to indicate this is an upgrade (auto-completion)
        };

        // Spawn new building
        const result = this.processPlacement(socketPlayerId, numericPlayerId, player, networkBuildingData, serverEntityIds);

        // If building has buildTime and spawned successfully, schedule auto-completion
        if (result.success && buildTime > 0) {
            const newBuildingId = result.squadUnits?.[0];
            if (newBuildingId != null) {
                // Store upgrade start round for tracking
                const placement = this.game.getComponent(newBuildingId, 'placement');
                if (placement) {
                    placement.upgradeStartRound = this.game.state.round;
                }
            }
        }

        return {
            success: result.success,
            newEntityId: result.squadUnits?.[0],
            newPlacementId: result.placementId,
            gridPosition: gridPosition,
            error: result.error
        };
    }

    // ==================== REPLACE UNIT ====================

    /**
     * Replace a unit entity with a new one of a different type.
     * This is the shared pipeline used by:
     * - Dragon transformation (takeoff/land with animation)
     * - Unit specialization (upgrade to specialized unit type)
     * - Any other unit replacement scenarios
     *
     * Creates new entity underground, optionally plays animation, then swaps when complete.
     * Preserves position, team, HP percentage, and placement reference.
     *
     * @param {number} entityId - The entity to replace
     * @param {string} targetUnitTypeId - The target unit type ID (e.g., 'dragon_red_flying')
     * @param {Object} options - Optional configuration
     * @param {string} options.animationType - Animation to play on old entity ('takeoff', 'land', etc.)
     * @param {number} options.providedNewEntityId - Entity ID from server (for network sync)
     * @param {number} options.swapDelay - Override delay before swap (ms). If not set, uses animation duration or 100ms
     * @returns {number|null} New entity ID or null on failure
     */
    replaceUnit(entityId, targetUnitTypeId, options = {}) {
        const { animationType = null, providedNewEntityId = null, swapDelay = null } = options;

        // Get current entity state
        const transform = this.game.getComponent(entityId, 'transform');
        const health = this.game.getComponent(entityId, 'health');
        const teamComp = this.game.getComponent(entityId, 'team');
        const oldPlacement = this.game.getComponent(entityId, 'placement');

        if (!transform || !teamComp) {
            console.error('[replaceUnit] Missing required components on entity', entityId);
            return null;
        }

        const position = { x: transform.position.x, y: transform.position.y, z: transform.position.z };
        const rotation = transform.rotation;
        const hpPercent = health ? health.current / health.max : 1;
        const placementId = oldPlacement?.placementId;
        const playerId = oldPlacement?.playerId;
        const gridPosition = oldPlacement?.gridPosition;
        const team = teamComp.team;

        // Get target unit definition
        const unitDef = this.collections.units[targetUnitTypeId];
        if (!unitDef) {
            console.error('[replaceUnit] Target unit type not found:', targetUnitTypeId);
            return null;
        }

        // Determine swap delay - use animation duration if animationType provided
        let finalSwapDelay = swapDelay ?? 100; // Default small delay for non-animated
        let heightDelta = 0; // Height change during animation (for takeoff/land)

        if (animationType && swapDelay == null) {
            const oldUnitTypeComp = this.game.getComponent(entityId, 'unitType');
            const oldUnitDef = this.game.call('getUnitTypeDef', oldUnitTypeComp);
            const spriteAnimationSet = oldUnitDef?.spriteAnimationSet;

            if (spriteAnimationSet && this.game.hasService('getSpriteAnimationDuration')) {
                finalSwapDelay = this.game.call('getSpriteAnimationDuration', spriteAnimationSet, animationType);
            } else {
                finalSwapDelay = 1000; // Fallback for animated
            }

            // Calculate height delta from sprite offset difference for takeoff/land
            // Takeoff: ground dragon rises to flying height
            // Land: flying dragon descends to ground height
            const oldSpriteAnimationSetData = this.collections?.spriteAnimationSets?.[spriteAnimationSet];
            const newSpriteAnimationSetData = this.collections?.spriteAnimationSets?.[unitDef.spriteAnimationSet];

            console.log('[replaceUnit] spriteAnimationSet lookup:', {
                oldSet: spriteAnimationSet,
                newSet: unitDef.spriteAnimationSet,
                oldData: !!oldSpriteAnimationSetData,
                newData: !!newSpriteAnimationSetData,
                oldOffset: oldSpriteAnimationSetData?.spriteOffset,
                newOffset: newSpriteAnimationSetData?.spriteOffset
            });

            if (oldSpriteAnimationSetData && newSpriteAnimationSetData) {
                const oldOffset = oldSpriteAnimationSetData.spriteOffset || 0;
                const newOffset = newSpriteAnimationSetData.spriteOffset || 0;
                // Height delta is the difference in sprite offsets
                // Takeoff: new offset (flying=128) - old offset (ground=20) = +108 (rise)
                // Land: new offset (ground=20) - old offset (flying=128) = -108 (descend)
                heightDelta = newOffset - oldOffset;
                console.log('[replaceUnit] heightDelta calculated:', heightDelta);
            }

            // Trigger animation on old entity
            if (this.game.hasService('triggerSinglePlayAnimation')) {
                const animEnum = this.enums.animationType[animationType];
                if (animEnum !== undefined) {
                    this.game.call('triggerSinglePlayAnimation', entityId, animEnum, 1.0, 0);
                }
            }

            // Animate vertical render offset during transform (uses animationState.renderOffset)
            // Duration is in ms but game time is in seconds, so convert
            if (heightDelta !== 0 && finalSwapDelay > 100) {
                const durationSeconds = finalSwapDelay / 1000;
                console.log('[replaceUnit] Calling startHeightAnimation:', { entityId, heightDelta, durationSeconds, hasService: this.game.hasService('startHeightAnimation') });
                if (this.game.hasService('startHeightAnimation')) {
                    this.game.call('startHeightAnimation', entityId, heightDelta, durationSeconds);
                }
            }
        }

        // Get enums for unit type
        const collectionIndex = this.enums?.objectTypeDefinitions?.units ?? 0;
        const spawnTypeIndex = this.enums?.units?.[targetUnitTypeId] ?? 0;

        // Build network unit data for the standard creation pipeline
        const networkUnitData = {
            placementId: placementId,
            gridPosition: gridPosition,
            unitTypeId: spawnTypeIndex,
            collection: collectionIndex,
            team: team,
            playerId: playerId ?? -1,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: { ...unitDef, id: targetUnitTypeId, collection: 'units' }
        };

        // Build transform data for the new entity
        const transformData = {
            position: { x: position.x, y: position.y, z: position.z },
            rotation: rotation ? { x: rotation.x, y: rotation.y, z: rotation.z } : { x: 0, y: 0, z: 0 }
        };

        // For animated transforms, delay entity creation until animation completes
        // This prevents the new entity from appearing before the old one finishes its animation
        if (animationType && finalSwapDelay > 100) {
            // Store data needed for delayed creation
            const creationData = {
                networkUnitData,
                transformData,
                team,
                providedNewEntityId,
                oldEntityId: entityId,
                hpPercent,
                unitDef
            };

            // Schedule entity creation after animation using game time (not real time)
            // Convert ms to seconds for scheduleAction
            const delaySeconds = finalSwapDelay / 1000;

            // For landing animations, play landing particle effect when animation completes
            if (animationType === 'land' && this.game.hasService('playEffectSystem')) {
                // Schedule the particle effect to play just before the entity swap
                const particleDelay = Math.max(0, delaySeconds - 0.1);
                this.game.call('scheduleAction', () => {
                    this.game.call('playEffectSystem', 'dragon_landing', position);
                }, particleDelay, null);
            }

            if (this.game.hasService('scheduleAction')) {
                // Don't pass entityId to scheduleAction - we don't want the swap cancelled if something
                // destroys the old entity early (but we do check entityExists before destroying)
                this.game.call('scheduleAction', () => {
                    // Create the new entity
                    let newEntityId;
                    if (this.game.hasService('createPlacement')) {
                        newEntityId = this.game.call('createPlacement', creationData.networkUnitData, creationData.transformData, creationData.team, creationData.providedNewEntityId);
                    } else {
                        console.error('[replaceUnit] createPlacement service not available');
                        return;
                    }

                    // Adjust HP to preserve percentage
                    const healthComp = this.game.getComponent(newEntityId, 'health');
                    if (healthComp) {
                        const newMaxHp = creationData.unitDef.hp || 100;
                        const newCurrentHp = Math.round(creationData.hpPercent * newMaxHp);
                        healthComp.max = newMaxHp;
                        healthComp.current = newCurrentHp;
                    }

                    // Destroy old entity
                    if (this.game.entityExists(creationData.oldEntityId)) {
                        if (this.game.hasService('removeInstance')) {
                            this.game.call('removeInstance', creationData.oldEntityId);
                        }
                        this.game.destroyEntity(creationData.oldEntityId);
                    }
                }, delaySeconds, null);
            } else {
                // Fallback to setTimeout if scheduling system not available
                setTimeout(() => {
                    let newEntityId;
                    if (this.game.hasService('createPlacement')) {
                        newEntityId = this.game.call('createPlacement', creationData.networkUnitData, creationData.transformData, creationData.team, creationData.providedNewEntityId);
                    } else {
                        console.error('[replaceUnit] createPlacement service not available');
                        return;
                    }

                    const healthComp = this.game.getComponent(newEntityId, 'health');
                    if (healthComp) {
                        const newMaxHp = creationData.unitDef.hp || 100;
                        const newCurrentHp = Math.round(creationData.hpPercent * newMaxHp);
                        healthComp.max = newMaxHp;
                        healthComp.current = newCurrentHp;
                    }

                    if (this.game.entityExists(creationData.oldEntityId)) {
                        if (this.game.hasService('removeInstance')) {
                            this.game.call('removeInstance', creationData.oldEntityId);
                        }
                        this.game.destroyEntity(creationData.oldEntityId);
                    }
                }, finalSwapDelay);
            }

            // Return null since entity isn't created yet - caller should handle this
            // For network sync, the providedNewEntityId will be used when entity is created
            return providedNewEntityId || -1; // Return expected ID for tracking
        }

        // Non-animated path: create entity immediately
        let newEntityId;
        if (this.game.hasService('createPlacement')) {
            newEntityId = this.game.call('createPlacement', networkUnitData, transformData, team, providedNewEntityId);
        } else {
            console.error('[replaceUnit] createPlacement service not available');
            return null;
        }

        // Adjust HP to preserve percentage
        const healthComp = this.game.getComponent(newEntityId, 'health');
        if (healthComp) {
            const newMaxHp = unitDef.hp || 100;
            const newCurrentHp = Math.round(hpPercent * newMaxHp);
            healthComp.max = newMaxHp;
            healthComp.current = newCurrentHp;
        }

        // For non-animated, destroy old entity after small delay using game time
        const delaySeconds = finalSwapDelay / 1000;
        if (this.game.hasService('scheduleAction')) {
            // Don't pass entityId - we just want a delayed cleanup, and we check entityExists anyway
            this.game.call('scheduleAction', () => {
                if (this.game.entityExists(entityId)) {
                    if (this.game.hasService('removeInstance')) {
                        this.game.call('removeInstance', entityId);
                    }
                    this.game.destroyEntity(entityId);
                }
            }, delaySeconds, null);
        } else {
            // Fallback to setTimeout if scheduling system not available
            setTimeout(() => {
                if (this.game.entityExists(entityId)) {
                    if (this.game.hasService('removeInstance')) {
                        this.game.call('removeInstance', entityId);
                    }
                    this.game.destroyEntity(entityId);
                }
            }, finalSwapDelay);
        }

        return newEntityId;
    }

    /**
     * Process unit transformation (dragon takeoff/land) - wrapper around replaceUnit
     * Kept for API compatibility with network handlers
     */
    processTransformUnit(entityId, targetUnitType, animationType, providedNewEntityId, _issuedTime) {
        return this.replaceUnit(entityId, targetUnitType, { animationType, providedNewEntityId });
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
