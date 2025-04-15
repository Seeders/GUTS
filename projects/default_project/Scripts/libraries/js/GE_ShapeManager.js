class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.originalMaterials = new Map();
        
    }    

    init() {   
        this.initEventListeners();

    }
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this)
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });
        
        document.getElementById('move-cancel').addEventListener('click', () => {            
            const inspector = document.getElementById('inspector');
            inspector.innerHTML = ``;
        });
    }
    getShapeData(shapeId){
        let currentGroup = this.graphicsEditor.getCurrentGroup();
        currentGroup.shapes = currentGroup.shapes || [];
        let shapeData = (currentGroup.shapes).find(s => s.id == shapeId);
        if(this.graphicsEditor.state.editingModel){
            shapeData = currentGroup.shapes[shapeId];
        }
        return shapeData;
    }
    selectShape(index) {
        if (this.graphicsEditor.animationManager.isPreviewingAnimation) {
            this.graphicsEditor.setPreviewAnimationState(false);
        }
        
        // Toggle selection if clicking the same shape
        this.graphicsEditor.state.selectedShapeIndex = (this.graphicsEditor.state.selectedShapeIndex === index) ? -1 : index;

        // Update shape list and highlighting
        this.graphicsEditor.uiManager.updateList();
        this.highlightSelectedShape();
        
        // Show inspector for selected shape
        const shape = this.graphicsEditor.getMergedShape();
        if (shape) {
            this.graphicsEditor.createInspector(shape);
            this.graphicsEditor.gizmoManager.transformSelectedObject();
        } else {
            this.graphicsEditor.gizmoManager.destroyGizmo();
            this.graphicsEditor.groupManager.selectGroup(this.graphicsEditor.state.currentGroup);
        }
    }
    highlightSelectedShape() {
        // Remove existing outlines
        this.graphicsEditor.sceneRenderer.scene.children.forEach(obj => {
            if (obj.userData.isOutline) {
                this.graphicsEditor.sceneRenderer.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            }
        });
    
        // Reset any highlighted materials
        this.originalMaterials.forEach((material, object) => {
            object.material = material;
        });
        this.originalMaterials.clear();
    
        // If no shape is selected or invalid selection, return
        if (this.graphicsEditor.state.selectedShapeIndex < 0) {
            return;
        }
    
        // Get the selected group name from state
        const currentGroup = this.graphicsEditor.state.currentGroup;
        if (!currentGroup) {
            console.warn("No group selected");
            return;
        }
    
        // Find the THREE.Group with matching name under rootGroup
        let selectedGroup = null;
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (obj.isGroup && obj.name === currentGroup) {
                selectedGroup = obj;
            }
        });
    
        if (!selectedGroup) {
            console.warn(`No group found with name ${currentGroup}`);
            return;
        }
    
        const currentFrameData = this.graphicsEditor.getCurrentFrame();
    
        if (!currentFrameData) {
            console.warn("No frame data found");
            return;
        }
    
        const groupShapes = currentFrameData[currentGroup];
    
        if (!groupShapes || this.graphicsEditor.state.selectedShapeIndex >= groupShapes.length) {
            console.warn(`Invalid shape index ${this.graphicsEditor.state.selectedShapeIndex} for group ${currentGroup}`);
            return;
        }
    
        // Find all meshes belonging to the selected shape within the group
        const selectedMeshes = [];
        selectedGroup.traverse(obj => {
            if (obj.isMesh && (
                // Direct shape object that matches the index
                (obj.userData.isShape &&
                 obj.userData.index === this.graphicsEditor.state.selectedShapeIndex) ||
                // Parent is a shape object that matches the index
                (obj.parent &&
                 obj.parent.userData.isShape &&
                 obj.parent.userData.index === this.graphicsEditor.state.selectedShapeIndex) ||
                // GLTF child of selected shape that matches the index
                (obj.userData.isGLTFChild &&
                 obj.parent &&
                 obj.parent.userData.index === this.graphicsEditor.state.selectedShapeIndex)
            )) {
                selectedMeshes.push(obj);
            }
        });
    
        // Handle highlighting for all relevant meshes
        selectedMeshes.forEach(mesh => {
            // Apply emissive highlight to original mesh
            this.originalMaterials.set(mesh, mesh.material);
            const highlightMaterial = mesh.material.clone();
            highlightMaterial.emissive = new window.THREE.Color(0x555555);
            highlightMaterial.emissiveIntensity = 0.5;
            mesh.material = highlightMaterial;
    
            // Create the outline geometry
            const outlineGeometry = mesh.geometry.clone();
            const outlineMaterial = new window.THREE.MeshBasicMaterial({
                color: 0xffff00,
                side: window.THREE.BackSide
            });
    
            // Create the outline mesh
            const outline = new window.THREE.Mesh(outlineGeometry, outlineMaterial);
            outline.userData.isOutline = true;
            
            // Create a new group to hold the outline
            let outlineGroup = new window.THREE.Group();
            outlineGroup.userData.isOutline = true;
            
            // Add the outline to the group
            outlineGroup.add(outline);
            
            // Find all parent groups up to rootGroup and copy their transformations
            let currentParent = mesh.parent;
            let transformChain = [];
            
            while (currentParent && currentParent !== this.graphicsEditor.rootGroup) {
                transformChain.unshift({
                    position: currentParent.position.clone(),
                    rotation: currentParent.rotation.clone(),
                    scale: currentParent.scale.clone(),
                    quaternion: currentParent.quaternion.clone()
                });
                currentParent = currentParent.parent;
            }
            
            // Apply all parent transformations to our outline group
            transformChain.forEach(transform => {
                // Create a temporary group to apply each parent's transform
                const tempGroup = new window.THREE.Group();
                tempGroup.position.copy(transform.position);
                tempGroup.rotation.copy(transform.rotation);
                tempGroup.scale.copy(transform.scale);
                
                // Add our current group to this temp group
                tempGroup.add(outlineGroup);
                
                // Move outlineGroup up one level
                outlineGroup = tempGroup;
                outlineGroup.userData.isOutline = true;
            });
            
            // Add mesh's local transform
            outline.position.copy(mesh.position);
            outline.rotation.copy(mesh.rotation);
            outline.scale.copy(mesh.scale);
            
            // Scale the outline slightly larger (in local space)
            outline.scale.multiplyScalar(1.05);
            
            // Add the complete outline group to the scene
            this.graphicsEditor.sceneRenderer.scene.add(outlineGroup);
        });
    }
    addNewShape() {
        const newShape = {
            type: 'sphere',
            size: 2,
            color: '#ff0000',
            x: 0,
            y: 0,
            z: 0,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0
        };
        this.graphicsEditor.getCurrentGroup().shapes.push(newShape);
        this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.getCurrentGroup().shapes.length - 1;
        this.graphicsEditor.refreshShapes(true); 
    }

    addSelectedShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const originalShape = this.graphicsEditor.state.editingModel ? 
                                    this.graphicsEditor.getCurrentGroup().shapes[this.graphicsEditor.state.selectedShapeIndex] : 
                                    this.graphicsEditor.getCurrentGroup().shapes.find(s => s.id == this.graphicsEditor.state.selectedShapeIndex);
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.graphicsEditor.getCurrentGroup().shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.getCurrentGroup().shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        } else {
            this.addNewShape();
        }
    }

    deleteSelectedShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            this.graphicsEditor.getCurrentGroup().shapes.splice(this.graphicsEditor.state.selectedShapeIndex, 1);
            if (this.graphicsEditor.getCurrentGroup().shapes.length > 0) {
                this.graphicsEditor.state.selectedShapeIndex = Math.min(this.graphicsEditor.state.selectedShapeIndex, this.graphicsEditor.getCurrentGroup().shapes.length - 1);
            } else {
                this.graphicsEditor.state.selectedShapeIndex = -1;
            }
            this.graphicsEditor.refreshShapes(true);
        }
    }

}