/**
 * EnvironmentObjectSpawner - Shared library for spawning environment objects
 *
 * Provides consistent environment object spawning for:
 * - TerrainSystem: Creates ECS entities with gameplay components
 * - TerrainMapEditor: Creates ECS entities with systems running (via TerrainEditorContext)
 */
class EnvironmentObjectSpawner {
    constructor(options = {}) {
        this.mode = options.mode; // 'runtime' or 'editorContext'

        // Runtime mode dependencies (TerrainSystem)
        this.game = options.game;

        // EditorContext mode dependencies (TerrainEditorContext with ECS systems)
        this.editorContext = options.editorContext;
        this.terrainDataManager = options.terrainDataManager;

        // Common dependencies
        this.collections = options.collections;

        // Track spawned entities for cleanup
        this.spawnedEntities = new Set();
    }

    /**
     * Generate a seeded random number based on grid position
     * This ensures the same object always gets the same offset
     */
    seededRandom(gridX, gridZ, seed = 0) {
        const n = Math.sin(gridX * 12.9898 + gridZ * 78.233 + seed) * 43758.5453;
        return n - Math.floor(n);
    }

    /**
     * Get world position from world object with random offset within tile
     */
    calculateWorldPosition(worldObj, terrainDataManager) {
        // World objects use gridX/gridZ for tile grid coordinates
        // Convert to world coordinates using tile grid (96) not placement grid (48)

        const GRID_SIZE = 48; // Tile grid size
        const OFFSET_RANGE = 0.7; // Use 70% of tile size for offset range to keep objects away from edges

        // Generate consistent random offsets based on grid position
        const randomX = (this.seededRandom(worldObj.gridX, worldObj.gridZ, 1) - 0.5) * GRID_SIZE * OFFSET_RANGE;
        const randomZ = (this.seededRandom(worldObj.gridX, worldObj.gridZ, 2) - 0.5) * GRID_SIZE * OFFSET_RANGE;

        // Use centralized coordinate conversion from CoordinateTranslator if available
        if (this.mode === 'runtime' && this.game?.gameSystem) {
            // Use tileToWorld with centering to place objects in the center of their tile
            const worldPos = this.game.call('tileToWorld', worldObj.gridX, worldObj.gridZ, true);
            return {
                worldX: worldPos.x + randomX,
                worldZ: worldPos.z + randomZ
            };
        }

        // Fallback for editor mode or if gameManager not available
        const terrainSize = terrainDataManager.terrainSize;
        // Center the object in the tile, then add random offset
        const pixelX = worldObj.gridX * GRID_SIZE;
        const pixelZ = worldObj.gridZ * GRID_SIZE;
        return {
            worldX: pixelX - (terrainSize / 2) + (GRID_SIZE / 2) + randomX,
            worldZ: pixelZ - (terrainSize / 2) + (GRID_SIZE / 2) + randomZ
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
            return;
        }

        // Clear existing spawned objects
        this.clearWorldObjects();

        const spawnPromises = [];

        for (const worldObj of tileMap.worldObjects) {
            const promise = this.spawnSingleObject(worldObj, terrainDataManager);
            spawnPromises.push(promise);
        }

        await Promise.all(spawnPromises);
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

        // Calculate world position (includes random offset within tile)
        const { worldX, worldZ } = this.calculateWorldPosition(worldObj, terrainDataManager);

        // Get terrain height with small random variance
        const baseHeight = this.getTerrainHeight(worldX, worldZ, terrainDataManager);
        const HEIGHT_VARIANCE = 2; // Small height variance in world units
        const heightOffset = (this.seededRandom(worldObj.gridX, worldObj.gridZ, 3) - 0.5) * HEIGHT_VARIANCE;
        const height = baseHeight + heightOffset;

        // Fixed rotation and scale (no random variation)
        const rotation = 0;
        const scale = 32;

        if (this.mode === 'runtime') {
            // Runtime mode: Create ECS entity with components
            this.spawnRuntimeEntity(worldObj, unitType, worldX, height, worldZ, rotation, scale);
        } else if (this.mode === 'editorContext') {
            // EditorContext mode: Create ECS entities with systems running
            await this.spawnEditorContextEntity(worldObj, terrainDataManager);
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

        // Create entity with unique ID
        const entityId = this.game.createEntity(`env_${worldObj.type}_${worldObj.gridX}_${worldObj.gridZ}`);

        // Add Transform component
        this.game.addComponent(entityId, "transform", {
            position: { x: worldX, y: height, z: worldZ },
            rotation: { x: 0, y: rotation, z: 0 },
            scale: { x: scale, y: scale, z: scale }
        });

        // Add UnitType component
        const unitTypeData = { ...unitType, collection: "worldObjects", id: worldObj.type };
        this.game.addComponent(entityId, "unitType", unitTypeData);

        // Add Team component (neutral for world objects)
        this.game.addComponent(entityId, "team", { team: 'neutral' });

        // Add Collision component if the object should block movement
        // Check for impassable property (true means it blocks movement)
        if (unitType.impassable === true && unitType.size) {
            this.game.addComponent(entityId, "collision", { radius: unitType.size, height: unitType.height || 100 });
        }

        // Store animation data
        if (!this.game.hasComponent(entityId, "animation")) {
            this.game.addComponent(entityId, "animation", { scale, rotation, flash: 0 });
        }

        this.spawnedEntities.add(entityId);
    }

    /**
     * Spawn world object in editorContext mode (ECS with systems)
     * Creates proper ECS entities so AnimationSystem can manage animations
     */
    async spawnEditorContextEntity(worldObj, terrainDataManager) {
        if (!this.editorContext) {
            console.error('[EnvironmentObjectSpawner] EditorContext required for editorContext mode');
            return;
        }

        // Use the editorContext's spawnWorldObject method which creates ECS entities
        const entityId = await this.editorContext.spawnWorldObject(worldObj, terrainDataManager);

        if (entityId) {
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
                this.game.destroyEntity(entityId);
            }
        } else if (this.mode === 'editorContext' && this.editorContext) {
            // EditorContext mode: Remove ECS entities via context
            for (const entityId of this.spawnedEntities) {
                this.editorContext.removeWorldObject(entityId);
            }
        }

        this.spawnedEntities.clear();
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
        this.editorContext = null;
        this.terrainDataManager = null;
        this.collections = null;
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnvironmentObjectSpawner;
}

if (typeof GUTS !== 'undefined') {
    GUTS.EnvironmentObjectSpawner = EnvironmentObjectSpawner;
}
