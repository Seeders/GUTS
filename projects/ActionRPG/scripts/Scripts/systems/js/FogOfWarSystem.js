class FogOfWarSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game.fogOfWarSystem = this;

        // Get terrain size from game state
        this.WORLD_SIZE = 80; // 5 chunks * 16 tiles = 80
        this.FOG_TEXTURE_SIZE = 128; // Higher resolution for ARPG

        this.VISION_RADIUS = 10; // Player vision radius
        this.LOS_RAYS = 32; // Rays for line of sight calculations

        this.fogRenderTarget = null;
        this.explorationRenderTarget = null;
        this.explorationRenderTargetPingPong = null;
        this.fogScene = null;
        this.fogCamera = null;

        this.losMaterial = null;
        this.visibilityMesh = null;

        this.accumulationMaterial = null;
        this.accumulationQuad = null;
        this.accumulationScene = null;
        this.accumulationCamera = null;

        this.cachedVisibilityBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE);
        this.cachedExplorationBuffer = new Uint8Array(this.FOG_TEXTURE_SIZE * this.FOG_TEXTURE_SIZE);
        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
    }

    init(params = {}) {
        this.params = params;
        this.initRendering();

        // Register getter methods
        this.game.gameManager.register('getExplorationTexture', this.getExplorationTexture.bind(this));
        this.game.gameManager.register('getFogTexture', this.getFogTexture.bind(this));
        this.game.gameManager.register('isVisibleAt', this.isVisibleAt.bind(this));
        this.game.gameManager.register('isExploredAt', this.isExploredAt.bind(this));
    }

    getExplorationTexture() {
        return this.explorationRenderTarget?.texture || null;
    }

    getFogTexture() {
        return this.fogRenderTarget?.texture || null;
    }

    initRendering() {
        // Fog render target (current visibility)
        this.fogRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );

        // Exploration render target (accumulated visibility)
        this.explorationRenderTarget = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );

        this.explorationRenderTargetPingPong = new THREE.WebGLRenderTarget(
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RedFormat
            }
        );

        // Orthographic camera looking down
        const halfSize = this.WORLD_SIZE / 2;
        this.fogCamera = new THREE.OrthographicCamera(
            -halfSize, halfSize,
            halfSize, -halfSize,
            0.1, 1000
        );
        this.fogCamera.position.set(0, 500, 0);
        this.fogCamera.lookAt(0, 0, 0);

        this.fogScene = new THREE.Scene();
        this.fogScene.background = new THREE.Color(0x000000);

        // Material for visibility mesh
        this.losMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        // Accumulation shader (combines current visibility with explored areas)
        this.accumulationMaterial = new THREE.ShaderMaterial({
            uniforms: {
                currentExploration: { value: null },
                newVisibility: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D currentExploration;
                uniform sampler2D newVisibility;
                varying vec2 vUv;

                void main() {
                    float explored = texture2D(currentExploration, vUv).r;
                    float visible = texture2D(newVisibility, vUv).r;
                    float newExploration = max(explored, visible);
                    gl_FragColor = vec4(newExploration, newExploration, newExploration, 1.0);
                }
            `
        });

        this.accumulationQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            this.accumulationMaterial
        );
        this.accumulationScene = new THREE.Scene();
        this.accumulationScene.add(this.accumulationQuad);
        this.accumulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        console.log('[FogOfWarSystem] Initialized for ActionRPG');
    }

    generateVisibilityShape(playerPos, visionRadius) {
        const points = [];
        const angleStep = (Math.PI * 2) / this.LOS_RAYS;

        for (let i = 0; i < this.LOS_RAYS; i++) {
            const angle = i * angleStep;
            const dirX = Math.cos(angle);
            const dirZ = Math.sin(angle);

            let visibleDist = visionRadius;

            // Check for wall collisions
            for (let dist = 0; dist <= visionRadius; dist += 0.5) {
                const checkX = playerPos.x + dirX * dist;
                const checkZ = playerPos.z + dirZ * dist;

                if (this.isWall(checkX, checkZ)) {
                    visibleDist = dist;
                    break;
                }
            }

            points.push({
                x: playerPos.x + dirX * visibleDist,
                z: playerPos.z + dirZ * visibleDist
            });
        }

        return points;
    }

    isWall(x, z) {
        if (!this.game.state.terrainMap) return false;

        const terrainWidth = this.game.state.terrainWidth;
        const terrainHeight = this.game.state.terrainHeight;

        const gridX = Math.floor(x);
        const gridZ = Math.floor(z);

        if (gridX < 0 || gridX >= terrainWidth || gridZ < 0 || gridZ >= terrainHeight) {
            return true; // Out of bounds is wall
        }

        const terrainType = this.game.state.terrainMap[gridZ][gridX];
        return terrainType === 1; // 1 = wall
    }

    updateVisibilityMesh(points, centerX, centerZ) {
        if (points.length < 3) return;

        // Create triangle fan geometry
        const vertices = [];

        for (let i = 0; i < points.length; i++) {
            const nextI = (i + 1) % points.length;

            // Center point
            vertices.push(centerX, 0, centerZ);

            // Current point
            vertices.push(points[i].x, 0, points[i].z);

            // Next point
            vertices.push(points[nextI].x, 0, points[nextI].z);
        }

        if (this.visibilityMesh) {
            this.fogScene.remove(this.visibilityMesh);
            this.visibilityMesh.geometry.dispose();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.computeBoundingSphere();

        this.visibilityMesh = new THREE.Mesh(geometry, this.losMaterial);
        this.visibilityMesh.position.set(0, 0, 0);
        this.fogScene.add(this.visibilityMesh);
    }

    update(deltaTime, now) {
        // Find player
        const players = this.game.getEntitiesWith('PlayerController', 'Position');
        const playerId = players.values().next().value;
        if (!playerId) return;

        const playerPos = this.game.getComponent(playerId, 'Position');
        if (!playerPos) return;

        // Generate visibility shape
        const visiblePoints = this.generateVisibilityShape(
            { x: playerPos.x, z: playerPos.z },
            this.VISION_RADIUS
        );

        // Update visibility mesh
        this.updateVisibilityMesh(visiblePoints, playerPos.x, playerPos.z);

        // Render visibility
        this.game.renderSystem.renderer.setRenderTarget(this.fogRenderTarget);
        this.game.renderSystem.renderer.render(this.fogScene, this.fogCamera);

        // Accumulate exploration
        this.accumulationMaterial.uniforms.currentExploration.value = this.explorationRenderTarget.texture;
        this.accumulationMaterial.uniforms.newVisibility.value = this.fogRenderTarget.texture;

        this.game.renderSystem.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        this.game.renderSystem.renderer.render(this.accumulationScene, this.accumulationCamera);

        // Swap render targets
        const temp = this.explorationRenderTarget;
        this.explorationRenderTarget = this.explorationRenderTargetPingPong;
        this.explorationRenderTargetPingPong = temp;

        this.game.renderSystem.renderer.setRenderTarget(null);

        this.visibilityCacheValid = false;
        this.explorationCacheValid = false;
    }

    updateVisibilityCache() {
        if (this.visibilityCacheValid) return;

        this.game.renderSystem.renderer.readRenderTargetPixels(
            this.fogRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedVisibilityBuffer
        );

        this.visibilityCacheValid = true;
    }

    updateExplorationCache() {
        if (this.explorationCacheValid) return;

        this.game.renderSystem.renderer.readRenderTargetPixels(
            this.explorationRenderTarget,
            0, 0,
            this.FOG_TEXTURE_SIZE,
            this.FOG_TEXTURE_SIZE,
            this.cachedExplorationBuffer
        );

        this.explorationCacheValid = true;
    }

    isVisibleAt(x, z) {
        const uv = this.worldToUV(x, z);
        if (!uv) return false;

        this.updateVisibilityCache();

        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px);

        return this.cachedVisibilityBuffer[index] > 0;
    }

    isExploredAt(x, z) {
        const uv = this.worldToUV(x, z);
        if (!uv) return false;

        this.updateExplorationCache();

        const px = Math.floor(uv.x * this.FOG_TEXTURE_SIZE);
        const py = Math.floor(uv.y * this.FOG_TEXTURE_SIZE);
        const index = (py * this.FOG_TEXTURE_SIZE + px);

        return this.cachedExplorationBuffer[index] > 0;
    }

    worldToUV(x, z) {
        const half = this.WORLD_SIZE * 0.5;
        let u = (x + half) / this.WORLD_SIZE;
        let v = (-z + half) / this.WORLD_SIZE;

        if (u < 0 || u > 1 || v < 0 || v > 1) {
            return null;
        }

        return { x: u, y: v };
    }

    resetExploration() {
        this.game.renderSystem.renderer.setRenderTarget(this.explorationRenderTarget);
        this.game.renderSystem.renderer.clear();
        this.game.renderSystem.renderer.setRenderTarget(this.explorationRenderTargetPingPong);
        this.game.renderSystem.renderer.clear();
        this.game.renderSystem.renderer.setRenderTarget(null);
        this.explorationCacheValid = false;
    }

    dispose() {
        if (this.fogRenderTarget) this.fogRenderTarget.dispose();
        if (this.explorationRenderTarget) this.explorationRenderTarget.dispose();
        if (this.explorationRenderTargetPingPong) this.explorationRenderTargetPingPong.dispose();
        if (this.accumulationMaterial) this.accumulationMaterial.dispose();
        if (this.accumulationQuad) this.accumulationQuad.geometry.dispose();
        if (this.losMaterial) this.losMaterial.dispose();
        if (this.visibilityMesh) {
            this.visibilityMesh.geometry.dispose();
        }
    }
}
