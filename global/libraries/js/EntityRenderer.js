/**
 * EntityRenderer - Unified entity rendering library
 *
 * Handles ALL entity rendering with a consistent API:
 * - Automatic detection of rendering technique (GLTF vs VAT)
 * - VAT batching for animated entities
 * - Direct mesh rendering for static entities
 * - Shared by game RenderSystem and terrain editor
 */
class EntityRenderer {
    constructor(options = {}) {
        this.scene = options.scene;
        this.collections = options.collections;
        this.projectName = options.projectName;
        this.getPalette = options.getPalette;
        this.modelManager = options.modelManager; // For VAT bundles

        // Entity tracking - maps entityId to rendering data
        // Format: { entityId: { type: 'static'|'vat'|'instanced', mesh: ..., batchKey: ..., instanceIndex: ... } }
        this.entities = new Map();

        // VAT batching system
        this.vatBatches = new Map(); // batchKey -> batch data
        this.batchCreationPromises = new Map();

        // Static instanced rendering system for cliffs/worldObjects
        this.staticBatches = new Map(); // batchKey -> { instancedMesh, entityMap, count, capacity }

        // Billboard instanced rendering system for renderTexture objects
        this.billboardBatches = new Map(); // batchKey -> { instancedMesh, entityMap, count, capacity }
        this.textureLoader = new THREE.TextureLoader();
        this.loadedTextures = new Map(); // textureId -> THREE.Texture

        // Static GLTF model cache
        this.modelCache = new Map(); // collectionType -> { entityType: modelData }
        this.loadingPromises = new Map();

        // Configuration
        this.modelScale = options.modelScale || 32;
        this.defaultCapacity = options.defaultCapacity || 1024;
        this.capacitiesByType = options.capacitiesByType || {}; // Per-type capacity overrides
        this.minMovementThreshold = options.minMovementThreshold || 0.1;

        // Stats
        this.stats = {
            entitiesRendered: 0,
            staticEntities: 0,
            vatEntities: 0,
            billboardEntities: 0,
            batches: 0
        };

    }

    /**
     * Unified API: Spawn an entity
     * Auto-detects whether to use GLTF or VAT based on entity definition
     */
    async spawnEntity(entityId, data) {
        // data: { collection, type, position: {x,y,z}, rotation, facing, velocity }

        if (this.entities.has(entityId)) {
            console.warn(`[EntityRenderer] Entity ${entityId} already exists`);
            return false;
        }

        // Get entity definition
        const entityDef = this.collections?.[data.collection]?.[data.type];
        if (!entityDef) {
            console.warn(`[EntityRenderer] No definition found for ${data.collection}.${data.type}`);
            return false;
        }

        // Check for billboard rendering (renderTexture property)
        if (entityDef.renderTexture) {
            return await this.spawnBillboardEntity(entityId, data, entityDef);
        }

        // Determine rendering technique
        const useVAT = this.shouldUseVAT(entityDef, data.collection);

        if (useVAT && this.modelManager) {
            return await this.spawnVATEntity(entityId, data, entityDef);
        } else {
            // Use instanced rendering for cliffs and worldObjects
            if (data.collection === 'cliffs' || data.collection === 'worldObjects') {
                return await this.spawnInstancedEntity(entityId, data, entityDef);
            } else {
                return await this.spawnStaticEntity(entityId, data, entityDef);
            }
        }
    }

    /**
     * Determine if entity should use VAT batching
     */
    shouldUseVAT(entityDef, collection) {
        // Static collections always use direct rendering, even if they have placeholder animations
        if (collection === 'cliffs' || collection === 'worldObjects') {
            return false;
        }

        // Check if entity has animation definitions that suggest VAT
        if (entityDef.render?.animations) {
            return true;
        }

        // Default: try VAT for units, buildings, projectiles
        return collection === 'units' || collection === 'buildings' || collection === 'projectiles';
    }

