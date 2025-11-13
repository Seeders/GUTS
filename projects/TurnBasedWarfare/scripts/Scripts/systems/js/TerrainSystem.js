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

        this.initialized = true;
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

        // Check if we're running in a browser environment
        const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
        
        if (isBrowser) {
            // Create a small canvas for height map processing
            this.heightMapCanvas = document.createElement('canvas');
            this.heightMapCanvas.width = this.terrainSize;
            this.heightMapCanvas.height = this.terrainSize;
            this.heightMapCtx = this.heightMapCanvas.getContext('2d');
            this.processHeightMapFromCanvas();
        } else {
            // For server-side, we'll work directly with the terrain data
            console.log('TerrainSystem: Running in server mode, using data-only height processing');
            this.processHeightMapFromData();
        }
    }

    processHeightMapFromData() {
        if (!this.tileMap?.terrainMap) {
            console.warn('TerrainSystem: No terrain map data available');
            return;
        }

        // Initialize height map data array
        this.heightMapData = new Float32Array(this.extendedSize * this.extendedSize);
        
        // Set extension area to extension terrain height
        const extensionTerrainType = this.tileMap.extensionTerrainType || 0;
        const extensionHeight = extensionTerrainType * this.heightStep;

        // Initialize all points with extension height
        for (let z = 0; z < this.extendedSize; z++) {
            for (let x = 0; x < this.extendedSize; x++) {
                this.heightMapData[z * this.extendedSize + x] = extensionHeight;
            }
        }

        // Process the actual terrain area directly from terrain map
        const terrainMap = this.tileMap.terrainMap;
        const gridSize = this.game.getCollections().configs.game.gridSize;
        
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

        console.log(`TerrainSystem: Processed height map from data - ${this.extendedSize}x${this.extendedSize}`);
    }

    processHeightMapFromCanvas() {
        // This method would be used if running client-side with canvas support
        // For now, fall back to data processing
        this.processHeightMapFromData();
    }

    getTileMapTerrainType(terrainTypeId){
        if(this.tileMap.terrainTypes.length > terrainTypeId && terrainTypeId >= 0){
            return this.tileMap.terrainTypes[terrainTypeId];
        }
        return null;
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