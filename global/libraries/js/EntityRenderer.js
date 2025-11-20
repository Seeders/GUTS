/**
 * EntityRenderer - Shared entity rendering functionality
 *
 * Handles loading GLTF models and spawning entity meshes for any collection type.
 * Used by both the game's RenderSystem and the terrain editor for cliffs, worldObjects, etc.
 */
class EntityRenderer {
    constructor(options = {}) {
        this.scene = options.scene;
        this.collections = options.collections;
        this.projectName = options.projectName;
        this.getPalette = options.getPalette; // Function to get color palette

        // Loaded models cache by collection
        // Format: { collectionType: { entityType: modelData } }
        this.modelCache = new Map();
        this.loadingPromises = new Map();

        // Track spawned entities for cleanup
        // Format: Map<entityId, mesh>
        this.spawnedEntities = new Map();
    }

    /**
     * Load GLTF models from a collection
     * @param {string} collectionType - Collection name (e.g., 'cliffs', 'worldObjects', 'units')
     * @param {Array<string>} entityTypes - Optional: specific types to load, or null for all
     * @returns {Promise<Object>} Map of entity type to model data
     */
    async loadModelsFromCollection(collectionType, entityTypes = null) {
        // Check cache
        if (this.modelCache.has(collectionType)) {
            return this.modelCache.get(collectionType);
        }

        // Check if already loading
        const loadKey = collectionType;
        if (this.loadingPromises.has(loadKey)) {
            return await this.loadingPromises.get(loadKey);
        }

        // Start loading
        const loadPromise = this._loadModelsInternal(collectionType, entityTypes);
        this.loadingPromises.set(loadKey, loadPromise);

        try {
            const models = await loadPromise;
            this.modelCache.set(collectionType, models);
            return models;
        } finally {
            this.loadingPromises.delete(loadKey);
        }
    }

    async _loadModelsInternal(collectionType, entityTypes) {
        const collection = this.collections[collectionType];
        if (!collection) {
            console.warn(`[EntityRenderer] Collection '${collectionType}' not found`);
            return {};
        }

        const models = {};
        const loader = new THREE.GLTFLoader();

        // Determine which types to load
        const typesToLoad = entityTypes || Object.keys(collection);

        console.log(`[EntityRenderer] Loading ${typesToLoad.length} models from '${collectionType}'...`);

        for (const entityType of typesToLoad) {
            const entityDef = collection[entityType];
            if (!entityDef?.render?.model?.main?.shapes?.[0]) {
                continue;
            }

            const shape = entityDef.render.model.main.shapes[0];
            if (shape.type !== 'gltf') {
                continue;
            }

            try {
                const url = `/projects/${this.projectName}/resources/${shape.url}`;

                const gltf = await new Promise((resolve, reject) => {
                    loader.load(url, resolve, undefined, reject);
                });

                models[entityType] = {
                    scene: gltf.scene,
                    scale: entityDef.render.model.main.scale || { x: 1, y: 1, z: 1 },
                    position: entityDef.render.model.main.position || { x: 0, y: 0, z: 0 },
                    rotation: entityDef.render.model.main.rotation || { x: 0, y: 0, z: 0 },
                    color: shape.color,
                    metalness: shape.metalness !== undefined ? shape.metalness : 0,
                    roughness: shape.roughness !== undefined ? shape.roughness : 1
                };

                console.log(`[EntityRenderer] ✓ Loaded ${collectionType}.${entityType}`);
            } catch (error) {
                console.warn(`[EntityRenderer] Failed to load ${collectionType}.${entityType}:`, error.message);
            }
        }

        console.log(`[EntityRenderer] Loaded ${Object.keys(models).length}/${typesToLoad.length} models from '${collectionType}'`);
        return models;
    }

