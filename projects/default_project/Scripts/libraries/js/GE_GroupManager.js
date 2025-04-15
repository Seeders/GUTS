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
    }

    init() {
        document.getElementById('create-group').addEventListener('click', this.createGroup.bind(this));
        document.getElementById('delete-group').addEventListener('click', this.deleteGroup.bind(this));
        
       
        // Update the group list initially
        this.updateGroupList();
        
        // Initialize drag-and-drop
        this.initDragAndDrop();
    }

    // Initialize drag and drop functionality
    initDragAndDrop() {
        // Make group items drop targets
        const groupList = document.getElementById('group-list');
        groupList.addEventListener('dragover', this.handleDragOver.bind(this));
        groupList.addEventListener('drop', this.handleDrop.bind(this));
    }
    
    handleDragOver(e) {
        e.preventDefault(); // Allow drop
        e.dataTransfer.dropEffect = 'move';
        
        // Highlight the group being dragged over
        const groupItem = this.findGroupItemFromEvent(e);
        if (groupItem) {
            // Remove highlight from all groups
            document.querySelectorAll('.group-item').forEach(item => {
                item.classList.remove('drag-over');
            });
            
            // Add highlight to target group
            groupItem.classList.add('drag-over');
        }
    }
    
    handleDrop(e) {
        e.preventDefault();
        
        // Remove all drag-over highlights
        document.querySelectorAll('.group-item').forEach(item => {
            item.classList.remove('drag-over');
        });
        
        // Find the target group
        const groupItem = this.findGroupItemFromEvent(e);
        if (!groupItem) return;
        
        const targetGroup = groupItem.dataset.group;
        
        // Get the shape data from dataTransfer
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        
        try {
            const dragData = JSON.parse(data);
            const { shapeIndex, sourceGroup } = dragData;
            
            // Don't move if source and target are the same
            if (sourceGroup === targetGroup) return;
            
            // Move the shape to the target group
            this.moveToGroup(parseInt(shapeIndex), sourceGroup, targetGroup);
        } catch (err) {
            console.error('Error processing drop:', err);
        }
    }
    
    findGroupItemFromEvent(e) {
        let target = e.target;
        // Traverse up to find the group-item
        while (target && !target.classList.contains('group-item')) {
            target = target.parentElement;
            if (!target || target === document.body) return null;
        }
        return target;
    }

    // Create a new group at the frame level
    createGroup() {
        const groupName = prompt("Enter group name:", "group_" + Date.now());
        if (!groupName || groupName === "shapes") {
            alert("Invalid group name or 'shapes' is reserved");
            return;
        }

        const currentFrame = this.graphicsEditor.state.currentFrame;
        
        // Ensure we have current frame data
        if (!this.graphicsEditor.getCurrentFrame()) {
            this.graphicsEditor.getCurrentAnimation()[currentFrame] = {};
        }
        
        // Switch selection to the new group
        this.graphicsEditor.state.currentGroup = groupName;
        // Initialize group if it doesn't exist
        if (!this.graphicsEditor.getCurrentGroup()) {
            // Using JSON parse/stringify for deep copying
            this.graphicsEditor.getCurrentFrame()[groupName] = JSON.parse(JSON.stringify(this.DEFAULT_GROUP));
        }
        
        
        // Refresh UI
        this.graphicsEditor.uiManager.updateList();
        this.graphicsEditor.refreshShapes(true);
    }

    // Move an object from one group to another
    moveToGroup(shapeIndex, fromGroupName, toGroupName) {
        const currentFrameData = this.graphicsEditor.getCurrentFrame();
        
        // Find the shape in the source group
        const sourceGroup = currentFrameData[fromGroupName];
        if (!sourceGroup) {
            console.warn(`Source group ${fromGroupName} not found`);
            return;
        }
        
        // Find the shape
        const shapeToMove = sourceGroup[fromGroupName][shapeIndex];
        if (!shapeToMove) {
            console.warn(`Shape at index ${shapeIndex} not found in ${fromGroupName}`);
            return;
        }
        
        // Remove from source group
        sourceGroup[fromGroupName].splice(shapeIndex, 1);
        
        // Ensure target group exists
        if (!currentFrameData[toGroupName]) {
            currentFrameData[toGroupName] = this.DEFAULT_GROUP;
        }
        
        // Add to target group
        currentFrameData[toGroupName].shapes.push(shapeToMove);
        
        // Clear selection
        this.graphicsEditor.state.selectedShapeIndex = -1;
        
        // Update UI
        this.graphicsEditor.refreshShapes(true);
    }

    getGroupData(groupName){
        let groupData = this.graphicsEditor.getCurrentFrame()[groupName];
        if(!groupData){
            return this.graphicsEditor.state.renderData.model[groupName];
        }
        return groupData;
    }
    // Select a group to work with
    selectGroup(groupName) {
        if (!groupName) return;
        
        // Update the selected group name
        this.graphicsEditor.state.currentGroup = groupName;
        this.graphicsEditor.state.selectedShapeIndex = -1;
        let groupData = this.getGroupData(groupName);
        // Update the UI to show shapes in this group
        this.graphicsEditor.uiManager.updateList();
        this.graphicsEditor.shapeManager.highlightSelectedShape();
        this.graphicsEditor.uiManager.createGroupInspector(groupData);
        this.graphicsEditor.gizmoManager.transformSelectedObject(this.getGroupObject(groupName));
        
        // Update the selected class on group items
        this.updateSelectedGroupClass(groupName);
    }
    updateSelectedGroupClass(groupName) {
        // Remove selected class from all group items
        const groupItems = document.querySelectorAll('.group-item');
        groupItems.forEach(item => {
            item.classList.remove('selected');
        });
        
        // Add selected class to the newly selected group
        const selectedGroupItem = Array.from(groupItems).find(
            item => item.dataset.group === groupName
        );
        
        if (selectedGroupItem) {
            selectedGroupItem.classList.add('selected');
        }
    }
    // Remove a group and place its contents back in the shapes group
    deleteGroup() {
        
        const currentFrameData = this.graphicsEditor.getCurrentFrame();
        const currentGroup = this.graphicsEditor.getCurrentGroup();
        // Get shapes from the selected group
        const groupShapes = currentGroup.shapes;
        if (groupShapes.length > 0) {
            alert('Group must be empty to delete.');
            return;
        }
                        
        // Remove the group
        delete currentFrameData[this.graphicsEditor.state.currentGroup];
        
        // Reset selection to shapes group
        this.graphicsEditor.state.currentGroup = Object.keys(currentFrameData)[0];
        this.graphicsEditor.state.selectedShapeIndex = -1;
        
        // Update UI
        this.updateGroupList();
        this.graphicsEditor.refreshShapes(true);
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
    // Get all available groups in the current frame
    getGroups() {      
        return [...new Set([...Object.keys(this.graphicsEditor.getCurrentFrame()), ...Object.keys(this.graphicsEditor.state.renderData.model)])];
    }

    applyGroupTransform(groupName, position, rotation, scale) {
        // Get the current frame data
        const frameData = this.graphicsEditor.getCurrentFrame();
        
        // Ensure the group exists in the frame data
        if (!frameData[groupName]) {
            console.warn(`Group ${groupName} not found in frame data`);
            return;
        }
 
        // Save transformations to the group data
        frameData[groupName].position = {
            x: position.x,
            y: position.y,
            z: position.z
        };
        frameData[groupName].rotation = {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z
        };
        frameData[groupName].scale = {
            x: scale.x,
            y: scale.y,
            z: scale.z
        };
    
        // Refresh the scene to see changes
        this.graphicsEditor.refreshShapes(true);
    }
    // Update the group list in the UI
    updateGroupList() {
        const list = document.getElementById('group-list');
        if (!list) {
            console.warn("Group list element not found");
            return;
        }
        
        list.innerHTML = '';
        
        const groups = this.getGroups();
        for (const group of groups) {
            const groupItem = document.createElement('div');
            groupItem.classList.add('group-item');
            if (group === this.graphicsEditor.state.currentGroup) {
                groupItem.classList.add('selected');
            }
            
            groupItem.textContent = group;
            groupItem.addEventListener('click', () => this.selectGroup(group));
            
            // Make it a valid drop target for drag and drop
            groupItem.dataset.group = group;
            
            list.appendChild(groupItem);
        }
    }
}