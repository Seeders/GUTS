/**
 * AIPlacementSystem - Handles AI opponent placement in local game mode
 * Manages both building construction and unit recruitment
 */
class AIPlacementSystem extends GUTS.BaseSystem {
    static services = [
        'generateAIPlacement'
    ];

    constructor(game) {
        super(game);
        this.game.aiPlacementSystem = this;
        this.aiPlacementIds = [];
        this.nextAIPlacementId = 10000; // Start high to avoid collision with player placements
    }

    init() {
    }

    /**
     * Generate AI placement for the current round
     * Called by SkirmishGameSystem after game scene loads
     * @param {number} aiTeam - The AI's team (numeric enum value)
     */
    generateAIPlacement(aiTeam) {
        if (!this.game.state.isLocalGame) {
            return;
        }

        // Get AI's current gold
        const aiStats = this.game.call('getPlayerStatsByTeam', aiTeam);
        let remainingBudget = aiStats?.gold || 100;

        // Phase 1: Build buildings if needed
        remainingBudget = this.purchaseBuildings(aiTeam, remainingBudget);

        // Phase 2: Purchase units from existing buildings
        remainingBudget = this.purchaseUnits(aiTeam, remainingBudget);

        // Update AI gold
        if (aiStats) {
            aiStats.gold = remainingBudget;
        }
    }

    // ==================== BUILDING PLACEMENT ====================

    /**
     * Purchase and place buildings for the AI
     * @param {number} aiTeam - The AI's team
     * @param {number} budget - Available gold
     * @returns {number} Remaining budget after purchases
     */
    purchaseBuildings(aiTeam, budget) {
        let remainingBudget = budget;

        // Get buildings AI already owns
        const ownedBuildings = this.getOwnedBuildingTypes(aiTeam);

        // Get buildings AI can purchase
        const availableBuildings = this.getAvailableBuildings(aiTeam, ownedBuildings);

        if (availableBuildings.length === 0) {
            return remainingBudget;
        }

        // Select buildings to purchase based on strategy
        const buildingsToPurchase = this.selectBuildingsForBudget(availableBuildings, remainingBudget, ownedBuildings);

        // Place each building
        for (const building of buildingsToPurchase) {
            if (building.value > remainingBudget) continue;

            const placed = this.placeBuilding(building, aiTeam);
            if (placed) {
                remainingBudget -= building.value;
            }
        }

        return remainingBudget;
    }

