/**
 * TerrainDataManager - Core terrain data management and queries
 *
 * Handles:
 * - Level and world data loading
 * - Height map data processing
 * - Terrain type lookups
 * - Height queries (with smooth interpolation)
 * - Boundary validation
 * - Environment object data management
 *
 * Works on both client and server (no rendering, just data)
 */
class TerrainDataManager {
    constructor(config = {}) {
        // Collections reference (levels, worlds, terrainTypes, etc.)
        this.collections = null;

        // Core terrain data
        this.level = null;
        this.world = null;
        this.tileMap = null;
        this.heightMapData = null;
        this.terrainTypes = null;

        // Settings from collections
        this.heightMapSettings = null;

        // Terrain dimensions
        this.terrainSize = 0;
        this.extensionSize = 0;
        this.extendedSize = 0;
        this.heightStep = 0;
        this.gridSize = 48; // Default, will be overridden

        this.initialized = false;
    }

    /**
     * Initialize with collections and configuration
     * @param {Object} collections - Game collections
     * @param {Object} gameConfig - Game configuration
     * @param {string} [levelId] - Level to load (defaults to 'level1')
     */
    init(collections, gameConfig, levelId = null) {
        this.collections = collections;
        this.gridSize = gameConfig?.gridSize || 48;

        const currentLevel = levelId || 'level1';
        this.loadLevelData(currentLevel);

        if (this.heightMapSettings?.enabled) {
            this.processHeightMapFromData();
        }

        this.initialized = true;
    }

    /**
     * Load level and world data
     */
    loadLevelData(levelId) {
        if (!this.collections) {
            console.error('TerrainDataManager: No collections provided');
            return false;
        }

        this.level = this.collections.levels?.[levelId];
        if (!this.level) {
            console.error(`TerrainDataManager: Level '${levelId}' not found`);
            return false;
        }

        this.world = this.collections.worlds?.[this.level.world];
        if (!this.world) {
            console.error(`TerrainDataManager: World '${this.level.world}' not found`);
            return false;
        }

        this.heightMapSettings = this.collections.heightMaps?.[this.world.heightMap];
        this.heightStep = this.heightMapSettings?.heightStep || 10;
        this.tileMap = this.level.tileMap;

        // Load terrain types
        this.terrainTypes = this.collections.terrainTypes;
        if (!this.terrainTypes) {
            console.error('TerrainDataManager: No terrainTypes collection found');
            return false;
        }

        // Calculate world dimensions
        this.terrainSize = this.tileMap.size * this.gridSize;
        this.extensionSize = this.world.extensionSize || 0;
        this.extendedSize = this.terrainSize + 2 * this.extensionSize;

        return true;
    }

    /**
     * Process height map data from tileMap
     */
    processHeightMapFromData() {
        if (!this.tileMap?.terrainMap) {
            console.warn('TerrainDataManager: No terrain map data available');
            return;
        }

        // Initialize height map data array
        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);

        // Check if we have a separate heightMap in the tileMap
        const hasHeightMap = this.tileMap.heightMap && this.tileMap.heightMap.length > 0;

        // Set extension area height
        let extensionHeight;
        if (hasHeightMap) {
            extensionHeight = (this.tileMap.extensionHeight || 0) * this.heightStep;
        } else {
            // Fall back to old behavior: derive from terrain type
            const extensionTerrainType = this.tileMap.extensionTerrainType || 0;
            extensionHeight = extensionTerrainType * this.heightStep;
        }

        // Initialize all points with extension height
        for (let z = 0; z < this.extendedSize; z++) {
            for (let x = 0; x < this.extendedSize; x++) {
                this.heightMapData[z * this.extendedSize + x] = extensionHeight;
            }
        }

