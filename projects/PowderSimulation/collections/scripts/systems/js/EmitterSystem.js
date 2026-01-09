/**
 * EmitterSystem - Manages particle emitters that continuously spawn particles
 *
 * Emitters can be placed, moved, toggled, and configured.
 */
class EmitterSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.emitterSystem = this;
        console.log('EmitterSystem constructor - registered on game object');

        // Selected emitter for editing
        this.selectedEmitter = -1;

        // Emitter visuals
        this.emitterMeshes = new Map(); // eid -> THREE.Mesh
        this.visualsReady = false;

        // Gizmo for emitter manipulation
        this.gizmoGroup = null;
        this.isDragging = false;
        this.selectedAxis = null;

        // Frame counter for spawn rate limiting
        this.frameCounter = 0;

        // Paused state and speed multiplier
        this.paused = false;
        this.speedMultiplier = 1.0;
    }

    init() {
        console.log('EmitterSystem initializing...');
        this.setupEmitterVisuals();
        this.setupTransformControls();
        // Create default emitters after systems are ready
        setTimeout(() => this.createDefaultEmitters(), 500);
        console.log('EmitterSystem initialized');
    }

    /**
     * Create default sand and water emitters
     */
    createDefaultEmitters() {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) {
            console.log('EmitterSystem: VoxelGrid not ready, retrying...');
            setTimeout(() => this.createDefaultEmitters(), 100);
            return;
        }

        const bounds = voxelGrid.getWorldBounds();
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;
        const y = 50;

        // Create sand emitter (offset to the left)
        const sandEid = this.createEmitter(centerX - 15, y, centerZ, voxelGrid.MATERIAL.SAND);
        // Turn it on
        const enabled = this.game.getFieldArray('emitter', 'enabled');
        if (enabled && sandEid !== undefined) {
            enabled[sandEid] = 1;
            this.updateEmitterMesh(sandEid);
        }

        // Create water emitter (offset to the right)
        const waterEid = this.createEmitter(centerX + 15, y, centerZ, voxelGrid.MATERIAL.WATER);
        // Turn it on
        if (enabled && waterEid !== undefined) {
            enabled[waterEid] = 1;
            this.updateEmitterMesh(waterEid);
        }

        console.log('EmitterSystem: Created default sand and water emitters');
    }

    setupEmitterVisuals() {
        // Create a reusable geometry for emitter indicators
        this.emitterGeometry = new THREE.ConeGeometry(1.5, 3, 8);
        this.emitterGeometry.rotateX(Math.PI); // Point downward

        this.emitterMaterialActive = new THREE.MeshLambertMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });

        this.emitterMaterialInactive = new THREE.MeshLambertMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5
        });

        this.emitterMaterialSelected = new THREE.MeshLambertMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.9
        });

        this.visualsReady = true;
    }

    setupTransformControls() {
        const renderSystem = this.game.particleRenderSystem;
        if (!renderSystem || !renderSystem.camera || !renderSystem.renderer) {
            // Retry after render system is ready
            setTimeout(() => this.setupTransformControls(), 100);
            return;
        }

        // Create custom gizmo group for translate arrows
        this.gizmoGroup = new THREE.Group();
        this.gizmoGroup.visible = false;
        renderSystem.scene.add(this.gizmoGroup);

        const arrowLength = 8;
        const arrowHeadLength = 2;
        const arrowHeadWidth = 1;

        // X-axis (red)
        const xCylinderGeometry = new THREE.CylinderGeometry(0.3, 0.3, arrowLength - arrowHeadLength, 8);
        const xCylinderMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const xCylinder = new THREE.Mesh(xCylinderGeometry, xCylinderMaterial);
        xCylinder.rotation.z = Math.PI / 2;
        xCylinder.position.x = (arrowLength - arrowHeadLength) / 2;
        xCylinder.name = "translate-x";
        this.gizmoGroup.add(xCylinder);

        const xConeGeometry = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
        const xConeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const xCone = new THREE.Mesh(xConeGeometry, xConeMaterial);
        xCone.rotation.z = -Math.PI / 2;
        xCone.position.x = arrowLength - arrowHeadLength / 2;
        xCone.name = "translate-x";
        this.gizmoGroup.add(xCone);

        // Y-axis (green)
        const yCylinderGeometry = new THREE.CylinderGeometry(0.3, 0.3, arrowLength - arrowHeadLength, 8);
        const yCylinderMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const yCylinder = new THREE.Mesh(yCylinderGeometry, yCylinderMaterial);
        yCylinder.position.y = (arrowLength - arrowHeadLength) / 2;
        yCylinder.name = "translate-y";
        this.gizmoGroup.add(yCylinder);

        const yConeGeometry = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
        const yConeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const yCone = new THREE.Mesh(yConeGeometry, yConeMaterial);
        yCone.position.y = arrowLength - arrowHeadLength / 2;
        yCone.name = "translate-y";
        this.gizmoGroup.add(yCone);

        // Z-axis (blue)
        const zCylinderGeometry = new THREE.CylinderGeometry(0.3, 0.3, arrowLength - arrowHeadLength, 8);
        const zCylinderMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const zCylinder = new THREE.Mesh(zCylinderGeometry, zCylinderMaterial);
        zCylinder.rotation.x = Math.PI / 2;
        zCylinder.position.z = (arrowLength - arrowHeadLength) / 2;
        zCylinder.name = "translate-z";
        this.gizmoGroup.add(zCylinder);

        const zConeGeometry = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
        const zConeMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const zCone = new THREE.Mesh(zConeGeometry, zConeMaterial);
        zCone.rotation.x = Math.PI / 2;
        zCone.position.z = arrowLength - arrowHeadLength / 2;
        zCone.name = "translate-z";
        this.gizmoGroup.add(zCone);

        // Setup mouse handling for gizmo
        this.isDragging = false;
        this.selectedAxis = null;
        this.mouse = new THREE.Vector2();
        this.lastMouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();

        const canvas = renderSystem.renderer.domElement;
        canvas.addEventListener('mousedown', (e) => this.onGizmoMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onGizmoMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onGizmoMouseUp(e));

        console.log('EmitterSystem: Custom gizmo initialized');
    }

    onGizmoMouseDown(event) {
        if (!this.gizmoGroup || !this.gizmoGroup.visible) return;
        if (event.button !== 0) return; // Left click only

        const renderSystem = this.game.particleRenderSystem;
        const canvas = renderSystem.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, renderSystem.camera);
        const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, true);

        if (intersects.length > 0) {
            const object = intersects[0].object;
            this.selectedAxis = object.name.split('-')[1];
            this.isDragging = true;
            this.lastMouse.copy(this.mouse);

            // Disable orbit controls while dragging
            if (renderSystem.controls) {
                renderSystem.controls.enabled = false;
            }

            event.stopPropagation();
        }
    }

    onGizmoMouseMove(event) {
        if (!this.isDragging || !this.selectedAxis || this.selectedEmitter === -1) return;

        const renderSystem = this.game.particleRenderSystem;
        const canvas = renderSystem.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const mesh = this.emitterMeshes.get(this.selectedEmitter);
        if (!mesh) return;

        const camera = renderSystem.camera;

        // Get the world axis direction
        let axisDirection;
        if (this.selectedAxis === 'x') {
            axisDirection = new THREE.Vector3(1, 0, 0);
        } else if (this.selectedAxis === 'y') {
            axisDirection = new THREE.Vector3(0, 1, 0);
        } else if (this.selectedAxis === 'z') {
            axisDirection = new THREE.Vector3(0, 0, 1);
        }

        // Project the axis onto screen space to determine how mouse movement maps to world movement
        const objectPos = mesh.position.clone();
        const axisEnd = objectPos.clone().add(axisDirection);

        // Project both points to screen space
        const screenStart = objectPos.clone().project(camera);
        const screenEnd = axisEnd.clone().project(camera);

        // Get the screen-space direction of the axis
        const screenAxisDir = new THREE.Vector2(
            screenEnd.x - screenStart.x,
            screenEnd.y - screenStart.y
        );

        // If axis is nearly perpendicular to view, don't move
        const screenAxisLength = screenAxisDir.length();
        if (screenAxisLength < 0.001) {
            this.lastMouse.copy(this.mouse);
            return;
        }

        screenAxisDir.normalize();

        // Get mouse delta
        const deltaMouse = new THREE.Vector2(
            this.mouse.x - this.lastMouse.x,
            this.mouse.y - this.lastMouse.y
        );

        // Project mouse movement onto the screen-space axis direction
        const projectedMovement = deltaMouse.dot(screenAxisDir);

        // Calculate scale factor based on how much 1 world unit moves in screen space
        // This makes the emitter track the mouse more accurately
        const worldMovement = projectedMovement / screenAxisLength;

        // Apply movement along the world axis
        if (this.selectedAxis === 'x') {
            mesh.position.x += worldMovement;
        } else if (this.selectedAxis === 'y') {
            mesh.position.y += worldMovement;
        } else if (this.selectedAxis === 'z') {
            mesh.position.z += worldMovement;
        }

        // Sync to ECS
        const posX = this.game.getFieldArray('position', 'x');
        const posY = this.game.getFieldArray('position', 'y');
        const posZ = this.game.getFieldArray('position', 'z');
        if (posX) {
            posX[this.selectedEmitter] = mesh.position.x;
            posY[this.selectedEmitter] = mesh.position.y;
            posZ[this.selectedEmitter] = mesh.position.z;
        }

        // Update gizmo position
        this.gizmoGroup.position.copy(mesh.position);

        this.lastMouse.copy(this.mouse);
    }

    onGizmoMouseUp(event) {
        if (this.isDragging) {
            const renderSystem = this.game.particleRenderSystem;
            if (renderSystem.controls) {
                renderSystem.controls.enabled = true;
            }
        }
        this.isDragging = false;
        this.selectedAxis = null;
    }

    updateGizmoPosition() {
        if (!this.gizmoGroup) return;

        if (this.selectedEmitter !== -1) {
            const mesh = this.emitterMeshes.get(this.selectedEmitter);
            if (mesh) {
                this.gizmoGroup.position.copy(mesh.position);
                this.gizmoGroup.visible = true;
            }
        } else {
            this.gizmoGroup.visible = false;
        }
    }

    /**
     * Check if a screen position would hit the gizmo
     */
    isClickOnGizmo(screenX, screenY) {
        if (!this.gizmoGroup || !this.gizmoGroup.visible) return false;

        const renderSystem = this.game.particleRenderSystem;
        if (!renderSystem || !renderSystem.camera) return false;

        const canvas = renderSystem.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((screenX - rect.left) / rect.width) * 2 - 1,
            -((screenY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, renderSystem.camera);
        const intersects = raycaster.intersectObjects(this.gizmoGroup.children, true);

        return intersects.length > 0;
    }

    /**
     * Create a new emitter at world position
     */
    createEmitter(x, y, z, materialType = 1) {
        // Initialize visuals if not ready
        if (!this.visualsReady) {
            this.setupEmitterVisuals();
        }

        const eid = this.game.createEntity();

        this.game.addComponent(eid, 'position', { x, y, z });
        this.game.addComponent(eid, 'emitter', {
            materialType: materialType,
            rate: 5,
            enabled: 0,  // Off by default
            radius: 2
        });

        // Create visual mesh
        this.createEmitterMesh(eid, x, y, z);

        console.log('EmitterSystem: Created emitter', eid, 'at', x, y, z);
        return eid;
    }

    createEmitterMesh(eid, x, y, z) {
        const renderSystem = this.game.particleRenderSystem;
        if (!renderSystem || !renderSystem.scene) return;

        // Start with inactive material since emitters are off by default
        const mesh = new THREE.Mesh(this.emitterGeometry, this.emitterMaterialInactive);
        mesh.position.set(x, y, z);
        mesh.userData.emitterId = eid;

        renderSystem.scene.add(mesh);
        this.emitterMeshes.set(eid, mesh);
    }

    /**
     * Remove an emitter
     */
    removeEmitter(eid) {
        const mesh = this.emitterMeshes.get(eid);
        if (mesh) {
            const renderSystem = this.game.particleRenderSystem;
            if (renderSystem && renderSystem.scene) {
                renderSystem.scene.remove(mesh);
            }
            this.emitterMeshes.delete(eid);
        }

        this.game.destroyEntity(eid);

        if (this.selectedEmitter === eid) {
            // Use selectEmitter to properly update UI state
            this.selectEmitter(-1);
        }
    }

    /**
     * Toggle emitter on/off
     */
    toggleEmitter(eid) {
        const enabled = this.game.getFieldArray('emitter', 'enabled');
        if (enabled) {
            enabled[eid] = enabled[eid] ? 0 : 1;
            this.updateEmitterMesh(eid);
        }
    }

    /**
     * Select an emitter for editing
     */
    selectEmitter(eid) {
        // Deselect previous
        if (this.selectedEmitter !== -1) {
            this.updateEmitterMesh(this.selectedEmitter);
        }

        this.selectedEmitter = eid;

        if (eid !== -1) {
            this.updateEmitterMesh(eid);
        }

        // Update gizmo visibility and position
        this.updateGizmoPosition();

        // Update delete button state
        const deleteBtn = document.getElementById('deleteEmitterBtn');
        if (deleteBtn) {
            deleteBtn.disabled = (eid === -1);
        }
    }

    /**
     * Move selected emitter to new position
     */
    moveEmitter(eid, x, y, z) {
        const posX = this.game.getFieldArray('position', 'x');
        const posY = this.game.getFieldArray('position', 'y');
        const posZ = this.game.getFieldArray('position', 'z');

        if (posX) {
            posX[eid] = x;
            posY[eid] = y;
            posZ[eid] = z;

            // Update mesh position
            const mesh = this.emitterMeshes.get(eid);
            if (mesh) {
                mesh.position.set(x, y, z);
            }
        }
    }

    updateEmitterMesh(eid) {
        const mesh = this.emitterMeshes.get(eid);
        if (!mesh) return;

        const enabled = this.game.getFieldArray('emitter', 'enabled');
        const isEnabled = enabled ? enabled[eid] : 0;

        if (eid === this.selectedEmitter) {
            mesh.material = this.emitterMaterialSelected;
        } else if (isEnabled) {
            mesh.material = this.emitterMaterialActive;
        } else {
            mesh.material = this.emitterMaterialInactive;
        }
    }

    /**
     * Raycast to find emitter under mouse
     */
    raycastEmitter(screenX, screenY) {
        const renderSystem = this.game.particleRenderSystem;
        if (!renderSystem || !renderSystem.camera) return -1;

        const rect = renderSystem.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((screenX - rect.left) / rect.width) * 2 - 1,
            -((screenY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, renderSystem.camera);

        // Get all emitter meshes
        const meshes = Array.from(this.emitterMeshes.values());
        const intersects = raycaster.intersectObjects(meshes);

        if (intersects.length > 0) {
            return intersects[0].object.userData.emitterId;
        }

        return -1;
    }

    update() {
        if (this.paused) return;

        const physicsSystem = this.game.particlePhysicsSystem;
        if (!physicsSystem) return;

        // Get emitter arrays
        const posX = this.game.getFieldArray('position', 'x');
        const posY = this.game.getFieldArray('position', 'y');
        const posZ = this.game.getFieldArray('position', 'z');
        const emitterMat = this.game.getFieldArray('emitter', 'materialType');
        const emitterRate = this.game.getFieldArray('emitter', 'rate');
        const emitterEnabled = this.game.getFieldArray('emitter', 'enabled');
        const emitterRadius = this.game.getFieldArray('emitter', 'radius');

        if (!posX || !emitterMat) {
            return;
        }

        // Apply speed multiplier to deltaTime
        const dt = this.game.deltaTime * this.speedMultiplier;

        // Iterate through emitters
        for (const [eid, mesh] of this.emitterMeshes) {
            if (!emitterEnabled[eid]) continue;

            const rate = emitterRate[eid] || 5;

            // Spawn based on rate (particles per second)
            // rate * dt gives expected spawns per tick
            const spawnChance = rate * dt;

            if (Math.random() < spawnChance) {
                const x = posX[eid];
                const y = posY[eid];
                const z = posZ[eid];
                const mat = emitterMat[eid];
                const radius = emitterRadius[eid] || 2;

                // Random offset within radius
                const offsetX = (Math.random() - 0.5) * radius;
                const offsetZ = (Math.random() - 0.5) * radius;

                // Spawn with slight downward velocity
                physicsSystem.spawnParticle(
                    x + offsetX,
                    y - 2, // Spawn slightly below emitter
                    z + offsetZ,
                    mat,
                    (Math.random() - 0.5) * 2,
                    -Math.random() * 3,
                    (Math.random() - 0.5) * 2
                );
            }
        }
    }

    /**
     * Get all emitter entity IDs
     */
    getAllEmitters() {
        return Array.from(this.emitterMeshes.keys());
    }

    /**
     * Clear all emitters
     */
    clearAllEmitters() {
        for (const eid of this.emitterMeshes.keys()) {
            this.removeEmitter(eid);
        }
    }
}
