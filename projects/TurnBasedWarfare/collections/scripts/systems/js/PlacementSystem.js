/**
 * PlacementSystem - Core placement functionality
 *
 * Handles all placement logic: spawning, validation, battle phase methods.
 * Runs identically on client and server.
 *
 * Network communication is handled separately:
 * - Client: ClientNetworkSystem sends requests, handles broadcasts
 * - Server: ServerNetworkSystem receives requests, calls PlacementSystem, broadcasts
 *
 * Placements are stored as components on entities - no cached arrays.
 */
class PlacementSystem extends GUTS.BaseSystem {
    static services = [
        'getPlacementsForSide',
        'getPlacementById',
        'placePlacement',
        'validatePlacement',
        'spawnSquad',
        'resetAI',
        'clearPlayerPlacements',
        'clearAllPlacements',
        'getCameraPositionForTeam',
        'applyNetworkUnitData',
        'findBuildingSpawnPosition',
        'findBuildingAdjacentPosition',
        'getStartingLocationsFromLevel',
        'spawnPendingBuilding',
        'getSquadUnitsForPlacement'
    ];

    constructor(game) {
        super(game);
        this.game.placementSystem = this;

        // Auto-incrementing placement ID counter (server-authoritative)
        // Starts at 1, 0 and -1 reserved for invalid/unset
        this._nextPlacementId = 1;

        // Ready states for battle (server tracks these, client receives via broadcast)
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
    }

    init(params) {
        this.params = params || {};
    }

    /**
     * Handle tab becoming visible - reset accumulator during placement to prevent catchup
     */
    onTabVisible() {
        if (this.game.state.phase === this.enums.gamePhase.placement) {
            this.game.app?.resetAccumulator();
        }
    }

    /**
     * Called when scene loads - spawn starting units
     */
    onSceneLoad(sceneData) {
        this.spawnStartingUnits();
    }

    /**
     * Get the next placement ID (server-authoritative)
     * Only server should call this - clients receive IDs from server
     */
    _getNextPlacementId() {
        return this._nextPlacementId++;
    }

    /**
     * Sync placement ID counter from server
     * Called when client receives updated counter from server
     */
    syncNextPlacementId(nextId) {
        this._nextPlacementId = nextId;
    }

