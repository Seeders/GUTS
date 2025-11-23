/**
 * CoordinateTranslator - Centralized coordinate space transformations
 *
 * Handles conversions between multiple coordinate spaces:
 * - Tile Space: Grid coordinates (0 to tileMapSize-1)
 * - World Space: 3D world coordinates (centered at origin)
 * - Placement Grid: Half-size grid for unit/building placement
 * - Pixel Space: Height map pixel coordinates (with optional extension)
 * - Canvas/Isometric: 2D UI rendering coordinates
 *
 * All coordinate calculations should use this class to ensure consistency
 * between game runtime, editor, and rendering systems.
 */
class CoordinateTranslator {
    constructor(config = {}) {
        // 2D Canvas/Isometric configuration
        this.isometric = config.isometric || false;
        this.canvasWidth = config.canvasWidth || 0;
        this.canvasHeight = config.canvasHeight || 0;

        // 3D World configuration
        this.gridSize = config.gridSize || 48;               // Terrain grid size (e.g., 48)
        this.placementGridSize = this.gridSize / 2;          // Placement grid (half of terrain grid)
        this.tileMapSize = config.tileMapSize || 32;         // Number of tiles (e.g., 32x32)
        this.terrainSize = this.tileMapSize * this.gridSize; // Total terrain size in world units

        // Extension configuration (for infinite terrain appearance)
        this.extensionSize = config.extensionSize || 0;      // Extension buffer size in pixels
        this.extendedSize = config.extendedSize || 0;        // Total size including extension

        // Placement grid configuration
        this.placementGridDimensions = config.placementGridDimensions || null;

        // Legacy 2D compatibility
        this.tileWidth = this.gridSize;
        this.tileHeight = this.gridSize * 0.5;
        this.mapSize = this.tileMapSize;
    }

    // ===========================================
    // TILE SPACE ↔ WORLD SPACE (3D)
    // ===========================================

    /**
     * Convert tile coordinates to world coordinates
     * @param {number} tileX - Tile X coordinate (0 to tileMapSize-1)
     * @param {number} tileZ - Tile Z coordinate (0 to tileMapSize-1)
     * @param {boolean} useExtension - Whether to account for extension offset
     * @returns {{x: number, z: number}} World position centered at tile center
     */
    tileToWorld(tileX, tileZ, useExtension = false) {
        if (useExtension && this.extensionSize > 0) {
            // With extension: account for extension offset
            return {
                x: (tileX + this.extensionSize) * this.gridSize - this.extendedSize / 2 + this.gridSize / 2,
                z: (tileZ + this.extensionSize) * this.gridSize - this.extendedSize / 2 + this.gridSize / 2
            };
        } else {
            // Without extension: standard centering around origin
            return {
                x: tileX * this.gridSize - this.terrainSize / 2 + this.gridSize / 2,
                z: tileZ * this.gridSize - this.terrainSize / 2 + this.gridSize / 2
            };
        }
    }

    /**
     * Convert world coordinates to tile coordinates
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {boolean} useExtension - Whether to account for extension offset
     * @returns {{x: number, z: number}} Tile coordinates
     */
    worldToTile(worldX, worldZ, useExtension = false) {
        if (useExtension && this.extensionSize > 0) {
            return {
                x: Math.floor((worldX + this.extendedSize / 2) / this.gridSize) - this.extensionSize,
                z: Math.floor((worldZ + this.extendedSize / 2) / this.gridSize) - this.extensionSize
            };
        } else {
            return {
                x: Math.floor((worldX + this.terrainSize / 2) / this.gridSize),
                z: Math.floor((worldZ + this.terrainSize / 2) / this.gridSize)
            };
        }
    }

    /**
     * Get world position at tile corner (not center)
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileZ - Tile Z coordinate
     * @param {boolean} useExtension - Whether to account for extension offset
     * @returns {{x: number, z: number}} World position at tile corner
     */
    tileToWorldCorner(tileX, tileZ, useExtension = false) {
        if (useExtension && this.extensionSize > 0) {
            return {
                x: (tileX + this.extensionSize) * this.gridSize - this.extendedSize / 2,
                z: (tileZ + this.extensionSize) * this.gridSize - this.extendedSize / 2
            };
        } else {
            return {
                x: tileX * this.gridSize - this.terrainSize / 2,
                z: tileZ * this.gridSize - this.terrainSize / 2
            };
        }
    }

    // ===========================================
    // QUADRANT POSITIONING (for cliffs, etc.)
    // ===========================================

    /**
     * Apply quadrant offset to a tile-centered world position
     * Quadrants divide each tile into 4 sub-positions (TL, TR, BL, BR)
     * @param {number} tileWorldX - World X at tile center
     * @param {number} tileWorldZ - World Z at tile center
     * @param {string} quadrant - One of: 'TL', 'TR', 'BL', 'BR'
     * @returns {{x: number, z: number}} World position with quadrant offset
     */
    applyQuadrantOffset(tileWorldX, tileWorldZ, quadrant) {
        const quarterGrid = this.gridSize / 4;
        let x = tileWorldX;
        let z = tileWorldZ;

        switch (quadrant) {
            case 'TL':
                x -= quarterGrid;
                z -= quarterGrid;
                break;
            case 'TR':
                x += quarterGrid;
                z -= quarterGrid;
                break;
            case 'BL':
                x -= quarterGrid;
                z += quarterGrid;
                break;
            case 'BR':
                x += quarterGrid;
                z += quarterGrid;
                break;
        }

        return { x, z };
    }

