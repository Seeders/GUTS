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
    }

    init() {
        // Register for terrain ready event
        this.game.gameManager.register('spawnTerrainDetails', this.spawnTerrainDetails.bind(this));
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

        const collections = this.game.getCollections();

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
                const terrainTypeDef = collections.terrainTypes?.[terrainTypeName];
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
                    const worldObjDef = collections.worldObjects?.[detailType];
                    if (!worldObjDef?.renderTexture) {
                        continue;
                    }

                    const textureId = worldObjDef.renderTexture;
                    const spriteScale = worldObjDef.spriteScale || 32;
                    const offsetY = spriteScale / 4;

                    // Add to placements
                    if (!detailPlacements.has(textureId)) {
                        detailPlacements.set(textureId, []);
                    }

                    detailPlacements.get(textureId).push({
                        x: tileWorldX + offsetX,
                        y: worldY + offsetY,
                        z: tileWorldZ + offsetZ,
                        scale: spriteScale
                    });
                }
            }
        }

        // Create instanced meshes for each texture
        for (const [textureId, placements] of detailPlacements) {
            await this.createDetailBatch(textureId, placements);
        }

        this.initialized = true;
        console.log(`[TerrainDetailSystem] Spawned ${this.getTotalDetailCount()} detail objects in ${this.detailBatches.size} batches`);
    }

    /**
     * Create an instanced billboard batch for a detail texture
     */
    async createDetailBatch(textureId, placements) {
        const collections = this.game.getCollections();
        const textureDef = collections.textures?.[textureId];

        if (!textureDef?.imagePath) {
            console.warn(`[TerrainDetailSystem] Texture '${textureId}' not found or has no imagePath`);
            return;
        }

        const scene = this.game.scene;
        if (!scene) {
            console.warn('[TerrainDetailSystem] No scene available');
            return;
        }

        // Load texture - prefix with /resources/ for correct path
        const textureLoader = new THREE.TextureLoader();
        const texturePath = `/resources/${textureDef.imagePath}`;
        let texture;

        try {
            texture = await new Promise((resolve, reject) => {
                textureLoader.load(
                    texturePath,
                    resolve,
                    undefined,
                    reject
                );
            });

            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.NearestFilter;
        } catch (error) {
            console.error(`[TerrainDetailSystem] Failed to load texture ${texturePath}:`, error);
            return;
        }

        // Get texture dimensions for aspect ratio
        const aspectRatio = texture.image.width / texture.image.height;

        // Create billboard geometry
        const geometry = new THREE.PlaneGeometry(1, 1);

        // Create material with transparency
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            depthWrite: true
        });

        // Create instanced mesh
        const capacity = placements.length;
        const instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
        instancedMesh.frustumCulled = true;

        // Set up transforms for each instance
        const dummy = new THREE.Object3D();
        const camera = this.game.camera;

        for (let i = 0; i < placements.length; i++) {
            const p = placements[i];

            dummy.position.set(p.x, p.y + p.scale * 0.5, p.z);
            dummy.scale.set(p.scale * aspectRatio, p.scale, 1);

            // Billboard rotation - face camera
            if (camera) {
                dummy.quaternion.copy(camera.quaternion);
            }

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
     * Update billboard rotations to face camera (call each frame if needed)
     */
    updateBillboardRotations() {
        const camera = this.game.camera;
        if (!camera) return;

        const dummy = new THREE.Object3D();

        for (const [textureId, batch] of this.detailBatches) {
            const { instancedMesh, placements, aspectRatio } = batch;

            for (let i = 0; i < placements.length; i++) {
                const p = placements[i];

                dummy.position.set(p.x, p.y + p.scale * 0.5, p.z);
                dummy.scale.set(p.scale * aspectRatio, p.scale, 1);
                dummy.quaternion.copy(camera.quaternion);
                dummy.updateMatrix();

                instancedMesh.setMatrixAt(i, dummy.matrix);
            }

            instancedMesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * Update is called every frame - update billboard rotations
     */
    update() {
        if (!this.initialized || this.game.isServer) return;

        // Update billboard rotations to face camera
        this.updateBillboardRotations();
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
        console.log('[TerrainDetailSystem] Scene unloaded - resources cleaned up');
    }
}
