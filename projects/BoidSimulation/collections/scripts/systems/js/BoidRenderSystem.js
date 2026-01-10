/**
 * BoidRenderSystem - Renders boids as flying dragons using sprite billboards
 *
 * Uses the SpriteBillboardRenderer library for efficient instanced sprite rendering.
 */
class BoidRenderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.boidRenderSystem = this;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Sprite billboard renderer
        this.spriteRenderer = null;

        // Target and obstacle meshes
        this.targetMeshes = [];
        this.obstacleMeshes = [];

        // Configuration
        this.NUM_BOIDS = 50000;
        this.DRAGON_SCALE = 8;  // Scale for dragon sprites

        // Camera settings
        this.cameraDistance = 150;
        this.cameraTarget = { x: 0, y: 5, z: -120 };

        // Follow mode settings
        this.followMode = false;
        this.followEntityId = -1;
        this.followDistance = 15;
        this.followHeight = 8;

        // Animation settings
        this.animationTime = 0;
        this.animationType = 'walk';  // Flying dragons use 'walk' animation for flying
    }

    async init() {
        // Only initialize on client
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            console.log('BoidRenderSystem: Skipping init (not in browser)');
            return;
        }

        console.log('BoidRenderSystem initializing...');

        this.initThreeJs();
        await this.createDragonSprites();
        this.createTargetAndObstacleMeshes();
        this.setupFollowUI();

        console.log('BoidRenderSystem initialized');
    }

    initThreeJs() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);  // Sky blue

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.set(
            this.cameraTarget.x,
            this.cameraTarget.y + 100,
            this.cameraTarget.z + this.cameraDistance
        );
        this.camera.lookAt(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);

        // Use the existing gameCanvas from the UI
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('BoidRenderSystem: gameCanvas not found');
            return;
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Add orbit controls if available
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.update();
        }

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        // Add directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(100, 200, 100);
        this.scene.add(directionalLight);

        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    async createDragonSprites() {
        // Get sprite animation set from collections
        const collections = this.game.getCollections();
        const dragonAnimSet = collections?.spriteAnimationSets?.dragonredflying;

        if (!dragonAnimSet) {
            console.error('BoidRenderSystem: dragonredflying sprite animation set not found');
            // Fallback to simple geometry
            this.createFallbackGeometry();
            return;
        }

        // Get resources path from the game/app
        // Need to make it absolute (starting with /) for TextureLoader
        let resourcesPath = '';
        if (this.game.app?.getResourcesPath) {
            resourcesPath = this.game.app.getResourcesPath();
            // Ensure it starts with / for absolute path
            if (!resourcesPath.startsWith('/')) {
                resourcesPath = '/' + resourcesPath;
            }
        } else {
            // Fallback: construct path based on project name
            const projectName = this.game.projectName || 'BoidSimulation';
            resourcesPath = `/projects/${projectName}/resources/`;
        }

        // Create sprite billboard renderer
        this.spriteRenderer = new SpriteBillboardRenderer({
            scene: this.scene,
            capacity: this.NUM_BOIDS,
            resourcesPath: resourcesPath
        });

        // Get sprite sheet path
        const spriteSheetPath = dragonAnimSet.spriteSheet;
        console.log('BoidRenderSystem: Loading dragon sprite sheet:', resourcesPath + spriteSheetPath);

        // Initialize the sprite renderer
        const success = await this.spriteRenderer.init(spriteSheetPath, dragonAnimSet);

        if (!success) {
            console.error('BoidRenderSystem: Failed to initialize sprite renderer');
            this.createFallbackGeometry();
            return;
        }

        console.log('BoidRenderSystem: Dragon sprites loaded successfully');
    }

    createFallbackGeometry() {
        console.log('BoidRenderSystem: Using fallback cone geometry');

        // Create a simple fish-like geometry (cone pointing forward)
        const geometry = new THREE.ConeGeometry(0.3, 1.0, 4);
        geometry.rotateX(Math.PI / 2);

        const material = new THREE.MeshPhongMaterial({
            color: 0xff6600,
            flatShading: true
        });

        this.fallbackMesh = new THREE.InstancedMesh(geometry, material, this.NUM_BOIDS);
        this.fallbackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.fallbackMesh.frustumCulled = false;
        this.scene.add(this.fallbackMesh);
    }

    createTargetAndObstacleMeshes() {
        // Create target spheres (green)
        const targetGeometry = new THREE.SphereGeometry(3, 16, 16);
        const targetMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });

        for (let i = 0; i < 2; i++) {
            const mesh = new THREE.Mesh(targetGeometry, targetMaterial);
            this.scene.add(mesh);
            this.targetMeshes.push(mesh);
        }

        // Create obstacle sphere (red)
        const obstacleGeometry = new THREE.SphereGeometry(5, 16, 16);
        const obstacleMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });

        for (let i = 0; i < 1; i++) {
            const mesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
            this.scene.add(mesh);
            this.obstacleMeshes.push(mesh);
        }
    }

    setupFollowUI() {
        setTimeout(() => {
            const followBtn = document.getElementById('followBoidBtn');
            const freeCamBtn = document.getElementById('freeCamBtn');

            if (followBtn) {
                followBtn.addEventListener('click', () => {
                    this.followRandomBoid();
                });
            }

            if (freeCamBtn) {
                freeCamBtn.addEventListener('click', () => {
                    this.exitFollowMode();
                });
            }
        }, 100);
    }

    followRandomBoid() {
        const flockingSystem = this.game.boidFlockingSystem;
        if (!flockingSystem || !flockingSystem._boidRange) return;

        const range = flockingSystem._boidRange;
        const randomIndex = Math.floor(Math.random() * range.count);
        this.followEntityId = range.start + randomIndex;
        this.followMode = true;

        // Disable orbit controls in follow mode
        if (this.controls) {
            this.controls.enabled = false;
        }

        console.log('Following dragon:', this.followEntityId);
    }

    exitFollowMode() {
        this.followMode = false;
        this.followEntityId = -1;

        // Re-enable orbit controls
        if (this.controls) {
            this.controls.enabled = true;
            this.controls.target.set(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
            this.camera.position.set(
                this.cameraTarget.x,
                this.cameraTarget.y + 100,
                this.cameraTarget.z + this.cameraDistance
            );
            this.controls.update();
        }

        console.log('Exited follow mode');
    }

    /**
     * Called when the boid count changes - recreates the sprite renderer
     */
    async onBoidCountChanged(newCount) {
        console.log(`BoidRenderSystem: Updating instance count to ${newCount}`);

        this.NUM_BOIDS = newCount;

        if (this.spriteRenderer) {
            // Dispose old renderer and create new one
            this.spriteRenderer.dispose();

            const collections = this.game.getCollections();
            const dragonAnimSet = collections?.spriteAnimationSets?.dragonredflying;

            if (dragonAnimSet) {
                // Get resources path (ensure absolute)
                let resourcesPath = '';
                if (this.game.app?.getResourcesPath) {
                    resourcesPath = this.game.app.getResourcesPath();
                    if (!resourcesPath.startsWith('/')) {
                        resourcesPath = '/' + resourcesPath;
                    }
                } else {
                    const projectName = this.game.projectName || 'BoidSimulation';
                    resourcesPath = `/projects/${projectName}/resources/`;
                }

                this.spriteRenderer = new SpriteBillboardRenderer({
                    scene: this.scene,
                    capacity: this.NUM_BOIDS,
                    resourcesPath: resourcesPath
                });

                await this.spriteRenderer.init(dragonAnimSet.spriteSheet, dragonAnimSet);
            }
        } else if (this.fallbackMesh) {
            // Update fallback mesh
            this.scene.remove(this.fallbackMesh);
            this.fallbackMesh.dispose();

            const geometry = new THREE.ConeGeometry(0.3, 1.0, 4);
            geometry.rotateX(Math.PI / 2);

            const material = new THREE.MeshPhongMaterial({
                color: 0xff6600,
                flatShading: true
            });

            this.fallbackMesh = new THREE.InstancedMesh(geometry, material, this.NUM_BOIDS);
            this.fallbackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.fallbackMesh.frustumCulled = false;
            this.scene.add(this.fallbackMesh);
        }

        console.log(`BoidRenderSystem: Instance count updated to ${newCount}`);
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;

        const flockingSystem = this.game.boidFlockingSystem;
        if (!flockingSystem) return;

        // Skip rendering if neither sprite renderer nor fallback mesh is ready
        const spriteReady = this.spriteRenderer && this.spriteRenderer.instancedMesh;
        const fallbackReady = this.fallbackMesh;
        if (!spriteReady && !fallbackReady) return;

        // Update animation time
        const deltaTime = this.game.state?.deltaTime || 0.016;
        this.animationTime += deltaTime;

        // Get flocking data
        const posX = flockingSystem._posX;
        const posY = flockingSystem._posY;
        const posZ = flockingSystem._posZ;
        const headX = flockingSystem._headX;
        const headY = flockingSystem._headY;
        const headZ = flockingSystem._headZ;
        const range = flockingSystem._boidRange;

        if (!posX || !range) return;

        // Update sprites or fallback mesh
        // Check if spriteRenderer is fully initialized (has instancedMesh)
        if (this.spriteRenderer && this.spriteRenderer.instancedMesh) {
            this.updateDragonSprites(posX, posY, posZ, headX, headY, headZ, range);
        } else if (this.fallbackMesh) {
            this.updateFallbackMesh(flockingSystem);
        }

        // Update target positions
        for (let i = 0; i < flockingSystem.NUM_TARGETS && i < this.targetMeshes.length; i++) {
            this.targetMeshes[i].position.set(
                flockingSystem.targetX[i],
                flockingSystem.targetY[i],
                flockingSystem.targetZ[i]
            );
        }

        // Update obstacle positions
        for (let i = 0; i < flockingSystem.NUM_OBSTACLES && i < this.obstacleMeshes.length; i++) {
            this.obstacleMeshes[i].position.set(
                flockingSystem.obstacleX[i],
                flockingSystem.obstacleY[i],
                flockingSystem.obstacleZ[i]
            );
        }

        // Update camera for follow mode
        if (this.followMode && this.followEntityId >= 0) {
            this.updateFollowCamera(flockingSystem);
        }

        // Update controls (only when not in follow mode)
        if (this.controls && !this.followMode) {
            this.controls.update();
        }

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    updateDragonSprites(posX, posY, posZ, headX, headY, headZ, range) {
        const fps = this.spriteRenderer.fps || 4;
        const framesPerDir = this.spriteRenderer.framesPerDirection || 4;

        // Set animation frame once (uniform, not per instance)
        const frameIndex = Math.floor(this.animationTime * fps) % framesPerDir;
        this.spriteRenderer.setAnimationFrame(frameIndex);

        // Update each boid - position, scale, and heading only
        // Direction calculation happens in GPU shader
        for (let i = 0; i < range.count; i++) {
            const eid = range.start + i;
            this.spriteRenderer.setInstance(
                i,
                posX[eid], posY[eid], posZ[eid],
                this.DRAGON_SCALE,
                headX[eid], headZ[eid]
            );
        }

        // Set instance count and finalize
        this.spriteRenderer.setInstanceCount(range.count);
        this.spriteRenderer.finalizeUpdates();
    }

    updateFallbackMesh(flockingSystem) {
        // Use the matrices from the flocking system
        const matrices = flockingSystem.getInstanceMatrices();
        if (matrices && this.fallbackMesh) {
            const expectedSize = this.NUM_BOIDS * 16;
            if (matrices.length >= expectedSize) {
                this.fallbackMesh.instanceMatrix.array.set(matrices.subarray(0, expectedSize));
            } else {
                this.fallbackMesh.instanceMatrix.array.set(matrices);
            }
            this.fallbackMesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateFollowCamera(flockingSystem) {
        const eid = this.followEntityId;
        const posX = flockingSystem._posX;
        const posY = flockingSystem._posY;
        const posZ = flockingSystem._posZ;
        const headX = flockingSystem._headX;
        const headY = flockingSystem._headY;
        const headZ = flockingSystem._headZ;

        if (!posX || eid < 0 || eid >= posX.length) return;

        // Get boid position and heading
        const bx = posX[eid];
        const by = posY[eid];
        const bz = posZ[eid];
        let hx = headX[eid];
        let hy = headY[eid];
        let hz = headZ[eid];

        // Ensure heading is valid (normalize if needed)
        const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
        if (hLen < 0.001) {
            hx = 0;
            hy = 0;
            hz = -1;
        } else {
            hx /= hLen;
            hy /= hLen;
            hz /= hLen;
        }

        // Position camera behind and above the boid
        const camX = bx - hx * this.followDistance;
        const camY = by + this.followHeight - hy * this.followDistance;
        const camZ = bz - hz * this.followDistance;

        // Smooth camera movement
        this.camera.position.x += (camX - this.camera.position.x) * 0.1;
        this.camera.position.y += (camY - this.camera.position.y) * 0.1;
        this.camera.position.z += (camZ - this.camera.position.z) * 0.1;

        // Look ahead of the boid in the direction it's heading (chase cam style)
        const lookAhead = 15;
        const lookX = bx + hx * lookAhead;
        const lookY = by + hy * lookAhead;
        const lookZ = bz + hz * lookAhead;
        this.camera.lookAt(lookX, lookY, lookZ);
    }
}