    // ===========================================
    // PLACEMENT GRID ↔ WORLD SPACE
    // ===========================================

    /**
     * Convert placement grid coordinates to world coordinates
     * Placement grid is half the size of terrain grid
     * @param {number} gridX - Placement grid X coordinate
     * @param {number} gridZ - Placement grid Z coordinate
     * @returns {{x: number, z: number}} World position
     */
    placementGridToWorld(gridX, gridZ) {
        if (this.placementGridDimensions) {
            const { startX, startZ } = this.placementGridDimensions;
            return {
                x: startX + (gridX * this.placementGridSize),
                z: startZ + (gridZ * this.placementGridSize)
            };
        } else {
            // Fallback: assume centered around origin
            return {
                x: gridX * this.placementGridSize - this.terrainSize / 2,
                z: gridZ * this.placementGridSize - this.terrainSize / 2
            };
        }
    }

    /**
     * Convert world coordinates to placement grid coordinates
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{x: number, z: number}} Placement grid coordinates
     */
    worldToPlacementGrid(worldX, worldZ) {
        if (this.placementGridDimensions) {
            const { startX, startZ } = this.placementGridDimensions;
            return {
                x: Math.floor((worldX - startX) / this.placementGridSize),
                z: Math.floor((worldZ - startZ) / this.placementGridSize)
            };
        } else {
            // Fallback: assume centered around origin
            return {
                x: Math.floor((worldX + this.terrainSize / 2) / this.placementGridSize),
                z: Math.floor((worldZ + this.terrainSize / 2) / this.placementGridSize)
            };
        }
    }

    // ===========================================
    // TILE → PIXEL (for height map data)
    // ===========================================

    /**
     * Convert tile coordinates to pixel/heightmap coordinates
     * Used for accessing heightMapData arrays
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileZ - Tile Z coordinate
     * @returns {{x: number, z: number}} Pixel coordinates in heightmap
     */
    tileToPixel(tileX, tileZ) {
        if (this.extensionSize > 0) {
            // Extended space: add extension offset
            return {
                x: tileX * this.gridSize + this.extensionSize,
                z: tileZ * this.gridSize + this.extensionSize
            };
        } else {
            // Standard: direct multiplication
            return {
                x: tileX * this.gridSize,
                z: tileZ * this.gridSize
            };
        }
    }

    /**
     * Convert pixel coordinates to tile coordinates
     * @param {number} pixelX - Pixel X coordinate
     * @param {number} pixelZ - Pixel Z coordinate
     * @returns {{x: number, z: number}} Tile coordinates
     */
    pixelToTile(pixelX, pixelZ) {
        if (this.extensionSize > 0) {
            return {
                x: Math.floor((pixelX - this.extensionSize) / this.gridSize),
                z: Math.floor((pixelZ - this.extensionSize) / this.gridSize)
            };
        } else {
            return {
                x: Math.floor(pixelX / this.gridSize),
                z: Math.floor(pixelZ / this.gridSize)
            };
        }
    }

    // ===========================================
    // PIXEL → WORLD (for worldObjects)
    // ===========================================

    /**
     * Convert pixel/absolute coordinates to world coordinates
     * Used for worldObjects which store positions in pixel/absolute space
     * @param {number} pixelX - Pixel X coordinate (absolute position)
     * @param {number} pixelZ - Pixel Z coordinate (absolute position)
     * @returns {{x: number, z: number}} World position centered at origin
     */
    pixelToWorld(pixelX, pixelZ) {
        // WorldObjects use pixel/absolute coordinates
        // Convert to world space by centering around origin
        return {
            x: pixelX - (this.terrainSize / 2),
            z: pixelZ - (this.terrainSize / 2)
        };
    }

    /**
     * Convert world coordinates to pixel/absolute coordinates
     * Inverse of pixelToWorld
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{x: number, z: number}} Pixel/absolute coordinates
     */
    worldToPixel(worldX, worldZ) {
        return {
            x: worldX + (this.terrainSize / 2),
            z: worldZ + (this.terrainSize / 2)
        };
    }

    // ===========================================
    // 2D CANVAS / ISOMETRIC (Legacy Support)
    // ===========================================

    /**
     * Convert pixel coordinates to grid coordinates (2D top-down)
     * @param {number} pixelX - Canvas pixel X
     * @param {number} pixelY - Canvas pixel Y
     * @returns {{x: number, y: number}} Grid coordinates
     */
    pixelToGrid(pixelX, pixelY) {
        return {
            x: pixelX / this.tileWidth,
            y: pixelY / this.tileWidth
        };
    }

