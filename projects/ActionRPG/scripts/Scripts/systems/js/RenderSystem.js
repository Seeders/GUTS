class RenderSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.meshes = new Map();
        this.lights = [];
    }

    init() {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLights();
        this.setupTerrain();
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        this.scene.fog = new THREE.Fog(0x1a1a1a, 20, 50);
    }

    setupCamera() {
        const canvas = this.game.canvasBuffer;
        this.camera = new THREE.PerspectiveCamera(
            60,
            canvas.width / canvas.height,
            0.1,
            1000
        );

        // Isometric-style camera angle
        this.camera.position.set(15, 20, 15);
        this.camera.lookAt(0, 0, 0);
    }

    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.game.canvasBuffer,
            antialias: true
        });
        this.renderer.setSize(this.game.canvasBuffer.width, this.game.canvasBuffer.height);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        this.lights.push(directionalLight);
    }

    setupTerrain() {
        // This will be called after level generation
        if (!this.game.state.terrainMap) return;

        const terrainWidth = this.game.state.terrainWidth;
        const terrainHeight = this.game.state.terrainHeight;

        // Create terrain mesh
        const geometry = new THREE.PlaneGeometry(terrainWidth, terrainHeight, terrainWidth - 1, terrainHeight - 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x4a4a4a,
            roughness: 0.8,
            metalness: 0.2
        });

        const vertices = geometry.attributes.position.array;

        // Set height based on terrain type
        for (let z = 0; z < terrainHeight; z++) {
            for (let x = 0; x < terrainWidth; x++) {
                const terrainType = this.game.state.terrainMap[z][x];
                const index = (z * terrainWidth + x) * 3;

                // Walls are elevated
                if (terrainType === 1) {
                    vertices[index + 2] = 2;
                } else {
                    vertices[index + 2] = 0;
                }
            }
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();

        const terrainMesh = new THREE.Mesh(geometry, material);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.position.set(terrainWidth / 2, 0, terrainHeight / 2);
        terrainMesh.receiveShadow = true;
        this.scene.add(terrainMesh);
        this.terrainMesh = terrainMesh;
    }

    update(deltaTime, now) {
        // Update entity meshes
        const renderables = this.game.getEntitiesWith('Position', 'Renderable');

        for (const entityId of renderables) {
            const position = this.game.getComponent(entityId, 'Position');
            const renderable = this.game.getComponent(entityId, 'Renderable');

            if (!this.meshes.has(entityId)) {
                // Create mesh for entity
                this.createEntityMesh(entityId, renderable);
            }

            const mesh = this.meshes.get(entityId);
            if (mesh) {
                mesh.position.set(position.x, position.y, position.z);

                // Update rotation
                const facing = this.game.getComponent(entityId, 'Facing');
                if (facing) {
                    mesh.rotation.y = facing.angle;
                }

                // Update animation flash
                const animation = this.game.getComponent(entityId, 'Animation');
                if (animation && animation.flash > 0) {
                    mesh.material.emissive.setHex(0xff0000);
                    mesh.material.emissiveIntensity = animation.flash;
                    animation.flash = Math.max(0, animation.flash - deltaTime * 5);
                } else if (mesh.material.emissive) {
                    mesh.material.emissive.setHex(0x000000);
                }
            }
        }

        // Remove meshes for destroyed entities
        for (const [entityId, mesh] of this.meshes) {
            if (!this.game.entities.has(entityId)) {
                this.scene.remove(mesh);
                this.meshes.delete(entityId);
            }
        }

        // Follow player with camera
        this.updateCamera();

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    createEntityMesh(entityId, renderable) {
        // Create a simple geometry based on entity type
        let geometry, material;

        const playerController = this.game.getComponent(entityId, 'PlayerController');
        const enemyAI = this.game.getComponent(entityId, 'EnemyAI');

        if (playerController) {
            // Player is a blue capsule
            geometry = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
            material = new THREE.MeshStandardMaterial({
                color: 0x4488ff,
                roughness: 0.7,
                metalness: 0.3
            });
        } else if (enemyAI) {
            // Enemies are red cubes
            geometry = new THREE.BoxGeometry(0.8, 1.5, 0.8);
            material = new THREE.MeshStandardMaterial({
                color: 0xff4444,
                roughness: 0.7,
                metalness: 0.3
            });
        } else {
            // Default sphere
            geometry = new THREE.SphereGeometry(0.5, 16, 16);
            material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                roughness: 0.7,
                metalness: 0.3
            });
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.meshes.set(entityId, mesh);
    }

    updateCamera() {
        const player = this.findPlayer();
        if (!player) return;

        const playerPosition = this.game.getComponent(player, 'Position');
        if (!playerPosition) return;

        // Smooth camera follow
        const targetX = playerPosition.x + 10;
        const targetY = 15;
        const targetZ = playerPosition.z + 10;

        this.camera.position.x += (targetX - this.camera.position.x) * 0.1;
        this.camera.position.y += (targetY - this.camera.position.y) * 0.1;
        this.camera.position.z += (targetZ - this.camera.position.z) * 0.1;

        this.camera.lookAt(playerPosition.x, 0, playerPosition.z);
    }

    findPlayer() {
        const players = this.game.getEntitiesWith('PlayerController');
        return players.values().next().value;
    }

    onGameStarted() {
        this.setupTerrain();
    }
}
