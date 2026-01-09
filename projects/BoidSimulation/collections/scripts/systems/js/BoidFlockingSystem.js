/**
 * BoidFlockingSystem - High-performance ECS boid flocking simulation
 *
 * Uses GUTS ECS with optimized TypedArray field access.
 * Leverages getEntityRange() for contiguous entity iteration.
 */
class BoidFlockingSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.boidFlockingSystem = this;

        // Configuration constants
        this.NUM_BOIDS = 100000;
        this.NUM_TARGETS = 2;
        this.NUM_OBSTACLES = 1;

        // Spatial hashing parameters - use power of 2 for fast modulo with bitwise AND
        this.GRID_SIZE = 16384; // 2^14
        this.GRID_MASK = 16383; // GRID_SIZE - 1, for bitwise AND instead of modulo
        this.CELL_SIZE = 8.0;
        this.INV_CELL_SIZE = 0.125; // 1.0 / 8.0

        // Boid behavior weights
        this.BOID_SEPARATION_WEIGHT = 1.0;
        this.BOID_ALIGNMENT_WEIGHT = 1.0;
        this.BOID_TARGET_WEIGHT = 2.0;
        this.BOID_OBSTACLE_AVERSION_DISTANCE = 30.0;
        this.BOID_MOVE_SPEED = 25.0;

        // Spawn configuration
        this.SPAWN_RADIUS = 15.0;
        this.SPAWN_CENTER_X = 20.0;
        this.SPAWN_CENTER_Y = 5.0;
        this.SPAWN_CENTER_Z = -120.0;

        // Cached ECS field arrays
        this._posX = null;
        this._posY = null;
        this._posZ = null;
        this._headX = null;
        this._headY = null;
        this._headZ = null;

        // Entity range for fast iteration
        this._boidRange = null;

        // Per-entity spatial hash
        this.boidHash = null;

        // Spatial hash bucket data
        this.bucketCounts = null;
        this.bucketSumAlignX = null;
        this.bucketSumAlignY = null;
        this.bucketSumAlignZ = null;
        this.bucketSumPosX = null;
        this.bucketSumPosY = null;
        this.bucketSumPosZ = null;
        this.bucketNearestTarget = null;
        this.bucketNearestObstacle = null;
        this.bucketNearestObstacleDist = null;

        // Target and obstacle data
        this.targetX = null;
        this.targetY = null;
        this.targetZ = null;
        this.obstacleX = null;
        this.obstacleY = null;
        this.obstacleZ = null;
        this.targetEntities = [];
        this.obstacleEntities = [];

        // Instance matrices for rendering
        this.instanceMatrices = null;

        // Performance tracking
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.fps = 0;

        // Cached DOM elements (to avoid getElementById every frame)
        this._domBoidCount = null;
        this._domFpsCounter = null;
        this._domEntityCount = null;
    }

    init() {
        console.log('BoidFlockingSystem initializing...');
        this.allocateBuckets();
        this.setupUI();
        console.log('BoidFlockingSystem initialized');
    }

    allocateBuckets() {
        const g = this.GRID_SIZE;

        // Spatial hash buckets
        this.bucketCounts = new Uint16Array(g);
        this.bucketSumAlignX = new Float32Array(g);
        this.bucketSumAlignY = new Float32Array(g);
        this.bucketSumAlignZ = new Float32Array(g);
        this.bucketSumPosX = new Float32Array(g);
        this.bucketSumPosY = new Float32Array(g);
        this.bucketSumPosZ = new Float32Array(g);
        this.bucketNearestTarget = new Uint8Array(g);
        this.bucketNearestObstacle = new Uint8Array(g);
        this.bucketNearestObstacleDist = new Float32Array(g);

        // Target/obstacle flat arrays
        this.targetX = new Float32Array(this.NUM_TARGETS);
        this.targetY = new Float32Array(this.NUM_TARGETS);
        this.targetZ = new Float32Array(this.NUM_TARGETS);
        this.obstacleX = new Float32Array(this.NUM_OBSTACLES);
        this.obstacleY = new Float32Array(this.NUM_OBSTACLES);
        this.obstacleZ = new Float32Array(this.NUM_OBSTACLES);
    }

    setupUI() {
        setTimeout(() => {
            const restartBtn = document.getElementById('restartBtn');
            const boidCountInput = document.getElementById('boidCountInput');

            // Cache DOM elements
            this._domBoidCount = document.getElementById('boidCount');
            this._domFpsCounter = document.getElementById('fpsCounter');
            this._domEntityCount = document.getElementById('entityCount');

            if (restartBtn) {
                restartBtn.addEventListener('click', () => {
                    const newCount = parseInt(boidCountInput?.value || '100000', 10);
                    this.restartSimulation(newCount);
                });
            }

            if (boidCountInput) {
                boidCountInput.value = this.NUM_BOIDS;
            }

            this.updateUI();
        }, 100);
    }

    updateUI() {
        // Use cached DOM elements and avoid toLocaleString in hot path
        if (this._domBoidCount) this._domBoidCount.textContent = 'Boids: ' + this.NUM_BOIDS;
        if (this._domFpsCounter) this._domFpsCounter.textContent = 'FPS: ' + this.fps;
        if (this._domEntityCount) this._domEntityCount.textContent = 'Entities: ' + (this.game.entityCount || 0);
    }

    restartSimulation(newBoidCount) {
        console.log(`Restarting simulation with ${newBoidCount} boids...`);

        // Destroy existing boid entities
        if (this._boidRange) {
            for (let eid = this._boidRange.start; eid < this._boidRange.end; eid++) {
                if (this.game.entityExists(eid)) {
                    this.game.destroyEntity(eid);
                }
            }
        }

        // Destroy target/obstacle entities
        for (const eid of this.targetEntities) {
            if (this.game.entityExists(eid)) this.game.destroyEntity(eid);
        }
        for (const eid of this.obstacleEntities) {
            if (this.game.entityExists(eid)) this.game.destroyEntity(eid);
        }
        this.targetEntities = [];
        this.obstacleEntities = [];

        // Update count
        this.NUM_BOIDS = newBoidCount;

        // Reallocate per-boid arrays
        this.boidHash = new Uint16Array(this.game.MAX_ENTITIES);
        this.instanceMatrices = new Float32Array(this.NUM_BOIDS * 16);

        // Respawn
        this.spawnBoids();
        this.spawnTargetsAndObstacles();

        // Re-cache field arrays and range
        this.cacheFieldArrays();

        // Notify render system
        const renderSystem = this.game.boidRenderSystem;
        if (renderSystem) renderSystem.onBoidCountChanged(this.NUM_BOIDS);

        this.updateUI();
        console.log(`Simulation restarted with ${this.NUM_BOIDS} boids`);
    }

    postAllInit() {
        this.spawnBoids();
        this.spawnTargetsAndObstacles();
        this.cacheFieldArrays();
        this.updateUI();
    }

    cacheFieldArrays() {
        // Cache ECS TypedArray references
        this._posX = this.game.getFieldArray('position', 'x');
        this._posY = this.game.getFieldArray('position', 'y');
        this._posZ = this.game.getFieldArray('position', 'z');
        this._headX = this.game.getFieldArray('heading', 'x');
        this._headY = this.game.getFieldArray('heading', 'y');
        this._headZ = this.game.getFieldArray('heading', 'z');

        // Get entity range for fast iteration
        this._boidRange = this.game.getEntityRange('boidTag');

        // Allocate per-entity hash array
        this.boidHash = new Uint16Array(this.game.MAX_ENTITIES);
        this.instanceMatrices = new Float32Array(this.NUM_BOIDS * 16);

        console.log('Cached ECS arrays. Boid range:', this._boidRange);
    }

    spawnBoids() {
        console.log(`Spawning ${this.NUM_BOIDS} boids using ECS...`);

        const cx = this.SPAWN_CENTER_X;
        const cy = this.SPAWN_CENTER_Y;
        const cz = this.SPAWN_CENTER_Z;
        const radius = this.SPAWN_RADIUS;

        for (let i = 0; i < this.NUM_BOIDS; i++) {
            const entityId = this.game.createEntity();

            // Seeded random
            const seed = (i + 1) * 0x9F6ABC1;
            let rx = Math.sin(seed) * 10000; rx = (rx - Math.floor(rx)) - 0.5;
            let ry = Math.sin(seed + 1) * 10000; ry = (ry - Math.floor(ry)) - 0.5;
            let rz = Math.sin(seed + 2) * 10000; rz = (rz - Math.floor(rz)) - 0.5;

            const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
            let hx = 0, hy = 1, hz = 0;
            if (len > 0.0001) {
                const inv = 1.0 / len;
                hx = rx * inv;
                hy = ry * inv;
                hz = rz * inv;
            }

            // Add ECS components with numerical data
            this.game.addComponent(entityId, 'position', {
                x: cx + hx * radius,
                y: cy + hy * radius,
                z: cz + hz * radius
            });
            this.game.addComponent(entityId, 'heading', { x: hx, y: hy, z: hz });
            this.game.addComponent(entityId, 'boidTag', { index: i });
        }

        console.log(`Spawned ${this.NUM_BOIDS} boids`);
    }

    spawnTargetsAndObstacles() {
        for (let i = 0; i < this.NUM_TARGETS; i++) {
            const entityId = this.game.createEntity();
            this.targetEntities.push(entityId);
            const angle = (i / this.NUM_TARGETS) * Math.PI * 2;
            this.targetX[i] = Math.cos(angle) * 100;
            this.targetY[i] = 10;
            this.targetZ[i] = -120 + Math.sin(angle) * 100;
            this.game.addComponent(entityId, 'position', {
                x: this.targetX[i], y: this.targetY[i], z: this.targetZ[i]
            });
            this.game.addComponent(entityId, 'target', { dummy: 0 });
        }

        for (let i = 0; i < this.NUM_OBSTACLES; i++) {
            const entityId = this.game.createEntity();
            this.obstacleEntities.push(entityId);
            this.obstacleX[i] = 0;
            this.obstacleY[i] = 5;
            this.obstacleZ[i] = -120;
            this.game.addComponent(entityId, 'position', {
                x: this.obstacleX[i], y: this.obstacleY[i], z: this.obstacleZ[i]
            });
            this.game.addComponent(entityId, 'obstacle', { dummy: 0 });
        }

        console.log(`Spawned ${this.NUM_TARGETS} targets and ${this.NUM_OBSTACLES} obstacles`);
    }

    update() {
        const dt = this.game.state?.deltaTime || 0.008333;
        const clampedDt = dt < 0.05 ? dt : 0.05;

        // FPS tracking
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime > 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = now;
            this.updateUI();
        }

        // Update simulation
        this.updateTargetsAndObstacles();
        this.computeSpatialHash();
        this.mergeBuckets();
        this.steerAndMove(clampedDt);
        this.buildInstanceMatrices();
    }

    updateTargetsAndObstacles() {
        const time = this.game.state?.now || (performance.now() * 0.001);

        for (let i = 0; i < this.NUM_TARGETS; i++) {
            const angle = time * 0.5 + (i / this.NUM_TARGETS) * Math.PI * 2;
            const radius = 80 + Math.sin(time * 0.3 + i) * 20;
            this.targetX[i] = Math.cos(angle) * radius;
            this.targetY[i] = 10 + Math.sin(time * 0.7 + i) * 5;
            this.targetZ[i] = -120 + Math.sin(angle) * radius;
        }

        for (let i = 0; i < this.NUM_OBSTACLES; i++) {
            const angle = time * 0.3;
            const radius = 50;
            this.obstacleX[i] = Math.cos(angle) * radius;
            this.obstacleY[i] = 5 + Math.sin(time * 0.5) * 3;
            this.obstacleZ[i] = -120 + Math.sin(angle) * radius;
        }
    }

    computeSpatialHash() {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const boidHash = this.boidHash;
        const counts = this.bucketCounts;
        const sumAX = this.bucketSumAlignX;
        const sumAY = this.bucketSumAlignY;
        const sumAZ = this.bucketSumAlignZ;
        const sumPX = this.bucketSumPosX;
        const sumPY = this.bucketSumPosY;
        const sumPZ = this.bucketSumPosZ;
        const invCell = this.INV_CELL_SIZE;
        const gridMask = this.GRID_MASK;
        const start = this._boidRange.start;
        const end = this._boidRange.end;

        // Clear buckets - use typed array views for faster clearing
        counts.fill(0);
        sumAX.fill(0);
        sumAY.fill(0);
        sumAZ.fill(0);
        sumPX.fill(0);
        sumPY.fill(0);
        sumPZ.fill(0);

        // Use contiguous entity range - direct iteration over ECS arrays
        for (let eid = start; eid < end; eid++) {
            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            const hx = headX[eid];
            const hy = headY[eid];
            const hz = headZ[eid];

            // Inline spatial hash with bitwise AND instead of modulo
            const cellX = (px * invCell) | 0;
            const cellY = (py * invCell) | 0;
            const cellZ = (pz * invCell) | 0;
            const hash = ((cellX * 73856093) ^ (cellY * 19349663) ^ (cellZ * 83492791)) & gridMask;

            boidHash[eid] = hash;
            counts[hash]++;
            sumAX[hash] += hx;
            sumAY[hash] += hy;
            sumAZ[hash] += hz;
            sumPX[hash] += px;
            sumPY[hash] += py;
            sumPZ[hash] += pz;
        }
    }

    mergeBuckets() {
        const counts = this.bucketCounts;
        const sumPX = this.bucketSumPosX;
        const sumPY = this.bucketSumPosY;
        const sumPZ = this.bucketSumPosZ;
        const nearestTarget = this.bucketNearestTarget;
        const nearestObs = this.bucketNearestObstacle;
        const nearestObsDist = this.bucketNearestObstacleDist;
        const gridSize = this.GRID_SIZE;
        const numTargets = this.NUM_TARGETS;
        const numObs = this.NUM_OBSTACLES;
        const tgtX = this.targetX;
        const tgtY = this.targetY;
        const tgtZ = this.targetZ;
        const obsX = this.obstacleX;
        const obsY = this.obstacleY;
        const obsZ = this.obstacleZ;

        for (let b = 0; b < gridSize; b++) {
            const cnt = counts[b];
            if (cnt === 0) continue;

            const invCnt = 1.0 / cnt;
            const cx = sumPX[b] * invCnt;
            const cy = sumPY[b] * invCnt;
            const cz = sumPZ[b] * invCnt;

            // Find nearest target
            let minDistSq = 1e18;
            let minIdx = 0;
            for (let t = 0; t < numTargets; t++) {
                const dx = tgtX[t] - cx;
                const dy = tgtY[t] - cy;
                const dz = tgtZ[t] - cz;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    minIdx = t;
                }
            }
            nearestTarget[b] = minIdx;

            // Find nearest obstacle - store squared distance to avoid sqrt
            minDistSq = 1e18;
            minIdx = 0;
            for (let o = 0; o < numObs; o++) {
                const dx = obsX[o] - cx;
                const dy = obsY[o] - cy;
                const dz = obsZ[o] - cz;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    minIdx = o;
                }
            }
            nearestObs[b] = minIdx;
            nearestObsDist[b] = minDistSq; // Store squared distance
        }
    }

    steerAndMove(dt) {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const boidHash = this.boidHash;
        const counts = this.bucketCounts;
        const sumAX = this.bucketSumAlignX;
        const sumAY = this.bucketSumAlignY;
        const sumAZ = this.bucketSumAlignZ;
        const sumPX = this.bucketSumPosX;
        const sumPY = this.bucketSumPosY;
        const sumPZ = this.bucketSumPosZ;
        const nearestTarget = this.bucketNearestTarget;
        const nearestObs = this.bucketNearestObstacle;
        const nearestObsDist = this.bucketNearestObstacleDist;
        const tgtX = this.targetX;
        const tgtY = this.targetY;
        const tgtZ = this.targetZ;
        const obsX = this.obstacleX;
        const obsY = this.obstacleY;
        const obsZ = this.obstacleZ;

        const sepWeight = this.BOID_SEPARATION_WEIGHT;
        const alignWeight = this.BOID_ALIGNMENT_WEIGHT;
        const targetWeight = this.BOID_TARGET_WEIGHT;
        const avoidDistSq = this.BOID_OBSTACLE_AVERSION_DISTANCE * this.BOID_OBSTACLE_AVERSION_DISTANCE;
        const moveDist = this.BOID_MOVE_SPEED * dt;

        const start = this._boidRange.start;
        const end = this._boidRange.end;

        // Direct iteration over ECS entity range
        for (let eid = start; eid < end; eid++) {
            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            let hx = headX[eid];
            let hy = headY[eid];
            let hz = headZ[eid];

            const hash = boidHash[eid];
            const cnt = counts[hash];

            let alignRx = 0, alignRy = 0, alignRz = 0;
            let sepRx = 0, sepRy = 0, sepRz = 0;

            if (cnt > 0) {
                const invCnt = 1.0 / cnt;

                // Alignment - use squared length comparison, normalize only if needed
                const avgHx = sumAX[hash] * invCnt;
                const avgHy = sumAY[hash] * invCnt;
                const avgHz = sumAZ[hash] * invCnt;
                const adx = avgHx - hx;
                const ady = avgHy - hy;
                const adz = avgHz - hz;
                const aLenSq = adx * adx + ady * ady + adz * adz;
                if (aLenSq > 0.00000001) {
                    const inv = alignWeight / Math.sqrt(aLenSq);
                    alignRx = adx * inv;
                    alignRy = ady * inv;
                    alignRz = adz * inv;
                }

                // Separation
                const sdx = px - sumPX[hash] * invCnt;
                const sdy = py - sumPY[hash] * invCnt;
                const sdz = pz - sumPZ[hash] * invCnt;
                const sLenSq = sdx * sdx + sdy * sdy + sdz * sdz;
                if (sLenSq > 0.00000001) {
                    const inv = sepWeight / Math.sqrt(sLenSq);
                    sepRx = sdx * inv;
                    sepRy = sdy * inv;
                    sepRz = sdz * inv;
                }
            }

            // Target seeking
            const tIdx = nearestTarget[hash];
            const tdx = tgtX[tIdx] - px;
            const tdy = tgtY[tIdx] - py;
            const tdz = tgtZ[tIdx] - pz;
            const tLenSq = tdx * tdx + tdy * tdy + tdz * tdz;
            let targetRx = 0, targetRy = 0, targetRz = 0;
            if (tLenSq > 0.00000001) {
                const inv = targetWeight / Math.sqrt(tLenSq);
                targetRx = tdx * inv;
                targetRy = tdy * inv;
                targetRz = tdz * inv;
            }

            // Combine steering
            let nx = alignRx + sepRx + targetRx;
            let ny = alignRy + sepRy + targetRy;
            let nz = alignRz + sepRz + targetRz;
            let nLenSq = nx * nx + ny * ny + nz * nz;
            if (nLenSq > 0.00000001) {
                const inv = 1.0 / Math.sqrt(nLenSq);
                nx *= inv;
                ny *= inv;
                nz *= inv;
            } else {
                nx = hx;
                ny = hy;
                nz = hz;
            }

            // Obstacle avoidance - nearestObsDist already stores squared distance
            const obsDistSq = nearestObsDist[hash];
            if (obsDistSq < avoidDistSq) {
                const oIdx = nearestObs[hash];
                const odx = px - obsX[oIdx];
                const ody = py - obsY[oIdx];
                const odz = pz - obsZ[oIdx];
                const oLenSq = odx * odx + ody * ody + odz * odz;
                if (oLenSq > 0.00000001) {
                    const inv = 1.0 / Math.sqrt(oLenSq);
                    nx = odx * inv;
                    ny = ody * inv;
                    nz = odz * inv;
                }
            }

            // Smooth heading transition
            hx += dt * (nx - hx);
            hy += dt * (ny - hy);
            hz += dt * (nz - hz);
            nLenSq = hx * hx + hy * hy + hz * hz;
            if (nLenSq > 0.00000001) {
                const inv = 1.0 / Math.sqrt(nLenSq);
                hx *= inv;
                hy *= inv;
                hz *= inv;
            }

            // Update ECS component data directly
            posX[eid] = px + hx * moveDist;
            posY[eid] = py + hy * moveDist;
            posZ[eid] = pz + hz * moveDist;
            headX[eid] = hx;
            headY[eid] = hy;
            headZ[eid] = hz;
        }
    }

    buildInstanceMatrices() {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const headX = this._headX;
        const headY = this._headY;
        const headZ = this._headZ;
        const matrices = this.instanceMatrices;
        const start = this._boidRange.start;
        const end = this._boidRange.end;

        let matrixIdx = 0;
        for (let eid = start; eid < end; eid++) {
            const px = posX[eid];
            const py = posY[eid];
            const pz = posZ[eid];
            const hx = headX[eid];
            const hy = headY[eid];
            const hz = headZ[eid];

            // Right = heading x up (0,1,0)
            let rx = -hz;
            let ry = 0;
            let rz = hx;
            const rLen = Math.sqrt(rx * rx + rz * rz);
            if (rLen > 0.0001) {
                const inv = 1.0 / rLen;
                rx *= inv;
                rz *= inv;
            }

            // Up = right x heading
            const ux = ry * hz - rz * hy;
            const uy = rz * hx - rx * hz;
            const uz = rx * hy - ry * hx;

            const offset = matrixIdx * 16;
            matrixIdx++;

            // Column-major 4x4 matrix
            matrices[offset] = rx;
            matrices[offset + 1] = ry;
            matrices[offset + 2] = rz;
            matrices[offset + 3] = 0;
            matrices[offset + 4] = ux;
            matrices[offset + 5] = uy;
            matrices[offset + 6] = uz;
            matrices[offset + 7] = 0;
            matrices[offset + 8] = hx;
            matrices[offset + 9] = hy;
            matrices[offset + 10] = hz;
            matrices[offset + 11] = 0;
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