    /**
     * Convert grid coordinates to isometric canvas coordinates
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridY - Grid Y coordinate
     * @returns {{x: number, y: number}} Isometric canvas position
     */
    gridToIso(gridX, gridY) {
        // If not isometric, return grid coordinates as-is
        if (!this.isometric) {
            return { x: gridX * this.tileWidth, y: gridY * this.tileWidth };
        }

        const isoX = (gridX - gridY) * (this.tileWidth / 2) + this.canvasWidth / 2;

        // Calculate the height the grid would occupy
        const totalGridHeight = this.mapSize * this.tileHeight;

        // Center vertically by adding an offset
        const verticalOffset = (this.canvasHeight - totalGridHeight) / 2;

        const isoY = (gridX + gridY) * (this.tileHeight / 2) + verticalOffset;

        return { x: isoX, y: isoY };
    }

    /**
     * Convert pixel coordinates to isometric canvas coordinates
     * @param {number} pixelX - Pixel X
     * @param {number} pixelY - Pixel Y
     * @returns {{x: number, y: number}} Isometric canvas position
     */
    pixelToIso(pixelX, pixelY) {
        if (!this.isometric) {
            return {
                x: pixelX + (this.canvasWidth - this.mapSize * this.tileWidth) / 2,
                y: pixelY + (this.canvasHeight - this.mapSize * this.tileWidth) / 2
            };
        }
        const grid = this.pixelToGrid(pixelX, pixelY);
        return this.gridToIso(grid.x, grid.y);
    }

    /**
     * Convert isometric canvas coordinates to grid coordinates
     * @param {number} isoX - Isometric canvas X
     * @param {number} isoY - Isometric canvas Y
     * @returns {{x: number, y: number}} Grid coordinates
     */
    isoToGrid(isoX, isoY) {
        // If not isometric, convert directly to grid
        if (!this.isometric) {
            return {
                x: isoX / this.tileWidth,
                y: isoY / this.tileWidth
            };
        }

        const adjustedX = isoX - this.canvasWidth / 2;

        // Calculate the same vertical offset as in gridToIso
        const totalGridHeight = this.mapSize * this.tileHeight;
        const verticalOffset = (this.canvasHeight - totalGridHeight) / 2;

        // Subtract the offset before conversion
        const adjustedY = isoY - verticalOffset;

        const gridX = (adjustedX / (this.tileWidth / 2) + adjustedY / (this.tileHeight / 2)) / 2;
        const gridY = (adjustedY / (this.tileHeight / 2) - adjustedX / (this.tileWidth / 2)) / 2;

        return { x: gridX, y: gridY };
    }

    /**
     * Convert isometric canvas coordinates to pixel coordinates
     * @param {number} isoX - Isometric canvas X
     * @param {number} isoY - Isometric canvas Y
     * @returns {{x: number, y: number}} Pixel coordinates
     */
    isoToPixel(isoX, isoY) {
        const grid = this.isoToGrid(isoX, isoY);
        return {
            x: grid.x * this.tileWidth,
            y: grid.y * this.tileWidth
        };
    }

    // ===========================================
    // UTILITY METHODS
    // ===========================================

    /**
     * Snap grid coordinates to nearest integer
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridY - Grid Y coordinate
     * @returns {{x: number, y: number}} Snapped coordinates
     */
    snapToGrid(gridX, gridY) {
        return { x: Math.floor(gridX), y: Math.floor(gridY) };
    }

    /**
     * Check if tile coordinates are within valid bounds
     * @param {number} tileX - Tile X coordinate
     * @param {number} tileZ - Tile Z coordinate
     * @returns {boolean} True if within bounds
     */
    isValidTile(tileX, tileZ) {
        return tileX >= 0 && tileX < this.tileMapSize &&
               tileZ >= 0 && tileZ < this.tileMapSize;
    }

    /**
     * Check if world coordinates are within terrain bounds
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within bounds
     */
    isValidWorldPosition(worldX, worldZ) {
        return worldX >= -this.terrainSize / 2 && worldX <= this.terrainSize / 2 &&
               worldZ >= -this.terrainSize / 2 && worldZ <= this.terrainSize / 2;
    }

    /**
     * Update configuration (useful for dynamic changes)
     * @param {Object} config - New configuration values
     */
    updateConfig(config) {
        if (config.gridSize !== undefined) {
            this.gridSize = config.gridSize;
            this.placementGridSize = this.gridSize / 2;
            this.tileWidth = this.gridSize;
        }
        if (config.tileMapSize !== undefined) {
            this.tileMapSize = config.tileMapSize;
            this.terrainSize = this.tileMapSize * this.gridSize;
            this.mapSize = this.tileMapSize;
        }
        if (config.extensionSize !== undefined) {
            this.extensionSize = config.extensionSize;
        }
        if (config.extendedSize !== undefined) {
            this.extendedSize = config.extendedSize;
        }
        if (config.placementGridDimensions !== undefined) {
            this.placementGridDimensions = config.placementGridDimensions;
        }
    }
}
