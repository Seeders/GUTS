/**
 * SpawnSystem - Handles particle spawning via mouse input
 *
 * Click and drag to spawn particles, right-click to orbit camera.
 */
class SpawnSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.spawnSystem = this;

        // Current tool settings
        this.selectedMaterial = 1; // Default to sand
        this.brushSize = 3;
        this.spawnRate = 5; // Particles per frame while dragging

        // Mouse state
        this.isSpawning = false;
        this.mouseX = 0;
        this.mouseY = 0;

        // Spawn plane Y position (adjustable)
        this.spawnPlaneY = 50;

        // Tool modes
        this.TOOLS = {
            SAND: 1,
            WATER: 2,
            STONE: 3,
            FIRE: 4,
            WOOD: 5,
            ERASE: -1,
            EMITTER: -2
        };

        // Current tool mode
        this.currentTool = 'spawn'; // 'spawn', 'emitter', 'erase'

        // Emitter dragging state
        this.isDraggingEmitter = false;
        this.emitterMaterialType = 1; // Material for new emitters
    }

    init() {
        console.log('SpawnSystem initializing...');
        // Delay setup to ensure canvas and other systems are ready
        setTimeout(() => {
            this.setupMouseHandlers();
            this.setupUIHandlers();
            console.log('SpawnSystem: Mouse and UI handlers set up');
        }, 200);
        console.log('SpawnSystem initialized');
    }

    setupMouseHandlers() {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('SpawnSystem: gameCanvas not found!');
            return;
        }
        console.log('SpawnSystem: Setting up mouse handlers on canvas');

        // Mouse down - start spawning or handle emitter
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;

                if (this.currentTool === 'emitter') {
                    this.handleEmitterClick();
                } else {
                    this.isSpawning = true;
                    // Immediately spawn on click (don't wait for tick)
                    this.spawnAtMouse();
                }
            }
        });

        // Mouse move - update position and drag emitter
        canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;

            if (this.isDraggingEmitter) {
                this.dragEmitter();
            }
        });

        // Mouse up - stop spawning or dragging
        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.isSpawning = false;
                this.isDraggingEmitter = false;
            }
        });

        // Double click to toggle emitter on/off
        canvas.addEventListener('dblclick', (e) => {
            if (this.currentTool === 'emitter') {
                const emitterSystem = this.game.emitterSystem;
                if (emitterSystem && emitterSystem.selectedEmitter !== -1) {
                    emitterSystem.toggleEmitter(emitterSystem.selectedEmitter);
                }
            }
        });

        // Mouse leave - stop spawning
        canvas.addEventListener('mouseleave', () => {
            this.isSpawning = false;
        });

        // Prevent context menu on right click
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    setupUIHandlers() {
        setTimeout(() => {
            // Material buttons
            const materialBtns = document.querySelectorAll('.material-btn');
            materialBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Remove active class from all
                    materialBtns.forEach(b => b.classList.remove('active'));
                    // Add to clicked
                    btn.classList.add('active');

                    const material = btn.dataset.material;
                    this.selectMaterial(material);
                });
            });

            // Brush size slider
            const brushSlider = document.getElementById('brushSize');
            const brushSizeValue = document.getElementById('brushSizeValue');
            if (brushSlider) {
                brushSlider.addEventListener('input', (e) => {
                    this.brushSize = parseInt(e.target.value, 10);
                    if (brushSizeValue) brushSizeValue.textContent = this.brushSize;
                });
            }

            // Spawn height slider
            const heightSlider = document.getElementById('spawnHeight');
            const heightValue = document.getElementById('spawnHeightValue');
            if (heightSlider) {
                heightSlider.addEventListener('input', (e) => {
                    this.spawnPlaneY = parseInt(e.target.value, 10);
                    if (heightValue) heightValue.textContent = this.spawnPlaneY;
                });
            }

            // Clear button
            const clearBtn = document.getElementById('clearAll');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.clearAll();
                });
            }

            // Pause button
            const pauseBtn = document.getElementById('pauseBtn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', () => {
                    this.togglePause();
                    pauseBtn.textContent = this.game.particlePhysicsSystem?.paused ? 'Resume' : 'Pause';
                });
            }

            // Set default active button
            const defaultBtn = document.querySelector('.material-btn[data-material="sand"]');
            if (defaultBtn) defaultBtn.classList.add('active');
        }, 100);
    }

    selectMaterial(materialName) {
        console.log('selectMaterial called with:', materialName);
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        // Reset tool mode
        this.currentTool = 'spawn';

        switch (materialName) {
            case 'sand':
                this.selectedMaterial = voxelGrid.MATERIAL.SAND;
                this.emitterMaterialType = voxelGrid.MATERIAL.SAND;
                break;
            case 'water':
                this.selectedMaterial = voxelGrid.MATERIAL.WATER;
                this.emitterMaterialType = voxelGrid.MATERIAL.WATER;
                break;
            case 'stone':
                this.selectedMaterial = voxelGrid.MATERIAL.STONE;
                this.emitterMaterialType = voxelGrid.MATERIAL.STONE;
                break;
            case 'fire':
                this.selectedMaterial = voxelGrid.MATERIAL.FIRE;
                this.emitterMaterialType = voxelGrid.MATERIAL.FIRE;
                break;
            case 'wood':
                this.selectedMaterial = voxelGrid.MATERIAL.WOOD;
                this.emitterMaterialType = voxelGrid.MATERIAL.WOOD;
                break;
            case 'erase':
                this.selectedMaterial = this.TOOLS.ERASE;
                this.currentTool = 'erase';
                break;
            case 'emitter':
                this.currentTool = 'emitter';
                break;
            default:
                this.selectedMaterial = voxelGrid.MATERIAL.SAND;
        }
        console.log('currentTool is now:', this.currentTool);
    }

    update() {
        if (this.isSpawning) {
            this.spawnAtMouse();
        }
    }

    spawnAtMouse() {
        const renderSystem = this.game.particleRenderSystem;
        const physicsSystem = this.game.particlePhysicsSystem;
        const voxelGrid = this.game.voxelGridSystem;

        if (!renderSystem || !physicsSystem || !voxelGrid) {
            console.log('SpawnSystem: Missing system -',
                'render:', !!renderSystem,
                'physics:', !!physicsSystem,
                'voxel:', !!voxelGrid);
            return;
        }

        // Raycast to get spawn position
        const worldPos = this.raycastToSpawnPlane();
        if (!worldPos) return;

        // Handle erase tool differently
        if (this.selectedMaterial === this.TOOLS.ERASE) {
            this.eraseAt(worldPos.x, worldPos.y, worldPos.z);
            return;
        }

        // Get bounds for clamping
        const bounds = voxelGrid.getWorldBounds();

        // Spawn particles in a brush area
        for (let i = 0; i < this.spawnRate; i++) {
            // Random position within brush
            const offsetX = (Math.random() - 0.5) * this.brushSize;
            const offsetZ = (Math.random() - 0.5) * this.brushSize;
            const offsetY = Math.random() * 2 + 1; // Spawn slightly above hit point

            // Clamp spawn position to be inside the box
            // Use the raycast hit Y position instead of fixed spawnPlaneY
            let spawnX = Math.max(bounds.minX + 1, Math.min(bounds.maxX - 1, worldPos.x + offsetX));
            let spawnY = Math.max(1, Math.min(bounds.maxY - 1, worldPos.y + offsetY));
            let spawnZ = Math.max(bounds.minZ + 1, Math.min(bounds.maxZ - 1, worldPos.z + offsetZ));

            // Small random initial velocity (downward bias for gravity effect)
            const vx = (Math.random() - 0.5) * 2;
            const vy = -Math.random() * 5; // Start with slight downward velocity
            const vz = (Math.random() - 0.5) * 2;

            const eid = physicsSystem.spawnParticle(
                spawnX, spawnY, spawnZ,
                this.selectedMaterial,
                vx, vy, vz
            );
        }
    }

    raycastToSpawnPlane() {
        const renderSystem = this.game.particleRenderSystem;
        const voxelGrid = this.game.voxelGridSystem;
        if (!renderSystem || !renderSystem.camera || !voxelGrid) return null;

        const rect = renderSystem.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((this.mouseX - rect.left) / rect.width) * 2 - 1,
            -((this.mouseY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, renderSystem.camera);

        // First try to hit actual voxels using ray marching
        const hitResult = this.raycastVoxels(raycaster.ray, voxelGrid);
        if (hitResult) {
            return hitResult;
        }

        // Fallback: intersect with floor plane (y=1, just above the stone floor)
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
        const intersection = new THREE.Vector3();

        if (raycaster.ray.intersectPlane(floorPlane, intersection)) {
            // Clamp to bounds
            const bounds = voxelGrid.getWorldBounds();
            intersection.x = Math.max(bounds.minX, Math.min(bounds.maxX, intersection.x));
            intersection.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, intersection.z));
            return intersection;
        }

        return null;
    }

    /**
     * Raycast through voxel grid to find first non-air voxel hit
     * Returns world position just above the hit voxel
     */
    raycastVoxels(ray, voxelGrid) {
        const origin = ray.origin.clone();
        const direction = ray.direction.clone().normalize();
        const bounds = voxelGrid.getWorldBounds();

        // Step size for ray marching (smaller = more accurate but slower)
        const stepSize = 0.5;
        const maxDistance = 200;

        const pos = origin.clone();
        let distance = 0;

        // March along the ray
        while (distance < maxDistance) {
            // Check if we're inside the grid bounds
            if (pos.x >= bounds.minX && pos.x <= bounds.maxX &&
                pos.y >= bounds.minY && pos.y <= bounds.maxY &&
                pos.z >= bounds.minZ && pos.z <= bounds.maxZ) {

                // Convert to grid coordinates
                const gridCoords = voxelGrid.worldToGrid(pos.x, pos.y, pos.z);

                // Check if this voxel is solid
                const material = voxelGrid.get(gridCoords.x, gridCoords.y, gridCoords.z);
                if (material !== voxelGrid.MATERIAL.AIR) {
                    // Found a hit - return position just above/before the voxel
                    // Step back a bit and return the position above the surface
                    const hitPos = pos.clone();
                    hitPos.sub(direction.clone().multiplyScalar(stepSize));

                    // Snap Y to be on top of the voxel we hit
                    const worldPos = voxelGrid.gridToWorld(gridCoords.x, gridCoords.y, gridCoords.z);
                    hitPos.y = worldPos.y + 0.5; // Top of the voxel

                    return hitPos;
                }
            }

            // Step forward
            pos.add(direction.clone().multiplyScalar(stepSize));
            distance += stepSize;
        }

        return null; // No hit
    }

    eraseAt(x, y, z) {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        const gridCoords = voxelGrid.worldToGrid(x, y, z);
        const radius = Math.ceil(this.brushSize / 2);

        // Erase voxels in radius
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const gx = gridCoords.x + dx;
                    const gy = gridCoords.y + dy;
                    const gz = gridCoords.z + dz;

                    // Don't erase the floor
                    if (gy > 0) {
                        voxelGrid.set(gx, gy, gz, voxelGrid.MATERIAL.AIR);
                    }
                }
            }
        }
    }

    clearAll() {
        const voxelGrid = this.game.voxelGridSystem;
        if (voxelGrid) {
            voxelGrid.clear();
        }

        // Destroy all active particles
        const range = this.game.getEntityRange('particleTag');
        if (range) {
            for (let eid = range.start; eid < range.end; eid++) {
                this.game.destroyEntity(eid);
            }
        }
    }

    togglePause() {
        const physicsSystem = this.game.particlePhysicsSystem;
        if (physicsSystem) {
            physicsSystem.paused = !physicsSystem.paused;
        }
    }

    /**
     * Handle click in emitter mode
     */
    handleEmitterClick() {
        console.log('handleEmitterClick called');
        console.log('this.game:', this.game);
        console.log('this.game.emitterSystem:', this.game.emitterSystem);
        const emitterSystem = this.game.emitterSystem;
        if (!emitterSystem) {
            console.log('No emitter system found!');
            return;
        }

        // Check if clicking on existing emitter
        const hitEmitter = emitterSystem.raycastEmitter(this.mouseX, this.mouseY);
        console.log('Raycast hit emitter:', hitEmitter);

        if (hitEmitter !== -1) {
            // Select and start dragging the emitter
            emitterSystem.selectEmitter(hitEmitter);
            this.isDraggingEmitter = true;
        } else {
            // Create new emitter at click position
            const worldPos = this.raycastToSpawnPlane();
            console.log('World pos for emitter:', worldPos);
            if (worldPos) {
                const voxelGrid = this.game.voxelGridSystem;
                const bounds = voxelGrid.getWorldBounds();

                // Clamp to bounds
                const x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, worldPos.x));
                const z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, worldPos.z));

                console.log('Creating emitter at:', x, this.spawnPlaneY, z, 'material:', this.emitterMaterialType);
                const eid = emitterSystem.createEmitter(x, this.spawnPlaneY, z, this.emitterMaterialType);
                emitterSystem.selectEmitter(eid);
            }
        }
    }

    /**
     * Drag selected emitter to mouse position
     */
    dragEmitter() {
        const emitterSystem = this.game.emitterSystem;
        if (!emitterSystem || emitterSystem.selectedEmitter === -1) return;

        const worldPos = this.raycastToSpawnPlane();
        if (!worldPos) return;

        const voxelGrid = this.game.voxelGridSystem;
        const bounds = voxelGrid.getWorldBounds();

        // Clamp to bounds
        const x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, worldPos.x));
        const z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, worldPos.z));

        emitterSystem.moveEmitter(emitterSystem.selectedEmitter, x, this.spawnPlaneY, z);
    }

    /**
     * Delete selected emitter (called from UI)
     */
    deleteSelectedEmitter() {
        const emitterSystem = this.game.emitterSystem;
        if (emitterSystem && emitterSystem.selectedEmitter !== -1) {
            emitterSystem.removeEmitter(emitterSystem.selectedEmitter);
        }
    }
}
