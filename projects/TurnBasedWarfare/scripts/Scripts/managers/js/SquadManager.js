class SquadManager {
    constructor(app) {
        this.game = app;
        this.game.squadManager = this;
        this.ELEMENT_TYPES = {
            PHYSICAL: 'physical',
            FIRE: 'fire',
            COLD: 'cold',
            LIGHTNING: 'lightning',
            POISON: 'poison',
            DIVINE: 'divine'
        };
        
        this.DEFAULT_SQUAD_CONFIG = {
            squadWidth: 1,
            squadHeight: 1,
            placementGridWidth: 1,
            placementGridHeight: 1
        };
    }
    
    /**
     * Extract squad configuration from unit type definition
     * @param {Object} unitType - Unit type definition
     * @returns {Object} Squad configuration with dimensions
     */
    getSquadData(unitType) {
        return {
            squadWidth: unitType.squadWidth || this.DEFAULT_SQUAD_CONFIG.squadWidth,
            squadHeight: unitType.squadHeight || this.DEFAULT_SQUAD_CONFIG.squadHeight,
            placementGridWidth: unitType.placementGridWidth || this.DEFAULT_SQUAD_CONFIG.placementGridWidth,
            placementGridHeight: unitType.placementGridHeight || this.DEFAULT_SQUAD_CONFIG.placementGridHeight
        };
    }
    
    /**
     * Calculate which grid cells a squad would occupy
     * @param {Object} gridPos - Center grid position {x, z}
     * @param {Object} unitType - Squad configuration
     * @returns {Array} Array of cell positions {x, z}
     */
    getSquadCells(gridPos, unitType) {
        const cells = [];
        const { placementGridWidth, placementGridHeight } = unitType;
        
        if(unitType.collection == "buildings"){
            return this.calculateFootprintCells(gridPos, unitType);
        }
        // Calculate starting position to center the formation
        const startX = gridPos.x - Math.floor(placementGridWidth / 2);
        const startZ = gridPos.z - Math.floor(placementGridHeight / 2);
        
        for (let x = 0; x < placementGridWidth; x++) {
            for (let z = 0; z < placementGridHeight; z++) {
                cells.push({
                    x: startX + x,
                    z: startZ + z
                });
            }
        }
        
        return cells;
    }
      
    calculateFootprintCells(gridPos, building) {
        const cells = [];
        // Footprint is in terrain grid units - use directly for preview
        const footprintWidth = building.footprintWidth || building.placementGridWidth || 1;
        const footprintHeight = building.footprintHeight || building.placementGridHeight || 1;

        const startX = gridPos.x - Math.floor(footprintWidth * 2 / 2);
        const startZ = gridPos.z - Math.floor(footprintHeight * 2 / 2);

        // Calculate center position for each footprint cell in placement grid coordinates
        for (let z = 0; z < footprintHeight; z++) {
            for (let x = 0; x < footprintWidth; x++) {
                // Each footprint cell is centered in its 2x2 placement grid area
                cells.push({
                    x: startX + x * 2 + 1,  // Center of 2-cell width
                    z: startZ + z * 2 + 1   // Center of 2-cell height
                });
            }
        }

        return cells;
    }  
    /**
     * Calculate world positions for individual units within a squad formation
     * @param {Object} gridPos - Center grid position {x, z}
     * @param {Object} squadData - Squad configuration
     * @param {Object} gridSystem - GridSystem instance for coordinate conversion
     * @returns {Array} Array of world positions {x, z}
     */
    calculateUnitPositions(gridPos, unitType) {
        const squadData = this.getSquadData(unitType);
        const { squadWidth, squadHeight, placementGridWidth, placementGridHeight } = squadData;
        const positions = [];
        const cellSize = this.game.gridSystem.dimensions.cellSize;

        // Compute the top-left (min) cell of the formation footprint
        const startCellX = gridPos.x - Math.floor(placementGridWidth / 2);
        const startCellZ = gridPos.z - Math.floor(placementGridHeight / 2);

        // Compute the true geometric center of the whole footprint, even for even sizes
        // Example: width=2 -> center at (start + 0.5); width=3 -> center at (start + 1)
        const centerCellX = startCellX + (placementGridWidth - 1) / 2;
        const centerCellZ = startCellZ + (placementGridHeight - 1) / 2;
        const centerWorldPos = this.game.gridSystem.gridToWorld(centerCellX, centerCellZ);

        // If squad footprint matches placement footprint, snap each unit to its cell center.
        if (squadWidth === placementGridWidth && squadHeight === placementGridHeight) {
            for (let row = 0; row < squadHeight; row++) {
                for (let col = 0; col < squadWidth; col++) {
                    const cellX = startCellX + col;
                    const cellZ = startCellZ + row;
                    const wp = this.game.gridSystem.gridToWorld(cellX, cellZ);
                    positions.push({ x: wp.x, z: wp.z });
                }
            }
            return positions;
        }

        // General case: distribute units evenly across the footprint bounds
        const formationWorldWidth  = placementGridWidth  * cellSize;
        const formationWorldHeight = placementGridHeight * cellSize;

        // Single unit: drop on the geometric center of the footprint
        if (squadWidth === 1 && squadHeight === 1) {
            positions.push({ x: centerWorldPos.x, z: centerWorldPos.z });
            return positions;
        }

        // Start from the top-left point of the unit grid *inside* the formation bounds
        const stepX = formationWorldWidth  / Math.max(1, squadWidth);
        const stepZ = formationWorldHeight / Math.max(1, squadHeight);

        const startX = centerWorldPos.x - (formationWorldWidth / 2) + (stepX / 2);
        const startZ = centerWorldPos.z - (formationWorldHeight / 2) + (stepZ / 2);

        console.log(stepX, formationWorldWidth, squadWidth, centerWorldPos, formationWorldWidth, stepX);

        for (let row = 0; row < squadHeight; row++) {
            for (let col = 0; col < squadWidth; col++) {
                const x = startX + col * stepX;
                const z = startZ + row * stepZ;
                positions.push({ x, z });
            }
        }

        return positions;
    }

    /**
     * Check if a squad can fit within given zone bounds
     * @param {Object} squadData - Squad configuration
     * @param {Object} bounds - Zone boundaries {minX, maxX, minZ, maxZ}
     * @returns {boolean} True if squad can fit
     */
    canFitInZone(squadData, bounds) {
        const zoneWidth = bounds.maxX - bounds.minX + 1;
        const zoneHeight = bounds.maxZ - bounds.minZ + 1;
        
        return squadData.placementGridWidth <= zoneWidth && 
               squadData.placementGridHeight <= zoneHeight;
    }
    
    /**
     * Calculate the total number of units in a squad
     * @param {Object} squadData - Squad configuration
     * @returns {number} Total unit count
     */
    getSquadSize(squadData) {
        return squadData.squadWidth * squadData.squadHeight;
    }
    
    /**
     * Get formation type based on squad dimensions
     * @param {Object} squadData - Squad configuration
     * @returns {string} Formation type description
     */
    getFormationType(squadData) {
        const { squadWidth, squadHeight } = squadData;
        
        if (squadWidth === 1 && squadHeight === 1) {
            return 'single';
        } else if (squadWidth === 1) {
            return 'column';
        } else if (squadHeight === 1) {
            return 'line';
        } else if (squadWidth === squadHeight) {
            return 'square';
        } else {
            return 'rectangle';
        }
    }
    
    /**
     * Calculate formation density (units per grid cell)
     * @param {Object} squadData - Squad configuration
     * @returns {number} Units per grid cell ratio
     */
    getFormationDensity(squadData) {
        const totalUnits = this.getSquadSize(squadData);
        const gridCells = squadData.placementGridWidth * squadData.placementGridHeight;
        return totalUnits / gridCells;
    }
    
    /**
     * Get optimal spacing between units in world coordinates
     * @param {Object} squadData - Squad configuration
     * @param {Object} gridSystem - GridSystem instance
     * @returns {Object} Spacing values {x, z}
     */
    getUnitSpacing(squadData, gridSystem) {
        const { squadWidth, squadHeight, placementGridWidth, placementGridHeight } = squadData;
        
        const formationWorldWidth = placementGridWidth * gridSystem.dimensions.cellSize;
        const formationWorldHeight = placementGridHeight * gridSystem.dimensions.cellSize;
        
        return {
            x: squadWidth > 1 ? formationWorldWidth / squadWidth : 0,
            z: squadHeight > 1 ? formationWorldHeight / squadHeight : 0
        };
    }
    
    /**
     * Validate squad configuration
     * @param {Object} squadData - Squad configuration to validate
     * @returns {Object} Validation result {valid, errors}
     */
    validateSquadConfig(squadData) {
        const errors = [];
        
        if (!squadData) {
            errors.push('Squad data is required');
            return { valid: false, errors };
        }
        
        const requiredFields = ['squadWidth', 'squadHeight', 'placementGridWidth', 'placementGridHeight'];
        for (const field of requiredFields) {
            if (typeof squadData[field] !== 'number' || squadData[field] < 1) {
                errors.push(`${field} must be a positive number`);
            }
        }
        
        // Logical validations
        if (squadData.squadWidth > squadData.placementGridWidth * 10) {
            errors.push('Squad width seems unreasonably large for grid size');
        }
        
        if (squadData.squadHeight > squadData.placementGridHeight * 10) {
            errors.push('Squad height seems unreasonably large for grid size');
        }
        
        // Check if formation makes sense
        const totalUnits = squadData.squadWidth * squadData.squadHeight;
        const gridCells = squadData.placementGridWidth * squadData.placementGridHeight;
        
        if (totalUnits > gridCells * 4) {
            errors.push('Too many units for the allocated grid space');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Generate squad info for display purposes
     * @param {Object} unitType - Unit type definition
     * @returns {Object} Formatted squad information
     */
    getSquadInfo(unitType) {
        const squadData = this.getSquadData(unitType);
        const validation = this.validateSquadConfig(squadData);
        
        return {
            unitName: unitType.title || unitType.id || 'Unknown Unit',
            squadSize: this.getSquadSize(squadData),
            formationType: this.getFormationType(squadData),
            density: this.getFormationDensity(squadData),
            gridFootprint: `${squadData.placementGridWidth}x${squadData.placementGridHeight}`,
            unitFormation: `${squadData.squadWidth}x${squadData.squadHeight}`,
            isValid: validation.valid,
            errors: validation.errors,
            cost: unitType.value || 0,
            totalValue: (unitType.value || 0) * this.getSquadSize(squadData)
        };
    }
    
   
    /**
     * Find all valid positions for a squad within bounds
     * @param {Object} unitType - Squad configuration
     * @param {Object} bounds - Zone boundaries
     * @param {Set} occupiedCells - Set of occupied cell keys "x,z"
     * @returns {Array} Array of valid grid positions
     */
    findValidPositions(unitType, bounds, occupiedCells = new Set()) {
        const validPositions = [];
        
        // Check each possible center position
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
                const gridPos = { x, z };
                const cells = this.getSquadCells(gridPos, unitType);
                
                // Check if all cells are within bounds and unoccupied
                const isValid = cells.every(cell => {
                    if (cell.x < bounds.minX || cell.x > bounds.maxX ||
                        cell.z < bounds.minZ || cell.z > bounds.maxZ) {
                        return false;
                    }
                    
                    const key = `${cell.x},${cell.z}`;
                    return !occupiedCells.has(key);
                });
                
                if (isValid) {
                    validPositions.push(gridPos);
                }
            }
        }
        
        return validPositions;
    }

    /**
     * Apply placement to game (UNIFIED INTERFACE)
     *
     * This method contains core placement logic shared between client and server.
     * Kept in SquadManager (neutral manager) to avoid coupling systems.
     *
     * @param {object} placement - Placement data with squadUnits array to populate
     * @param {function} createUnitFn - Function to create a single unit (system-specific)
     * @returns {object} Result with success flag and squadUnits array
     */
    applyPlacementToGame(placement, createUnitFn) {
        const unitPositions = this.calculateUnitPositions(placement.gridPosition, placement.unitType);
        const squadUnits = [];

        const maxUnits = Math.min(unitPositions.length, 16);
        const positions = unitPositions.slice(0, maxUnits);

        // Create units using system-specific creation function
        for (const pos of positions) {
            const entityId = createUnitFn(pos, placement);
            if (entityId) {
                squadUnits.push(entityId);
            }
        }

        placement.squadUnits = squadUnits;
        placement.isSquad = squadUnits.length > 1;

        // Initialize squad
        this.game.gameManager.call('initializeSquad',
            placement.placementId,
            placement.unitType,
            squadUnits,
            placement.team
        );

        // Handle peasant building assignment (if applicable)
        if (placement.peasantInfo && placement.collection === 'buildings' && squadUnits.length > 0) {
            const peasantInfo = placement.peasantInfo;
            const peasantId = peasantInfo.peasantId;
            const buildingEntityId = squadUnits[0];

            const peasantAbilities = this.game.gameManager.call('getEntityAbilities', peasantId);
            if (peasantAbilities) {
                const buildAbility = peasantAbilities.find(a => a.id === 'build');
                if (buildAbility) {
                    buildAbility.assignToBuild(peasantId, buildingEntityId, peasantInfo);
                }
            }

            this.game.state.peasantBuildingPlacement = null;
        }

        return { success: true, squadUnits };
    }
}