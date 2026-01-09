/**
 * ParticleRenderSystem - Renders particles and voxels using Three.js
 *
 * Uses instanced rendering for both active particles and settled voxels.
 */
class ParticleRenderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.particleRenderSystem = this;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Particle rendering
        this.particleGeometry = null;
        this.particleMaterials = {}; // Material type -> THREE.Material
        this.activeParticleMesh = null;
        this.maxActiveParticles = 100000;

        // Voxel rendering
        this.voxelGeometry = null;
        this.voxelMesh = null;
        this.maxVoxels = 500000;

        // Instance matrices and colors
        this.particleMatrices = null;
        this.particleColors = null;
        this.voxelMatrices = null;
        this.voxelColors = null;

        // Temp matrix for calculations
        this._tempMatrix = null;
        this._tempColor = null;

        // Camera settings
        this.cameraDistance = 80;

        // Boundary visualization
        this.boundaryBox = null;

        // Performance
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.fps = 0;

        // Throttle voxel updates
        this.voxelUpdateCounter = 0;
        this.voxelUpdateInterval = 3; // Update voxels every N frames

        // Cached DOM elements
        this._domActiveCount = null;
        this._domSettledCount = null;
        this._domFpsDisplay = null;
    }

    init() {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            console.log('ParticleRenderSystem: Skipping init (not in browser)');
            return;
        }

        console.log('ParticleRenderSystem initializing...');

        this._tempMatrix = new THREE.Matrix4();
        this._tempColor = new THREE.Color();

        this.initThreeJs();
        this.createGeometries();
        this.createInstancedMeshes();
        this.createBoundaryVisualization();
        this.cacheUIElements();

        console.log('ParticleRenderSystem initialized');
    }

    initThreeJs() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.set(60, 80, 100);
        this.camera.lookAt(0, 25, 0);

        // Get canvas
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('ParticleRenderSystem: gameCanvas not found');
            return;
        }

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Add orbit controls
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(0, 25, 0);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            // Disable left click for orbit controls (used for spawning)
            // Right-drag to rotate, middle-drag to pan
            this.controls.mouseButtons = {
                LEFT: -1, // Disable
                MIDDLE: 2, // PAN
                RIGHT: 0  // ROTATE
            };
            this.controls.update();
            console.log('ParticleRenderSystem: OrbitControls initialized');
        } else {
            console.warn('ParticleRenderSystem: OrbitControls not available');
        }

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
        directionalLight2.position.set(-50, 50, -50);
        this.scene.add(directionalLight2);

        // Handle resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createGeometries() {
        // Small cube for particles
        this.particleGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);

        // Cube for voxels
        this.voxelGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    }

    createInstancedMeshes() {
        // Active particles - use vertex colors
        const particleMaterial = new THREE.MeshLambertMaterial({
            vertexColors: false
        });

        this.activeParticleMesh = new THREE.InstancedMesh(
            this.particleGeometry,
            particleMaterial,
            this.maxActiveParticles
        );
        this.activeParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.activeParticleMesh.frustumCulled = false;
        this.activeParticleMesh.count = 0;

        // Add per-instance colors
        this.particleColors = new Float32Array(this.maxActiveParticles * 3);
        this.activeParticleMesh.instanceColor = new THREE.InstancedBufferAttribute(
            this.particleColors, 3
        );

        this.scene.add(this.activeParticleMesh);

        // Settled voxels
        const voxelMaterial = new THREE.MeshLambertMaterial({
            vertexColors: false
        });

        this.voxelMesh = new THREE.InstancedMesh(
            this.voxelGeometry,
            voxelMaterial,
            this.maxVoxels
        );
        this.voxelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.voxelMesh.frustumCulled = false;
        this.voxelMesh.count = 0;

        this.voxelColors = new Float32Array(this.maxVoxels * 3);
        this.voxelMesh.instanceColor = new THREE.InstancedBufferAttribute(
            this.voxelColors, 3
        );

        this.scene.add(this.voxelMesh);

        // Pre-allocate matrices
        this.particleMatrices = new Float32Array(this.maxActiveParticles * 16);
        this.voxelMatrices = new Float32Array(this.maxVoxels * 16);
    }

    createBoundaryVisualization() {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        const bounds = voxelGrid.getWorldBounds();
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const depth = bounds.maxZ - bounds.minZ;

        const geometry = new THREE.BoxGeometry(width, height, depth);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({ color: 0x444444 });
        this.boundaryBox = new THREE.LineSegments(edges, material);
        this.boundaryBox.position.set(0, height / 2, 0);
        this.scene.add(this.boundaryBox);
    }

    cacheUIElements() {
        setTimeout(() => {
            this._domActiveCount = document.getElementById('activeCount');
            this._domSettledCount = document.getElementById('settledCount');
            this._domFpsDisplay = document.getElementById('fpsDisplay');
        }, 100);
    }

    getMaterialColor(materialType) {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return 0xffffff;
        return voxelGrid.MATERIAL_COLORS[materialType] || 0xffffff;
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;

        // Update active particles
        this.updateActiveParticles();

        // Update settled voxels (throttled, only when dirty)
        this.voxelUpdateCounter++;
        if (this.voxelUpdateCounter >= this.voxelUpdateInterval) {
            this.voxelUpdateCounter = 0;
            this.updateSettledVoxels();
        }

        // Update controls
        if (this.controls) {
            this.controls.update();
        }

        // Update FPS
        this.updateFPS();

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    updateActiveParticles() {
        const physicsSystem = this.game.particlePhysicsSystem;
        if (!physicsSystem) return;

        const range = this.game.getEntityRange('particleTag');
        if (!range || range.count === 0) {
            this.activeParticleMesh.count = 0;
            return;
        }

        const posX = this.game.getFieldArray('position', 'x');
        const posY = this.game.getFieldArray('position', 'y');
        const posZ = this.game.getFieldArray('position', 'z');
        const material = this.game.getFieldArray('material', 'type');

        if (!posX || !material) return;

        const matrix = this._tempMatrix;
        const color = this._tempColor;
        let instanceIndex = 0;

        for (let eid = range.start; eid < range.end && instanceIndex < this.maxActiveParticles; eid++) {
            const mat = material[eid];
            if (mat === 0) continue;

            // Set matrix (position only, no rotation/scale)
            matrix.makeTranslation(posX[eid], posY[eid], posZ[eid]);
            matrix.toArray(this.particleMatrices, instanceIndex * 16);

            // Set color
            color.setHex(this.getMaterialColor(mat));
            this.particleColors[instanceIndex * 3] = color.r;
            this.particleColors[instanceIndex * 3 + 1] = color.g;
            this.particleColors[instanceIndex * 3 + 2] = color.b;

            instanceIndex++;
        }

        // Update instanced mesh
        this.activeParticleMesh.count = instanceIndex;
        if (instanceIndex > 0) {
            this.activeParticleMesh.instanceMatrix.array.set(
                this.particleMatrices.subarray(0, instanceIndex * 16)
            );
            this.activeParticleMesh.instanceMatrix.needsUpdate = true;
            this.activeParticleMesh.instanceColor.array.set(
                this.particleColors.subarray(0, instanceIndex * 3)
            );
            this.activeParticleMesh.instanceColor.needsUpdate = true;
        }
    }

    updateSettledVoxels() {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid || !voxelGrid.isDirty) return;

        const matrix = this._tempMatrix;
        const color = this._tempColor;
        let instanceIndex = 0;

        // Use tracked non-air voxels instead of scanning entire grid
        for (const [key, mat] of voxelGrid.nonAirVoxels) {
            if (instanceIndex >= this.maxVoxels) break;

            const [x, y, z] = key.split(',').map(Number);
            const worldPos = voxelGrid.gridToWorld(x, y, z);

            matrix.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
            matrix.toArray(this.voxelMatrices, instanceIndex * 16);

            color.setHex(this.getMaterialColor(mat));
            this.voxelColors[instanceIndex * 3] = color.r;
            this.voxelColors[instanceIndex * 3 + 1] = color.g;
            this.voxelColors[instanceIndex * 3 + 2] = color.b;

            instanceIndex++;
        }

        // Update instanced mesh
        this.voxelMesh.count = instanceIndex;
        if (instanceIndex > 0) {
            this.voxelMesh.instanceMatrix.array.set(
                this.voxelMatrices.subarray(0, instanceIndex * 16)
            );
            this.voxelMesh.instanceMatrix.needsUpdate = true;
            this.voxelMesh.instanceColor.array.set(
                this.voxelColors.subarray(0, instanceIndex * 3)
            );
            this.voxelMesh.instanceColor.needsUpdate = true;
        }

        voxelGrid.isDirty = false;
    }

    updateFPS() {
        this.frameCount++;
        const now = performance.now();

        if (now - this.lastFpsTime >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;

            // Update UI
            this.updateUI();
        }
    }

    updateUI() {
        const physicsSystem = this.game.particlePhysicsSystem;
        const voxelGrid = this.game.voxelGridSystem;

        if (this._domActiveCount && physicsSystem) {
            this._domActiveCount.textContent = physicsSystem.activeCount;
        }
        if (this._domSettledCount && voxelGrid) {
            this._domSettledCount.textContent = voxelGrid.settledCount;
        }
        if (this._domFpsDisplay) {
            this._domFpsDisplay.textContent = this.fps;
        }
    }

    /**
     * Raycast from screen position to 3D world
     */
    raycastFromScreen(screenX, screenY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((screenX - rect.left) / rect.width) * 2 - 1,
            -((screenY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);

        // Raycast against a horizontal plane at y=50 (middle of grid)
        const voxelGrid = this.game.voxelGridSystem;
        const planeY = voxelGrid ? voxelGrid.sizeY / 2 : 50;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersection = new THREE.Vector3();

        if (raycaster.ray.intersectPlane(plane, intersection)) {
            return intersection;
        }

        return null;
    }
}