        if (hasHeightMap) {
            // Use separate heightMap data from tileMap
            const heightData = this.tileMap.heightMap;

            for (let z = 0; z < heightData.length; z++) {
                for (let x = 0; x < heightData[z].length; x++) {
                    const heightLevel = heightData[z][x];
                    const height = heightLevel * this.heightStep;

                    // Map terrain coordinates to extended coordinates
                    const extX = x * this.gridSize + this.extensionSize;
                    const extZ = z * this.gridSize + this.extensionSize;

                    // Apply height to a region around this tile
                    const halfGrid = Math.floor(this.gridSize / 2);
                    for (let dz = -halfGrid; dz <= halfGrid; dz++) {
                        for (let dx = -halfGrid; dx <= halfGrid; dx++) {
                            const finalX = extX + dx;
                            const finalZ = extZ + dz;

                            if (finalX >= 0 && finalX < this.extendedSize &&
                                finalZ >= 0 && finalZ < this.extendedSize) {
                                const heightIndex = finalZ * this.extendedSize + finalX;
                                this.heightMapData[heightIndex] = height;
                            }
                        }
                    }
                }
            }
        } else {
            // OLD: Derive heights from terrain types (backwards compatibility)
            const terrainMap = this.tileMap.terrainMap;

            for (let z = 0; z < terrainMap.length; z++) {
                for (let x = 0; x < terrainMap[z].length; x++) {
                    const terrainType = terrainMap[z][x];
                    const height = terrainType * this.heightStep;

                    const extX = x * this.gridSize + this.extensionSize;
                    const extZ = z * this.gridSize + this.extensionSize;

                    const halfGrid = Math.floor(this.gridSize / 2);
                    for (let dz = -halfGrid; dz <= halfGrid; dz++) {
                        for (let dx = -halfGrid; dx <= halfGrid; dx++) {
                            const finalX = extX + dx;
                            const finalZ = extZ + dz;

                            if (finalX >= 0 && finalX < this.extendedSize &&
                                finalZ >= 0 && finalZ < this.extendedSize) {
                                const heightIndex = finalZ * this.extendedSize + finalX;
                                this.heightMapData[heightIndex] = height;
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Get terrain type definition from tileMap index
     * @param {number} terrainTypeIndex - Index in tileMap.terrainTypes array
     * @returns {Object|null} Terrain type definition
     */
    getTileMapTerrainType(terrainTypeIndex) {
        const terrainTypeId = this.tileMap.terrainTypes?.[terrainTypeIndex];
        if (!terrainTypeId) return null;

        return this.terrainTypes[terrainTypeId] || null;
    }

    /**
     * Get terrain height at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Terrain height
     */
    getTerrainHeightAtPosition(worldX, worldZ) {
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0; // Fallback to flat ground
        }

        // Convert world coordinates to height map coordinates
        const heightMapX = Math.floor(worldX + this.extendedSize / 2);
        const heightMapZ = Math.floor(worldZ + this.extendedSize / 2);

        // Ensure coordinates are within bounds
        if (heightMapX < 0 || heightMapX >= this.extendedSize ||
            heightMapZ < 0 || heightMapZ >= this.extendedSize) {
            // Outside terrain bounds, use extension terrain height
            const extensionTerrainType = this.tileMap?.extensionTerrainType || 0;
            return extensionTerrainType * this.heightStep;
        }

        // Get height from height map
        const heightIndex = heightMapZ * this.extendedSize + heightMapX;
        return this.heightMapData[heightIndex] || 0;
    }

    /**
     * Get terrain height with bilinear interpolation for smoother transitions
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Smoothly interpolated terrain height
     */
    getTerrainHeightAtPositionSmooth(worldX, worldZ) {
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0;
        }

        // Convert world coordinates to height map coordinates (with decimal precision)
        const heightMapX = worldX + this.extendedSize / 2;
        const heightMapZ = worldZ + this.extendedSize / 2;

        // Get the four surrounding grid points
        const x0 = Math.floor(heightMapX);
        const x1 = x0 + 1;
        const z0 = Math.floor(heightMapZ);
        const z1 = z0 + 1;

        // Get fractional parts for interpolation
        const fx = heightMapX - x0;
        const fz = heightMapZ - z0;

        // Helper function to get height at specific grid point
        const getHeightAt = (x, z) => {
            if (x < 0 || x >= this.extendedSize || z < 0 || z >= this.extendedSize) {
                const extensionTerrainType = this.tileMap?.extensionTerrainType || 0;
                return extensionTerrainType * this.heightStep;
            }
            const heightIndex = z * this.extendedSize + x;
            return this.heightMapData[heightIndex] || 0;
        };

        // Get heights at the four corners
        const h00 = getHeightAt(x0, z0);
        const h10 = getHeightAt(x1, z0);
        const h01 = getHeightAt(x0, z1);
        const h11 = getHeightAt(x1, z1);

        // Bilinear interpolation
        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        return h0 * (1 - fz) + h1 * fz;
    }

    /**
     * Get terrain type at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number|null} Terrain type index, or null if outside bounds
     */
    getTerrainTypeAtPosition(worldX, worldZ) {
        if (!this.tileMap?.terrainMap) {
            return null;
        }

        const terrainMap = this.tileMap.terrainMap;

        // Convert world coordinates to terrain grid coordinates
        const terrainX = Math.floor((worldX + this.terrainSize / 2) / this.gridSize);
        const terrainZ = Math.floor((worldZ + this.terrainSize / 2) / this.gridSize);

        // Check bounds
        if (terrainX < 0 || terrainX >= terrainMap[0]?.length ||
            terrainZ < 0 || terrainZ >= terrainMap.length) {
            // Outside terrain bounds, return extension terrain type
            return this.tileMap.extensionTerrainType || 0;
        }

        return terrainMap[terrainZ][terrainX];
    }

    /**
     * Get terrain type at grid position
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @returns {number|null} Terrain type index
     */
    getTerrainTypeAtGridPosition(gridX, gridZ) {
        if (!this.tileMap?.terrainMap) {
            return null;
        }

        const terrainMap = this.tileMap.terrainMap;

        if (terrainMap.length <= gridZ || gridZ < 0) {
            return null;
        }
        if (terrainMap[gridZ].length <= gridX || gridX < 0) {
            return null;
        }

        return terrainMap[gridZ][gridX];
    }

    /**
     * Get height level at grid position (not the actual height, but the level index)
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @returns {number|null} Height level (0, 1, 2, etc.), or null if outside bounds
     */
    getHeightLevelAtGridPosition(gridX, gridZ) {
        // If we have a separate heightMap in tileMap, use it
        if (this.tileMap?.heightMap && this.tileMap.heightMap.length > 0) {
            const heightData = this.tileMap.heightMap;

            if (heightData.length <= gridZ || gridZ < 0) {
                return this.tileMap.extensionHeight || 0;
            }
            if (heightData[gridZ].length <= gridX || gridX < 0) {
                return this.tileMap.extensionHeight || 0;
            }

            return heightData[gridZ][gridX];
        }

        // Fall back to old behavior: derive from terrain type
        const terrainType = this.getTerrainTypeAtGridPosition(gridX, gridZ);
        return terrainType !== null ? terrainType : 0;
    }

    /**
     * Check if a position is within terrain bounds
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within terrain bounds
     */
    isWithinTerrainBounds(worldX, worldZ) {
        const halfTerrain = this.terrainSize / 2;
        return worldX >= -halfTerrain && worldX <= halfTerrain &&
               worldZ >= -halfTerrain && worldZ <= halfTerrain;
    }

    /**
     * Check if a position is within extended terrain bounds (including extension)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within extended terrain bounds
     */
    isWithinExtendedBounds(worldX, worldZ) {
        const halfExtended = this.extendedSize / 2;
        return worldX >= -halfExtended && worldX <= halfExtended &&
               worldZ >= -halfExtended && worldZ <= halfExtended;
    }

    /**
     * Get terrain information at position including height, type, and bounds checking
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {Object} Terrain info object
     */
    getTerrainInfoAtPosition(worldX, worldZ) {
        return {
            height: this.getTerrainHeightAtPosition(worldX, worldZ),
            heightSmooth: this.getTerrainHeightAtPositionSmooth(worldX, worldZ),
            terrainType: this.getTerrainTypeAtPosition(worldX, worldZ),
            withinBounds: this.isWithinTerrainBounds(worldX, worldZ),
            withinExtendedBounds: this.isWithinExtendedBounds(worldX, worldZ)
        };
    }

    /**
     * Enforce terrain boundaries for movement
     * @param {Object} pos - Position object with x, z properties
     * @param {number} unitRadius - Unit radius for boundary checking
     */
    enforceBoundaries(pos, unitRadius = 25) {
        const halfTerrain = this.terrainSize / 2;

        pos.x = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.x));
        pos.z = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.z));
    }

