/**
 * EnvironmentObjectSpawner - Shared library for spawning environment objects
 *
 * Provides consistent environment object spawning for:
 * - TerrainSystem: Creates ECS entities with gameplay components
 * - TerrainMapEditor: Renders objects visually using EntityRenderer
 */
class EnvironmentObjectSpawner {
    constructor(options = {}) {
        this.mode = options.mode; // 'runtime' or 'editor'

        // Runtime mode dependencies (TerrainSystem)
        this.game = options.game;

        // Editor mode dependencies (TerrainMapEditor)
        this.entityRenderer = options.entityRenderer;
        this.terrainDataManager = options.terrainDataManager;

        // Common dependencies
        this.collections = options.collections;

        // Track spawned entities for cleanup
        this.spawnedEntities = new Set();

        console.log(`[EnvironmentObjectSpawner] Initialized in ${this.mode} mode`);
    }

    /**
     * Calculate world position from environment object grid position
     */
    calculateWorldPosition(envObj, terrainDataManager) {
        const worldX = (envObj.x + terrainDataManager.extensionSize) - terrainDataManager.extendedSize / 2;
        const worldZ = (envObj.y + terrainDataManager.extensionSize) - terrainDataManager.extendedSize / 2;
        return { worldX, worldZ };
    }

    /**
     * Get terrain height at position
     */
    getTerrainHeight(worldX, worldZ, terrainDataManager) {
        if (!terrainDataManager.heightMapSettings?.enabled) {
            return 0;
        }
        return terrainDataManager.getTerrainHeightAtPosition(worldX, worldZ);
    }

    /**
     * Spawn environment objects from tileMap data
     * @param {Object} tileMap - Terrain tile map with environmentObjects array
     * @param {Object} terrainDataManager - TerrainDataManager instance for position/height calculations
     */
    async spawnEnvironmentObjects(tileMap, terrainDataManager) {
        if (!tileMap?.environmentObjects || tileMap.environmentObjects.length === 0) {
            console.log('[EnvironmentObjectSpawner] No environment objects to spawn');
            return;
        }

        // Clear existing spawned objects
        this.clearEnvironmentObjects();

        const spawnPromises = [];

        for (const envObj of tileMap.environmentObjects) {
            const promise = this.spawnSingleObject(envObj, terrainDataManager);
            spawnPromises.push(promise);
        }

        await Promise.all(spawnPromises);

        console.log(`[EnvironmentObjectSpawner] Spawned ${tileMap.environmentObjects.length} environment objects in ${this.mode} mode`);
    }

    /**
     * Spawn a single environment object
     */
    async spawnSingleObject(envObj, terrainDataManager) {
        // Get unit type definition
        const unitType = this.collections?.worldObjects?.[envObj.type];
        if (!unitType) {
            console.warn(`[EnvironmentObjectSpawner] Environment object type '${envObj.type}' not found in worldObjects collection`);
            return;
        }

        // Calculate world position
        const { worldX, worldZ } = this.calculateWorldPosition(envObj, terrainDataManager);
        const height = this.getTerrainHeight(worldX, worldZ, terrainDataManager);

        // Create entity ID
        const entityId = `env_${envObj.type}_${envObj.x}_${envObj.y}`;
        const rotation = 0;
        const scale = 32;

        // Runtime: Create ECS entity
        if (this.game) {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const Components = this.game.componentManager.getComponents();
            const ecsEntityId = this.game.createEntity(entityId);

            this.game.addComponent(ecsEntityId, ComponentTypes.POSITION,
                Components.Position(worldX, height, worldZ));
            this.game.addComponent(ecsEntityId, ComponentTypes.UNIT_TYPE,
                Components.UnitType({ ...unitType, collection: "worldObjects", id: envObj.type }));
            this.game.addComponent(ecsEntityId, ComponentTypes.TEAM,
                Components.Team('neutral'));

            if (unitType.collision !== false && unitType.size) {
                this.game.addComponent(ecsEntityId, ComponentTypes.COLLISION,
                    Components.Collision(unitType.size, unitType.height || 100));
            }

            this.game.addComponent(ecsEntityId, ComponentTypes.FACING,
                Components.Facing(rotation));
            this.game.addComponent(ecsEntityId, ComponentTypes.ANIMATION,
                Components.Animation(scale, rotation, 0));
        }

        // Editor: Render with EntityRenderer
        if (this.entityRenderer) {
            await this.entityRenderer.spawnEntity(entityId, {
                collection: 'worldObjects',
                type: envObj.type,
                position: { x: worldX, y: height, z: worldZ },
                rotation: rotation,
                scale: scale,
                facing: rotation
            });
        }

        this.spawnedEntities.add(entityId);
    }

    /**
     * Clear all spawned environment objects
     */
    clearEnvironmentObjects() {
        if (this.mode === 'runtime' && this.game) {
            // Runtime mode: Destroy ECS entities
            for (const entityId of this.spawnedEntities) {
                if (this.game.entityExists(entityId)) {
                    this.game.destroyEntity(entityId);
                }
            }
        } else if (this.mode === 'editor' && this.entityRenderer) {
            // Editor mode: Remove from EntityRenderer
            for (const entityId of this.spawnedEntities) {
                this.entityRenderer.removeEntity(entityId);
            }
        }

        this.spawnedEntities.clear();
        console.log('[EnvironmentObjectSpawner] Cleared all environment objects');
    }

    /**
     * Update environment objects (respawn)
     */
    async updateEnvironmentObjects(tileMap, terrainDataManager) {
        await this.spawnEnvironmentObjects(tileMap, terrainDataManager);
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.clearEnvironmentObjects();
        this.game = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;
        this.collections = null;
    }
}
