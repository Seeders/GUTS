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
            // if (renderable.objectType !== 'units') {
            //     // Let other rendering systems handle non-units (projectiles, effects, buildings, etc.)
            //     return;
            // }

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
                try {
                    batch = await this.batchCreationPromises.get(batchKey);
                } catch (error) {
                    return null;
                }
            } else {
                
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

        // Verify batch was created successfully
        if (!batch) {
            console.error(`[RenderSystem] Batch is null/undefined for ${batchKey}`);
            return null;
        }

        if (!batch.capacity) {
            console.error(`[RenderSystem] Batch has no capacity property:`, batch);
            return null;
        }

        // Find free slot with verification
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
        // CRITICAL: Force-initialize VAT attributes with verification
        if (batch.attributes && batch.attributes.clipIndex) {
      
            // Use both methods to ensure it's set correctly  
            batch.attributes.clipIndex.setX(instanceIndex, 0); // Start with idle (clip 0)
            batch.attributes.animTime.setX(instanceIndex, 0);
            batch.attributes.animSpeed.setX(instanceIndex, 1);
            
            // Also directly set array values to be sure
            batch.attributes.clipIndex.array[instanceIndex] = 0;
            batch.attributes.animTime.array[instanceIndex] = 0;
            batch.attributes.animSpeed.array[instanceIndex] = 1;
            
            batch.dirty.animation = true; 
        }

        const instance = { batchKey, instanceIndex };
        this.entityToInstance.set(entityId, instance);
        this._stats.instancesCreated++;

    
        return instance;
    }
    async createVATBatch(batchKey, objectType, spawnType) {

        // Get unit definition - handle both string and numeric spawnTypes
        const collections = this.game.getCollections?.();
        let objectDef = null;
        
        if (collections[objectType]) {
            objectDef = collections[objectType][spawnType];
            if (!objectDef && typeof spawnType === 'number') {
                const objectKeys = Object.keys(collections[objectType]);
                if (spawnType < objectKeys.length) {
                    const unitKey = objectKeys[spawnType];
                    objectDef = collections[objectType][unitKey];
                }
            }
            if (!objectDef) {
                objectDef = collections[objectType][String(spawnType)];
            }
        }
        
        if (!objectDef) {
            console.error(`[RenderSystem] No object definition found for ${objectType} - ${spawnType}`);
            return null;
        }

       

        // Request VAT bundle from ModelManager
        let bundleResult;
        try {
            bundleResult = await this.game.modelManager.requestVATBundle(objectType, spawnType, objectDef);
        } catch (error) {
            console.error(`[RenderSystem] VAT bundle request failed for ${batchKey}:`, error);
            return null;
        }
        
        
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

        
        if (bundle.meta) {

         
            // VERIFY essential animations exist
            const requiredClips = ['idle', 'walk', 'death', 'attack'];
            const availableClips = Object.keys(bundle.meta.clipIndexByName || {});
            const missingRequired = requiredClips.filter(clip => !availableClips.includes(clip));
        
            if (missingRequired.length > 0) {
                console.warn(`[RenderSystem] WARNING: Missing essential animations for ${batchKey}:`, missingRequired);
            }
            
            // CROSS-REFERENCE clips array with clipIndexByName mapping
            if (bundle.meta.clips && bundle.meta.clipIndexByName) {
                bundle.meta.clips.forEach((clip, arrayIndex) => {
                    const mappedIndex = bundle.meta.clipIndexByName[clip.name];
                    const match = mappedIndex === arrayIndex;
                    if (!match) {
                        console.error(`[RenderSystem] METADATA CORRUPTION: Clip "${clip.name}" index mismatch!`);
                    }
                });
            }
        } else {
            console.error(`[RenderSystem] CRITICAL: No meta object in VAT bundle for ${batchKey}`);
        }


        // Create instanced mesh - DON'T clone the VAT material
        const geometry = bundle.geometry.clone();
        const material = bundle.material; // Use original material, don't clone
        const capacity = this.DEFAULT_CAPACITY;


        // IMPORTANT: Force each material to have unique uniforms
        material.uuid = THREE.MathUtils.generateUUID(); // Force unique ID
        material.needsUpdate = true; // Force recompilation

        // Add debug identifier to help track material usage
        material.userData = {
            batchKey: batchKey,
            createdAt: Date.now(),
            vatTexture: bundle.meta.vatTextureId || 'unknown'
        };

      
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
     
        // Create batch data with enhanced debugging info
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
            bundleSource: `${objectType}_${spawnType}`, // Track source for debugging
            createdAt: Date.now(),
            spawnType,
            objectType,
            dirty: {
                matrices: false,
                animation: false
            }
        };

        // VALIDATE batch attributes were created correctly
   
        // INITIALIZE all attribute slots to safe defaults
        for (let i = 0; i < capacity; i++) {
            batch.attributes.clipIndex.setX(i, 0); // Default to first clip (usually idle)
            batch.attributes.animTime.setX(i, 0);
            batch.attributes.animSpeed.setX(i, 1);
        }
        batch.dirty.animation = true;

        this.vatBatches.set(batchKey, batch);
        this._stats.batchesActive = this.vatBatches.size;

  
        return batch;
    }


    setupVATAttributes(geometry, capacity) {
        // Create VAT animation attributes
        const clipIndexArray = new Float32Array(capacity).fill(0);
        const animTimeArray = new Float32Array(capacity).fill(0);
        const animSpeedArray = new Float32Array(capacity).fill(1);

        // CRITICAL: Set up instanced buffer attributes with correct divisor
        const clipIndexAttr = new THREE.InstancedBufferAttribute(clipIndexArray, 1);
        const animTimeAttr = new THREE.InstancedBufferAttribute(animTimeArray, 1);
        const animSpeedAttr = new THREE.InstancedBufferAttribute(animSpeedArray, 1);
        
        // IMPORTANT: Force the attributes to update initially
        clipIndexAttr.setUsage(THREE.DynamicDrawUsage);
        animTimeAttr.setUsage(THREE.DynamicDrawUsage);
        animSpeedAttr.setUsage(THREE.DynamicDrawUsage);
        
        // Set attributes on geometry
        geometry.setAttribute('aClipIndex', clipIndexAttr);
        geometry.setAttribute('aAnimTime', animTimeAttr);
        geometry.setAttribute('aAnimSpeed', animSpeedAttr);
        
   
    }

    updateInstanceTransform(instance, pos, velocity, facing) {
        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return;

        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3(pos.x, pos.y || 0, pos.z);
        const baseScale = (batch.meta && batch.meta.baseScale) ? batch.meta.baseScale : new THREE.Vector3(1, 1, 1);

        if(batch?.meta?.baseScale){
            console.log(baseScale);
        }
        const scale = new THREE.Vector3(baseScale.x*this.modelScale, baseScale.y*this.modelScale, baseScale.z*this.modelScale);

        let quaternion;
        
        if (facing && facing?.angle !== undefined) {
            // Use existing facing logic for units
            const rotationY = -facing.angle + Math.PI / 2;
            quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        } else if (velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD)) {
            // BRUTE FORCE TEST - try different rotation combinations
            const directionY = Math.atan2(velocity.vz, velocity.vx);
            
            // Try this combination - if it doesn't work, I'll give you 5 more to test rapidly
            const quatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2); // +90° around X
            const quatY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -directionY);
            quaternion = quatY.multiply(quatX);
        } else {
            quaternion = new THREE.Quaternion();
        }
        
        matrix.compose(position, quaternion, scale);
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;
    }
    updateAnimations() {
        const dt = this.game.state?.deltaTime;

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
                // Calculate the actual range that needs updating
                const updateCount = Math.min(batch.count, batch.capacity);
                
                if (batch.attributes.clipIndex && updateCount > 0) {
                    batch.attributes.clipIndex.needsUpdate = true;
                    batch.attributes.clipIndex.version++;
                    batch.attributes.clipIndex.addUpdateRange(0, updateCount);
                    batch.mesh.geometry.attributes.aClipIndex.needsUpdate = true;
                }
                if (batch.attributes.animTime && updateCount > 0) {
                    batch.attributes.animTime.needsUpdate = true;
                    batch.attributes.animTime.version++;
                    batch.attributes.animTime.addUpdateRange(0, updateCount);
                    batch.mesh.geometry.attributes.aAnimTime.needsUpdate = true;
                }
                if (batch.attributes.animSpeed && updateCount > 0) {
                    batch.attributes.animSpeed.needsUpdate = true;
                    batch.attributes.animSpeed.version++;
                    batch.attributes.animSpeed.addUpdateRange(0, updateCount);
                    batch.mesh.geometry.attributes.aAnimSpeed.needsUpdate = true;
                }
                batch.dirty.animation = false;
            }
        }
    }

        // Animation control methods
    setInstanceClip(entityId, clipName, resetTime = true) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) {
            console.warn(`[RenderSystem] No instance found for entity ${entityId}`);
            return false;
        }

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) {
            console.warn(`[RenderSystem] No batch found for key ${instance.batchKey}`);
            return false;
        }

        const clipIndex = batch.meta.clipIndexByName[clipName];
        if (clipIndex === undefined) {
            console.warn(`[RenderSystem] Clip '${clipName}' not found in batch ${instance.batchKey}.`);
            console.warn(`Available:`, Object.keys(batch.meta.clipIndexByName));
            
            // ADDITIONAL DEBUG: Check if the batch has the right clips
            console.warn(`  - Batch meta clips array:`, batch.meta.clips?.map(c => c.name || 'unnamed'));
            console.warn(`  - Bundle source:`, batch.bundleSource || 'unknown');
            
            return false;
        }


        // CRITICAL: Verify the instance slot before writing
        const currentClipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
        const currentEntity = batch.entityMap.get(instance.instanceIndex);
        
   
        if (currentEntity !== entityId) {
            console.error(`[RenderSystem] SLOT CORRUPTION! Slot ${instance.instanceIndex} maps to ${currentEntity} but trying to write for ${entityId}`);
            // Try to recover by finding the correct slot
            let correctSlot = -1;
            for (const [slot, mappedEntityId] of batch.entityMap.entries()) {
                if (mappedEntityId === entityId) {
                    correctSlot = slot;
                    break;
                }
            }
            if (correctSlot !== -1) {
                console.warn(`[RenderSystem] RECOVERY: Found correct slot ${correctSlot} for entity ${entityId}`);
                instance.instanceIndex = correctSlot;
                this.entityToInstance.set(entityId, instance);
            } else {
                console.error(`[RenderSystem] CORRUPTION: Entity ${entityId} not found in any slot!`);
                return false;
            }
        }
        // Set the attribute with dual method approach
        batch.attributes.clipIndex.setX(instance.instanceIndex, clipIndex);
        batch.attributes.clipIndex.array[instance.instanceIndex] = clipIndex;
        
        if (resetTime) {
            batch.attributes.animTime.setX(instance.instanceIndex, 0);
            batch.attributes.animTime.array[instance.instanceIndex] = 0;
        }
        batch.dirty.animation = true;

        // VERIFY the write was successful
        const verifyClipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
  
        if (verifyClipIndex !== clipIndex) {
            console.error(`[RenderSystem] WRITE FAILED! Expected ${clipIndex} but got ${verifyClipIndex}`);
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

    
        return true;
    }

    getInstanceAnimationState(entityId) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) {
        
            return null;
        }

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) {
      
            return null;
        }

        try {
            // Use .array[] access instead of .getX() - this might be the issue
            const clipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
            const animTime = batch.attributes.animTime.array[instance.instanceIndex];
            const animSpeed = batch.attributes.animSpeed.array[instance.instanceIndex];

            // Validate the values
            if (clipIndex === undefined || clipIndex === null) {
            
                return null;
            }

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
        } catch (error) {
            return null;
        }
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

        // Verify the entity mapping before removal
        const mappedEntity = batch.entityMap.get(instance.instanceIndex);
        if (mappedEntity !== entityId) {
            console.error(`[RenderSystem] CORRUPTION DETECTED! Instance ${instance.instanceIndex} maps to ${mappedEntity} but trying to remove ${entityId}`);
        }

        // Remove from entity map
        batch.entityMap.delete(instance.instanceIndex);
        this.entityToInstance.delete(entityId);

        // IMPORTANT: Completely clear the instance slot
        const matrix = new THREE.Matrix4();
        matrix.scale(new THREE.Vector3(0, 0, 0));
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;

        // CRITICAL: Reset animation attributes with verification
        const oldClipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
        const oldAnimTime = batch.attributes.animTime.array[instance.instanceIndex];
        const oldAnimSpeed = batch.attributes.animSpeed.array[instance.instanceIndex];
        
        // Use both methods to ensure it's cleared
        batch.attributes.clipIndex.setX(instance.instanceIndex, 0);
        batch.attributes.animTime.setX(instance.instanceIndex, 0);
        batch.attributes.animSpeed.setX(instance.instanceIndex, 0);
        
        // Also directly set array values to be sure
        batch.attributes.clipIndex.array[instance.instanceIndex] = 0;
        batch.attributes.animTime.array[instance.instanceIndex] = 0;
        batch.attributes.animSpeed.array[instance.instanceIndex] = 0;
        
        batch.dirty.animation = true;

        this._stats.instancesRemoved++;
        
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
        return instances;
    }

    destroy() {
        
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
        
    }
   // Add this method to RenderSystem.js
