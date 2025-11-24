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
     * Get world position from world object
     */
    calculateWorldPosition(worldObj, terrainDataManager) {
        // World objects use x for worldX and y for worldZ
        // (y in the data maps to Z axis in 3D world)

        // Use centralized coordinate conversion from CoordinateTranslator if available
        if (this.mode === 'runtime' && this.game?.gameManager) {
            const worldPos = this.game.gameManager.call('pixelToWorld', worldObj.x, worldObj.y);
            return {
                worldX: worldPos.x,
                worldZ: worldPos.z
            };
        }

        // Fallback for editor mode or if gameManager not available
        const terrainSize = terrainDataManager.terrainSize;
        return {
            worldX: worldObj.x - (terrainSize / 2),
            worldZ: worldObj.y - (terrainSize / 2)
        };
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
     * Spawn world objects from tileMap data
     * @param {Object} tileMap - Terrain tile map with worldObjects array
     * @param {Object} terrainDataManager - TerrainDataManager instance for position/height calculations
     */
    async spawnWorldObjects(tileMap, terrainDataManager) {
        if (!tileMap?.worldObjects || tileMap.worldObjects.length === 0) {
            console.log('[EnvironmentObjectSpawner] No world objects to spawn');
            return;
        }

        // Debug: log first world object to see format
        if (tileMap.worldObjects.length > 0) {
            console.log('[EnvironmentObjectSpawner] First world object format:', tileMap.worldObjects[0]);
        }

        // Clear existing spawned objects
        this.clearWorldObjects();

        const spawnPromises = [];

        for (const worldObj of tileMap.worldObjects) {
            const promise = this.spawnSingleObject(worldObj, terrainDataManager);
            spawnPromises.push(promise);
        }

        await Promise.all(spawnPromises);

        console.log(`[EnvironmentObjectSpawner] Spawned ${tileMap.worldObjects.length} world objects in ${this.mode} mode`);
    }

    /**
     * Spawn a single world object
     */
    async spawnSingleObject(worldObj, terrainDataManager) {
        // Get unit type definition
        const unitType = this.collections?.worldObjects?.[worldObj.type];
        if (!unitType) {
            console.warn(`[EnvironmentObjectSpawner] World object type '${worldObj.type}' not found in worldObjects collection`);
            return;
        }

        // Calculate world position
        const { worldX, worldZ } = this.calculateWorldPosition(worldObj, terrainDataManager);

        // Get terrain height
        const height = this.getTerrainHeight(worldX, worldZ, terrainDataManager);

        // Fixed rotation and scale (no random variation)
        const rotation = 0;
        const scale = 32;

        if (this.mode === 'runtime') {
            // Runtime mode: Create ECS entity with components
            this.spawnRuntimeEntity(worldObj, unitType, worldX, height, worldZ, rotation, scale);
        } else if (this.mode === 'editor') {
            // Editor mode: Render using EntityRenderer
            await this.spawnEditorEntity(worldObj, unitType, worldX, height, worldZ, rotation, scale);
        }
    }

    /**
     * Spawn world object in runtime mode (ECS)
     */
    spawnRuntimeEntity(worldObj, unitType, worldX, height, worldZ, rotation, scale) {
        if (!this.game) {
            console.error('[EnvironmentObjectSpawner] Game instance required for runtime mode');
            return;
        }

        const ComponentTypes = this.game.gameManager.call('getComponentTypes');
        const Components = this.game.gameManager.call('getComponents');

        // Create entity with unique ID
        const entityId = this.game.createEntity(`env_${worldObj.type}_${worldObj.x}_${worldObj.y}`);

        // Add Position component
        this.game.addComponent(entityId, ComponentTypes.POSITION,
            Components.Position(worldX, height, worldZ));

        // Add UnitType component
        const unitTypeData = { ...unitType, collection: "worldObjects", id: worldObj.type };
        this.game.addComponent(entityId, ComponentTypes.UNIT_TYPE,
            Components.UnitType(unitTypeData));

        // Add Team component (neutral for world objects)
        this.game.addComponent(entityId, ComponentTypes.TEAM,
            Components.Team('neutral'));

        // Add Collision component if the object should block movement
        // Check for impassable property (true means it blocks movement)
        if (unitType.impassable === true && unitType.size) {
            this.game.addComponent(entityId, ComponentTypes.COLLISION,
                Components.Collision(unitType.size, unitType.height || 100));
        }

        // Add Facing component for rotation
        this.game.addComponent(entityId, ComponentTypes.FACING,
            Components.Facing(rotation));

        // Store scale in Animation component
        if (!this.game.hasComponent(entityId, ComponentTypes.ANIMATION)) {
            this.game.addComponent(entityId, ComponentTypes.ANIMATION,
                Components.Animation(scale, rotation, 0));
        }

        this.spawnedEntities.add(entityId);
    }

    /**
     * Spawn world object in editor mode (visual rendering)
     */
    async spawnEditorEntity(worldObj, unitType, worldX, height, worldZ, rotation, scale) {
        if (!this.entityRenderer) {
            console.error('[EnvironmentObjectSpawner] EntityRenderer required for editor mode');
            return;
        }

        // Create unique entity ID for editor
        const entityId = `env_${worldObj.type}_${worldObj.x}_${worldObj.y}`;

        // Spawn using EntityRenderer
        const spawned = await this.entityRenderer.spawnEntity(entityId, {
            collection: 'worldObjects',
            type: worldObj.type,
            position: { x: worldX, y: height, z: worldZ },
            rotation: rotation,
            scale: scale,
            facing: rotation
        });

        if (spawned) {
            this.spawnedEntities.add(entityId);
        }
    }

    /**
     * Clear all spawned world objects
     */
    clearWorldObjects() {
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
        console.log('[EnvironmentObjectSpawner] Cleared all world objects');
    }

    /**
     * Update world objects (respawn)
     */
    async updateWorldObjects(tileMap, terrainDataManager) {
        await this.spawnWorldObjects(tileMap, terrainDataManager);
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.clearWorldObjects();
        this.game = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;
        this.collections = null;
    }
}
