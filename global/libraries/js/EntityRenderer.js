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
        // Format: { entityId: { type: 'static'|'vat', mesh: ..., batchKey: ..., instanceIndex: ... } }
        this.entities = new Map();

        // VAT batching system
        this.vatBatches = new Map(); // batchKey -> batch data
        this.batchCreationPromises = new Map();

        // Static GLTF model cache
        this.modelCache = new Map(); // collectionType -> { entityType: modelData }
        this.loadingPromises = new Map();

        // Configuration
        this.modelScale = options.modelScale || 32;
        this.defaultCapacity = options.defaultCapacity || 128;
        this.minMovementThreshold = options.minMovementThreshold || 0.1;

        // Stats
        this.stats = {
            entitiesRendered: 0,
            staticEntities: 0,
            vatEntities: 0,
            batches: 0
        };

        console.log('[EntityRenderer] Initialized');
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

        // Determine rendering technique
        const useVAT = this.shouldUseVAT(entityDef, data.collection);

        if (useVAT && this.modelManager) {
            return await this.spawnVATEntity(entityId, data, entityDef);
        } else {
            return await this.spawnStaticEntity(entityId, data, entityDef);
        }
    }

    /**
     * Determine if entity should use VAT batching
     */
    shouldUseVAT(entityDef, collection) {
        // Check if entity has animation definitions that suggest VAT
        if (entityDef.render?.animations) {
            return true;
        }

        // Static collections always use direct rendering
        if (collection === 'cliffs' || collection === 'worldObjects') {
            return false;
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

        // Find free instance slot
        let instanceIndex = -1;
        for (let i = 0; i < batch.capacity; i++) {
            if (!batch.entityMap.has(i)) {
                instanceIndex = i;
                break;
            }
        }

        if (instanceIndex === -1) {
            console.warn(`[EntityRenderer] Batch ${batchKey} is full (${batch.capacity} instances)`);
            return false;
        }

        // Assign instance
        batch.entityMap.set(instanceIndex, entityId);
        batch.count = Math.max(batch.count, instanceIndex + 1);
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
     * Spawn entity using direct GLTF mesh
     */
    async spawnStaticEntity(entityId, data, entityDef) {
        // Load model if not cached
        await this.loadModelsFromCollection(data.collection, [data.type]);

        const models = this.modelCache.get(data.collection);
        const model = models?.[data.type];

        if (!model) {
            console.warn(`[EntityRenderer] Model ${data.collection}.${data.type} not available`);
            console.warn(`[EntityRenderer] Cache has:`, models ? Object.keys(models) : 'no models for collection');
            console.warn(`[EntityRenderer] Looking for:`, data.type);
            return false;
        }

        // Clone mesh
        const mesh = model.scene.clone(true);

        // Apply transforms
        mesh.position.set(data.position.x, data.position.y, data.position.z);

        if (typeof data.rotation === 'number') {
            mesh.rotation.y = data.rotation;
        } else if (data.facing?.angle !== undefined) {
            mesh.rotation.y = data.facing.angle;
        }

        mesh.scale.set(model.scale.x, model.scale.y, model.scale.z);

        // Apply materials
        const palette = this.getPalette?.();
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.needsUpdate = true;

                if (model.color?.paletteColor && palette) {
                    const color = palette[model.color.paletteColor];
                    if (color) child.material.color.set(color);
                }

                if (model.metalness !== undefined) child.material.metalness = model.metalness;
                if (model.roughness !== undefined) child.material.roughness = model.roughness;

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
        const facingAngle = this.calculateFacingAngle(data.velocity, data.facing);

        if (facingAngle !== null) {
            const isProjectile = !data.facing || data.facing.angle === undefined;
            if (isProjectile && data.velocity) {
                const direction = new THREE.Vector3(
                    data.velocity.vx,
                    data.velocity.vy,
                    data.velocity.vz
                ).normalize();
                const defaultForward = new THREE.Vector3(0, 1, 0);
                quaternion.setFromUnitVectors(defaultForward, direction);
            } else {
                quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -facingAngle + Math.PI / 2);
            }
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

        if (typeof data.rotation === 'number') {
            entity.mesh.rotation.y = data.rotation;
        } else if (data.facing?.angle !== undefined) {
            entity.mesh.rotation.y = data.facing.angle;
        }

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
            batch.entityMap.delete(entity.instanceIndex);

            // Recalculate count
            let maxIndex = -1;
            for (const index of batch.entityMap.keys()) {
                if (index > maxIndex) maxIndex = index;
            }
            batch.count = maxIndex + 1;
            batch.mesh.count = batch.count;

            this.stats.vatEntities--;
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

        // Setup VAT attributes
        this.setupVATAttributes(geometry, this.defaultCapacity);

        // Create instanced mesh
        const mesh = new THREE.InstancedMesh(geometry, material, this.defaultCapacity);
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
            capacity: this.defaultCapacity,
            count: 0,
            entityMap: new Map(),
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
        for (let i = 0; i < this.defaultCapacity; i++) {
            batch.attributes.clipIndex.setX(i, 0);
            batch.attributes.animTime.setX(i, 0);
            batch.attributes.animSpeed.setX(i, 1);
        }
        batch.dirty.animation = true;

        this.vatBatches.set(batchKey, batch);
        this.stats.batches++;

        console.log(`[EntityRenderer] Created VAT batch: ${batchKey}`);
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
        if (this.modelCache.has(collectionType)) {
            return this.modelCache.get(collectionType);
        }

        const loadKey = collectionType;
        if (this.loadingPromises.has(loadKey)) {
            return await this.loadingPromises.get(loadKey);
        }

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
        //THREE_ is the CORRECT prefix.
        const loader = new THREE_.GLTFLoader();
        const typesToLoad = entityTypes || Object.keys(collection);

        console.log(`[EntityRenderer] Loading ${typesToLoad.length} models from '${collectionType}':`, typesToLoad);

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
                console.log(`[EntityRenderer] Loading GLTF: ${url}`);

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
                console.error(`[EntityRenderer] ✗ Failed to load ${collectionType}.${entityType}:`, error.message, error);
            }
        }

        console.log(`[EntityRenderer] Loaded ${Object.keys(models).length}/${typesToLoad.length} models from '${collectionType}'`);
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

        this.modelCache.clear();
        this.loadingPromises.clear();
    }
}
