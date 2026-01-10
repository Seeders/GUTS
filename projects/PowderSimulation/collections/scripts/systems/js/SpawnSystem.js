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

        // Tool modes
        this.TOOLS = {
            SAND: 1,
            WATER: 2,
            STONE: 3,
            FIRE: 4,
            WOOD: 5,
            ERASE: -1
        };

        // Current tool mode
        this.currentTool = 'spawn'; // 'spawn', 'erase'

        // Material type for new emitters
        this.emitterMaterialType = 1;
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

        // Mouse down - start spawning or handle emitter selection
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                this.mouseX = e.clientX;
                this.mouseY = e.clientY;

                const emitterSystem = this.game.emitterSystem;

                // Check if clicking on gizmo first (if visible)
                if (emitterSystem && emitterSystem.isClickOnGizmo(this.mouseX, this.mouseY)) {
                    // Let the gizmo handle it, don't spawn
                    return;
                }

                // Check if clicking on an existing emitter
                if (emitterSystem) {
                    const hitEmitter = emitterSystem.raycastEmitter(this.mouseX, this.mouseY);
                    if (hitEmitter !== -1) {
                        // Select the emitter (gizmo will handle dragging)
                        emitterSystem.selectEmitter(hitEmitter);
                        return;
                    }

                    // Clicked on nothing - deselect emitter if one is selected
                    // Don't spawn on this click, just deselect
                    if (emitterSystem.selectedEmitter !== -1) {
                        emitterSystem.selectEmitter(-1);
                        return;
                    }
                }

                // Otherwise, spawn particles
                this.isSpawning = true;
                // Immediately spawn on click (don't wait for tick)
                this.spawnAtMouse();
            }
        });

        // Mouse move - update position
        canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });

        // Mouse up - stop spawning
        canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.isSpawning = false;
            }
        });

        // Double click to toggle emitter on/off (if clicking on an emitter)
        canvas.addEventListener('dblclick', (e) => {
            const emitterSystem = this.game.emitterSystem;
            if (emitterSystem) {
                const hitEmitter = emitterSystem.raycastEmitter(e.clientX, e.clientY);
                if (hitEmitter !== -1) {
                    emitterSystem.toggleEmitter(hitEmitter);
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

        // Escape key to deselect emitter
        document.addEventListener('keydown', (e) => {
            const emitterSystem = this.game.emitterSystem;
            if (!emitterSystem) return;

            if (e.key === 'Escape') {
                if (emitterSystem.selectedEmitter !== -1) {
                    emitterSystem.selectEmitter(-1);
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (emitterSystem.selectedEmitter !== -1) {
                    emitterSystem.removeEmitter(emitterSystem.selectedEmitter);
                }
            }
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

            // Create Emitter button
            const createEmitterBtn = document.getElementById('createEmitterBtn');
            if (createEmitterBtn) {
                createEmitterBtn.addEventListener('click', () => {
                    this.createEmitterAtCenter();
                });
            }

            // Delete Emitter button
            const deleteEmitterBtn = document.getElementById('deleteEmitterBtn');
            if (deleteEmitterBtn) {
                deleteEmitterBtn.addEventListener('click', () => {
                    this.deleteSelectedEmitter();
                });
            }

            // Clear button
            const clearBtn = document.getElementById('clearAll');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.clearAll();
                });
            }

            // Simulation speed slider
            const simSpeedSlider = document.getElementById('simSpeed');
            const simSpeedValue = document.getElementById('simSpeedValue');
            if (simSpeedSlider) {
                simSpeedSlider.addEventListener('input', (e) => {
                    const speed = parseFloat(e.target.value);
                    if (simSpeedValue) {
                        simSpeedValue.textContent = speed === 0 ? 'Paused' : speed.toFixed(2) + 'x';
                    }
                    this.setSimulationSpeed(speed);
                });
            }

            // Pause button
            const pauseBtn = document.getElementById('pauseBtn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', () => {
                    this.togglePause();
                    const isPaused = this.game.particlePhysicsSystem?.paused;
                    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
                    // Sync slider when pausing/resuming
                    if (simSpeedSlider && simSpeedValue) {
                        if (isPaused) {
                            simSpeedSlider.value = 0;
                            simSpeedValue.textContent = 'Paused';
                        } else {
                            simSpeedSlider.value = this.game.particlePhysicsSystem?.speedMultiplier || 1;
                            simSpeedValue.textContent = (this.game.particlePhysicsSystem?.speedMultiplier || 1).toFixed(2) + 'x';
                        }
                    }
                });
            }

            // Toggle UI button
            const toggleUIBtn = document.getElementById('toggleUIBtn');
            const toolPalette = document.getElementById('toolPalette');
            if (toggleUIBtn && toolPalette) {
                toggleUIBtn.addEventListener('click', () => {
                    toolPalette.classList.toggle('hidden');
                    toggleUIBtn.textContent = toolPalette.classList.contains('hidden') ? 'Menu' : 'Hide';
                });
            }

            // Set default active button
            const defaultBtn = document.querySelector('.material-btn[data-material="sand"]');
            if (defaultBtn) defaultBtn.classList.add('active');

            // Shape buttons
            const shapeBtns = document.querySelectorAll('.shape-btn');
            shapeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const shape = btn.dataset.shape;
                    this.createShape(shape);
                });
            });
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

    setSimulationSpeed(speed) {
        const physicsSystem = this.game.particlePhysicsSystem;
        const voxelGrid = this.game.voxelGridSystem;
        const emitterSystem = this.game.emitterSystem;

        if (speed === 0) {
            // Pause all systems
            if (physicsSystem) physicsSystem.paused = true;
            if (voxelGrid) voxelGrid.paused = true;
            if (emitterSystem) emitterSystem.paused = true;
        } else {
            // Unpause and set speed multiplier
            if (physicsSystem) {
                physicsSystem.paused = false;
                physicsSystem.speedMultiplier = speed;
            }
            if (voxelGrid) {
                voxelGrid.paused = false;
                voxelGrid.speedMultiplier = speed;
            }
            if (emitterSystem) {
                emitterSystem.paused = false;
                emitterSystem.speedMultiplier = speed;
            }
        }
    }

    /**
     * Create an emitter at the center of the box for the currently selected material
     */
    createEmitterAtCenter() {
        const emitterSystem = this.game.emitterSystem;
        const voxelGrid = this.game.voxelGridSystem;

        if (!emitterSystem || !voxelGrid) {
            console.log('Cannot create emitter - missing system');
            return;
        }

        const bounds = voxelGrid.getWorldBounds();

        // Calculate center of the box
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;
        const y = 50; // Fixed emitter spawn height

        // Use the currently selected material (unless it's erase)
        let material = this.selectedMaterial;
        if (material === this.TOOLS.ERASE) {
            material = voxelGrid.MATERIAL.SAND; // Default to sand for erase tool
        }

        console.log('Creating emitter at center:', centerX, y, centerZ, 'material:', material);
        emitterSystem.createEmitter(centerX, y, centerZ, material);
        // Don't auto-select - user clicks to select and show gizmo
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

    /**
     * Create a shape at the center of the grid using the selected material
     */
    createShape(shapeType) {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        // Use selected material (default to stone if erase is selected)
        let material = this.selectedMaterial;
        if (material === this.TOOLS.ERASE || material <= 0) {
            material = voxelGrid.MATERIAL.STONE;
        }

        // Get grid center
        const centerX = Math.floor(voxelGrid.sizeX / 2);
        const centerZ = Math.floor(voxelGrid.sizeZ / 2);
        const baseY = 1; // Just above the floor

        console.log(`Creating ${shapeType} with material ${material}`);

        switch (shapeType) {
            case 'cylinder':
                this.createCylinder(voxelGrid, centerX, baseY, centerZ, 12, 20, material);
                break;
            case 'box':
                this.createHollowBox(voxelGrid, centerX, baseY, centerZ, 20, 15, 20, material);
                break;
            case 'sphere':
                this.createSphere(voxelGrid, centerX, baseY + 10, centerZ, 8, material);
                break;
            case 'platform':
                this.createPlatform(voxelGrid, centerX, baseY + 10, centerZ, 25, 25, material);
                break;
        }
    }

    /**
     * Create a hollow cylinder (container)
     */
    createCylinder(voxelGrid, cx, baseY, cz, radius, height, material) {
        const wallThickness = 1;

        for (let y = baseY; y < baseY + height; y++) {
            for (let x = cx - radius; x <= cx + radius; x++) {
                for (let z = cz - radius; z <= cz + radius; z++) {
                    const dx = x - cx;
                    const dz = z - cz;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    // Create walls (outer ring)
                    if (dist <= radius && dist > radius - wallThickness) {
                        voxelGrid.set(x, y, z, material);
                    }
                    // Create floor (only at base)
                    else if (y === baseY && dist <= radius - wallThickness) {
                        voxelGrid.set(x, y, z, material);
                    }
                }
            }
        }
    }

    /**
     * Create a hollow box (container)
     */
    createHollowBox(voxelGrid, cx, baseY, cz, width, height, depth, material) {
        const halfW = Math.floor(width / 2);
        const halfD = Math.floor(depth / 2);

        for (let y = baseY; y < baseY + height; y++) {
            for (let x = cx - halfW; x <= cx + halfW; x++) {
                for (let z = cz - halfD; z <= cz + halfD; z++) {
                    const onEdgeX = (x === cx - halfW || x === cx + halfW);
                    const onEdgeZ = (z === cz - halfD || z === cz + halfD);

                    // Create walls
                    if (onEdgeX || onEdgeZ) {
                        voxelGrid.set(x, y, z, material);
                    }
                    // Create floor (only at base)
                    else if (y === baseY) {
                        voxelGrid.set(x, y, z, material);
                    }
                }
            }
        }
    }

    /**
     * Create a solid sphere
     */
    createSphere(voxelGrid, cx, cy, cz, radius, material) {
        for (let x = cx - radius; x <= cx + radius; x++) {
            for (let y = cy - radius; y <= cy + radius; y++) {
                for (let z = cz - radius; z <= cz + radius; z++) {
                    const dx = x - cx;
                    const dy = y - cy;
                    const dz = z - cz;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (dist <= radius) {
                        voxelGrid.set(x, y, z, material);
                    }
                }
            }
        }
    }

    /**
     * Create a flat platform
     */
    createPlatform(voxelGrid, cx, y, cz, width, depth, material) {
        const halfW = Math.floor(width / 2);
        const halfD = Math.floor(depth / 2);

        for (let x = cx - halfW; x <= cx + halfW; x++) {
            for (let z = cz - halfD; z <= cz + halfD; z++) {
                voxelGrid.set(x, y, z, material);
            }
        }
    }
}
