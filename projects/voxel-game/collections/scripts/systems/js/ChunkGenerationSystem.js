/**
 * ChunkGenerationSystem - Generates terrain using Perlin noise
 * Ports the world_generator.rs algorithm from voxel-rs
 */
class ChunkGenerationSystem extends GUTS.BaseSystem {
    static services = [
        'generateChunk',
        'queueChunkGeneration'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.chunkGenerationSystem = this;

        // Generation queue
        this.generationQueue = [];
        this.queuedKeys = new Set();  // Fast duplicate checking
        this.queueNeedsSort = false;
        this.chunksPerFrame = 8;  // Chunks per frame for 60fps
        this.isGenerating = false;

        // Cached references
        this.worldSystem = null;
        this.perlin = null;

        // Constants
        this.CHUNK_SIZE = 32;
        this.UNLOAD_RADIUS_EXTRA = 2;  // Unload chunks beyond radius + this
        this.UNLOAD_CHECK_INTERVAL = 30;  // Check every N frames
        this._unloadCounter = 0;

        // Object pool for block data arrays (avoid GC)
        this.blockDataPool = [];
        this.MAX_POOL_SIZE = 64;

        // Performance tracking (60fps = 16.67ms frame budget)
        this.generationBudgetMs = 8;  // Max ms per frame for generation
    }

