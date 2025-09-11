class EquipmentSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.equipmentSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.entityEquipment = new Map();
        this.equipmentCache = new Map();
        
        this.scaleFactor = 32;
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
    
    async equipItem(entityId, equippedItem, itemData, spawnType) {
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment) {
            console.warn(`Entity ${entityId} has no equipment component`);
            return false;
        }        
        const slotType = equippedItem.slot;
        
        await this.unequipItem(entityId, slotType);
        
        const equipmentModel = await this.loadEquipmentModel(spawnType);
        if (!equipmentModel) {
            console.error(`Failed to load equipment model: items_${spawnType}`);
            return false;
        }
        
        const characterModel = this.game.renderSystem?.entityModels?.get(entityId);
        if (!characterModel) {
            console.warn(`No character model found for entity ${entityId}`);
            return false;
        }
        
        const attachmentPoint = this.findAttachmentBone(characterModel, equippedItem);
        if (!attachmentPoint) {
            console.warn(`No attachment point found for slot ${slotType} on entity ${entityId}`);
            return false;
        }
        
        const attachmentData = equippedItem.attachmentData;
        if (attachmentData) {
            equipmentModel.position.set(
                attachmentData.offset?.x || 0,
                attachmentData.offset?.y || 0,
                attachmentData.offset?.z || 0
            );
            equipmentModel.rotation.set(
                (attachmentData.rotation?.x || 0) * Math.PI / 180,
                (attachmentData.rotation?.y || 0) * Math.PI / 180,
                (attachmentData.rotation?.z || 0) * Math.PI / 180
            );
        }
        
        attachmentPoint.add(equipmentModel);
        
        if (!this.entityEquipment.has(entityId)) {
            this.entityEquipment.set(entityId, new Map());
        }
        this.entityEquipment.get(entityId).set(slotType, equipmentModel);
        
        equipment.slots[slotType] = {
            itemId: equippedItem.item,
            model: equipmentModel,
            attachmentPoint: attachmentPoint
        };
        
        return true;
    }
    
    async unequipItem(entityId, slotType) {
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment || !equipment.slots[slotType]) {
            return true;
        }
        
        const equippedItem = equipment.slots[slotType];
        if (equippedItem.model && equippedItem.attachmentPoint) {
            equippedItem.attachmentPoint.remove(equippedItem.model);
            this.disposeEquipmentModel(equippedItem.model);
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
            return this.cloneEquipmentModel(this.equipmentCache.get(cacheKey));
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
                const scaleFactor = this.scaleFactor;
                model.scale.set(
                    model.scale.x * scaleFactor,
                    model.scale.y * scaleFactor,
                    model.scale.z * scaleFactor
                );                
                this.equipmentCache.set(cacheKey, model);
                return this.cloneEquipmentModel(model);
            }
        } catch (error) {
            console.error(`Error loading equipment model ${cacheKey}:`, error);
        }
        
        return null;
    }
    
    cloneEquipmentModel(originalModel) {
        return originalModel.clone();
    }
    
    findAttachmentBone(characterModel, equippedItem) {
        let targetBone = null;
        
        const boneName = equippedItem.attachmentData?.bone;
        
        if (boneName) {
            characterModel.traverse(object => {
                if (object.isBone && object.name.replace(this.bonePrefix,'') === boneName) {
                    targetBone = object;
                }
            });
        }
        
        if (!targetBone) {
            const possibleBoneNames = this.boneNameMappings.default[equippedItem.slot] || [];
            
            characterModel.traverse(object => {
                if (object.isBone && possibleBoneNames.includes(object.name)) {
                    targetBone = object;
                }
            });
        }
        
        if (!targetBone) {
            const fallbackNames = equippedItem.slot === 'mainHand' ? ['hand', 'Hand', 'right', 'Right'] : 
                                  equippedItem.slot === 'offHand' ? ['hand', 'Hand', 'left', 'Left'] :
                                  equippedItem.slot === 'head' ? ['head', 'Head'] : [];
            
            characterModel.traverse(object => {
                if (object.isBone && !targetBone) {
                    for (const name of fallbackNames) {
                        if (object.name.toLowerCase().includes(name.toLowerCase())) {
                            targetBone = object;
                            break;
                        }
                    }
                }
            });
        }
        
        return targetBone;
    }
    
    updateEntityEquipment(entityId) {
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment) return;
        
        const entityEquip = this.entityEquipment.get(entityId);
        if (entityEquip) {
            for (const [slotType, equipmentModel] of entityEquip) {
                if (equipmentModel.parent === null) {
                    console.warn(`Equipment in slot ${slotType} became detached, reattaching...`);
                }
            }
        }
    }
    
    disposeEquipmentModel(model) {
        if (!model) return;
        
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
    
    cleanupRemovedEntities(currentEntities) {
        const currentEntitySet = new Set(currentEntities);
        
        for (const [entityId] of this.entityEquipment.entries()) {
            if (!currentEntitySet.has(entityId)) {
                this.removeEntityEquipment(entityId);
            }
        }
    }
    
    removeEntityEquipment(entityId) {
        const entityEquip = this.entityEquipment.get(entityId);
        if (entityEquip) {
            for (const [slotType, equipmentModel] of entityEquip) {
                this.disposeEquipmentModel(equipmentModel);
            }
        }
        
        this.entityEquipment.delete(entityId);
    }
    
    destroy() {
        for (const [entityId] of this.entityEquipment.entries()) {
            this.removeEntityEquipment(entityId);
        }
        
        for (const [cacheKey, model] of this.equipmentCache.entries()) {
            this.disposeEquipmentModel(model);
        }
        
        this.entityEquipment.clear();
        this.equipmentCache.clear();
    }
}