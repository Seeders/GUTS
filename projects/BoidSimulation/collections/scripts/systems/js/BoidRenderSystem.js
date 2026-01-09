/**
 * BoidRenderSystem - Renders boids using Three.js instanced meshes
 *
 * Uses instanced rendering for efficient display of large boid counts.
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

        // Boid mesh
        this.boidGeometry = null;
        this.boidMaterial = null;
        this.instancedMesh = null;

        // Target and obstacle meshes
        this.targetMeshes = [];
        this.obstacleMeshes = [];

        // Configuration
        this.NUM_BOIDS = 100000;

        // Camera settings
        this.cameraDistance = 150;
        this.cameraTarget = { x: 0, y: 5, z: -120 };

        // Follow mode settings
        this.followMode = false;
        this.followEntityId = -1;
        this.followDistance = 8;
        this.followHeight = 3;
    }

    init() {
        // Only initialize on client
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            console.log('BoidRenderSystem: Skipping init (not in browser)');
            return;
        }

        console.log('BoidRenderSystem initializing...');

        this.initThreeJs();
        this.createBoidGeometry();
        this.createTargetAndObstacleMeshes();
        this.setupFollowUI();

        console.log('BoidRenderSystem initialized');
    }

    initThreeJs() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x025e83); // Ocean blue

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
            antialias: false, // Disable for performance with many objects
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
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);

        // Add directional light
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

    createBoidGeometry() {
        // Create a simple fish-like geometry (cone pointing forward)
        this.boidGeometry = new THREE.ConeGeometry(0.3, 1.0, 4);
        this.boidGeometry.rotateX(Math.PI / 2); // Point forward along Z axis

        // Create material
        this.boidMaterial = new THREE.MeshPhongMaterial({
            color: 0xff6600,
            flatShading: true
        });

        // Create instanced mesh
        this.instancedMesh = new THREE.InstancedMesh(this.boidGeometry, this.boidMaterial, this.NUM_BOIDS);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Disable frustum culling - boids are spread out and culling the entire instanced mesh causes flickering
        this.instancedMesh.frustumCulled = false;
        this.scene.add(this.instancedMesh);
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

        console.log('Following boid entity:', this.followEntityId);
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
     * Called when the boid count changes - recreates the instanced mesh
     */
    onBoidCountChanged(newCount) {
        console.log(`BoidRenderSystem: Updating instance count to ${newCount}`);

        // Remove old instanced mesh
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh);
            this.instancedMesh.dispose();
        }

        // Update count
        this.NUM_BOIDS = newCount;

        // Create new instanced mesh with new count
        this.instancedMesh = new THREE.InstancedMesh(this.boidGeometry, this.boidMaterial, this.NUM_BOIDS);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh.frustumCulled = false;
        this.scene.add(this.instancedMesh);

        console.log(`BoidRenderSystem: Instance count updated to ${newCount}`);
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;

        const flockingSystem = this.game.boidFlockingSystem;
        if (!flockingSystem) return;

        // Update instanced mesh matrices - directly set the array for performance
        const matrices = flockingSystem.getInstanceMatrices();
        if (matrices && this.instancedMesh) {
            // Handle case where matrices array size matches or is smaller than instance count
            const expectedSize = this.NUM_BOIDS * 16;
            if (matrices.length >= expectedSize) {
                this.instancedMesh.instanceMatrix.array.set(matrices.subarray(0, expectedSize));
            } else {
                this.instancedMesh.instanceMatrix.array.set(matrices);
            }
            this.instancedMesh.instanceMatrix.needsUpdate = true;
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
        const lookAhead = 10;
        const lookX = bx + hx * lookAhead;
        const lookY = by + hy * lookAhead;
        const lookZ = bz + hz * lookAhead;
        this.camera.lookAt(lookX, lookY, lookZ);
    }
}