    /**
     * Get a placement by its ID
     * Queries entities with placement component - entities are the source of truth
     * @param {string} placementId - The placement ID to find
     * @returns {Object|null} The placement data with squadUnits array, or null if not found
     */
    getPlacementById(placementId) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId === placementId) {
                // Build squadUnits array from all entities with this placementId
                const squadUnits = this.getSquadUnitsForPlacement(placementId, entitiesWithPlacement);
                return {
                    ...placementComp,
                    squadUnits
                };
            }
        }
        return null;
    }

    /**
     * Get all placements for a given side/team
     * @param {string} team - The team side ('left' or 'right')
     * @returns {Array} Array of placement objects with squadUnits
     */
    getPlacementsForSide(team) {
        const placements = [];
        const seenPlacementIds = new Set();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId) continue;
            if (placementComp.team !== team) continue;
            if (seenPlacementIds.has(placementComp.placementId)) continue;

            seenPlacementIds.add(placementComp.placementId);

            const squadUnits = this.getSquadUnitsForPlacement(placementComp.placementId, entitiesWithPlacement);
            placements.push({
                ...placementComp,
                squadUnits
            });
        }

        return placements;
    }

    /**
     * Get all entity IDs that belong to a placement
     * @param {string} placementId - The placement ID
     * @param {Array} [entitiesWithPlacement] - Optional pre-fetched entities list for performance
     * @returns {Array} Array of entity IDs
     */
    getSquadUnitsForPlacement(placementId, entitiesWithPlacement = null) {
        const entities = entitiesWithPlacement || this.game.getEntitiesWith('placement');
        const squadUnits = [];

        for (const entityId of entities) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId === placementId) {
                squadUnits.push(entityId);
            }
        }

        return squadUnits;
    }

    /**
     * Get the player ID that owns a placement
     * @param {string} placementId - The placement ID
     * @returns {string|null} The player ID or null if not found
     */
    getPlayerIdByPlacementId(placementId) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId === placementId) {
                return placementComp.playerId;
            }
        }
        return null;
    }

    /**
     * Destroy all entities associated with a placement
     * @param {string} placementId - The placement ID to remove
     * @returns {number} Number of entities destroyed
     */
    destroyPlacementEntities(placementId) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        const entitiesToDestroy = [];

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId === placementId) {
                entitiesToDestroy.push(entityId);
            }
        }

        for (const entityId of entitiesToDestroy) {
            this.game.destroyEntity(entityId);
        }

        return entitiesToDestroy.length;
    }

    /**
     * Clean up a dead squad - release grid cells and remove from squad manager
     * @param {Object} placement - The placement object with squadUnits array
     */
    cleanupDeadSquad(placement) {
        if (placement.placementId) {
            // Release grid cells for each entity (use entityId, not placementId)
            if (placement.squadUnits) {
                for (const entityId of placement.squadUnits) {
                    this.game.call('releaseGridCells', entityId);
                }
            }
            this.game.call('removeSquad', placement.placementId);
        }
    }

    /**
     * Get unitType for a placement by looking up the unitType component on one of its entities
     * @param {string} placementId - The placement ID
     * @returns {Object|null} The unitType component data, or null if not found
     */
    getUnitTypeForPlacement(placementId) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId === placementId) {
                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                return this.game.call('getUnitTypeDef', unitTypeComp);
            }
        }
        return null;
    }

    /**
     * Spawn a squad from placement data - shared by both client and server
     * @param {Object} networkUnitData - Placement data with gridPosition, unitType, team, etc.
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} playerId - Optional player ID
     * @param {number[]|null} serverEntityIds - Optional array of entity IDs from server (client uses these to match server)
     * @returns {Object} Result with success flag and squad data
     */
    spawnSquad(networkUnitData, team, playerId = null, serverEntityIds = null) {
        console.log(`[spawnSquad] team=${team}, playerId=${playerId}, serverEntityIds=${JSON.stringify(serverEntityIds)}, placementId=${networkUnitData.placementId}, unitTypeId=${networkUnitData.unitTypeId}`);
        try {
            const unitType = networkUnitData.unitType;
            if (!unitType) {
                console.error('[PlacementSystem] Missing unitType in placement');
                return { success: false, error: 'Missing unitType' };
            }

            const gridPosition = networkUnitData.gridPosition;

            // Get squad configuration
            const squadData = this.game.call('getSquadData', unitType);
            const validation = this.game.call('validateSquadConfig', squadData);

            if (!validation.valid) {
                return { success: false, error: 'Invalid squad config' };
            }

            // BUILDINGS WITH BUILDERS: Don't spawn entity until builder arrives and starts building
            // Store building data on the peasant/scout and spawn when construction begins
            if (unitType.collection === 'buildings' && networkUnitData.peasantInfo) {
                const peasantId = networkUnitData.peasantInfo.peasantId;
                const placementId = (networkUnitData.placementId != null) ? networkUnitData.placementId : this._getNextPlacementId();

                // Store pending building data on the builder for later spawning
                this.setupPendingBuild(peasantId, {
                    ...networkUnitData,
                    placementId,
                    team,
                    playerId,
                    unitType,
                    gridPosition
                });

                this.game.state.peasantBuildingPlacement = null;

                return {
                    success: true,
                    squad: {
                        placementId,
                        gridPosition,
                        unitType,
                        squadUnits: [], // No entities spawned yet
                        cells: [],
                        isSquad: false,
                        team,
                        playerId,
                        timestamp: this.game.state.now,
                        isPendingBuilding: true
                    }
                };
            }

            // Calculate unit positions within the squad
            const unitPositions = this.game.call('calculateUnitPositions',
                gridPosition,
                unitType
            );

            // Calculate cells occupied by the squad
            const cells = this.game.call('getSquadCells', gridPosition, squadData);

            // Use provided placementId if valid (not null/undefined, from server), otherwise generate new one
            // On server: always generates (client sends null)
            // On client: uses server-provided placementId from submitPlacement response
            const placementId = (networkUnitData.placementId != null) ? networkUnitData.placementId : this._getNextPlacementId();

            // Build placement object with all required data
            const fullNetworkData = {
                ...networkUnitData,
                placementId,
                team,
                playerId
            };

            const squadUnits = [];

            // Create individual units for the squad
            for (let i = 0; i < unitPositions.length; i++) {
                const pos = unitPositions[i];
                const terrainHeight = this.game.call('getTerrainHeight', pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const transform = {
                    position: { x: pos.x, y: unitY, z: pos.z }
                };

                // Use server-provided entity ID if available, otherwise let server assign
                const serverEntityId = serverEntityIds ? serverEntityIds[i] : null;
                const entityId = this.game.call('createPlacement',
                    fullNetworkData,
                    transform,
                    team,
                    serverEntityId
                );

                squadUnits.push(entityId);
                this.game.call('reserveGridCells', cells, entityId);
            }

            // Handle gold mine buildings
            if (unitType.id === 'goldMine') {
                const footprintWidth = unitType.footprintWidth || unitType.placementGridWidth || 2;
                const footprintHeight = unitType.footprintHeight || unitType.placementGridHeight || 2;
                const gridWidth = footprintWidth * 2;
                const gridHeight = footprintHeight * 2;

                this.game.call('buildGoldMine',
                    squadUnits[0],
                    team,
                    gridPosition,
                    gridWidth,
                    gridHeight
                );
            }

            // Initialize squad in experience system
            this.game.call('initializeSquad', placementId, unitType, squadUnits);

            // Handle peasant/builder assignment for buildings
            // Two cases: local placement has peasantInfo, synced placement has assignedBuilder
            // Use unitType.collection (string) since placement.collection may be numeric
            if (unitType.collection === 'buildings') {
                const buildingEntityId = squadUnits[0];
                let peasantId = null;
                let peasantInfo = null;

                if (networkUnitData.peasantInfo) {
                    // Local placement - use peasantInfo
                    peasantInfo = networkUnitData.peasantInfo;
                    peasantId = peasantInfo.peasantId;
                } else if (networkUnitData.assignedBuilder && networkUnitData.isUnderConstruction) {
                    // Synced from server - reconstruct peasantInfo from placement data
                    peasantId = networkUnitData.assignedBuilder;
                    peasantInfo = {
                        peasantId: peasantId,
                        buildTime: networkUnitData.buildTime
                    };
                }

                if (peasantId && peasantInfo) {
                    // All buildings (including traps) use the same build flow
                    // Scout walks to position, then places trap when "construction" completes
                    const peasantAbilities = this.game.call('getEntityAbilities', peasantId);
                    if (peasantAbilities) {
                        const buildAbility = peasantAbilities.find(a => a.id === 'BuildAbility');
                        if (buildAbility) {
                            // Pass serverTime for issuedTime sync (undefined on server, provided by client)
                            buildAbility.assignToBuild(peasantId, buildingEntityId, peasantInfo, networkUnitData.serverTime);
                        }
                    }
                }

                this.game.state.peasantBuildingPlacement = null;
            }

            // Update squad creation statistics
            this.game.call('incrementSquadsCreated');

            return {
                success: true,
                squad: {
                    placementId,
                    gridPosition,
                    unitType,
                    squadUnits,
                    cells,
                    isSquad: squadUnits.length > 1,
                    team,
                    playerId,
                    timestamp: this.game.state.now
                }
            };

        } catch (error) {
            console.error('[PlacementSystem] Squad spawn failed:', error.message || error, error.stack);
            return { success: false, error: error.message };
        }
    }

    /**
     * Register an existing squad that was already created via ECS sync.
     * This sets up the placement tracking without creating new entities.
     * @param {Object} unitData - Network unit data from server
     * @param {number} team - The team this unit belongs to
     * @param {string} playerId - The player ID
     */
    registerExistingSquad(unitData, team, playerId = null) {
        // Resolve unitType if needed
        let unitType = unitData.unitType;
        if (!unitType && unitData.unitTypeId != null) {
            unitType = this.getUnitTypeFromPlacement(unitData);
        }

        if (!unitType) {
            console.warn('[PlacementSystem] registerExistingSquad: could not resolve unitType');
            return;
        }

        const squadUnits = unitData.squadUnits || [];
        const placementId = unitData.placementId;
        const gridPosition = unitData.gridPosition;

        // Get squad data for cell calculations
        const squadData = this.game.call('getSquadData', unitType);
        const cells = this.game.call('getSquadCells', gridPosition, squadData) || [];

        // Reserve grid cells for existing entities
        for (const entityId of squadUnits) {
            this.game.call('reserveGridCells', cells, entityId);
        }

        // Initialize squad in experience system
        this.game.call('initializeSquad', placementId, unitType, squadUnits);

        // Handle gold mine buildings
        if (unitType.id === 'goldMine' && squadUnits.length > 0) {
            const footprintWidth = unitType.footprintWidth || unitType.placementGridWidth || 2;
            const footprintHeight = unitType.footprintHeight || unitType.placementGridHeight || 2;
            const gridWidth = footprintWidth * 2;
            const gridHeight = footprintHeight * 2;

            this.game.call('buildGoldMine',
                squadUnits[0],
                team,
                gridPosition,
                gridWidth,
                gridHeight
            );
        }

        // Handle peasant/builder assignment for buildings under construction
        if (unitType.collection === 'buildings' && squadUnits.length > 0) {
            const buildingEntityId = squadUnits[0];

            if (unitData.assignedBuilder && unitData.isUnderConstruction) {
                const peasantId = unitData.assignedBuilder;
                const peasantInfo = {
                    peasantId: peasantId,
                    buildTime: unitData.buildTime
                };

                const peasantAbilities = this.game.call('getEntityAbilities', peasantId);
                if (peasantAbilities) {
                    const buildAbility = peasantAbilities.find(a => a.id === 'BuildAbility');
                    if (buildAbility) {
                        buildAbility.assignToBuild(peasantId, buildingEntityId, peasantInfo, unitData.serverTime);
                    }
                }
            }
        }
    }

    /**
     * Get unitType from collections using placement's numeric unitTypeId and collection indices
     * @param {Object} placement - Placement with numeric unitTypeId and collection indices
     * @returns {Object|null} The unitType definition or null
     */
    getUnitTypeFromPlacement(placement) {
        if (placement.collection == null || placement.unitTypeId == null) {
            return null;
        }


        // Resolve numeric collection index to collection name
        const collectionEnumMap = this.game.call('getEnumMap', 'objectTypeDefinitions');
        const collectionName = collectionEnumMap?.toValue?.[placement.collection];

        if (!collectionName || !this.collections[collectionName]) {
            return null;
        }

        // Resolve numeric unitTypeId to type name within that collection
        const typeEnumMap = this.game.call('getEnumMap', collectionName);
        const typeName = typeEnumMap?.toValue?.[placement.unitTypeId];

        if (!typeName) {
            return null;
        }

        const def = this.collections[collectionName]?.[typeName];
        if (def) {
            return {
                ...def,
                id: typeName,
                collection: collectionName
            };
        }
        return null;
    }

    /**
     * Spawn starting units for all teams deterministically.
     * Called by both client and server during scene load.
     * Left team spawns first, then right team - ensuring consistent entity IDs.
     * @returns {Object} Result with spawned units per team
     */
    spawnStartingUnits() {
        console.log('[PlacementSystem] spawnStartingUnits called');
        const startingUnitsConfig = this.collections.configs.startingUnits;

        if (!startingUnitsConfig?.prefabs) {
            console.warn('[PlacementSystem] No startingUnits config found');
            return { success: false, error: 'No startingUnits config' };
        }
        console.log('[PlacementSystem] startingUnitsConfig:', startingUnitsConfig);

        // Get starting locations from level
        const startingLocations = this.getStartingLocationsFromLevel();
        console.log('[PlacementSystem] startingLocations:', startingLocations);
        if (!startingLocations) {
            console.error('[PlacementSystem] No starting locations found in level');
            return { success: false, error: 'No starting locations in level' };
        }

        const result = {
            success: true,
            teams: {}
        };

        // Spawn in deterministic order: left first, then right
        // IMPORTANT: Spawn ALL units first, then ALL gold mines to ensure
        // entity IDs are consistent between client and server
        // Use numeric team enum values
        const teams = [this.enums.team.left, this.enums.team.right];
        const teamWorldPositions = {};

        // Phase 1: Spawn all units for both teams
        for (const team of teams) {
            const startingLoc = startingLocations[team];
            if (!startingLoc) {
                console.warn(`[PlacementSystem] No starting location for team: ${team}`);
                continue;
            }

            // Convert tile coordinates to world coordinates
            const worldPos = this.game.call('tileToWorld', startingLoc.x, startingLoc.z);
            teamWorldPositions[team] = worldPos;

            // Find nearest gold vein to determine spawn direction for units
            const nearestVein = this.game.call('findNearestGoldVein', worldPos);
            const goldVeinPos = nearestVein?.position || null;

            const teamResult = this.spawnStartingUnitsForTeam(
                startingUnitsConfig.prefabs,
                team,
                worldPos,
                goldVeinPos
            );

            result.teams[team] = teamResult;
        }

        // Phase 2: Spawn gold mines for both teams (after all units)
        for (const team of teams) {
            const worldPos = teamWorldPositions[team];
            if (!worldPos) continue;

            const goldMineResult = this.spawnStartingGoldMine(team, worldPos);
            if (result.teams[team]) {
                result.teams[team].goldMine = goldMineResult;
            }
        }

        return result;
    }

    /**
     * Spawn a starting gold mine on the nearest gold vein for a team
     * Uses ECS entity queries for deterministic behavior across client/server
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {Object} startingWorldPos - Starting world position { x, z }
     * @returns {Object} Result with spawned gold mine info
     */
    spawnStartingGoldMine(team, startingWorldPos) {
        const nearestVein = this.game.call('findNearestGoldVein', startingWorldPos);
        if (!nearestVein) {
            console.warn('[PlacementSystem] No unclaimed gold vein entity found for team:', team);
            return { success: false, error: 'No unclaimed gold veins' };
        }

        const nearestVeinEntityId = nearestVein.entityId;
        const nearestVeinPos = nearestVein.position;

        // Get gold mine building type
        const goldMineType = this.collections.buildings?.goldMine;
        if (!goldMineType) {
            console.error('[PlacementSystem] Gold mine building type not found');
            return { success: false, error: 'Gold mine type not found' };
        }

        // Convert world position to placement grid position
        const gridPos = this.game.call('worldToPlacementGrid', nearestVeinPos.x, nearestVeinPos.z);
        // Generate numeric placement ID
        const placementId = this._getNextPlacementId();

        // Get enum indices for numeric storage
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.buildings ?? -1;
        const typeIndex = enums.buildings?.goldMine ?? -1;

        // Build placement data with numeric indices
        // team is expected to already be numeric (from getActivePlayerTeam)
        const placement = {
            placementId,
            gridPosition: gridPos,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: team,
            isStartingState: true,
            unitType: { ...goldMineType, id: 'goldMine', collection: 'buildings' }
        };

        // Calculate cells for grid reservation
        const footprintWidth = goldMineType.footprintWidth || 2;
        const footprintHeight = goldMineType.footprintHeight || 2;
        const gridWidth = footprintWidth * 2;
        const gridHeight = footprintHeight * 2;

        const squadData = this.game.call('getSquadData', goldMineType);
        placement.cells = this.game.call('getSquadCells', gridPos, squadData);

        // Spawn the gold mine building
        const result = this.spawnSquad(placement, team, null, null);

        if (result.success && result.squad?.squadUnits?.length > 0) {
            const entityId = result.squad.squadUnits[0];

            // Register with gold mine system - pass the vein entity ID directly
            // to avoid cell matching issues due to position rounding
            this.game.call('buildGoldMine', entityId, team, gridPos, gridWidth, gridHeight, nearestVeinEntityId);

            return {
                success: true,
                entityId: entityId,
                gridPosition: gridPos,
                veinEntityId: nearestVeinEntityId
            };
        }

        console.error('[PlacementSystem] Failed to spawn starting gold mine for team:', team);
        return { success: false, error: 'Failed to spawn gold mine' };
    }

    /**
     * Spawn starting units for a single team
     * @param {Array} prefabs - Array of prefab definitions from config
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {Object} startingWorldPos - Starting world position { x, y, z }
     * @param {Object|null} goldVeinPos - Gold vein world position to spawn units toward
     * @returns {Object} Result with spawned entity IDs
     */
    spawnStartingUnitsForTeam(prefabs, team, startingWorldPos, goldVeinPos = null) {
        const spawnedUnits = [];

        // Track spawned building positions for unit placement toward gold vein
        let buildingGridPos = null;
        let buildingCellSet = null;

        for (let i = 0; i < prefabs.length; i++) {
            const prefabDef = prefabs[i];
            const collection = prefabDef.collection;
            const spawnType = prefabDef.spawnType;

            // Get the unit type using getUnitTypeDef (same as ShopSystem) so collection is properly set
            const enums = this.game.getEnums();
            const collectionIndex = enums.objectTypeDefinitions?.[collection] ?? -1;
            const typeIndex = enums[collection]?.[spawnType] ?? -1;
            const unitType = this.game.call('getUnitTypeDef', { collection: collectionIndex, type: typeIndex });
            if (!unitType) {
                console.error(`[PlacementSystem] Unit type not found: ${collection}/${spawnType}`);
                continue;
            }

            let gridPos;

            // For non-building units, find position adjacent to building toward gold vein
            if (collection === 'units' && buildingGridPos) {
                gridPos = this.findBuildingAdjacentPosition(buildingGridPos, buildingCellSet, unitType, goldVeinPos);
                if (!gridPos) {
                    // Fallback to original relative position
                    const relativePos = prefabDef.components?.transform?.position || { x: 0, y: 0, z: 0 };
                    const worldX = startingWorldPos.x + relativePos.x;
                    const worldZ = startingWorldPos.z + relativePos.z;
                    gridPos = this.game.call('worldToPlacementGrid', worldX, worldZ);
                }
            } else {
                // Get relative position from prefab definition
                const relativePos = prefabDef.components?.transform?.position || { x: 0, y: 0, z: 0 };
                const worldX = startingWorldPos.x + relativePos.x;
                const worldZ = startingWorldPos.z + relativePos.z;
                gridPos = this.game.call('worldToPlacementGrid', worldX, worldZ);

                // Track building position for subsequent unit spawns (same pattern as ShopSystem)
                if (collection === 'buildings') {
                    buildingGridPos = gridPos;
                    const buildingSquadData = this.game.call('getSquadData', unitType);
                    const buildingCells = this.game.call('getSquadCells', gridPos, buildingSquadData);
                    buildingCellSet = new Set(buildingCells.map(cell => `${cell.x},${cell.z}`));
                }
            }

            // Generate numeric placement ID
            const placementId = this._getNextPlacementId();

            // Build placement data with numeric indices (enums/collectionIndex/typeIndex already computed above)
            // team is expected to already be numeric (from getActivePlayerTeam)
            const placement = {
                placementId,
                gridPosition: gridPos,
                unitTypeId: typeIndex,
                collection: collectionIndex,
                team: team,
                isStartingState: true,
                unitType: { ...unitType, id: spawnType, collection: collection }
            };

            // Calculate cells for grid reservation
            const squadData = this.game.call('getSquadData', unitType);
            placement.cells = this.game.call('getSquadCells', gridPos, squadData);

            // Spawn the squad
            const result = this.spawnSquad(placement, team, null, null);

            if (result.success) {
                spawnedUnits.push({
                    spawnType: spawnType,
                    collection: collection,
                    placementId: placementId,
                    squadUnits: result.squad?.squadUnits || [],
                    gridPosition: gridPos
                });
            } else {
                console.error(`[PlacementSystem] Failed to spawn starting unit: ${spawnType}`, result.error);
            }
        }

        return {
            team: team,
            startingPosition: startingWorldPos,
            units: spawnedUnits
        };
    }

    /**
     * Get starting locations from the current level
     * @returns {Object|null} Object with 'left' and 'right' positions in tile coordinates, or null
     */
    getStartingLocationsFromLevel() {
        // Get level name from terrain entity
        const terrainEntities = this.game.getEntitiesWith('terrain');
        console.log('[PlacementSystem] getStartingLocationsFromLevel - terrain entities:', terrainEntities.length);
        if (terrainEntities.length === 0) {
            console.warn('[PlacementSystem] No terrain entity found');
            return null;
        }

        const terrainEntityId = terrainEntities[0];
        const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
        console.log('[PlacementSystem] Terrain component:', terrainComponent);
        const levelIndex = terrainComponent?.level;
        if (levelIndex === undefined || levelIndex < 0) {
            console.warn('[PlacementSystem] Terrain entity missing level');
            return null;
        }
        console.log('[PlacementSystem] Level index from terrain:', levelIndex);

        // Get level data by numeric index
        const levelKey = this.reverseEnums.levels[levelIndex];
        const level = this.collections.levels[levelKey];
        if (!level?.tileMap?.startingLocations) {
            console.warn(`[PlacementSystem] Level index ${levelIndex} has no startingLocations`);
            return null;
        }

        // Build locations map using numeric team enum keys
        const locations = {};
        for (const loc of level.tileMap.startingLocations) {
            if (loc.side && loc.gridX !== undefined) {
                // Convert string side ('left'/'right') to numeric team enum
                const teamEnumValue = this.enums.team?.[loc.side];
                if (teamEnumValue !== undefined) {
                    locations[teamEnumValue] = { x: loc.gridX, z: loc.gridZ };
                }
            }
        }

        return locations;
    }

    // ==================== BATTLE PHASE METHODS ====================

    /**
     * Reset AI state for all combat entities (called at battle start)
     * Must be deterministic - same on client and server
     */
    resetAI() {
        const combatEntities = this.game.getEntitiesWith("combat");
        for (const entityId of combatEntities) {
            const combat = this.game.getComponent(entityId, "combat");
            if (combat) {
                combat.lastAttack = 0;
            }
        }
    }

    /**
     * Apply network unit data for a team when battle starts
     * Called when both players are ready - spawns units for the specified team
     * NetworkUnitData is different from placement component - includes sync data like
     * experience, squadUnits, playerOrder, etc.
     * @param {Array} networkUnitData - Array of network unit data from server
     * @param {number} team - The team these units belong to
     * @param {string} playerId - The player ID for these units
     */
    applyNetworkUnitData(networkUnitData, team, playerId = null) {
        if (!networkUnitData) return;

        const existingPlacements = this.getPlacementsForSide(team) || [];

        networkUnitData.forEach(unitData => {
            console.log(`[applyNetworkUnitData] Processing unitData:`, {
                placementId: unitData.placementId,
                squadUnits: unitData.squadUnits,
                unitTypeId: unitData.unitTypeId,
                collection: unitData.collection
            });

            // Check if placement already exists on this client
            const existingPlacement = existingPlacements.find(p => p.placementId === unitData.placementId);
            if (existingPlacement) {
                console.log(`[applyNetworkUnitData] Placement ${unitData.placementId} exists, checking for unit type mismatch`);

                // Check if unit type changed (e.g., specialization during placement phase)
                const squadUnits = existingPlacement.squadUnits || unitData.squadUnits || [];
                if (squadUnits.length > 0) {
                    const firstEntityId = squadUnits[0];
                    const existingUnitType = this.game.getComponent(firstEntityId, 'unitType');
                    const expectedUnitTypeId = unitData.unitTypeId;

                    console.log(`[applyNetworkUnitData] Existing placement check: existingUnitType.type=${existingUnitType?.type}, expectedUnitTypeId=${expectedUnitTypeId}`);

                    if (existingUnitType && existingUnitType.type !== expectedUnitTypeId) {
                        // Unit type changed - transform the existing units
                        console.log(`[applyNetworkUnitData] Unit type mismatch in existing placement! Transforming units.`);

                        const targetUnitTypeId = this.reverseEnums?.units?.[expectedUnitTypeId];
                        if (targetUnitTypeId && this.game.hasService('replaceUnit')) {
                            console.log(`[applyNetworkUnitData] Replacing ${squadUnits.length} units with ${targetUnitTypeId}`);
                            squadUnits.forEach(entityId => {
                                if (this.game.entityAlive[entityId] === 1) {
                                    console.log(`[applyNetworkUnitData] Calling replaceUnit for entity ${entityId} -> ${targetUnitTypeId}`);
                                    this.game.call('replaceUnit', entityId, targetUnitTypeId);
                                }
                            });
                        } else {
                            console.log(`[applyNetworkUnitData] Cannot replace: targetUnitTypeId=${targetUnitTypeId}, hasReplaceUnit=${this.game.hasService('replaceUnit')}`);
                        }
                    } else {
                        console.log(`[applyNetworkUnitData] Unit types match for existing placement, no transformation needed`);
                    }
                }
                return; // Don't re-spawn existing placements
            }

            // Check if server-provided entity IDs already exist (from previous round)
            if (unitData.squadUnits && unitData.squadUnits.length > 0) {
                const firstEntityId = unitData.squadUnits[0];
                const entityExists = this.game.entityAlive[firstEntityId] === 1;
                console.log(`[applyNetworkUnitData] Checking entity ${firstEntityId}: entityAlive=${entityExists}`);
                if (entityExists) {
                    // Entity exists - check if unit type matches (might have been specialized)
                    const existingUnitType = this.game.getComponent(firstEntityId, 'unitType');
                    const expectedUnitTypeId = unitData.unitTypeId;

                    console.log(`[applyNetworkUnitData] Comparing unit types for entity ${firstEntityId}: existingUnitType.type=${existingUnitType?.type}, expectedUnitTypeId=${expectedUnitTypeId}`);

                    if (existingUnitType && existingUnitType.type !== expectedUnitTypeId) {
                        // Unit type changed (e.g., specialization) - replace the units
                        console.log(`[applyNetworkUnitData] Unit type mismatch for entity ${firstEntityId}: existing=${existingUnitType.type}, expected=${expectedUnitTypeId}. Applying transformation.`);

                        // Get the target unit type ID string from the enum
                        const targetUnitTypeId = this.reverseEnums?.units?.[expectedUnitTypeId];
                        console.log(`[applyNetworkUnitData] Target unit type ID string: ${targetUnitTypeId}, hasReplaceUnit=${this.game.hasService('replaceUnit')}`);

                        if (targetUnitTypeId && this.game.hasService('replaceUnit')) {
                            // Replace each unit in the squad
                            console.log(`[applyNetworkUnitData] Replacing ${unitData.squadUnits.length} units with ${targetUnitTypeId}`);
                            unitData.squadUnits.forEach(entityId => {
                                if (this.game.entityAlive[entityId] === 1) {
                                    console.log(`[applyNetworkUnitData] Calling replaceUnit for entity ${entityId} -> ${targetUnitTypeId}`);
                                    this.game.call('replaceUnit', entityId, targetUnitTypeId);
                                }
                            });
                        } else {
                            console.log(`[applyNetworkUnitData] Cannot replace: targetUnitTypeId=${targetUnitTypeId}, hasReplaceUnit=${this.game.hasService('replaceUnit')}`);
                        }
                    } else {
                        console.log(`[applyNetworkUnitData] Unit types match, no transformation needed`);
                    }

                    // Register the existing squad (whether transformed or not)
                    console.log(`[applyNetworkUnitData] Entity ${firstEntityId} already exists, registering existing squad for placementId=${unitData.placementId}`);
                    this.registerExistingSquad(unitData, team, playerId);
                    return;
                }
            } else {
                // Check if this is a pending building (no squadUnits because peasant hasn't built it yet)
                // These will be spawned by spawnPendingBuilding when the peasant arrives
                if (unitData.isPendingBuilding || unitData.assignedBuilder) {
                    console.log(`[applyNetworkUnitData] Skipping pending building placementId=${unitData.placementId} - will be spawned by builder ${unitData.assignedBuilder}`);
                    return;
                }
                console.log(`[applyNetworkUnitData] No squadUnits provided, will spawn new entities`);
            }

            // Store playerId on unitData for unit creation
            if (playerId) {
                unitData.playerId = playerId;
            }

            // Resolve unitType from numeric IDs if not already present
            if (!unitData.unitType && unitData.unitTypeId != null) {
                unitData.unitType = this.getUnitTypeFromPlacement(unitData);
            }

            // Spawn the squad for this team, using server-provided entity IDs if available
            this.spawnSquad(unitData, team, playerId, unitData.squadUnits);
        });
    }

    /**
     * Validate a placement request
     * @param {Object} placement - The placement data
     * @param {Object} player - The player data
     * @param {Object} playerStats - The player's stats component
     * @returns {boolean} Whether the placement is valid
     */
    validatePlacement(placement, player, playerStats) {
        if (placement.isStartingState) return true;

        // Calculate cost of unit
        const newUnitCost = placement.unitType?.value || 0;
        const playerGold = playerStats?.gold || 0;
        const playerTeam = player.team;

        if (newUnitCost > playerGold) {
            console.log('[validatePlacement] FAIL: Not enough gold', { newUnitCost, playerGold });
            return false;
        }

        // Only check supply for units, not buildings (buildings provide supply, not consume it)
        const isBuilding = placement.unitType?.collection === 'buildings' || placement.collection === this.enums?.objectTypeDefinitions?.buildings;
        if (!isBuilding && this.game.hasService('canAffordSupply') && !this.game.call('canAffordSupply', playerTeam, placement.unitType)) {
            console.log('[validatePlacement] FAIL: Not enough supply', { playerTeam, unitType: placement.unitType?.id });
            return false;
        }

        if (!placement.gridPosition || !placement.unitType) {
            console.log('[validatePlacement] FAIL: Missing gridPosition or unitType', { gridPosition: placement.gridPosition, unitType: placement.unitType?.id });
            return false;
        }

        // Validate team placement
        const squadData = this.game.call('getSquadData', placement.unitType);
        const cells = this.game.call('getSquadCells', placement.gridPosition, squadData);
        if (!this.game.call('isValidGridPlacement', cells, playerTeam)) {
            console.log('[validatePlacement] FAIL: Invalid grid placement', { gridPosition: placement.gridPosition, cells, playerTeam });
            return false;
        }

        // Gold mines can only be placed on unclaimed gold veins
        if (placement.unitType?.id === 'goldMine' && this.game.hasService('isValidGoldMinePlacement')) {
            const footprintWidth = placement.unitType.footprintWidth || 2;
            const footprintHeight = placement.unitType.footprintHeight || 2;
            const gridWidth = footprintWidth * 2;
            const gridHeight = footprintHeight * 2;

            const validation = this.game.call('isValidGoldMinePlacement',
                placement.gridPosition,
                gridWidth,
                gridHeight
            );

            if (!validation.valid) {
                console.log('[validatePlacement] FAIL: Gold mine must be placed on an unclaimed gold vein');
                return false;
            }
        }

        return true;
    }

    /**
     * Submit a placement - validates, deducts gold, spawns squad
     * @param {string} socketPlayerId - Socket player ID (for stats lookup)
     * @param {number} numericPlayerId - Numeric player ID (for ECS storage)
     * @param {Object} player - Player data
     * @param {Object} placement - Placement data
     * @param {number[]|null} serverEntityIds - Optional entity IDs from server (client uses these)
     * @returns {Object} Result with success, entityIds, etc.
     */
    placePlacement(socketPlayerId, numericPlayerId, player, placement, serverEntityIds = null) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        // Look up full unitType from collections
        const unitType = this.getUnitTypeFromPlacement(placement);
        if (!unitType) {
            return { success: false, error: `Unit type not found: collection=${placement.collection}, unitTypeId=${placement.unitTypeId}` };
        }

        // Build full placement with resolved unitType
        const fullPlacement = {
            ...placement,
            unitType: unitType,
            playerId: numericPlayerId
        };

        // Get player stats
        const playerStats = this.game.call('getPlayerStats', socketPlayerId);

        // Validate placement (skip if upgrading - already validated and grid released)
        if (!placement.skipValidation && !this.validatePlacement(fullPlacement, player, playerStats)) {
            return { success: false, error: 'Invalid placement' };
        }

        // Deduct gold for new units
        if (unitType.value > 0 && !fullPlacement.isStartingState && playerStats) {
            playerStats.gold -= unitType.value;
        }

        // Spawn entities (client passes serverEntityIds to match server's entity IDs)
        const result = this.spawnSquad(fullPlacement, player.team, numericPlayerId, serverEntityIds);

        return {
            success: result.success,
            squadUnits: result.squad?.squadUnits || [],
            placementId: result.squad?.placementId,
            serverTime: this.game.state.now,
            nextEntityId: this.game.nextEntityId
        };
    }

    /**
     * Remove dead squads after a battle round
     * Called when battle ends to clean up fully killed squads
     */
    removeDeadSquadsAfterRound() {
   
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        const processedPlacements = new Set();
        const placementsToCleanup = [];

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId || processedPlacements.has(placementComp.placementId)) {
                continue;
            }
            processedPlacements.add(placementComp.placementId);

            // Get all squad units for this placement
            const squadUnits = [];
            for (const eid of entitiesWithPlacement) {
                const pc = this.game.getComponent(eid, 'placement');
                if (pc?.placementId === placementComp.placementId) {
                    squadUnits.push(eid);
                }
            }

            // Check if squad has alive units
            const aliveUnits = squadUnits.filter(eid => {
                const health = this.game.getComponent(eid, "health");
                const deathState = this.game.getComponent(eid, "deathState");
                const buildingState = this.game.getComponent(eid, "buildingState");
                if (buildingState) return true;
                return health && health.current > 0 && (!deathState || deathState.state === this.enums.deathState.alive);
            });

            if (aliveUnits.length === 0) {
                placementsToCleanup.push({ ...placementComp, squadUnits });
            } else if (placementComp.experience) {
                // Update experience unitIds with alive units
                placementComp.experience.unitIds = aliveUnits;
            }
        }

        // Cleanup dead squads
        for (const placement of placementsToCleanup) {
            this.cleanupDeadSquad(placement);
        }
    }

    /**
     * Clear all placements for a specific player
     * @param {number} playerId - Numeric player ID
     */
    clearPlayerPlacements(playerId) {
        try {
            const entitiesWithPlacement = this.game.getEntitiesWith('placement');
            const entitiesToDestroy = [];

            for (const entityId of entitiesWithPlacement) {
                const placementComp = this.game.getComponent(entityId, 'placement');
                if (placementComp?.playerId === playerId) {
                    entitiesToDestroy.push({ entityId, placementId: placementComp.placementId });
                }
            }

            for (const { entityId } of entitiesToDestroy) {
                try {
                    // Release grid cells using entityId, not placementId
                    this.game.call('releaseGridCells', entityId);
                    this.game.destroyEntity(entityId);
                } catch (error) {
                    console.warn(`Error destroying entity ${entityId}:`, error);
                }
            }

        } catch (error) {
            console.error(`Error clearing placements for player ${playerId}:`, error);
        }
    }

    /**
     * Clear all placements
     */
    clearAllPlacements() {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            // Release grid cells using entityId, not placementId
            this.game.call('releaseGridCells', entityId);
            this.game.destroyEntity(entityId);
        }
    }

    /**
     * Called when battle ends
     */
    onBattleEnd() {
        this.removeDeadSquadsAfterRound();
    }

    // ==================== CAMERA METHODS ====================

    /**
     * Get camera height from main camera settings in collections
     * Falls back to 512 if not found
     */
    getCameraHeight() {
        if (this._cameraHeight !== undefined) {
            return this._cameraHeight;
        }

        const cameraSettings = this.collections.cameras.main;

        this._cameraHeight = cameraSettings.position.y || 512;

        return this._cameraHeight;
    }

    /**
     * Find a position for a unit relative to a building using fixed spiral pattern
     * Spirals outward: west → south → east → north
     * @param {Object} buildingGridPos - Grid position of the building
     * @param {Set} buildingCellSet - Set of cells occupied by the building
     * @param {Object} unitType - Unit type definition
     * @param {Object|null} targetWorldPos - Optional target world position to spawn units toward (e.g., gold vein)
     * @returns {Object|null} Grid position {x, z} or null if no valid position found
     */
    findBuildingAdjacentPosition(buildingGridPos, buildingCellSet, unitType, targetWorldPos = null) {
        // Generate positions starting from the side closest to target, going along that side first
        const offsets = [];
        const maxRadius = 16;

        // Calculate building bounds from buildingCellSet
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        if (buildingCellSet && buildingCellSet.size > 0) {
            for (const cellKey of buildingCellSet) {
                const [cx, cz] = cellKey.split(',').map(Number);
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minZ = Math.min(minZ, cz);
                maxZ = Math.max(maxZ, cz);
            }
        } else {
            // Fallback for no building cells
            minX = maxX = buildingGridPos.x;
            minZ = maxZ = buildingGridPos.z;
        }

        // Determine which side to start from based on target position
        // Default: west side
        let startSide = 'west';
        if (targetWorldPos) {
            const buildingWorldPos = this.game.call('placementGridToWorld', buildingGridPos.x, buildingGridPos.z);
            const dx = targetWorldPos.x - buildingWorldPos.x;
            const dz = targetWorldPos.z - buildingWorldPos.z;

            // Pick the side closest to target based on which axis has larger difference
            if (Math.abs(dx) >= Math.abs(dz)) {
                startSide = dx < 0 ? 'west' : 'east';
            } else {
                startSide = dz < 0 ? 'north' : 'south';
            }
        }

        // Define side order based on starting side (clockwise from start)
        const sideOrders = {
            'west': ['west', 'south', 'east', 'north'],
            'south': ['south', 'east', 'north', 'west'],
            'east': ['east', 'north', 'west', 'south'],
            'north': ['north', 'west', 'south', 'east']
        };
        const sides = sideOrders[startSide];

        // Generate positions layer by layer (distance from building)
        for (let layer = 1; layer <= maxRadius; layer++) {
            for (const side of sides) {
                if (side === 'west') {
                    // West side: x = minX - layer, z from minZ to maxZ
                    const x = minX - layer;
                    for (let z = minZ; z <= maxZ; z++) {
                        offsets.push({ x, z });
                    }
                } else if (side === 'east') {
                    // East side: x = maxX + layer, z from minZ to maxZ
                    const x = maxX + layer;
                    for (let z = minZ; z <= maxZ; z++) {
                        offsets.push({ x, z });
                    }
                } else if (side === 'north') {
                    // North side: z = minZ - layer, x from minX to maxX
                    const z = minZ - layer;
                    for (let x = minX; x <= maxX; x++) {
                        offsets.push({ x, z });
                    }
                } else if (side === 'south') {
                    // South side: z = maxZ + layer, x from minX to maxX
                    const z = maxZ + layer;
                    for (let x = minX; x <= maxX; x++) {
                        offsets.push({ x, z });
                    }
                }
            }
            // Add corners for this layer after all sides
            const corners = [
                { x: minX - layer, z: minZ - layer }, // NW
                { x: maxX + layer, z: minZ - layer }, // NE
                { x: minX - layer, z: maxZ + layer }, // SW
                { x: maxX + layer, z: maxZ + layer }  // SE
            ];
            for (const corner of corners) {
                offsets.push(corner);
            }
        }

        // Find first valid position (offsets are absolute grid positions)
        for (const testPos of offsets) {
            // Skip building cells
            if (buildingCellSet?.has(`${testPos.x},${testPos.z}`)) {
                continue;
            }

            // Check if unit would overlap building
            const unitSquadData = this.game.call('getSquadData', unitType);
            const unitCells = this.game.call('getSquadCells', testPos, unitSquadData);
            const overlapsBuilding = unitCells.some(cell =>
                buildingCellSet?.has(`${cell.x},${cell.z}`)
            );
            if (overlapsBuilding) {
                continue;
            }

            // Check grid occupancy - ensure position isn't already taken by other units
            const isOccupied = !this.game.call('isValidGridPlacement', unitCells);
            if (isOccupied) {
                continue;
            }

            // Found a valid position
            return testPos;
        }

        return null;
    }

    /**
     * Find spawn position for a unit relative to a building (by placementId)
     * @param {number} placementId - The building's placement ID
     * @param {Object} unitDef - Unit type definition (must have collection set)
     * @returns {Object|null} Grid position {x, z} or null if no valid position found
     */
    findBuildingSpawnPosition(placementId, unitDef) {
        const placement = this.game.call('getPlacementById', placementId);
        if (!placement) return null;

        const buildingGridPos = placement.gridPosition;
        if (!buildingGridPos) return null;

        // Get building unit type and compute its cells
        const buildingUnitType = this.game.call('getUnitTypeDef', {
            collection: placement.collection,
            type: placement.unitTypeId
        });
        const buildingSquadData = buildingUnitType ? this.game.call('getSquadData', buildingUnitType) : null;
        const buildingCells = buildingSquadData ? this.game.call('getSquadCells', buildingGridPos, buildingSquadData) : [];
        const buildingCellSet = new Set(buildingCells.map(cell => `${cell.x},${cell.z}`));

        // Find nearest gold vein to spawn units toward (include claimed veins)
        const buildingWorldPos = this.game.call('placementGridToWorld', buildingGridPos.x, buildingGridPos.z);
        const nearestVein = this.game.call('findNearestGoldVein', buildingWorldPos, false);
        const goldVeinPos = nearestVein?.position || null;

        return this.findBuildingAdjacentPosition(buildingGridPos, buildingCellSet, unitDef, goldVeinPos);
    }

    /**
     * Calculate camera position for a given team based on level starting location
     * @param {number} team - numeric team enum value
     * @returns {Object|null} { position: {x,y,z}, lookAt: {x,y,z} } or null
     */
    getCameraPositionForTeam(team) {
        const startingLocations = this.getStartingLocationsFromLevel();
        if (!startingLocations || !startingLocations[team]) {
            console.warn(`[PlacementSystem] No starting location for team: ${team}`);
            return null;
        }

        const tilePosition = startingLocations[team];

        const pitch = 35.264 * Math.PI / 180;
        const yaw = 135 * Math.PI / 180;
        const distance = this.getCameraHeight();

        const cdx = Math.sin(yaw) * Math.cos(pitch);
        const cdz = Math.cos(yaw) * Math.cos(pitch);

        const worldPos = this.game.call('tileToWorld', tilePosition.x, tilePosition.z);

        return {
            position: {
                x: worldPos.x - cdx * distance,
                y: distance,
                z: worldPos.z - cdz * distance
            },
            lookAt: {
                x: worldPos.x,
                y: 0,
                z: worldPos.z
            }
        };
    }

    /**
     * Set up a pending building on a peasant/builder
     * The building entity won't be created until the builder arrives and starts building
     * @param {number} builderId - The peasant/builder entity ID
     * @param {Object} buildingData - Full building placement data
     */
    setupPendingBuild(builderId, buildingData) {
        const buildTime = buildingData.peasantInfo?.buildTime || buildingData.unitType?.buildTime || 1;
        const gridPosition = buildingData.gridPosition;

        // Calculate world position from grid position
        const worldPos = this.game.call('placementGridToWorld', gridPosition.x, gridPosition.z);
        const terrainHeight = this.game.call('getTerrainHeight', worldPos.x, worldPos.z) || 0;

        // Set buildingState for the builder with pending building data
        let buildingState = this.game.getComponent(builderId, "buildingState");
        if (!buildingState) {
            this.game.addComponent(builderId, "buildingState", {
                targetBuildingEntityId: -1,
                buildTime: buildTime,
                constructionStartTime: 0,
                pendingGridPosition: { x: gridPosition.x, z: gridPosition.z },
                pendingUnitTypeId: buildingData.unitTypeId,
                pendingCollection: buildingData.collection
            });
        } else {
            buildingState.targetBuildingEntityId = -1;
            buildingState.buildTime = buildTime;
            buildingState.constructionStartTime = 0;
            buildingState.pendingGridPosition.x = gridPosition.x;
            buildingState.pendingGridPosition.z = gridPosition.z;
            buildingState.pendingUnitTypeId = buildingData.unitTypeId;
            buildingState.pendingCollection = buildingData.collection;
        }

        // Set playerOrder for movement to the building position
        let playerOrder = this.game.getComponent(builderId, "playerOrder");
        if (!playerOrder) {
            this.game.addComponent(builderId, "playerOrder", {
                enabled: true,
                targetPositionX: worldPos.x,
                targetPositionY: terrainHeight,
                targetPositionZ: worldPos.z,
                isMoveOrder: false,
                preventEnemiesInRangeCheck: true,
                completed: false,
                issuedTime: this.game.state.now
            });
        } else {
            playerOrder.enabled = true;
            playerOrder.targetPositionX = worldPos.x;
            playerOrder.targetPositionY = terrainHeight;
            playerOrder.targetPositionZ = worldPos.z;
            playerOrder.isMoveOrder = false;
            playerOrder.preventEnemiesInRangeCheck = true;
            playerOrder.completed = false;
            playerOrder.issuedTime = this.game.state.now;
        }
        this.game.triggerEvent('onIssuedPlayerOrders', builderId);

        const aiState = this.game.getComponent(builderId, "aiState");
        if (aiState) {
            aiState.currentAction = null;
            aiState.currentActionCollection = null;
            this.game.call('clearBehaviorState', builderId);
        }
    }

    /**
     * Spawn a pending building when the builder arrives and starts construction
     * Called by ConstructBuildingBehaviorAction when construction begins
     * @param {number} builderId - The peasant/builder entity ID
     * @returns {number|null} The spawned building entity ID, or null if failed
     */
    spawnPendingBuilding(builderId) {
        const buildingState = this.game.getComponent(builderId, "buildingState");
        if (!buildingState || buildingState.pendingUnitTypeId == null) {
            return null;
        }

        // Check if building already exists (from ECS sync or previous spawn)
        if (buildingState.targetBuildingEntityId > 0 && this.game.entityAlive[buildingState.targetBuildingEntityId] === 1) {
            console.log(`[spawnPendingBuilding] Building entity ${buildingState.targetBuildingEntityId} already exists for builder ${builderId}, skipping spawn`);
            return buildingState.targetBuildingEntityId;
        }

        const gridPosition = buildingState.pendingGridPosition;
        const unitTypeId = buildingState.pendingUnitTypeId;
        const collection = buildingState.pendingCollection;

        // Get team and playerId from the builder
        const builderTeam = this.game.getComponent(builderId, "team");
        const builderPlacement = this.game.getComponent(builderId, "placement");
        const team = builderTeam?.team;
        const playerId = builderPlacement?.playerId;

        // Resolve unitType from collections
        const unitType = this.getUnitTypeFromPlacement({ collection, unitTypeId });
        if (!unitType) {
            return null;
        }

        // Calculate world position
        const worldPos = this.game.call('placementGridToWorld', gridPosition.x, gridPosition.z);
        const terrainHeight = this.game.call('getTerrainHeight', worldPos.x, worldPos.z) || 0;

        // Get squad data for grid cells
        const squadData = this.game.call('getSquadData', unitType);
        const cells = this.game.call('getSquadCells', gridPosition, squadData);

        // Generate new placementId
        const placementId = this._getNextPlacementId();

        // Create the building entity
        const fullNetworkData = {
            placementId,
            gridPosition,
            unitTypeId,
            collection,
            unitType,
            team,
            playerId,
            isUnderConstruction: true,
            buildTime: buildingState.buildTime,
            assignedBuilder: builderId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now
        };

        const transform = {
            position: { x: worldPos.x, y: terrainHeight, z: worldPos.z }
        };

        const buildingEntityId = this.game.call('createPlacement',
            fullNetworkData,
            transform,
            team,
            null // Let system assign entity ID
        );

        // Reserve grid cells
        this.game.call('reserveGridCells', cells, buildingEntityId);

        // Update buildingState to point to the new building entity and clear pending data
        buildingState.targetBuildingEntityId = buildingEntityId;
        buildingState.pendingGridPosition.x = 0;
        buildingState.pendingGridPosition.z = 0;
        buildingState.pendingUnitTypeId = null;
        buildingState.pendingCollection = null;

        // Initialize in experience system
        this.game.call('initializeSquad', placementId, unitType, [buildingEntityId]);

        return buildingEntityId;
    }
}
