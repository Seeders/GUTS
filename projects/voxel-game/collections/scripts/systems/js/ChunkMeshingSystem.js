/**
 * ChunkMeshingSystem - Converts block data to Three.js geometry
 * Ports the chunk_mesh.rs algorithm with face culling and AO
 * Optimized for minimal GC pressure
 */
class ChunkMeshingSystem extends GUTS.BaseSystem {
    static services = [
        'generateMesh',
        'queueChunkMesh'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.chunkMeshingSystem = this;

        // Meshing queue (60fps = 16.67ms frame budget)
        this.meshingQueue = [];
        this.meshingQueuedKeys = new Set();  // Fast duplicate checking
        this.meshesPerFrame = 8;  // Limit meshes per frame
        this.meshingBudgetMs = 8;  // Max ms per frame for meshing

        // Cached references
        this.worldSystem = null;

        // Constants - use numbers instead of strings for zero allocation
        this.CHUNK_SIZE = 32;
        this.FACE_FRONT = 0;  // +Z
        this.FACE_BACK = 1;   // -Z
        this.FACE_LEFT = 2;   // -X
        this.FACE_RIGHT = 3;  // +X
        this.FACE_TOP = 4;    // +Y
        this.FACE_BOTTOM = 5; // -Y

        // Block types (match VoxelWorldSystem)
        this.BLOCK_AIR = 0;
        this.BLOCK_TEST = 1;
        this.BLOCK_SOIL = 2;
        this.BLOCK_ROCK = 3;

        // Texture indices (by block type, by face: top/side/bottom)
        // Format: [top, side, bottom] for each block type
        this.TEX_ROCK = 0;
        this.TEX_SOIL_TOP = 1;
        this.TEX_SOIL_SIDE = 2;
        this.TEX_GRASS = 3;
        this.TEX_TEST = 4;

        // Pre-allocated arrays to reduce GC
        this._ao = new Uint8Array(4);  // Fixed size, no GC

        // Static AO check positions lookup (computed once)
        this._aoCheckPositions = this._buildAOCheckPositions();

        // Pre-allocated mesh buffers (reused between chunks)
        // Max faces estimate: surface area of chunk = ~6 * 32 * 32 = 6144 faces typical
        // Worst case checkerboard: 32768 * 3 = 98304 faces
        this._maxFaces = 32 * 32 * 32 * 3;
        this._vertices = new Uint32Array(this._maxFaces * 4);
        this._indices = new Uint32Array(this._maxFaces * 6);
        this._texIndices = new Uint8Array(this._maxFaces * 4);  // Uint8 is enough for texture indices

        // Chunk cache for meshing (27 chunks: current + 26 neighbors)
        this._chunkCache = new Array(27);
        for (let i = 0; i < 27; i++) this._chunkCache[i] = null;

        // Pool for mesh result objects - reuse instead of creating new
        this._meshResultPool = [];
        this._maxPoolSize = 8;
    }

    _buildAOCheckPositions() {
        // Pre-compute AO check offsets for each face (flattened Int8Array for cache efficiency)
        // Format: [corner0_offsets, side1_offsets, side2_offsets] x 4 corners = 36 values per face
        // Using Int8Array avoids boxing overhead
        return [
            new Int8Array([ // FACE_FRONT (+Z)
                1, 1, 1, 0, 1, 1, 1, 0, 1,    // corner 0
                -1, 1, 1, 0, 1, 1, -1, 0, 1,  // corner 1
                -1, -1, 1, 0, -1, 1, -1, 0, 1, // corner 2
                1, -1, 1, 0, -1, 1, 1, 0, 1   // corner 3
            ]),
            new Int8Array([ // FACE_BACK (-Z)
                -1, 1, -1, 0, 1, -1, -1, 0, -1,
                1, 1, -1, 0, 1, -1, 1, 0, -1,
                1, -1, -1, 0, -1, -1, 1, 0, -1,
                -1, -1, -1, 0, -1, -1, -1, 0, -1
            ]),
            new Int8Array([ // FACE_LEFT (-X)
                -1, 1, 1, -1, 1, 0, -1, 0, 1,
                -1, 1, -1, -1, 1, 0, -1, 0, -1,
                -1, -1, -1, -1, -1, 0, -1, 0, -1,
                -1, -1, 1, -1, -1, 0, -1, 0, 1
            ]),
            new Int8Array([ // FACE_RIGHT (+X)
                1, 1, -1, 1, 1, 0, 1, 0, -1,
                1, 1, 1, 1, 1, 0, 1, 0, 1,
                1, -1, 1, 1, -1, 0, 1, 0, 1,
                1, -1, -1, 1, -1, 0, 1, 0, -1
            ]),
            new Int8Array([ // FACE_TOP (+Y)
                1, 1, 1, 1, 1, 0, 0, 1, 1,
                1, 1, -1, 1, 1, 0, 0, 1, -1,
                -1, 1, -1, -1, 1, 0, 0, 1, -1,
                -1, 1, 1, -1, 1, 0, 0, 1, 1
            ]),
            new Int8Array([ // FACE_BOTTOM (-Y)
                1, -1, -1, 1, -1, 0, 0, -1, -1,
                1, -1, 1, 1, -1, 0, 0, -1, 1,
                -1, -1, 1, -1, -1, 0, 0, -1, 1,
                -1, -1, -1, -1, -1, 0, 0, -1, -1
            ])
        ];
    }

