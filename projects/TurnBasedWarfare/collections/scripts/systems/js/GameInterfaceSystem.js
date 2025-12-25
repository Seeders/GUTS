/**
 * GameInterfaceSystem - Single interface for all game interactions
 *
 * Both the GUI (ShopSystem, PlacementUISystem) and headless mode use this
 * system to interact with the game. This ensures identical code paths
 * regardless of whether a human or simulation is playing.
 *
 * All services are prefixed with "ui_" to avoid collisions with existing
 * game services. This system provides convenience methods that wrap existing
 * services with additional logic (like production capacity checking for purchases).
 */
class GameInterfaceSystem extends GUTS.BaseSystem {
    static services = [
        // === Player Actions ===
        'ui_purchaseUnit',           // Buy unit from building
        'ui_placeUnit',              // Place unit/building on grid
        'ui_undoPlacement',          // Undo last placement
        'ui_holdPosition',           // Order units to hold position
        'ui_hide',                   // Order units to hide (no attacks, +20 stealth)
        'ui_issueMoveOrder',         // Order units to move
        'ui_assignBuilder',          // Assign builder to construction
        'ui_toggleReadyForBattle',   // Toggle ready state

        // === Input Handling ===
        'ui_handleCanvasClick',      // Left-click at world position
        'ui_handleCanvasRightClick', // Right-click at world position
        'ui_handleBoxSelection'      // Box selection with world bounds
    ];

    constructor(game) {
        super(game);
    }

    // ==================== SHOP / PURCHASES ====================

