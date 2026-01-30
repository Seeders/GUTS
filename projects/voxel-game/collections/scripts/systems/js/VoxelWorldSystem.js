/**
 * VoxelWorldSystem - Core world management system
 * Manages chunk tracking, block storage, and coordinate utilities
 */
class VoxelWorldSystem extends GUTS.BaseSystem {
    static services = [
        'getBlock',
        'setBlock',
        'getChunkKey',
        'worldToChunk',
        'worldToLocal',
        'getBlockIndex',
        'getChunkBlockData',
        'createChunkEntity',
        'getChunkEntity',
        'markChunkForRemesh'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.voxelWorldSystem = this;

        // Constants
        this.CHUNK_SIZE = 32;
        this.CHUNK_SIZE_CUBED = 32 * 32 * 32; // 32768

        // Block type constants (matching Rust)
        this.BLOCK_AIR = 0;
        this.BLOCK_TEST = 1;
        this.BLOCK_SOIL = 2;
        this.BLOCK_ROCK = 3;

        // Material constants
        this.MATERIAL_SHALE = 0;
        this.MATERIAL_LOAM = 2;
        this.MATERIAL_LUSH_GRASS = 4;

        // Block data storage (outside ECS for efficiency)
        // Key: "x,y,z" chunk coordinates
        // Value: Uint32Array(32768) - each element encodes blockKind + blockData
        this.chunkBlockData = new Map();

        // Chunk entity lookup
        // Key: "x,y,z" chunk coordinates
        // Value: entity ID
        this.chunkEntityMap = new Map();

        // Perlin noise generator
        this.perlin = null;

        // World config values (cached from singleton entity)
        this.seed = 1337;
        this.generationRadius = 16;
    }

    init() {
        console.log('VoxelWorldSystem initializing...');

        // Initialize Perlin noise
        this.perlin = new GUTS.PerlinNoise(this.seed);

        console.log('VoxelWorldSystem initialized');
    }

    postAllInit() {
        // Create player entity
        this.createPlayer();
    }

    createPlayer() {
        const playerId = this.game.createEntity();
        this.game.addComponent(playerId, 'playerTag', { dummy: 0 });
        this.game.addComponent(playerId, 'position', { x: 0, y: 64, z: 0 });
        this.game.addComponent(playerId, 'playerController', {
            velocityX: 0,
            velocityY: 0,
            velocityZ: 0,
            pitch: 0,
            yaw: 0,
            groundedTimer: 0,
            sizeX: 0.6,
            sizeY: 1.8,
            sizeZ: 0.6,
            walkSpeed: 7.0,
            gravity: -36.0,
            jumpVelocity: 13.0,
            groundAccel: 140.0,
            airAccel: 70.0,
            groundFriction: 0.91,
            airFriction: 0.98,
            coyoteTime: 0.075
        });

        this.playerEntityId = playerId;
        console.log('Player created with entity ID:', playerId);
    }

    update() {
        // World system doesn't need per-frame updates
        // Chunk management is handled by ChunkGenerationSystem
    }

    // ============ Coordinate Utilities ============

    getChunkKey(cx, cy, cz) {
        return `${cx},${cy},${cz}`;
    }

    parseChunkKey(key) {
        const parts = key.split(',').map(Number);
        return { x: parts[0], y: parts[1], z: parts[2] };
    }

    worldToChunk(wx, wy, wz) {
        return {
            x: Math.floor(wx / this.CHUNK_SIZE),
            y: Math.floor(wy / this.CHUNK_SIZE),
            z: Math.floor(wz / this.CHUNK_SIZE)
        };
    }

    worldToLocal(wx, wy, wz) {
        // Use modulo that handles negatives correctly
        const mod = (n, m) => ((n % m) + m) % m;
        return {
            x: mod(Math.floor(wx), this.CHUNK_SIZE),
            y: mod(Math.floor(wy), this.CHUNK_SIZE),
            z: mod(Math.floor(wz), this.CHUNK_SIZE)
        };
    }

    getBlockIndex(localX, localY, localZ) {
        return localX + localY * this.CHUNK_SIZE + localZ * this.CHUNK_SIZE * this.CHUNK_SIZE;
    }

    // ============ Block Access ============

    getBlock(wx, wy, wz) {
        const chunk = this.worldToChunk(wx, wy, wz);
        const key = this.getChunkKey(chunk.x, chunk.y, chunk.z);
        const blockData = this.chunkBlockData.get(key);

        if (!blockData) {
            return null; // Chunk not loaded
        }

        const local = this.worldToLocal(wx, wy, wz);
        const index = this.getBlockIndex(local.x, local.y, local.z);
        const encoded = blockData[index];

        if (encoded === 0) {
            return null; // Air block
        }

        return {
            kind: encoded & 0xFFFF,
            data: (encoded >> 16) & 0xFFFF
        };
    }