    /**
     * Spawn an entity mesh
     * @param {Object} entityData - Entity spawn data
     * @param {string} entityData.id - Unique entity ID
     * @param {string} entityData.collectionType - Collection type (cliffs, worldObjects, etc.)
     * @param {string} entityData.entityType - Entity type within collection
     * @param {Object} entityData.position - World position {x, y, z}
     * @param {Object} entityData.rotation - Rotation {x, y, z} or just number for Y rotation
     * @param {Object} entityData.scale - Optional scale override {x, y, z}
     * @returns {Promise<boolean>} Success
     */
    async spawnEntity(entityData) {
        if (!this.scene) {
            console.error('[EntityRenderer] No scene provided');
            return false;
        }

        // Load models for this collection if not already loaded
        const models = await this.loadModelsFromCollection(entityData.collectionType);
        const model = models[entityData.entityType];

        if (!model) {
            console.warn(`[EntityRenderer] Model ${entityData.collectionType}.${entityData.entityType} not available`);
            return false;
        }

        // Clone the model (deep clone)
        const entityMesh = model.scene.clone(true);

        // Set position
        entityMesh.position.set(
            entityData.position.x,
            entityData.position.y,
            entityData.position.z
        );

        // Set rotation (support both object and number for Y rotation)
        if (typeof entityData.rotation === 'number') {
            entityMesh.rotation.y = entityData.rotation;
        } else if (entityData.rotation) {
            entityMesh.rotation.set(
                entityData.rotation.x || 0,
                entityData.rotation.y || 0,
                entityData.rotation.z || 0
            );
        }

        // Apply scale (use override or model default)
        const scale = entityData.scale || model.scale;
        entityMesh.scale.set(
            scale.x || 1,
            scale.y || 1,
            scale.z || 1
        );

        // Apply materials and colors
        const palette = this.getPalette ? this.getPalette() : null;
        entityMesh.traverse((child) => {
            if (child.isMesh) {
                if (child.material) {
                    // Clone material to avoid shared material issues
                    child.material = child.material.clone();
                    child.material.needsUpdate = true;

                    // Apply color if specified
                    if (model.color?.paletteColor && palette) {
                        const color = palette[model.color.paletteColor];
                        if (color) {
                            child.material.color.set(color);
                        }
                    }

                    // Apply material properties
                    if (model.metalness !== undefined) {
                        child.material.metalness = model.metalness;
                    }
                    if (model.roughness !== undefined) {
                        child.material.roughness = model.roughness;
                    }
                }

                // Ensure mesh is visible
                child.visible = true;
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Ensure parent object is visible
        entityMesh.visible = true;

        // Add to scene
        this.scene.add(entityMesh);

        // Track for cleanup
        this.spawnedEntities.set(entityData.id, entityMesh);

        return true;
    }

    /**
     * Spawn multiple entities
     * @param {Array<Object>} entitiesData - Array of entity data objects
     * @returns {Promise<number>} Number of entities spawned
     */
    async spawnEntities(entitiesData) {
        if (!entitiesData || entitiesData.length === 0) {
            return 0;
        }

        console.log(`[EntityRenderer] Spawning ${entitiesData.length} entities...`);

        let spawnedCount = 0;
        for (const entityData of entitiesData) {
            if (await this.spawnEntity(entityData)) {
                spawnedCount++;
            }
        }

        console.log(`[EntityRenderer] Spawned ${spawnedCount}/${entitiesData.length} entities`);
        return spawnedCount;
    }

    /**
     * Remove a spawned entity
     * @param {string} entityId - Entity ID to remove
     */
    removeEntity(entityId) {
        const mesh = this.spawnedEntities.get(entityId);
        if (!mesh) return;

        this.scene.remove(mesh);

        // Dispose geometries and materials
        mesh.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m?.dispose());
                } else {
                    child.material?.dispose();
                }
            }
        });

        this.spawnedEntities.delete(entityId);
    }

    /**
     * Clear all spawned entities
     */
    clearAllEntities() {
        if (!this.scene) return;

        console.log(`[EntityRenderer] Clearing ${this.spawnedEntities.size} entities...`);

        for (const [id, mesh] of this.spawnedEntities.entries()) {
            this.removeEntity(id);
        }

        this.spawnedEntities.clear();
    }

    /**
     * Clear entities by collection type
     * @param {string} collectionType - Collection type to clear (e.g., 'cliffs')
     */
    clearEntitiesByType(collectionType) {
        const idsToRemove = [];

        for (const [id, mesh] of this.spawnedEntities.entries()) {
            if (id.startsWith(`${collectionType}_`)) {
                idsToRemove.push(id);
            }
        }

        for (const id of idsToRemove) {
            this.removeEntity(id);
        }

        console.log(`[EntityRenderer] Cleared ${idsToRemove.length} entities of type '${collectionType}'`);
    }

    /**
     * Get spawned entity mesh
     * @param {string} entityId - Entity ID
     * @returns {THREE.Object3D|null} Mesh or null
     */
    getEntityMesh(entityId) {
        return this.spawnedEntities.get(entityId) || null;
    }

    /**
     * Check if entity is spawned
     * @param {string} entityId - Entity ID
     * @returns {boolean}
     */
    hasEntity(entityId) {
        return this.spawnedEntities.has(entityId);
    }

    /**
     * Get count of spawned entities
     * @returns {number}
     */
    getEntityCount() {
        return this.spawnedEntities.size;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.clearAllEntities();
        this.modelCache.clear();
        this.loadingPromises.clear();
    }
}
