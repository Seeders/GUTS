class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.shapeFactory = graphicsEditor.shapeFactory;
        this.originalMaterials = new Map();
        this.originalScale = new window.THREE.Vector3(1, 1, 1); // Store original scale
        this.originalPosition = new window.THREE.Vector3(0, 0, 0); // Store original position
    }    

    init() {   
        this.graphicsEditor.refreshShapes(false);
        this.initEventListeners();

    }
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this),
            'scale-all': this.scaleAllShapes.bind(this),
            'move-all': this.moveAllShapes.bind(this),
            'rotate-all': this.rotateAllShapes.bind(this), // New button for group rotation
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
    

    selectShape(index) {
        if(this.graphicsEditor.animationManager.isPreviewingAnimation){
            this.graphicsEditor.setPreviewAnimationState(false);
        }
        this.graphicsEditor.state.selectedShapeIndex = (this.graphicsEditor.state.selectedShapeIndex === index) ? -1 : index;
        this.updateShapeList();
        this.highlightSelectedShape();
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
        this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.push(newShape);
        this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length - 1;
        this.graphicsEditor.refreshShapes(true);
    }

    addSelectedShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const originalShape = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex];
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        } else {
            this.addNewShape();
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

    scaleAllShapes() {
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        if (currentShapes.length === 0) return;
        
        // Store the original scale of the rootGroup
        this.originalScale.copy(this.graphicsEditor.rootGroup.scale);
        
        const inspector = document.getElementById('inspector');
        inspector.className = 'inspector';
        inspector.innerHTML = `
            <h2>Scale All Shapes</h2>
            <div class="form-row">
                <label>Scale Factor:</label>
                <input type="number" id="scale-factor" step="0.1" min="0.1" value="1.0">
            </div>
            <div class="button-row">
                <button id="scale-apply">Apply</button>
                <button id="scale-reset">Reset</button>
                <button id="scale-cancel">Cancel</button>
            </div>
        `;
        
        // Add event listener for live preview
        document.getElementById('scale-factor').addEventListener('input', this.updateScalePreview.bind(this));
        
        // Reset button
        document.getElementById('scale-reset').addEventListener('click', () => {
            document.getElementById('scale-factor').value = '1.0';
            this.graphicsEditor.rootGroup.scale.copy(this.originalScale);
        });
        
        // Apply button
        document.getElementById('scale-apply').addEventListener('click', this.applyScaleToShapes.bind(this));
        
        // Cancel button
        document.getElementById('scale-cancel').addEventListener('click', () => {
            // Restore original scale
            this.graphicsEditor.rootGroup.scale.copy(this.originalScale);
            inspector.innerHTML = '';
        });
    }
    
    updateScalePreview() {
        const scaleFactor = parseFloat(document.getElementById('scale-factor').value);
        if (!isNaN(scaleFactor) && scaleFactor > 0) {
            // Apply scale to rootGroup for preview
            this.graphicsEditor.rootGroup.scale.set(
                this.originalScale.x * scaleFactor,
                this.originalScale.y * scaleFactor,
                this.originalScale.z * scaleFactor
            );
        }
    }
    
    applyScaleToShapes() {
        const scaleFactor = parseFloat(document.getElementById('scale-factor').value);
        if (isNaN(scaleFactor) || scaleFactor <= 0) {
            alert("Please enter a valid positive number");
            return;
        }
        
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        let centerX = 0, centerY = 0, centerZ = 0;
        
        // Calculate center point
        currentShapes.forEach(shape => {
            centerX += shape.x || 0;
            centerY += shape.y || 0;
            centerZ += shape.z || 0;
        });
        centerX /= currentShapes.length;
        centerY /= currentShapes.length;
        centerZ /= currentShapes.length;
        
        // Apply scaling to each shape's data
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
        
        // Reset rootGroup scale back to original
        this.graphicsEditor.rootGroup.scale.copy(this.originalScale);
        
        // Refresh shapes with the new data
        this.graphicsEditor.refreshShapes(true);
        
        // Clear the inspector
        document.getElementById('inspector').innerHTML = '';
    }

    moveAllShapes() {
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        if (currentShapes.length === 0) return;
        
        // Store the original position of the rootGroup
        this.originalPosition.copy(this.graphicsEditor.rootGroup.position);
        
        const inspector = document.getElementById('inspector');
        inspector.className = 'inspector';
        inspector.innerHTML = `
            <h2>Move All Shapes</h2>
            <div class="form-row">
                <label>X Offset:</label>
                <input type="number" id="move-x" step="0.5" value="0">
            </div>
            <div class="form-row">
                <label>Y Offset:</label>
                <input type="number" id="move-y" step="0.5" value="0">
            </div>
            <div class="form-row">
                <label>Z Offset:</label>
                <input type="number" id="move-z" step="0.5" value="0">
            </div>
            <div class="button-row">
                <button id="move-apply">Apply</button>
                <button id="move-reset">Reset</button>
                <button id="move-cancel">Cancel</button>
            </div>
        `;
        
        // Add event listeners for live preview
        document.getElementById('move-x').addEventListener('input', this.updateMovePreview.bind(this));
        document.getElementById('move-y').addEventListener('input', this.updateMovePreview.bind(this));
        document.getElementById('move-z').addEventListener('input', this.updateMovePreview.bind(this));
        
        // Reset button
        document.getElementById('move-reset').addEventListener('click', () => {
            document.getElementById('move-x').value = '0';
            document.getElementById('move-y').value = '0';
            document.getElementById('move-z').value = '0';
            this.graphicsEditor.rootGroup.position.copy(this.originalPosition);
        });
        
        // Apply button
        document.getElementById('move-apply').addEventListener('click', this.applyMoveToShapes.bind(this));
        
        // Cancel button
        document.getElementById('move-cancel').addEventListener('click', () => {
            // Restore original position
            this.graphicsEditor.rootGroup.position.copy(this.originalPosition);
            inspector.innerHTML = '';
        });
    }
    
    updateMovePreview() {
        const xOffset = parseFloat(document.getElementById('move-x').value) || 0;
        const yOffset = parseFloat(document.getElementById('move-y').value) || 0;
        const zOffset = parseFloat(document.getElementById('move-z').value) || 0;
        
        // Apply position offset to rootGroup for preview
        this.graphicsEditor.rootGroup.position.set(
            this.originalPosition.x + xOffset,
            this.originalPosition.y + yOffset,
            this.originalPosition.z + zOffset
        );
    }
    
    applyMoveToShapes() {
        const xOffset = parseFloat(document.getElementById('move-x').value) || 0;
        const yOffset = parseFloat(document.getElementById('move-y').value) || 0;
        const zOffset = parseFloat(document.getElementById('move-z').value) || 0;
        
        // Apply the offset to all shapes
        const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;
        currentShapes.forEach(shape => {
            shape.x = (shape.x || 0) + xOffset;
            shape.y = (shape.y || 0) + yOffset;
            shape.z = (shape.z || 0) + zOffset;
        });
        
        // Reset rootGroup position back to original
        this.graphicsEditor.rootGroup.position.copy(this.originalPosition);
        
        // Refresh shapes with the new data
        this.graphicsEditor.refreshShapes(true);
        
        // Clear the inspector
        document.getElementById('inspector').innerHTML = '';
    }  

    rotateAllShapes() {
        // Make sure frameRotations is initialized
        if (!this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation]) {
            this.graphicsEditor.initFrameRotations();
        }
        
        // Get current frame rotation
        const frameRotation = this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
        
        const inspector = document.getElementById('inspector');
        inspector.className = 'inspector';
        inspector.innerHTML = `
            <h2>Rotate Current Frame</h2>
            <div class="form-row">
                <label>X Rotation:</label>
                <input type="number" id="group-rotate-x" step="1" value="${this.graphicsEditor.rotationUtils.radToDeg(frameRotation.x)}">
            </div>
            <div class="form-row">
                <label>Y Rotation:</label>
                <input type="number" id="group-rotate-y" step="1" value="${this.graphicsEditor.rotationUtils.radToDeg(frameRotation.y)}">
            </div>
            <div class="form-row">
                <label>Z Rotation:</label>
                <input type="number" id="group-rotate-z" step="1" value="${this.graphicsEditor.rotationUtils.radToDeg(frameRotation.z)}">
            </div>
            <div class="button-row">
                <button id="group-rotate-reset">Reset</button>
                <button id="group-rotate-apply">Apply</button>
                <button id="group-rotate-cancel">Cancel</button>
            </div>
        `;
        
        
        // Add event listeners
        document.getElementById('group-rotate-x').addEventListener('input', this.updateRotatePreview.bind(this));
        document.getElementById('group-rotate-y').addEventListener('input', this.updateRotatePreview.bind(this));
        document.getElementById('group-rotate-z').addEventListener('input', this.updateRotatePreview.bind(this));
        
        document.getElementById('group-rotate-reset').addEventListener('click', () => {
            // Reset just the current frame rotation
            this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame] = { x: 0, y: 0, z: 0 };
            this.graphicsEditor.rootGroup.rotation.set(0, 0, 0);
            this.rotateAllShapes();
        });
        
        document.getElementById('group-rotate-apply').addEventListener('click', () => {
            // Update the frame rotation with current values
            this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame] = {
                x: this.graphicsEditor.rotationUtils.degToRad(document.getElementById('group-rotate-x').value),
                y: this.graphicsEditor.rotationUtils.degToRad(document.getElementById('group-rotate-y').value),
                z: this.graphicsEditor.rotationUtils.degToRad(document.getElementById('group-rotate-z').value)
            };
            
            // Apply rotation to the root group
            const frameRotation = this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
            this.graphicsEditor.rootGroup.rotation.set(
                frameRotation.x,
                frameRotation.y,
                frameRotation.z
            );
            
            this.applyRotationToShapes();
        });
        
        document.getElementById('group-rotate-cancel').addEventListener('click', () => {
            // Restore original rotation
            const frameRotation = this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
            this.graphicsEditor.rootGroup.rotation.set(
                frameRotation.x,
                frameRotation.y,
                frameRotation.z
            );
            const inspector = document.getElementById('inspector');
            inspector.innerHTML = ``;
        });        
    }

    updateRotatePreview() {
        const xDeg = document.getElementById('group-rotate-x').value;
        const yDeg = document.getElementById('group-rotate-y').value;
        const zDeg = document.getElementById('group-rotate-z').value;
        
        // Update the rotation of the root group in real-time
        this.graphicsEditor.rootGroup.rotation.set(
            this.graphicsEditor.rotationUtils.degToRad(xDeg),
            this.graphicsEditor.rotationUtils.degToRad(yDeg),
            this.graphicsEditor.rotationUtils.degToRad(zDeg)
        );
    } 
    
    applyRotationToShapes() {
        let currentAnimation = this.graphicsEditor.state.currentAnimation;
        let currentFrame = this.graphicsEditor.state.currentFrame;
        const frameRotation = this.graphicsEditor.frameRotations[currentAnimation][currentFrame];
        
        // Skip if no rotation has been applied
        if (frameRotation.x === 0 && frameRotation.y === 0 && frameRotation.z === 0) {
            return;
        }
        
        // Create a rotation matrix from the current frame rotation
        const rotationMatrix = new window.THREE.Matrix4();
        rotationMatrix.makeRotationFromEuler(new window.THREE.Euler(
            frameRotation.x,
            frameRotation.y,
            frameRotation.z
        ));
        
        // Apply the rotation to each shape's position in the current frame only
        const currentShapes = this.graphicsEditor.state.renderData.animations[currentAnimation][currentFrame].shapes;
        const centerPoint = new window.THREE.Vector3(0, 0, 0);
        
        currentShapes.forEach(shape => {
            // Create a vector for the shape's position
            const position = new window.THREE.Vector3(
                shape.x || 0,
                shape.y || 0,
                shape.z || 0
            );
            
            // Apply rotation around the center
            position.sub(centerPoint); // Translate to origin
            position.applyMatrix4(rotationMatrix); // Apply rotation
            position.add(centerPoint); // Translate back
            
            // Update shape data
            shape.x = position.x;
            shape.y = position.y;
            shape.z = position.z;
            
            // Also update the rotation of the shape itself
            const rotation = new window.THREE.Euler(
                this.graphicsEditor.rotationUtils.degToRad(shape.rotationX || 0),
                this.graphicsEditor.rotationUtils.degToRad(shape.rotationY || 0),
                this.graphicsEditor.rotationUtils.degToRad(shape.rotationZ || 0)
            );
            
            // Apply group rotation to shape's own rotation
            const quaternion = new window.THREE.Quaternion().setFromEuler(rotation);
            const groupQuaternion = new window.THREE.Quaternion().setFromEuler(
                new window.THREE.Euler(frameRotation.x, frameRotation.y, frameRotation.z)
            );
            quaternion.premultiply(groupQuaternion);
            
            // Convert back to Euler angles
            const newRotation = new window.THREE.Euler().setFromQuaternion(quaternion);
            
            // Update shape rotation data
            shape.rotationX = this.graphicsEditor.rotationUtils.radToDeg(newRotation.x);
            shape.rotationY = this.graphicsEditor.rotationUtils.radToDeg(newRotation.y);
            shape.rotationZ = this.graphicsEditor.rotationUtils.radToDeg(newRotation.z);
        });
        
        // Reset the frame rotation after applying it to shapes
        this.graphicsEditor.frameRotations[currentAnimation][currentFrame] = { x: 0, y: 0, z: 0 };
        this.graphicsEditor.rootGroup.rotation.set(0, 0, 0);
        
        this.graphicsEditor.refreshShapes(true);
    }
}