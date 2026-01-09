/**
 * BoidFlockingSystem - ECS boid flocking simulation
 *
 * Uses GUTS ECS with TypedArray field access for numerical components.
 * Tests ECS performance with 60k entities.
 */
class BoidFlockingSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.boidFlockingSystem = this;

        // Configuration constants
        this.NUM_BOIDS = 60000;
        this.NUM_TARGETS = 2;
        this.NUM_OBSTACLES = 1;

        // Spatial hashing parameters
        this.GRID_SIZE = 8192;
        this.MAX_PER_BUCKET = 256;
        this.CELL_SIZE = 8.0;

        // Boid behavior weights
        this.BOID_SEPARATION_WEIGHT = 1.0;
        this.BOID_ALIGNMENT_WEIGHT = 1.0;
        this.BOID_COHESION_WEIGHT = 1.0;
        this.BOID_TARGET_WEIGHT = 2.0;
        this.BOID_OBSTACLE_AVERSION_DISTANCE = 30.0;
        this.BOID_MOVE_SPEED = 25.0;

        // Spawn configuration
        this.SPAWN_RADIUS = 15.0;
        this.SPAWN_CENTER = { x: 20.0, y: 5.0, z: -120.0 };

        // Spatial hash - flat typed arrays for cache efficiency
        this.bucketCounts = null;
        this.bucketSumAlignX = null;
        this.bucketSumAlignY = null;
        this.bucketSumAlignZ = null;
        this.bucketSumSepX = null;
        this.bucketSumSepY = null;
        this.bucketSumSepZ = null;
        this.bucketNearestTarget = null;
        this.bucketNearestObstacle = null;
        this.bucketNearestObstacleDist = null;

        // Bucket entries for position/heading storage
        this.bucketEntryPosX = null;
        this.bucketEntryPosY = null;
        this.bucketEntryPosZ = null;
        this.bucketEntryHeadX = null;
        this.bucketEntryHeadY = null;
        this.bucketEntryHeadZ = null;

        // Target and obstacle positions
        this.targetPositions = [];
        this.obstaclePositions = [];
        this.targetEntities = [];
        this.obstacleEntities = [];

        // Cached ECS field arrays (numerical TypedArrays)
        this._posX = null;
        this._posY = null;
        this._posZ = null;
        this._headX = null;
        this._headY = null;
        this._headZ = null;
        this._boidIdx = null;

        // Cached entity list
        this._boidEntities = null;

        // Instance data for rendering
        this.instanceMatrices = null;

        // Performance tracking
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.fps = 0;
    }

    init() {
        console.log('BoidFlockingSystem initializing...');

        // Spatial hash buckets as typed arrays
        this.bucketCounts = new Uint16Array(this.GRID_SIZE);
        this.bucketSumAlignX = new Float32Array(this.GRID_SIZE);
        this.bucketSumAlignY = new Float32Array(this.GRID_SIZE);
        this.bucketSumAlignZ = new Float32Array(this.GRID_SIZE);
        this.bucketSumSepX = new Float32Array(this.GRID_SIZE);
        this.bucketSumSepY = new Float32Array(this.GRID_SIZE);
        this.bucketSumSepZ = new Float32Array(this.GRID_SIZE);
        this.bucketNearestTarget = new Uint8Array(this.GRID_SIZE);
        this.bucketNearestObstacle = new Uint8Array(this.GRID_SIZE);
        this.bucketNearestObstacleDist = new Float32Array(this.GRID_SIZE);

        // Bucket entries for position/heading storage
        this.bucketEntryPosX = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);
        this.bucketEntryPosY = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);
        this.bucketEntryPosZ = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);
        this.bucketEntryHeadX = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);
        this.bucketEntryHeadY = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);
        this.bucketEntryHeadZ = new Float32Array(this.GRID_SIZE * this.MAX_PER_BUCKET);

        // Initialize target/obstacle positions
        for (let i = 0; i < this.NUM_TARGETS; i++) {
            this.targetPositions.push({ x: 0, y: 0, z: 0 });
        }
        for (let i = 0; i < this.NUM_OBSTACLES; i++) {
            this.obstaclePositions.push({ x: 0, y: 0, z: 0 });
        }

        // Instance matrices
        this.instanceMatrices = new Float32Array(this.NUM_BOIDS * 16);

        console.log('BoidFlockingSystem initialized');
    }

    postAllInit() {
        // Spawn ECS entities
        this.spawnBoids();
        this.spawnTargetsAndObstacles();

        // Cache ECS field arrays (these are the numerical TypedArrays)
        this._posX = this.game.getFieldArray('position', 'x');
        this._posY = this.game.getFieldArray('position', 'y');
        this._posZ = this.game.getFieldArray('position', 'z');
        this._headX = this.game.getFieldArray('heading', 'x');
        this._headY = this.game.getFieldArray('heading', 'y');
        this._headZ = this.game.getFieldArray('heading', 'z');
        this._boidIdx = this.game.getFieldArray('boidIndex', 'index');

        console.log('ECS field arrays cached:', {
            posX: this._posX?.length,
            headX: this._headX?.length,
            boidIdx: this._boidIdx?.length
        });

        // Cache boid entity list
        this._boidEntities = Array.from(this.game.getEntitiesWith('boidTag'));
        console.log('Boid entities cached:', this._boidEntities.length);
    }

    spawnBoids() {
        console.log(`Spawning ${this.NUM_BOIDS} boids...`);

        for (let i = 0; i < this.NUM_BOIDS; i++) {
            const entityId = this.game.createEntity();

            // Seeded random for deterministic spawning
            const seed = (i + 1) * 0x9F6ABC1;
            const rx = this.seededRandom(seed) - 0.5;
            const ry = this.seededRandom(seed + 1) - 0.5;
            const rz = this.seededRandom(seed + 2) - 0.5;

            const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
            let hx = 0, hy = 1, hz = 0;
            if (len > 0.0001) {
                const inv = 1.0 / len;
                hx = rx * inv;
                hy = ry * inv;
                hz = rz * inv;
            }

            // Add ECS components (numerical data)
            this.game.addComponent(entityId, 'position', {
                x: this.SPAWN_CENTER.x + hx * this.SPAWN_RADIUS,
                y: this.SPAWN_CENTER.y + hy * this.SPAWN_RADIUS,
                z: this.SPAWN_CENTER.z + hz * this.SPAWN_RADIUS
            });
            this.game.addComponent(entityId, 'heading', { x: hx, y: hy, z: hz });
            this.game.addComponent(entityId, 'boidIndex', { index: i });
            this.game.addComponent(entityId, 'boidTag', { dummy: 0 });
        }

        console.log(`Spawned ${this.NUM_BOIDS} boids`);
    }

    spawnTargetsAndObstacles() {
        for (let i = 0; i < this.NUM_TARGETS; i++) {
            const entityId = this.game.createEntity();
            this.targetEntities.push(entityId);
            const angle = (i / this.NUM_TARGETS) * Math.PI * 2;
            const radius = 100;
            this.targetPositions[i] = {
                x: Math.cos(angle) * radius,
                y: 10,
                z: -120 + Math.sin(angle) * radius
            };
            this.game.addComponent(entityId, 'position', { ...this.targetPositions[i] });
            this.game.addComponent(entityId, 'target', { dummy: 0 });
        }

        for (let i = 0; i < this.NUM_OBSTACLES; i++) {
            const entityId = this.game.createEntity();
            this.obstacleEntities.push(entityId);
            this.obstaclePositions[i] = { x: 0, y: 5, z: -120 };
            this.game.addComponent(entityId, 'position', { ...this.obstaclePositions[i] });
            this.game.addComponent(entityId, 'obstacle', { dummy: 0 });
        }

        console.log(`Spawned ${this.NUM_TARGETS} targets and ${this.NUM_OBSTACLES} obstacles`);
    }

    seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
    }

    spatialHash(x, y, z) {
        const cellX = Math.floor(x / this.CELL_SIZE) | 0;
        const cellY = Math.floor(y / this.CELL_SIZE) | 0;
        const cellZ = Math.floor(z / this.CELL_SIZE) | 0;
        let hash = (cellX * 73856093) ^ (cellY * 19349663) ^ (cellZ * 83492791);
        return ((hash % this.GRID_SIZE) + this.GRID_SIZE) % this.GRID_SIZE;
    }

    update() {
        const dt = this.game.state?.deltaTime || 0.016;
        const clampedDt = Math.min(dt, 0.05);

        // Update FPS counter
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime > 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
        }

        // Animate targets and obstacles
        this.updateTargetsAndObstacles();

        // Phase 1: Clear spatial hash buckets
        this.bucketCounts.fill(0);

        // Phase 2: Insert all boids into spatial hash
        this.insertBoidsIntoBuckets();

        // Phase 3: Merge cells
        this.mergeCells();

        // Phase 4: Steer boids
        this.steerBoids(clampedDt);

        // Phase 5: Build instance matrices
        this.buildInstanceMatrices();
    }

    updateTargetsAndObstacles() {
        const time = this.game.state?.now || (performance.now() / 1000);

        for (let i = 0; i < this.NUM_TARGETS; i++) {
            const angle = time * 0.5 + (i / this.NUM_TARGETS) * Math.PI * 2;
            const radius = 80 + Math.sin(time * 0.3 + i) * 20;
            this.targetPositions[i].x = Math.cos(angle) * radius;
            this.targetPositions[i].y = 10 + Math.sin(time * 0.7 + i) * 5;
            this.targetPositions[i].z = -120 + Math.sin(angle) * radius;
        }

        for (let i = 0; i < this.NUM_OBSTACLES; i++) {
            const angle = time * 0.3;
            const radius = 50;
            this.obstaclePositions[i].x = Math.cos(angle) * radius;
            this.obstaclePositions[i].y = 5 + Math.sin(time * 0.5) * 3;
            this.obstaclePositions[i].z = -120 + Math.sin(angle) * radius;
        }
    }

    insertBoidsIntoBuckets() {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const counts = this.bucketCounts;
        const maxPerBucket = this.MAX_PER_BUCKET;
        const entities = this._boidEntities;

        for (let i = 0, len = entities.length; i < len; i++) {
            const eid = entities[i];
            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            const hash = this.spatialHash(px, py, pz);
            const slot = counts[hash];

            if (slot < maxPerBucket) {
                const baseIdx = hash * maxPerBucket + slot;
                this.bucketEntryPosX[baseIdx] = px;
                this.bucketEntryPosY[baseIdx] = py;
                this.bucketEntryPosZ[baseIdx] = pz;
                this.bucketEntryHeadX[baseIdx] = headX[eid];
                this.bucketEntryHeadY[baseIdx] = headY[eid];
                this.bucketEntryHeadZ[baseIdx] = headZ[eid];
                counts[hash]++;
            }
        }
    }

    mergeCells() {
        const counts = this.bucketCounts;
        const maxPerBucket = this.MAX_PER_BUCKET;

        for (let bucketIdx = 0; bucketIdx < this.GRID_SIZE; bucketIdx++) {
            const n = counts[bucketIdx];
            if (n === 0) continue;

            const baseIdx = bucketIdx * maxPerBucket;
            let sumAx = 0, sumAy = 0, sumAz = 0;
            let sumSx = 0, sumSy = 0, sumSz = 0;

            for (let j = 0; j < n; j++) {
                const idx = baseIdx + j;
                sumAx += this.bucketEntryHeadX[idx];
                sumAy += this.bucketEntryHeadY[idx];
                sumAz += this.bucketEntryHeadZ[idx];
                sumSx += this.bucketEntryPosX[idx];
                sumSy += this.bucketEntryPosY[idx];
                sumSz += this.bucketEntryPosZ[idx];
            }

            this.bucketSumAlignX[bucketIdx] = sumAx;
            this.bucketSumAlignY[bucketIdx] = sumAy;
            this.bucketSumAlignZ[bucketIdx] = sumAz;
            this.bucketSumSepX[bucketIdx] = sumSx;
            this.bucketSumSepY[bucketIdx] = sumSy;
            this.bucketSumSepZ[bucketIdx] = sumSz;

            const firstPx = this.bucketEntryPosX[baseIdx];
            const firstPy = this.bucketEntryPosY[baseIdx];
            const firstPz = this.bucketEntryPosZ[baseIdx];

            let nearestTargetDistSq = 1e18;
            let nearestTargetIdx = 0;
            for (let t = 0; t < this.NUM_TARGETS; t++) {
                const dx = this.targetPositions[t].x - firstPx;
                const dy = this.targetPositions[t].y - firstPy;
                const dz = this.targetPositions[t].z - firstPz;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < nearestTargetDistSq) {
                    nearestTargetDistSq = distSq;
                    nearestTargetIdx = t;
                }
            }
            this.bucketNearestTarget[bucketIdx] = nearestTargetIdx;

            let nearestObsDistSq = 1e18;
            let nearestObsIdx = 0;
            for (let o = 0; o < this.NUM_OBSTACLES; o++) {
                const dx = this.obstaclePositions[o].x - firstPx;
                const dy = this.obstaclePositions[o].y - firstPy;
                const dz = this.obstaclePositions[o].z - firstPz;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < nearestObsDistSq) {
                    nearestObsDistSq = distSq;
                    nearestObsIdx = o;
                }
            }
            this.bucketNearestObstacle[bucketIdx] = nearestObsIdx;
            this.bucketNearestObstacleDist[bucketIdx] = Math.sqrt(nearestObsDistSq);
        }
    }

    steerBoids(dt) {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const counts = this.bucketCounts;
        const moveDist = this.BOID_MOVE_SPEED * dt;
        const entities = this._boidEntities;

        for (let i = 0, len = entities.length; i < len; i++) {
            const eid = entities[i];
            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            let forwardX = headX[eid];
            let forwardY = headY[eid];
            let forwardZ = headZ[eid];

            const hash = this.spatialHash(px, py, pz);
            const n = counts[hash];

            let alignmentX, alignmentY, alignmentZ;
            let separationX, separationY, separationZ;
            let neighborCount;

            if (n === 0) {
                neighborCount = 1;
                alignmentX = forwardX; alignmentY = forwardY; alignmentZ = forwardZ;
                separationX = px; separationY = py; separationZ = pz;
            } else {
                neighborCount = n;
                alignmentX = this.bucketSumAlignX[hash];
                alignmentY = this.bucketSumAlignY[hash];
                alignmentZ = this.bucketSumAlignZ[hash];
                separationX = this.bucketSumSepX[hash];
                separationY = this.bucketSumSepY[hash];
                separationZ = this.bucketSumSepZ[hash];
            }

            const invCount = 1.0 / neighborCount;

            const nearestObstacleIdx = this.bucketNearestObstacle[hash];
            const obsX = this.obstaclePositions[nearestObstacleIdx].x;
            const obsY = this.obstaclePositions[nearestObstacleIdx].y;
            const obsZ = this.obstaclePositions[nearestObstacleIdx].z;
            const nearestObstacleDist = this.bucketNearestObstacleDist[hash];

            const nearestTargetIdx = this.bucketNearestTarget[hash];
            const tgtX = this.targetPositions[nearestTargetIdx].x;
            const tgtY = this.targetPositions[nearestTargetIdx].y;
            const tgtZ = this.targetPositions[nearestTargetIdx].z;

            // Alignment
            const avgAx = alignmentX * invCount;
            const avgAy = alignmentY * invCount;
            const avgAz = alignmentZ * invCount;
            const alignDx = avgAx - forwardX;
            const alignDy = avgAy - forwardY;
            const alignDz = avgAz - forwardZ;
            const alignLen = Math.sqrt(alignDx * alignDx + alignDy * alignDy + alignDz * alignDz);
            let alignRx = 0, alignRy = 0, alignRz = 0;
            if (alignLen > 0.0001) {
                const inv = this.BOID_ALIGNMENT_WEIGHT / alignLen;
                alignRx = alignDx * inv; alignRy = alignDy * inv; alignRz = alignDz * inv;
            }

            // Separation
            const sepDx = px * neighborCount - separationX;
            const sepDy = py * neighborCount - separationY;
            const sepDz = pz * neighborCount - separationZ;
            const sepLen = Math.sqrt(sepDx * sepDx + sepDy * sepDy + sepDz * sepDz);
            let sepRx = 0, sepRy = 0, sepRz = 0;
            if (sepLen > 0.0001) {
                const inv = this.BOID_SEPARATION_WEIGHT / sepLen;
                sepRx = sepDx * inv; sepRy = sepDy * inv; sepRz = sepDz * inv;
            }

            // Target seeking
            const targetDx = tgtX - px;
            const targetDy = tgtY - py;
            const targetDz = tgtZ - pz;
            const targetLen = Math.sqrt(targetDx * targetDx + targetDy * targetDy + targetDz * targetDz);
            let targetRx = 0, targetRy = 0, targetRz = 0;
            if (targetLen > 0.0001) {
                const inv = this.BOID_TARGET_WEIGHT / targetLen;
                targetRx = targetDx * inv; targetRy = targetDy * inv; targetRz = targetDz * inv;
            }

            // Obstacle avoidance
            const obsDx = px - obsX;
            const obsDy = py - obsY;
            const obsDz = pz - obsZ;
            const obsLen = Math.sqrt(obsDx * obsDx + obsDy * obsDy + obsDz * obsDz);
            let avoidHx = 0, avoidHy = 0, avoidHz = 0;
            if (obsLen > 0.0001) {
                const inv = 1.0 / obsLen;
                const nx = obsDx * inv;
                const ny = obsDy * inv;
                const nz = obsDz * inv;
                avoidHx = (obsX + nx * this.BOID_OBSTACLE_AVERSION_DISTANCE) - px;
                avoidHy = (obsY + ny * this.BOID_OBSTACLE_AVERSION_DISTANCE) - py;
                avoidHz = (obsZ + nz * this.BOID_OBSTACLE_AVERSION_DISTANCE) - pz;
            }

            // Combined steering
            let normalX = alignRx + sepRx + targetRx;
            let normalY = alignRy + sepRy + targetRy;
            let normalZ = alignRz + sepRz + targetRz;
            const normalLen = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
            if (normalLen > 0.0001) {
                const inv = 1.0 / normalLen;
                normalX *= inv; normalY *= inv; normalZ *= inv;
            } else {
                normalX = forwardX; normalY = forwardY; normalZ = forwardZ;
            }

            let targetFx, targetFy, targetFz;
            if (nearestObstacleDist < this.BOID_OBSTACLE_AVERSION_DISTANCE) {
                targetFx = avoidHx; targetFy = avoidHy; targetFz = avoidHz;
            } else {
                targetFx = normalX; targetFy = normalY; targetFz = normalZ;
            }

            // Smooth heading change
            let newHx = forwardX + dt * (targetFx - forwardX);
            let newHy = forwardY + dt * (targetFy - forwardY);
            let newHz = forwardZ + dt * (targetFz - forwardZ);
            const newLen = Math.sqrt(newHx * newHx + newHy * newHy + newHz * newHz);
            if (newLen > 0.0001) {
                const inv = 1.0 / newLen;
                newHx *= inv; newHy *= inv; newHz *= inv;
            }

            // Update ECS component data via TypedArrays
            posX[eid] = px + newHx * moveDist;
            posY[eid] = py + newHy * moveDist;
            posZ[eid] = pz + newHz * moveDist;
            headX[eid] = newHx;
            headY[eid] = newHy;
            headZ[eid] = newHz;
        }
    }

    buildInstanceMatrices() {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const boidIdx = this._boidIdx;
        const matrices = this.instanceMatrices;
        const scale = 1.0;
        const entities = this._boidEntities;

        for (let i = 0, len = entities.length; i < len; i++) {
            const eid = entities[i];
            const idx = boidIdx[eid];
            if (idx >= this.NUM_BOIDS) continue;

            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            const hx = headX[eid];
            const hy = headY[eid];
            const hz = headZ[eid];

            const offset = idx * 16;

            // Right = heading x up (0,1,0)
            let rx = -hz;
            let ry = 0;
            let rz = hx;
            const rLen = Math.sqrt(rx * rx + rz * rz);
            if (rLen > 0.0001) {
                const inv = 1.0 / rLen;
                rx *= inv; rz *= inv;
            }

            // Up = right x heading
            const ux = ry * hz - rz * hy;
            const uy = rz * hx - rx * hz;
            const uz = rx * hy - ry * hx;

            // Column 0: right
            matrices[offset + 0] = rx * scale;
            matrices[offset + 1] = ry * scale;
            matrices[offset + 2] = rz * scale;
            matrices[offset + 3] = 0;

            // Column 1: up
            matrices[offset + 4] = ux * scale;
            matrices[offset + 5] = uy * scale;
            matrices[offset + 6] = uz * scale;
            matrices[offset + 7] = 0;

            // Column 2: forward
            matrices[offset + 8] = hx * scale;
            matrices[offset + 9] = hy * scale;
            matrices[offset + 10] = hz * scale;
            matrices[offset + 11] = 0;

            // Column 3: translation
            matrices[offset + 12] = px;
            matrices[offset + 13] = py;
            matrices[offset + 14] = pz;
            matrices[offset + 15] = 1;
        }
    }

    getInstanceMatrices() {
        return this.instanceMatrices;
    }

    getFps() {
        return this.fps;
    }

    getBoidCount() {
        return this.NUM_BOIDS;
    }
}
