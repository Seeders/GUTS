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
     * @param {string|Object} [levelIdOrData] - Level ID to load from collections, or direct level data object
     */
    init(collections, gameConfig, levelIdOrData = null) {
        this.collections = collections;
        this.gridSize = gameConfig?.gridSize || 48;

        // If levelIdOrData is an object, use it directly; otherwise treat as ID
        if (typeof levelIdOrData === 'object' && levelIdOrData !== null) {
            this.loadLevelFromData(levelIdOrData);
        } else {
            const currentLevel = levelIdOrData;
            this.loadLevelData(currentLevel);
        }

        if (this.heightMapSettings?.enabled) {
            this.processHeightMapFromData();
        }

        this.initialized = true;
    }

    /**
     * Load level data directly (for editor or custom levels)
     */
    loadLevelFromData(levelData) {
        this.level = levelData;

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
     * Load level and world data from collections by ID
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
   
        // Set extension area height
        let extensionHeight = (this.tileMap.extensionHeight || 0) * this.heightStep;

        // Initialize all points with extension height
        for (let z = 0; z < this.extendedSize; z++) {
            for (let x = 0; x < this.extendedSize; x++) {
                this.heightMapData[z * this.extendedSize + x] = extensionHeight;
            }
        }

        // Use separate heightMap data from tileMap
        const heightData = this.tileMap.heightMap;

        for (let z = 0; z < heightData.length; z++) {
            for (let x = 0; x < heightData[z].length; x++) {
                const heightLevel = heightData[z][x];
                const height = heightLevel * this.heightStep;

                // Map terrain coordinates to extended coordinates
                const extX = x * this.gridSize + this.extensionSize;
                const extZ = z * this.gridSize + this.extensionSize;

                // Apply height to the entire tile
                for (let dz = 0; dz < this.gridSize; dz++) {
                    for (let dx = 0; dx < this.gridSize; dx++) {
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
     * Get world objects from tileMap
     * @returns {Array} Array of world object definitions
     */
    getWorldObjects() {
        return this.tileMap?.worldObjects || [];
    }

    /**
     * Calculate world position for world object
     * @param {Object} worldObj - World object with x, y properties
     * @returns {Object} World position {x, y, z}
     */
    getWorldObjectWorldPosition(worldObj) {
        const worldX = (worldObj.x + this.extensionSize) - this.extendedSize / 2;
        const worldZ = (worldObj.y + this.extensionSize) - this.extendedSize / 2;

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
     * Check if there's a ramp at a specific grid position
     * Ramps apply to ALL edges of a tile with height differences
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @returns {boolean} True if ramp exists at this tile
     */
    hasRampAt(gridX, gridZ) {
        if (!this.tileMap?.ramps || this.tileMap.ramps.length === 0) {
            return false;
        }
        return this.tileMap.ramps.some(r => r.gridX === gridX && r.gridZ === gridZ);
    }

    /**
     * Analyze height map to identify cliff positions and orientations
     * Returns array of cliff data for entity spawning
     * @returns {Array} Array of cliff definitions {gridX, gridZ, direction, type, rotation, heightDiff}
     */
    analyzeCliffs() {
        if (!this.tileMap?.heightMap || this.tileMap.heightMap.length === 0) {
            return [];
        }

        const cliffs = [];
        const heightMap = this.tileMap.heightMap;
        const mapSize = this.tileMap.size || heightMap.length;

        // Helper to get height difference (positive if neighbor is lower)
        const getHeightDiff = (z, x, nz, nx) => {
            if (nz < 0 || nz >= mapSize || nx < 0 || nx >= mapSize) return 0;
            return heightMap[z][x] - heightMap[nz][nx];
        };

        // For each tile, analyze height differences with all 8 neighbors (NSEW + diagonals)
        for (let z = 0; z < mapSize; z++) {
            for (let x = 0; x < mapSize; x++) {
                // Check if this tile or neighboring tiles have ramps
                const hasRamp = this.hasRampAt(x, z);
                const topNeighborHasRamp = z > 0 && this.hasRampAt(x, z - 1);
                const botNeighborHasRamp = z < mapSize - 1 && this.hasRampAt(x, z + 1);
                const leftNeighborHasRamp = x > 0 && this.hasRampAt(x - 1, z);
                const rightNeighborHasRamp = x < mapSize - 1 && this.hasRampAt(x + 1, z);

                // Get actual height differences
                const topDiff = getHeightDiff(z, x, z - 1, x);
                const botDiff = getHeightDiff(z, x, z + 1, x);
                const leftDiff = getHeightDiff(z, x, z, x - 1);
                const rightDiff = getHeightDiff(z, x, z, x + 1);
                const cornerTopLeftDiff = getHeightDiff(z, x, z - 1, x - 1);
                const cornerTopRightDiff = getHeightDiff(z, x, z - 1, x + 1);
                const cornerBottomLeftDiff = getHeightDiff(z, x, z + 1, x - 1);
                const cornerBottomRightDiff = getHeightDiff(z, x, z + 1, x + 1);

                // Analyze all neighbors - suppress cliffs if either this tile or the neighbor has a ramp
                const topLess = topDiff > 0 && !hasRamp && !topNeighborHasRamp;
                const botLess = botDiff > 0 && !hasRamp && !botNeighborHasRamp;
                const leftLess = leftDiff > 0 && !hasRamp && !leftNeighborHasRamp;
                const rightLess = rightDiff > 0 && !hasRamp && !rightNeighborHasRamp;

                // Suppress corner pieces if this tile has a ramp
                const cornerTopLeftLess = cornerTopLeftDiff > 0 && !hasRamp;
                const cornerTopRightLess = cornerTopRightDiff > 0 && !hasRamp;
                const cornerBottomLeftLess = cornerBottomLeftDiff > 0 && !hasRamp;
                const cornerBottomRightLess = cornerBottomRightDiff > 0 && !hasRamp;

                // Track which quadrants are occupied by corners
                const topLeftOccupied = (topLess && leftLess) || (cornerTopLeftLess && !topLess && !leftLess);
                const topRightOccupied = (topLess && rightLess) || (cornerTopRightLess && !topLess && !rightLess);
                const botLeftOccupied = (botLess && leftLess) || (cornerBottomLeftLess && !botLess && !leftLess);
                const botRightOccupied = (botLess && rightLess) || (cornerBottomRightLess && !botLess && !rightLess);

                // Place outer corners first (atom_one)
                // Use the maximum of the two adjacent edge differences to cover the full height
                if (topLess && leftLess) {
                    const heightDiff = Math.max(topDiff, leftDiff);
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_one', rotation: Math.PI / 2, heightDiff });
                }
                if (topLess && rightLess) {
                    const heightDiff = Math.max(topDiff, rightDiff);
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_one', rotation: 0, heightDiff });
                }
                if (botLess && leftLess) {
                    const heightDiff = Math.max(botDiff, leftDiff);
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_one', rotation: Math.PI, heightDiff });
                }
                if (botLess && rightLess) {
                    const heightDiff = Math.max(botDiff, rightDiff);
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_one', rotation: -Math.PI/2, heightDiff });
                }

                // Place inner corners (atom_three)
                // If corner neighbors a ramp, use atom_three_top instead
                if (cornerTopLeftLess && !topLess && !leftLess) {
                    const neighborsRamp = topNeighborHasRamp || leftNeighborHasRamp;
                    const type = neighborsRamp ? 'atom_three_top' : 'atom_three';
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type, rotation: Math.PI / 2, heightDiff: cornerTopLeftDiff });
                }
                if (cornerTopRightLess && !topLess && !rightLess) {
                    const neighborsRamp = topNeighborHasRamp || rightNeighborHasRamp;
                    const type = neighborsRamp ? 'atom_three_top' : 'atom_three';
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type, rotation: 0, heightDiff: cornerTopRightDiff });
                }
                if (cornerBottomLeftLess && !botLess && !leftLess) {
                    const neighborsRamp = botNeighborHasRamp || leftNeighborHasRamp;
                    const type = neighborsRamp ? 'atom_three_top' : 'atom_three';
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type, rotation: Math.PI, heightDiff: cornerBottomLeftDiff });
                }
                if (cornerBottomRightLess && !botLess && !rightLess) {
                    const neighborsRamp = botNeighborHasRamp || rightNeighborHasRamp;
                    const type = neighborsRamp ? 'atom_three_top' : 'atom_three';
                    cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type, rotation: -Math.PI / 2, heightDiff: cornerBottomRightDiff });
                }

                // Place edges in empty quadrants (atom_two)
                // If side neighbor has ramp, convert to atom_one with one face toward ramp
                // atom_one rotations: TL=PI/2, TR=0, BL=PI, BR=-PI/2
                if (topLess) {
                    if (!topLeftOccupied) {
                        if (leftNeighborHasRamp) {
                            // Convert to atom_one facing top and left (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_one', rotation: Math.PI / 2, heightDiff: topDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_two', rotation: 0, heightDiff: topDiff });
                        }
                    }
                    if (!topRightOccupied) {
                        if (rightNeighborHasRamp) {
                            // Convert to atom_one facing top and right (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_one', rotation: 0, heightDiff: topDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_two', rotation: 0, heightDiff: topDiff });
                        }
                    }
                }
                if (botLess) {
                    if (!botLeftOccupied) {
                        if (leftNeighborHasRamp) {
                            // Convert to atom_one facing bottom and left (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_one', rotation: Math.PI, heightDiff: botDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_two', rotation: -Math.PI, heightDiff: botDiff });
                        }
                    }
                    if (!botRightOccupied) {
                        if (rightNeighborHasRamp) {
                            // Convert to atom_one facing bottom and right (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_one', rotation: -Math.PI / 2, heightDiff: botDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_two', rotation: -Math.PI, heightDiff: botDiff });
                        }
                    }
                }
                if (leftLess) {
                    if (!topLeftOccupied) {
                        if (topNeighborHasRamp) {
                            // Convert to atom_one facing left and top (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_one', rotation: Math.PI / 2, heightDiff: leftDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TL', type: 'atom_two', rotation: Math.PI / 2, heightDiff: leftDiff });
                        }
                    }
                    if (!botLeftOccupied) {
                        if (botNeighborHasRamp) {
                            // Convert to atom_one facing left and bottom (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_one', rotation: Math.PI, heightDiff: leftDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BL', type: 'atom_two', rotation: Math.PI / 2, heightDiff: leftDiff });
                        }
                    }
                }
                if (rightLess) {
                    if (!topRightOccupied) {
                        if (topNeighborHasRamp) {
                            // Convert to atom_one facing right and top (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_one', rotation: 0, heightDiff: rightDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'TR', type: 'atom_two', rotation: 3 * Math.PI / 2, heightDiff: rightDiff });
                        }
                    }
                    if (!botRightOccupied) {
                        if (botNeighborHasRamp) {
                            // Convert to atom_one facing right and bottom (toward ramp)
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_one', rotation: -Math.PI / 2, heightDiff: rightDiff });
                        } else {
                            cliffs.push({ gridX: x, gridZ: z, quadrant: 'BR', type: 'atom_two', rotation: 3 * Math.PI / 2, heightDiff: rightDiff });
                        }
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