    init() {
        console.log('ChunkGenerationSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        this.perlin = this.worldSystem.perlin;

        // Setup UI slider
        this.setupRadiusSlider();

        console.log('ChunkGenerationSystem initialized');
    }

    setupRadiusSlider() {
        const slider = document.getElementById('radiusSlider');
        const valueDisplay = document.getElementById('radiusValue');

        if (slider && valueDisplay) {
            // Set initial value from world system
            slider.value = this.worldSystem.generationRadius;
            valueDisplay.textContent = this.worldSystem.generationRadius;

            // Update when slider changes
            slider.addEventListener('input', (e) => {
                const newRadius = parseInt(e.target.value);
                valueDisplay.textContent = newRadius;
                this.worldSystem.generationRadius = newRadius;
            });
        }
    }

    postAllInit() {
        // Generate initial chunks around spawn
        this.generateInitialChunks();
    }

    generateInitialChunks() {
        const radius = this.worldSystem.generationRadius;

        // Generate minimal spawn chunks synchronously (just enough for player to land)
        console.log('Generating minimal spawn chunks...');
        for (let cy = -1; cy <= 1; cy++) {
            for (let cx = -1; cx <= 1; cx++) {
                for (let cz = -1; cz <= 1; cz++) {
                    this.generateChunkSync(cx, cy, cz);
                }
            }
        }
        console.log('Spawn chunks generated');

        // Queue ALL chunks for async generation (including near spawn for proper meshing)
        for (let cy = -2; cy <= 2; cy++) {
            for (let cx = -radius; cx <= radius; cx++) {
                for (let cz = -radius; cz <= radius; cz++) {
                    const dist = Math.sqrt(cx * cx + cz * cz);
                    if (dist <= radius) {
                        this.queueChunkGeneration(cx, cy, cz, dist);
                    }
                }
            }
        }
    }

    update() {
        // Process generation queue
        this.processGenerationQueue();

        // Update chunks around player
        this.updateChunksAroundPlayer();

        // Unload distant chunks
        this.unloadDistantChunks();
    }

    updateChunksAroundPlayer() {
        if (!this.worldSystem.playerEntityId) return;

        const pos = this.game.getComponent(this.worldSystem.playerEntityId, 'position');
        if (!pos) return;

        const playerChunk = this.worldSystem.worldToChunk(pos.x, pos.y, pos.z);
        const radius = this.worldSystem.generationRadius;

        // Queue chunks that need generation
        for (let cy = playerChunk.y - 2; cy <= playerChunk.y + 2; cy++) {
            for (let cx = playerChunk.x - radius; cx <= playerChunk.x + radius; cx++) {
                for (let cz = playerChunk.z - radius; cz <= playerChunk.z + radius; cz++) {
                    const dx = cx - playerChunk.x;
                    const dz = cz - playerChunk.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    if (dist <= radius && !this.worldSystem.hasChunk(cx, cy, cz)) {
                        this.queueChunkGeneration(cx, cy, cz, dist);
                    }
                }
            }
        }
    }

    queueChunkGeneration(cx, cy, cz, priority = 0) {
        const key = this.worldSystem.getChunkKey(cx, cy, cz);

        // Fast duplicate check using Set
        if (this.worldSystem.hasChunk(cx, cy, cz)) return;
        if (this.queuedKeys.has(key)) return;

        this.queuedKeys.add(key);
        this.generationQueue.push({ cx, cy, cz, key, priority });
        this.queueNeedsSort = true;  // Defer sorting until needed
    }

    processGenerationQueue() {
        if (this.generationQueue.length === 0) return;

        // Sort only when needed (deferred from queueing)
        if (this.queueNeedsSort) {
            this.generationQueue.sort((a, b) => a.priority - b.priority);
            this.queueNeedsSort = false;
        }

        const startTime = performance.now();
        let chunksGenerated = 0;

        // Process chunks until we hit our time budget or chunk limit
        while (this.generationQueue.length > 0 && chunksGenerated < this.chunksPerFrame) {
            const elapsed = performance.now() - startTime;
            if (elapsed > this.generationBudgetMs) break;

            const task = this.generationQueue.shift();
            if (task) {
                this.queuedKeys.delete(task.key);  // Remove from tracking set
                this.generateChunkSync(task.cx, task.cy, task.cz);
                chunksGenerated++;
            }
        }
    }

    /**
     * Quick check if chunk is likely all air (above terrain)
     * Sample corners to estimate max terrain height in chunk area
     */
    _isChunkAboveTerrain(cx, cy, cz) {
        const CHUNK_SIZE = this.CHUNK_SIZE;
        const baseX = cx * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;
        const minY = cy * CHUNK_SIZE;

        // Sample 4 corners + center to estimate max height
        const samples = [
            [baseX, baseZ],
            [baseX + CHUNK_SIZE - 1, baseZ],
            [baseX, baseZ + CHUNK_SIZE - 1],
            [baseX + CHUNK_SIZE - 1, baseZ + CHUNK_SIZE - 1],
            [baseX + 16, baseZ + 16]
        ];

        let maxHeight = -Infinity;
        for (let i = 0; i < 5; i++) {
            const gx = samples[i][0], gz = samples[i][1];
            const height = 32
                + this.perlin.noise2D(gx / 800, gz / 800) * 80
                + this.perlin.noise2D(gx / 300, gz / 300) * 40
                + this.perlin.noise2D(gx / 100, gz / 100) * 16
                + this.perlin.noise2D(gx / 30, gz / 30) * 6;
            if (height > maxHeight) maxHeight = height;
        }

        // Add margin for detail noise variation between samples
        return minY > maxHeight + 10;
    }

    /**
     * Generate terrain for a chunk using 4-octave Perlin noise
     * Ports the algorithm from world_generator.rs
     * Optimized: pre-compute height map per column (32x fewer noise calls)
     */
    generateChunk(cx, cy, cz) {
        // Quick check: skip if chunk is entirely above terrain
        if (this._isChunkAboveTerrain(cx, cy, cz)) {
            return null; // All air
        }

        const blockData = this.getPooledBlockData();
        const CHUNK_SIZE = this.CHUNK_SIZE;
        const baseX = cx * CHUNK_SIZE;
        const baseY = cy * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;

        // Pre-compute height map for this chunk's X,Z columns
        // This reduces noise calls from 32³×4 = 131,072 to 32²×4 = 4,096
        const heightMap = this._heightMap || (this._heightMap = new Float32Array(CHUNK_SIZE * CHUNK_SIZE));

        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const gx = baseX + lx;
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                const gz = baseZ + lz;

                // 4-octave terrain height calculation
                const mountainNoise = this.perlin.noise2D(gx / 800, gz / 800) * 80;
                const hillNoise = this.perlin.noise2D(gx / 300, gz / 300) * 40;
                const detailNoise = this.perlin.noise2D(gx / 100, gz / 100) * 16;
                const fineNoise = this.perlin.noise2D(gx / 30, gz / 30) * 6;

                heightMap[lx + lz * CHUNK_SIZE] = 32 + mountainNoise + hillNoise + detailNoise + fineNoise;
            }
        }

