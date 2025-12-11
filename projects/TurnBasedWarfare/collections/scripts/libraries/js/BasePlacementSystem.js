/**
 * BasePlacementSystem - Shared functionality for placement systems
 *
 * Both MultiplayerPlacementSystem (client) and ServerPlacementSystem (server)
 * extend this base class to share entity query logic.
 *
 * Placements are stored as components on entities - no cached arrays.
 * This class provides the core methods for querying placement data from entities.
 */
class BasePlacementSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.placementSystem = this;
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
     * @param {string} side - The team side ('left' or 'right')
     * @returns {Array} Array of placement objects with squadUnits
     */
    getPlacementsForSide(side) {
        const placements = [];
        const seenPlacementIds = new Set();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId) continue;
            if (placementComp.team !== side) continue;
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
                return this.game.getComponent(entityId, 'unitType');
            }
        }
        return null;
    }

    /**
     * Spawn a squad from placement data - shared by both client and server
     * @param {Object} placement - Placement data with gridPosition, unitType, team, etc.
     * @param {string} team - Team identifier ('left' or 'right')
     * @param {string|null} playerId - Optional player ID
     * @param {number[]|null} serverEntityIds - Optional array of entity IDs from server (client uses these to match server)
     * @returns {Object} Result with success flag and squad data
     */
    spawnSquad(placement, team, playerId = null, serverEntityIds = null) {
        try {
            const unitType = placement.unitType;
            if (!unitType) {
                console.error('[BasePlacementSystem] Missing unitType in placement');
                return { success: false, error: 'Missing unitType' };
            }

            const gridPosition = placement.gridPosition;
            const targetPosition = placement.targetPosition;

            // Get squad configuration
            const squadData = this.game.squadSystem.getSquadData(unitType);
            const validation = this.game.squadSystem.validateSquadConfig(squadData);

            if (!validation.valid) {
                console.log('[BasePlacementSystem] Invalid squad config');
                return { success: false, error: 'Invalid squad config' };
            }

            // Calculate unit positions within the squad
            const unitPositions = this.game.squadSystem.calculateUnitPositions(
                gridPosition,
                unitType
            );

            // Calculate cells occupied by the squad
            const cells = this.game.squadSystem.getSquadCells(gridPosition, squadData);

            // Generate placement ID if not provided
            const placementId = placement.placementId || `squad_${team}_${gridPosition.x}_${gridPosition.z}_${this.game.state.round}`;

            // Build placement object with all required data
            const fullPlacement = {
                ...placement,
                placementId,
                team,
                playerId
            };

            const squadUnits = [];

            // Create individual units for the squad
            for (let i = 0; i < unitPositions.length; i++) {
                const pos = unitPositions[i];
                const terrainHeight = this.game.unitCreationSystem.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const transform = {
                    position: { x: pos.x, y: unitY, z: pos.z }
                };

                // Use server-provided entity ID if available, otherwise let server assign
                const serverEntityId = serverEntityIds ? serverEntityIds[i] : null;
                const entityId = this.game.call('createPlacement',
                    fullPlacement,
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
            if (placement.collection === 'buildings') {
                const buildingEntityId = squadUnits[0];
                let peasantId = null;
                let peasantInfo = null;

                if (placement.peasantInfo) {
                    // Local placement - use peasantInfo
                    peasantInfo = placement.peasantInfo;
                    peasantId = peasantInfo.peasantId;
                } else if (placement.assignedBuilder && placement.isUnderConstruction) {
                    // Synced from server - reconstruct peasantInfo from placement data
                    peasantId = placement.assignedBuilder;
                    peasantInfo = {
                        peasantId: peasantId,
                        buildTime: placement.buildTime
                    };
                }

                if (peasantId && peasantInfo) {
                    const peasantAbilities = this.game.call('getEntityAbilities', peasantId);
                    if (peasantAbilities) {
                        const buildAbility = peasantAbilities.find(a => a.id === 'build');
                        if (buildAbility) {
                            // Pass serverTime for issuedTime sync (undefined on server, provided by client)
                            buildAbility.assignToBuild(peasantId, buildingEntityId, peasantInfo, placement.serverTime);
                        }
                    }
                }

                this.game.state.peasantBuildingPlacement = null;
            }

            // Update squad creation statistics
            if (this.game.unitCreationSystem?.stats) {
                this.game.unitCreationSystem.stats.squadsCreated++;
            }

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
            console.error('[BasePlacementSystem] Squad spawn failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get unitType from collections using placement's unitTypeId and collection
     * @param {Object} placement - Placement with unitTypeId and collection
     * @returns {Object|null} The unitType definition or null
     */
    getUnitTypeFromPlacement(placement) {
        const collections = this.game.getCollections();
        return collections[placement.collection]?.[placement.unitTypeId] || null;
    }

    /**
     * Spawn starting units for all teams deterministically.
     * Called by both client and server during scene load.
     * Left team spawns first, then right team - ensuring consistent entity IDs.
     * @returns {Object} Result with spawned units per team
     */
    spawnStartingUnits() {
        const collections = this.game.getCollections();
        const startingUnitsConfig = collections.configs?.startingUnits;

        if (!startingUnitsConfig?.prefabs) {
            console.warn('[BasePlacementSystem] No startingUnits config found');
            return { success: false, error: 'No startingUnits config' };
        }

        // Get starting locations from level
        const startingLocations = this.getStartingLocationsFromLevel();
        if (!startingLocations) {
            console.error('[BasePlacementSystem] No starting locations found in level');
            return { success: false, error: 'No starting locations in level' };
        }

        const result = {
            success: true,
            teams: {}
        };

        // Spawn in deterministic order: left first, then right
        // IMPORTANT: Spawn ALL units first, then ALL gold mines to ensure
        // entity IDs are consistent between client and server
        const teams = ['left', 'right'];
        const teamWorldPositions = {};

        // Phase 1: Spawn all units for both teams
        for (const team of teams) {
            const startingLoc = startingLocations[team];
            if (!startingLoc) {
                console.warn(`[BasePlacementSystem] No starting location for team: ${team}`);
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

        console.log('[BasePlacementSystem] Starting units spawned:', result);
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
            if (worldObj?.type !== 'goldVein') continue;

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
            console.warn('[BasePlacementSystem] No unclaimed gold vein entity found for team:', team);
            return { success: false, error: 'No unclaimed gold veins' };
        }

        // Get gold mine building type
        const collections = this.game.getCollections();
        const goldMineType = collections.buildings?.goldMine;
        if (!goldMineType) {
            console.error('[BasePlacementSystem] Gold mine building type not found');
            return { success: false, error: 'Gold mine type not found' };
        }

        // Convert world position to placement grid position
        const gridPos = this.game.call('worldToPlacementGrid', nearestVeinPos.x, nearestVeinPos.z);
        const placementId = `starting_${team}_goldMine`;

        // Build placement data
        const placement = {
            placementId,
            gridPosition: gridPos,
            unitTypeId: 'goldMine',
            collection: 'buildings',
            team: team,
            isStartingState: true,
            unitType: goldMineType
        };

        // Calculate cells for grid reservation
        const footprintWidth = goldMineType.footprintWidth || 2;
        const footprintHeight = goldMineType.footprintHeight || 2;
        const gridWidth = footprintWidth * 2;
        const gridHeight = footprintHeight * 2;

        if (this.game.squadSystem) {
            const squadData = this.game.squadSystem.getSquadData(goldMineType);
            placement.cells = this.game.squadSystem.getSquadCells(gridPos, squadData);
        }

        // Spawn the gold mine building
        const result = this.spawnSquad(placement, team, null, null);

        if (result.success && result.squad?.squadUnits?.length > 0) {
            const entityId = result.squad.squadUnits[0];

            // Register with gold mine system - pass the vein entity ID directly
            // to avoid cell matching issues due to position rounding
            this.game.call('buildGoldMine', entityId, team, gridPos, gridWidth, gridHeight, nearestVeinEntityId);

            console.log(`[BasePlacementSystem] Spawned starting gold mine for team ${team} at position:`, gridPos);
            return {
                success: true,
                entityId: entityId,
                gridPosition: gridPos,
                veinEntityId: nearestVeinEntityId
            };
        }

        console.error('[BasePlacementSystem] Failed to spawn starting gold mine for team:', team);
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
        const collections = this.game.getCollections();
        const spawnedUnits = [];

        for (let i = 0; i < prefabs.length; i++) {
            const prefabDef = prefabs[i];
            const collection = prefabDef.collection;
            const spawnType = prefabDef.spawnType;

            // Get the unit type from collections
            const unitType = collections[collection]?.[spawnType];
            if (!unitType) {
                console.error(`[BasePlacementSystem] Unit type not found: ${collection}/${spawnType}`);
                continue;
            }

            // Get relative position from prefab definition
            const relativePos = prefabDef.components?.transform?.position || { x: 0, y: 0, z: 0 };

            // Calculate absolute world position
            const worldX = startingWorldPos.x + relativePos.x;
            const worldZ = startingWorldPos.z + relativePos.z;

            // Convert world position to placement grid position
            const gridPos = this.game.call('worldToPlacementGrid', worldX, worldZ);

            // Generate placement ID
            const placementId = `starting_${team}_${spawnType}_${i}`;

            // Build placement data
            const placement = {
                placementId,
                gridPosition: gridPos,
                unitTypeId: spawnType,
                collection: collection,
                team: team,
                isStartingState: true,
                unitType
            };

            // Calculate cells for grid reservation
            if (this.game.squadSystem) {
                const squadData = this.game.squadSystem.getSquadData(unitType);
                placement.cells = this.game.squadSystem.getSquadCells(gridPos, squadData);
            }

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
                console.error(`[BasePlacementSystem] Failed to spawn starting unit: ${spawnType}`, result.error);
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
            console.warn('[BasePlacementSystem] No terrain entity found');
            return null;
        }

        const terrainEntityId = terrainEntities[0];
        const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
        if (!terrainComponent?.level) {
            console.warn('[BasePlacementSystem] Terrain entity missing level');
            return null;
        }

        // Get level data from collections
        const level = this.game.getCollections().levels[terrainComponent.level];
        if (!level?.tileMap?.startingLocations) {
            console.warn(`[BasePlacementSystem] Level '${terrainComponent.level}' has no startingLocations`);
            return null;
        }

        // Build locations map
        const locations = {};
        for (const loc of level.tileMap.startingLocations) {
            if (loc.side && loc.gridX !== undefined) {
                locations[loc.side] = { x: loc.gridX, z: loc.gridZ };
            }
        }

        return locations;
    }

    /**
     * Get camera height from main camera settings in collections
     * Falls back to 512 if not found
     */
    getCameraHeight() {
        if (this._cameraHeight !== undefined) {
            return this._cameraHeight;
        }

        const collections = this.game.getCollections();
        const cameraSettings = collections?.cameras?.main;

        this._cameraHeight = cameraSettings?.position?.y || 512;

        return this._cameraHeight;
    }

    /**
     * Calculate camera position for a given side based on level starting location
     * @param {string} side - 'left' or 'right'
     * @returns {Object|null} { position: {x,y,z}, lookAt: {x,y,z} } or null
     */
    getCameraPositionForSide(side) {
        const startingLocations = this.getStartingLocationsFromLevel();
        if (!startingLocations || !startingLocations[side]) {
            console.warn(`[BasePlacementSystem] No starting location for side: ${side}`);
            return null;
        }

        const tilePosition = startingLocations[side];

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
