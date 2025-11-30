class TerrainSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.terrainSystem = this;

        this.initialized = false;

        // Use global TerrainDataManager for all terrain data operations
        // Environment object spawner for consistent spawning
        this.environmentObjectSpawner = null;
    }

    init() {
        if (this.initialized) return;

        // Initialize TerrainDataManager with collections and game config
        const collections = this.game.getCollections();
        const gameConfig = collections.configs.game;
        const currentLevel = this.game.state?.level || 'level1';
        console.log(GUTS);
        this.terrainDataManager = new GUTS.TerrainDataManager();

        this.terrainDataManager.init(collections, gameConfig, currentLevel);

        // Initialize EnvironmentObjectSpawner in runtime mode
        this.environmentObjectSpawner = new GUTS.EnvironmentObjectSpawner({
            mode: 'runtime',
            game: this.game,
            collections: collections
        });

        // Register terrain query methods with gameManager
        this.game.gameManager.register('getTerrainHeightAtPosition', this.getTerrainHeightAtPosition.bind(this));
        this.game.gameManager.register('getTerrainTypeAtPosition', this.getTerrainTypeAtPosition.bind(this));
        this.game.gameManager.register('getTerrainHeightAtPositionSmooth', this.getTerrainHeightAtPositionSmooth.bind(this));
        this.game.gameManager.register('getTileMapTerrainType', this.getTileMapTerrainType.bind(this));
        this.game.gameManager.register('getTerrainTypeAtGridPosition', this.getTerrainTypeAtGridPosition.bind(this));
        this.game.gameManager.register('getHeightLevelAtGridPosition', this.getHeightLevelAtGridPosition.bind(this));
        this.game.gameManager.register('getTileMap', () => this.terrainDataManager.tileMap);
        this.game.gameManager.register('getTerrainSize', () => this.terrainDataManager.terrainSize);
        this.game.gameManager.register('getTerrainExtensionSize', () => this.terrainDataManager.extensionSize);
        this.game.gameManager.register('getTerrainExtendedSize', () => this.terrainDataManager.extendedSize);

        this.spawnWorldObjects();

        this.initialized = true;
    }

    /**
     * Spawn world objects from level data
     * Uses shared EnvironmentObjectSpawner library
     * Creates entities with gameplay components (POSITION, COLLISION, TEAM, UNIT_TYPE)
     * Visual components (RENDERABLE, ANIMATION) are added by WorldSystem on client
     */
    spawnWorldObjects() {
        if (!this.environmentObjectSpawner || !this.terrainDataManager) {
            console.warn('[TerrainSystem] Cannot spawn world objects: missing dependencies');
            return;
        }

        this.environmentObjectSpawner.spawnWorldObjects(
            this.terrainDataManager.tileMap,
            this.terrainDataManager
        );
    }


    getTileMapTerrainType(terrainTypeIndex) {
        return this.terrainDataManager.getTileMapTerrainType(terrainTypeIndex);
    }

    /**
     * Get terrain height at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Terrain height
     */
    getTerrainHeightAtPosition(worldX, worldZ) {
        return this.terrainDataManager.getTerrainHeightAtPosition(worldX, worldZ);
    }

    /**
     * Get terrain height with bilinear interpolation for smoother transitions
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Smoothly interpolated terrain height
     */
    getTerrainHeightAtPositionSmooth(worldX, worldZ) {
        return this.terrainDataManager.getTerrainHeightAtPositionSmooth(worldX, worldZ);
    }

    /**
     * Get terrain type at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number|null} Terrain type index, or null if outside bounds
     */
    getTerrainTypeAtPosition(worldX, worldZ) {
        return this.terrainDataManager.getTerrainTypeAtPosition(worldX, worldZ);
    }

    getTerrainTypeAtGridPosition(gridX, gridZ) {
        return this.terrainDataManager.getTerrainTypeAtGridPosition(gridX, gridZ);
    }

    /**
     * Get height level at grid position (not the actual height, but the level index)
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @returns {number|null} Height level (0, 1, 2, etc.), or null if outside bounds
     */
    getHeightLevelAtGridPosition(gridX, gridZ) {
        return this.terrainDataManager.getHeightLevelAtGridPosition(gridX, gridZ);
    }

    /**
     * Check if a position is within terrain bounds
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within terrain bounds
     */
    isWithinTerrainBounds(worldX, worldZ) {
        return this.terrainDataManager.isWithinTerrainBounds(worldX, worldZ);
    }

    /**
     * Check if a position is within extended terrain bounds (including extension)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within extended terrain bounds
     */
    isWithinExtendedBounds(worldX, worldZ) {
        return this.terrainDataManager.isWithinExtendedBounds(worldX, worldZ);
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
        const halfTerrain = this.terrainDataManager.terrainSize / 2;

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
        const halfTerrain = this.terrainDataManager.terrainSize / 2;

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
        // Clean up EnvironmentObjectSpawner
        if (this.environmentObjectSpawner) {
            this.environmentObjectSpawner.destroy();
            this.environmentObjectSpawner = null;
        }

        // Clean up TerrainDataManager
        if (this.terrainDataManager) {
            this.terrainDataManager.destroy();
            this.terrainDataManager = null;
        }

        this.initialized = false;
    }
}