debugAttributeUpdates(entityId) {
    const instance = this.entityToInstance.get(entityId);
    if (!instance) {
        console.log(`❌ No instance found for entity ${entityId}`);
        return;
    }

    const batch = this.vatBatches.get(instance.batchKey);
    if (!batch) {
        console.log(`❌ No batch found for ${instance.batchKey}`);
        return;
    }

    console.log(`🔍 Debug attribute updates for entity ${entityId}:`);
    console.log(`  - Instance index: ${instance.instanceIndex}`);
    console.log(`  - Batch key: ${instance.batchKey}`);
    
    // Check attribute values
    const clipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
    const animTime = batch.attributes.animTime.array[instance.instanceIndex];
    const animSpeed = batch.attributes.animSpeed.array[instance.instanceIndex];
    
    console.log(`  - clipIndex: ${clipIndex}`);
    console.log(`  - animTime: ${animTime}`);
    console.log(`  - animSpeed: ${animSpeed}`);
    
    // Check if attributes need update
    console.log(`  - clipIndex needsUpdate: ${batch.attributes.clipIndex.needsUpdate}`);
    console.log(`  - clipIndex version: ${batch.attributes.clipIndex.version}`);
    
    // Find the clip name
    const availableClips = Object.keys(batch.meta.clipIndexByName);
    const clipName = Object.keys(batch.meta.clipIndexByName).find(
        name => batch.meta.clipIndexByName[name] === clipIndex
    );
    
    console.log(`  - Should be playing: ${clipName || 'unknown'}`);
    console.log(`  - Available clips: ${availableClips.join(', ')}`);
}
}