    /**
     * Spawn entity using VAT batching
     */
    async spawnVATEntity(entityId, data, entityDef) {
        const batchKey = `${data.collection}_${data.type}`;

        // Get or create batch
        let batch = this.vatBatches.get(batchKey);
        if (!batch) {
            batch = await this.createVATBatch(batchKey, data.collection, data.type, entityDef);
            if (!batch) {
                console.error(`[EntityRenderer] Failed to create VAT batch for ${batchKey}`);
                return false;
            }
        }

        // Get free instance slot from free list (O(1) instead of O(capacity))
        let instanceIndex = -1;
        if (batch.freeList.length > 0) {
            instanceIndex = batch.freeList.pop();
        } else if (batch.nextFreeIndex < batch.capacity) {
            instanceIndex = batch.nextFreeIndex++;
        }

        if (instanceIndex === -1) {
           // console.warn(`[EntityRenderer] Batch ${batchKey} is full (${batch.capacity} instances)`);
            return false;
        }

        // Assign instance
        batch.entityMap.set(instanceIndex, entityId);
        // Track max index for efficient count management
        if (instanceIndex >= batch.maxUsedIndex) {
            batch.maxUsedIndex = instanceIndex;
        }
        batch.count = batch.maxUsedIndex + 1;
        batch.mesh.count = batch.count;

        // Initialize animation attributes
        if (batch.attributes?.clipIndex) {
            batch.attributes.clipIndex.setX(instanceIndex, 0);
            batch.attributes.animTime.setX(instanceIndex, 0);
            batch.attributes.animSpeed.setX(instanceIndex, 1);
            batch.attributes.clipIndex.array[instanceIndex] = 0;
            batch.attributes.animTime.array[instanceIndex] = 0;
            batch.attributes.animSpeed.array[instanceIndex] = 1;
            batch.dirty.animation = true;
        }

        // Store entity data
        this.entities.set(entityId, {
            type: 'vat',
            collection: data.collection,
            entityType: data.type,
            batchKey,
            instanceIndex,
            batch
        });

        // Update transform
        this.updateEntityTransform(entityId, data);

        this.stats.entitiesRendered++;
        this.stats.vatEntities++;

        return true;
    }

    /**
     * Spawn entity using instanced mesh (for cliffs and worldObjects)
     */
    async spawnInstancedEntity(entityId, data, entityDef) {
        const batchKey = `${data.collection}_${data.type}`;

        // Get or create instanced batch
        let batch = this.staticBatches.get(batchKey);
        if (!batch) {
            batch = await this.createStaticBatch(batchKey, data.collection, data.type, entityDef);
            if (!batch) {
                console.error(`[EntityRenderer] Failed to create static batch for ${batchKey}`);
                return false;
            }
        }

        // Get free instance slot from free list (O(1) instead of O(capacity))
        let instanceIndex = -1;
        if (batch.freeList.length > 0) {
            instanceIndex = batch.freeList.pop();
        } else if (batch.nextFreeIndex < batch.capacity) {
            instanceIndex = batch.nextFreeIndex++;
        }

        if (instanceIndex === -1) {
           // console.warn(`[EntityRenderer] Batch ${batchKey} is full (${batch.capacity} instances)`);
            return false;
        }

        // Map entity to instance
        batch.entityMap.set(instanceIndex, entityId);
        // Track max index for efficient count management
        if (instanceIndex >= batch.maxUsedIndex) {
            batch.maxUsedIndex = instanceIndex;
        }
        batch.count = batch.maxUsedIndex + 1;

        // Store entity data
        this.entities.set(entityId, {
            type: 'instanced',
            collection: data.collection,
            entityType: data.type,
            batchKey,
            instanceIndex,
            batch
        });

        // Update instance transform
        // Get base scale from model definition
        const modelDef = entityDef.render?.model?.main;
        const baseScale = modelDef?.scale || { x: 1, y: 1, z: 1 };

        // For cliffs, multiply by 32
        const scaleMultiplier = 32;
        const finalScale = new THREE.Vector3(
            baseScale.x * scaleMultiplier,
            baseScale.y * scaleMultiplier,
            baseScale.z * scaleMultiplier
        );

        const matrix = new THREE.Matrix4();
        matrix.compose(
            new THREE.Vector3(data.position.x, data.position.y, data.position.z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, data.rotation || 0, 0)),
            finalScale
        );
        batch.instancedMesh.setMatrixAt(instanceIndex, matrix);
        batch.instancedMesh.instanceMatrix.needsUpdate = true;
        batch.instancedMesh.count = batch.count;



