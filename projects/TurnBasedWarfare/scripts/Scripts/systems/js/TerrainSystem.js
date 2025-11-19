class TerrainSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.terrainSystem = this;
        
        this.initialized = false;
        
        // Core terrain data
        this.level = null;
        this.world = null;
        this.tileMap = null;
        this.heightMapData = null;
        
        // Settings from collections
        this.heightMapSettings = null;
        
        // Terrain dimensions
        this.terrainSize = 0;
        this.extensionSize = 0;
        this.extendedSize = 0;
        this.heightStep = 0;
        
        // Height map canvas for processing (lightweight)
        this.heightMapCanvas = null;
        this.heightMapCtx = null;
    }

    init() {
        if (this.initialized) return;

        this.game.gameManager.register('getTerrainHeightAtPosition', this.getTerrainHeightAtPosition.bind(this));
        this.game.gameManager.register('getTerrainSize', () => this.terrainSize);
        this.game.gameManager.register('getTerrainTypeAtPosition', this.getTerrainTypeAtPosition.bind(this));
        this.game.gameManager.register('getTileMapTerrainType', this.getTileMapTerrainType.bind(this));
        this.game.gameManager.register('getTerrainTypeAtGridPosition', this.getTerrainTypeAtGridPosition.bind(this));

        // Load world data
        this.loadWorldData();

        // Initialize height map processing
        this.initializeHeightMapProcessing();

        // Spawn environment objects (trees, rocks, etc.) - runs on both client and server
        this.spawnEnvironmentObjects();

        this.initialized = true;
    }

    /**
     * Spawn environment objects from level data
     * Creates entities with gameplay components (POSITION, COLLISION, TEAM, UNIT_TYPE)
     * Visual components (RENDERABLE, ANIMATION) are added by WorldSystem on client
     */
    spawnEnvironmentObjects() {
        if (!this.tileMap?.environmentObjects || this.tileMap.environmentObjects.length === 0) {
            return;
        }

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        this.tileMap.environmentObjects.forEach(envObj => {
            const unitType = collections.worldObjects?.[envObj.type];
            if (!unitType) {
                console.warn(`Environment object type '${envObj.type}' not found in worldObjects collection`);
                return;
            }

            // Calculate world position
            const worldX = (envObj.x + this.extensionSize) - this.extendedSize / 2;
            const worldZ = (envObj.y + this.extensionSize) - this.extendedSize / 2;

            // Get terrain height
            let height = 0;
            if (this.heightMapSettings?.enabled) {
                height = this.getTerrainHeightAtPosition(worldX, worldZ);
            }

            // Create entity with unique ID
            const entityId = this.game.createEntity(`env_${envObj.type}_${envObj.x}_${envObj.y}`);

            // Add Position component
            this.game.addComponent(entityId, ComponentTypes.POSITION,
                Components.Position(worldX, height, worldZ));

            // Add UnitType component
            const unitTypeData = { ...unitType, collection: "worldObjects", id: envObj.type };
            this.game.addComponent(entityId, ComponentTypes.UNIT_TYPE,
                Components.UnitType(unitTypeData));

            // Add Team component (neutral for environment objects)
            this.game.addComponent(entityId, ComponentTypes.TEAM,
                Components.Team('neutral'));

            // Add Collision component if the object should block movement
            if (unitType.collision !== false && unitType.size) {
                this.game.addComponent(entityId, ComponentTypes.COLLISION,
                    Components.Collision(unitType.size, unitType.height || 100));
            }

            // Store random values for consistent visual representation
            const rotation = this.seededRandom(envObj.x, envObj.y) * Math.PI * 2;
            const scale = (0.8 + this.seededRandom(envObj.y, envObj.x) * 0.4) * (envObj.type === 'rock' ? 1 : 50);

            // Add Facing component for rotation
            this.game.addComponent(entityId, ComponentTypes.FACING,
                Components.Facing(rotation));

            // Store scale in a way that WorldSystem can use
            if (!this.game.hasComponent(entityId, ComponentTypes.ANIMATION)) {
                this.game.addComponent(entityId, ComponentTypes.ANIMATION,
                    Components.Animation(scale, rotation, 0));
            }
        });

        console.log(`TerrainSystem: Spawned ${this.tileMap.environmentObjects.length} environment objects`);
    }

    /**
     * Seeded random for consistent values between client and server
     */
    seededRandom(x, y) {
        const seed = x * 12.9898 + y * 78.233;
        return (Math.sin(seed) * 43758.5453) % 1;
    }

    loadWorldData() {
        const collections = this.game.getCollections();
        if (!collections) {
            console.error('TerrainSystem: No collections found');
            return;
        }

        const currentLevel = this.game.state?.level || 'level1';
        this.level = collections.levels?.[currentLevel];

        if (!this.level) {
            console.error(`TerrainSystem: Level '${currentLevel}' not found`);
            return;
        }

        this.world = collections.worlds?.[this.level.world];
        if (!this.world) {
            console.error(`TerrainSystem: World '${this.level.world}' not found`);
            return;
        }

        this.heightMapSettings = collections.heightMaps?.[this.world.heightMap];
        this.heightStep = this.heightMapSettings?.heightStep || 10;
        this.tileMap = this.level.tileMap;

        // Load terrain types from collections
        this.terrainTypes = collections.terrainTypes;
        if (!this.terrainTypes) {
            console.error('TerrainSystem: No terrainTypes collection found');
            return;
        }

        // Calculate world dimensions
        this.terrainSize = this.tileMap.size * collections.configs.game.gridSize;
        this.extensionSize = this.world.extensionSize || 0;
        this.extendedSize = this.terrainSize + 2 * this.extensionSize;
    }

    initializeHeightMapProcessing() {
        if (!this.heightMapSettings?.enabled) {
            console.log('TerrainSystem: Height map disabled, using flat terrain');
            return;
        }
        this.processHeightMapFromData();
    }

    processHeightMapFromData() {
        if (!this.tileMap?.terrainMap) {
            console.warn('TerrainSystem: No terrain map data available');
            return;
        }

        // Initialize height map data array
        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);

        // Check if we have a separate heightMap in the tileMap
        const hasHeightMap = this.tileMap.heightMap && this.tileMap.heightMap.length > 0;

        // Set extension area height
        let extensionHeight;
        if (hasHeightMap) {
            // Use extension height from tileMap if available
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

        const gridSize = this.game.getCollections().configs.game.gridSize;

        if (hasHeightMap) {
            // NEW: Use separate heightMap data from tileMap
            const heightData = this.tileMap.heightMap;

            for (let z = 0; z < heightData.length; z++) {
                for (let x = 0; x < heightData[z].length; x++) {
                    const heightLevel = heightData[z][x];
                    const height = heightLevel * this.heightStep;

                    // Map terrain coordinates to extended coordinates
                    const extX = x * gridSize + this.extensionSize;
                    const extZ = z * gridSize + this.extensionSize;

                    // Apply height to a region around this tile
                    const halfGrid = Math.floor(gridSize / 2);
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

            console.log(`TerrainSystem: Processed height map from separate heightMap data - ${this.extendedSize}x${this.extendedSize}`);
        } else {
            // OLD: Derive heights from terrain types (backwards compatibility)
            const terrainMap = this.tileMap.terrainMap;

            for (let z = 0; z < terrainMap.length; z++) {
                for (let x = 0; x < terrainMap[z].length; x++) {
                    const terrainType = terrainMap[z][x];
                    const height = terrainType * this.heightStep;

                    // Map terrain coordinates to extended coordinates
                    const extX = x * gridSize + this.extensionSize;
                    const extZ = z * gridSize + this.extensionSize;

                    // Apply height to a region around this tile
                    const halfGrid = Math.floor(gridSize / 2);
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

            console.log(`TerrainSystem: Processed height map from terrain type data (legacy) - ${this.extendedSize}x${this.extendedSize}`);
        }
    }


    getTileMapTerrainType(terrainTypeIndex){
        // Get the terrain type ID from the tileMap.terrainTypes array
        const terrainTypeId = this.tileMap.terrainTypes?.[terrainTypeIndex];
        if (!terrainTypeId) return null;

        // Look up the full terrain type definition from collections
        return this.terrainTypes[terrainTypeId] || null;
    }
    /**
     * Get terrain height at world position
     * @param {number} worldX - World X coordinate  
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Terrain height
     */
    getTerrainHeightAtPosition(worldX, worldZ) {
        // Check if height map is available and enabled
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0; // Fallback to flat ground
        }
        
        // Convert world coordinates to height map coordinates
        // The ground is centered at origin, so we need to offset by half the extended size
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
        // Check if height map is available and enabled
        if (!this.heightMapData || !this.heightMapSettings?.enabled) {
            return 0; // Fallback to flat ground
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

        const gridSize = this.game.getCollections().configs.game.gridSize;
        const terrainMap = this.tileMap.terrainMap;
        
        // Convert world coordinates to terrain grid coordinates
        const terrainX = Math.floor((worldX + this.terrainSize / 2) / gridSize);
        const terrainZ = Math.floor((worldZ + this.terrainSize / 2) / gridSize);
        
        // Check bounds
        if (terrainX < 0 || terrainX >= terrainMap[0]?.length || 
            terrainZ < 0 || terrainZ >= terrainMap.length) {
            // Outside terrain bounds, return extension terrain type
            return this.tileMap.extensionTerrainType || 0;
        }
        
        return terrainMap[terrainZ][terrainX];
    }

    getTerrainTypeAtGridPosition(gridX, gridZ) {
        if (!this.tileMap?.terrainMap) {
            return null;
        }

        const terrainMap = this.tileMap.terrainMap;

        if(terrainMap.length <= gridZ || gridZ < 0) {
            return null;
        }
        if(terrainMap[gridZ].length <= gridX || gridX < 0) {
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

    update() {
        // TerrainSystem is mostly static, minimal update needed
        if (!this.initialized) {
            this.init();
        }
    }

    destroy() {
        // Clean up resources
        this.heightMapData = null;
        this.heightMapCanvas = null;
        this.heightMapCtx = null;
        
        this.initialized = false;
    }
}