    /**
     * Get safe spawn position within terrain bounds
     * @param {number} preferredX - Preferred X coordinate
     * @param {number} preferredZ - Preferred Z coordinate
     * @param {number} unitRadius - Unit radius for boundary checking
     * @returns {Object} Safe position with x, y, z coordinates
     */
    getSafeSpawnPosition(preferredX, preferredZ, unitRadius = 25) {
        const halfTerrain = this.terrainSize / 2;

        // Clamp to safe bounds
        const safeX = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, preferredX));
        const safeZ = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, preferredZ));

        // Get terrain height at safe position
        const height = this.getTerrainHeightAtPosition(safeX, safeZ);

        return {
            x: safeX,
            y: height,
            z: safeZ
        };
    }

    /**
     * Get environment objects from tileMap
     * @returns {Array} Array of environment object definitions
     */
    getEnvironmentObjects() {
        return this.tileMap?.environmentObjects || [];
    }

    /**
     * Calculate world position for environment object
     * @param {Object} envObj - Environment object with x, y properties
     * @returns {Object} World position {x, y, z}
     */
    getEnvironmentObjectWorldPosition(envObj) {
        const worldX = (envObj.x + this.extensionSize) - this.extendedSize / 2;
        const worldZ = (envObj.y + this.extensionSize) - this.extendedSize / 2;

        let height = 0;
        if (this.heightMapSettings?.enabled) {
            height = this.getTerrainHeightAtPosition(worldX, worldZ);
        }

        return { x: worldX, y: height, z: worldZ };
    }

    /**
     * Seeded random for consistent values between client and server
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {number} Random value between 0 and 1
     */
    seededRandom(x, y) {
        const seed = x * 12.9898 + y * 78.233;
        return (Math.sin(seed) * 43758.5453) % 1;
    }

    /**
     * Analyze height map to identify cliff positions and orientations
     * Returns array of cliff data for entity spawning
     * @returns {Array} Array of cliff definitions {gridX, gridZ, direction, type, rotation}
     */
    analyzeCliffs() {
        if (!this.tileMap?.heightMap || this.tileMap.heightMap.length === 0) {
            return [];
        }

        const cliffs = [];
        const heightMap = this.tileMap.heightMap;
        const mapSize = this.tileMap.size || heightMap.length;

        // For each tile, analyze height differences with all 8 neighbors (NSEW + diagonals)
        for (let z = 0; z < mapSize; z++) {
            for (let x = 0; x < mapSize; x++) {
                const currentHeight = heightMap[z][x];

                // Analyze all neighbors
                const topLess = z > 0 && heightMap[z - 1][x] < currentHeight;
                const botLess = z < mapSize - 1 && heightMap[z + 1][x] < currentHeight;
                const leftLess = x > 0 && heightMap[z][x - 1] < currentHeight;
                const rightLess = x < mapSize - 1 && heightMap[z][x + 1] < currentHeight;

                const cornerTopLeftLess = z > 0 && x > 0 && heightMap[z - 1][x - 1] < currentHeight;
                const cornerTopRightLess = z > 0 && x < mapSize - 1 && heightMap[z - 1][x + 1] < currentHeight;
                const cornerBottomLeftLess = z < mapSize - 1 && x > 0 && heightMap[z + 1][x - 1] < currentHeight;
                const cornerBottomRightLess = z < mapSize - 1 && x < mapSize - 1 && heightMap[z + 1][x + 1] < currentHeight;

                // Track which quadrants are occupied by corners
                const topLeftOccupied = (topLess && leftLess) || (cornerTopLeftLess && !topLess && !leftLess);
                const topRightOccupied = (topLess && rightLess) || (cornerTopRightLess && !topLess && !rightLess);
                const botLeftOccupied = (botLess && leftLess) || (cornerBottomLeftLess && !botLess && !leftLess);
                const botRightOccupied = (botLess && rightLess) || (cornerBottomRightLess && !botLess && !rightLess);

                // Place outer corners first (atom_one)
                if (topLess && leftLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_one', rotation: 0 });
                }
                if (topLess && rightLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_one', rotation: Math.PI / 2 });
                }
                if (botLess && leftLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_one', rotation: -Math.PI / 2 });
                }
                if (botLess && rightLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_one', rotation: Math.PI });
                }

                // Place inner corners (atom_three)
                if (cornerTopLeftLess && !topLess && !leftLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_three', rotation: 0 });
                }
                if (cornerTopRightLess && !topLess && !rightLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_three', rotation: Math.PI / 2 });
                }
                if (cornerBottomLeftLess && !botLess && !leftLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_three', rotation: -Math.PI / 2 });
                }
                if (cornerBottomRightLess && !botLess && !rightLess) {
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_three', rotation: Math.PI });
                }

                // Place edges in empty quadrants (atom_two)
                if (topLess) {
                    if (!topLeftOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_two', rotation: Math.PI / 2 });
                    }
                    if (!topRightOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_two', rotation: Math.PI / 2 });
                    }
                }
                if (botLess) {
                    if (!botLeftOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_two', rotation: -Math.PI / 2 });
                    }
                    if (!botRightOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_two', rotation: -Math.PI / 2 });
                    }
                }
                if (leftLess) {
                    if (!topLeftOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_two', rotation: 0 });
                    }
                    if (!botLeftOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_two', rotation: 0 });
                    }
                }
                if (rightLess) {
                    if (!topRightOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_two', rotation: Math.PI });
                    }
                    if (!botRightOccupied) {
                        cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_two', rotation: Math.PI });
                    }
                }
            }
        }

        return cliffs;
    }

    /**
     * Get world position for a cliff entity
     * @param {Object} cliffData - Cliff data from analyzeCliffs()
     * @returns {Object} World position {x, y, z}
     */
    getCliffWorldPosition(cliffData) {
        // Convert grid position to world position (center of tile)
        const tileWorldX = (cliffData.gridX + this.extensionSize) * this.gridSize - this.extendedSize / 2 + this.gridSize / 2;
        const tileWorldZ = (cliffData.gridZ + this.extensionSize) * this.gridSize - this.extendedSize / 2 + this.gridSize / 2;

        // Offset based on direction to place cliff on edge of tile
        const offset = this.gridSize / 2;
        let worldX = tileWorldX;
        let worldZ = tileWorldZ;

        switch (cliffData.direction) {
            case 'north':
                worldZ -= offset;
                break;
            case 'south':
                worldZ += offset;
                break;
            case 'east':
                worldX += offset;
                break;
            case 'west':
                worldX -= offset;
                break;
        }

        // Get height of the tile this cliff is on
        const height = this.getTerrainHeightAtPosition(tileWorldX, tileWorldZ);

        return { x: worldX, y: height, z: worldZ };
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.heightMapData = null;
        this.level = null;
        this.world = null;
        this.tileMap = null;
        this.terrainTypes = null;
        this.collections = null;
        this.initialized = false;
    }
}