    /**
     * Get texture index for block - INLINE version, no object allocation
     * @param {number} encoded - The encoded block value (kind in low 16 bits, data in high 16 bits)
     * @param {number} face - Face constant (FACE_TOP, FACE_FRONT, etc)
     * @returns {number} texture index
     */
    _getTextureFast(encoded, face) {
        const kind = encoded & 0xFFFF;
        const data = (encoded >> 16) & 0xFFFF;

        if (kind === this.BLOCK_ROCK) {
            return this.TEX_ROCK;
        } else if (kind === this.BLOCK_SOIL) {
            // Check grass: bits 8-15 of data = grass material, 255 = no grass
            const grassMaterial = (data >> 8) & 0xFF;
            if (grassMaterial !== 255 && face === this.FACE_TOP) {
                return this.TEX_GRASS;
            }
            return face === this.FACE_TOP ? this.TEX_SOIL_TOP : this.TEX_SOIL_SIDE;
        } else if (kind === this.BLOCK_TEST) {
            return this.TEX_TEST;
        }
        return 0;
    }

    init() {
        console.log('ChunkMeshingSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        console.log('ChunkMeshingSystem initialized');
    }

    update() {
        this.processMeshingQueue();
        this.checkChunksForRemesh();
    }

    checkChunksForRemesh() {
        // Check all chunk entities for needsRemesh flag
        const entities = this.game.getEntitiesWith('chunkTag', 'chunkState', 'chunkPosition');

        for (const entityId of entities) {
            const state = this.game.getComponent(entityId, 'chunkState');
            const pos = this.game.getComponent(entityId, 'chunkPosition');

            if (state && state.needsRemesh === 1 && state.state >= 1) {
                this.queueChunkMesh(pos.x, pos.y, pos.z, entityId);
                state.needsRemesh = 0;
            }
        }
    }

    queueChunkMesh(cx, cy, cz, entityId) {
        const key = this.worldSystem.getChunkKey(cx, cy, cz);

        // Fast duplicate check using Set
        if (this.meshingQueuedKeys.has(key)) return;

        this.meshingQueuedKeys.add(key);
        this.meshingQueue.push({ cx, cy, cz, key, entityId });
    }

    processMeshingQueue() {
        if (this.meshingQueue.length === 0) return;

        const startTime = performance.now();
        let meshesDone = 0;

        // Process meshes until we hit our time budget or mesh limit
        while (this.meshingQueue.length > 0 && meshesDone < this.meshesPerFrame) {
            const elapsed = performance.now() - startTime;
            if (elapsed > this.meshingBudgetMs) break;

            const task = this.meshingQueue.shift();
            if (task) {
                this.meshingQueuedKeys.delete(task.key);
                const meshData = this.generateMesh(task.cx, task.cy, task.cz);
                if (meshData) {
                    this.storeMeshData(task.entityId, meshData);
                }
                meshesDone++;
            }
        }
    }

    storeMeshData(entityId, meshData) {
        const state = this.game.getComponent(entityId, 'chunkState');
        if (state) {
            state.state = 3; // Complete
            state.meshVersion++;
        }

        // Store mesh data on entity for render system
        if (!this.game.chunkMeshes) {
            this.game.chunkMeshes = new Map();
        }

        // Return old mesh data to pool if exists
        const oldMesh = this.game.chunkMeshes.get(entityId);
        if (oldMesh && this._meshResultPool.length < this._maxPoolSize) {
            this._meshResultPool.push(oldMesh);
        }

        this.game.chunkMeshes.set(entityId, meshData);
    }

    /**
     * Get a mesh result object from pool or create new
     */
    _getMeshResult() {
        if (this._meshResultPool.length > 0) {
            return this._meshResultPool.pop();
        }
        return { vertices: null, indices: null, textureIndices: null, version: 0 };
    }

    /**
     * Cache neighboring chunks for fast block lookup during meshing
     */
    _cacheChunks(cx, cy, cz) {
        let idx = 0;
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const key = `${cx + dx},${cy + dy},${cz + dz}`;
                    this._chunkCache[idx] = this.worldSystem.chunkBlockData.get(key) || null;
                    idx++;
                }
            }
        }
        this._cx = cx;
        this._cy = cy;
        this._cz = cz;
    }

    /**
     * Fast block lookup using cached chunk data
     * lx, ly, lz are local coords that can be -1 to 32 (for neighbor checks)
     */
    _getBlock(lx, ly, lz) {
        // Determine which cached chunk and adjusted local coords
        let dx = 0, dy = 0, dz = 0;

        if (lx < 0) { dx = -1; lx += 32; }
        else if (lx >= 32) { dx = 1; lx -= 32; }

        if (ly < 0) { dy = -1; ly += 32; }
        else if (ly >= 32) { dy = 1; ly -= 32; }

        if (lz < 0) { dz = -1; lz += 32; }
        else if (lz >= 32) { dz = 1; lz -= 32; }

        // Cache index: (dz+1)*9 + (dy+1)*3 + (dx+1)
        const cacheIdx = (dz + 1) * 9 + (dy + 1) * 3 + (dx + 1);
        const chunkData = this._chunkCache[cacheIdx];

        if (!chunkData) return 0;

        return chunkData[lx + ly * 32 + lz * 1024];
    }

    /**
     * Generate mesh for a chunk with face culling and AO
     * Optimized version with cached chunks, pre-allocated arrays, zero object allocation in hot path
     */
    generateMesh(cx, cy, cz) {
        // Cache all 27 neighboring chunks for fast lookup
        this._cacheChunks(cx, cy, cz);

        const vertices = this._vertices;
        const indices = this._indices;
        const texIndices = this._texIndices;

        let vIdx = 0;  // Vertex write index
        let iIdx = 0;  // Index write index
        let vertexCount = 0;

        // Get center chunk data
        const centerChunk = this._chunkCache[13]; // Index 13 = (0,0,0) offset
        if (!centerChunk) return null;

        // Local refs to avoid property lookup in hot loop
        const FACE_FRONT = 0, FACE_BACK = 1, FACE_LEFT = 2, FACE_RIGHT = 3, FACE_TOP = 4, FACE_BOTTOM = 5;

        for (let z = 0; z < 32; z++) {
            const zOff = z * 1024;
            for (let y = 0; y < 32; y++) {
                const yOff = y * 32;
                for (let x = 0; x < 32; x++) {
                    const encoded = centerChunk[x + yOff + zOff];
                    if (encoded === 0) continue; // Air

                    // Check 6 neighbors using fast cached lookup
                    const nx = this._getBlock(x - 1, y, z);
                    const px = this._getBlock(x + 1, y, z);
                    const ny = this._getBlock(x, y - 1, z);
                    const py = this._getBlock(x, y + 1, z);
                    const nz = this._getBlock(x, y, z - 1);
                    const pz = this._getBlock(x, y, z + 1);

                    // If fully surrounded, skip (no object allocation here)
                    if (nx && px && ny && py && nz && pz) continue;

                    // Generate faces for each visible side - NO object allocation
                    // Use encoded value directly in texture lookup
                    if (!pz) { // Front face (+Z)
                        const texIdx = this._getTextureFast(encoded, FACE_FRONT);
                        this._calcAOFast(x, y, z, FACE_FRONT);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_FRONT, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                    if (!nz) { // Back face (-Z)
                        const texIdx = this._getTextureFast(encoded, FACE_BACK);
                        this._calcAOFast(x, y, z, FACE_BACK);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_BACK, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                    if (!nx) { // Left face (-X)
                        const texIdx = this._getTextureFast(encoded, FACE_LEFT);
                        this._calcAOFast(x, y, z, FACE_LEFT);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_LEFT, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                    if (!px) { // Right face (+X)
                        const texIdx = this._getTextureFast(encoded, FACE_RIGHT);
                        this._calcAOFast(x, y, z, FACE_RIGHT);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_RIGHT, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                    if (!py) { // Top face (+Y)
                        const texIdx = this._getTextureFast(encoded, FACE_TOP);
                        this._calcAOFast(x, y, z, FACE_TOP);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_TOP, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                    if (!ny) { // Bottom face (-Y)
                        const texIdx = this._getTextureFast(encoded, FACE_BOTTOM);
                        this._calcAOFast(x, y, z, FACE_BOTTOM);
                        this._addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, vertexCount, x, y, z, FACE_BOTTOM, texIdx);
                        vIdx += 4; iIdx += 6; vertexCount += 4;
                    }
                }
            }
        }

        if (iIdx === 0) return null;

        // Get pooled result object and set sliced arrays
        const result = this._getMeshResult();
        result.vertices = vertices.slice(0, vIdx);
        result.indices = indices.slice(0, iIdx);
        result.textureIndices = texIndices.slice(0, vIdx);
        result.version++;
        return result;
    }

    /**
     * Fast AO calculation using cached chunk data and numeric face index
     * Writes to pre-allocated this._ao array (no allocation)
     */
    _calcAOFast(x, y, z, faceIdx) {
        const ao = this._ao;
        const offsets = this._aoCheckPositions[faceIdx];

        // Unrolled loop for performance
        let base = 0;
        let c = this._getBlock(x + offsets[0], y + offsets[1], z + offsets[2]) !== 0;
        let s1 = this._getBlock(x + offsets[3], y + offsets[4], z + offsets[5]) !== 0;
        let s2 = this._getBlock(x + offsets[6], y + offsets[7], z + offsets[8]) !== 0;
        ao[0] = 3 - ((s1 && s2) ? 3 : ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)));

        base = 9;
        c = this._getBlock(x + offsets[base], y + offsets[base + 1], z + offsets[base + 2]) !== 0;
        s1 = this._getBlock(x + offsets[base + 3], y + offsets[base + 4], z + offsets[base + 5]) !== 0;
        s2 = this._getBlock(x + offsets[base + 6], y + offsets[base + 7], z + offsets[base + 8]) !== 0;
        ao[1] = 3 - ((s1 && s2) ? 3 : ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)));

        base = 18;
        c = this._getBlock(x + offsets[base], y + offsets[base + 1], z + offsets[base + 2]) !== 0;
        s1 = this._getBlock(x + offsets[base + 3], y + offsets[base + 4], z + offsets[base + 5]) !== 0;
        s2 = this._getBlock(x + offsets[base + 6], y + offsets[base + 7], z + offsets[base + 8]) !== 0;
        ao[2] = 3 - ((s1 && s2) ? 3 : ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)));

        base = 27;
        c = this._getBlock(x + offsets[base], y + offsets[base + 1], z + offsets[base + 2]) !== 0;
        s1 = this._getBlock(x + offsets[base + 3], y + offsets[base + 4], z + offsets[base + 5]) !== 0;
        s2 = this._getBlock(x + offsets[base + 6], y + offsets[base + 7], z + offsets[base + 8]) !== 0;
        ao[3] = 3 - ((s1 && s2) ? 3 : ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0)));
    }

    /**
     * Fast face addition using numeric face index
     * No string comparisons, no object allocation
     */
    _addFaceNumeric(vertices, indices, texIndices, vIdx, iIdx, baseVertex, x, y, z, faceIdx, texIdx) {
        const ao = this._ao;
        const ao0 = ao[0], ao1 = ao[1], ao2 = ao[2], ao3 = ao[3];
        let v0, v1, v2, v3;

        // Use numeric comparison instead of string switch
        if (faceIdx === 0) { // FRONT (+Z)
            v0 = (x + 1 << 26) | (y + 1 << 20) | (z + 1 << 14) | (1 << 13) | (0 << 12) | (ao0 << 10);
            v1 = (x << 26) | (y + 1 << 20) | (z + 1 << 14) | (0 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x << 26) | (y << 20) | (z + 1 << 14) | (0 << 13) | (1 << 12) | (ao2 << 10);
            v3 = (x + 1 << 26) | (y << 20) | (z + 1 << 14) | (1 << 13) | (1 << 12) | (ao3 << 10);
        } else if (faceIdx === 1) { // BACK (-Z)
            v0 = (x << 26) | (y + 1 << 20) | (z << 14) | (1 << 13) | (0 << 12) | (ao0 << 10);
            v1 = (x + 1 << 26) | (y + 1 << 20) | (z << 14) | (0 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x + 1 << 26) | (y << 20) | (z << 14) | (0 << 13) | (1 << 12) | (ao2 << 10);
            v3 = (x << 26) | (y << 20) | (z << 14) | (1 << 13) | (1 << 12) | (ao3 << 10);
        } else if (faceIdx === 2) { // LEFT (-X)
            v0 = (x << 26) | (y + 1 << 20) | (z + 1 << 14) | (1 << 13) | (0 << 12) | (ao0 << 10);
            v1 = (x << 26) | (y + 1 << 20) | (z << 14) | (0 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x << 26) | (y << 20) | (z << 14) | (0 << 13) | (1 << 12) | (ao2 << 10);
            v3 = (x << 26) | (y << 20) | (z + 1 << 14) | (1 << 13) | (1 << 12) | (ao3 << 10);
        } else if (faceIdx === 3) { // RIGHT (+X)
            v0 = (x + 1 << 26) | (y + 1 << 20) | (z << 14) | (1 << 13) | (0 << 12) | (ao0 << 10);
            v1 = (x + 1 << 26) | (y + 1 << 20) | (z + 1 << 14) | (0 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x + 1 << 26) | (y << 20) | (z + 1 << 14) | (0 << 13) | (1 << 12) | (ao2 << 10);
            v3 = (x + 1 << 26) | (y << 20) | (z << 14) | (1 << 13) | (1 << 12) | (ao3 << 10);
        } else if (faceIdx === 4) { // TOP (+Y)
            v0 = (x + 1 << 26) | (y + 1 << 20) | (z + 1 << 14) | (1 << 13) | (1 << 12) | (ao0 << 10);
            v1 = (x + 1 << 26) | (y + 1 << 20) | (z << 14) | (1 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x << 26) | (y + 1 << 20) | (z << 14) | (0 << 13) | (0 << 12) | (ao2 << 10);
            v3 = (x << 26) | (y + 1 << 20) | (z + 1 << 14) | (0 << 13) | (1 << 12) | (ao3 << 10);
        } else { // BOTTOM (-Y)
            v0 = (x + 1 << 26) | (y << 20) | (z << 14) | (1 << 13) | (1 << 12) | (ao0 << 10);
            v1 = (x + 1 << 26) | (y << 20) | (z + 1 << 14) | (1 << 13) | (0 << 12) | (ao1 << 10);
            v2 = (x << 26) | (y << 20) | (z + 1 << 14) | (0 << 13) | (0 << 12) | (ao2 << 10);
            v3 = (x << 26) | (y << 20) | (z << 14) | (0 << 13) | (1 << 12) | (ao3 << 10);
        }

        vertices[vIdx] = v0;
        vertices[vIdx + 1] = v1;
        vertices[vIdx + 2] = v2;
        vertices[vIdx + 3] = v3;

        texIndices[vIdx] = texIdx;
        texIndices[vIdx + 1] = texIdx;
        texIndices[vIdx + 2] = texIdx;
        texIndices[vIdx + 3] = texIdx;

        // Triangle winding based on AO (prevents diagonal artifacts)
        if (ao0 + ao2 < ao1 + ao3) {
            indices[iIdx] = baseVertex;
            indices[iIdx + 1] = baseVertex + 1;
            indices[iIdx + 2] = baseVertex + 3;
            indices[iIdx + 3] = baseVertex + 1;
            indices[iIdx + 4] = baseVertex + 2;
            indices[iIdx + 5] = baseVertex + 3;
        } else {
            indices[iIdx] = baseVertex;
            indices[iIdx + 1] = baseVertex + 1;
            indices[iIdx + 2] = baseVertex + 2;
            indices[iIdx + 3] = baseVertex + 2;
            indices[iIdx + 4] = baseVertex + 3;
            indices[iIdx + 5] = baseVertex;
        }
    }

}

GUTS.ChunkMeshingSystem = ChunkMeshingSystem;
