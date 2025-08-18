/**
 * @class GE_EquipmentEditor
 * @description Equipment panel extension for GraphicsEditor
 */
class GE_EquipmentEditor {
    /**
     * @param {Object} gameEditor - Main game editor instance
     * @param {Object} graphicsEditor - Graphics editor instance
     */
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        
        // Equipment-specific state
        this.equipmentData = [];
        this.renderData = null;
        this.selectedEquipmentIndex = -1;
        this.equipmentModels = new Map();
        this.attachmentBones = new Map();
        this.characterBones = new Map(); // Cache for character bones
        this.bonePrefix = 'mixamorig'
    }
    
    /**
     * Initialize equipment editor capabilities
     */
    init() {
        this.setupEventListeners();
    }
    
    /**
     * Set up event listeners for equipment functionality
     */
    setupEventListeners() {
        // Listen for render data loading
        document.body.addEventListener('renderGraphicsObject', this.handleLoadEvent.bind(this));
        
        // Listen for scene updates to maintain bone attachments
        document.body.addEventListener('sceneUpdated', this.maintainBoneAttachments.bind(this));
        
        // Equipment panel toggle
        document.getElementById('equipment-toggle-btn')?.addEventListener('click', this.toggleEquipmentPanel.bind(this));
        
        // Equipment action buttons
        document.getElementById('equipment-add-btn')?.addEventListener('click', this.addEquipment.bind(this));
        document.getElementById('equipment-remove-btn')?.addEventListener('click', this.removeSelectedEquipment.bind(this));
        
        // Equipment list selection
        document.getElementById('equipment-list')?.addEventListener('click', this.handleEquipmentSelection.bind(this));
        
        // Attachment controls
        this.setupAttachmentControls();
    }
    
    /**
     * Handle load event to detect equipment data
     */
    handleLoadEvent(event) {
        const { data, propertyName, objectData } = event.detail;
        
        // Handle render data loading
        if (propertyName === 'render' && data) {
            this.renderData = data;
            this.equipmentData = data.equipment || [];
            
            // Wait for scene to be fully rendered before loading equipment
            setTimeout(() => {
                this.findCharacterBones();
                
                if (this.equipmentData.length > 0) {
                    console.log('Equipment data found, showing equipment panel');
                    this.showEquipmentPanel();
                    this.loadEquipmentModels();
                } else {
                    console.log('No equipment data, hiding equipment panel');
                    this.hideEquipmentPanel();
                }
                
                this.updateEquipmentList();
                this.updateBoneSelector();
            }, 100);
        }
    }
    
    /**
     * Find and cache all bones in the character model
     */
    findCharacterBones() {
        this.characterBones.clear();
        this.attachmentBones.clear();
        
        if (!this.graphicsEditor.rootGroup) {
            console.warn('No root group found for bone detection');
            return;
        }
        
        // Traverse the entire scene to find all bones
        this.graphicsEditor.rootGroup.traverse(object => {
            if (object.isBone) {
                this.characterBones.set(object.name.replace(this.bonePrefix, ''), object);
                this.attachmentBones.set(object.name.replace(this.bonePrefix, ''), object);
            }
            
            // Also check for bones in GLTF models
            if (object.userData && object.userData.isGLTFRoot && object.userData.skeleton) {
                const skeleton = object.userData.skeleton;
                skeleton.bones.forEach(bone => {
                    this.characterBones.set(bone.name.replace(this.bonePrefix, ''), bone);
                    this.attachmentBones.set(bone.name.replace(this.bonePrefix, ''), bone);
                });
            }
        });
        
        console.log(`Total bones found: ${this.characterBones.size}`);
    }
    
    /**
     * Show equipment panel
     */
    showEquipmentPanel() {
        const panel = document.getElementById('equipment-panel');
        const container = document.getElementById('graphics-editor-container');
        
        if (panel) {
            panel.style.display = 'block';
        }
        
        if (container) {
            container.classList.add('has-equipment');
        }
        
        this.populateItemSelector();
    }
    
    /**
     * Hide equipment panel
     */
    hideEquipmentPanel() {
        const panel = document.getElementById('equipment-panel');
        const container = document.getElementById('graphics-editor-container');
        
        if (panel) {
            panel.style.display = 'none';
        }
        
        if (container) {
            container.classList.remove('has-equipment');
            container.classList.remove('equipment-selected');
        }
        
        this.selectedEquipmentIndex = -1;
    }
    
    /**
     * Toggle equipment panel collapsed state
     */
    toggleEquipmentPanel() {
        const panel = document.getElementById('equipment-panel');
        if (panel) {
            panel.classList.toggle('collapsed');
        }
    }
    
    /**
     * Load equipment models
     */
    async loadEquipmentModels() {
        this.equipmentModels.clear();
        
        // Ensure bones are found before loading equipment
        this.findCharacterBones();
        
        for (let i = 0; i < this.equipmentData.length; i++) {
            const equipment = this.equipmentData[i];
            await this.loadSingleEquipmentModel(equipment, i);
        }
    }
    
    /**
     * Load a single equipment model
     */
    async loadSingleEquipmentModel(equipment, index) {
        try {
            const itemData = this.gameEditor.getCollections().items?.[equipment.item];
            if (!itemData?.render?.model) {
                console.warn(`No render data found for item: ${equipment.item}`);
                return;
            }
            
            // Create equipment model using ShapeFactory
            const equipmentGroup = await this.graphicsEditor.shapeFactory.createGroupFromJSON(
                `equipment_${index}`, 
                itemData.render.model.main
            );
            
            if (equipmentGroup) {
                // Mark as equipment for identification
                equipmentGroup.userData.isEquipment = true;
                equipmentGroup.userData.equipmentIndex = index;
                equipmentGroup.userData.equipmentItem = equipment.item;
                
                // Apply attachment data BEFORE attaching to bone
                this.applyAttachmentData(equipmentGroup, equipment.attachmentData);
                
                // Find and attach to bone
                const bone = this.findAttachmentBone(equipment);
                if (bone) {
                    console.log(`Attaching equipment ${equipment.item} to bone: ${bone.name}`);
                    bone.add(equipmentGroup);
                    
                    // Ensure the bone hierarchy is properly maintained
                    this.ensureBoneHierarchy(bone);
                } else {
                    console.warn(`No suitable bone found for equipment ${equipment.item}, adding to root`);
                    // As fallback, add to root group but this shouldn't happen with proper bone detection
                    this.graphicsEditor.rootGroup.add(equipmentGroup);
                }
                
                this.equipmentModels.set(index, {
                    model: equipmentGroup,
                    equipment: equipment,
                    bone: bone
                });
                
                console.log(`Equipment model loaded and attached: ${equipment.item}`);
            }
        } catch (error) {
            console.error(`Error loading equipment model for ${equipment.item}:`, error);
        }
    }
    
    /**
     * Ensure bone hierarchy is properly maintained in the scene
     */
    ensureBoneHierarchy(bone) {
        // Make sure the bone and its ancestors are properly connected to the scene
        let currentBone = bone;
        while (currentBone && currentBone.parent) {
            // If we find a parent that's in the root group, we're good
            if (currentBone.parent === this.graphicsEditor.rootGroup || 
                this.isInSceneHierarchy(currentBone.parent)) {
                break;
            }
            currentBone = currentBone.parent;
        }
    }
    
    /**
     * Check if an object is properly connected to the scene hierarchy
     */
    isInSceneHierarchy(object) {
        let current = object;
        while (current.parent) {
            if (current.parent === this.graphicsEditor.sceneRenderer.scene || 
                current.parent === this.graphicsEditor.rootGroup) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }
    
    /**
     * Find attachment bone for equipment with improved fallback logic
     */
    findAttachmentBone(equipment) {
        // First try the explicitly specified bone
        const specifiedBone = equipment.attachmentData?.bone;
        if (specifiedBone && this.characterBones.has(specifiedBone)) {
            return this.characterBones.get(specifiedBone);
        }
        
        // Enhanced fallback bone detection with more comprehensive mappings
        const fallbackBones = {
            'mainHand': [
                'RightHand', 'Hand_R', 'hand_R', 'R_Hand', 'hand.R', 
                'RightHand_End', 'RHand', 'right_hand', 'HandR'
            ],
            'offHand': [
                'LeftHand', 'Hand_L', 'hand_L', 'L_Hand', 'hand.L',
                'LeftHand_End', 'LHand', 'left_hand', 'HandL'
            ],
            'head': [
                'Head', 'head', 'Head_M', 'head_end', 'Head_End',
                'HeadTop_End', 'neck_01', 'Neck', 'neck'
            ],
            'chest': [
                'Spine2', 'spine2', 'Chest', 'chest', 'spine_02',
                'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'
            ],
            'back': [
                'Spine2', 'spine2', 'Chest', 'chest', 'spine_02',
                'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'
            ],
            'waist': [
                'Spine', 'spine', 'Hips', 'hips', 'pelvis', 'Pelvis',
                'spine_01', 'Spine_01', 'Root', 'root'
            ]
        };
        
        const possibleBones = fallbackBones[equipment.slot] || [];
        
        // Try each possible bone name
        for (const boneName of possibleBones) {
            if (this.characterBones.has(boneName)) {
                console.log(`Found fallback bone ${boneName} for slot ${equipment.slot}`);
                return this.characterBones.get(boneName);
            }
        }
        
        // If no specific bone found, try to find any bone that contains the slot name
        for (const [boneName, bone] of this.characterBones) {
            const lowerBoneName = boneName.toLowerCase();
            const lowerSlot = equipment.slot.toLowerCase();
            
            if (lowerBoneName.includes(lowerSlot) || 
                lowerSlot.includes(lowerBoneName.replace(/[_\-\.]/g, ''))) {
                console.log(`Found partial match bone ${boneName} for slot ${equipment.slot}`);
                return bone;
            }
        }
        
        console.warn(`No suitable bone found for equipment slot: ${equipment.slot}`);
        console.log('Available bones:', Array.from(this.characterBones.keys()));
        
        return null;
    }
    
    /**
     * Apply attachment data to equipment model
     */
    applyAttachmentData(equipmentModel, attachmentData) {
        if (!attachmentData) return;
        
        // Apply position offset
        if (attachmentData.offset) {
            equipmentModel.position.set(
                attachmentData.offset.x || 0,
                attachmentData.offset.y || 0,
                attachmentData.offset.z || 0
            );
        }
        
        // Apply rotation
        if (attachmentData.rotation) {
            equipmentModel.rotation.set(
                (attachmentData.rotation.x || 0) * Math.PI / 180,
                (attachmentData.rotation.y || 0) * Math.PI / 180,
                (attachmentData.rotation.z || 0) * Math.PI / 180
            );
        }
        
        // Apply scale if specified
        if (attachmentData.scale) {
            equipmentModel.scale.set(
                attachmentData.scale.x || 1,
                attachmentData.scale.y || 1,
                attachmentData.scale.z || 1
            );
        }
    }
    
    /**
     * Maintain bone attachments after scene updates
     */
    maintainBoneAttachments() {
        // Re-find bones in case the character model was reloaded
        this.findCharacterBones();
        
        // Check all equipment models and ensure they're still properly attached
        this.equipmentModels.forEach((equipmentData, index) => {
            const { model, equipment } = equipmentData;
            
            // Check if model is still properly attached to a bone
            const expectedBone = this.findAttachmentBone(equipment);
            
            if (expectedBone && model.parent !== expectedBone) {
                console.log(`Re-attaching equipment ${equipment.item} to bone ${expectedBone.name}`);
                
                // Remove from current parent
                if (model.parent) {
                    model.parent.remove(model);
                }
                
                // Re-attach to correct bone
                expectedBone.add(model);
                equipmentData.bone = expectedBone;
            }
        });
    }
    
    /**
     * Update equipment list display
     */
    updateEquipmentList() {
        const listContainer = document.getElementById('equipment-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        
        if (this.equipmentData.length === 0) {
            listContainer.innerHTML = '<div class="no-equipment">No equipment loaded</div>';
            this.updateEquipmentCount();
            return;
        }
        
        this.equipmentData.forEach((equipment, index) => {
            const listItem = document.createElement('div');
            listItem.className = `equipment-item ${index === this.selectedEquipmentIndex ? 'selected' : ''}`;
            listItem.dataset.index = index;
            
            // Show attachment status
            const bone = this.findAttachmentBone(equipment);
            const attachmentStatus = bone ? `✓ ${bone.name}` : '✗ No bone';
            
            listItem.innerHTML = `
                <div class="equipment-info">
                    <div class="item-name">${equipment.item}</div>
                    <div class="slot-name">${equipment.slot}</div>
                    <div class="bone-info" title="${attachmentStatus}">
                        ${bone ? bone.name : 'No bone found'}
                    </div>
                </div>
            `;
            
            listContainer.appendChild(listItem);
        });
        
        this.updateEquipmentCount();
    }
    
    /**
     * Update equipment count display
     */
    updateEquipmentCount() {
        const countElement = document.getElementById('equipment-count');
        if (countElement) {
            countElement.textContent = this.equipmentData.length;
        }
    }
    
    /**
     * Update bone selector dropdown
     */
    updateBoneSelector() {
        const boneSelector = document.getElementById('equipment-bone-selector');
        if (!boneSelector) return;
        
        boneSelector.innerHTML = '<option value="">Auto-detect</option>';
        
        // Sort bones alphabetically for easier navigation
        const sortedBones = Array.from(this.characterBones.keys()).sort();
        
        sortedBones.forEach(boneName => {
            const option = document.createElement('option');
            option.value = boneName;
            option.textContent = boneName;
            boneSelector.appendChild(option);
        });
    }
    
    /**
     * Populate item selector dropdown
     */
    populateItemSelector() {
        const itemSelector = document.getElementById('equipment-item-selector');
        if (!itemSelector) return;
        
        // Clear existing options except first
        while (itemSelector.children.length > 1) {
            itemSelector.removeChild(itemSelector.lastChild);
        }
        
        const collections = this.gameEditor.getCollections();
        if (collections.items) {
            Object.keys(collections.items).forEach(itemId => {
                const item = collections.items[itemId];
                const option = document.createElement('option');
                option.value = itemId;
                option.textContent = item.title || itemId;
                itemSelector.appendChild(option);
            });
        }
    }
    
    /**
     * Handle equipment selection
     */
    handleEquipmentSelection(event) {
        const equipmentItem = event.target.closest('.equipment-item');
        if (equipmentItem) {
            const index = parseInt(equipmentItem.dataset.index);
            this.selectEquipment(index);
        }
    }
    
    /**
     * Select equipment by index
     */
    selectEquipment(index) {
        this.selectedEquipmentIndex = index;
        this.updateEquipmentList();
        this.updateAttachmentControls();
        this.updateSelectedEquipmentDisplay();
        this.highlightSelectedEquipment();
        
        // Show equipment inspector
        const container = document.getElementById('graphics-editor-container');
        if (container) {
            if (index >= 0) {
                container.classList.add('equipment-selected');
            } else {
                container.classList.remove('equipment-selected');
            }
        }
    }
    
    /**
     * Update selected equipment display
     */
    updateSelectedEquipmentDisplay() {
        const selectedElement = document.getElementById('selected-equipment');
        if (selectedElement) {
            if (this.selectedEquipmentIndex >= 0) {
                const equipment = this.equipmentData[this.selectedEquipmentIndex];
                selectedElement.textContent = equipment ? equipment.item : 'None';
            } else {
                selectedElement.textContent = 'None';
            }
        }
    }
    
    /**
     * Update attachment controls with selected equipment data
     */
    updateAttachmentControls() {
        if (this.selectedEquipmentIndex < 0) return;
        
        const equipment = this.equipmentData[this.selectedEquipmentIndex];
        const attachmentData = equipment.attachmentData || {};
        
        document.getElementById('equipment-offset-x').value = attachmentData.offset?.x || 0;
        document.getElementById('equipment-offset-y').value = attachmentData.offset?.y || 0;
        document.getElementById('equipment-offset-z').value = attachmentData.offset?.z || 0;
        
        document.getElementById('equipment-rotation-x').value = attachmentData.rotation?.x || 0;
        document.getElementById('equipment-rotation-y').value = attachmentData.rotation?.y || 0;
        document.getElementById('equipment-rotation-z').value = attachmentData.rotation?.z || 0;
        
        document.getElementById('equipment-bone-selector').value = attachmentData.bone || '';
        
        this.updateEquipmentProperties();
    }
    
    /**
     * Set up attachment control event listeners
     */
    setupAttachmentControls() {
        const controls = [
            'equipment-offset-x', 'equipment-offset-y', 'equipment-offset-z',
            'equipment-rotation-x', 'equipment-rotation-y', 'equipment-rotation-z'
        ];
        
        controls.forEach(controlId => {
            const input = document.getElementById(controlId);
            if (input) {
                input.addEventListener('input', this.updateSelectedEquipmentTransform.bind(this));
            }
        });
        
        const boneSelect = document.getElementById('equipment-bone-selector');
        if (boneSelect) {
            boneSelect.addEventListener('change', this.updateSelectedEquipmentBone.bind(this));
        }
    }
    
    /**
     * Update selected equipment transform
     */
    updateSelectedEquipmentTransform() {
        if (this.selectedEquipmentIndex < 0) return;
        
        const equipment = this.equipmentData[this.selectedEquipmentIndex];
        if (!equipment.attachmentData) {
            equipment.attachmentData = {};
        }
        
        // Update offset
        if (!equipment.attachmentData.offset) {
            equipment.attachmentData.offset = {};
        }
        equipment.attachmentData.offset.x = parseFloat(document.getElementById('equipment-offset-x').value) || 0;
        equipment.attachmentData.offset.y = parseFloat(document.getElementById('equipment-offset-y').value) || 0;
        equipment.attachmentData.offset.z = parseFloat(document.getElementById('equipment-offset-z').value) || 0;
        
        // Update rotation
        if (!equipment.attachmentData.rotation) {
            equipment.attachmentData.rotation = {};
        }
        equipment.attachmentData.rotation.x = parseFloat(document.getElementById('equipment-rotation-x').value) || 0;
        equipment.attachmentData.rotation.y = parseFloat(document.getElementById('equipment-rotation-y').value) || 0;
        equipment.attachmentData.rotation.z = parseFloat(document.getElementById('equipment-rotation-z').value) || 0;
        
        // Apply changes to model
        const equipmentData = this.equipmentModels.get(this.selectedEquipmentIndex);
        if (equipmentData) {
            this.applyAttachmentData(equipmentData.model, equipment.attachmentData);
        }        
        this.saveEquipmentData();
    }
    
    /**
     * Update selected equipment bone
     */
    updateSelectedEquipmentBone() {
        if (this.selectedEquipmentIndex < 0) return;
        
        const equipment = this.equipmentData[this.selectedEquipmentIndex];
        const newBoneName = document.getElementById('equipment-bone-selector').value;
        
        if (!equipment.attachmentData) {
            equipment.attachmentData = {};
        }
        equipment.attachmentData.bone = newBoneName;
        
        // Re-attach equipment to new bone
        const equipmentData = this.equipmentModels.get(this.selectedEquipmentIndex);
        if (equipmentData) {
            // Remove from current parent
            if (equipmentData.model.parent) {
                equipmentData.model.parent.remove(equipmentData.model);
            }
            
            // Attach to new bone
            const newBone = this.findAttachmentBone(equipment);
            if (newBone) {
                console.log(`Re-attaching equipment to bone: ${newBone.name}`);
                newBone.add(equipmentData.model);
                equipmentData.bone = newBone;
            } else {
                console.warn('No bone found, adding to root group');
                this.graphicsEditor.rootGroup.add(equipmentData.model);
                equipmentData.bone = null;
            }
        }
        
        this.updateEquipmentList();
        this.saveEquipmentData();
    }
    
    /**
     * Highlight selected equipment in scene
     */
    highlightSelectedEquipment() {
        // Reset all equipment materials
        this.equipmentModels.forEach((equipmentData) => {
            equipmentData.model.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.emissive.setHex(0x000000);
                }
            });
        });
        
        // Highlight selected equipment
        if (this.selectedEquipmentIndex >= 0) {
            const selectedEquipment = this.equipmentModels.get(this.selectedEquipmentIndex);
            if (selectedEquipment) {
                selectedEquipment.model.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material.emissive.setHex(0x444444);
                    }
                });
            }
        }
    }
    
    /**
     * Update equipment properties panel
     */
    updateEquipmentProperties() {
        const propertiesContainer = document.getElementById('equipment-property-list');
        if (!propertiesContainer) return;
        
        if (this.selectedEquipmentIndex < 0) {
            propertiesContainer.innerHTML = `
                <div style="font-size: 0.8em; color: #95a5a6; text-align: center; padding: 20px;">
                    Select equipment to view properties
                </div>
            `;
            return;
        }
        
        const equipment = this.equipmentData[this.selectedEquipmentIndex];
        const itemData = this.gameEditor.getCollections().items?.[equipment.item];
        const bone = this.findAttachmentBone(equipment);
        
        let propertiesHtml = `
            <div style="display: flex; gap: 5px; margin-bottom: 8px; align-items: center;">
                <label style="min-width: 40px; font-size: 0.8em; color: #95a5a6;">Item:</label>
                <input type="text" value="${equipment.item}" readonly style="flex: 1; padding: 4px; background: #1a252f; border: 1px solid #34495e; border-radius: 3px; color: #ecf0f1; font-size: 0.8em;">
            </div>
            <div style="display: flex; gap: 5px; margin-bottom: 8px; align-items: center;">
                <label style="min-width: 40px; font-size: 0.8em; color: #95a5a6;">Slot:</label>
                <input type="text" value="${equipment.slot}" readonly style="flex: 1; padding: 4px; background: #1a252f; border: 1px solid #34495e; border-radius: 3px; color: #ecf0f1; font-size: 0.8em;">
            </div>
            <div style="display: flex; gap: 5px; margin-bottom: 8px; align-items: center;">
                <label style="min-width: 40px; font-size: 0.8em; color: #95a5a6;">Bone:</label>
                <input type="text" value="${bone ? bone.name : 'Not found'}" readonly style="flex: 1; padding: 4px; background: #1a252f; border: 1px solid ${bone ? '#27ae60' : '#e74c3c'}; border-radius: 3px; color: ${bone ? '#27ae60' : '#e74c3c'}; font-size: 0.8em;">
            </div>
        `;
        
        if (itemData) {
            propertiesHtml += `
                <div style="display: flex; gap: 5px; margin-bottom: 8px; align-items: center;">
                    <label style="min-width: 40px; font-size: 0.8em; color: #95a5a6;">Title:</label>
                    <input type="text" value="${itemData.title || equipment.item}" readonly style="flex: 1; padding: 4px; background: #1a252f; border: 1px solid #34495e; border-radius: 3px; color: #ecf0f1; font-size: 0.8em;">
                </div>
            `;
        }
        
        propertiesHtml += `
            <div style="font-size: 0.7em; color: #95a5a6; margin-top: 10px; line-height: 1.3;">
                Equipment is cosmetic only. Stats are managed on the unit level.
                ${bone ? '' : '<br><span style="color: #e74c3c;">⚠ No attachment bone found</span>'}
            </div>
        `;
        
        propertiesContainer.innerHTML = propertiesHtml;
    }
    
    /**
     * Add new equipment
     */
    addEquipment() {
        const itemSelector = document.getElementById('equipment-item-selector');
        const slotSelector = document.getElementById('equipment-slot-selector');
        
        if (!itemSelector.value || !slotSelector.value) {
            alert('Please select both an item and a slot');
            return;
        }
        
        const newEquipment = {
            slot: slotSelector.value,
            item: itemSelector.value,
            attachmentData: {
                bone: '',
                offset: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        
        // Initialize equipment array if it doesn't exist
        if (!this.renderData.equipment) {
            this.renderData.equipment = [];
        }
        
        this.equipmentData.push(newEquipment);
        this.renderData.equipment = this.equipmentData;
        
        this.loadSingleEquipmentModel(newEquipment, this.equipmentData.length - 1);
        this.updateEquipmentList();
        this.selectEquipment(this.equipmentData.length - 1);
        this.showEquipmentPanel();
        this.saveEquipmentData();
        
        // Reset selectors
        itemSelector.value = '';
        slotSelector.value = '';
    }
    
    /**
     * Remove selected equipment
     */
    removeSelectedEquipment() {
        if (this.selectedEquipmentIndex < 0) return;
        
        // Remove from 3D scene
        const equipmentData = this.equipmentModels.get(this.selectedEquipmentIndex);
        if (equipmentData && equipmentData.model.parent) {
            equipmentData.model.parent.remove(equipmentData.model);
        }
        
        // Remove from data
        this.equipmentData.splice(this.selectedEquipmentIndex, 1);
        this.renderData.equipment = this.equipmentData;
        this.equipmentModels.delete(this.selectedEquipmentIndex);
        
        // Update models map indices
        const newModelsMap = new Map();
        this.equipmentModels.forEach((data, index) => {
            const newIndex = index > this.selectedEquipmentIndex ? index - 1 : index;
            newModelsMap.set(newIndex, data);
        });
        this.equipmentModels = newModelsMap;
        
        this.selectedEquipmentIndex = -1;
        this.updateEquipmentList();
        this.saveEquipmentData();
        
        // Hide panel if no equipment left
        if (this.equipmentData.length === 0) {
            this.hideEquipmentPanel();
        }
    }
    
    /**
     * Save equipment data back to the render object
     */
    saveEquipmentData() {
        if (!this.renderData) return;
        this.renderData.equipment = this.equipmentData;
   
        this.graphicsEditor.renderShapes(false);
    }
    clearAllEquipment() {
        // Remove all models from the scene
        this.equipmentModels.forEach((equipmentData) => {
            const { model } = equipmentData;
            if (model && model.parent) {
                model.parent.remove(model);
            }
        });

        // Reset equipment state
        this.equipmentModels.clear();
        this.equipmentData = [];
        this.selectedEquipmentIndex = -1;

        // Update UI
        this.updateEquipmentList();
        this.updateEquipmentCount();
        this.updateSelectedEquipmentDisplay();

        console.log("All equipment has been cleared from the scene.");
    }
    /**
     * Debug method to log bone hierarchy
     */
    debugBoneHierarchy() {
        console.log('=== Bone Hierarchy Debug ===');
        this.characterBones.forEach((bone, name) => {
            console.log(`Bone: ${name}`);
            console.log(`  Position:`, bone.position);
            console.log(`  Parent:`, bone.parent ? bone.parent.name : 'None');
            console.log(`  Children:`, bone.children.length);
            console.log(`  World Position:`, bone.getWorldPosition(new THREE.Vector3()));
        });
        
        console.log('=== Equipment Attachment Status ===');
        this.equipmentModels.forEach((equipmentData, index) => {
            const { model, equipment, bone } = equipmentData;
            console.log(`Equipment ${index}: ${equipment.item}`);
            console.log(`  Slot: ${equipment.slot}`);
            console.log(`  Attached to: ${bone ? bone.name : 'None'}`);
            console.log(`  Model parent: ${model.parent ? model.parent.name : 'None'}`);
            console.log(`  Model position:`, model.position);
            if (bone) {
                console.log(`  Bone world position:`, bone.getWorldPosition(new THREE.Vector3()));
            }
        });
    }
}