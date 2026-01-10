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

        // Speed multiplier (1.0 = normal speed)
        this.speedMultiplier = 1.0;
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
        // Apply speed multiplier to deltaTime
        this.runPhysics(this.game.deltaTime * this.speedMultiplier);
    }

    runPhysics(dt) {
        if (this.paused || dt === 0) return;

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
                    // Water can pass through other water - check what we hit
                    const hitMat = voxelGrid.get(gx, gy, gz);

                    if (hitMat === WATER) {
                        // Hit settled water - allow passing through while searching
                        // Keep falling/moving, the settling logic below will handle finding a spot
                        collided = false;
                    } else {
                        // Hit solid (stone, sand, etc.) - find a spot to settle
                        const settlePos = this.findWaterSettlePosition(voxelGrid, gx, gy, gz);
                        if (settlePos) {
                            voxelGrid.set(settlePos.x, settlePos.y, settlePos.z, WATER);
                            material[eid] = 0;
                            continue;
                        }
                        // No valid position found - destroy the particle
                        material[eid] = 0;
                        continue;
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
                // Water settles when it finds an empty cell with support
                const waterGridPos = voxelGrid.worldToGrid(nx, ny, nz);
                const wx = waterGridPos.x;
                const wy = waterGridPos.y;
                const wz = waterGridPos.z;
                const currentCellMat = voxelGrid.get(wx, wy, wz);
                const belowMat = voxelGrid.get(wx, wy - 1, wz);

                // If current cell is empty and has solid support, settle here
                if (currentCellMat === voxelGrid.MATERIAL.AIR &&
                    belowMat !== voxelGrid.MATERIAL.AIR &&
                    belowMat !== voxelGrid.MATERIAL.WATER) {
                    // Found empty cell with solid support - settle!
                    voxelGrid.set(wx, wy, wz, WATER);
                    material[eid] = 0;
                }
                // If we're inside settled water, search for space to settle
                else if (currentCellMat === WATER || belowMat === WATER) {
                    // Check if there's air above the water surface to settle on top
                    // Find the top of the water column
                    let surfaceY = wy;
                    while (voxelGrid.get(wx, surfaceY, wz) === WATER && surfaceY < voxelGrid.sizeY - 1) {
                        surfaceY++;
                    }

                    // If we found air above water, settle there
                    if (voxelGrid.get(wx, surfaceY, wz) === voxelGrid.MATERIAL.AIR) {
                        voxelGrid.set(wx, surfaceY, wz, WATER);
                        material[eid] = 0;
                    } else {
                        // Water body is capped - apply drift to find edges
                        if (Math.abs(vx) < 3 && Math.abs(vz) < 3) {
                            velX[eid] += (Math.random() - 0.5) * 5;
                            velZ[eid] += (Math.random() - 0.5) * 5;
                        }
                        if (vy < 1) {
                            velY[eid] += 0.5;
                        }
                    }
                }
                // If below is air, keep falling
                // Otherwise search for empty spot
                else if (belowMat !== voxelGrid.MATERIAL.AIR && currentCellMat !== voxelGrid.MATERIAL.AIR) {
                    // Hit something solid and cell is occupied - find nearby empty cell
                    const settlePos = this.findWaterSettlePosition(voxelGrid, wx, wy, wz);
                    if (settlePos) {
                        voxelGrid.set(settlePos.x, settlePos.y, settlePos.z, WATER);
                    }
                    material[eid] = 0;
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
        const gx = gridCoords.x;
        const gy = gridCoords.y;
        const gz = gridCoords.z;

        // For water, find the best settle position
        if (mat === voxelGrid.MATERIAL.WATER) {
            if (voxelGrid.isEmpty(gx, gy, gz)) {
                voxelGrid.set(gx, gy, gz, mat);
            } else {
                const settlePos = this.findWaterSettlePosition(voxelGrid, gx, gy, gz);
                if (settlePos) {
                    voxelGrid.set(settlePos.x, settlePos.y, settlePos.z, mat);
                }
            }
            this.game.destroyEntity(eid);
            return;
        }

        // Only settle if the cell is empty
        if (voxelGrid.isEmpty(gx, gy, gz)) {
            voxelGrid.set(gx, gy, gz, mat);
        }

        // Destroy the active particle
        this.game.destroyEntity(eid);
    }

    /**
     * Find the best position to settle water - searches outward for empty cells
     * Prefers lower positions, fills layer by layer
     */
    findWaterSettlePosition(voxelGrid, startX, startY, startZ) {
        const AIR = voxelGrid.MATERIAL.AIR;
        const WATER = voxelGrid.MATERIAL.WATER;

        // First check if we can go directly below
        for (let y = startY; y >= 1; y--) {
            if (voxelGrid.isEmpty(startX, y, startZ)) {
                const belowMat = voxelGrid.get(startX, y - 1, startZ);
                if (belowMat !== AIR) {
                    return { x: startX, y, z: startZ };
                }
            } else {
                break; // Hit something, stop going down
            }
        }

        // Search outward at the starting Y level and below
        const dirs = [
            { dx: -1, dz: 0 }, { dx: 1, dz: 0 },
            { dx: 0, dz: -1 }, { dx: 0, dz: 1 },
            { dx: -1, dz: -1 }, { dx: -1, dz: 1 },
            { dx: 1, dz: -1 }, { dx: 1, dz: 1 }
        ];

        // Shuffle directions for randomness
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }

        // Search for empty spot with support, preferring lower Y levels
        let bestPos = null;
        let bestY = startY + 100; // Higher Y is worse

        for (const dir of dirs) {
            for (let dist = 1; dist <= 30; dist++) {
                const x = startX + dir.dx * dist;
                const z = startZ + dir.dz * dist;

                // Check from current Y down to find lowest empty spot
                for (let y = startY; y >= 1; y--) {
                    const mat = voxelGrid.get(x, y, z);
                    const belowMat = voxelGrid.get(x, y - 1, z);

                    if (mat === AIR && belowMat !== AIR) {
                        // Found valid spot - is it better than current best?
                        if (y < bestY) {
                            bestY = y;
                            bestPos = { x, y, z };
                        }
                        break; // Found best at this x,z - move to next
                    } else if (mat !== AIR && mat !== WATER) {
                        break; // Hit solid, can't go lower
                    }
                }
            }
        }

        // If no spot found below or at same level, search upward (stacking)
        if (!bestPos) {
            for (const dir of dirs) {
                for (let dist = 1; dist <= 20; dist++) {
                    const x = startX + dir.dx * dist;
                    const z = startZ + dir.dz * dist;

                    // Check upward for empty spot on top of water/solid
                    for (let y = startY; y <= startY + 10; y++) {
                        const mat = voxelGrid.get(x, y, z);
                        const belowMat = voxelGrid.get(x, y - 1, z);

                        if (mat === AIR && belowMat !== AIR) {
                            return { x, y, z };
                        }
                    }
                }
            }

            // Last resort - check directly above starting position
            for (let y = startY; y <= startY + 20; y++) {
                if (voxelGrid.isEmpty(startX, y, startZ)) {
                    const belowMat = voxelGrid.get(startX, y - 1, startZ);
                    if (belowMat !== AIR) {
                        return { x: startX, y, z: startZ };
                    }
                }
            }
        }

        return bestPos;
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
