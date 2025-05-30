class SE_GizmoManager {
    constructor() {}

    init(sceneEditor){        
        this.sceneEditor = sceneEditor; // Store reference to the scene editor
        this.scene = sceneEditor.scene;
        this.camera = sceneEditor.camera;
        this.renderer = sceneEditor.renderer;
        this.controls = sceneEditor.controls;
        
        this.gizmoGroup = new THREE.Group();
        this.gizmoGroup.name = "transformGizmo";
        this.scene.add(this.gizmoGroup);
        
        this.mode = 'translate'; // 'translate', 'rotate', 'scale'
        this.selectedAxis = null;
        this.isDragging = false;
        this.targetObject = null;
        this.startPosition = new THREE.Vector3();
        this.startRotation = new THREE.Euler();
        this.startScale = new THREE.Vector3();
        this.dragStartPoint = new THREE.Vector3();
        this.dragCurrentPoint = new THREE.Vector3();
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.axisColors = {
            x: 0xff0000, // red
            y: 0x00ff00, // green
            z: 0x0000ff  // blue
        };
        
        this.highlightColor = 0xffff00; // yellow for highlighting
        
        this.initializeGizmos();
        this.setupEventListeners();
    }
    
    initializeGizmos() {
        this.translateGizmo = this.createTranslateGizmo();
        this.rotateGizmo = this.createRotateGizmo();
        this.scaleGizmo = this.createScaleGizmo();
        
        this.gizmoGroup.add(this.translateGizmo);
        this.gizmoGroup.add(this.rotateGizmo);
        this.gizmoGroup.add(this.scaleGizmo);
        
        // Initially hide all gizmos
        this.gizmoGroup.visible = false;
        this.translateGizmo.visible = false;
        this.rotateGizmo.visible = false;
        this.scaleGizmo.visible = false;
    }
    
    createTranslateGizmo() {
        const group = new THREE.Group();
        group.name = "translateGizmo";
        
        // Create axis arrows
        const arrowLength = 2;
        const arrowHeadLength = .5;
        const arrowHeadWidth = .5;
        
        // X axis (red)
        const xArrow = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 0),
            arrowLength,
            this.axisColors.x,
            arrowHeadLength,
            arrowHeadWidth
        );
        xArrow.name = "translateX";
        xArrow.line.material.linewidth = 3;
        xArrow.line.material.depthTest = false;
        xArrow.line.material.transparent = true;
        xArrow.line.material.opacity = 0.6;
        xArrow.cone.material.depthTest = false;
        xArrow.cone.material.transparent = true;
        xArrow.cone.material.opacity = 0.6;
        // Make arrow cone and line both interactive
        xArrow.cone.userData.axis = 'x';
        xArrow.cone.userData.gizmoType = 'translate';
        xArrow.line.userData.axis = 'x';
        xArrow.line.userData.gizmoType = 'translate';
        
        // Y axis (green)
        const yArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            arrowLength,
            this.axisColors.y,
            arrowHeadLength,
            arrowHeadWidth
        );
        yArrow.name = "translateY";
        yArrow.line.material.linewidth = 3;
        yArrow.line.material.depthTest = false;
        yArrow.line.material.transparent = true;
        yArrow.line.material.opacity = 0.6;
        yArrow.cone.material.depthTest = false;
        yArrow.cone.material.transparent = true;
        yArrow.cone.material.opacity = 0.6;
        // Make arrow cone and line both interactive
        yArrow.cone.userData.axis = 'y';
        yArrow.cone.userData.gizmoType = 'translate';
        yArrow.line.userData.axis = 'y';
        yArrow.line.userData.gizmoType = 'translate';
        
        // Z axis (blue)
        const zArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, 0),
            arrowLength,
            this.axisColors.z,
            arrowHeadLength,
            arrowHeadWidth
        );
        zArrow.name = "translateZ";
        zArrow.line.material.linewidth = 3;
        zArrow.line.material.depthTest = false;
        zArrow.line.material.transparent = true;
        zArrow.line.material.opacity = 0.6;
        zArrow.cone.material.depthTest = false;
        zArrow.cone.material.transparent = true;
        zArrow.cone.material.opacity = 0.6;
        // Make arrow cone and line both interactive
        zArrow.cone.userData.axis = 'z';
        zArrow.cone.userData.gizmoType = 'translate';
        zArrow.line.userData.axis = 'z';
        zArrow.line.userData.gizmoType = 'translate';
        
        group.add(xArrow);
        group.add(yArrow);
        group.add(zArrow);
        
        return group;
    }
    
    createRotateGizmo() {
        const group = new THREE.Group();
        group.name = "rotateGizmo";
        
        const radius = 1;
        const tube = 0.05; // Increased tube size for better visibility and interaction
        const radialSegments = 24;
        const tubularSegments = 48;
        
        // X axis ring (red)
        const xGeometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
        const xMaterial = new THREE.MeshBasicMaterial({ color: this.axisColors.x, transparent: true, opacity: 0.6, depthTest: false });
        const xRing = new THREE.Mesh(xGeometry, xMaterial);
        xRing.name = "rotateX";
        xRing.rotation.y = Math.PI / 2;
        xRing.userData.axis = 'x';
        xRing.userData.gizmoType = 'rotate';
        
        // Y axis ring (green)
        const yGeometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
        const yMaterial = new THREE.MeshBasicMaterial({ color: this.axisColors.y, transparent: true, opacity: 0.6, depthTest: false });
        const yRing = new THREE.Mesh(yGeometry, yMaterial);
        yRing.name = "rotateY";
        yRing.rotation.x = Math.PI / 2; // Fixed rotation axis
        yRing.userData.axis = 'y';
        yRing.userData.gizmoType = 'rotate';
        
        // Z axis ring (blue)
        const zGeometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
        const zMaterial = new THREE.MeshBasicMaterial({ color: this.axisColors.z, transparent: true, opacity: 0.6, depthTest: false });
        const zRing = new THREE.Mesh(zGeometry, zMaterial);
        zRing.name = "rotateZ";
        zRing.userData.axis = 'z';
        zRing.userData.gizmoType = 'rotate';
        
        group.add(xRing);
        group.add(yRing);
        group.add(zRing);
        
        return group;
    }
    
    createScaleGizmo() {
        const group = new THREE.Group();
        group.name = "scaleGizmo";
        
        const lineLength = 1.5; // Increased for better visibility
        const boxSize = 0.2;    // Increased for better interaction
        
        // X axis (red)
        const xLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(lineLength, 0, 0)
            ]),
            new THREE.LineBasicMaterial({ color: this.axisColors.x, transparent: true, opacity: 0.6, depthTest: false, linewidth: 2 })
        );
        xLine.userData.axis = 'x';
        xLine.userData.gizmoType = 'scale';
        
        const xBox = new THREE.Mesh(
            new THREE.BoxGeometry(boxSize, boxSize, boxSize),
            new THREE.MeshBasicMaterial({ color: this.axisColors.x, transparent: true, opacity: 0.6, depthTest: false })
        );
        xBox.position.set(lineLength, 0, 0);
        xBox.name = "scaleX";
        xBox.userData.axis = 'x';
        xBox.userData.gizmoType = 'scale';
        
        // Y axis (green)
        const yLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, lineLength, 0)
            ]),
            new THREE.LineBasicMaterial({ color: this.axisColors.y, transparent: true, opacity: 0.6, depthTest: false, linewidth: 2 })
        );
        yLine.userData.axis = 'y';
        yLine.userData.gizmoType = 'scale';
        
        const yBox = new THREE.Mesh(
            new THREE.BoxGeometry(boxSize, boxSize, boxSize),
            new THREE.MeshBasicMaterial({ color: this.axisColors.y, transparent: true, opacity: 0.6,  depthTest: false })
        );
        yBox.position.set(0, lineLength, 0);
        yBox.name = "scaleY";
        yBox.userData.axis = 'y';
        yBox.userData.gizmoType = 'scale';
        
        // Z axis (blue)
        const zLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, lineLength)
            ]),
            new THREE.LineBasicMaterial({ color: this.axisColors.z, transparent: true, opacity: 0.6, depthTest: false, linewidth: 2 })
        );
        zLine.userData.axis = 'z';
        zLine.userData.gizmoType = 'scale';
        
        const zBox = new THREE.Mesh(
            new THREE.BoxGeometry(boxSize, boxSize, boxSize),
            new THREE.MeshBasicMaterial({ color: this.axisColors.z, transparent: true, opacity: 0.6, depthTest: false })
        );
        zBox.position.set(0, 0, lineLength);
        zBox.name = "scaleZ";
        zBox.userData.axis = 'z';
        zBox.userData.gizmoType = 'scale';
        
        // Uniform scale handle (white)
        const uniformBox = new THREE.Mesh(
            new THREE.BoxGeometry(boxSize * 1.5, boxSize * 1.5, boxSize * 1.5),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6,  depthTest: false })
        );
        uniformBox.position.set(0, 0, 0);
        uniformBox.name = "scaleXYZ";
        uniformBox.userData.axis = 'xyz';
        uniformBox.userData.gizmoType = 'scale';
        
        group.add(xLine);
        group.add(xBox);
        group.add(yLine);
        group.add(yBox);
        group.add(zLine);
        group.add(zBox);
        group.add(uniformBox);
        
        return group;
    }
    
    setupEventListeners() {
        const canvas = this.renderer.domElement;
        
        canvas.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this), false);
        
        // Add keyboard shortcuts for switching transform modes
        document.addEventListener('keydown', (event) => {
            if (!this.targetObject) return;
            
            switch (event.key.toLowerCase()) {
                case 'g':
                    this.setMode('translate');
                    break;
                case 'r':
                    this.setMode('rotate');
                    break;
                case 's':
                    this.setMode('scale');
                    break;
            }
        }, false);
    }
    
    onMouseMove(event) {
        // Update mouse position
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        
        this.mouse.x = ((event.clientX - rect.left) / canvas.clientWidth) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / canvas.clientHeight) * 2 + 1;
        
        if (!this.targetObject) return;
        
        if (this.isDragging) {
            this.handleDrag();
        } else {
            this.highlightGizmo();
        }
    }
    
    onMouseDown(event) {
        if (!this.targetObject) return;
        
        const intersectedAxis = this.getIntersectedGizmo();
        if (!intersectedAxis) return;
        
        this.isDragging = true;
        this.selectedAxis = intersectedAxis;
        
        // Store starting position for reference during drag
        this.startPosition.copy(this.targetObject.position);
        this.startRotation.copy(this.targetObject.rotation);
        this.startScale.copy(this.targetObject.scale);
        
        // Disable camera controls during drag
        this.controls.enabled = false;
        
        // Reset drag points for reference
        this.dragStartPoint = this.getPointOnDragPlane();
        
        // Log for debugging
        console.log(`Started dragging ${this.mode} gizmo on axis: ${this.selectedAxis}`);
    }
    
    onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            
            // Re-enable camera controls
            this.controls.enabled = true;
            
            // Update entity data in the SceneEditor
            if (this.targetObject && this.sceneEditor.state.selectedEntity) {
                const entity = this.sceneEditor.state.selectedEntity;
                const transformComponent = entity.components.find(c => c.type === 'transform');
                
                if (transformComponent) {
                    const position = this.targetObject.position;
                    const rotation = this.targetObject.rotation;
                    const scale = this.targetObject.scale;
                    
                    // Update the entity data
                    transformComponent.parameters.position = { x: position.x, y: position.y, z: position.z };
                    transformComponent.parameters.rotation = { x: rotation.x, y: rotation.y, z: rotation.z };
                    transformComponent.parameters.scale = { x: scale.x, y: scale.y, z: scale.z };
                    
                    // Trigger save to update the UI
                    this.sceneEditor.handleSave(false);
                    this.sceneEditor.renderInspector();
                    
                    // Log for debugging
                    console.log(`Updated entity transform:`, {
                        position: transformComponent.parameters.position,
                        rotation: transformComponent.parameters.rotation,
                        scale: transformComponent.parameters.scale
                    });
                }
            }
            
            this.selectedAxis = null;
        }
    }
    
    getIntersectedGizmo() {
        if (!this.gizmoGroup.visible) return null;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        let activeGizmo;
        switch (this.mode) {
            case 'translate':
                activeGizmo = this.translateGizmo;
                break;
            case 'rotate':
                activeGizmo = this.rotateGizmo;
                break;
            case 'scale':
                activeGizmo = this.scaleGizmo;
                break;
        }
        
        // Get all intersections with the active gizmo and its children
        const intersects = this.raycaster.intersectObject(activeGizmo, true);
        
        if (intersects.length > 0) {
            // The first intersection is the closest one
            const object = intersects[0].object;
            
            // Return the axis from the userData
            if (object.userData.axis) {
                return object.userData.axis;
            }
            
            // Legacy support for objects without userData
            if (object.name.startsWith('translate')) {
                return object.name.charAt(object.name.length - 1).toLowerCase();
            } else if (object.name.startsWith('rotate')) {
                return object.name.charAt(object.name.length - 1).toLowerCase();
            } else if (object.name.startsWith('scale')) {
                return object.name.substring(5).toLowerCase();
            }
            
            // For debugging
            console.log("Intersected object:", object);
        }
        
        return null;
    }
    
    highlightGizmo() {
        const axis = this.getIntersectedGizmo();
        
        // Reset all gizmos to their original colors
        this.resetGizmoColors();
        
        // Highlight the intersected axis
        if (axis) {
            this.highlightAxis(axis);
        }
    }
    
    resetGizmoColors() {
        // Reset translate gizmo colors
        this.translateGizmo.traverse((object) => {
            if (object.userData.gizmoType === 'translate') {
                if (object.isMesh || object.type === 'Mesh') {
                    object.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
                } else if (object.isLine || object.type === 'Line') {
                    object.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
                } else if (object.type === 'ArrowHelper') {
                    if (object.line) object.line.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
                    if (object.cone) object.cone.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
                }
            }
        });
        
        // Reset rotate gizmo colors
        this.rotateGizmo.traverse((object) => {
            if (object.userData.gizmoType === 'rotate' && object.material) {
                object.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
            }
        });
        
        // Reset scale gizmo colors
        this.scaleGizmo.traverse((object) => {
            if (object.userData.gizmoType === 'scale' && object.material) {
                if (object.userData.axis === 'xyz') {
                    object.material.color.setHex(0xffffff);
                } else {
                    object.material.color.setHex(this.axisColors[object.userData.axis] || 0xffffff);
                }
            }
        });
    }
    
    highlightAxis(axis) {
        const highlightColor = this.highlightColor;
        
        switch (this.mode) {
            case 'translate':
                this.translateGizmo.traverse((object) => {
                    if (object.userData.gizmoType === 'translate' && object.userData.axis === axis) {
                        if (object.isMesh || object.type === 'Mesh') {
                            object.material.color.setHex(highlightColor);
                        } else if (object.isLine || object.type === 'Line') {
                            object.material.color.setHex(highlightColor);
                        } else if (object.type === 'ArrowHelper') {
                            if (object.line) object.line.material.color.setHex(highlightColor);
                            if (object.cone) object.cone.material.color.setHex(highlightColor);
                        }
                    }
                });
                break;
                
            case 'rotate':
                this.rotateGizmo.traverse((object) => {
                    if (object.userData.gizmoType === 'rotate' && object.userData.axis === axis && object.material) {
                        object.material.color.setHex(highlightColor);
                    }
                });
                break;
                
            case 'scale':
                this.scaleGizmo.traverse((object) => {
                    if (object.userData.gizmoType === 'scale' && 
                        (object.userData.axis === axis || (axis === 'xyz' && object.userData.axis === 'xyz')) && 
                        object.material) {
                        object.material.color.setHex(highlightColor);
                    }
                });
                break;
        }
    }
    
    getPointOnDragPlane() {
        // Create a plane based on the camera view and selected axis
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        
        let planeNormal;
        
        // Set plane normal based on selected axis and camera direction
        if (this.selectedAxis === 'x') {
            planeNormal = new THREE.Vector3(0, 1, 0);
            if (Math.abs(cameraDirection.dot(planeNormal)) < 0.2) {
                planeNormal.set(0, 0, 1);
            }
        } else if (this.selectedAxis === 'y') {
            planeNormal = new THREE.Vector3(1, 0, 0);
            if (Math.abs(cameraDirection.dot(planeNormal)) < 0.2) {
                planeNormal.set(0, 0, 1);
            }
        } else if (this.selectedAxis === 'z') {
            planeNormal = new THREE.Vector3(1, 0, 0);
            if (Math.abs(cameraDirection.dot(planeNormal)) < 0.2) {
                planeNormal.set(0, 1, 0);
            }
        } else if (this.selectedAxis === 'xyz') {
            planeNormal = cameraDirection;
        }
        
        // Create drag plane
        const plane = new THREE.Plane(planeNormal, -this.targetObject.position.dot(planeNormal));
        
        // Cast ray from mouse and get intersection point with the plane
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const intersectionPoint = new THREE.Vector3();
        const didIntersect = this.raycaster.ray.intersectPlane(plane, intersectionPoint);
        
        if (!didIntersect) {
            console.warn("Failed to intersect with drag plane");
            // Return a fallback point to prevent errors
            return this.targetObject.position.clone();
        }
        
        return intersectionPoint;
    }
    
    handleDrag() {
        if (!this.selectedAxis) return;
        
        // Get current point on drag plane
        this.dragCurrentPoint = this.getPointOnDragPlane();
        
        // Calculate delta movement
        const delta = new THREE.Vector3().subVectors(this.dragCurrentPoint, this.dragStartPoint);
        
        switch (this.mode) {
            case 'translate':
                this.handleTranslation(delta);
                break;
            case 'rotate':
                this.handleRotation(delta);
                break;
            case 'scale':
                this.handleScaling(delta);
                break;
        }
        
        // Update gizmo position to match target object
        this.updateGizmoTransform();
        
        // Update the drag start point to prevent accumulation of tiny movements
        this.dragStartPoint = this.dragCurrentPoint;
    }
    
    handleTranslation(delta) {
        // Restrict movement to the selected axis
        let moveVector = new THREE.Vector3();
        
        if (this.selectedAxis === 'x') {
            moveVector.x = delta.x;
        } else if (this.selectedAxis === 'y') {
            moveVector.y = delta.y;
        } else if (this.selectedAxis === 'z') {
            moveVector.z = delta.z;
        } else if (this.selectedAxis === 'xyz') {
            // Allow movement in all directions for xyz
            moveVector.copy(delta);
        }
        
        // Apply the translation
        this.targetObject.position.add(moveVector);
    }
    
    handleRotation(delta) {
        if (!this.targetObject) return;
        
        // Calculate rotation angle based on mouse movement
        const rotationSpeed = 2.0;
        let angle = 0;
        
        // Calculate angle based on the delta movement and distance from center
        switch (this.selectedAxis) {
            case 'x':
                angle = delta.y * rotationSpeed;
                this.targetObject.rotation.x += angle;
                break;
            case 'y':
                angle = delta.x * rotationSpeed;
                this.targetObject.rotation.y += angle;
                break;
            case 'z':
                angle = (delta.x + delta.y) * rotationSpeed;
                this.targetObject.rotation.z += angle;
                break;
            case 'xyz':
                // For free rotation, we would need quaternions and would be more complex
                break;
        }
    }
    
    handleScaling(delta) {
        if (!this.targetObject) return;
        
        // Calculate scaling factor based on mouse movement
        // Use the dot product of delta and direction from object to camera to determine increase/decrease
        const cameraDelta = new THREE.Vector3().subVectors(this.camera.position, this.targetObject.position).normalize();
        const scaleDirection = Math.sign(delta.dot(cameraDelta));
        
        // Adjust scaling sensitivity
        const scaleFactor = 1 + delta.length() * scaleDirection * 0.1;
        
        // Apply scale based on selected axis
        if (this.selectedAxis === 'xyz') {
            // Uniform scaling
            this.targetObject.scale.multiplyScalar(scaleFactor);
        } else {
            // Scale along specific axis
            if (this.selectedAxis === 'x') {
                this.targetObject.scale.x *= scaleFactor;
            } else if (this.selectedAxis === 'y') {
                this.targetObject.scale.y *= scaleFactor;
            } else if (this.selectedAxis === 'z') {
                this.targetObject.scale.z *= scaleFactor;
            }
        }
    }
    
    attach(object) {
        if (!object) return;
        
        this.detach(); // Detach from previous object if any
        
        this.targetObject = object;
        this.updateGizmoTransform();
        
        // Show the active gizmo
        this.gizmoGroup.visible = true;
        this.setMode(this.mode);
        
        console.log("Attached gizmo to:", object.name);
    }
    
    detach() {
        if (this.isDragging) {
            this.onMouseUp(); // End any active drag operation
        }
        
        this.targetObject = null;
        this.gizmoGroup.visible = false;
        this.translateGizmo.visible = false;
        this.rotateGizmo.visible = false;
        this.scaleGizmo.visible = false;
    }
    
    setMode(mode) {
        this.mode = mode;
        
        // Hide all gizmos
        this.translateGizmo.visible = false;
        this.rotateGizmo.visible = false;
        this.scaleGizmo.visible = false;
        
        // Show the selected gizmo
        switch (mode) {
            case 'translate':
                this.translateGizmo.visible = true;
                break;
            case 'rotate':
                this.rotateGizmo.visible = true;
                break;
            case 'scale':
                this.scaleGizmo.visible = true;
                break;
        }
        
        console.log(`Set gizmo mode: ${mode}`);
    }
    
    updateGizmoTransform() {
        if (!this.targetObject) return;
        
        // Update position to match target object
        this.gizmoGroup.position.copy(this.targetObject.position);
        
        // Calculate appropriate scale for the gizmo based on camera distance
        const distance = this.camera.position.distanceTo(this.gizmoGroup.position);
        const scale = distance / 20; // Adjusted for better visibility
        
        this.gizmoGroup.scale.set(scale, scale, scale);
    }
}