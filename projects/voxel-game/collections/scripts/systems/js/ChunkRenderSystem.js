/**
 * ChunkRenderSystem - Three.js rendering for voxel chunks
 * Handles scene setup, camera, and chunk mesh rendering
 */
class ChunkRenderSystem extends GUTS.BaseSystem {
    static services = [
        'getScene',
        'getCamera',
        'getRenderer'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.chunkRenderSystem = this;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Chunk meshes - entityId -> THREE.Mesh
        this.chunkMeshObjects = new Map();

        // Material
        this.chunkMaterial = null;

        // Cached references
        this.worldSystem = null;
        this.playerControllerSystem = null;

        // FPS tracking (using real wall-clock time)
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.currentFps = 0;

        // Constants
        this.CHUNK_SIZE = 32;
    }

    init() {
        console.log('ChunkRenderSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        this.setupThreeJS();
        this.createMaterial();
        console.log('ChunkRenderSystem initialized');
    }

    postAllInit() {
        this.playerControllerSystem = this.game.playerControllerSystem;
    }

    setupThreeJS() {
        // Get canvas
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('Canvas not found!');
            return;
        }

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB); // Sky blue

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            70, // FOV
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        // Add directional light (sun)
        const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(100, 200, 100);
        this.scene.add(sunLight);

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    createMaterial() {
        // Create a simple material for now
        // In a full implementation, this would use the custom shader with packed vertices
        this.chunkMaterial = new THREE.MeshLambertMaterial({
            color: 0x8B7355, // Brown for soil/rock
            flatShading: true
        });

        // Create color variants for different block types
        this.materials = {
            rock: new THREE.MeshLambertMaterial({ color: 0x808080, flatShading: true }),
            soil: new THREE.MeshLambertMaterial({ color: 0x8B4513, flatShading: true }),
            grass: new THREE.MeshLambertMaterial({ color: 0x228B22, flatShading: true })
        };
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    update() {
        const dt = this.game.deltaTime || 1/60;

        // Update camera position from player
        this.updateCamera();

        // Update chunk meshes
        this.updateChunkMeshes();

        // Clean up meshes for destroyed chunks
        this.cleanupOrphanedMeshes();

        // Update FPS counter
        this.updateFps();
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
    }

    updateCamera() {
        if (!this.playerControllerSystem) return;

        const pos = this.playerControllerSystem.getPlayerPosition();
        const rot = this.playerControllerSystem.getPlayerRotation();

        if (!pos || !rot) return;

        // Set camera position (at eye level)
        this.camera.position.set(pos.x, pos.y + 1.6, pos.z);

        // Set camera rotation
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = rot.yaw;
        this.camera.rotation.x = rot.pitch;
    }

    updateChunkMeshes() {
        if (!this.game.chunkMeshes) return;

        // Process new/updated meshes
        for (const [entityId, meshData] of this.game.chunkMeshes) {
            // Check if we already have this mesh
            if (this.chunkMeshObjects.has(entityId)) {
                // Check if mesh needs update
                const existing = this.chunkMeshObjects.get(entityId);
                if (existing.meshVersion === meshData.version) continue;

                // Remove old mesh
                this.scene.remove(existing.mesh);
                existing.mesh.geometry.dispose();
            }

            // Create new mesh from mesh data
            const mesh = this.createMeshFromData(entityId, meshData);
            if (mesh) {
                // Get chunk position
                const chunkPos = this.game.getComponent(entityId, 'chunkPosition');
                if (chunkPos) {
                    mesh.position.set(
                        chunkPos.x * this.CHUNK_SIZE,
                        chunkPos.y * this.CHUNK_SIZE,
                        chunkPos.z * this.CHUNK_SIZE
                    );
                }

                this.scene.add(mesh);
                this.chunkMeshObjects.set(entityId, {
                    mesh,
                    meshVersion: meshData.version || 0
                });
            }

            // Remove from pending queue
            this.game.chunkMeshes.delete(entityId);
        }

        // Update chunk count display
        const chunksEl = document.getElementById('chunks');
        if (chunksEl) {
            chunksEl.textContent = `Chunks: ${this.chunkMeshObjects.size}`;
        }
    }

    createMeshFromData(entityId, meshData) {
        if (!meshData || !meshData.vertices || meshData.vertices.length === 0) {
            return null;
        }

        const geometry = new THREE.BufferGeometry();

        // Unpack vertices from packed format to standard positions
        const positions = [];
        const colors = [];

        for (let i = 0; i < meshData.vertices.length; i++) {
            const packed = meshData.vertices[i];

            // Unpack: x(6) | y(6) | z(6) | u(1) | v(1) | ao(2)
            const x = (packed >> 26) & 0x3F;
            const y = (packed >> 20) & 0x3F;
            const z = (packed >> 14) & 0x3F;
            const ao = (packed >> 10) & 0x03;

            positions.push(x, y, z);

            // Color based on AO (ambient occlusion)
            const brightness = 0.7 + ao * 0.1;

            // Get texture index for color variation
            const texIdx = meshData.textureIndices ? meshData.textureIndices[i] : 0;

            let r, g, b;
            switch (texIdx) {
                case 0: // Rock
                    r = g = b = 0.5 * brightness;
                    break;
                case 1: // Soil top
                    r = 0.55 * brightness;
                    g = 0.27 * brightness;
                    b = 0.07 * brightness;
                    break;
                case 2: // Soil side
                    r = 0.45 * brightness;
                    g = 0.22 * brightness;
                    b = 0.05 * brightness;
                    break;
                case 3: // Grass
                    r = 0.13 * brightness;
                    g = 0.55 * brightness;
                    b = 0.13 * brightness;
                    break;
                default:
                    r = g = b = 0.6 * brightness;
            }

            colors.push(r, g, b);
        }

        geometry.setAttribute('position',
            new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color',
            new THREE.Float32BufferAttribute(colors, 3));

        // Set indices
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

        // Compute normals for lighting
        geometry.computeVertexNormals();

        // Create mesh with vertex colors
        const material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            flatShading: true
        });