    /**
     * Get set of building types the AI already owns
     * @param {number} aiTeam - The AI's team
     * @returns {Set<string>} Set of owned building type IDs
     */
    getOwnedBuildingTypes(aiTeam) {
        const owned = new Set();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement', 'team', 'unitType');

        for (const entityId of entitiesWithPlacement) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp?.team !== aiTeam) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType || unitType.collection !== 'buildings') continue;

            owned.add(unitType.id);
        }

        return owned;
    }

    /**
     * Get all buildings available for purchase
     * @param {number} aiTeam - The AI's team
     * @param {Set<string>} ownedBuildings - Buildings AI already owns
     * @returns {Array} Array of building definitions with metadata
     */
    getAvailableBuildings(aiTeam, ownedBuildings) {
        const available = [];
        const buildings = this.collections.buildings;

        if (!buildings) return available;

        for (const [buildingId, building] of Object.entries(buildings)) {
            // Skip buildings we can't buy
            if (building.buyable === false) continue;
            if (!building.value || building.value <= 0) continue;

            // Skip town halls (category: townhall) - AI starts with one
            if (building.category === 'townhall') continue;

            // Check requirements
            if (building.requiresBuildings && building.requiresBuildings.length > 0) {
                const meetsRequirements = building.requiresBuildings.every(req => ownedBuildings.has(req));
                if (!meetsRequirements) continue;
            }

            // Get enum indices for placement
            const collectionIndex = this.enums.objectTypeDefinitions?.buildings;
            const buildingIndex = this.enums.buildings?.[buildingId];

            if (collectionIndex !== undefined && buildingIndex !== undefined) {
                available.push({
                    ...building,
                    id: buildingId,
                    collection: collectionIndex,
                    buildingIndex: buildingIndex
                });
            }
        }

        return available;
    }

    /**
     * Select which buildings to purchase based on strategy
     * Priority: Unit production buildings > Economy/Supply > Defensive
     * @param {Array} availableBuildings - Buildings available for purchase
     * @param {number} budget - Available gold
     * @param {Set<string>} ownedBuildings - Buildings already owned
     * @returns {Array} Buildings to purchase
     */
    selectBuildingsForBudget(availableBuildings, budget, ownedBuildings) {
        const selected = [];
        let remainingBudget = budget;

        // Categorize buildings by priority
        const productionBuildings = []; // Buildings that produce units
        const economyBuildings = [];    // Buildings that provide supply/income
        const otherBuildings = [];

        for (const building of availableBuildings) {
            // Skip if we already own this type (limit to 1 of each for simplicity)
            if (ownedBuildings.has(building.id)) continue;

            if (building.units && building.units.length > 0) {
                productionBuildings.push(building);
            } else if (building.supplyProvided > 0) {
                economyBuildings.push(building);
            } else {
                otherBuildings.push(building);
            }
        }

        // Shuffle each category for variety
        const rng = this.game.rng.strand('local');
        rng.shuffle(productionBuildings);
        rng.shuffle(economyBuildings);
        rng.shuffle(otherBuildings);

        // First, get at least one production building if we don't have any (besides townhall)
        const hasProductionBuilding = [...ownedBuildings].some(id => {
            const b = this.collections.buildings?.[id];
            return b && b.units && b.units.length > 0 && b.category !== 'townhall';
        });

        if (!hasProductionBuilding && productionBuildings.length > 0) {
            // Try to buy a production building
            for (const building of productionBuildings) {
                if (building.value <= remainingBudget) {
                    selected.push(building);
                    remainingBudget -= building.value;
                    break;
                }
            }
        }

        // Reserve some gold for units (at least 50%)
        const buildingBudget = remainingBudget * 0.5;
        remainingBudget = buildingBudget;

        // Try to diversify - get different production buildings
        for (const building of productionBuildings) {
            if (ownedBuildings.has(building.id)) continue;
            if (selected.some(b => b.id === building.id)) continue;
            if (building.value > remainingBudget) continue;

            selected.push(building);
            remainingBudget -= building.value;

            // Limit building purchases per round
            if (selected.length >= 2) break;
        }

        return selected;
    }

    /**
     * Place a building on the map near the AI's base
     * @param {Object} building - Building definition
     * @param {number} aiTeam - The AI's team
     * @returns {boolean} Whether placement succeeded
     */
    placeBuilding(building, aiTeam) {
        // Find position near AI's existing buildings (base expansion strategy)
        const position = this.findBuildingPlacementPosition(building, aiTeam);
        if (!position) {
            console.warn('[AIPlacementSystem] Could not find valid position for building', building.id);
            return false;
        }

        // Generate placement ID
        const placementId = this.nextAIPlacementId++;
        const aiPlayerId = 1; // AI is always player 1

        // Create placement data
        const networkUnitData = {
            placementId: placementId,
            gridPosition: position,
            unitTypeId: building.buildingIndex,
            collection: building.collection,
            team: aiTeam,
            playerId: aiPlayerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: Date.now(),
            unitType: building
        };

        // Spawn the building
        const result = this.game.call('spawnSquad', networkUnitData, aiTeam, aiPlayerId, null);

        if (result && result.success) {
            this.aiPlacementIds.push(placementId);
            return true;
        }

        return false;
    }

    /**
     * Find a strategic position for building placement near AI's base
     * @param {Object} building - Building definition
     * @param {number} aiTeam - The AI's team
     * @returns {Object|null} Grid position {x, z} or null
     */
    findBuildingPlacementPosition(building, aiTeam) {
        const footprintWidth = building.footprintWidth || 2;
        const footprintHeight = building.footprintHeight || 2;

        // Create squad data for placement validation
        const squadData = {
            placementGridWidth: footprintWidth,
            placementGridHeight: footprintHeight
        };

        // Get AI's existing buildings to find base center
        const baseCenter = this.getAIBaseCenter(aiTeam);
        if (!baseCenter) {
            console.warn('[AIPlacementSystem] Could not determine AI base center');
            return null;
        }

        // Get grid bounds
        const gridSystem = this.game.gridSystem;
        if (!gridSystem || !gridSystem.dimensions) {
            return null;
        }

        const bounds = {
            minX: 0,
            maxX: gridSystem.dimensions.width - 1,
            minZ: 0,
            maxZ: gridSystem.dimensions.height - 1
        };

        // Search in a spiral from the base center, starting at radius 2 to leave space
        for (let radius = 2; radius < 30; radius++) {
            // Try positions at this radius in random order for variety
            const candidates = this.getPositionsAtRadius(baseCenter, radius);
            const rng = this.game.rng.strand('local');
            rng.shuffle(candidates);

            for (const pos of candidates) {
                // Check bounds (account for footprint)
                if (pos.x < bounds.minX || pos.x + footprintWidth > bounds.maxX + 1) continue;
                if (pos.z < bounds.minZ || pos.z + footprintHeight > bounds.maxZ + 1) continue;

                if (this.isPositionValid(pos, squadData, bounds, new Set())) {
                    return pos;
                }
            }
        }

        return null;
    }

    /**
     * Get the center of the AI's base (average position of owned buildings)
     * @param {number} aiTeam - The AI's team
     * @returns {Object|null} Grid position {x, z} or null
     */
    getAIBaseCenter(aiTeam) {
        const entitiesWithPlacement = this.game.getEntitiesWith('placement', 'team', 'unitType');
        let sumX = 0, sumZ = 0, count = 0;

        for (const entityId of entitiesWithPlacement) {
            const teamComp = this.game.getComponent(entityId, 'team');
            if (teamComp?.team !== aiTeam) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType || unitType.collection !== 'buildings') continue;

            const placement = this.game.getComponent(entityId, 'placement');
            if (!placement?.gridPosition) continue;

            sumX += placement.gridPosition.x;
            sumZ += placement.gridPosition.z;
            count++;
        }

        if (count === 0) {
            // Fallback to starting location from level
            const startingLocations = this.game.call('getStartingLocationsFromLevel');
            if (startingLocations && startingLocations[aiTeam]) {
                return startingLocations[aiTeam];
            }
            return null;
        }

        return {
            x: Math.round(sumX / count),
            z: Math.round(sumZ / count)
        };
    }

    /**
     * Get all grid positions at a given radius from center
     * @param {Object} center - Center position {x, z}
     * @param {number} radius - Distance from center
     * @returns {Array} Array of positions {x, z}
     */
    getPositionsAtRadius(center, radius) {
        const positions = [];

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                // Only include positions on the perimeter of this radius
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                positions.push({
                    x: center.x + dx,
                    z: center.z + dz
                });
            }
        }

        return positions;
    }

    // ==================== UNIT PLACEMENT ====================

    /**
     * Purchase units from existing buildings
     * @param {number} aiTeam - The AI's team
     * @param {number} budget - Available gold
     * @returns {number} Remaining budget
     */
    purchaseUnits(aiTeam, budget) {
        // Get available units from AI's buildings
        const availableUnits = this.getAvailableUnits(aiTeam);

        if (availableUnits.length === 0) {
            return budget;
        }

        // Select units within budget
        const unitsToPurchase = this.selectUnitsForBudget(availableUnits, budget);

        // Place units on the map
        this.placeUnits(unitsToPurchase, aiTeam);

        // Calculate spent gold
        let totalCost = 0;
        for (const unit of unitsToPurchase) {
            totalCost += unit.value || 0;
        }

        return budget - totalCost;
    }

    /**
     * Get all units available for purchase from AI's buildings
     * @param {number} aiTeam - The AI's team
     * @returns {Array} Array of unit definitions with metadata
     */
    getAvailableUnits(aiTeam) {
        const availableUnits = [];
        const entitiesWithPlacement = this.game.getEntitiesWith('placement', 'team', 'unitType');

        for (const entityId of entitiesWithPlacement) {
            const teamComp = this.game.getComponent(entityId, 'team');
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const placement = this.game.getComponent(entityId, 'placement');

            if (teamComp?.team !== aiTeam) continue;

            // Get unit type definition
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType) continue;

            // Only consider buildings
            if (unitType.collection !== 'buildings') continue;

            // Skip buildings under construction
            if (placement?.isUnderConstruction) continue;

            // Get units this building can produce
            if (unitType.units && Array.isArray(unitType.units)) {
                for (const unitId of unitType.units) {
                    const unit = this.collections.units?.[unitId];
                    if (unit && unit.buyable !== false && unit.value > 0) {
                        // Convert string IDs to numeric enum indices for createPlacement
                        const collectionIndex = this.enums.objectTypeDefinitions?.units;
                        const unitTypeIndex = this.enums.units?.[unitId];

                        if (collectionIndex !== undefined && unitTypeIndex !== undefined) {
                            availableUnits.push({
                                ...unit,
                                id: unitId,
                                collection: collectionIndex,  // numeric index
                                unitTypeIndex: unitTypeIndex, // numeric index
                                buildingEntityId: entityId
                            });
                        }
                    }
                }
            }
        }

        return availableUnits;
    }

    /**
     * Select units to purchase within budget
     * Strategy: Balanced composition with variety
     * @param {Array} availableUnits - Units available for purchase
     * @param {number} budget - Gold available
     * @returns {Array} Units to purchase
     */
    selectUnitsForBudget(availableUnits, budget) {
        const selected = [];
        let remainingBudget = budget;

        // Shuffle for variety using local strand (doesn't affect battle determinism)
        const shuffled = this.game.rng.strand('local').shuffle([...availableUnits]);

        // First pass: Try to get one of each unique unit type for variety
        const seenTypes = new Set();
        for (const unit of shuffled) {
            if (seenTypes.has(unit.id)) continue;
            if (unit.value > remainingBudget) continue;

            selected.push(unit);
            remainingBudget -= unit.value;
            seenTypes.add(unit.id);

            // Don't spend all gold in first pass
            if (remainingBudget < budget * 0.3) break;
        }

        // Second pass: Fill remaining budget with cost-efficient units
        // Sort by efficiency (stats per cost)
        const sortedByEfficiency = [...availableUnits].sort((a, b) => {
            const effA = ((a.hp || 100) + (a.damage || 10) * 10) / (a.value || 1);
            const effB = ((b.hp || 100) + (b.damage || 10) * 10) / (b.value || 1);
            return effB - effA;
        });

        let attempts = 0;
        const maxAttempts = 50; // Prevent infinite loop

        while (remainingBudget > 0 && attempts < maxAttempts) {
            let purchased = false;

            for (const unit of sortedByEfficiency) {
                if (unit.value <= remainingBudget) {
                    selected.push(unit);
                    remainingBudget -= unit.value;
                    purchased = true;
                    break;
                }
            }

            if (!purchased) break;
            attempts++;
        }

        return selected;
    }

    /**
     * Place units near the buildings that produce them
     * @param {Array} units - Units to place (each has buildingEntityId)
     * @param {number} aiTeam - The AI's team
     */
    placeUnits(units, aiTeam) {
        const aiPlayerId = 1; // AI is always player 1
        const occupiedCells = new Set();

        // Group units by their source building for efficient placement
        const unitsByBuilding = new Map();
        for (const unit of units) {
            const buildingId = unit.buildingEntityId;
            if (!unitsByBuilding.has(buildingId)) {
                unitsByBuilding.set(buildingId, []);
            }
            unitsByBuilding.get(buildingId).push(unit);
        }

        // Place units for each building
        for (const [buildingEntityId, buildingUnits] of unitsByBuilding) {
            // Get the building's placement ID
            const buildingPlacementId = this.getBuildingPlacementId(buildingEntityId);

            for (const unit of buildingUnits) {
                // Prepare unit def for findBuildingSpawnPosition
                const unitDef = {
                    ...unit,
                    collection: 'units' // String collection for the service
                };

                // Try to find position near the source building
                let position = null;
                if (buildingPlacementId) {
                    position = this.game.call('findBuildingSpawnPosition', buildingPlacementId, unitDef);
                }

                // Fallback: find position near AI base if building spawn fails
                if (!position) {
                    const squadData = this.game.call('getSquadData', unit);
                    if (squadData) {
                        position = this.findUnitPlacementPosition(squadData, aiTeam, occupiedCells);
                    }
                }

                if (!position) {
                    console.warn('[AIPlacementSystem] Could not find valid position for', unit.id);
                    continue;
                }

                // Generate placement ID
                const placementId = this.nextAIPlacementId++;

                // Create placement data - use numeric indices for createPlacement
                const networkUnitData = {
                    placementId: placementId,
                    gridPosition: position,
                    unitTypeId: unit.unitTypeIndex,  // numeric enum index
                    collection: unit.collection,      // numeric enum index
                    team: aiTeam,
                    playerId: aiPlayerId,
                    roundPlaced: this.game.state.round || 1,
                    timestamp: Date.now(),
                    unitType: unit
                };

                // Spawn the squad
                const result = this.game.call('spawnSquad', networkUnitData, aiTeam, aiPlayerId, null);

                if (result && result.success) {
                    // Mark cells as occupied
                    const squadData = this.game.call('getSquadData', unit);
                    if (squadData) {
                        const cells = this.game.call('getSquadCells', position, squadData);
                        for (const cell of cells) {
                            occupiedCells.add(`${cell.x},${cell.z}`);
                        }
                    }

                    // Track placement
                    this.aiPlacementIds.push(placementId);
                }
            }
        }
    }

    /**
     * Get the placement ID for a building entity
     * @param {number} buildingEntityId - The building entity ID
     * @returns {number|null} The placement ID or null
     */
    getBuildingPlacementId(buildingEntityId) {
        const placement = this.game.getComponent(buildingEntityId, 'placement');
        return placement?.placementId || null;
    }

    /**
     * Find a valid position for a unit near the AI base (fallback)
     * @param {Object} squadData - Squad configuration
     * @param {number} aiTeam - The AI's team
     * @param {Set} occupiedCells - Set of occupied cell keys
     * @returns {Object|null} Valid position {x, z} or null
     */
    findUnitPlacementPosition(squadData, aiTeam, occupiedCells) {
        // Get AI base center
        const baseCenter = this.getAIBaseCenter(aiTeam);
        if (!baseCenter) return null;

        // Get grid bounds
        const gridSystem = this.game.gridSystem;
        if (!gridSystem || !gridSystem.dimensions) return null;

        const bounds = {
            minX: 0,
            maxX: gridSystem.dimensions.width - 1,
            minZ: 0,
            maxZ: gridSystem.dimensions.height - 1
        };

        // Search in a spiral from the base center
        for (let radius = 1; radius < 30; radius++) {
            const candidates = this.getPositionsAtRadius(baseCenter, radius);
            const rng = this.game.rng.strand('local');
            rng.shuffle(candidates);

            for (const pos of candidates) {
                if (this.isPositionValid(pos, squadData, bounds, occupiedCells)) {
                    return pos;
                }
            }
        }

        return null;
    }

    /**
     * Check if a position is valid for placement
     */
    isPositionValid(pos, squadData, bounds, occupiedCells) {
        const cells = this.game.call('getSquadCells', pos, squadData);

        for (const cell of cells) {
            // Check bounds
            if (cell.x < bounds.minX || cell.x > bounds.maxX) return false;
            if (cell.z < bounds.minZ || cell.z > bounds.maxZ) return false;

            // Check local tracking of cells we've placed this session
            if (occupiedCells.has(`${cell.x},${cell.z}`)) return false;
        }

        // Use existing grid validation service
        return this.game.call('isValidGridPlacement', cells);
    }

    /**
     * Reset AI placement state when scene unloads
     */
    onSceneUnload() {
        this.aiPlacementIds = [];
        this.nextAIPlacementId = 10000;
    }
}
