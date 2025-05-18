class GE_GizmoManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.gizmoMode = 'translate';
        this.gizmoGroup = null;
        this.isDragging = false;
        this.selectedAxis = null;
        this.mouse = new window.THREE.Vector2();
        this.lastMouse = new window.THREE.Vector2();
        this.raycaster = new window.THREE.Raycaster();
        this.originalScale = new window.THREE.Vector3(1, 1, 1);
        this.originalPosition = new window.THREE.Vector3(0, 0, 0);
        this.originalRotation = new window.THREE.Vector3(0, 0, 0);
    }

    init() {

        const canvas = this.graphicsEditor.sceneRenderer.renderer.domElement;
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        canvas.addEventListener('mousemove', this.onDrag.bind(this));
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this));

    }

    destroyGizmo() {
        if (this.gizmoGroup) {
            this.gizmoGroup.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.graphicsEditor.sceneRenderer.scene.remove(this.gizmoGroup);
            this.gizmoGroup = null;
        }
    }

    createGizmo() {
        this.destroyGizmo();
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
    
        if (this.graphicsEditor.state.gizmoMode === "translate") {
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
        } else if (this.graphicsEditor.state.gizmoMode === "rotate") {
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
        } else if (this.graphicsEditor.state.gizmoMode === "scale") {
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

    setGizmoMode(mode) {
        this.graphicsEditor.state.gizmoMode = mode;
        this.createGizmo();
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

          
    onMouseDown(event) {
        if (!this.gizmoGroup) {
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
            if (this.graphicsEditor.sceneRenderer.controls) {
                this.graphicsEditor.sceneRenderer.controls.enabled = false;
            }
    
            this.lastMouse.copy(this.mouse);
        } else {
            console.log("No intersection with gizmo");
        }
    }

    onMouseUp() {
        this.isDragging = false;
        this.selectedAxis = null;

        if (this.graphicsEditor.sceneRenderer.controls) {
            this.graphicsEditor.sceneRenderer.controls.enabled = true;
        }
    }
    onDrag(event) {
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
        
        if (this.graphicsEditor.state.gizmoMode === "translate") {
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
        } else if (this.graphicsEditor.state.gizmoMode === "rotate") {
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
        } else if (this.graphicsEditor.state.gizmoMode === "scale") {
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
        this.updateInspectorValues();
        this.applyCurrentTransform(); 
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
        }
        // For individual shapes
        else if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const shape = this.graphicsEditor.shapeManager.getShapeData(this.graphicsEditor.state.selectedShapeIndex);
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
        this.graphicsEditor.renderShapes(false);
        // Optional: Auto-save or trigger update
    }


    transformSelectedObject(targetObject) {
        if(!targetObject){
            targetObject = this.graphicsEditor.getSelectedObject();
        }
        console.log('transform', targetObject);
        // Determine the target object - prioritize the passed target, then selected group, then rootGroup
        let target;
        if (targetObject) {
            target = targetObject;
        } else {
            // Try to get the currently selected group
            const currentGroup = this.graphicsEditor.state.currentGroup;
            if (currentGroup) {
                // Find the group in the scene
                this.graphicsEditor.rootGroup.traverse(obj => {
                    if (obj.isGroup && obj.name === currentGroup && obj.userData.isGroup) {
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
        this.updateGizmoPosition();
    }
      
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
        
        this.updateInspectorValues();
        this.setGizmoMode('translate');
        this.updateModeButtonsUI();
    }
    
    updateModeButtonsUI() {
        const translateBtn = document.getElementById('translate-btn');
        const rotateBtn = document.getElementById('rotate-btn');
        const scaleBtn = document.getElementById('scale-btn');
        
        translateBtn.className = this.gizmoMode === 'translate' ? 'active' : '';
        rotateBtn.className = this.gizmoMode === 'rotate' ? 'active' : '';
        scaleBtn.className = this.gizmoMode === 'scale' ? 'active' : '';
    }
    
}