    /**
     * Get production progress for a building (internal helper)
     */
    _getBuildingProductionProgress(buildingEntityId) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        return placement?.productionProgress || 0;
    }

    /**
     * Set production progress for a building (internal helper)
     */
    _setBuildingProductionProgress(buildingEntityId, progress) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        if (placement) {
            placement.productionProgress = progress;
        }
    }

    /**
     * Purchase a unit from a building
     * This is the FULL logic from ShopSystem.purchaseUnit - includes production capacity check
     *
     * @param {string} unitId - Unit type ID (e.g., '1_d_archer')
     * @param {number} buildingEntityId - Entity ID of the building to spawn from
     * @param {number} team - Team enum value
     * @param {Function} callback - Called with (success, result)
     */
    ui_purchaseUnit(unitId, buildingEntityId, team, callback) {
        const unitDef = this.collections.units[unitId];
        if (!unitDef) {
            callback?.(false, { error: `Unit ${unitId} not found` });
            return;
        }

        // Get building's placement ID
        const buildingPlacement = this.game.getComponent(buildingEntityId, 'placement');
        const placementId = buildingPlacement?.placementId;
        if (!placementId) {
            callback?.(false, { error: 'Building has no placement' });
            return;
        }

        // Check production capacity (same logic as ShopSystem)
        const buildTime = unitDef.buildTime || 1;
        const productionProgress = this._getBuildingProductionProgress(buildingEntityId);
        const remainingCapacity = 1 - productionProgress;

        if (buildTime > remainingCapacity + 0.001) {
            callback?.(false, { error: `Not enough production capacity! Need ${buildTime.toFixed(1)} rounds` });
            return;
        }

        // Check gold for the specified team (not local player)
        const teamStats = this.game.call('getPlayerStatsByTeam', team);
        if (!teamStats || teamStats.gold < unitDef.value) {
            callback?.(false, { error: `Cannot afford ${unitDef.title || unitId}` });
            return;
        }

        // Check supply
        if (this.game.hasService('canAffordSupply')) {
            const canAfford = this.game.call('canAffordSupply', team, unitDef);
            if (canAfford === false) {
                callback?.(false, { error: 'Not enough supply' });
                return;
            }
        }

        // Find spawn position near building
        const unitType = { ...unitDef, id: unitId, collection: 'units' };
        const spawnPos = this.game.call('findBuildingSpawnPosition', placementId, unitType);
        if (!spawnPos) {
            callback?.(false, { error: 'No valid spawn position near building' });
            return;
        }

        // Create network unit data
        const playerId = team === this.enums.team.left ? 0 : 1;
        const networkUnitData = this._createNetworkUnitData(spawnPos, unitType, team, playerId);

        // Send placement request
        this.game.call('sendPlacementRequest', networkUnitData, (success, response) => {
            if (success) {
                // Update production progress
                const newProgress = productionProgress + buildTime;
                this._setBuildingProductionProgress(buildingEntityId, newProgress);
            }
            callback?.(success, response);
        });
    }

    /**
     * Create network unit data for a placement (internal helper)
     */
    _createNetworkUnitData(gridPosition, unitType, team, playerId, peasantInfo = null) {
        const collectionIndex = this.enums.objectTypeDefinitions?.[unitType.collection] ?? null;
        const typeIndex = this.enums[unitType.collection]?.[unitType.id] ?? null;

        return {
            gridPosition: gridPosition,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: team,
            playerId: playerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: unitType,
            peasantInfo: peasantInfo,
            isStartingState: false
        };
    }

    // ==================== UNIT ORDERS ====================

    /**
     * Issue hold position order to selected squads
     * Units stop moving and hold their current position
     */
    ui_holdPosition(placementIds, callback) {
        if (!placementIds || placementIds.length === 0) return;

        const targetPositions = [];
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (placement?.squadUnits?.length > 0) {
                const firstUnitId = placement.squadUnits[0];
                const transform = this.game.getComponent(firstUnitId, 'transform');
                const pos = transform?.position;
                targetPositions.push(pos ? { x: pos.x, y: 0, z: pos.z } : null);
            } else {
                targetPositions.push(null);
            }
        }

        const meta = { isMoveOrder: false };
        this.game.call('setSquadTargets', { placementIds, targetPositions, meta }, callback);
    }

    /**
     * Issue hide order to selected squads
     * Units stop moving, won't attack, and gain +20 stealth
     */
    ui_hide(placementIds, callback) {
        if (!placementIds || placementIds.length === 0) return;

        const targetPositions = [];
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (placement?.squadUnits?.length > 0) {
                const firstUnitId = placement.squadUnits[0];
                const transform = this.game.getComponent(firstUnitId, 'transform');
                const pos = transform?.position;
                targetPositions.push(pos ? { x: pos.x, y: 0, z: pos.z } : null);
            } else {
                targetPositions.push(null);
            }
        }

        const meta = { isMoveOrder: false, isHiding: true };
        this.game.call('setSquadTargets', { placementIds, targetPositions, meta }, callback);
    }

    /**
     * Issue move order to squads at a target position
     */
    ui_issueMoveOrder(placementIds, targetPosition, callback) {
        if (!placementIds || placementIds.length === 0) return;

        const meta = { isMoveOrder: true, preventEnemiesInRangeCheck: false };
        const targetPositions = placementIds.map(() => ({
            x: targetPosition.x,
            z: targetPosition.z
        }));

        this.game.call('setSquadTargets', { placementIds, targetPositions, meta }, callback);
    }

    /**
     * Assign a builder unit to a building under construction
     */
    ui_assignBuilder(builderEntityId, buildingEntityId, callback) {
        this._assignBuilderToConstruction(builderEntityId, buildingEntityId, callback);
    }

    // ==================== PLACEMENT PHASE ====================

    /**
     * Place a unit at a grid position
     * This is the single entry point for placement - both GUI and headless use this
     *
     * @param {Object} gridPosition - Grid coordinates {x, z}
     * @param {Object} unitType - Unit type definition with id and collection
     * @param {number} team - Team enum value
     * @param {number} playerId - Numeric player ID
     * @param {Object} peasantInfo - Optional peasant building info
     * @param {Function} callback - Called with (success, response)
     */
    ui_placeUnit(gridPosition, unitType, team, playerId, peasantInfo, callback) {
        // Handle callback as 5th or 6th argument
        if (typeof peasantInfo === 'function') {
            callback = peasantInfo;
            peasantInfo = null;
        }

        // NOTE: Validation is performed in the placement pipeline (placePlacement -> validatePlacement)
        // Skip pre-validation here since it would require duplicate logic
        // The actual placement will fail with proper error if invalid

        // Create network data using shared implementation
        const networkUnitData = this.ui_createNetworkUnitData(gridPosition, unitType, team, playerId, peasantInfo);

        // Send placement request
        this.game.call('sendPlacementRequest', networkUnitData, callback);
    }

    /**
     * Undo a placement - remove unit and refund gold
     *
     * @param {Object} undoInfo - Info about placement to undo
     * @param {Array} undoInfo.squadUnits - Entity IDs of units in squad
     * @param {Object} undoInfo.unitType - Unit type definition
     * @param {number} undoInfo.team - Team that placed the unit
     * @param {Function} callback - Called with (success)
     */
    ui_undoPlacement(undoInfo, callback) {
        if (!undoInfo) {
            callback?.(false);
            return;
        }

        // Destroy entities
        if (undoInfo.squadUnits) {
            for (const entityId of undoInfo.squadUnits) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
                this.game.call('releaseGridCells', entityId);
            }
        }

        // Refund gold - use active player team if not specified
        const team = undoInfo.team ?? this.game.call('getActivePlayerTeam') ?? this.game.state.myTeam;
        if (undoInfo.unitType?.value) {
            this.game.call('addPlayerGold', team, undoInfo.unitType.value);
        }

        callback?.(true);
    }

    /**
     * Toggle ready for battle state
     * @param {number} team - Team enum value (optional, defaults to active player team)
     * @param {Function} callback - Called with (success, response)
     */
    ui_toggleReadyForBattle(team, callback) {
        // Handle optional team parameter
        if (typeof team === 'function') {
            callback = team;
            team = this.game.call('getActivePlayerTeam') ?? this.game.state.myTeam;
        }
        this.game.call('toggleReadyForBattle', team, callback);
    }

    /**
     * Create network unit data for a placement
     * This is the SINGLE implementation - replaces duplicate code in PlacementUISystem and HeadlessEngine
     *
     * @param {Object} gridPosition - Grid coordinates {x, z}
     * @param {Object} unitType - Unit type definition with id and collection
     * @param {number} team - Team enum value
     * @param {number} playerId - Numeric player ID
     * @param {Object} peasantInfo - Optional peasant building info
     * @returns {Object} Network unit data
     */
    ui_createNetworkUnitData(gridPosition, unitType, team, playerId, peasantInfo = null) {
        const collectionIndex = this.enums.objectTypeDefinitions?.[unitType.collection] ?? null;
        const typeIndex = this.enums[unitType.collection]?.[unitType.id] ?? null;

        return {
            gridPosition: gridPosition,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: team,
            playerId: playerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: unitType,
            peasantInfo: peasantInfo,
            isStartingState: false
        };
    }

    // ==================== INPUT HANDLING ====================

    /**
     * Handle canvas left-click at world coordinates
     * Routes to appropriate handler based on game phase and state
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @param {Function} callback - Called with result { action, success, data }
     */
    ui_handleCanvasClick(worldX, worldZ, modifiers = {}, callback) {
        // Check if placing a unit/building
        if (this.game.state.selectedUnitType) {
            return this._handlePlacementClick(worldX, worldZ, callback);
        }

        // Otherwise, try entity selection
        return this._handleSelectionClick(worldX, worldZ, modifiers, callback);
    }

    /**
     * Handle canvas right-click at world coordinates
     * Issues move orders or assigns builders
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @param {Function} callback - Called with result { action, success, data }
     */
    ui_handleCanvasRightClick(worldX, worldZ, modifiers = {}, callback) {
        // Only handle right-clicks during placement phase
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback?.({ action: 'none', success: false, error: 'Not in placement phase' });
            return;
        }

        // Get selected squads
        const placementIds = this.game.call('getSelectedSquads');

        if (!placementIds || placementIds.length === 0) {
            callback?.({ action: 'none', success: false, error: 'No units selected' });
            return;
        }

        // Check for building under construction at position
        const buildingEntityId = this._getBuildingUnderConstructionAt(worldX, worldZ);
        if (buildingEntityId) {
            const builderUnit = this._getBuilderFromSelection(placementIds);
            if (builderUnit) {
                return this._assignBuilderToConstruction(builderUnit, buildingEntityId, callback);
            }
        }

        // Issue move order
        const targetPosition = { x: worldX, y: 0, z: worldZ };
        const targetPositions = this._getFormationTargetPositions(targetPosition, placementIds);

        const meta = { isMoveOrder: true, preventEnemiesInRangeCheck: false };
        this.game.call('setSquadTargets', { placementIds, targetPositions, meta }, (success, response) => {
            callback?.({
                action: 'move_order',
                success,
                data: { placementIds, targetPosition, targetPositions },
                response
            });
        });
    }

    /**
     * Handle box selection with world-space bounds
     *
     * @param {number} worldMinX - Minimum X coordinate
     * @param {number} worldMinZ - Minimum Z coordinate
     * @param {number} worldMaxX - Maximum X coordinate
     * @param {number} worldMaxZ - Maximum Z coordinate
     * @param {Object} modifiers - { shift: bool, ctrl: bool, alt: bool }
     * @param {Function} callback - Called with result { action, success, data }
     */
    ui_handleBoxSelection(worldMinX, worldMinZ, worldMaxX, worldMaxZ, modifiers = {}, callback) {
        const entityIds = this._getEntitiesInBounds(worldMinX, worldMinZ, worldMaxX, worldMaxZ);

        callback?.({
            action: 'select_multiple',
            success: true,
            data: {
                entityIds,
                additive: modifiers.shift || false
            }
        });
    }

    // ==================== QUERY HELPERS ====================

    /**
     * Get entity at world position (internal helper)
     *
     * @param {Object} worldPos - World position { x, z }
     * @param {Object} options - { radius, teamFilter }
     * @returns {number|null} Entity ID or null
     */
    _getEntityAtPosition(worldPos, options = {}) {
        const clickRadius = options.radius || 50;
        const teamFilter = options.teamFilter ?? this.game.call('getActivePlayerTeam') ?? this.game.state.myTeam;

        let closestEntity = null;
        let closestDistance = clickRadius;

        const entities = this.game.getEntitiesWith('transform', 'renderable');

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

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
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
     * Get entities within world-space bounds (internal helper)
     *
     * @param {number} worldMinX - Minimum X coordinate
     * @param {number} worldMinZ - Minimum Z coordinate
     * @param {number} worldMaxX - Maximum X coordinate
     * @param {number} worldMaxZ - Maximum Z coordinate
     * @param {Object} options - { teamFilter, prioritizeUnits }
     * @returns {Array} Array of entity IDs
     */
    _getEntitiesInBounds(worldMinX, worldMinZ, worldMaxX, worldMaxZ, options = {}) {
        const teamFilter = options.teamFilter ?? this.game.call('getActivePlayerTeam') ?? this.game.state.myTeam;
        const prioritizeUnits = options.prioritizeUnits ?? true;

        const selectedUnits = [];
        const selectedBuildings = [];

        const entities = this.game.getEntitiesWith('transform', 'renderable');

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

                // Determine collection
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

        // When prioritizing, return units if any, otherwise buildings
        return prioritizeUnits && selectedUnits.length > 0 ? selectedUnits : selectedUnits.concat(selectedBuildings);
    }

    /**
     * Get placement at world position (internal helper)
     *
     * @param {Object} worldPos - World position { x, z }
     * @param {Object} options - { radius }
     * @returns {string|null} Placement ID or null
     */
    _getPlacementAtPosition(worldPos, options = {}) {
        const entityId = this._getEntityAtPosition(worldPos, options);
        if (!entityId) return null;

        const placement = this.game.getComponent(entityId, 'placement');
        return placement?.placementId || null;
    }

    // ==================== INTERNAL HELPERS ====================

    /**
     * Handle placement click (when selectedUnitType is set)
     */
    _handlePlacementClick(worldX, worldZ, callback) {
        const unitType = this.game.state.selectedUnitType;
        const gridPos = this.game.call('worldToPlacementGrid', worldX, worldZ);
        const team = this.game.call('getActivePlayerTeam') ?? this.game.state.myTeam;
        const playerId = this.game.clientNetworkManager?.numericPlayerId ?? (team === this.enums.team.left ? 0 : 1);
        const peasantInfo = this.game.state.peasantBuildingPlacement || null;

        this.ui_placeUnit(gridPos, unitType, team, playerId, peasantInfo, (success, response) => {
            callback?.({
                action: 'place_unit',
                success,
                data: response,
                gridPosition: gridPos,
                unitType: unitType
            });
        });
    }

    /**
     * Handle selection click (when no selectedUnitType)
     */
    _handleSelectionClick(worldX, worldZ, modifiers, callback) {
        const worldPos = { x: worldX, z: worldZ };
        const entityId = this._getEntityAtPosition(worldPos);

        if (entityId) {
            callback?.({
                action: 'select_entity',
                success: true,
                data: {
                    entityId,
                    additive: modifiers.shift || false
                }
            });
        } else {
            // Clicked on empty ground
            if (!modifiers.shift) {
                callback?.({
                    action: 'deselect',
                    success: true,
                    data: {}
                });
            } else {
                callback?.({
                    action: 'none',
                    success: true,
                    data: {}
                });
            }
        }
    }

    /**
     * Get building under construction at position
     */
    _getBuildingUnderConstructionAt(worldX, worldZ) {
        const buildings = this.game.getEntitiesWith('placement', 'transform', 'unitType');

        for (const entityId of buildings) {
            const placement = this.game.getComponent(entityId, 'placement');
            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!placement || !pos || !unitType) continue;
            if (unitType.collection !== 'buildings') continue;
            if (!placement.isUnderConstruction) continue;

            const radius = unitType.collisionRadius || 50;
            const dx = worldX - pos.x;
            const dz = worldZ - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                return entityId;
            }
        }

        return null;
    }

    /**
     * Get builder unit from selected placements
     */
    _getBuilderFromSelection(placementIds) {
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) continue;

            for (const unitId of placement.squadUnits) {
                const abilities = this.game.call('getEntityAbilities', unitId);
                if (abilities) {
                    for (const ability of abilities) {
                        if (ability.id === 'build') {
                            return unitId;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Assign builder to construction
     */
    _assignBuilderToConstruction(builderEntityId, buildingEntityId, callback) {
        const buildingTransform = this.game.getComponent(buildingEntityId, 'transform');
        const buildingPos = buildingTransform?.position;
        const builderPlacement = this.game.getComponent(builderEntityId, 'placement');

        if (!buildingPos || !builderPlacement) {
            callback?.({ action: 'assign_builder', success: false, error: 'Invalid builder or building' });
            return;
        }

        const targetPosition = { x: buildingPos.x, y: 0, z: buildingPos.z };
        const meta = {
            buildingId: buildingEntityId,
            preventEnemiesInRangeCheck: true,
            isMoveOrder: false
        };

        this.game.call('setSquadTarget', builderPlacement.placementId, targetPosition, meta, (success, response) => {
            callback?.({
                action: 'assign_builder',
                success,
                data: {
                    builderEntityId,
                    buildingEntityId,
                    targetPosition
                },
                response
            });
        });
    }

    /**
     * Get formation target positions for multiple squads
     */
    _getFormationTargetPositions(targetPosition, placementIds) {
        const targetPositions = [];
        const placementGridSize = this.game.call('getPlacementGridSize') || 25;
        const unitPadding = 1;

        const roundPos = (val) => Math.round(val * 100) / 100;

        for (let i = 0; i < placementIds.length; i++) {
            targetPositions.push({
                x: roundPos(targetPosition.x),
                z: roundPos(i % 2 === 0 ? targetPosition.z + i * placementGridSize * unitPadding : targetPosition.z - i * placementGridSize * unitPadding)
            });
        }

        return targetPositions;
    }
}

GUTS.GameInterfaceSystem = GameInterfaceSystem;