        this.stats.entitiesRendered++;
        this.stats.staticEntities++;

        return true;
    }

    /**
     * Create a static instanced batch for a model type
     */
    async createStaticBatch(batchKey, collection, type, entityDef) {
        const modelKey = `${collection}_${type}`;

        if (!this.modelManager) {
            console.error('[EntityRenderer] No modelManager for static batch');
            return null;
        }

        const modelGroup = this.modelManager.masterModels.get(modelKey);
        if (!modelGroup) {
            console.warn(`[EntityRenderer] Model ${modelKey} not found in ModelManager`);
            return null;
        }

        // Extract geometry and material from model
        let geometry = null;
        let material = null;

        modelGroup.traverse((child) => {
            if (child.isMesh && !geometry) {
                geometry = child.geometry;
                material = child.material.clone();

                // Set SRGB color space for textures
                if (material.map) {
                    material.map.colorSpace = THREE.SRGBColorSpace;
                }
                if (material.emissiveMap) {
                    material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                }
            }
        });

        if (!geometry || !material) {
            console.error(`[EntityRenderer] No geometry/material found in ${modelKey}`);
            return null;
        }

        const capacity = this.capacitiesByType[batchKey] || this.defaultCapacity;
        const instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);


        // Note: scale is applied per-instance in the matrix, not on the InstancedMesh itself
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        instancedMesh.count = 0; // Start with 0 visible instances

        this.scene.add(instancedMesh);

        const batch = {
            instancedMesh,
            entityMap: new Map(), // instanceIndex -> entityId
            count: 0,
            capacity,
            freeList: [],        // Stack of freed indices for O(1) reuse
            nextFreeIndex: 0,    // Next never-used index
            maxUsedIndex: -1     // Highest currently-used index for efficient count
        };

        this.staticBatches.set(batchKey, batch);
        this.stats.batches++;

        return batch;
    }

    /**
     * Spawn entity using billboard (THREE.Sprite for perfect screen-aligned display)
     */
    async spawnBillboardEntity(entityId, data, entityDef) {
        const textureId = entityDef.renderTexture;

        // Get texture from collections
        const textureDef = this.collections?.textures?.[textureId];
        if (!textureDef) {
            console.warn(`[EntityRenderer] Texture '${textureId}' not found in textures collection`);
            return false;
        }

        // Load the texture if needed
        let texture = this.loadedTextures.get(textureId);
        if (!texture && textureDef.imagePath) {
            try {
                texture = await this.loadTexture(textureId, textureDef.imagePath);
            } catch (error) {
                console.error(`[EntityRenderer] Failed to load texture ${textureId}:`, error);
                return false;
            }
        }

        if (!texture) {
            console.error(`[EntityRenderer] No texture available for ${textureId}`);
            return false;
        }

        // Set correct color space for the texture
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        // Create sprite material
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.5,
            sizeAttenuation: false  // Keep consistent size regardless of distance (for orthographic)
        });

        // Create sprite
        const sprite = new THREE.Sprite(material);

        // Calculate dimensions - use texture aspect ratio
        const size = entityDef.size || 64;
        const textureAspect = texture.image ? (texture.image.width / texture.image.height) : 1;
        const width = size * textureAspect;

        // Scale the sprite
        sprite.scale.set(width, size, 1);

        // Position the sprite (center at ground + half height)
        sprite.position.set(
            data.position.x,
            data.position.y + size / 2,
            data.position.z
        );

        this.scene.add(sprite);

        // Store entity data (include height for position updates)
        this.entities.set(entityId, {
            type: 'billboard',
            collection: data.collection,
            entityType: data.type,
            sprite: sprite,
            textureId,
            heightOffset: height / 2
        });

        this.stats.entitiesRendered++;
        this.stats.billboardEntities++;

        return true;
    }

    /**
     * Load a texture from the resources path
     */
    async loadTexture(textureId, imagePath) {
        return new Promise((resolve, reject) => {
            // Construct full URL - check if modelManager has app reference
            let resourcesPath = '';
            if (this.modelManager?.app?.getResourcesPath) {
                resourcesPath = this.modelManager.app.getResourcesPath();
            } else if (this.projectName) {
                resourcesPath = `/projects/${this.projectName}/resources/`;
            }

            const url = resourcesPath + imagePath;

            this.textureLoader.load(
                url,
                (texture) => {
                    this.loadedTextures.set(textureId, texture);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    reject(error);
                }
            );
        });
    }

    /**
     * Spawn entity using direct GLTF mesh
     */
    async spawnStaticEntity(entityId, data, entityDef) {
        // Request model from ModelManager
        const modelKey = `${data.collection}_${data.type}`;

        if (!this.modelManager) {
            console.error(`[EntityRenderer] No modelManager available for ${modelKey}`);
            return false;
        }

        const modelGroup = this.modelManager.masterModels.get(modelKey);

        if (!modelGroup) {
            console.warn(`[EntityRenderer] Model ${modelKey} not found in ModelManager`);
            console.warn(`[EntityRenderer] Available models:`, Array.from(this.modelManager.masterModels.keys()));
            return false;
        }

 
        // Clone mesh
        const mesh = modelGroup.clone(true);



        // Get model definition for scale and material properties
        const modelDef = entityDef.render?.model?.main;

        // Apply transforms
        mesh.position.set(data.position.x, data.position.y, data.position.z);

  

        if (typeof data.rotation === 'number') {
            mesh.rotation.y = data.rotation;
        } else if (data.facing?.angle !== undefined) {
            mesh.rotation.y = data.facing.angle;
        }

        // NOTE: ModelManager applies the scale from the model definition when building
        // However, for cliffs we need an additional scale multiplier to match terrain scale
     
        mesh.scale.multiplyScalar(32);

        // Apply materials
        const palette = this.getPalette?.();
        const shape = modelDef?.shapes?.[0]; // Get first shape for material properties

        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.needsUpdate = true;

                // Ensure textures use SRGB color space for correct rendering
                if (child.material.map) {
                    child.material.map.colorSpace = THREE.SRGBColorSpace;
                }
                if (child.material.emissiveMap) {
                    child.material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                }

                if (shape?.color?.paletteColor && palette) {
                    const color = palette[shape.color.paletteColor];
                    if (color) child.material.color.set(color);
                }

                if (shape?.metalness !== undefined) child.material.metalness = shape.metalness;
                if (shape?.roughness !== undefined) child.material.roughness = shape.roughness;

                child.visible = true;
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        mesh.visible = true;

        // Add to scene
        this.scene.add(mesh);

        // Store entity data
        this.entities.set(entityId, {
            type: 'static',
            collection: data.collection,
            entityType: data.type,
            mesh
        });

        this.stats.entitiesRendered++;
        this.stats.staticEntities++;

        return true;
    }

    /**
     * Update entity transform and animation state
     */
    updateEntityTransform(entityId, data) {
        // data: { position, rotation, facing, velocity, animationClip, animationSpeed }

        const entity = this.entities.get(entityId);
        if (!entity) return false;

        if (entity.type === 'vat') {
            return this.updateVATTransform(entity, data);
        } else if (entity.type === 'billboard') {
            return this.updateBillboardTransform(entity, data);
        } else {
            return this.updateStaticTransform(entity, data);
        }
    }

    /**
     * Update VAT entity transform
     */
    updateVATTransform(entity, data) {
        const batch = entity.batch;
        if (!batch) return false;

        const matrix = new THREE.Matrix4();
        const baseScale = batch.meta?.baseScale || new THREE.Vector3(1, 1, 1);
        const basePosition = batch.meta?.basePos || new THREE.Vector3(0, 0, 0);

        const position = new THREE.Vector3(
            data.position.x + basePosition.x,
            data.position.y + basePosition.y,
            data.position.z + basePosition.z
        );

        const quaternion = new THREE.Quaternion();

        // Check if this is a projectile - projectiles use 3D velocity-based rotation
        const isProjectile = entity.collection === 'projectiles';

        if (isProjectile && data.velocity) {
            // Projectiles: orient along 3D velocity direction
            const speed = Math.sqrt(
                data.velocity.vx * data.velocity.vx +
                data.velocity.vy * data.velocity.vy +
                data.velocity.vz * data.velocity.vz
            );
            if (speed > 0.01) {
                const direction = new THREE.Vector3(
                    data.velocity.vx / speed,
                    data.velocity.vy / speed,
                    data.velocity.vz / speed
                );
                const defaultForward = new THREE.Vector3(0, 1, 0);
                quaternion.setFromUnitVectors(defaultForward, direction);
            }
        } else {
            // Units/buildings: use transform.rotation.y for facing direction
            // This is set by MovementSystem based on velocity or preserved facing
            const rotationY = data.transform?.rotation?.y ?? data.rotation ?? 0;
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -rotationY + Math.PI / 2);
        }

        const scale = new THREE.Vector3(
            this.modelScale * baseScale.x,
            this.modelScale * baseScale.y,
            this.modelScale * baseScale.z
        );

        matrix.compose(position, quaternion, scale);
        batch.mesh.setMatrixAt(entity.instanceIndex, matrix);
        batch.dirty.matrices = true;

        return true;
    }

    /**
     * Update static entity transform (if needed)
     */
    updateStaticTransform(entity, data) {
        // Static entities typically don't move, but support it if needed
        if (!entity.mesh) return false;

        entity.mesh.position.set(data.position.x, data.position.y, data.position.z);

        // Use transform.rotation.y for facing direction
        const rotationY = data.transform?.rotation?.y ?? data.rotation ?? 0;
        entity.mesh.rotation.y = rotationY;

        return true;
    }

    /**
     * Update billboard (sprite) entity transform
     */
    updateBillboardTransform(entity, data) {
        if (!entity.sprite) return false;

        // Update sprite position (add height offset to center sprite above ground)
        const heightOffset = entity.heightOffset || 0;
        entity.sprite.position.set(
            data.position.x,
            data.position.y + heightOffset,
            data.position.z
        );

        return true;
    }

    /**
     * Calculate facing angle from velocity or facing component
     */
    calculateFacingAngle(velocity, facing) {
        if (velocity && (Math.abs(velocity.vx) > this.minMovementThreshold || Math.abs(velocity.vz) > this.minMovementThreshold)) {
            return Math.atan2(velocity.vz, velocity.vx);
        }

        if (facing && facing.angle !== undefined) {
            return facing.angle;
        }

        return null;
    }

    /**
     * Set animation clip for VAT entity
     */
    setAnimationClip(entityId, clipName, resetTime = true) {
        const entity = this.entities.get(entityId);
        if (!entity || entity.type !== 'vat') {
            return false;
        }

        const batch = entity.batch;
        const clipIndex = batch.meta?.clipIndexByName?.[clipName];

        if (clipIndex === undefined) {
            console.warn(`[EntityRenderer] Clip '${clipName}' not found for entity ${entityId}`);
            return false;
        }

        batch.attributes.clipIndex.setX(entity.instanceIndex, clipIndex);
        batch.attributes.clipIndex.array[entity.instanceIndex] = clipIndex;

        if (resetTime) {
            batch.attributes.animTime.setX(entity.instanceIndex, 0);
            batch.attributes.animTime.array[entity.instanceIndex] = 0;
        }

        batch.dirty.animation = true;
        return true;
    }

    /**
     * Set animation speed for VAT entity
     */
    setAnimationSpeed(entityId, speed) {
        const entity = this.entities.get(entityId);
        if (!entity || entity.type !== 'vat') {
            return false;
        }

        const batch = entity.batch;
        batch.attributes.animSpeed.setX(entity.instanceIndex, speed);
        batch.attributes.animSpeed.array[entity.instanceIndex] = speed;
        batch.dirty.animation = true;

        return true;
    }

    /**
     * Update animations (called every frame)
     */
    updateAnimations(deltaTime) {
        for (const [batchKey, batch] of this.vatBatches) {
            // Skip buildings (no animation)
            if (batchKey.startsWith('buildings_')) continue;

            let hasUpdates = false;

            for (const [instanceIndex, entityId] of batch.entityMap) {
                const currentTime = batch.attributes.animTime.array[instanceIndex];
                const speed = batch.attributes.animSpeed.array[instanceIndex];
                const clipIndex = batch.attributes.clipIndex.array[instanceIndex];

                if (speed > 0) {
                    const clip = batch.meta.clips[clipIndex];
                    const duration = clip?.duration || 1.0;

                    const newTime = (currentTime + deltaTime * speed) % duration;
                    batch.attributes.animTime.array[instanceIndex] = newTime;
                    hasUpdates = true;
                }
            }

            if (hasUpdates) {
                batch.attributes.animTime.needsUpdate = true;
                batch.dirty.animation = true;
            }
        }
    }

    /**
     * Finalize updates (called after all updates)
     */
    finalizeUpdates() {
        for (const batch of this.vatBatches.values()) {
            if (batch.dirty.matrices) {
                batch.mesh.instanceMatrix.needsUpdate = true;
                batch.dirty.matrices = false;
            }

            if (batch.dirty.animation) {
                batch.attributes.clipIndex.needsUpdate = true;
                batch.attributes.animSpeed.needsUpdate = true;
                batch.dirty.animation = false;
            }
        }
    }

    /**
     * Remove an entity
     */
    removeEntity(entityId) {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        if (entity.type === 'vat') {
            // Free VAT instance slot
            const batch = entity.batch;
            const removedIndex = entity.instanceIndex;
            batch.entityMap.delete(removedIndex);

            // Add to free list for O(1) reuse
            batch.freeList.push(removedIndex);

            // Only recalculate maxUsedIndex if we removed the max (otherwise it stays the same)
            if (removedIndex === batch.maxUsedIndex) {
                // Find new max - only needed when removing the highest index
                let newMax = -1;
                for (const index of batch.entityMap.keys()) {
                    if (index > newMax) newMax = index;
                }
                batch.maxUsedIndex = newMax;
            }
            batch.count = batch.maxUsedIndex + 1;
            batch.mesh.count = batch.count;

            this.stats.vatEntities--;
        } else if (entity.type === 'instanced') {
            // Free instanced slot
            const batch = entity.batch;
            const removedIndex = entity.instanceIndex;
            batch.entityMap.delete(removedIndex);

            // Add to free list for O(1) reuse
            batch.freeList.push(removedIndex);

            // Only recalculate maxUsedIndex if we removed the max
            if (removedIndex === batch.maxUsedIndex) {
                let newMax = -1;
                for (const index of batch.entityMap.keys()) {
                    if (index > newMax) newMax = index;
                }
                batch.maxUsedIndex = newMax;
            }
            batch.count = batch.maxUsedIndex + 1;
            batch.instancedMesh.count = batch.count;

            this.stats.staticEntities--;
        } else if (entity.type === 'billboard') {
            // Remove sprite from scene
            if (entity.sprite) {
                this.scene.remove(entity.sprite);
                entity.sprite.material.dispose();
            }

            this.stats.billboardEntities--;
        } else {
            // Remove static mesh
            this.scene.remove(entity.mesh);
            entity.mesh.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m?.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });

            this.stats.staticEntities--;
        }

        this.entities.delete(entityId);
        this.stats.entitiesRendered--;

        return true;
    }

    /**
     * Check if entity exists
     */
    hasEntity(entityId) {
        return this.entities.has(entityId);
    }

    /**
     * Get entity count
     */
    getEntityCount() {
        return this.entities.size;
    }

    /**
     * Clear all entities
     */
    clearAllEntities() {
        const entityIds = Array.from(this.entities.keys());
        for (const entityId of entityIds) {
            this.removeEntity(entityId);
        }
    }

    /**
     * Clear entities by collection type
     */
    clearEntitiesByType(collectionType) {
        const toRemove = [];
        for (const [entityId, entity] of this.entities) {
            if (entity.collection === collectionType) {
                toRemove.push(entityId);
            }
        }

        for (const entityId of toRemove) {
            this.removeEntity(entityId);
        }
    }

    // ============ VAT BATCH CREATION ============

    async createVATBatch(batchKey, collection, type, entityDef) {
        // Check if already creating
        if (this.batchCreationPromises.has(batchKey)) {
            return await this.batchCreationPromises.get(batchKey);
        }

        const promise = this._createVATBatchInternal(batchKey, collection, type, entityDef);
        this.batchCreationPromises.set(batchKey, promise);

        try {
            const batch = await promise;
            return batch;
        } finally {
            this.batchCreationPromises.delete(batchKey);
        }
    }

    async _createVATBatchInternal(batchKey, collection, type, entityDef) {
        if (!this.modelManager) {
            console.error('[EntityRenderer] No modelManager provided for VAT batching');
            return null;
        }

        // Request VAT bundle from model manager
        let bundleResult;
        try {
            bundleResult = await this.modelManager.requestVATBundle(collection, type, entityDef);
        } catch (error) {
            console.error(`[EntityRenderer] VAT bundle request failed for ${batchKey}:`, error);
            return null;
        }

        if (!bundleResult.ready || !bundleResult.bundle) {
            console.warn(`[EntityRenderer] VAT bundle not ready for ${batchKey}`);
            return null;
        }

        const bundle = bundleResult.bundle;

        if (!bundle.geometry || !bundle.material) {
            console.error(`[EntityRenderer] Invalid VAT bundle for ${batchKey}`);
            return null;
        }

        // Clone geometry and material
        const geometry = bundle.geometry.clone();
        const material = bundle.material;

        material.uuid = THREE.MathUtils.generateUUID();
        material.needsUpdate = true;

        // Determine capacity - use per-type if available, otherwise default
        const capacity = this.capacitiesByType[batchKey] || this.defaultCapacity;

        // Setup VAT attributes
        this.setupVATAttributes(geometry, capacity);

        // Create instanced mesh
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        // Set bounding volumes
        const boundingBox = new THREE.Box3();
        const size = this.modelScale * 2;
        boundingBox.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, size, size));
        geometry.boundingBox = boundingBox;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.modelScale);

        if (!material.side || material.side === THREE.FrontSide) {
            material.side = THREE.DoubleSide;
        }

        // Add to scene
        this.scene.add(mesh);

        // Create batch data
        const batch = {
            mesh,
            geometry,
            material,
            capacity: capacity,
            count: 0,
            entityMap: new Map(),
            freeList: [],        // Stack of freed indices for O(1) reuse
            nextFreeIndex: 0,    // Next never-used index
            maxUsedIndex: -1,    // Highest currently-used index for efficient count
            attributes: {
                clipIndex: geometry.getAttribute('aClipIndex'),
                animTime: geometry.getAttribute('aAnimTime'),
                animSpeed: geometry.getAttribute('aAnimSpeed')
            },
            dirty: {
                matrices: false,
                animation: false
            },
            meta: bundle.meta
        };

        // Initialize animation attributes
        for (let i = 0; i < capacity; i++) {
            batch.attributes.clipIndex.setX(i, 0);
            batch.attributes.animTime.setX(i, 0);
            batch.attributes.animSpeed.setX(i, 1);
        }
        batch.dirty.animation = true;

        this.vatBatches.set(batchKey, batch);
        this.stats.batches++;

        return batch;
    }

    setupVATAttributes(geometry, capacity) {
        const clipIndexArray = new Float32Array(capacity).fill(0);
        const animTimeArray = new Float32Array(capacity).fill(0);
        const animSpeedArray = new Float32Array(capacity).fill(1);

        const clipIndexAttr = new THREE.InstancedBufferAttribute(clipIndexArray, 1);
        const animTimeAttr = new THREE.InstancedBufferAttribute(animTimeArray, 1);
        const animSpeedAttr = new THREE.InstancedBufferAttribute(animSpeedArray, 1);

        clipIndexAttr.setUsage(THREE.DynamicDrawUsage);
        animTimeAttr.setUsage(THREE.DynamicDrawUsage);
        animSpeedAttr.setUsage(THREE.DynamicDrawUsage);

        geometry.setAttribute('aClipIndex', clipIndexAttr);
        geometry.setAttribute('aAnimTime', animTimeAttr);
        geometry.setAttribute('aAnimSpeed', animSpeedAttr);
    }

    // ============ STATIC MODEL LOADING ============

    async loadModelsFromCollection(collectionType, entityTypes = null) {
        // Get or create cache for this collection
        if (!this.modelCache.has(collectionType)) {
            this.modelCache.set(collectionType, {});
        }

        const cachedModels = this.modelCache.get(collectionType);

        // If no specific types requested, load all (or return cached)
        if (!entityTypes) {
            // Check if we've already loaded all types
            const collection = this.collections[collectionType];
            const allTypes = Object.keys(collection || {});
            const allLoaded = allTypes.every(type => type in cachedModels);

            if (allLoaded) {
                return cachedModels;
            }

            // Load all types
            const models = await this._loadModelsInternal(collectionType, null);
            Object.assign(cachedModels, models);
            return cachedModels;
        }

        // Check which specific types need loading
        const typesToLoad = entityTypes.filter(type => !(type in cachedModels));

        if (typesToLoad.length === 0) {
            // All requested types already cached
            return cachedModels;
        }

        // Load missing types
        const loadKey = `${collectionType}_${typesToLoad.join('_')}`;

        if (this.loadingPromises.has(loadKey)) {
            await this.loadingPromises.get(loadKey);
            return cachedModels;
        }

        const loadPromise = this._loadModelsInternal(collectionType, typesToLoad);
        this.loadingPromises.set(loadKey, loadPromise);

        try {
            const models = await loadPromise;
            // Merge new models into cache
            Object.assign(cachedModels, models);
            return cachedModels;
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
        //THREE_ is the CORRECT prefix for GLTF ONLY.
        const loader = new THREE.GLTFLoader();
        const typesToLoad = entityTypes || Object.keys(collection);

       
        for (const entityType of typesToLoad) {
            const entityDef = collection[entityType];
            if (!entityDef) {
                console.warn(`[EntityRenderer] No definition for ${collectionType}.${entityType}`);
                continue;
            }

            if (!entityDef?.render?.model?.main?.shapes?.[0]) {
                console.warn(`[EntityRenderer] ${collectionType}.${entityType} missing render.model.main.shapes[0]`);
                continue;
            }

            const shape = entityDef.render.model.main.shapes[0];
            if (shape.type !== 'gltf') {
                console.warn(`[EntityRenderer] ${collectionType}.${entityType} shape is not GLTF, type: ${shape.type}`);
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

             
            } catch (error) {
                console.error(`[EntityRenderer] ✗ Failed to load ${collectionType}.${entityType}:`, error.message, error);
            }
        }

        return models;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        this.clearAllEntities();

        // Dispose VAT batches
        for (const batch of this.vatBatches.values()) {
            this.scene.remove(batch.mesh);
            batch.geometry.dispose();
            batch.material.dispose();
        }
        this.vatBatches.clear();

        // Dispose static batches
        for (const batch of this.staticBatches.values()) {
            this.scene.remove(batch.instancedMesh);
            batch.instancedMesh.geometry.dispose();
            batch.instancedMesh.material.dispose();
        }
        this.staticBatches.clear();

        // Dispose billboard batches
        for (const batch of this.billboardBatches.values()) {
            this.scene.remove(batch.instancedMesh);
            batch.instancedMesh.geometry.dispose();
            batch.instancedMesh.material.dispose();
        }
        this.billboardBatches.clear();

        // Dispose loaded textures
        for (const texture of this.loadedTextures.values()) {
            texture.dispose();
        }
        this.loadedTextures.clear();

        this.modelCache.clear();
        this.loadingPromises.clear();
    }
}