        // Pre-compute block types for reuse
        const BLOCK_ROCK = this.worldSystem.BLOCK_ROCK;
        const BLOCK_SOIL = this.worldSystem.BLOCK_SOIL;
        const MATERIAL_SHALE = this.worldSystem.MATERIAL_SHALE;
        const MATERIAL_LOAM = this.worldSystem.MATERIAL_LOAM;
        const MATERIAL_LUSH_GRASS = this.worldSystem.MATERIAL_LUSH_GRASS;

        // Fill block data using pre-computed height map
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                const height = heightMap[lx + lz * CHUNK_SIZE];
                const rockHeight = height - 3;
                const topSoilY = Math.ceil(height) - 1;

                for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                    const gy = baseY + ly;
                    const index = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;

                    if (gy < rockHeight) {
                        // Rock layer
                        const data = (MATERIAL_SHALE << 8) | 0;
                        blockData[index] = (data << 16) | BLOCK_ROCK;
                    } else if (gy < height) {
                        // Soil layer
                        const isTopSoil = gy >= topSoilY;
                        const grassMaterial = isTopSoil ? MATERIAL_LUSH_GRASS : 255;
                        const data = (grassMaterial << 8) | MATERIAL_LOAM;
                        blockData[index] = (data << 16) | BLOCK_SOIL;
                    }
                    // else: air (0, already initialized)
                }
            }
        }

        return blockData;
    }

    generateChunkSync(cx, cy, cz) {
        // Create chunk entity
        const entityId = this.worldSystem.createChunkEntity(cx, cy, cz);

        // Generate block data (use pooled array if available)
        const blockData = this.generateChunk(cx, cy, cz);

        // Store block data (null = empty/air chunk, still valid)
        if (blockData) {
            this.worldSystem.setChunkBlockData(cx, cy, cz, blockData);
        } else {
            // Empty chunk - create an all-zero array for collision/block lookups
            this.worldSystem.setChunkBlockData(cx, cy, cz, this.getPooledBlockData());
        }

        // Update chunk state to generated
        const state = this.game.getComponent(entityId, 'chunkState');
        if (state) {
            state.state = 1; // Generated
            state.needsRemesh = 1; // Needs meshing
        }
    }

    /**
     * Get a block data array from pool or create new
     */
    getPooledBlockData() {
        if (this.blockDataPool.length > 0) {
            const arr = this.blockDataPool.pop();
            arr.fill(0);  // Clear for reuse
            return arr;
        }
        return new Uint32Array(this.CHUNK_SIZE * this.CHUNK_SIZE * this.CHUNK_SIZE);
    }

    /**
     * Return a block data array to the pool
     */
    returnToPool(blockData) {
        if (this.blockDataPool.length < this.MAX_POOL_SIZE) {
            this.blockDataPool.push(blockData);
        }
        // If pool is full, let GC handle it
    }

    /**
     * Unload chunks that are too far from the player
     */
    unloadDistantChunks() {
        this._unloadCounter++;
        if (this._unloadCounter < this.UNLOAD_CHECK_INTERVAL) return;
        this._unloadCounter = 0;

        if (!this.worldSystem.playerEntityId) return;

        const pos = this.game.getComponent(this.worldSystem.playerEntityId, 'position');
        if (!pos) return;

        const playerChunk = this.worldSystem.worldToChunk(pos.x, pos.y, pos.z);
        const unloadRadius = this.worldSystem.generationRadius + this.UNLOAD_RADIUS_EXTRA;

        // Collect chunks to unload
        const toUnload = [];

        for (const [key, blockData] of this.worldSystem.chunkBlockData) {
            const coords = this.worldSystem.parseChunkKey(key);
            const dx = coords.x - playerChunk.x;
            const dy = coords.y - playerChunk.y;
            const dz = coords.z - playerChunk.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Unload if too far horizontally or vertically
            if (dist > unloadRadius || Math.abs(dy) > 4) {
                toUnload.push({ key, coords, blockData });
            }
        }

        // Unload chunks (limit per frame to avoid stutters)
        const maxUnloadPerFrame = 4;
        for (let i = 0; i < Math.min(toUnload.length, maxUnloadPerFrame); i++) {
            const { coords, blockData } = toUnload[i];

            // Return block data to pool
            this.returnToPool(blockData);

            // Remove from world system (handles entity destruction)
            this.worldSystem.removeChunk(coords.x, coords.y, coords.z);
        }
    }
}

GUTS.ChunkGenerationSystem = ChunkGenerationSystem;
