class TerrainSystem extends GUTS.BaseSystem {
    static services = [
        'getTerrainHeightAtPosition',
        'getTerrainTypeAtPosition',
        'getTerrainHeightAtPositionSmooth',
        'getTileMapTerrainType',
        'getTerrainTypeAtGridPosition',
        'getHeightLevelAtGridPosition',
        'getTileMap',
        'getTerrainSize',
        'getTerrainExtensionSize',
        'getTerrainExtendedSize',
        'initTerrainFromComponent',
        'hasTerrain',
        'getLevel',
        'isTerrainInitialized'
    ];

    constructor(game) {
        super(game);
        this.game.terrainSystem = this;

        this.initialized = false;
        this.terrainEntityId = null;
        this.terrainDataManager = null;
        this.currentLevel = null;

        // Use global TerrainDataManager for all terrain data operations
        // Environment object spawner for consistent spawning
        this.environmentObjectSpawner = null;
    }

    init() {
        if (this.initialized) return;

        // TerrainSystem waits for scene to load via onSceneLoad()
        // Terrain entity in scene triggers terrain initialization

        this.initialized = true;
    }

    // Service methods for static services registration
    getTileMap() {
        return this.terrainDataManager?.tileMap;
    }

    getTerrainSize() {
        return this.terrainDataManager?.terrainSize;
    }

    getTerrainExtensionSize() {
        return this.terrainDataManager?.extensionSize;
    }

    getTerrainExtendedSize() {
        return this.terrainDataManager?.extendedSize;
    }

    hasTerrain() {
        return this.terrainDataManager !== null;
    }

    getLevel() {
        return this.currentLevel;
    }

    isTerrainInitialized() {
        return this.initialized && this.terrainDataManager !== null;
    }

    /**
     * Called when a scene is loaded - initializes terrain if the scene has a terrain entity
     * @param {Object} sceneData - The scene configuration data
     */
    async onSceneLoad(sceneData) {
        // Look for a terrain entity in the scene
        const terrainEntities = this.game.getEntitiesWith('terrain');

        if (terrainEntities.length > 0) {
            const terrainEntityId = terrainEntities[0];
            const terrainComponent = this.game.getComponent(terrainEntityId, 'terrain');
            await this.initTerrainFromComponent(terrainComponent, terrainEntityId);
        }
        // If no terrain entity, terrain system won't initialize (no terrain in this scene)
    }

    /**
     * Called when a scene is unloaded - cleanup terrain
     */
    onSceneUnload() {
        this.cleanupTerrain();
    }

    /**
     * Initialize terrain from a terrain component
     * @param {Object} terrainComponent - The terrain component data
     * @param {string} entityId - The entity ID that has the terrain component
     */
    async initTerrainFromComponent(terrainComponent, entityId) {
        // Level is stored as numeric enum index
        const levelIndex = terrainComponent?.level;
        if (levelIndex === undefined || levelIndex < 0) {
            console.warn('[TerrainSystem] Terrain component missing level reference');
            return;
        }

        // Get level name from reverse enum
        const levelName = this.reverseEnums.levels[levelIndex];
        if (!levelName) {
            console.warn(`[TerrainSystem] Invalid level index: ${levelIndex}`);
            return;
        }

        this.terrainEntityId = entityId;
        await this.initTerrainFromLevel(levelName, terrainComponent);
    }

    /**
     * Initialize terrain from a level reference
     * @param {string} levelName - The level name to load
     * @param {Object} terrainConfig - Optional terrain component config for overrides
     */
    async initTerrainFromLevel(levelName, terrainConfig = {}) {
        // Clean up existing terrain first
        this.cleanupTerrain();

        // Store current level for getLevel() query
        this.currentLevel = levelName;

        const gameConfig = this.collections.configs.game;

        this.terrainDataManager = new GUTS.TerrainDataManager();
        this.terrainDataManager.init(this.collections, gameConfig, levelName);

        // Initialize EnvironmentObjectSpawner in runtime mode
        this.environmentObjectSpawner = new GUTS.EnvironmentObjectSpawner({
            mode: 'runtime',
            game: this.game,
            collections: this.collections
        });

        // Skip spawning world objects if loading from a save (save contains all entities)
        if (!this.game.state.isLoadingSave) {
            await this.spawnWorldObjects();
        } else {
        }

    }