    setBlock(wx, wy, wz, blockKind, blockData = 0) {
        const chunk = this.worldToChunk(wx, wy, wz);
        const key = this.getChunkKey(chunk.x, chunk.y, chunk.z);
        const chunkData = this.chunkBlockData.get(key);

        if (!chunkData) {
            return false; // Chunk not loaded
        }

        const local = this.worldToLocal(wx, wy, wz);
        const index = this.getBlockIndex(local.x, local.y, local.z);

        // Encode block: kind in lower 16 bits, data in upper 16 bits
        chunkData[index] = (blockData << 16) | (blockKind & 0xFFFF);

        // Mark chunk for remesh
        this.markChunkForRemesh(chunk.x, chunk.y, chunk.z);

        // Also mark neighboring chunks if block is on edge
        if (local.x === 0) this.markChunkForRemesh(chunk.x - 1, chunk.y, chunk.z);
        if (local.x === this.CHUNK_SIZE - 1) this.markChunkForRemesh(chunk.x + 1, chunk.y, chunk.z);
        if (local.y === 0) this.markChunkForRemesh(chunk.x, chunk.y - 1, chunk.z);
        if (local.y === this.CHUNK_SIZE - 1) this.markChunkForRemesh(chunk.x, chunk.y + 1, chunk.z);
        if (local.z === 0) this.markChunkForRemesh(chunk.x, chunk.y, chunk.z - 1);
        if (local.z === this.CHUNK_SIZE - 1) this.markChunkForRemesh(chunk.x, chunk.y, chunk.z + 1);

        return true;
    }

    // ============ Chunk Management ============

    getChunkBlockData(cx, cy, cz) {
        const key = this.getChunkKey(cx, cy, cz);
        return this.chunkBlockData.get(key);
    }

    setChunkBlockData(cx, cy, cz, data) {
        const key = this.getChunkKey(cx, cy, cz);
        this.chunkBlockData.set(key, data);
    }

    createChunkEntity(cx, cy, cz) {
        const key = this.getChunkKey(cx, cy, cz);

        // Check if chunk entity already exists
        if (this.chunkEntityMap.has(key)) {
            return this.chunkEntityMap.get(key);
        }

        const entityId = this.game.createEntity();
        this.game.addComponent(entityId, 'chunkTag', { dummy: 0 });
        this.game.addComponent(entityId, 'chunkPosition', { x: cx, y: cy, z: cz });
        this.game.addComponent(entityId, 'chunkState', { state: 0, meshVersion: 0, needsRemesh: 0 });

        this.chunkEntityMap.set(key, entityId);

        return entityId;
    }

    getChunkEntity(cx, cy, cz) {
        const key = this.getChunkKey(cx, cy, cz);
        return this.chunkEntityMap.get(key);
    }

    markChunkForRemesh(cx, cy, cz) {
        const entityId = this.getChunkEntity(cx, cy, cz);
        if (entityId !== undefined) {
            const state = this.game.getComponent(entityId, 'chunkState');
            if (state) {
                state.needsRemesh = 1;
            }
        }
    }

    removeChunk(cx, cy, cz) {
        const key = this.getChunkKey(cx, cy, cz);

        // Remove block data
        this.chunkBlockData.delete(key);

        // Remove entity
        const entityId = this.chunkEntityMap.get(key);
        if (entityId !== undefined) {
            this.game.destroyEntity(entityId);
            this.chunkEntityMap.delete(key);
        }
    }

    hasChunk(cx, cy, cz) {
        const key = this.getChunkKey(cx, cy, cz);
        return this.chunkBlockData.has(key);
    }

    // ============ Block Encoding Helpers ============

    encodeSoilBlock(material, grassMaterial = 255) {
        // Soil: bits 0-7 = material, bits 8-15 = grass material (255 = none)
        const data = (grassMaterial << 8) | material;
        return { kind: this.BLOCK_SOIL, data };
    }

    encodeRockBlock(rockType, material) {
        // Rock: bits 0-7 = rock type, bits 8-15 = material
        const data = (material << 8) | rockType;
        return { kind: this.BLOCK_ROCK, data };
    }

    decodeBlock(block) {
        if (!block) return null;

        if (block.kind === this.BLOCK_SOIL) {
            return {
                type: 'soil',
                material: block.data & 0xFF,
                grassMaterial: (block.data >> 8) & 0xFF
            };
        } else if (block.kind === this.BLOCK_ROCK) {
            return {
                type: 'rock',
                rockType: block.data & 0xFF,
                material: (block.data >> 8) & 0xFF
            };
        } else if (block.kind === this.BLOCK_TEST) {
            return { type: 'test' };
        }

        return { type: 'unknown', kind: block.kind };
    }
}

GUTS.VoxelWorldSystem = VoxelWorldSystem;
