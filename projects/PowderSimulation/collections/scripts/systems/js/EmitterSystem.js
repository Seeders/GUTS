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
        this.isDragging = false;
        this.dragOffset = { x: 0, z: 0 };

        // Emitter visuals
        this.emitterMeshes = new Map(); // eid -> THREE.Mesh
        this.visualsReady = false;

        // Frame counter for spawn rate limiting
        this.frameCounter = 0;
    }

    init() {
        console.log('EmitterSystem initializing...');
        this.setupEmitterVisuals();
        console.log('EmitterSystem initialized');
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
            enabled: 1,
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

        const mesh = new THREE.Mesh(this.emitterGeometry, this.emitterMaterialActive);
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
            this.selectedEmitter = -1;
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

        const dt = this.game.deltaTime;

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