        return new THREE.Mesh(geometry, material);
    }

    updateFps() {
        this.frameCount++;
        const now = performance.now();
        const elapsed = now - this.lastFpsTime;

        // Update every second (1000ms)
        if (elapsed >= 1000) {
            this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.lastFpsTime = now;

            const fpsEl = document.getElementById('fps');
            if (fpsEl) {
                fpsEl.textContent = `FPS: ${this.currentFps}`;
            }
        }
    }

    /**
     * Remove meshes for chunks that no longer exist
     */
    cleanupOrphanedMeshes() {
        const toRemove = [];

        for (const [entityId, data] of this.chunkMeshObjects) {
            // Check if chunk entity still exists
            const chunkPos = this.game.getComponent(entityId, 'chunkPosition');
            if (!chunkPos) {
                toRemove.push(entityId);
            }
        }

        // Remove orphaned meshes
        for (const entityId of toRemove) {
            this.disposeMesh(entityId);
        }
    }

    /**
     * Dispose a chunk mesh and free GPU resources
     */
    disposeMesh(entityId) {
        const data = this.chunkMeshObjects.get(entityId);
        if (!data) return;

        // Remove from scene
        this.scene.remove(data.mesh);

        // Dispose geometry (frees GPU memory)
        if (data.mesh.geometry) {
            data.mesh.geometry.dispose();
        }

        // Material is shared, don't dispose it

        this.chunkMeshObjects.delete(entityId);
    }

    // Service methods
    getScene() { return this.scene; }
    getCamera() { return this.camera; }
    getRenderer() { return this.renderer; }
}

GUTS.ChunkRenderSystem = ChunkRenderSystem;
