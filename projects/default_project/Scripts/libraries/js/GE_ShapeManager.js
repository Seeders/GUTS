class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.shapeFactory = graphicsEditor.shapeFactory;
        this.originalMaterials = new Map();
    }    

    init() {   
        this.graphicsEditor.refreshShapes(false);
        this.initEventListeners();

    }
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addNewShape.bind(this),
            'duplicate-shape': this.duplicateSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this),
            'scale-all': this.scaleAllShapes.bind(this),
            'rotate-all': this.rotateAllShapes.bind(this),
            'move-all': this.moveAllShapes.bind(this),
            'move-apply': this.applyMoveModal.bind(this)
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });
        
        document.getElementById('move-cancel').addEventListener('click', () => {
            document.getElementById('modal-moveAllShapes').classList.remove('show');
        });

    }
    

    selectShape(index) {
        if(this.graphicsEditor.animationManager.isPreviewingAnimation){
            this.graphicsEditor.setPreviewAnimationState(false);
        }
        this.graphicsEditor.state.selectedShapeIndex = (this.graphicsEditor.state.selectedShapeIndex === index) ? -1 : index;
        this.updateShapeList();
        this.highlightSelectedShape();
    }

    applyMoveModal() {
        const xOffset = parseFloat(document.getElementById('move-x').value) || 0;
        const yOffset = parseFloat(document.getElementById('move-y').value) || 0;
        const zOffset = parseFloat(document.getElementById('move-z').value) || 0;
        
        // Apply the offset to all shapes
        this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.forEach(shape => {
            shape.x = (shape.x || 0) + xOffset;
            shape.y = (shape.y || 0) + yOffset;
            shape.z = (shape.z || 0) + zOffset;
        });
        this.graphicsEditor.refreshShapes(true);
        
        // Hide the modal
        document.getElementById('modal-moveAllShapes').classList.remove('show');
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
        
        // If no shape is selected, return
        if (this.graphicsEditor.state.selectedShapeIndex < 0 || 
            this.graphicsEditor.state.selectedShapeIndex >= this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length) {
            return;
        }
    
        // Find all meshes belonging to the selected shape (including GLTF children)
        const selectedMeshes = [];
        this.graphicsEditor.sceneRenderer.scene.traverse(obj => {
            if (obj.isMesh && ((obj.userData.isShape && obj.userData.index === this.graphicsEditor.state.selectedShapeIndex) || 
                               (obj.parent && obj.parent.userData.isShape && obj.parent.userData.index === this.graphicsEditor.state.selectedShapeIndex) ||
                               (obj.userData.isGLTFChild && obj.parent && obj.parent.userData.index === this.graphicsEditor.state.selectedShapeIndex))) {
                selectedMeshes.push(obj);
            }
        });
    
        // Handle highlighting for all relevant meshes
        selectedMeshes.forEach(mesh => {
            // Store original material
            this.originalMaterials.set(mesh, mesh.material);
            
            // Create highlight material
            const highlightMaterial = mesh.material.clone();
            highlightMaterial.emissive = new window.THREE.Color(0x555555);
            highlightMaterial.emissiveIntensity = 0.5;
            mesh.material = highlightMaterial;
            
            // Create outline for each mesh component
            const outlineGeometry = mesh.geometry.clone();
            const outlineMaterial = new window.THREE.MeshBasicMaterial({ 
                color: 0xffff00,
                side: window.THREE.BackSide
            });
            
            const outline = new window.THREE.Mesh(outlineGeometry, outlineMaterial);
            outline.position.copy(mesh.position);
            outline.rotation.copy(mesh.rotation);
            outline.scale.copy(mesh.scale);
            outline.scale.multiplyScalar(1.05);
            outline.userData.isOutline = true;
            
            // Check if the mesh is a child of another object
           
            this.graphicsEditor.sceneRenderer.scene.add(outline);
        });
    }
    addNewShape() {
        const newShape = {
            type: 'gltf',            
            url: 'samples/models/Avocado/Avocado.gltf',
            size: 2,
            color: '#3498db',
            x: 0,
            y: 0,
            z: 0,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0
        };
        this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.push(newShape);
        this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length - 1;
        this.graphicsEditor.refreshShapes(true);
    }

    duplicateSelectedShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const originalShape = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex];
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        }
    }

    deleteSelectedShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.splice(this.graphicsEditor.state.selectedShapeIndex, 1);
            if (this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length > 0) {
                this.graphicsEditor.state.selectedShapeIndex = Math.min(this.graphicsEditor.state.selectedShapeIndex, this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length - 1);
            } else {
                this.graphicsEditor.state.selectedShapeIndex = -1;
            }
            this.graphicsEditor.refreshShapes(true);
        }
    }

    scaleAllShapes() {
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        if (currentShapes.length === 0) return;
        const scaleFactor = parseFloat(prompt("Enter scale factor (e.g. 2 for double size, 0.5 for half size):", "1"));
        if (isNaN(scaleFactor) || scaleFactor <= 0) {
            alert("Please enter a valid positive number");
            return;
        }
        let centerX = 0, centerY = 0, centerZ = 0;
        currentShapes.forEach(shape => {
            centerX += shape.x || 0;
            centerY += shape.y || 0;
            centerZ += shape.z || 0;
        });
        centerX /= currentShapes.length;
        centerY /= currentShapes.length;
        centerZ /= currentShapes.length;
        currentShapes.forEach(shape => {
            if (shape.size) shape.size *= scaleFactor;
            if (shape.width) shape.width *= scaleFactor;
            if (shape.height) shape.height *= scaleFactor;
            if (shape.depth) shape.depth *= scaleFactor;
            if (shape.tubeSize) shape.tubeSize *= scaleFactor;
            shape.x = centerX + ((shape.x || 0) - centerX) * scaleFactor;
            shape.y = centerY + ((shape.y || 0) - centerY) * scaleFactor;
            shape.z = centerZ + ((shape.z || 0) - centerZ) * scaleFactor;
        });
        this.graphicsEditor.refreshShapes(true);
    }

    rotateAllShapes() {
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        if (currentShapes.length === 0) return;

        // Get modal elements
        const rotateModal = document.getElementById('rotate-modal');
        const rotateAngleInput = document.getElementById('rotate-angle');
        const rotateAxisSelect = document.getElementById('rotate-axis');
        const rotateCancelBtn = document.getElementById('rotate-cancel');
        const rotateApplyBtn = document.getElementById('rotate-apply');

        // Reset inputs to default values
        rotateAngleInput.value = "0";
        rotateAxisSelect.value = "y"; // Default to Y-axis

        // Show the modal
        rotateModal.classList.add('show');

        // Cancel button handler
        rotateCancelBtn.onclick = () => {
            rotateModal.classList.remove('show');
        };

        // Apply button handler
        rotateApplyBtn.onclick = () => {
            const angleDeg = parseFloat(rotateAngleInput.value);
            if (isNaN(angleDeg)) {
                alert("Please enter a valid angle");
                return;
            }

            const axis = rotateAxisSelect.value;
            const angleRad = angleDeg * Math.PI / 180;

            // Calculate the center of all shapes in the current frame
            let centerX = 0, centerY = 0, centerZ = 0;
            currentShapes.forEach(shape => {
                centerX += shape.x || 0;
                centerY += shape.y || 0;
                centerZ += shape.z || 0;
            });
            centerX /= currentShapes.length;
            centerY /= currentShapes.length;
            centerZ /= currentShapes.length;

            // Rotate shapes around the group center by adjusting positions
            currentShapes.forEach(shape => {
                const x = shape.x || 0;
                const y = shape.y || 0;
                const z = shape.z || 0;

                // Translate to origin relative to center
                const relX = x - centerX;
                const relY = y - centerY;
                const relZ = z - centerZ;

                // Apply rotation around the chosen axis
                if (axis === 'x') {
                    // X-axis rotation (y-z plane)
                    const newRelY = relY * Math.cos(angleRad) - relZ * Math.sin(angleRad);
                    const newRelZ = relY * Math.sin(angleRad) + relZ * Math.cos(angleRad);
                    shape.y = centerY + newRelY;
                    shape.z = centerZ + newRelZ;
                    // x remains unchanged
                } else if (axis === 'y') {
                    // Y-axis rotation (x-z plane)
                    const newRelX = relX * Math.cos(angleRad) + relZ * Math.sin(angleRad);
                    const newRelZ = -relX * Math.sin(angleRad) + relZ * Math.cos(angleRad);
                    shape.x = centerX + newRelX;
                    shape.z = centerZ + newRelZ;
                    // y remains unchanged
                } else if (axis === 'z') {
                    // Z-axis rotation (x-y plane)
                    const newRelX = relX * Math.cos(angleRad) - relY * Math.sin(angleRad);
                    const newRelY = relX * Math.sin(angleRad) + relY * Math.cos(angleRad);
                    shape.x = centerX + newRelX;
                    shape.y = centerY + newRelY;
                    // z remains unchanged
                }
                // Individual rotations (rotationX, rotationY, rotationZ) are preserved
            });

            // Update the scene and hide the modal
            this.graphicsEditor.refreshShapes(true);
            rotateModal.classList.remove('show');
        };
    }

    moveAllShapes() {
        if (this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length === 0) return;
        document.getElementById('modal-moveAllShapes').classList.add('show');
        document.getElementById('move-x').value = '0';
        document.getElementById('move-y').value = '0';
        document.getElementById('move-z').value = '0';
    }

    
    degToRad(degrees) {
        return degrees * Math.PI / 180;
    }
    
    radToDeg(radians) {
        return Math.round(radians * 180 / Math.PI);
    }

    

    updateShapeList() {
        const shapeList = document.getElementById('shape-list');
        shapeList.innerHTML = '';
    
        // Animation selector
        const animSelector = document.createElement('select');
        animSelector.style.marginBottom = '10px';
        Object.keys(this.graphicsEditor.state.renderData.animations).forEach(anim => {
            const option = document.createElement('option');
            option.value = anim;
            option.textContent = anim;
            if (anim === this.graphicsEditor.state.currentAnimation) option.selected = true;
            animSelector.appendChild(option);
        });
        animSelector.addEventListener('change', () => {
            this.graphicsEditor.setPreviewAnimationState(false);
            this.graphicsEditor.state.currentAnimation = animSelector.value;
            this.graphicsEditor.state.currentFrame = 0;
            this.graphicsEditor.state.selectedShapeIndex = -1;
            
            this.graphicsEditor.refreshShapes(false);
        });
        shapeList.appendChild(animSelector);
    
        // Frame list
        const frameList = document.createElement('div');
        frameList.style.marginBottom = '10px';
        this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].forEach((frame, index) => {
            const frameItem = document.createElement('div');
            frameItem.textContent = `Frame ${index + 1}`;
            frameItem.style.padding = '5px';
            frameItem.style.cursor = 'pointer';
            if (index === this.graphicsEditor.state.currentFrame) frameItem.style.backgroundColor = '#555';
            frameItem.addEventListener('click', () => {
                this.graphicsEditor.setPreviewAnimationState(false);
                this.graphicsEditor.state.currentFrame = index;
                
                // Make sure frameRotations is initialized for the new frame
                if (!this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation] || 
                    !this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame]) {
                    this.graphicsEditor.initFrameRotations();
                }
                
                this.graphicsEditor.refreshShapes(false);
            });
            frameList.appendChild(frameItem);
        });
        shapeList.appendChild(frameList);
    
        // Shape list for current frame
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        if (currentShapes.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = 'No shapes in this frame.';
            emptyMessage.style.padding = '10px';
            emptyMessage.style.color = '#777';
            shapeList.appendChild(emptyMessage);
            document.getElementById('selected-shape').textContent = 'None';
            return;
        }
    
        currentShapes.forEach((shape, index) => {
            const shapeItem = document.createElement('div');
            shapeItem.className = 'shape-item';
            if (index === this.graphicsEditor.state.selectedShapeIndex) {
                shapeItem.classList.add('active');
                document.getElementById('selected-shape').textContent = `${shape.type} (${index})`;
            }
            const title = document.createElement('div');
            title.textContent = `${index + 1}. ${shape.name || shape.type} ${shape.color}`;
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '5px';
            shapeItem.appendChild(title);
            const position = document.createElement('div');
            position.textContent = `Position: X=${shape.x || 0}, Y=${shape.y || 0}, Z=${shape.z || 0}`;
            position.style.fontSize = '12px';
            shapeItem.appendChild(position);
            shapeItem.addEventListener('click', () => {
                this.selectShape(index);
                this.graphicsEditor.createInspector(shape);
            });
            shapeList.appendChild(shapeItem);
        });
    
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            let shape = currentShapes[this.graphicsEditor.state.selectedShapeIndex];
            if (shape) {
                this.graphicsEditor.createInspector(shape);
            } else {
                const inspector = document.getElementById('inspector');
                inspector.innerHTML = "";
                this.graphicsEditor.state.selectedShapeIndex = -1;
                this.graphicsEditor.refreshShapes(true);
            }
        }
    }

    applyJSON() {
        try {
            const newData = JSON.parse(document.getElementById('json-content').value);
            this.graphicsEditor.state.renderData = newData;
            this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.state.renderData.animations.idle[0].shapes.length > 0 ? 0 : -1;
            
            this.graphicsEditor.refreshShapes(true);
        } catch (error) {
            alert('Invalid JSON: ' + error.message);
        }
    }


}