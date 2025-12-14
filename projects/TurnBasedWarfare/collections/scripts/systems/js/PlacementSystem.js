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

        // Register services that both client and server use
        this.game.register('getPlacementsForSide', this.getPlacementsForSide.bind(this));
        this.game.register('getPlacementById', this.getPlacementById.bind(this));
        this.game.register('placePlacement', this.placePlacement.bind(this));
        this.game.register('validatePlacement', this.validatePlacement.bind(this));
        this.game.register('spawnSquad', this.spawnSquad.bind(this));
        this.game.register('resetAI', this.resetAI.bind(this));
        this.game.register('clearPlayerPlacements', this.clearPlayerPlacements.bind(this));
        this.game.register('clearAllPlacements', this.clearAllPlacements.bind(this));
        this.game.register('getCameraPositionForTeam', this.getCameraPositionForTeam.bind(this));
        this.game.register('applyNetworkUnitData', this.applyNetworkUnitData.bind(this));

        console.log('[PlacementSystem] Initialized');
    }

    /**
     * Called when scene loads - spawn starting units deterministically
     */
    onSceneLoad(sceneData) {
        console.log('[PlacementSystem] onSceneLoad - spawning starting units');
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
     * @param {Object} placement - The placement object
     */
    cleanupDeadSquad(placement) {
        if (placement.placementId) {
            this.game.call('releaseGridCells', placement.placementId);
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
                console.log('[PlacementSystem] Invalid squad config');
                return { success: false, error: 'Invalid squad config' };
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
                    const peasantAbilities = this.game.call('getEntityAbilities', peasantId);
                    if (peasantAbilities) {
                        const buildAbility = peasantAbilities.find(a => a.id === 'build');
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
            console.error('[PlacementSystem] Squad spawn failed:', error);
            return { success: false, error: error.message };
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
        const startingUnitsConfig = this.collections.configs.startingUnits;

        if (!startingUnitsConfig?.prefabs) {
            console.warn('[PlacementSystem] No startingUnits config found');
            return { success: false, error: 'No startingUnits config' };
        }

        // Get starting locations from level
        const startingLocations = this.getStartingLocationsFromLevel();
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

            const teamResult = this.spawnStartingUnitsForTeam(
                startingUnitsConfig.prefabs,
                team,
                worldPos
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

        console.log('[PlacementSystem] Starting units spawned:', result);
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
        // Query gold vein entities directly from ECS (worldObject component with type: 'goldVein')
        const worldObjectEntities = this.game.getEntitiesWith('worldObject', 'transform');

        // Get numeric enum index for goldVein type (worldObject.type is now numeric)
        const goldVeinTypeIndex = this.game.getEnums()?.worldObjects?.goldVein ?? -1;

        // Find all gold vein entities and track which are already claimed by existing gold mines
        const claimedVeinPositions = new Set();
        const goldMineEntities = this.game.getEntitiesWith('goldMine');
        for (const mineId of goldMineEntities) {
            const mineTransform = this.game.getComponent(mineId, 'transform');
            if (mineTransform?.position) {
                // Use rounded position as key to match gold vein positions
                const key = `${Math.round(mineTransform.position.x)},${Math.round(mineTransform.position.z)}`;
                claimedVeinPositions.add(key);
            }
        }

        // Find the nearest unclaimed gold vein entity
        let nearestVeinEntityId = null;
        let nearestVeinPos = null;
        let nearestDistance = Infinity;

        // Sort entity IDs for deterministic iteration
        const sortedEntities = Array.from(worldObjectEntities).sort((a, b) => a - b);

        for (const entityId of sortedEntities) {
            const worldObj = this.game.getComponent(entityId, 'worldObject');
            // worldObject.type is now a numeric index - compare to goldVein enum index
            if (worldObj?.type !== goldVeinTypeIndex) continue;

            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            // Check if this vein is already claimed
            const posKey = `${Math.round(pos.x)},${Math.round(pos.z)}`;
            if (claimedVeinPositions.has(posKey)) continue;

            const dx = pos.x - startingWorldPos.x;
            const dz = pos.z - startingWorldPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestVeinEntityId = entityId;
                nearestVeinPos = pos;
            }
        }

        if (!nearestVeinEntityId) {
            console.warn('[PlacementSystem] No unclaimed gold vein entity found for team:', team);
            return { success: false, error: 'No unclaimed gold veins' };
        }

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
        // team is expected to already be numeric from game.state.myTeam
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

            console.log(`[PlacementSystem] Spawned starting gold mine for team ${team} at position:`, gridPos);
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
     * @returns {Object} Result with spawned entity IDs
     */
    spawnStartingUnitsForTeam(prefabs, team, startingWorldPos) {
        const spawnedUnits = [];

        for (let i = 0; i < prefabs.length; i++) {
            const prefabDef = prefabs[i];
            const collection = prefabDef.collection;
            const spawnType = prefabDef.spawnType;

            // Get the unit type from collections
            const unitType = this.collections[collection]?.[spawnType];
            if (!unitType) {
                console.error(`[PlacementSystem] Unit type not found: ${collection}/${spawnType}`);
                continue;
            }

            // Get relative position from prefab definition
            const relativePos = prefabDef.components?.transform?.position || { x: 0, y: 0, z: 0 };

            // Calculate absolute world position
            const worldX = startingWorldPos.x + relativePos.x;
            const worldZ = startingWorldPos.z + relativePos.z;

            // Convert world position to placement grid position
            const gridPos = this.game.call('worldToPlacementGrid', worldX, worldZ);

            // Generate numeric placement ID
            const placementId = this._getNextPlacementId();

            // Get enum indices for numeric storage
            const enums = this.game.getEnums();
            const collectionIndex = enums.objectTypeDefinitions?.[collection] ?? -1;
            const typeIndex = enums[collection]?.[spawnType] ?? -1;

            // Build placement data with numeric indices
            // team is expected to already be numeric from game.state.myTeam
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
        if (terrainEntities.length === 0) {
            console.warn('[PlacementSystem] No terrain entity found');
            return null;
        }

        const terrainEntityId = terrainEntities[0];
        const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
        const levelIndex = terrainComponent?.level;
        if (levelIndex === undefined || levelIndex < 0) {
            console.warn('[PlacementSystem] Terrain entity missing level');
            return null;
        }

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
            // Skip if already placed
            if (existingPlacements.find(p => p.placementId === unitData.placementId)) {
                return;
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
            console.log(`Player ${player.id} insufficient gold: ${newUnitCost} > ${playerGold}`);
            return false;
        }

        if (this.game.hasService('canAffordSupply') && !this.game.call('canAffordSupply', playerTeam, placement.unitType)) {
            console.log(`Player ${player.id} insufficient supply for unit: ${placement.unitType.id}`);
            return false;
        }

        if (!placement.gridPosition || !placement.unitType) {
            console.log(`Player ${player.id} invalid placement data:`, placement);
            return false;
        }

        // Validate team placement
        const squadData = this.game.call('getSquadData', placement.unitType);
        const cells = this.game.call('getSquadCells', placement.gridPosition, squadData);
        if (!this.game.call('isValidGridPlacement', cells, playerTeam)) {
            console.log('Invalid Placement', placement);
            return false;
        }

        return true;
    }

    /**
     * Submit a placement - validates, deducts gold, spawns squad
     * @param {string} socketPlayerId - Socket player ID (for stats lookup)
     * @param {number} numericPlayerId - Numeric player ID (for ECS storage)
     * @param {Object} player - Player data
     * @param {Object} placement - Placement data
     * @returns {Object} Result with success, entityIds, etc.
     */
    placePlacement(socketPlayerId, numericPlayerId, player, placement) {
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

        // Validate placement
        if (!this.validatePlacement(fullPlacement, player, playerStats)) {
            return { success: false, error: 'Invalid placement' };
        }

        // Deduct gold for new units
        if (unitType.value > 0 && !fullPlacement.isStartingState && playerStats) {
            playerStats.gold -= unitType.value;
        }

        // Spawn entities
        const result = this.spawnSquad(fullPlacement, player.team, numericPlayerId);

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
        if (!this.game.componentSystem) return;

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

            for (const { entityId, placementId } of entitiesToDestroy) {
                try {
                    if (placementId) {
                        this.game.call('releaseGridCells', placementId);
                    }
                    this.game.destroyEntity(entityId);
                } catch (error) {
                    console.warn(`Error destroying entity ${entityId}:`, error);
                }
            }

            console.log(`Cleared placements for player ${playerId}`);
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
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId) {
                this.game.call('releaseGridCells', placementComp.placementId);
            }
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
}
