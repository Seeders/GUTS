class RenderSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.renderSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // VAT instance batches: batchKey -> { mesh, capacity, count, entityMap, attributeArrays, meta }
        this.vatBatches = new Map();
        this.entityToInstance = new Map(); // entityId -> { batchKey, instanceIndex }
        
        // Configuration
        this.modelScale = 32;
        this.DEFAULT_CAPACITY = 512;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;

        // Debug
        this.DEBUG = true;
        this.DEBUG_LEVEL = 1;
        this._frame = 0;
        this._stats = {
            entitiesProcessed: 0,
            instancesCreated: 0,
            instancesRemoved: 0,
            batchesActive: 0
        };

        this._bindDebugHelpers();
        console.log('[RenderSystem] VAT-only rendering system initialized');
    }

    _bindDebugHelpers() {
        if (typeof window !== "undefined") {
            window.VATRenderDebug = {
                dumpBatches: () => this.dumpBatches(),
                dumpInstances: () => this.dumpInstances(),
                setDebugLevel: (level) => this.DEBUG_LEVEL = level,
                getStats: () => this._stats
            };
        }
    }

    update() {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) return;

        this._frame++;
        this.updateEntities();
        this.updateAnimations();
        this.finalizeUpdates();

        if (this.DEBUG && this._frame % 60 === 0) {
            console.log(`[RenderSystem] Frame ${this._frame}: ${this._stats.entitiesProcessed} entities, ${this._stats.batchesActive} batches`);
        }
    }

    updateEntities() {
        const CT = this.componentTypes;
        const entities = this.game.getEntitiesWith(CT.POSITION, CT.RENDERABLE);
        this._stats.entitiesProcessed = entities.length;

        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
            const velocity = this.game.getComponent(entityId, CT.VELOCITY);
            const facing = this.game.getComponent(entityId, CT.FACING);

            if (!pos || !renderable) return;

            // FILTER: Only process units for VAT rendering, skip projectiles/effects/etc
            if (renderable.objectType !== 'units') {
                // Let other rendering systems handle non-units (projectiles, effects, buildings, etc.)
                return;
            }

            // Validate that units have proper string spawnTypes
            if (typeof renderable.spawnType !== 'string') {
                console.error(`[RenderSystem] Unit entity ${entityId} has invalid spawnType:`, {
                    objectType: renderable.objectType,
                    spawnType: renderable.spawnType,
                    spawnTypeType: typeof renderable.spawnType
                });
                return;
            }

            // Get or create instance
            let instance = this.entityToInstance.get(entityId);
            if (!instance) {
                instance = this.createInstance(entityId, renderable.objectType, renderable.spawnType);
                if (!instance) return; // Failed to create
            }

            // Update transform
            this.updateInstanceTransform(instance, pos, velocity, facing);
        });

        // Clean up removed entities
        this.cleanupRemovedEntities(new Set(entities));
    }

    async createInstance(entityId, objectType, spawnType) {
        console.log(`[RenderSystem] createInstance called for entity ${entityId} with ${objectType}_${spawnType}`);

        if (typeof spawnType !== 'string') {
            console.error(`[RenderSystem] CRITICAL: spawnType should be string but got ${typeof spawnType}:`, spawnType);
            return null;
        }

        const batchKey = `${objectType}_${spawnType}`;
        
        // Get or create batch (with race condition protection)
        let batch = this.vatBatches.get(batchKey);
        if (!batch) {
            // Check if batch is currently being created
            if (this.batchCreationPromises && this.batchCreationPromises.has(batchKey)) {
                console.log(`[RenderSystem] Waiting for batch creation: ${batchKey}`);
                try {
                    batch = await this.batchCreationPromises.get(batchKey);
                } catch (error) {
                    console.error(`[RenderSystem] Batch creation failed for ${batchKey}:`, error);
                    return null;
                }
            } else {
                console.log(`[RenderSystem] Creating new batch for ${batchKey}`);
                
                // Track batch creation promise to prevent race conditions
                if (!this.batchCreationPromises) this.batchCreationPromises = new Map();
                const creationPromise = this.createVATBatch(batchKey, objectType, spawnType);
                this.batchCreationPromises.set(batchKey, creationPromise);
                
                try {
                    batch = await creationPromise;
                    if (!batch) {
                        console.error(`[RenderSystem] Failed to create batch for ${batchKey}`);
                        return null;
                    }
                } finally {
                    this.batchCreationPromises.delete(batchKey);
                }
            }
        }

        // Find free slot
        let instanceIndex = -1;
        for (let i = 0; i < batch.capacity; i++) {
            if (!batch.entityMap.has(i)) {
                instanceIndex = i;
                break;
            }
        }

        if (instanceIndex === -1) {
            console.warn(`[RenderSystem] Batch ${batchKey} is full (${batch.capacity} instances)`);
            return null;
        }

        console.log(`[RenderSystem] Assigning entity ${entityId} to batch ${batchKey} at index ${instanceIndex}`);

        // Assign instance
        batch.entityMap.set(instanceIndex, entityId);
        batch.count = Math.max(batch.count, instanceIndex + 1);
        batch.mesh.count = batch.count;

        // CRITICAL: Initialize VAT attributes for this instance
        batch.attributes.clipIndex.setX(instanceIndex, 0); // Start with idle (clip 0)
        batch.attributes.animTime.setX(instanceIndex, 0);
        batch.attributes.animSpeed.setX(instanceIndex, 1);
        batch.dirty.animation = true;

        const instance = { batchKey, instanceIndex };
        this.entityToInstance.set(entityId, instance);
        this._stats.instancesCreated++;

        console.log(`[RenderSystem] Successfully created instance for entity ${entityId} in batch ${batchKey} at index ${instanceIndex}`);
        console.log(`[RenderSystem] Batch ${batchKey} now has ${batch.entityMap.size} active instances`);
        
        return instance;
    }

    async createVATBatch(batchKey, objectType, spawnType) {
        console.log(`[RenderSystem] Creating VAT batch: ${batchKey}`);

        // Get unit definition - handle both string and numeric spawnTypes
        const collections = this.game.getCollections?.();
        let unitDef = null;
        
        if (collections?.units) {
            unitDef = collections.units[spawnType];
            if (!unitDef && typeof spawnType === 'number') {
                const unitKeys = Object.keys(collections.units);
                if (spawnType < unitKeys.length) {
                    const unitKey = unitKeys[spawnType];
                    unitDef = collections.units[unitKey];
                    console.log(`[RenderSystem] Mapped numeric spawnType ${spawnType} to unit key '${unitKey}'`);
                }
            }
            if (!unitDef) {
                unitDef = collections.units[String(spawnType)];
            }
        }
        
        if (!unitDef) {
            console.error(`[RenderSystem] No unit definition found for spawnType: ${spawnType} (type: ${typeof spawnType})`);
            console.log(`[RenderSystem] Available units:`, collections?.units ? Object.keys(collections.units) : 'No units collection');
            return null;
        }

        // Request VAT bundle from ModelManager
        console.log(`[RenderSystem] Requesting VAT bundle for ${batchKey}`);
        let bundleResult;
        try {
            bundleResult = await this.game.modelManager.requestVATBundle(objectType, spawnType, unitDef);
        } catch (error) {
            console.error(`[RenderSystem] VAT bundle request failed for ${batchKey}:`, error);
            return null;
        }
        
        console.log(`[RenderSystem] VAT bundle result for ${batchKey}:`, bundleResult);
        
        if (!bundleResult.ready) {
            console.warn(`[RenderSystem] VAT bundle not ready for ${batchKey}`);
            return null;
        }

        const bundle = bundleResult.bundle;
        if (!bundle) {
            console.error(`[RenderSystem] No bundle in result for ${batchKey}`, bundleResult);
            return null;
        }
        
        if (!bundle.geometry || !bundle.material) {
            console.error(`[RenderSystem] Invalid VAT bundle for ${batchKey} - missing geometry or material:`, {
                hasGeometry: !!bundle.geometry,
                hasMaterial: !!bundle.material,
                bundle
            });
            return null;
        }

        console.log(`[RenderSystem] VAT bundle validated for ${batchKey}:`, {
            geometry: bundle.geometry.type,
            material: bundle.material.type,
            clipCount: bundle.meta?.clips?.length
        });

        // Create instanced mesh - DON'T clone the VAT material
        const geometry = bundle.geometry.clone();
        const material = bundle.material; // Use original material, don't clone
        const capacity = this.DEFAULT_CAPACITY;

        // Add instanced attributes for VAT
        this.setupVATAttributes(geometry, capacity);

        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // FIXED: Disable frustum culling to prevent disappearing models
        mesh.frustumCulled = false;
        
        // FIXED: Set a large bounding box to account for animated vertices
        const boundingBox = new THREE.Box3();
        const size = this.modelScale * 2; // Account for model scale and animation
        boundingBox.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, size, size));
        geometry.boundingBox = boundingBox;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), size * 0.5);

        // Add to scene
        this.game.scene.add(mesh);

        // Create batch data
        const batch = {
            mesh,
            capacity,
            count: 0,
            entityMap: new Map(),
            attributes: {
                clipIndex: geometry.getAttribute('aClipIndex'),
                animTime: geometry.getAttribute('aAnimTime'),
                animSpeed: geometry.getAttribute('aAnimSpeed')
            },
            meta: bundle.meta,
            dirty: {
                matrices: false,
                animation: false
            }
        };

        this.vatBatches.set(batchKey, batch);
        this._stats.batchesActive = this.vatBatches.size;

        console.log(`[RenderSystem] Created VAT batch ${batchKey} with ${capacity} capacity`);
        console.log(`[RenderSystem] Available clips:`, Object.keys(bundle.meta.clipIndexByName));

        return batch;
    }

    setupVATAttributes(geometry, capacity) {
        // Create VAT animation attributes
        const clipIndexArray = new Float32Array(capacity).fill(0); // Default to first clip
        const animTimeArray = new Float32Array(capacity).fill(0);
        const animSpeedArray = new Float32Array(capacity).fill(1);

        geometry.setAttribute('aClipIndex', new THREE.InstancedBufferAttribute(clipIndexArray, 1));
        geometry.setAttribute('aAnimTime', new THREE.InstancedBufferAttribute(animTimeArray, 1));
        geometry.setAttribute('aAnimSpeed', new THREE.InstancedBufferAttribute(animSpeedArray, 1));
    }

    updateInstanceTransform(instance, pos, velocity, facing) {
        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return;

        // Calculate transform matrix
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3(pos.x, pos.y || 0, pos.z);
        
        // Calculate rotation
        let rotationY = 0;
        if (facing?.angle !== undefined) {
            rotationY = -facing.angle + Math.PI / 2;
        } else if (velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD)) {
            rotationY = -Math.atan2(velocity.vz, velocity.vx) + Math.PI / 2;
        }
        
        const rotation = new THREE.Euler(0, rotationY, 0);
        const scale = new THREE.Vector3(this.modelScale, this.modelScale, this.modelScale);
        
        matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
        
        // Set instance matrix
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;
    }

    updateAnimations() {
        const dt = this.game.state?.deltaTime || 1/60;

        for (const [batchKey, batch] of this.vatBatches) {
            const clipIndexAttr = batch.attributes.clipIndex;
            const animTimeAttr = batch.attributes.animTime;
            const animSpeedAttr = batch.attributes.animSpeed;
            
            let hasAnimationUpdates = false;

            // Update animation time for all instances
            for (let i = 0; i < batch.count; i++) {
                const entityId = batch.entityMap.get(i);
                if (!entityId) continue;

                const currentTime = animTimeAttr.getX(i);
                const speed = animSpeedAttr.getX(i);
                const clipIndex = clipIndexAttr.getX(i);

                if (speed > 0) {
                    // Get clip duration
                    const clip = batch.meta.clips[clipIndex];
                    const duration = clip?.duration || 1.0;
                    
                    // Advance time and loop
                    const newTime = (currentTime + dt * speed) % duration;
                    animTimeAttr.setX(i, newTime);
                    hasAnimationUpdates = true;
                }
            }

            if (hasAnimationUpdates) {
                batch.dirty.animation = true;
            }
        }
    }

    finalizeUpdates() {
        for (const batch of this.vatBatches.values()) {
            if (batch.dirty.matrices) {
                batch.mesh.instanceMatrix.needsUpdate = true;
                batch.dirty.matrices = false;
            }
            
            if (batch.dirty.animation) {
                // FIXED: InstancedBufferAttribute updates work differently
                // We need to increment the version number to trigger GPU update
                if (batch.attributes.clipIndex) {
                    batch.attributes.clipIndex.version++;
                }
                if (batch.attributes.animTime) {
                    batch.attributes.animTime.version++;
                }
                if (batch.attributes.animSpeed) {
                    batch.attributes.animSpeed.version++;
                }
                batch.dirty.animation = false;
                
                if (this.DEBUG_LEVEL >= 3) {
                    console.log(`[RenderSystem] Updated VAT attribute versions`);
                }
            }
        }
    }

    // Animation control methods
    setInstanceClip(entityId, clipName, resetTime = true) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) return false;

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return false;

        const clipIndex = batch.meta.clipIndexByName[clipName];
        if (clipIndex === undefined) {
            console.warn(`[RenderSystem] Clip '${clipName}' not found in batch ${instance.batchKey}. Available:`, Object.keys(batch.meta.clipIndexByName));
            return false;
        }

        batch.attributes.clipIndex.setX(instance.instanceIndex, clipIndex);
        if (resetTime) {
            batch.attributes.animTime.setX(instance.instanceIndex, 0);
        }
        batch.dirty.animation = true;

        if (this.DEBUG_LEVEL >= 2) {
            console.log(`[RenderSystem] Set clip '${clipName}' (${clipIndex}) for entity ${entityId}`);
        }
        return true;
    }

    setInstanceSpeed(entityId, speed) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) return false;

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return false;

        batch.attributes.animSpeed.setX(instance.instanceIndex, speed);
        batch.dirty.animation = true;

        if (this.DEBUG_LEVEL >= 3) {
            console.log(`[RenderSystem] Set speed ${speed} for entity ${entityId}`);
        }
        return true;
    }

    getInstanceAnimationState(entityId) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) return null;

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return null;

        const clipIndex = batch.attributes.clipIndex.getX(instance.instanceIndex);
        const animTime = batch.attributes.animTime.getX(instance.instanceIndex);
        const animSpeed = batch.attributes.animSpeed.getX(instance.instanceIndex);

        const clipName = Object.keys(batch.meta.clipIndexByName).find(
            name => batch.meta.clipIndexByName[name] === clipIndex
        );

        return {
            clipName,
            clipIndex,
            animTime,
            animSpeed,
            clipDuration: batch.meta.clips[clipIndex]?.duration || 1.0
        };
    }

    cleanupRemovedEntities(currentEntities) {
        const toRemove = [];
        
        for (const [entityId, instance] of this.entityToInstance) {
            if (!currentEntities.has(entityId)) {
                toRemove.push(entityId);
            }
        }

        toRemove.forEach(entityId => {
            this.removeInstance(entityId);
        });
    }

    removeInstance(entityId) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) return;

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return;

        // Remove from entity map
        batch.entityMap.delete(instance.instanceIndex);
        this.entityToInstance.delete(entityId);

        // Hide the instance by setting scale to 0
        const matrix = new THREE.Matrix4();
        matrix.scale(new THREE.Vector3(0, 0, 0));
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;

        // Reset animation attributes
        batch.attributes.clipIndex.setX(instance.instanceIndex, 0);
        batch.attributes.animTime.setX(instance.instanceIndex, 0);
        batch.attributes.animSpeed.setX(instance.instanceIndex, 0);
        batch.dirty.animation = true;

        this._stats.instancesRemoved++;
        
        if (this.DEBUG_LEVEL >= 2) {
            console.log(`[RenderSystem] Removed instance for entity ${entityId} from ${instance.batchKey}`);
        }
    }

    // Utility methods
    isInstanced(entityId) {
        return this.entityToInstance.has(entityId);
    }

    getBatchInfo(objectType, spawnType) {
        const batchKey = `${objectType}_${spawnType}`;
        const batch = this.vatBatches.get(batchKey);
        if (!batch) return null;

        return {
            batchKey,
            capacity: batch.capacity,
            count: batch.count,
            activeInstances: batch.entityMap.size,
            availableClips: Object.keys(batch.meta.clipIndexByName)
        };
    }

    // Debug methods
    dumpBatches() {
        const batches = [];
        for (const [key, batch] of this.vatBatches) {
            batches.push({
                key,
                capacity: batch.capacity,
                count: batch.count,
                activeInstances: batch.entityMap.size,
                clips: Object.keys(batch.meta.clipIndexByName),
                // DEBUG: Show the actual entity mapping
                entityMappings: Array.from(batch.entityMap.entries())
            });
        }
        console.log('[RenderSystem] VAT Batches:', batches);
        return batches;
    }

    dumpInstances() {
        const instances = [];
        for (const [entityId, instance] of this.entityToInstance) {
            const state = this.getInstanceAnimationState(entityId);
            instances.push({
                entityId,
                batchKey: instance.batchKey,
                instanceIndex: instance.instanceIndex,
                animationState: state
            });
        }
        console.log('[RenderSystem] Active Instances:', instances);
        return instances;
    }

    destroy() {
        console.log('[RenderSystem] Destroying VAT render system');
        
        // Remove all meshes from scene
        for (const batch of this.vatBatches.values()) {
            if (batch.mesh) {
                this.game.scene.remove(batch.mesh);
                batch.mesh.geometry?.dispose();
                batch.mesh.material?.dispose();
            }
        }
        
        // Clear all data
        this.vatBatches.clear();
        this.entityToInstance.clear();
        
        console.log('[RenderSystem] Cleanup complete');
    }
}