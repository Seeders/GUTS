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
        this.currentLevelData = null;
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
     * Called when a scene is loaded - initializes terrain from game.state.level
     * @param {Object} sceneData - The scene configuration data
     */
    async onSceneLoad(sceneData) {
        // Get level from game state (set by lobby/skirmish before scene switch)
        const levelIndex = this.game.state?.level;
        if (levelIndex === undefined || levelIndex < 0) {
            // No level selected - terrain system won't initialize (e.g., lobby scene)
            return;
        }

        // Get level name from reverse enum
        const levelName = this.reverseEnums.levels[levelIndex];
        if (!levelName) {
            console.warn(`[TerrainSystem] Invalid level index: ${levelIndex}`);
            return;
        }

        await this.initTerrainFromLevel(levelName);
    }

    /**
     * Called when a scene is unloaded - cleanup terrain
     */
    onSceneUnload() {
        this.cleanupTerrain();
    }

    /**
     * Initialize terrain from a level reference
     * @param {string} levelName - The level name to load
     */
    async initTerrainFromLevel(levelName) {
        // Clean up existing terrain first
        this.cleanupTerrain();

        // Store current level for getLevel() query
        this.currentLevel = levelName;

        const gameConfig = this.collections.configs.game;

        this.terrainDataManager = new GUTS.TerrainDataManager();
        this.terrainDataManager.init(this.collections, gameConfig, levelName);

        // Store level data for entity loading
        this.currentLevelData = this.collections.levels?.[levelName];

        // Create the terrain entity with component data from level
        this.createTerrainEntity(levelName);

        // Skip spawning level entities if loading from a save (save contains all entities)
        if (!this.game.state.isLoadingSave) {
            await this.loadLevelEntities();
        }
    }

    /**
     * Create the terrain entity using prefab system
     * @param {string} levelName - The level name
     */
    createTerrainEntity(levelName) {
        const levelData = this.currentLevelData;
        if (!levelData) return;

        // Use createEntityFromPrefab for consistent entity creation
        const entityId = this.game.call('createEntityFromPrefab', {
            prefab: 'terrain',
            type: levelName,
            collection: 'levels',
            team: this.enums.team?.neutral ?? 0,
            componentOverrides: {}
        });

        this.terrainEntityId = entityId;
    }

    /**
     * Clean up terrain resources
     */
    cleanupTerrain() {
        if (this.terrainDataManager) {
            this.terrainDataManager.dispose();
            this.terrainDataManager = null;
        }

        this.currentLevelData = null;
    }

    /**
     * Load level entities from level data
     * Uses prefab-driven entity creation for proper component configuration
     * Supports prefab format: { prefab: "worldObject", type: "tree_sprite", components: { transform } }
     */
    async loadLevelEntities() {
        if (!this.currentLevelData) {
            console.log('[TerrainSystem] No level data available for entity loading');
            return;
        }

        const levelEntities = this.currentLevelData.tileMap?.levelEntities || [];
        if (levelEntities.length === 0) {
            console.log('[TerrainSystem] No level entities to spawn');
            return;
        }

        console.log(`[TerrainSystem] Loading ${levelEntities.length} level entities...`);

        const enums = this.game.call('getEnums');
        const prefabs = this.collections.prefabs || {};
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};

        // Build reverse mapping: prefab singular name -> collection id
        // e.g., "worldObject" -> "worldObjects", "unit" -> "units"
        const prefabToCollection = {};
        for (const [collectionId, typeDef] of Object.entries(objectTypeDefinitions)) {
            if (typeDef.singular) {
                prefabToCollection[typeDef.singular] = collectionId;
            }
        }

        for (const entityDef of levelEntities) {
            try {
                if (!entityDef.prefab) {
                    console.warn(`[TerrainSystem] Entity missing prefab:`, entityDef);
                    continue;
                }

                const prefabData = prefabs[entityDef.prefab];
                if (!prefabData) {
                    console.warn(`[TerrainSystem] Unknown prefab: ${entityDef.prefab}`);
                    continue;
                }

                const prefabName = entityDef.prefab;
                // Get collection from objectTypeDefinitions mapping (singular -> id)
                const collection = prefabToCollection[prefabName];
                if (!collection) {
                    console.warn(`[TerrainSystem] No collection mapping for prefab: ${prefabName}`);
                    continue;
                }
                const type = entityDef.type;
                const componentOverrides = entityDef.components || {};

                // Adjust terrain height if Y is 0 or undefined
                if (componentOverrides.transform?.position) {
                    const pos = componentOverrides.transform.position;
                    if (pos.y === undefined || pos.y === 0) {
                        const terrainHeight = this.getTerrainHeightAtPosition(pos.x, pos.z);
                        componentOverrides.transform.position = { ...pos, y: terrainHeight };
                    }
                }

                // Create entity using prefab-driven system
                this.game.call('createEntityFromPrefab', {
                    prefab: prefabName,
                    type: type,
                    collection: collection,
                    team: enums.team.neutral,
                    componentOverrides: componentOverrides
                });
            } catch (error) {
                console.error(`[TerrainSystem] Failed to create level entity:`, entityDef, error);
            }
        }

        console.log(`[TerrainSystem] Loaded ${levelEntities.length} level entities`);
    }

    /**
     * Deep merge components, with entity-specific values overriding prefab defaults
     * @deprecated No longer needed with prefab-driven system
     */
    mergeComponents(prefabComponents, entityComponents) {
        if (!prefabComponents) return entityComponents || {};
        if (!entityComponents) return { ...prefabComponents };

        const result = {};

        // Copy all prefab components
        for (const key of Object.keys(prefabComponents)) {
            const prefabValue = prefabComponents[key];
            const entityValue = entityComponents[key];

            if (entityValue === undefined) {
                result[key] = prefabValue;
            } else if (typeof prefabValue === 'object' && typeof entityValue === 'object' &&
                       prefabValue !== null && entityValue !== null &&
                       !Array.isArray(prefabValue) && !Array.isArray(entityValue)) {
                // Deep merge objects
                result[key] = { ...prefabValue, ...entityValue };
            } else {
                // Entity value overrides prefab value
                result[key] = entityValue;
            }
        }

        // Add any entity-only components
        for (const key of Object.keys(entityComponents)) {
            if (!(key in result)) {
                result[key] = entityComponents[key];
            }
        }

        return result;
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