    /**
     * Clean up terrain resources
     */
    cleanupTerrain() {
        if (this.environmentObjectSpawner) {
            this.environmentObjectSpawner.destroy();
            this.environmentObjectSpawner = null;
        }

        if (this.terrainDataManager) {
            this.terrainDataManager.dispose();
            this.terrainDataManager = null;
        }

        this.terrainEntityId = null;
    }

    /**
     * Spawn world objects from level data
     * Uses shared EnvironmentObjectSpawner library
     * Creates entities with gameplay components (POSITION, COLLISION, TEAM, UNIT_TYPE)
     * Visual components (RENDERABLE, ANIMATION) are added by WorldSystem on client
     */
    async spawnWorldObjects() {
        if (!this.environmentObjectSpawner || !this.terrainDataManager) {
            console.warn('[TerrainSystem] Cannot spawn world objects: missing dependencies');
            return;
        }

        await this.environmentObjectSpawner.spawnWorldObjects(
            this.terrainDataManager.tileMap,
            this.terrainDataManager
        );
    }


    getTileMapTerrainType(terrainTypeIndex) {
        if (!this.terrainDataManager) return null;
        return this.terrainDataManager.getTileMapTerrainType(terrainTypeIndex);
    }

    /**
     * Get terrain height at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Terrain height (0 if no terrain)
     */
    getTerrainHeightAtPosition(worldX, worldZ) {
        if (!this.terrainDataManager) return 0;
        return this.terrainDataManager.getTerrainHeightAtPosition(worldX, worldZ);
    }

    /**
     * Get terrain height with bilinear interpolation for smoother transitions
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Smoothly interpolated terrain height (0 if no terrain)
     */
    getTerrainHeightAtPositionSmooth(worldX, worldZ) {
        if (!this.terrainDataManager) return 0;
        return this.terrainDataManager.getTerrainHeightAtPositionSmooth(worldX, worldZ);
    }

    /**
     * Get terrain type at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number|null} Terrain type index, or null if outside bounds or no terrain
     */
    getTerrainTypeAtPosition(worldX, worldZ) {
        if (!this.terrainDataManager) return null;
        return this.terrainDataManager.getTerrainTypeAtPosition(worldX, worldZ);
    }

    getTerrainTypeAtGridPosition(gridX, gridZ) {
        if (!this.terrainDataManager) return null;
        return this.terrainDataManager.getTerrainTypeAtGridPosition(gridX, gridZ);
    }

    /**
     * Get height level at grid position (not the actual height, but the level index)
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridZ - Grid Z coordinate
     * @returns {number|null} Height level (0, 1, 2, etc.), or null if outside bounds or no terrain
     */
    getHeightLevelAtGridPosition(gridX, gridZ) {
        if (!this.terrainDataManager) return null;
        return this.terrainDataManager.getHeightLevelAtGridPosition(gridX, gridZ);
    }

    /**
     * Check if a position is within terrain bounds
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within terrain bounds, false if no terrain
     */
    isWithinTerrainBounds(worldX, worldZ) {
        if (!this.terrainDataManager) return false;
        return this.terrainDataManager.isWithinTerrainBounds(worldX, worldZ);
    }

    /**
     * Check if a position is within extended terrain bounds (including extension)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if within extended terrain bounds, false if no terrain
     */
    isWithinExtendedBounds(worldX, worldZ) {
        if (!this.terrainDataManager) return false;
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
        if (!this.terrainDataManager) return;
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
        if (!this.terrainDataManager) {
            return { x: preferredX, y: 0, z: preferredZ };
        }

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
        this.cleanupTerrain();
        this.initialized = false;
    }
}
