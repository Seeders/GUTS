class RenderSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.renderSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.vatBatches = new Map();
        this.entityToInstance = new Map();
        this.batchCreationPromises = new Map();
        
        this.modelScale = 32;
        this.DEFAULT_CAPACITY = 128;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;

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
        this.hiddenEntities = new Set();
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

    async update() {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) return;

        this._frame++;
        await this.updateEntities();
        this.updateAnimations();
        this.finalizeUpdates();
    }

    async updateEntities() {
        const CT = this.componentTypes;
        const entities = this.game.getEntitiesWith(CT.POSITION, CT.RENDERABLE);
        this._stats.entitiesProcessed = entities.length;
        entities.forEach(async (entityId) => {
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
            const velocity = this.game.getComponent(entityId, CT.VELOCITY);
            const facing = this.game.getComponent(entityId, CT.FACING);
            const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);

            if (!unitType) return;

            if (unitType.collection != "worldObjects" && !this.isVisibleForPlayer(pos)) {
                if (this.entityToInstance.has(entityId)) {
                    this.hideEntityInstance(entityId);
                }
                return;
            } else {
                if (this.hiddenEntities.has(entityId)) {
                    this.showEntityInstance(entityId);
                }
            }

            if (typeof renderable.spawnType !== 'string') {
                console.error(`[RenderSystem] Unit entity ${entityId} has invalid spawnType:`, {
                    objectType: renderable.objectType,
                    spawnType: renderable.spawnType,
                    spawnTypeType: typeof renderable.spawnType
                });
                return;
            }

            let instance = this.entityToInstance.get(entityId);
            if (!instance) {
                await this.createInstance(entityId, renderable.objectType, renderable.spawnType);
                instance = this.entityToInstance.get(entityId);
            }

            if (instance && !this.hiddenEntities.has(entityId)) {
                this.updateInstanceTransform(instance, pos, velocity, facing);
            }
        });

        this.cleanupRemovedEntities(new Set(entities));
    }

    async createInstance(entityId, objectType, spawnType) {
        if (typeof spawnType !== 'string') {
            console.error(`[RenderSystem] CRITICAL: spawnType should be string but got ${typeof spawnType}:`, spawnType);
            return null;
        }

        const batchKey = `${objectType}_${spawnType}`;
        const capacity = objectType == "worldObjects" ? 1024 : this.DEFAULT_CAPACITY;
        let batch = this.vatBatches.get(batchKey);
        if (!batch) {
            if (this.batchCreationPromises.has(batchKey)) {
                try {
                    batch = await this.batchCreationPromises.get(batchKey);
                } catch (error) {
                    return null;
                }
            } else {
                const creationPromise = this.createVATBatch(batchKey, objectType, spawnType, capacity);
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

        if (!batch || !batch.capacity) {
            console.error(`[RenderSystem] Batch has no capacity property:`, batch);
            return null;
        }

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

        batch.entityMap.set(instanceIndex, entityId);
        batch.count = Math.max(batch.count, instanceIndex + 1);
        batch.mesh.count = batch.count;

        if (batch.attributes && batch.attributes.clipIndex) {
            batch.attributes.clipIndex.setX(instanceIndex, 0);
            batch.attributes.animTime.setX(instanceIndex, 0);
            batch.attributes.animSpeed.setX(instanceIndex, 1);
            
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

    async createVATBatch(batchKey, objectType, spawnType, capacity) {
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

        const geometry = bundle.geometry.clone();
        const material = bundle.material;

        material.uuid = THREE.MathUtils.generateUUID();
        material.needsUpdate = true;

        material.userData = {
            batchKey: batchKey,
            createdAt: Date.now(),
            vatTexture: bundle.meta.vatTextureId || 'unknown'
        };

        this.setupVATAttributes(geometry, capacity);

        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        mesh.frustumCulled = false;
        
        const boundingBox = new THREE.Box3();
        const size = this.modelScale * 2;
        boundingBox.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(size, size, size));
        geometry.boundingBox = boundingBox;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.modelScale);

        if (!material.side || material.side === THREE.FrontSide) {
            material.side = THREE.DoubleSide;
        }

        this.game.scene.add(mesh);

        const batch = {
            mesh,
            geometry,
            material,
            capacity,
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
            meta: bundle.meta,
            bundleSource: `${objectType}/${spawnType}`
        };

        for (let i = 0; i < capacity; i++) {
            batch.attributes.clipIndex.setX(i, 0);
            batch.attributes.animTime.setX(i, 0);
            batch.attributes.animSpeed.setX(i, 1);
        }
        batch.dirty.animation = true;

        this.vatBatches.set(batchKey, batch);
        this._stats.batchesActive = this.vatBatches.size;
  
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

    updateInstanceTransform(instance, pos, velocity, facing) {
        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return;

        const matrix = new THREE.Matrix4();
        const baseScale = (batch.meta && batch.meta.baseScale) ? batch.meta.baseScale : new THREE.Vector3(1, 1, 1);
        const basePosition = (batch.meta && batch.meta.basePos) ? batch.meta.basePos : new THREE.Vector3(0, 0, 0);

        const position = new THREE.Vector3(
            pos.x + basePosition.x,
            pos.y + basePosition.y,
            pos.z + basePosition.z
        );
        
        const quaternion = new THREE.Quaternion();
        const facingAngle = this.calculateFacingAngle(velocity, facing);
        if (facingAngle !== null) {
            const isProjectile = !facing || facing.angle === undefined;
			if(isProjectile) {
                const direction = new THREE.Vector3(velocity.vx, velocity.vy, velocity.vz).normalize();
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
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;
    }

    calculateFacingAngle(velocity, facing) {
        if (velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD)) {
            return Math.atan2(velocity.vz, velocity.vx);
        }
        
        if (facing && facing.angle !== undefined) {
            return facing.angle;
        }

        return null;
    }

    updateAnimations() {
        const dt = this.game.state?.deltaTime;
        if (!dt) return;

        for (const [batchKey, batch] of this.vatBatches) {
            if (batchKey.startsWith('buildings_')) continue;
            const clipIndexAttr = batch.attributes.clipIndex;
            const animTimeAttr = batch.attributes.animTime;
            const animSpeedAttr = batch.attributes.animSpeed;
            
            let hasAnimationUpdates = false;

            for (const [instanceIndex, entityId] of batch.entityMap) {
                const currentTime = animTimeAttr.array[instanceIndex];
                const speed = animSpeedAttr.array[instanceIndex];
                const clipIndex = clipIndexAttr.array[instanceIndex];

                if (speed > 0) {
                    const clip = batch.meta.clips[clipIndex];
                    const duration = clip?.duration || 1.0;
                    
                    const newTime = (currentTime + dt * speed) % duration;
                    animTimeAttr.array[instanceIndex] = newTime;
                    hasAnimationUpdates = true;
                }
            }

            if (hasAnimationUpdates) {
                animTimeAttr.needsUpdate = true;
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
                batch.attributes.clipIndex.needsUpdate = true;
                batch.attributes.animSpeed.needsUpdate = true;
                batch.dirty.animation = false;
            }
        }
    }

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
            console.warn(`  - Batch meta clips array:`, batch.meta.clips?.map(c => c.name || 'unnamed'));
            console.warn(`  - Bundle source:`, batch.bundleSource || 'unknown');
            return false;
        }

        const currentEntity = batch.entityMap.get(instance.instanceIndex);
        
        if (currentEntity !== entityId) {
            console.error(`[RenderSystem] SLOT CORRUPTION! Slot ${instance.instanceIndex} maps to ${currentEntity} but trying to write for ${entityId}`);
            
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

        batch.attributes.clipIndex.setX(instance.instanceIndex, clipIndex);
        batch.attributes.clipIndex.array[instance.instanceIndex] = clipIndex;
        
        if (resetTime) {
            batch.attributes.animTime.setX(instance.instanceIndex, 0);
            batch.attributes.animTime.array[instance.instanceIndex] = 0;
        }
        batch.dirty.animation = true;

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
        if (!instance) return null;

        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return null;

        try {
            const clipIndex = batch.attributes.clipIndex.array[instance.instanceIndex];
            const animTime = batch.attributes.animTime.array[instance.instanceIndex];
            const animSpeed = batch.attributes.animSpeed.array[instance.instanceIndex];

            if (clipIndex === undefined || clipIndex === null) return null;

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

        const mappedEntity = batch.entityMap.get(instance.instanceIndex);
        if (mappedEntity !== entityId) {
            console.error(`[RenderSystem] CORRUPTION DETECTED! Instance ${instance.instanceIndex} maps to ${mappedEntity} but trying to remove ${entityId}`);
        }

        batch.entityMap.delete(instance.instanceIndex);
        this.entityToInstance.delete(entityId);

        const matrix = new THREE.Matrix4();
        matrix.scale(new THREE.Vector3(0, 0, 0));
        batch.mesh.setMatrixAt(instance.instanceIndex, matrix);
        batch.dirty.matrices = true;

        batch.attributes.clipIndex.setX(instance.instanceIndex, 0);
        batch.attributes.animTime.setX(instance.instanceIndex, 0);
        batch.attributes.animSpeed.setX(instance.instanceIndex, 0);
        
        batch.attributes.clipIndex.array[instance.instanceIndex] = 0;
        batch.attributes.animTime.array[instance.instanceIndex] = 0;
        batch.attributes.animSpeed.array[instance.instanceIndex] = 0;
        
        batch.dirty.animation = true;

        this._stats.instancesRemoved++;
    }

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

    dumpBatches() {
        const batches = [];
        for (const [key, batch] of this.vatBatches) {
            batches.push({
                key,
                capacity: batch.capacity,
                count: batch.count,
                activeInstances: batch.entityMap.size,
                clips: Object.keys(batch.meta.clipIndexByName),
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

    entityDestroyed(entityId) {
        this.removeInstance(entityId);
    }

    isEnemy(teamComp) {
        const myTeam = this.game?.state?.mySide;
        if (!teamComp || myTeam == null) return false;
        return teamComp.team !== myTeam && teamComp.team !== "neutral";
    }

    isVisibleForPlayer(pos) {
        const fow = this.game?.fogOfWarSystem;
        if (!fow || !pos) return true;
        return fow.isVisibleAt(pos.x, pos.z);
    }

    hideEntityInstance(entityId) {
        const instance = this.entityToInstance.get(entityId);
        if (!instance) return;
        const batch = this.vatBatches.get(instance.batchKey);
        if (!batch) return;

        const m = new THREE.Matrix4();
        m.scale(new THREE.Vector3(0, 0, 0));
        batch.mesh.setMatrixAt(instance.instanceIndex, m);
        batch.dirty.matrices = true;

        this.hiddenEntities.add(entityId);
    }

    showEntityInstance(entityId) {
        this.hiddenEntities.delete(entityId);
    }

    destroy() {
        for (const batch of this.vatBatches.values()) {
            if (batch.mesh) {
                this.game.scene.remove(batch.mesh);
                batch.mesh.geometry?.dispose();
                batch.mesh.material?.dispose();
            }
        }
        
        this.vatBatches.clear();
        this.entityToInstance.clear();
        this.batchCreationPromises.clear();
    }
}