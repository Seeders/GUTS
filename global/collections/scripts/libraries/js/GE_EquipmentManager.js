/**
 * GE_EquipmentManager — equipment editing for the Graphics Editor.
 *
 * CORE (data + scene): equipment lives as an array on the object's
 * render.equipment — entries {slot, item, attachmentData:{bone, offset{xyz},
 * rotation{xyz degrees}}}. Item models are built with ShapeFactory from
 * collections.items[item].render.model and parented to a skeleton bone
 * (explicit bone name, per-slot fallback list, or substring match).
 *
 * UI (rebuilt): a slot board rendered into #equipment-root — one row per slot
 * with an item dropdown (— empty — unequips, picking an item equips/swaps).
 * Selecting an occupied row expands its attachment editor inline (bone +
 * offset + rotation). No separate add flow, list, or read-only info panels.
 *
 * External contract preserved: clearAllEquipment(), findCharacterBones(),
 * findAttachmentBone(equipment), applyAttachmentData(), maintainBoneAttachments(),
 * and the index-keyed equipmentModels Map (GraphicsEditor.renderShapes detaches,
 * re-attaches and writes back into it).
 */
class GE_EquipmentManager {
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
        this.bonePrefix = 'mixamorig';

        // Slot board definition (slots are an editor concept; the data is a plain array)
        this.slots = [
            { id: 'mainHand', label: 'Main Hand' },
            { id: 'offHand',  label: 'Off Hand' },
            { id: 'head',     label: 'Head' },
            { id: 'chest',    label: 'Chest' },
            { id: 'back',     label: 'Back' },
            { id: 'legs',     label: 'Legs' },
            { id: 'feet',     label: 'Feet' }
        ];
        this._persistTimer = null;
    }

    /**
     * Initialize equipment editor capabilities
     */
    init() {
        document.body.addEventListener('renderGraphicsObject', this.handleLoadEvent.bind(this));
        document.body.addEventListener('sceneUpdated', this.maintainBoneAttachments.bind(this));
    }

    /**
     * Handle load event to detect equipment data
     */
    handleLoadEvent(event) {
        const { data, propertyName } = event.detail;
        if (propertyName === 'render' && data) {
            this.renderData = data;
            this.equipmentData = data.equipment || [];
            // Wait for the scene to be fully rendered before loading equipment
            setTimeout(() => {
                this.findCharacterBones();
                if (this.equipmentData.length > 0) {
                    this.loadEquipmentModels();
                }
                this.renderBoard();
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

        this.graphicsEditor.rootGroup.traverse(object => {
            if (object.isBone) {
                this.characterBones.set(object.name.replace(this.bonePrefix, ''), object);
                this.attachmentBones.set(object.name.replace(this.bonePrefix, ''), object);
            }
            if (object.userData && object.userData.isGLTFRoot && object.userData.skeleton) {
                object.userData.skeleton.bones.forEach(bone => {
                    this.characterBones.set(bone.name.replace(this.bonePrefix, ''), bone);
                    this.attachmentBones.set(bone.name.replace(this.bonePrefix, ''), bone);
                });
            }
        });
    }

    /**
     * Load equipment models
     */
    async loadEquipmentModels() {
        this.equipmentModels.clear();
        this.findCharacterBones();
        for (let i = 0; i < this.equipmentData.length; i++) {
            await this.loadSingleEquipmentModel(this.equipmentData[i], i);
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

            const equipmentGroup = await this.graphicsEditor.shapeFactory.createGroupFromJSON(
                `equipment_${index}`,
                itemData.render.model.main
            );

            if (equipmentGroup) {
                equipmentGroup.userData.isEquipment = true;
                equipmentGroup.userData.equipmentIndex = index;
                equipmentGroup.userData.equipmentItem = equipment.item;

                this.applyAttachmentData(equipmentGroup, equipment.attachmentData);

                const bone = this.findAttachmentBone(equipment);
                if (bone) {
                    bone.add(equipmentGroup);
                } else {
                    console.warn(`No suitable bone found for equipment ${equipment.item}, adding to root`);
                    this.graphicsEditor.rootGroup.add(equipmentGroup);
                }

                this.equipmentModels.set(index, { model: equipmentGroup, equipment: equipment, bone: bone });
            }
        } catch (error) {
            console.error(`Error loading equipment model for ${equipment.item}:`, error);
        }
    }

    /**
     * Find attachment bone for equipment with fallback logic
     */
    findAttachmentBone(equipment) {
        const specifiedBone = equipment.attachmentData?.bone;
        if (specifiedBone && this.characterBones.has(specifiedBone)) {
            return this.characterBones.get(specifiedBone);
        }

        const fallbackBones = {
            'mainHand': ['RightHand', 'Hand_R', 'hand_R', 'R_Hand', 'hand.R', 'RightHand_End', 'RHand', 'right_hand', 'HandR'],
            'offHand':  ['LeftHand', 'Hand_L', 'hand_L', 'L_Hand', 'hand.L', 'LeftHand_End', 'LHand', 'left_hand', 'HandL'],
            'head':     ['Head', 'head', 'Head_M', 'head_end', 'Head_End', 'HeadTop_End', 'neck_01', 'Neck', 'neck'],
            'chest':    ['Spine2', 'spine2', 'Chest', 'chest', 'spine_02', 'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'],
            'back':     ['Spine2', 'spine2', 'Chest', 'chest', 'spine_02', 'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'],
            'legs':     ['Hips', 'hips', 'Pelvis', 'pelvis', 'spine_01', 'Spine_01', 'UpperLeg_R', 'RightUpLeg'],
            'feet':     ['RightFoot', 'Foot_R', 'foot_R', 'LeftFoot', 'Foot_L', 'foot_L'],
            'waist':    ['Spine', 'spine', 'Hips', 'hips', 'pelvis', 'Pelvis', 'spine_01', 'Spine_01', 'Root', 'root']
        };

        const possibleBones = fallbackBones[equipment.slot] || [];
        for (const boneName of possibleBones) {
            if (this.characterBones.has(boneName)) {
                return this.characterBones.get(boneName);
            }
        }

        for (const [boneName, bone] of this.characterBones) {
            const lowerBoneName = boneName.toLowerCase();
            const lowerSlot = equipment.slot.toLowerCase();
            if (lowerBoneName.includes(lowerSlot) ||
                lowerSlot.includes(lowerBoneName.replace(/[_\-\.]/g, ''))) {
                return bone;
            }
        }

        console.warn(`No suitable bone found for equipment slot: ${equipment.slot}`);
        return null;
    }

    /**
     * Apply attachment data (bone-local offset / rotation-in-degrees / scale)
     */
    applyAttachmentData(equipmentModel, attachmentData) {
        if (!attachmentData) return;
        if (attachmentData.offset) {
            equipmentModel.position.set(
                attachmentData.offset.x || 0,
                attachmentData.offset.y || 0,
                attachmentData.offset.z || 0
            );
        }
        if (attachmentData.rotation) {
            equipmentModel.rotation.set(
                (attachmentData.rotation.x || 0) * Math.PI / 180,
                (attachmentData.rotation.y || 0) * Math.PI / 180,
                (attachmentData.rotation.z || 0) * Math.PI / 180
            );
        }
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
        this.findCharacterBones();
        this.equipmentModels.forEach((equipmentData) => {
            const { model, equipment } = equipmentData;
            const expectedBone = this.findAttachmentBone(equipment);
            if (expectedBone && model.parent !== expectedBone) {
                if (model.parent) model.parent.remove(model);
                expectedBone.add(model);
                equipmentData.bone = expectedBone;
            }
        });
    }

    /**
     * Highlight selected equipment in scene
     */
    highlightSelectedEquipment() {
        this.equipmentModels.forEach((equipmentData) => {
            equipmentData.model.traverse(child => {
                if (child.isMesh && child.material && child.material.emissive) {
                    child.material.emissive.setHex(0x000000);
                }
            });
        });
        if (this.selectedEquipmentIndex >= 0) {
            const selected = this.equipmentModels.get(this.selectedEquipmentIndex);
            if (selected) {
                selected.model.traverse(child => {
                    if (child.isMesh && child.material && child.material.emissive) {
                        child.material.emissive.setHex(0x444444);
                    }
                });
            }
        }
    }

    /**
     * Mirror equipment into the render data and persist (debounced) through the
     * module save flow, so equipment edits reach disk without a separate action.
     */
    persistEquipment() {
        if (!this.renderData) return;
        this.renderData.equipment = this.equipmentData;
        if (this._persistTimer) clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            try { this.graphicsEditor.handleSave(true); } catch (e) { console.warn('equipment persist failed', e); }
        }, 800);
    }

    /** Legacy-compatible mirror (kept for callers; no scene rebuild needed). */
    saveEquipmentData() {
        this.persistEquipment();
    }

    /**
     * Clear all equipment (called by GE_SceneRenderer on every object load)
     */
    clearAllEquipment() {
        this.equipmentModels.forEach((equipmentData) => {
            const { model } = equipmentData;
            if (model && model.parent) model.parent.remove(model);
        });
        this.equipmentModels.clear();
        this.equipmentData = [];
        this.selectedEquipmentIndex = -1;
        this.renderBoard();
    }

    // =========================================================================
    // UI — slot board (#equipment-root)
    // =========================================================================

    _root() { return document.getElementById('equipment-root'); }

    /** Items that can be equipped (must have a render model). */
    _equippableItems() {
        const items = this.gameEditor.getCollections().items || {};
        return Object.keys(items)
            .filter(id => items[id] && items[id].render && items[id].render.model)
            .sort()
            .map(id => ({ id, title: items[id].title || id }));
    }

    _entriesForSlot(slotId) {
        const out = [];
        this.equipmentData.forEach((e, index) => { if (e.slot === slotId) out.push({ entry: e, index }); });
        return out;
    }

    renderBoard() {
        const root = this._root();
        if (!root) return;
        root.innerHTML = '';
        const items = this._equippableItems();

        this.slots.forEach(slot => {
            const entries = this._entriesForSlot(slot.id);
            if (entries.length === 0) {
                root.appendChild(this._buildRow(slot, null, -1, items));
            } else {
                entries.forEach(({ entry, index }) => root.appendChild(this._buildRow(slot, entry, index, items)));
            }
        });
    }

    _buildRow(slot, entry, index, items) {
        const wrap = document.createElement('div');
        wrap.className = 'ge-eq__slot' + (entry ? ' ge-eq__slot--occupied' : '') +
            (index >= 0 && index === this.selectedEquipmentIndex ? ' ge-eq__slot--selected' : '');

        const row = document.createElement('div');
        row.className = 'ge-eq__row';

        const label = document.createElement('span');
        label.className = 'ge-eq__label';
        label.textContent = slot.label;

        const select = document.createElement('select');
        select.className = 'ge-eq__item';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— empty —';
        select.appendChild(empty);
        items.forEach(it => {
            const o = document.createElement('option');
            o.value = it.id;
            o.textContent = it.title;
            if (entry && entry.item === it.id) o.selected = true;
            select.appendChild(o);
        });
        select.addEventListener('change', () => this._onSlotChange(slot.id, index, select.value));
        select.addEventListener('click', (e) => e.stopPropagation());

        row.append(label, select);

        // Unresolved-bone warning (only shown when attachment failed)
        if (entry && !this.findAttachmentBone(entry)) {
            const warn = document.createElement('span');
            warn.className = 'ge-eq__warn';
            warn.title = 'No bone found — item is not following the skeleton. Pick a bone below.';
            warn.textContent = '!';
            row.appendChild(warn);
        }

        wrap.appendChild(row);

        if (entry) {
            row.addEventListener('click', () => this.selectEquipment(index === this.selectedEquipmentIndex ? -1 : index));
            if (index === this.selectedEquipmentIndex) {
                wrap.appendChild(this._buildAttachmentEditor(entry, index));
            }
        }
        return wrap;
    }

    _buildAttachmentEditor(entry, index) {
        const ed = document.createElement('div');
        ed.className = 'ge-eq__editor';
        entry.attachmentData = entry.attachmentData || { bone: '', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
        const ad = entry.attachmentData;

        // Bone row (Auto-detect shows what it resolved to)
        const boneRow = document.createElement('div');
        boneRow.className = 'ge-eq__edrow';
        const boneLabel = document.createElement('label');
        boneLabel.textContent = 'Bone';
        const boneSel = document.createElement('select');
        const auto = document.createElement('option');
        auto.value = '';
        const resolved = this.findAttachmentBone(entry);
        auto.textContent = 'Auto' + (resolved && !ad.bone ? ` (${resolved.name.replace(this.bonePrefix, '')})` : '');
        boneSel.appendChild(auto);
        Array.from(this.characterBones.keys()).sort().forEach(name => {
            const o = document.createElement('option');
            o.value = name;
            o.textContent = name;
            if (ad.bone === name) o.selected = true;
            boneSel.appendChild(o);
        });
        boneSel.addEventListener('change', () => {
            ad.bone = boneSel.value;
            this._reattach(index);
            this.persistEquipment();
            this.renderBoard();
        });
        boneRow.append(boneLabel, boneSel);
        ed.appendChild(boneRow);

        // Offset / rotation triplets
        ed.appendChild(this._tripletRow('Offset', ad.offset, 0.1, index));
        ed.appendChild(this._tripletRow('Rotation°', ad.rotation, 1, index));
        return ed;
    }

    _tripletRow(labelText, vec, step, index) {
        const row = document.createElement('div');
        row.className = 'ge-eq__edrow';
        const label = document.createElement('label');
        label.textContent = labelText;
        row.appendChild(label);
        const wrap = document.createElement('div');
        wrap.className = 'ge-eq__triplet';
        ['x', 'y', 'z'].forEach(axis => {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = String(step);
            input.value = vec[axis] || 0;
            input.title = axis.toUpperCase();
            input.addEventListener('input', () => {
                vec[axis] = parseFloat(input.value) || 0;
                const rec = this.equipmentModels.get(index);
                if (rec) this.applyAttachmentData(rec.model, this.equipmentData[index].attachmentData);
                this.persistEquipment();
            });
            wrap.appendChild(input);
        });
        row.appendChild(wrap);
        return row;
    }

    /** Detach + re-resolve the bone for one equipment entry. */
    _reattach(index) {
        const rec = this.equipmentModels.get(index);
        const entry = this.equipmentData[index];
        if (!rec || !entry) return;
        if (rec.model.parent) rec.model.parent.remove(rec.model);
        const bone = this.findAttachmentBone(entry);
        if (bone) bone.add(rec.model);
        else this.graphicsEditor.rootGroup.add(rec.model);
        rec.bone = bone;
    }

    /** Slot dropdown changed: equip / swap / unequip. */
    async _onSlotChange(slotId, index, itemId) {
        if (index >= 0 && !itemId) {
            this._removeAt(index);                    // unequip
        } else if (index >= 0 && itemId) {
            // swap item, keep slot + attachment settings
            const entry = this.equipmentData[index];
            const rec = this.equipmentModels.get(index);
            if (rec && rec.model.parent) rec.model.parent.remove(rec.model);
            this.equipmentModels.delete(index);
            entry.item = itemId;
            await this.loadSingleEquipmentModel(entry, index);
            this.selectEquipment(index);
        } else if (itemId) {
            // equip into an empty slot
            const entry = { slot: slotId, item: itemId, attachmentData: { bone: '', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } };
            this.equipmentData.push(entry);
            const newIndex = this.equipmentData.length - 1;
            await this.loadSingleEquipmentModel(entry, newIndex);
            this.selectEquipment(newIndex);
        }
        this.persistEquipment();
        this.renderBoard();
    }

    _removeAt(index) {
        const rec = this.equipmentModels.get(index);
        if (rec && rec.model.parent) rec.model.parent.remove(rec.model);
        this.equipmentData.splice(index, 1);
        // Re-key the model map to match shifted indices
        const rebuilt = new Map();
        this.equipmentModels.forEach((data, i) => {
            if (i < index) rebuilt.set(i, data);
            else if (i > index) rebuilt.set(i - 1, data);
        });
        this.equipmentModels = rebuilt;
        if (this.selectedEquipmentIndex === index) this.selectedEquipmentIndex = -1;
        else if (this.selectedEquipmentIndex > index) this.selectedEquipmentIndex--;
    }

    /** Select an equipment entry (expands its inline attachment editor). */
    selectEquipment(index) {
        this.selectedEquipmentIndex = index;
        this.highlightSelectedEquipment();
        this.renderBoard();
    }

    /**
     * Debug method to log bone hierarchy
     */
    debugBoneHierarchy() {
        console.log('=== Bone Hierarchy Debug ===');
        this.characterBones.forEach((bone, name) => {
            console.log(`Bone: ${name}`, bone.position, bone.parent ? bone.parent.name : 'None');
        });
        this.equipmentModels.forEach((equipmentData, index) => {
            const { model, equipment, bone } = equipmentData;
            console.log(`Equipment ${index}: ${equipment.item} slot=${equipment.slot} bone=${bone ? bone.name : 'None'} parent=${model.parent ? model.parent.name : 'None'}`);
        });
    }
}
