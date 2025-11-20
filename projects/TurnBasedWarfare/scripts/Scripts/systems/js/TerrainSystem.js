class TerrainSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.terrainSystem = this;

        this.initialized = false;

        // Use global TerrainDataManager for all terrain data operations
        this.terrainDataManager = new TerrainDataManager();
    }

    init() {
        if (this.initialized) return;

        // Initialize TerrainDataManager with collections and game config
        const collections = this.game.getCollections();
        const gameConfig = collections.configs.game;
        const currentLevel = this.game.state?.level || 'level1';

        this.terrainDataManager.init(collections, gameConfig, currentLevel);

        // Register terrain query methods with gameManager
        this.game.gameManager.register('getTerrainHeightAtPosition', this.getTerrainHeightAtPosition.bind(this));
        this.game.gameManager.register('getTerrainSize', () => this.terrainDataManager.terrainSize);
        this.game.gameManager.register('getTerrainTypeAtPosition', this.getTerrainTypeAtPosition.bind(this));
        this.game.gameManager.register('getTileMapTerrainType', this.getTileMapTerrainType.bind(this));
        this.game.gameManager.register('getTerrainTypeAtGridPosition', this.getTerrainTypeAtGridPosition.bind(this));

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
        if (!this.terrainDataManager.tileMap?.environmentObjects ||
            this.terrainDataManager.tileMap.environmentObjects.length === 0) {
            return;
        }

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        this.terrainDataManager.tileMap.environmentObjects.forEach(envObj => {
            const unitType = collections.worldObjects?.[envObj.type];
            if (!unitType) {
                console.warn(`Environment object type '${envObj.type}' not found in worldObjects collection`);
                return;
            }

            // Calculate world position
            const worldX = (envObj.x + this.terrainDataManager.extensionSize) - this.terrainDataManager.extendedSize / 2;
            const worldZ = (envObj.y + this.terrainDataManager.extensionSize) - this.terrainDataManager.extendedSize / 2;

            // Get terrain height
            let height = 0;
            if (this.terrainDataManager.heightMapSettings?.enabled) {
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

        console.log(`TerrainSystem: Spawned ${this.terrainDataManager.tileMap.environmentObjects.length} environment objects`);
    }

    /**
     * Seeded random for consistent values between client and server
     */
    seededRandom(x, y) {
        const seed = x * 12.9898 + y * 78.233;
        return (Math.sin(seed) * 43758.5453) % 1;
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
        // Clean up TerrainDataManager
        if (this.terrainDataManager) {
            this.terrainDataManager.destroy();
            this.terrainDataManager = null;
        }

        this.initialized = false;
    }
}