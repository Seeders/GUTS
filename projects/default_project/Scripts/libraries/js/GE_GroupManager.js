class GE_GroupManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.DEFAULT_GROUP = {
            shapes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1.0, y: 1.0, z: 1.0 }
        };
        
        this.dragState = {
            isDragging: false,
            currentTarget: null
        };
    }

    // Initialization Methods
    init() {
        this.bindEventListeners();
        this.updateGroupList();
        this.initDragAndDrop();
    }

    bindEventListeners() {
        const createBtn = document.getElementById('create-group');
        const deleteBtn = document.getElementById('delete-group');
        
        if (createBtn) createBtn.addEventListener('click', () => this.createGroup());
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteGroup());
    }

    initDragAndDrop() {
        const groupList = document.getElementById('group-list');
        if (!groupList) return;

        groupList.addEventListener('dragover', (e) => this.handleDragOver(e));
        groupList.addEventListener('drop', (e) => this.handleDrop(e));
        groupList.addEventListener('dragleave', () => this.clearDragHighlights());
    }

    // Group Management Methods
    createGroup() {
        if (!this.canEditModel()) return;

        const groupName = prompt("Enter group name:", `group_${Date.now()}`);
        if (!groupName) return;

        this.initializeNewGroup(groupName);
        this.refreshUI();
    }

    initializeNewGroup(groupName) {
        const currentFrame = this.graphicsEditor.state.currentFrame;
        const currentAnimation = this.graphicsEditor.getCurrentAnimation();

        if (!this.graphicsEditor.getCurrentFrame()) {
            currentAnimation[currentFrame] = {};
        }

        this.graphicsEditor.state.currentGroup = groupName;

        if (!this.graphicsEditor.getCurrentGroup()) {
            this.graphicsEditor.getCurrentFrame()[groupName] = 
                JSON.parse(JSON.stringify(this.DEFAULT_GROUP));
        }
    }

    deleteGroup() {
        if (!this.canEditModel()) return;

        const currentGroup = this.graphicsEditor.getCurrentGroup();
        if (!this.isGroupEmptyAndDeletable(currentGroup)) return;

        this.removeCurrentGroup();
        this.resetGroupSelection();
        this.refreshUI();
    }

    moveToGroup(shapeIndex, fromGroupName, toGroupName) {
        if (!this.canEditModel()) return;

        const frameData = this.graphicsEditor.getCurrentFrame();
        const sourceGroup = frameData[fromGroupName];
        const shape = this.getShapeFromGroup(sourceGroup, shapeIndex, fromGroupName);
        
        if (!shape) return;

        this.transferShape(shape, sourceGroup, toGroupName, frameData);
        this.resetShapeSelection();
        this.refreshUI();
    }

    // Group Selection and Data Methods
    selectGroup(groupName) {
        if (!groupName) return;

        this.updateGroupSelection(groupName);
        this.updateGroupUI(groupName);
    }
    updateGroupSelection(groupName) {
        // Update the current group in graphics editor state
        this.graphicsEditor.state.currentGroup = groupName;
        
        // Reset shape selection when changing groups
        this.graphicsEditor.state.selectedShapeIndex = -1;
        
        // Update UI to reflect new selection
        this.updateSelectedGroupClass(groupName);
        
        // If group has a corresponding THREE.js object, update transform controls
        const groupObject = this.getGroupObject(groupName);
        if (groupObject) {
            this.graphicsEditor.gizmoManager.transformSelectedObject(groupObject);
        }
    }
    
    updateGroupUI(groupName) {
        const groupData = this.getGroupData(groupName);
        if (!groupData) return;
        
        // Update shape list and inspector
        this.graphicsEditor.uiManager.updateList();
        this.graphicsEditor.shapeManager.highlightSelectedShape();
        
        // Update transform controls if needed
        const groupObject = this.getGroupObject(groupName);
        if (groupObject) {
            this.graphicsEditor.gizmoManager.updateGizmoPosition();
        }
    }
    getGroupData(groupName) {
        return this.graphicsEditor.getCurrentFrame()[groupName] || 
               this.graphicsEditor.state.renderData.model[groupName];
    }

    getGroupObject(groupName) {
        let foundGroup = null;
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (obj.isGroup && obj.name === groupName && obj.userData.isGroup) {
                foundGroup = obj;
            }
        });
        return foundGroup;
    }

    // Transform Methods
    applyGroupTransform(groupName, position, rotation, scale) {
        const frameData = this.graphicsEditor.getCurrentFrame();
        if (!frameData[groupName]) {
            console.warn(`Group ${groupName} not found in frame data`);
            return;
        }

        this.updateGroupTransform(frameData[groupName], position, rotation, scale);
        this.graphicsEditor.refreshShapes(true);
    }

    // UI Update Methods
    updateGroupList() {
        const list = document.getElementById('group-list');
        if (!list) {
            console.warn("Group list element not found");
            return;
        }

        list.innerHTML = '';
        this.populateGroupList(list);
    }

    updateSelectedGroupClass(groupName) {
        const groupItems = document.querySelectorAll('.group-item');
        groupItems.forEach(item => item.classList.remove('selected'));

        const selectedItem = Array.from(groupItems)
            .find(item => item.dataset.group === groupName);
        
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
    }

    // Drag and Drop Handlers
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const groupItem = this.findGroupItemFromEvent(e);
        if (groupItem) {
            this.updateDragHighlight(groupItem);
        }
    }

    handleDrop(e) {
        e.preventDefault();
        this.clearDragHighlights();

        const dropData = this.processDropEvent(e);
        if (!dropData) return;

        this.moveToGroup(
            parseInt(dropData.shapeIndex), 
            dropData.sourceGroup, 
            dropData.targetGroup
        );
    }

    // Helper Methods
    canEditModel() {
        return this.graphicsEditor.state.editingModel;
    }

    findGroupItemFromEvent(e) {
        let target = e.target;
        while (target && !target.classList.contains('group-item')) {
            target = target.parentElement;
            if (!target || target === document.body) return null;
        }
        return target;
    }

    clearDragHighlights() {
        document.querySelectorAll('.group-item').forEach(item => {
            item.classList.remove('drag-over');
        });
    }

    updateDragHighlight(groupItem) {
        this.clearDragHighlights();
        if (groupItem) {
            groupItem.classList.add('drag-over');
        }
    }

    processDropEvent(e) {
        const groupItem = this.findGroupItemFromEvent(e);
        if (!groupItem) return null;

        const data = e.dataTransfer.getData('text/plain');
        if (!data) return null;

        try {
            const dragData = JSON.parse(data);
            return {
                ...dragData,
                targetGroup: groupItem.dataset.group
            };
        } catch (err) {
            console.error('Error processing drop:', err);
            return null;
        }
    }

    refreshUI() {
        this.graphicsEditor.uiManager.updateList();
        this.graphicsEditor.refreshShapes(true);
        this.updateGroupList();
    }

    updateGroupTransform(group, position, rotation, scale) {
        group.position = { ...position };
        group.rotation = { ...rotation };
        group.scale = { ...scale };
    }

    populateGroupList(list) {
        Object.keys(this.graphicsEditor.state.renderData.model).forEach(group => {
            const groupItem = this.createGroupListItem(group);
            list.appendChild(groupItem);
        });
    }

    createGroupListItem(groupName) {
        const item = document.createElement('div');
        item.classList.add('group-item');
        if (groupName === this.graphicsEditor.state.currentGroup) {
            item.classList.add('selected');
        }

        item.textContent = groupName;
        item.dataset.group = groupName;
        item.addEventListener('click', () => this.selectGroup(groupName));

        return item;
    }

    isGroupEmptyAndDeletable(groupName) {
        const group = this.getGroupData(groupName);
        if (!group) return false;
        
        if (group.shapes && group.shapes.length > 0) {
            alert('Cannot delete group that contains shapes');
            return false;
        }
        return true;
    }
    
    removeCurrentGroup() {
        const currentFrame = this.graphicsEditor.getCurrentFrame();
        if (!currentFrame) return;
        
        delete currentFrame[this.graphicsEditor.state.currentGroup];
    }
    
    resetGroupSelection() {
        const frameData = this.graphicsEditor.getCurrentFrame();
        const groups = Object.keys(frameData);
        this.graphicsEditor.state.currentGroup = groups[0] || null;
    }
    
    // Shape Management Methods
    getShapeFromGroup(group, shapeIndex, groupName) {
        if (!group || !group.shapes) {
            console.warn(`Invalid group or no shapes in group ${groupName}`);
            return null;
        }
        return group.shapes[shapeIndex];
    }
    
    transferShape(shape, sourceGroup, targetGroupName, frameData) {
        if (!shape || !sourceGroup || !targetGroupName || !frameData) return;
        
        // Remove from source group
        const shapeIndex = sourceGroup.shapes.indexOf(shape);
        if (shapeIndex !== -1) {
            sourceGroup.shapes.splice(shapeIndex, 1);
        }
        
        // Add to target group
        if (!frameData[targetGroupName]) {
            frameData[targetGroupName] = JSON.parse(JSON.stringify(this.DEFAULT_GROUP));
        }
        frameData[targetGroupName].shapes.push(shape);
    }
    
    resetShapeSelection() {
        this.graphicsEditor.state.selectedShapeIndex = -1;
    }
    
}