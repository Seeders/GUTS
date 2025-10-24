class EquipmentSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.equipmentSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.entityEquipment = new Map();
        this.equipmentCache = new Map();
        this.equipmentBatches = new Map();
        this.equipmentInstances = new Map();
        
        this.scaleFactor = 32;
        this.DEFAULT_CAPACITY = 512;
        this.bonePrefix = 'mixamorig';
        
        this.boneNameMappings = {
            default: {
                mainHand: ['RightHand', 'Hand_R', 'hand_R', 'R_Hand'],
                offHand: ['LeftHand', 'Hand_L', 'hand_L', 'L_Hand'],
                head: ['Head', 'head', 'Head_M'],
                chest: ['Spine2', 'spine2', 'Chest', 'chest'],
                back: ['Spine', 'spine', 'Back', 'back']
            }
        };
        
        this.slotDefaultOffsets = {
            mainHand: { x: 0, y: 0, z: 0 },
            offHand: { x: 0, y: 0, z: 0 },
            head: { x: 0, y: 0.15, z: 0 },
            chest: { x: 0, y: 0, z: 0 },
            back: { x: 0, y: 0, z: -0.2 }
        };
        
        console.log('[Equipment] System initialized with bone attachment texture');
    }
    
    update() {
        const entities = this.game.getEntitiesWith(
            this.componentTypes.EQUIPMENT,
            this.componentTypes.POSITION
        );
        
        entities.forEach(entityId => {
            this.updateEntityEquipment(entityId);
        });
        
        this.cleanupRemovedEntities(entities);
    }
    
    updateEntityEquipment(entityId) {
        const equipmentData = this.equipmentInstances.get(entityId);
        if (!equipmentData) return;
        
        const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
        
        if (!pos) return;
        
        const unitInstance = this.game.renderSystem?.entityToInstance?.get(entityId);
        if (!unitInstance) return;
        
        const unitBatch = this.game.renderSystem?.vatBatches?.get(unitInstance.batchKey);
        if (!unitBatch) return;
        
        for (const [slotType, equipInstance] of equipmentData.entries()) {
            this.updateEquipmentTransformWithBone(
                equipInstance, 
                pos, 
                facing, 
                unitBatch,
                unitInstance
            );
        }
    }
    
    sampleAttachmentMatrix(attachmentTexture, cols, rows, rowIndex, attachmentBoneIndex) {
        if (!attachmentTexture?.image?.data) return null;
        
        const textureData = attachmentTexture.image.data;
        const boneColStart = attachmentBoneIndex * 4;
        
        const matrix = new THREE.Matrix4();
        const elements = matrix.elements;
        
        for (let col = 0; col < 4; col++) {
            const pixelX = Math.floor(boneColStart + col);
            const pixelY = Math.floor(rowIndex);
            
            if (pixelX >= cols || pixelY >= rows || pixelY < 0) {
                return null;
            }
            
            const pixelIndex = (pixelY * cols + pixelX) * 4;
            
            elements[col * 4 + 0] = textureData[pixelIndex + 0];
            elements[col * 4 + 1] = textureData[pixelIndex + 1];
            elements[col * 4 + 2] = textureData[pixelIndex + 2];
            elements[col * 4 + 3] = textureData[pixelIndex + 3];
        }
        
        return matrix;
    }
        
    updateEquipmentTransformWithBone(equipInstance, pos, facing, unitBatch, unitInstance) {
        const batch = this.equipmentBatches.get(equipInstance.batchKey);
        if (!batch || equipInstance.instanceIndex === null) return;
        
        if (!unitBatch?.meta?.attachmentTexture) return;
        
        const clipIndex = unitBatch.attributes.clipIndex.array[unitInstance.instanceIndex];
        const animTime = unitBatch.attributes.animTime.array[unitInstance.instanceIndex];
        
        if (clipIndex === undefined || animTime === undefined) return;
        
        const clipInfo = unitBatch.meta.clips[clipIndex];
        if (!clipInfo) return;
        
        const fps = unitBatch.meta.fps || 30;
        const frame = Math.floor((animTime * fps) % clipInfo.frames);
        const rowIndex = clipInfo.startRow + frame;
        
        const attachmentBoneIndex = equipInstance.attachmentBoneIndex;
        if (attachmentBoneIndex === undefined || attachmentBoneIndex < 0) return;
        
        const skinningMatrix = this.sampleAttachmentMatrix(
            unitBatch.meta.attachmentTexture,
            unitBatch.meta.attachmentTexture.image.width,
            unitBatch.meta.attachmentTexture.image.height,
            rowIndex,
            attachmentBoneIndex
        );
        
        if (!skinningMatrix) return;
        
        const skeleton = unitBatch.meta.skeleton;
        const originalBoneIndex = unitBatch.meta.attachmentBones[attachmentBoneIndex].index;
        const bindInverse = skeleton.boneInverses[originalBoneIndex];

        const bindPose = new THREE.Matrix4().copy(bindInverse).invert();
        const boneWorldLocal = new THREE.Matrix4().multiplyMatrices(skinningMatrix, bindPose);
        
        const bonePos = new THREE.Vector3();
        const boneQuat = new THREE.Quaternion();
        const boneScale = new THREE.Vector3();
        boneWorldLocal.decompose(bonePos, boneQuat, boneScale);
        
        const baseScale = unitBatch.meta.baseScale || new THREE.Vector3(1, 1, 1);
        const basePosition = unitBatch.meta.basePos || new THREE.Vector3(0, 0, 0);
        
        bonePos.multiply(baseScale);
        bonePos.multiplyScalar(this.scaleFactor);
        
        const slotDefaults = this.slotDefaultOffsets[equipInstance.slotType] || { x: 0, y: 0, z: 0 };
        const offsetVec = new THREE.Vector3(
            slotDefaults.x,
            slotDefaults.y,
            slotDefaults.z
        );
        
        if (equipInstance.attachmentData?.offset) {
            offsetVec.x -= (equipInstance.attachmentData.offset.x) * 0.5;
            offsetVec.y -= (equipInstance.attachmentData.offset.y) * 0.5;
            offsetVec.z -= (equipInstance.attachmentData.offset.z) * 0.5;
        }
        
        const boneRotation = boneQuat.clone();
        if (equipInstance.attachmentData?.rotation) {
            const offsetRot = new THREE.Quaternion();
            offsetRot.setFromEuler(new THREE.Euler(
                (equipInstance.attachmentData.rotation.x) * Math.PI / 180,
                (equipInstance.attachmentData.rotation.y) * Math.PI / 180,
                (equipInstance.attachmentData.rotation.z - 90) * Math.PI / 180,
                'XYZ'
            ));
            boneRotation.multiply(offsetRot);
        }
        
        offsetVec.applyQuaternion(boneRotation);
        bonePos.add(offsetVec);
        
        const rotationY = facing ? (-facing.angle + Math.PI / 2) : (Math.PI / 2);
        const worldRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        
        bonePos.applyQuaternion(worldRotation);
        
        const worldPos = new THREE.Vector3(
            pos.x + basePosition.x * this.scaleFactor,
            (pos.y || 0) + basePosition.y * this.scaleFactor,
            pos.z + basePosition.z * this.scaleFactor
        );
        bonePos.add(worldPos);
        
        const finalRotation = new THREE.Quaternion().multiplyQuaternions(worldRotation, boneRotation);
        
        const finalScale = new THREE.Vector3(this.scaleFactor * 0.5, this.scaleFactor * 0.5, this.scaleFactor * 0.5);
        
        const matrix = new THREE.Matrix4();
        matrix.compose(bonePos, finalRotation, finalScale);
        
        batch.mesh.setMatrixAt(equipInstance.instanceIndex, matrix);
        batch.mesh.instanceMatrix.needsUpdate = true;
    }
    
    findAttachmentBoneIndex(attachmentBones, boneName) {
        if (!attachmentBones) return -1;
        
        for (let i = 0; i < attachmentBones.length; i++) {
            const bone = attachmentBones[i];
            if (bone.name === boneName || 
                bone.name.replace(this.bonePrefix, '') === boneName ||
                bone.name.includes(boneName)) {
                console.log(`[Equipment] Found attachment bone "${boneName}" at index ${i} (original: ${bone.index})`);
                return i;
            }
        }
        
        console.warn(`[Equipment] Attachment bone not found: ${boneName}`);
        return -1;
    }
   
    async equipItem(entityId, slotData, itemData) {
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        const slotType = slotData.slot;
        if (!equipment) return false;
        
        if (equipment.slots[slotType]) {
            await this.unequipItem(entityId, slotType);
        }
        
        const spawnType = slotData.item;
        const equipmentModel = await this.loadEquipmentModel(spawnType);
        if (!equipmentModel) return false;
        
        const batchKey = `equipment_${spawnType}`;
        let batch = this.equipmentBatches.get(batchKey);
        
        if (!batch) {
            batch = this.createEquipmentBatch(batchKey, equipmentModel);
            if (!batch) return false;
        }
        
        const unitInstance = this.game.renderSystem?.entityToInstance?.get(entityId);
        if (!unitInstance) return false;
        
        const unitBatch = this.game.renderSystem?.vatBatches?.get(unitInstance.batchKey);
        if (!unitBatch?.meta?.attachmentBones) {
            console.error('[Equipment] Unit has no attachment bone data');
            return false;
        }
        
        const boneNames = this.boneNameMappings.default[slotType];
        let attachmentBoneIndex = -1;
        
        for (const boneName of boneNames) {
            attachmentBoneIndex = this.findAttachmentBoneIndex(unitBatch.meta.attachmentBones, boneName);
            if (attachmentBoneIndex >= 0) break;
        }
        
        if (attachmentBoneIndex < 0) {
            console.error(`[Equipment] No valid attachment bone found for slot ${slotType}`);
            return false;
        }
        
        const instanceIndex = this.allocateEquipmentInstance(batch);
        if (instanceIndex === null) return false;
        
        const equipInstance = {
            batchKey,
            instanceIndex,
            slotType,
            attachmentBoneIndex,
            attachmentData: slotData.attachmentData
        };
        
        if (!this.equipmentInstances.has(entityId)) {
            this.equipmentInstances.set(entityId, new Map());
        }
        this.equipmentInstances.get(entityId).set(slotType, equipInstance);
        
        if (!this.entityEquipment.has(entityId)) {
            this.entityEquipment.set(entityId, new Map());
        }
        
        this.entityEquipment.get(entityId).set(slotType, {
            itemData,
            spawnType,
            instanceIndex,
            batchKey
        });
        
        equipment.slots[slotType] = {
            itemData,
            equippedItem: itemData
        };
        
        console.log(`[Equipment] Equipped ${spawnType} to entity ${entityId} slot ${slotType} attachment bone ${attachmentBoneIndex}`);
        return true;
    }
    
    createEquipmentBatch(batchKey, equipmentModel) {
        let geometry = null;
        let material = null;
        
        equipmentModel.traverse(child => {
            if (child.isMesh && !geometry) {
                geometry = child.geometry.clone();
                material = child.material.clone();
            }
        });
        
        if (!geometry || !material) return null;
        
        material.metalness = material.metalness || 0.8;
        material.roughness = material.roughness || 0.2;
        
        const instancedMesh = new THREE.InstancedMesh(geometry, material, this.DEFAULT_CAPACITY);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        instancedMesh.frustumCulled = false;
        
        const hiddenMatrix = new THREE.Matrix4();
        hiddenMatrix.makeTranslation(0, -10000, 0);
        hiddenMatrix.scale(new THREE.Vector3(0.001, 0.001, 0.001));
        
        for (let i = 0; i < this.DEFAULT_CAPACITY; i++) {
            instancedMesh.setMatrixAt(i, hiddenMatrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        
        if (this.game.scene) {
            this.game.scene.add(instancedMesh);
        }
        
        const batch = {
            mesh: instancedMesh,
            capacity: this.DEFAULT_CAPACITY,
            count: 0,
            availableIndices: Array.from({ length: this.DEFAULT_CAPACITY }, (_, i) => i),
            usedIndices: new Set()
        };
        
        this.equipmentBatches.set(batchKey, batch);
        return batch;
    }
    
    allocateEquipmentInstance(batch) {
        if (batch.availableIndices.length === 0) return null;
        const instanceIndex = batch.availableIndices.shift();
        batch.usedIndices.add(instanceIndex);
        batch.count++;
        return instanceIndex;
    }
    
    releaseEquipmentInstance(batch, instanceIndex) {
        if (!batch.usedIndices.has(instanceIndex)) return;
        
        const hiddenMatrix = new THREE.Matrix4();
        hiddenMatrix.makeTranslation(0, -10000, 0);
        hiddenMatrix.scale(new THREE.Vector3(0.001, 0.001, 0.001));
        batch.mesh.setMatrixAt(instanceIndex, hiddenMatrix);
        batch.mesh.instanceMatrix.needsUpdate = true;
        
        batch.usedIndices.delete(instanceIndex);
        batch.availableIndices.push(instanceIndex);
        batch.count--;
    }
    
    async unequipItem(entityId, slotType) {
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment || !equipment.slots[slotType]) return true;
        
        const equipInstance = this.equipmentInstances.get(entityId)?.get(slotType);
        
        if (equipInstance) {
            const batch = this.equipmentBatches.get(equipInstance.batchKey);
            if (batch) {
                this.releaseEquipmentInstance(batch, equipInstance.instanceIndex);
            }
            this.equipmentInstances.get(entityId)?.delete(slotType);
        }
        
        const entityEquip = this.entityEquipment.get(entityId);
        if (entityEquip) {
            entityEquip.delete(slotType);
        }
        
        equipment.slots[slotType] = null;
        return true;
    }
    
    async loadEquipmentModel(spawnType) {
        const cacheKey = `items_${spawnType}`;
        
        if (this.equipmentCache.has(cacheKey)) {
            return this.equipmentCache.get(cacheKey).clone();
        }
        
        try {
            const model = this.game.modelManager.getModel("items", spawnType);
            
            if (model) {
                model.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.metalness = child.material.metalness || 0.8;
                            child.material.roughness = child.material.roughness || 0.2;
                        }
                    }
                });
                
                model.scale.set(this.scaleFactor, this.scaleFactor, this.scaleFactor);
                this.equipmentCache.set(cacheKey, model);
                return model.clone();
            }
        } catch (error) {
            console.error(`Error loading equipment model ${cacheKey}:`, error);
        }
        
        return null;
    }
    
    cleanupRemovedEntities(activeEntities) {
        const activeSet = new Set(activeEntities);
        
        for (const [entityId, equipmentMap] of this.equipmentInstances.entries()) {
            if (!activeSet.has(entityId)) {
                for (const [slotType, equipInstance] of equipmentMap.entries()) {
                    const batch = this.equipmentBatches.get(equipInstance.batchKey);
                    if (batch) {
                        this.releaseEquipmentInstance(batch, equipInstance.instanceIndex);
                    }
                }
                this.equipmentInstances.delete(entityId);
                this.entityEquipment.delete(entityId);
            }
        }
    }
    
    destroy() {
        for (const [batchKey, batch] of this.equipmentBatches.entries()) {
            if (batch.mesh) {
                if (this.game.scene) {
                    this.game.scene.remove(batch.mesh);
                }
                batch.mesh.geometry.dispose();
                if (Array.isArray(batch.mesh.material)) {
                    batch.mesh.material.forEach(mat => mat.dispose());
                } else {
                    batch.mesh.material.dispose();
                }
            }
        }
        
        for (const [key, model] of this.equipmentCache.entries()) {
            model.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        
        this.equipmentBatches.clear();
        this.equipmentInstances.clear();
        this.entityEquipment.clear();
        this.equipmentCache.clear();
    }
}