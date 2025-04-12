class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.originalMaterials = new Map();
        this.originalScale = new window.THREE.Vector3(1, 1, 1);
        this.originalPosition = new window.THREE.Vector3(0, 0, 0);
        this.originalRotation = new window.THREE.Vector3(0, 0, 0);
        
        this.gizmoGroup = null;
        this.gizmoMode = "translate";
        this.selectedAxis = null;
        this.isDragging = false;
        this.raycaster = new window.THREE.Raycaster();
        this.mouse = new window.THREE.Vector2();
        this.lastMouse = new window.THREE.Vector2();
    }    

    init() {   
     //   this.graphicsEditor.refreshShapes(false);
        this.initEventListeners();

    }
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this),
            'scale-all': () => { this.gizmoMode = "scale"; this.transformGroup(this.getSelectedGroupOrRoot()); },
            'move-all': () => {  this.gizmoMode = "translate"; this.transformGroup(this.getSelectedGroupOrRoot()); },
            'rotate-all': () => {  this.gizmoMode = "rotate"; this.transformGroup(this.getSelectedGroupOrRoot()); }, // New button for group rotation
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });
        
        document.getElementById('move-cancel').addEventListener('click', () => {            
            const inspector = document.getElementById('inspector');
            inspector.innerHTML = ``;
        });

        const canvas = this.graphicsEditor.sceneRenderer.renderer.domElement;
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    }
     // Create the gizmo for translation, rotation, or scaling
     createGizmo() {
        if (this.gizmoGroup) {
            this.gizmoGroup.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.graphicsEditor.sceneRenderer.scene.remove(this.gizmoGroup);
            this.gizmoGroup = null;
        }
    
        this.gizmoGroup = new window.THREE.Group();
        this.graphicsEditor.sceneRenderer.scene.add(this.gizmoGroup);
    
        let center = new window.THREE.Vector3();
        let xOffset = 1, yOffset = 1, zOffset = 1;
    
        if (this.currentTransformTarget.children.length > 0) {
            const boundingBox = new window.THREE.Box3().setFromObject(this.currentTransformTarget);
            const size = new window.THREE.Vector3();
            if (!boundingBox.isEmpty() && isFinite(boundingBox.min.x)) {
                boundingBox.getSize(size);
                boundingBox.getCenter(center);
                xOffset = size.x / 2 + 1;
                yOffset = size.y / 2 + 1;
                zOffset = size.z / 2 + 1;
            } else {
                this.currentTransformTarget.getWorldPosition(center);
                console.warn("Invalid bounding box; using group position.");
            }
        } else {
            const boundingBox = new window.THREE.Box3().setFromObject(this.currentTransformTarget);
            const size = new window.THREE.Vector3();
            if (!boundingBox.isEmpty() && isFinite(boundingBox.min.x)) {
                boundingBox.getSize(size);
                boundingBox.getCenter(center);
                xOffset = size.x / 2 + 1;
                yOffset = size.y / 2 + 1;
                zOffset = size.z / 2 + 1;
            } else {
                this.currentTransformTarget.getWorldPosition(center);
                console.warn("Invalid bounding box; using group position.");
            }
        }
    
        this.gizmoGroup.position.copy(center);
    
        if (this.gizmoMode === "translate") {
            const arrowLength = 5;
            const arrowHeadLength = 2;
            const arrowHeadWidth = 1;
    
            // X-axis (red)
            const xCylinderGeometry = new window.THREE.CylinderGeometry(0.5, 0.5, arrowLength - arrowHeadLength, 8);
            const xCylinderMaterial = new window.THREE.MeshBasicMaterial({ color: 0xff0000 });
            const xCylinder = new window.THREE.Mesh(xCylinderGeometry, xCylinderMaterial);
            xCylinder.rotation.z = Math.PI / 2;
            xCylinder.position.x = xOffset + (arrowLength - arrowHeadLength) / 2;
            xCylinder.name = "translate-x";
            this.gizmoGroup.add(xCylinder);
    
            const xConeGeometry = new window.THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
            const xConeMaterial = new window.THREE.MeshBasicMaterial({ color: 0xff0000 });
            const xCone = new window.THREE.Mesh(xConeGeometry, xConeMaterial);
            xCone.rotation.z = 3 * Math.PI / 2;
            xCone.position.x = xOffset + arrowLength - arrowHeadLength / 2;
            xCone.name = "translate-x";
            this.gizmoGroup.add(xCone);
    
            // Y-axis (green)
            const yCylinderGeometry = new window.THREE.CylinderGeometry(0.5, 0.5, arrowLength - arrowHeadLength, 8);
            const yCylinderMaterial = new window.THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const yCylinder = new window.THREE.Mesh(yCylinderGeometry, yCylinderMaterial);
            yCylinder.position.y = yOffset + (arrowLength - arrowHeadLength) / 2;
            yCylinder.name = "translate-y";
            this.gizmoGroup.add(yCylinder);
    
            const yConeGeometry = new window.THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
            const yConeMaterial = new window.THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const yCone = new window.THREE.Mesh(yConeGeometry, yConeMaterial);
            yCone.position.y = yOffset + arrowLength - arrowHeadLength / 2;
            yCone.name = "translate-y";
            this.gizmoGroup.add(yCone);
    
            // Z-axis (blue)
            const zCylinderGeometry = new window.THREE.CylinderGeometry(0.5, 0.5, arrowLength - arrowHeadLength, 8);
            const zCylinderMaterial = new window.THREE.MeshBasicMaterial({ color: 0x0000ff });
            const zCylinder = new window.THREE.Mesh(zCylinderGeometry, zCylinderMaterial);
            zCylinder.rotation.x = Math.PI / 2;
            zCylinder.position.z = zOffset + (arrowLength - arrowHeadLength) / 2;
            zCylinder.name = "translate-z";
            this.gizmoGroup.add(zCylinder);
    
            const zConeGeometry = new window.THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
            const zConeMaterial = new window.THREE.MeshBasicMaterial({ color: 0x0000ff });
            const zCone = new window.THREE.Mesh(zConeGeometry, zConeMaterial);
            zCone.rotation.x = Math.PI / 2;
            zCone.position.z = zOffset + arrowLength - arrowHeadLength / 2;
            zCone.name = "translate-z";
            this.gizmoGroup.add(zCone);
        } else if (this.gizmoMode === "rotate") {
            const ringRadius = 4;
            const ringTube = 0.5;
    
            // X-axis (red)
            const xRingGeometry = new window.THREE.TorusGeometry(ringRadius, ringTube, 16, 100);
            const xRingMaterial = new window.THREE.MeshBasicMaterial({ color: 0xff0000 });
            const xRing = new window.THREE.Mesh(xRingGeometry, xRingMaterial);
            xRing.rotation.y = Math.PI / 2;
            xRing.position.x = xOffset;
            xRing.name = "rotate-x";
            this.gizmoGroup.add(xRing);
    
            // Y-axis (green)
            const yRingGeometry = new window.THREE.TorusGeometry(ringRadius, ringTube, 16, 100);
            const yRingMaterial = new window.THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const yRing = new window.THREE.Mesh(yRingGeometry, yRingMaterial);
            yRing.rotation.x = Math.PI / 2;
            yRing.position.y = yOffset;
            yRing.name = "rotate-y";
            this.gizmoGroup.add(yRing);
    
            // Z-axis (blue)
            const zRingGeometry = new window.THREE.TorusGeometry(ringRadius, ringTube, 16, 100);
            const zRingMaterial = new window.THREE.MeshBasicMaterial({ color: 0x0000ff });
            const zRing = new window.THREE.Mesh(zRingGeometry, zRingMaterial);
            zRing.position.z = zOffset;
            zRing.name = "rotate-z";
            this.gizmoGroup.add(zRing);
        } else if (this.gizmoMode === "scale") {
            const boxSize = 2;
    
            // X-axis (red)
            const xBoxGeometry = new window.THREE.BoxGeometry(boxSize, boxSize, boxSize);
            const xBoxMaterial = new window.THREE.MeshBasicMaterial({ color: 0xff0000 });
            const xBox = new window.THREE.Mesh(xBoxGeometry, xBoxMaterial);
            xBox.position.set(xOffset, 0, 0);
            xBox.name = "scale-x";
            this.gizmoGroup.add(xBox);
    
            // Y-axis (green)
            const yBoxGeometry = new window.THREE.BoxGeometry(boxSize, boxSize, boxSize);
            const yBoxMaterial = new window.THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const yBox = new window.THREE.Mesh(yBoxGeometry, yBoxMaterial);
            yBox.position.set(0, yOffset, 0);
            yBox.name = "scale-y";
            this.gizmoGroup.add(yBox);
    
            // Z-axis (blue)
            const zBoxGeometry = new window.THREE.BoxGeometry(boxSize, boxSize, boxSize);
            const zBoxMaterial = new window.THREE.MeshBasicMaterial({ color: 0x0000ff });
            const zBox = new window.THREE.Mesh(zBoxGeometry, zBoxMaterial);
            zBox.position.set(0, 0, zOffset);
            zBox.name = "scale-z";
            this.gizmoGroup.add(zBox);
        }
    }
    updateInspectorValues() {
        if (!this.currentTransformTarget) return;
        
        // Update all relevant input fields
        const updateInput = (property, value) => {
            const input = document.querySelector(`[data-property="${property}"]`);
            if (input) input.value = value;
        };
        
        // Position
        updateInput('x', this.currentTransformTarget.position.x);
        updateInput('y', this.currentTransformTarget.position.y);
        updateInput('z', this.currentTransformTarget.position.z);
        
        // Rotation (convert to degrees)
        updateInput('rotationX', this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.x));
        updateInput('rotationY', this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.y));
        updateInput('rotationZ', this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.z));
        
        // Scale
        updateInput('scaleX', this.currentTransformTarget.scale.x);
        updateInput('scaleY', this.currentTransformTarget.scale.y);
        updateInput('scaleZ', this.currentTransformTarget.scale.z);
    }
     // Mouse event handlers for gizmo interaction
     onMouseDown(event) {
        if (!this.gizmoGroup) {
            console.log("Gizmo group not present");
            return;
        }
    
        const canvas = this.graphicsEditor.sceneRenderer.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
        this.raycaster.setFromCamera(this.mouse, this.graphicsEditor.sceneRenderer.camera);
        const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, true);
    
        if (intersects.length > 0) {
            const object = intersects[0].object;
            this.selectedAxis = object.name.split('-')[1];
            this.isDragging = true;
            console.log(`Dragging started on axis: ${this.selectedAxis}`, object);
    
            if (this.graphicsEditor.sceneRenderer.controls) {
                this.graphicsEditor.sceneRenderer.controls.enabled = false;
            }
    
            this.lastMouse.copy(this.mouse);
        } else {
            console.log("No intersection with gizmo");
        }
    }

    onMouseMove(event) {
        if (!this.isDragging || !this.selectedAxis || !this.currentTransformTarget) return;
        
        const canvas = this.graphicsEditor.sceneRenderer.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const deltaMouse = this.mouse.clone().sub(this.lastMouse);
        
        const camera = this.graphicsEditor.sceneRenderer.camera;
        const cameraPosition = camera.position.clone();
        const objectPosition = this.currentTransformTarget.position.clone();
        
        const cameraRight = new window.THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const cameraUp = new window.THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const cameraForward = new window.THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const cameraToObject = objectPosition.clone().sub(cameraPosition);
        
        if (this.gizmoMode === "translate") {
            const moveSpeed = 100;
            
            if (this.selectedAxis === "x") {
                const worldX = new window.THREE.Vector3(1, 0, 0);
                const dotProduct = worldX.dot(cameraRight);
                const moveFactor = Math.sign(dotProduct) * deltaMouse.x * moveSpeed;
                this.currentTransformTarget.position.x += moveFactor;
            } else if (this.selectedAxis === "y") {
                const worldY = new window.THREE.Vector3(0, 1, 0);
                const dotProduct = worldY.dot(cameraUp);
                const moveFactor = Math.sign(dotProduct) * deltaMouse.y * moveSpeed;
                this.currentTransformTarget.position.y += moveFactor;
            } else if (this.selectedAxis === "z") {
                const worldZ = new window.THREE.Vector3(0, 0, 1);
                const cameraRightXZ = new window.THREE.Vector3(cameraRight.x, 0, cameraRight.z).normalize();
                const dotProduct = worldZ.dot(cameraRightXZ);
                const moveFactor = Math.sign(dotProduct) * deltaMouse.x * moveSpeed;
                this.currentTransformTarget.position.z += moveFactor;
            }
        } else if (this.gizmoMode === "rotate") {
            const rotateSpeed = 2 * Math.PI;
            
            if (this.selectedAxis === "x") {
                const worldX = new window.THREE.Vector3(1, 0, 0);
                const dotProduct = worldX.dot(cameraRight);
                const rotateFactor = -Math.sign(dotProduct) * deltaMouse.x * rotateSpeed;
                this.currentTransformTarget.rotation.x += rotateFactor;
            } else if (this.selectedAxis === "y") {
                const worldY = new window.THREE.Vector3(0, 1, 0);
                const dotProduct = worldY.dot(cameraUp);
                const rotateFactor = Math.sign(dotProduct) * deltaMouse.x * rotateSpeed;
                this.currentTransformTarget.rotation.y += rotateFactor;
            } else if (this.selectedAxis === "z") {
                const worldZ = new window.THREE.Vector3(0, 0, 1);
                const dotProduct = cameraToObject.normalize().dot(worldZ);
                const rotateFactor = Math.sign(dotProduct) * deltaMouse.x * rotateSpeed;
                this.currentTransformTarget.rotation.z += rotateFactor;
            }
        } else if (this.gizmoMode === "scale") {
            const scaleSpeed = 2;
            let scaleFactor = 0;
            
            if (this.selectedAxis === "x") {
                const worldX = new window.THREE.Vector3(1, 0, 0);
                const dotProduct = worldX.dot(cameraRight);
                scaleFactor = Math.sign(dotProduct) * deltaMouse.x * scaleSpeed;
            } else if (this.selectedAxis === "y") {
                const worldY = new window.THREE.Vector3(0, 1, 0);
                const dotProduct = worldY.dot(cameraUp);
                scaleFactor = Math.sign(dotProduct) * deltaMouse.y * scaleSpeed;
            } else if (this.selectedAxis === "z") {
                const worldZ = new window.THREE.Vector3(0, 0, 1);
                const cameraRightXZ = new window.THREE.Vector3(cameraRight.x, 0, cameraRight.z).normalize();
                const dotProduct = worldZ.dot(cameraRightXZ);
                scaleFactor = Math.sign(dotProduct) * deltaMouse.x * scaleSpeed;
            }
            
            if (this.selectedAxis === "x") {
                this.currentTransformTarget.scale.x += scaleFactor;
                if (this.currentTransformTarget.scale.x < 0.1) this.currentTransformTarget.scale.x = 0.1;
            } else if (this.selectedAxis === "y") {
                this.currentTransformTarget.scale.y += scaleFactor;
                if (this.currentTransformTarget.scale.y < 0.1) this.currentTransformTarget.scale.y = 0.1;
            } else if (this.selectedAxis === "z") {
                this.currentTransformTarget.scale.z += scaleFactor;
                if (this.currentTransformTarget.scale.z < 0.1) this.currentTransformTarget.scale.z = 0.1;
            }
        }
        this.updateGizmoPosition();
        this.lastMouse.copy(this.mouse);
        this.applyCurrentTransform(); // New method to update data model
        this.updateInspectorValues(); // Keep UI in sync
    }
    applyCurrentTransform() {
        if (!this.currentTransformTarget) return;
    
        // For groups
        if (this.currentTransformTarget.userData?.isGroup) {
            const groupId = this.currentTransformTarget.name;
            const groupData = this.graphicsEditor.groupManager.getGroupData(groupId);
            
            // Directly update group transform without full refresh
            groupData.position = {
                x: this.currentTransformTarget.position.x,
                y: this.currentTransformTarget.position.y,
                z: this.currentTransformTarget.position.z
            };
            groupData.rotation = {
                x: this.currentTransformTarget.rotation.x,
                y: this.currentTransformTarget.rotation.y,
                z: this.currentTransformTarget.rotation.z
            };
            groupData.scale = {
                x: this.currentTransformTarget.scale.x,
                y: this.currentTransformTarget.scale.y,
                z: this.currentTransformTarget.scale.z
            };
            
            // Only update the transform, not the entire scene
            this.updateGizmoPosition();
            return;
        }
        // For individual shapes
        else if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const shape = this.getCurrentShape();
            if (shape) {
                shape.x = this.currentTransformTarget.position.x;
                shape.y = this.currentTransformTarget.position.y;
                shape.z = this.currentTransformTarget.position.z;
                
                shape.rotationX = this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.x);
                shape.rotationY = this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.y);
                shape.rotationZ = this.graphicsEditor.rotationUtils.radToDeg(this.currentTransformTarget.rotation.z);
                
                shape.scaleX = this.currentTransformTarget.scale.x;
                shape.scaleY = this.currentTransformTarget.scale.y;
                shape.scaleZ = this.currentTransformTarget.scale.z;
            }
        }
        
        // Optional: Auto-save or trigger update
        this.graphicsEditor.refreshShapes(false);
    }
    updateGizmoPosition() {
        if (!this.currentTransformTarget || !this.gizmoGroup) return;
    
        let center = new window.THREE.Vector3();
        let xOffset = 1, yOffset = 1, zOffset = 1;
    
        if (this.currentTransformTarget.children.length > 0) {
            const boundingBox = new window.THREE.Box3().setFromObject(this.currentTransformTarget);
            const size = new window.THREE.Vector3();
            if (!boundingBox.isEmpty() && isFinite(boundingBox.min.x)) {
                boundingBox.getSize(size);
                boundingBox.getCenter(center);
                xOffset = size.x / 2 + 1;
                yOffset = size.y / 2 + 1;
                zOffset = size.z / 2 + 1;
            } else {
                this.currentTransformTarget.getWorldPosition(center);
                console.warn("Invalid bounding box; using group position.");
            }
        } else {
            const boundingBox = new window.THREE.Box3().setFromObject(this.currentTransformTarget);
            const size = new window.THREE.Vector3();
            if (!boundingBox.isEmpty() && isFinite(boundingBox.min.x)) {
                boundingBox.getSize(size);
                boundingBox.getCenter(center);
                xOffset = size.x / 2 + 1;
                yOffset = size.y / 2 + 1;
                zOffset = size.z / 2 + 1;
            } else {
                this.currentTransformTarget.getWorldPosition(center);
                console.warn("Invalid bounding box; using group position.");
            }
        }
    
        this.gizmoGroup.position.copy(center);
    
        this.gizmoGroup.children.forEach(child => {
            const name = child.name;
            if (!name) return;
    
            child.position.set(0, 0, 0);
    
            if (name.startsWith("translate-")) {
                const arrowLength = 5;
                const arrowHeadLength = 2;
                if (name === "translate-x") {
                    child.position.x = xOffset + (child.geometry.type === "CylinderGeometry" ? (arrowLength - arrowHeadLength) / 2 : arrowLength - arrowHeadLength / 2);
                } else if (name === "translate-y") {
                    child.position.y = yOffset + (child.geometry.type === "CylinderGeometry" ? (arrowLength - arrowHeadLength) / 2 : arrowLength - arrowHeadLength / 2);
                } else if (name === "translate-z") {
                    child.position.z = zOffset + (child.geometry.type === "CylinderGeometry" ? (arrowLength - arrowHeadLength) / 2 : arrowLength - arrowHeadLength / 2);
                }
            } else if (name.startsWith("rotate-")) {
                if (name === "rotate-x") child.position.x = xOffset;
                else if (name === "rotate-y") child.position.y = yOffset;
                else if (name === "rotate-z") child.position.z = zOffset;
            } else if (name.startsWith("scale-")) {
                if (name === "scale-x") child.position.x = xOffset;
                else if (name === "scale-y") child.position.y = yOffset;
                else if (name === "scale-z") child.position.z = zOffset;
            }
        });
    
        // Ensure gizmoGroup is in scene (not rootGroup, as it’s a UI overlay)
        if (!this.graphicsEditor.sceneRenderer.scene.children.includes(this.gizmoGroup)) {
            this.graphicsEditor.sceneRenderer.scene.add(this.gizmoGroup);
            console.warn("Gizmo was removed from scene; re-added.");
        }
    }

    onMouseUp() {
        this.isDragging = false;
        this.selectedAxis = null;

        if (this.graphicsEditor.sceneRenderer.controls) {
            this.graphicsEditor.sceneRenderer.controls.enabled = true;
        }
    }
    getSelectedGroupOrRoot() {
        const selectedGroupName = this.graphicsEditor.groupManager.selectedGroupName;
        if (selectedGroupName) {
            let foundGroup = null;
            this.graphicsEditor.rootGroup.traverse(obj => {
                if (obj.isGroup && obj.name === selectedGroupName && obj.userData.isGroup) {
                    foundGroup = obj;
                }
            });
            let foundShape = null;
            if(foundGroup){
                foundGroup.traverse(obj => {
                    if (obj.userData.isShape && obj.userData.index == this.graphicsEditor.state.selectedShapeIndex) {
                        foundShape = obj;
                    }
                });
            }
            return foundShape || foundGroup || this.graphicsEditor.rootGroup;
        }
        return this.graphicsEditor.rootGroup;
    }
    transformGroup(targetObject) {
        // Determine the target object - prioritize the passed target, then selected group, then rootGroup
        let target;
        if (targetObject) {
            target = targetObject;
        } else {
            // Try to get the currently selected group
            const selectedGroupName = this.graphicsEditor.groupManager.selectedGroupName;
            if (selectedGroupName) {
                // Find the group in the scene
                this.graphicsEditor.rootGroup.traverse(obj => {
                    if (obj.isGroup && obj.name === selectedGroupName && obj.userData.isGroup) {
                        target = obj;
                    }
                });
            }
            
            // Fall back to rootGroup if no selected group found
            if (!target) {
                target = this.graphicsEditor.rootGroup;
            }
        }
    
        // If we still don't have a target, return
        if (!target) return;
    
        this.currentTransformTarget = target;
    
        // If target is a group, ensure it's in rootGroup and populated
        if (this.currentTransformTarget.userData?.isGroup) {
            const groupId = this.currentTransformTarget.userData.groupId;
            const group = this.graphicsEditor.groupManager.getGroupObject(groupId);
            if (group) {
                // Ensure group is in rootGroup
                if (this.currentTransformTarget.parent !== this.graphicsEditor.rootGroup) {
                    if (this.currentTransformTarget.parent) {
                        this.currentTransformTarget.parent.remove(this.currentTransformTarget);
                    }
                    this.graphicsEditor.rootGroup.add(this.currentTransformTarget);
                }    
            }
        }
    
        this.originalPosition.copy(this.currentTransformTarget.position);
        this.originalRotation.copy(this.currentTransformTarget.rotation);
        this.originalScale.copy(this.currentTransformTarget.scale);
        
        // Inject transform controls into inspector instead of creating separate UI
        this.injectTransformControlsToInspector();
    }
    
    // New method to inject transform controls into the inspector
    injectTransformControlsToInspector() {
        const inspector = document.getElementById('inspector');
        
        // Create transform controls section
        const transformSection = document.createElement('div');
        transformSection.className = 'transform-controls-section';
        transformSection.innerHTML = `
            <h3>Transform ${this.currentTransformTarget.name || 'Current Frame'}</h3>
            <div class="transform-buttons">
                <button id="translate-btn" class="${this.gizmoMode === 'translate' ? 'active' : ''}">Translate</button>
                <button id="rotate-btn" class="${this.gizmoMode === 'rotate' ? 'active' : ''}">Rotate</button>
                <button id="scale-btn" class="${this.gizmoMode === 'scale' ? 'active' : ''}">Scale</button>
            </div>
            <div class="button-row">
                <button id="transform-apply">Apply</button>
                <button id="transform-reset">Reset</button>
                <button id="transform-cancel">Cancel</button>
            </div>
        `;
        
        // Insert at the top of the inspector
        if (inspector.firstChild) {
            inspector.insertBefore(transformSection, inspector.firstChild);
        } else {
            inspector.appendChild(transformSection);
        }
        
        // Add event listeners for transform mode buttons
        document.getElementById('translate-btn').addEventListener('click', () => {
            this.setGizmoMode('translate');
            this.updateModeButtonsUI();
        });
        
        document.getElementById('rotate-btn').addEventListener('click', () => {
            this.setGizmoMode('rotate');
            this.updateModeButtonsUI();
        });
        
        document.getElementById('scale-btn').addEventListener('click', () => {
            this.setGizmoMode('scale');
            this.updateModeButtonsUI();
        });
        
        document.getElementById('transform-apply').addEventListener('click', () => {
            this.applyTransformToShapes();
            this.graphicsEditor.sceneRenderer.scene.remove(this.gizmoGroup);
            this.gizmoGroup = null;
            this.currentTransformTarget = null;
            this.removeTransformControlsFromInspector();
        });
        
        document.getElementById('transform-reset').addEventListener('click', () => {
            this.currentTransformTarget.position.copy(this.originalPosition);
            this.currentTransformTarget.rotation.copy(this.originalRotation);
            this.currentTransformTarget.scale.copy(this.originalScale);
            this.updateGizmoPosition();
            this.updateInspectorValues();
        });
        
        document.getElementById('transform-cancel').addEventListener('click', () => {
            this.currentTransformTarget.position.copy(this.originalPosition);
            this.currentTransformTarget.rotation.copy(this.originalRotation);
            this.currentTransformTarget.scale.copy(this.originalScale);
            this.graphicsEditor.sceneRenderer.scene.remove(this.gizmoGroup);
            this.gizmoGroup = null;
            this.currentTransformTarget = null;
            this.removeTransformControlsFromInspector();
        });
        
        this.createGizmo();
        this.updateInspectorValues();
    }
    
    // New helper method to set gizmo mode
    setGizmoMode(mode) {
        this.gizmoMode = mode;
        this.createGizmo();
    }
    
    // New helper method to update button UI for transform modes
    updateModeButtonsUI() {
        const translateBtn = document.getElementById('translate-btn');
        const rotateBtn = document.getElementById('rotate-btn');
        const scaleBtn = document.getElementById('scale-btn');
        
        translateBtn.className = this.gizmoMode === 'translate' ? 'active' : '';
        rotateBtn.className = this.gizmoMode === 'rotate' ? 'active' : '';
        scaleBtn.className = this.gizmoMode === 'scale' ? 'active' : '';
    }
    
    // New helper method to remove transform controls from inspector
    removeTransformControlsFromInspector() {
        const transformSection = document.querySelector('.transform-controls-section');
        if (transformSection) {
            transformSection.remove();
        }
    }
    applyTransformToShapes() {
        if (!this.currentTransformTarget) return;

        // If transforming the root group, apply to all shapes
        if (this.currentTransformTarget === this.graphicsEditor.rootGroup) {
            const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes;

            const positionOffset = this.currentTransformTarget.position.clone();
            const rotationEuler = this.currentTransformTarget.rotation.clone();
            const scaleFactor = this.currentTransformTarget.scale.clone();

            const transformMatrix = new window.THREE.Matrix4();
            transformMatrix.compose(
                positionOffset,
                new window.THREE.Quaternion().setFromEuler(rotationEuler),
                scaleFactor
            );

            let centerX = 0, centerY = 0, centerZ = 0;
            currentShapes.forEach(shape => {
                centerX += shape.x || 0;
                centerY += shape.y || 0;
                centerZ += shape.z || 0;
            });
            centerX /= currentShapes.length;
            centerY /= currentShapes.length;
            centerZ /= currentShapes.length;
            const centerPoint = new window.THREE.Vector3(centerX, centerY, centerZ);

            currentShapes.forEach(shape => {
                const position = new window.THREE.Vector3(shape.x || 0, shape.y || 0, shape.z || 0);
                position.sub(centerPoint);
                position.applyMatrix4(transformMatrix);
                position.add(centerPoint);

                shape.x = position.x;
                shape.y = position.y;
                shape.z = position.z;

                const shapeRotation = new window.THREE.Euler(
                    this.graphicsEditor.rotationUtils.degToRad(shape.rotationX || 0),
                    this.graphicsEditor.rotationUtils.degToRad(shape.rotationY || 0),
                    this.graphicsEditor.rotationUtils.degToRad(shape.rotationZ || 0)
                );
                const quaternion = new window.THREE.Quaternion().setFromEuler(shapeRotation);
                const groupQuaternion = new window.THREE.Quaternion().setFromEuler(rotationEuler);
                quaternion.premultiply(groupQuaternion);
                const newRotation = new window.THREE.Euler().setFromQuaternion(quaternion);
                shape.rotationX = this.graphicsEditor.rotationUtils.radToDeg(newRotation.x);
                shape.rotationY = this.graphicsEditor.rotationUtils.radToDeg(newRotation.y);
                shape.rotationZ = this.graphicsEditor.rotationUtils.radToDeg(newRotation.z);

                if (shape.size) shape.size *= scaleFactor.x;
                if (shape.width) shape.width *= scaleFactor.x;
                if (shape.height) shape.height *= scaleFactor.y;
                if (shape.depth) shape.depth *= scaleFactor.z;
                if (shape.tubeSize) shape.tubeSize *= scaleFactor.x;
            });

            this.currentTransformTarget.position.set(0, 0, 0);
            this.currentTransformTarget.rotation.set(0, 0, 0);
            this.currentTransformTarget.scale.set(1, 1, 1);
        } else {
            // If transforming a group, update group data in groupManager
            const groupId = this.currentTransformTarget.name;
            if (groupId) {
                this.graphicsEditor.groupManager.applyGroupTransform(
                    groupId,
                    this.currentTransformTarget.position,
                    this.currentTransformTarget.rotation,
                    this.currentTransformTarget.scale
                );
            }
        }

        this.graphicsEditor.refreshShapes(true);
    }
    selectShape(index) {
        if (this.graphicsEditor.animationManager.isPreviewingAnimation) {
            this.graphicsEditor.setPreviewAnimationState(false);
        }
        
        // Toggle selection if clicking the same shape
        this.graphicsEditor.state.selectedShapeIndex = (this.graphicsEditor.state.selectedShapeIndex === index) ? -1 : index;
        this.graphicsEditor.state.currentGroup = this.graphicsEditor.groupManager.selectedGroupName;
        
        // Update shape list and highlighting
        this.updateShapeList();
        this.highlightSelectedShape();
        
        // Show inspector for selected shape
        const shape = this.getCurrentShape();
        if (shape) {
            this.graphicsEditor.createInspector(shape);
            this.transformGroup(this.getSelectedGroupOrRoot())
        }
    }

    getCurrentShape() {
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const currentFrame = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
            const selectedGroup = this.graphicsEditor.state.currentGroup;
            const shapes = currentFrame[selectedGroup].shapes || [];
            
            if (this.graphicsEditor.state.selectedShapeIndex < shapes.length) {
                const shape = shapes[this.graphicsEditor.state.selectedShapeIndex];
                if (shape) {
                    return shape;
                }
            }
        }
        return null;
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
    
        // Get the selected group name from state (or groupManager if needed)
        const selectedGroupName = this.graphicsEditor.state.currentGroup || this.graphicsEditor.groupManager.selectedGroupName;
        if (!selectedGroupName) {
            console.warn("No group selected");
            return;
        }
    
        // Find the THREE.Group with matching name under rootGroup
        let selectedGroup = null;
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (obj.isGroup && obj.name === selectedGroupName) {
                selectedGroup = obj;
            }
        });
    
        if (!selectedGroup) {
            console.warn(`No group found with name ${selectedGroupName}`);
            return;
        }
    
        const currentAnimation = this.graphicsEditor.state.currentAnimation;
        const currentFrame = this.graphicsEditor.state.currentFrame;
        const currentFrameData = this.graphicsEditor.state.renderData.animations[currentAnimation][currentFrame];
    
        if (!currentFrameData) {
            console.warn("No frame data found");
            return;
        }
    
        const groupShapes = currentFrameData[selectedGroupName];
    
        if (!groupShapes || this.graphicsEditor.state.selectedShapeIndex >= groupShapes.length) {
            console.warn(`Invalid shape index ${this.graphicsEditor.state.selectedShapeIndex} for group ${selectedGroupName}`);
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
            this.originalMaterials.set(mesh, mesh.material);
    
            const highlightMaterial = mesh.material.clone();
            highlightMaterial.emissive = new window.THREE.Color(0x555555);
            highlightMaterial.emissiveIntensity = 0.5;
            mesh.material = highlightMaterial;
    
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
        this.graphicsEditor.refreshShapes(true); // Relies on refreshShapes to add to rootGroup
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
        if (!shapeList) return;
       
        shapeList.innerHTML = '';
       
        // Get the current frame data
        const currentFrame = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
       
        // Get shapes from the currently selected group
        const selectedGroupName = this.graphicsEditor.groupManager.selectedGroupName;
        const selectedGroup = currentFrame[selectedGroupName]
        const shapes = selectedGroup ? selectedGroup.shapes : [];
       
        // Create shape list items
        for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            if (!shape) continue;
           
            const shapeItem = document.createElement('div');
            shapeItem.classList.add('shape-item');
           
            // Mark as selected if this shape is the selected one and we're in the right group
            if (i === this.graphicsEditor.state.selectedShapeIndex &&
                this.graphicsEditor.groupManager.selectedGroupName === this.graphicsEditor.state.currentGroup) {
                shapeItem.classList.add('selected');
            }
           
            shapeItem.textContent = `${shape.type || 'Shape'} ${i}`;
            shapeItem.addEventListener('click', () => {
                this.graphicsEditor.state.currentGroup = this.graphicsEditor.groupManager.selectedGroupName;
                this.selectShape(i);
            });
           
            // Make the shape draggable
            shapeItem.draggable = true;
            shapeItem.dataset.index = i;
            shapeItem.dataset.group = selectedGroupName;
            
            // Add dragstart event to set the drag data
            shapeItem.addEventListener('dragstart', (e) => {
                // Store only the selected shape's index and source group
                const data = {
                    shapeIndex: i,
                    sourceGroup: selectedGroupName
                };
                
                // Set the drag data
                e.dataTransfer.setData('text/plain', JSON.stringify(data));
                
                // Add a visual indicator
                shapeItem.classList.add('dragging');
                
                // Set drag effect
                e.dataTransfer.effectAllowed = 'move';
            });
            
            // Add dragend event to clean up
            shapeItem.addEventListener('dragend', () => {
                shapeItem.classList.remove('dragging');
            });
           
            shapeList.appendChild(shapeItem);
        }
        
        // Set up the shape list container as a drop target
        shapeList.addEventListener('dragover', (e) => {
            // Only respond if we're dragging over the shape list itself, not an individual shape
            if (e.target === shapeList) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                shapeList.classList.add('drag-over');
            }
        });
        
        shapeList.addEventListener('dragleave', (e) => {
            // Only respond if we're leaving the shape list
            if (e.target === shapeList) {
                shapeList.classList.remove('drag-over');
            }
        });
        
        shapeList.addEventListener('drop', (e) => {
            e.preventDefault();
            shapeList.classList.remove('drag-over');
            
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            
            try {
                const dragData = JSON.parse(data);
                const { shapeIndex, sourceGroup } = dragData;
                
                // Only process if this is a different group
                if (sourceGroup && sourceGroup !== selectedGroupName) {
                    this.graphicsEditor.groupManager.moveToGroup(
                        parseInt(shapeIndex),
                        sourceGroup,
                        selectedGroupName
                    );
                }
            } catch (err) {
                console.error('Error processing drop in shape list:', err);
            }
        });
    }

}