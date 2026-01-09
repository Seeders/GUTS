/**
 * ParticlePhysicsSystem - Handles physics for active particles
 *
 * Applies gravity, handles collisions with voxel grid, and settles particles.
 */
class ParticlePhysicsSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.particlePhysicsSystem = this;

        // Physics constants
        this.GRAVITY = -30.0;
        this.MAX_VELOCITY = 50.0;
        this.DAMPING = 0.98;

        // Settling threshold - velocity below this causes settling
        this.SETTLE_THRESHOLD = 0.5;
        this.SETTLE_FRAMES = 3; // Frames at low velocity before settling

        // Cached component arrays
        this._posX = null;
        this._posY = null;
        this._posZ = null;
        this._velX = null;
        this._velY = null;
        this._velZ = null;
        this._material = null;

        // Particle range
        this._particleRange = null;

        // Settle frame counters (per particle)
        this.settleCounters = null;

        // Active particle count
        this.activeCount = 0;

        // Paused state
        this.paused = false;
    }

    init() {
        console.log('ParticlePhysicsSystem initializing...');
        this.cacheComponentArrays();
        console.log('ParticlePhysicsSystem initialized');
    }

    cacheComponentArrays() {
        this._posX = this.game.getFieldArray('position', 'x');
        this._posY = this.game.getFieldArray('position', 'y');
        this._posZ = this.game.getFieldArray('position', 'z');
        this._velX = this.game.getFieldArray('velocity', 'vx');
        this._velY = this.game.getFieldArray('velocity', 'vy');
        this._velZ = this.game.getFieldArray('velocity', 'vz');
        this._material = this.game.getFieldArray('material', 'type');
    }

    update() {
        this.runPhysics(this.game.deltaTime);
    }

    runPhysics(dt) {
        if (this.paused) return;

        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        // Get particle entity range
        this._particleRange = this.game.getEntityRange('particleTag');
        if (!this._particleRange || this._particleRange.count === 0) {
            this.activeCount = 0;
            return;
        }

        // Re-cache arrays if needed
        if (!this._posX) this.cacheComponentArrays();

        // Initialize settle counters if needed
        if (!this.settleCounters || this.settleCounters.length < this._particleRange.end) {
            this.settleCounters = new Uint8Array(this._particleRange.end + 1000);
        }

        this.updateParticles(dt, voxelGrid);
    }

    updateParticles(dt, voxelGrid) {
        const posX = this._posX;
        const posY = this._posY;
        const posZ = this._posZ;
        const velX = this._velX;
        const velY = this._velY;
        const velZ = this._velZ;
        const material = this._material;

        const start = this._particleRange.start;
        const end = this._particleRange.end;
        const gravity = this.GRAVITY;
        const maxVel = this.MAX_VELOCITY;
        const damping = this.DAMPING;
        const settleThresh = this.SETTLE_THRESHOLD;
        const settleFrames = this.SETTLE_FRAMES;
        const counters = this.settleCounters;

        const SAND = voxelGrid.MATERIAL.SAND;
        const WATER = voxelGrid.MATERIAL.WATER;
        const STONE = voxelGrid.MATERIAL.STONE;

        let activeCount = 0;
        const toSettle = [];

        for (let eid = start; eid < end; eid++) {
            const mat = material[eid];
            if (mat === 0) continue; // Skip air/destroyed particles

            activeCount++;

            let px = posX[eid];
            let py = posY[eid];
            let pz = posZ[eid];
            let vx = velX[eid];
            let vy = velY[eid];
            let vz = velZ[eid];

            // Apply gravity (except for fire/steam which rise)
            if (mat === voxelGrid.MATERIAL.FIRE || mat === voxelGrid.MATERIAL.STEAM) {
                vy += -gravity * 0.5 * dt; // Rise
            } else {
                vy += gravity * dt;
            }

            // Clamp velocity
            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (speed > maxVel) {
                const scale = maxVel / speed;
                vx *= scale;
                vy *= scale;
                vz *= scale;
            }

            // Calculate new position
            let nx = px + vx * dt;
            let ny = py + vy * dt;
            let nz = pz + vz * dt;

            // Get grid coordinates
            const gridCoords = voxelGrid.worldToGrid(nx, ny, nz);
            const gx = gridCoords.x;
            const gy = gridCoords.y;
            const gz = gridCoords.z;

            // Check collision with voxel grid
            let collided = false;

            if (!voxelGrid.isEmpty(gx, gy, gz)) {
                collided = true;

                // Try to find an empty adjacent cell
                if (mat === SAND) {
                    // Sand tries to fall to sides if blocked below
                    if (voxelGrid.isEmpty(gx - 1, gy, gz)) {
                        nx = px - 0.5;
                        collided = false;
                    } else if (voxelGrid.isEmpty(gx + 1, gy, gz)) {
                        nx = px + 0.5;
                        collided = false;
                    } else if (voxelGrid.isEmpty(gx, gy, gz - 1)) {
                        nz = pz - 0.5;
                        collided = false;
                    } else if (voxelGrid.isEmpty(gx, gy, gz + 1)) {
                        nz = pz + 0.5;
                        collided = false;
                    }
                } else if (mat === WATER) {
                    // Water spreads horizontally - check multiple distances
                    const dirs = [
                        { dx: -1, dz: 0 },
                        { dx: 1, dz: 0 },
                        { dx: 0, dz: -1 },
                        { dx: 0, dz: 1 },
                        { dx: -1, dz: -1 },
                        { dx: -1, dz: 1 },
                        { dx: 1, dz: -1 },
                        { dx: 1, dz: 1 }
                    ];
                    // Shuffle for randomness
                    for (let i = dirs.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
                    }
                    // Try to spread - check further distances too
                    for (const dir of dirs) {
                        // Try 1, 2, or 3 cells away
                        for (let dist = 1; dist <= 3; dist++) {
                            const checkX = gx + dir.dx * dist;
                            const checkZ = gz + dir.dz * dist;
                            if (voxelGrid.isEmpty(checkX, gy, checkZ)) {
                                // Also check if there's a path (for dist > 1)
                                let pathClear = true;
                                for (let d = 1; d < dist; d++) {
                                    if (!voxelGrid.isEmpty(gx + dir.dx * d, gy, gz + dir.dz * d)) {
                                        pathClear = false;
                                        break;
                                    }
                                }
                                if (pathClear) {
                                    nx = px + dir.dx * dist * 0.5;
                                    nz = pz + dir.dz * dist * 0.5;
                                    collided = false;
                                    break;
                                }
                            }
                        }
                        if (!collided) break;
                    }
                    // Water also tries to flow down through diagonal paths
                    if (collided && voxelGrid.isEmpty(gx, gy - 1, gz)) {
                        ny = py - 0.5;
                        collided = false;
                    }
                }

                if (collided) {
                    // Stop at collision point
                    nx = px;
                    ny = py;
                    nz = pz;
                    vx *= 0.1;
                    vy = 0;
                    vz *= 0.1;
                }
            }

            // Boundary check
            const bounds = voxelGrid.getWorldBounds();
            if (nx < bounds.minX) { nx = bounds.minX; vx = 0; }
            if (nx > bounds.maxX) { nx = bounds.maxX; vx = 0; }
            if (ny < 0) { ny = 0; vy = 0; collided = true; }
            if (ny > bounds.maxY) { ny = bounds.maxY; vy = 0; }
            if (nz < bounds.minZ) { nz = bounds.minZ; vz = 0; }
            if (nz > bounds.maxZ) { nz = bounds.maxZ; vz = 0; }

            // Apply damping
            vx *= damping;
            vz *= damping;

            // Update position and velocity
            posX[eid] = nx;
            posY[eid] = ny;
            posZ[eid] = nz;
            velX[eid] = vx;
            velY[eid] = vy;
            velZ[eid] = vz;

            // Check for settling
            if (mat === SAND || mat === STONE || mat === voxelGrid.MATERIAL.WOOD) {
                // Solids settle when stopped
                const totalVel = Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
                if (totalVel < settleThresh && collided) {
                    counters[eid]++;
                    if (counters[eid] >= settleFrames) {
                        toSettle.push(eid);
                    }
                } else {
                    counters[eid] = 0;
                }
            } else if (mat === WATER) {
                // Water settles when stopped and has support below
                // The voxel grid's water flow simulation will handle spreading
                const totalVel = Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
                if (totalVel < settleThresh && collided) {
                    // Check if there's solid support below
                    const belowMat = voxelGrid.get(gx, gy - 1, gz);
                    const hasSupport = belowMat !== voxelGrid.MATERIAL.AIR;

                    if (hasSupport) {
                        counters[eid]++;
                        if (counters[eid] >= settleFrames * 2) {
                            toSettle.push(eid);
                        }
                    } else {
                        counters[eid] = 0;
                    }
                } else {
                    counters[eid] = 0;
                }
            }
        }

        // Settle particles that have stopped
        for (const eid of toSettle) {
            this.settleParticle(eid, voxelGrid);
        }

        this.activeCount = activeCount - toSettle.length;
    }

    settleParticle(eid, voxelGrid) {
        const px = this._posX[eid];
        const py = this._posY[eid];
        const pz = this._posZ[eid];
        const mat = this._material[eid];

        const gridCoords = voxelGrid.worldToGrid(px, py, pz);

        // Only settle if the cell is empty
        if (voxelGrid.isEmpty(gridCoords.x, gridCoords.y, gridCoords.z)) {
            voxelGrid.set(gridCoords.x, gridCoords.y, gridCoords.z, mat);
        }

        // Destroy the active particle
        this.game.destroyEntity(eid);
    }

    /**
     * Wake up settled voxels in a region (convert back to active particles)
     */
    wakeRegion(gx, gy, gz, radius) {
        const voxelGrid = this.game.voxelGridSystem;
        if (!voxelGrid) return;

        for (let dz = -radius; dz <= radius; dz++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const x = gx + dx;
                    const y = gy + dy;
                    const z = gz + dz;

                    const mat = voxelGrid.get(x, y, z);
                    if (mat !== voxelGrid.MATERIAL.AIR && mat !== voxelGrid.MATERIAL.STONE) {
                        // Convert settled voxel to active particle
                        const worldPos = voxelGrid.gridToWorld(x, y, z);
                        this.spawnParticle(worldPos.x, worldPos.y, worldPos.z, mat);
                        voxelGrid.set(x, y, z, voxelGrid.MATERIAL.AIR);
                    }
                }
            }
        }
    }

    /**
     * Spawn an active particle
     */
    spawnParticle(x, y, z, materialType, vx = 0, vy = 0, vz = 0) {
        const eid = this.game.createEntity();

        this.game.addComponent(eid, 'position', { x, y, z });
        this.game.addComponent(eid, 'velocity', { vx, vy, vz });
        this.game.addComponent(eid, 'material', { type: materialType });
        this.game.addComponent(eid, 'particleTag', { active: 1 });

        // Re-cache arrays since entity count changed
        this.cacheComponentArrays();

        return eid;
    }
}
