/**
 * TerrainDetailSystem - Renders cosmetic detail objects on terrain tiles
 *
 * Uses instanced billboard rendering for optimal performance.
 * Detail objects are purely visual (not entities) and have minimal overhead.
 *
 * Reads detailWorldObjects and detailDensity from terrain type definitions
 * to spawn random detail sprites across tiles of that type.
 */
class TerrainDetailSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.terrainDetailSystem = this;

        // Instanced mesh batches per detail type
        // Map: textureId -> { instancedMesh, count, capacity, transforms }
        this.detailBatches = new Map();

        // Seeded random for deterministic placement
        this.seed = 12345;

        // Configuration
        this.initialized = false;

        // Billboard shader material (shared across all batches)
        this.billboardMaterial = null;

        // Current ambient light color for detail sprites
        this.currentAmbientLight = new THREE.Color(0xffffff);
    }

    /**
     * Create a billboard shader material that rotates sprites to face camera on GPU
     */
    createBillboardMaterial(texture) {
        const vertexShader = `
            varying vec2 vUv;
            #include <fog_pars_vertex>

            void main() {
                vUv = uv;

                // Get the model-view matrix without rotation (billboard effect)
                // Extract position from instance matrix
                vec4 worldPosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

                // Get scale from instance matrix (diagonal elements for uniform scale)
                float scaleX = length(instanceMatrix[0].xyz);
                float scaleY = length(instanceMatrix[1].xyz);

                // Billboard: offset vertices in view space
                vec4 viewPosition = viewMatrix * worldPosition;
                viewPosition.xy += position.xy * vec2(scaleX, scaleY);

                // mvPosition is required by fog_vertex
                vec4 mvPosition = viewPosition;

                gl_Position = projectionMatrix * viewPosition;
                #include <fog_vertex>
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;
            uniform vec3 ambientLightColor;
            varying vec2 vUv;
            #include <fog_pars_fragment>

            void main() {
                vec4 texColor = texture2D(map, vUv);

                // Alpha test
                if (texColor.a < 0.1) discard;

                // Apply ambient lighting
                vec3 litColor = texColor.rgb * ambientLightColor;
                gl_FragColor = vec4(litColor, texColor.a);
                #include <colorspace_fragment>
                #include <fog_fragment>
            }
        `;

        return new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    map: { value: texture },
                    ambientLightColor: { value: this.currentAmbientLight.clone() }
                }
            ]),
            vertexShader,
            fragmentShader,
            fog: true,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: true
        });
    }

    init() {
        // Register for terrain ready event
        this.game.register('spawnTerrainDetails', this.spawnTerrainDetails.bind(this));

        // Register lighting update service
        this.game.register('setTerrainDetailLighting', this.setAmbientLightColor.bind(this));
    }

    /**
     * Get a texture from ImageManager
     * @param {string} textureId - The texture identifier from the textures collection
     * @returns {THREE.Texture|null}
     */
    getTexture(textureId) {
        return this.game.imageManager?.getTexture(textureId) || null;
    }

    /**
     * Seeded random number generator for deterministic placement
     */
    seededRandom() {
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return (this.seed / 0x7fffffff);
    }

    /**
     * Reset seed for consistent generation
     */
    resetSeed(baseSeed = 12345) {
        this.seed = baseSeed;
    }

    /**
     * Spawn terrain details after terrain is loaded
     * Called from WorldSystem.postSceneLoad or manually
     */
    async spawnTerrainDetails() {
        if (this.initialized) {
            this.clearDetails();
        }

        const terrainDataManager = this.game.terrainSystem?.terrainDataManager;
        if (!terrainDataManager?.tileMap) {
            console.warn('[TerrainDetailSystem] No terrain data available');
            return;
        }

        const tileMap = terrainDataManager.tileMap;
        const terrainMap = tileMap.terrainMap;
        const heightMap = tileMap.heightMap;
        const terrainTypes = tileMap.terrainTypes;
        const gridSize = terrainDataManager.gridSize;
        const terrainSize = tileMap.size * gridSize;
        const heightStep = terrainDataManager.heightStep || 64;

        if (!terrainMap || !terrainTypes) {
            console.warn('[TerrainDetailSystem] Missing terrain map or types');
            return;
        }


        // Collect all detail placements grouped by texture
        // Map: textureId -> Array of { x, y, z, scale }
        const detailPlacements = new Map();

        // Reset seed for deterministic generation
        this.resetSeed(tileMap.size * 1000 + terrainMap.length);

        // Iterate through all tiles
        for (let z = 0; z < terrainMap.length; z++) {
            for (let x = 0; x < terrainMap[z].length; x++) {
                const terrainTypeId = terrainMap[z][x];
                const terrainTypeName = terrainTypes[terrainTypeId];

                if (!terrainTypeName) continue;

                // Get terrain type definition
                const terrainTypeDef = this.collections.terrainTypes?.[terrainTypeName];
                if (!terrainTypeDef?.detailWorldObjects || !terrainTypeDef.detailDensity) {
                    continue;
                }

                const detailObjects = terrainTypeDef.detailWorldObjects;
                const density = terrainTypeDef.detailDensity;

                // Get tile height
                const tileHeight = heightMap?.[z]?.[x] ?? 0;
                const worldY = tileHeight * heightStep;

                // Calculate tile world position (center)
                const tileWorldX = x * gridSize - terrainSize / 2 + gridSize / 2;
                const tileWorldZ = z * gridSize - terrainSize / 2 + gridSize / 2;

                // Calculate how many details to spawn
                // Integer part = guaranteed spawns, fractional part = probability of extra spawn
                const guaranteedCount = Math.floor(density);
                const fractionalChance = density - guaranteedCount;
                const spawnCount = guaranteedCount + (this.seededRandom() < fractionalChance ? 1 : 0);

                // Spawn detail objects on this tile
                for (let i = 0; i < spawnCount; i++) {
                    // Random position within tile
                    const offsetX = (this.seededRandom() - 0.5) * gridSize * 0.9;
                    const offsetZ = (this.seededRandom() - 0.5) * gridSize * 0.9;

                    // Random detail object from array
                    const detailIndex = Math.floor(this.seededRandom() * detailObjects.length);
                    const detailType = detailObjects[detailIndex];

                    // Get the world object definition to find its texture
                    const worldObjDef = this.collections.worldObjects?.[detailType];
                    if (!worldObjDef?.renderTexture) {
                        continue;
                    }

                    const textureId = worldObjDef.renderTexture;
                    const spriteScale = worldObjDef.spriteScale ?? 32;
                    const yOffset = worldObjDef.spriteOffset ?? 0;

                    // Add to placements
                    if (!detailPlacements.has(textureId)) {
                        detailPlacements.set(textureId, []);
                    }

                    detailPlacements.get(textureId).push({
                        x: tileWorldX + offsetX,
                        y: worldY + yOffset,
                        z: tileWorldZ + offsetZ,
                        scale: spriteScale,
                        yOffset: yOffset
                    });
                }
            }
        }

        // Create instanced meshes for each texture
        for (const [textureId, placements] of detailPlacements) {
            await this.createDetailBatch(textureId, placements);
        }

        this.initialized = true;
    }

    /**
     * Create an instanced billboard batch for a detail texture
     */
    async createDetailBatch(textureId, placements) {
        const scene = this.game.scene;
        if (!scene) {
            console.warn('[TerrainDetailSystem] No scene available');
            return;
        }

        // Get texture from ImageManager (preloaded during asset loading)
        const texture = this.getTexture(textureId);
        if (!texture) {
            console.warn(`[TerrainDetailSystem] Texture '${textureId}' not found in ImageManager`);
            return;
        }

        // Get texture dimensions for aspect ratio
        const aspectRatio = texture.image.width / texture.image.height;

        // Create billboard geometry (centered at origin)
        const geometry = new THREE.PlaneGeometry(1, 1);

        // Create billboard shader material (handles rotation on GPU)
        const material = this.createBillboardMaterial(texture);

        // Create instanced mesh
        const capacity = placements.length;
        const instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
        instancedMesh.frustumCulled = true;

        // Set up transforms for each instance (position and scale only - no rotation needed)
        const dummy = new THREE.Object3D();

        for (let i = 0; i < placements.length; i++) {
            const p = placements[i];

            dummy.position.set(p.x, p.y, p.z);
            dummy.scale.set(p.scale * aspectRatio, p.scale, 1);
            dummy.rotation.set(0, 0, 0); // No rotation - shader handles billboarding

            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
        }

        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.count = capacity;

        // Add to scene
        scene.add(instancedMesh);

        // Store batch data
        this.detailBatches.set(textureId, {
            instancedMesh,
            count: capacity,
            capacity,
            placements,
            aspectRatio
        });
    }

    /**
     * Update is called every frame
     * Billboard rotation is handled by shader, so no CPU work needed
     */
    update() {
        // Billboard rotation handled by GPU shader - no per-frame updates needed
    }

    /**
     * Get total count of detail objects
     */
    getTotalDetailCount() {
        let total = 0;
        for (const batch of this.detailBatches.values()) {
            total += batch.count;
        }
        return total;
    }

    /**
     * Clear all detail objects
     */
    clearDetails() {
        for (const [textureId, batch] of this.detailBatches) {
            if (batch.instancedMesh) {
                this.game.scene?.remove(batch.instancedMesh);
                batch.instancedMesh.geometry?.dispose();
                batch.instancedMesh.material?.map?.dispose();
                batch.instancedMesh.material?.dispose();
            }
        }

        this.detailBatches.clear();
        this.initialized = false;
    }

    /**
     * Update ambient light color for all terrain detail batches
     * @param {THREE.Color} color - The combined ambient light color
     */
    setAmbientLightColor(color) {
        this.currentAmbientLight.copy(color);

        // Update all existing detail batches
        for (const batch of this.detailBatches.values()) {
            if (batch.instancedMesh?.material?.uniforms?.ambientLightColor) {
                batch.instancedMesh.material.uniforms.ambientLightColor.value.copy(color);
            }
        }
    }

    /**
     * Cleanup on system destroy
     */
    destroy() {
        this.clearDetails();
    }

    /**
     * Called when scene is unloaded - cleanup all detail objects
     */
    onSceneUnload() {
        this.clearDetails();
    }
}
