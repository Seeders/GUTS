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
     * @returns {Object} Result with success flag and squad data
     */
    spawnSquad(placement, team, playerId = null) {
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
            for (const pos of unitPositions) {
                const terrainHeight = this.game.unitCreationSystem.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const transform = {
                    position: { x: pos.x, y: unitY, z: pos.z }
                };
                const entityId = this.game.call('createPlacement',
                    fullPlacement,
                    transform,
                    team,
                    playerId
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
            if (placement.peasantInfo && placement.collection === 'buildings') {
                const peasantInfo = placement.peasantInfo;
                const peasantId = peasantInfo.peasantId;
                const buildingEntityId = squadUnits[0];

                const peasantAbilities = this.game.call('getEntityAbilities', peasantId);
                if (peasantAbilities) {
                    const buildAbility = peasantAbilities.find(a => a.id === 'build');
                    if (buildAbility) {
                        buildAbility.assignToBuild(peasantId, buildingEntityId, peasantInfo);
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
}
