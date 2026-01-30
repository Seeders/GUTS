/**
 * CollisionSystem - AABB collision detection and response
 * Ports swept AABB collision from player.rs
 */
class CollisionSystem extends GUTS.BaseSystem {
    static services = [
        'moveWithCollision',
        'checkAABBCollision',
        'getBlocksInAABB'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.collisionSystem = this;

        // Collision constants
        this.TOLERANCE = 0.001;
        this.MAX_ITERATIONS = 3;

        // Cached references
        this.worldSystem = null;

        // Pre-allocated arrays to reduce GC pressure
        this._pos = [0, 0, 0];
        this._vel = [0, 0, 0];
        this._delta = [0, 0, 0];
        this._elevatedPos = [0, 0, 0];
        this._resultPos = [0, 0, 0];
        this._resultVel = [0, 0, 0];
        this._slideTemp = [0, 0, 0];
    }

    init() {
        console.log('CollisionSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        console.log('CollisionSystem initialized');
    }

    update() {
        // Collision system is called by other systems, no per-frame update needed
    }

    /**
     * Move an AABB through the world with collision response
     * Returns new position and velocity after collision
     */
    moveWithCollision(position, size, velocity, dt) {
        // Reuse pre-allocated arrays to reduce GC
        const pos = this._pos;
        const vel = this._vel;
        const delta = this._delta;
        pos[0] = position[0]; pos[1] = position[1]; pos[2] = position[2];
        vel[0] = velocity[0]; vel[1] = velocity[1]; vel[2] = velocity[2];
        delta[0] = vel[0] * dt; delta[1] = vel[1] * dt; delta[2] = vel[2] * dt;
        let groundedThisFrame = false;

        // Resolve each axis separately to prevent corner clipping
        // This is more robust than resolving all axes together

        // Y axis first (gravity/jump)
        if (Math.abs(delta[1]) > this.TOLERANCE) {
            const yCollision = this.sweepAxis(pos, size, 1, delta[1]);
            if (yCollision) {
                pos[1] += delta[1] * yCollision.time + yCollision.normal * this.TOLERANCE;
                if (yCollision.normal > 0) {
                    groundedThisFrame = true;
                    vel[1] = 0;
                } else if (yCollision.normal < 0) {
                    vel[1] = 0; // Hit ceiling
                }
            } else {
                pos[1] += delta[1];
            }
        }

        // X axis
        if (Math.abs(delta[0]) > this.TOLERANCE) {
            const xCollision = this.sweepAxis(pos, size, 0, delta[0]);
            if (xCollision) {
                pos[0] += delta[0] * xCollision.time + xCollision.normal * this.TOLERANCE;
                // Project X velocity onto wall (frictionless)
                vel[0] = 0;
            } else {
                pos[0] += delta[0];
            }
        }

        // Z axis
        if (Math.abs(delta[2]) > this.TOLERANCE) {
            const zCollision = this.sweepAxis(pos, size, 2, delta[2]);
            if (zCollision) {
                pos[2] += delta[2] * zCollision.time + zCollision.normal * this.TOLERANCE;
                // Project Z velocity onto wall (frictionless)
                vel[2] = 0;
            } else {
                pos[2] += delta[2];
            }
        }

        // Final depenetration - push out of any blocks we ended up inside
        this.depenetrate(pos, size);

        // Simple ground check: is there a block directly under our feet?
        if (!groundedThisFrame && vel[1] <= 0) {
            const feetY = Math.floor(pos[1] - 0.01);
            const px = pos[0], pz = pos[2];
            const hw = size[0] * 0.4, hd = size[2] * 0.4;

            if (this.worldSystem.getBlock(Math.floor(px), feetY, Math.floor(pz)) ||
                this.worldSystem.getBlock(Math.floor(px - hw), feetY, Math.floor(pz)) ||
                this.worldSystem.getBlock(Math.floor(px + hw), feetY, Math.floor(pz)) ||
                this.worldSystem.getBlock(Math.floor(px), feetY, Math.floor(pz - hd)) ||
                this.worldSystem.getBlock(Math.floor(px), feetY, Math.floor(pz + hd))) {
                groundedThisFrame = true;
                vel[1] = 0;
            }
        }

        // Copy results to output arrays
        this._resultPos[0] = pos[0]; this._resultPos[1] = pos[1]; this._resultPos[2] = pos[2];
        this._resultVel[0] = vel[0]; this._resultVel[1] = vel[1]; this._resultVel[2] = vel[2];

        return {
            position: this._resultPos,
            velocity: this._resultVel,
            groundedThisFrame
        };
    }

    /**
     * Sweep along a single axis and find first collision
     */
    sweepAxis(pos, size, axis, delta) {
        const hw = size[0] / 2;
        const hh = size[1];
        const hd = size[2] / 2;

        // Player bounds
        const pMinX = pos[0] - hw;
        const pMaxX = pos[0] + hw;
        const pMinY = pos[1];
        const pMaxY = pos[1] + hh;
        const pMinZ = pos[2] - hd;
        const pMaxZ = pos[2] + hd;

        // Compute sweep range for this axis
        let minCoord, maxCoord;
        if (axis === 0) { // X
            minCoord = delta < 0 ? Math.floor(pMinX + delta) : Math.floor(pMinX);
            maxCoord = delta > 0 ? Math.floor(pMaxX + delta) : Math.floor(pMaxX);
        } else if (axis === 1) { // Y
            minCoord = delta < 0 ? Math.floor(pMinY + delta) : Math.floor(pMinY);
            maxCoord = delta > 0 ? Math.floor(pMaxY + delta) : Math.floor(pMaxY);
        } else { // Z
            minCoord = delta < 0 ? Math.floor(pMinZ + delta) : Math.floor(pMinZ);
            maxCoord = delta > 0 ? Math.floor(pMaxZ + delta) : Math.floor(pMaxZ);
        }

        let nearestTime = 1.0;
        let hitNormal = 0;

        // Check all blocks in the sweep range
        const yStart = Math.floor(pMinY) - 1;
        const yEnd = Math.floor(pMaxY) + 1;
        const xStart = Math.floor(pMinX) - 1;
        const xEnd = Math.floor(pMaxX) + 1;
        const zStart = Math.floor(pMinZ) - 1;
        const zEnd = Math.floor(pMaxZ) + 1;

        for (let by = yStart; by <= yEnd; by++) {
            for (let bx = xStart; bx <= xEnd; bx++) {
                for (let bz = zStart; bz <= zEnd; bz++) {
                    if (!this.worldSystem.getBlock(bx, by, bz)) continue;

                    // Check if block overlaps on non-sweep axes
                    const blockMin = [bx, by, bz];
                    const blockMax = [bx + 1, by + 1, bz + 1];

                    // Must overlap on other two axes
                    let overlapsOther = true;
                    if (axis !== 0 && (pMaxX <= blockMin[0] || pMinX >= blockMax[0])) overlapsOther = false;
                    if (axis !== 1 && (pMaxY <= blockMin[1] || pMinY >= blockMax[1])) overlapsOther = false;
                    if (axis !== 2 && (pMaxZ <= blockMin[2] || pMinZ >= blockMax[2])) overlapsOther = false;
                    if (!overlapsOther) continue;

                    // Compute collision time on sweep axis
                    let pMin, pMax;
                    if (axis === 0) { pMin = pMinX; pMax = pMaxX; }
                    else if (axis === 1) { pMin = pMinY; pMax = pMaxY; }
                    else { pMin = pMinZ; pMax = pMaxZ; }

                    let t, normal;
                    if (delta > 0) {
                        // Moving positive: hit block's min face
                        t = (blockMin[axis] - pMax) / delta;
                        normal = -1;
                    } else {
                        // Moving negative: hit block's max face
                        t = (blockMax[axis] - pMin) / delta;
                        normal = 1;
                    }

                    if (t >= 0 && t < nearestTime) {
                        nearestTime = t;
                        hitNormal = normal;
                    }
                }
            }
        }

        if (nearestTime < 1.0) {
            return { time: nearestTime, normal: hitNormal };
        }
        return null;
    }

    /**
     * Push player out of any blocks they're overlapping
     */
    depenetrate(pos, size) {
        const hw = size[0] / 2;
        const hh = size[1];
        const hd = size[2] / 2;

        for (let iter = 0; iter < 4; iter++) {
            const pMinX = pos[0] - hw;
            const pMaxX = pos[0] + hw;
            const pMinY = pos[1];
            const pMaxY = pos[1] + hh;
            const pMinZ = pos[2] - hd;
            const pMaxZ = pos[2] + hd;

            let smallestPen = Infinity;
            let pushAxis = -1;
            let pushDir = 0;

            // Check all potentially overlapping blocks
            for (let by = Math.floor(pMinY); by <= Math.floor(pMaxY); by++) {
                for (let bx = Math.floor(pMinX); bx <= Math.floor(pMaxX); bx++) {
                    for (let bz = Math.floor(pMinZ); bz <= Math.floor(pMaxZ); bz++) {
                        if (!this.worldSystem.getBlock(bx, by, bz)) continue;

                        // Check actual overlap (AABB vs AABB)
                        const blockMin = [bx, by, bz];
                        const blockMax = [bx + 1, by + 1, bz + 1];

                        if (pMaxX <= blockMin[0] || pMinX >= blockMax[0]) continue;
                        if (pMaxY <= blockMin[1] || pMinY >= blockMax[1]) continue;
                        if (pMaxZ <= blockMin[2] || pMinZ >= blockMax[2]) continue;

                        // Calculate penetration on each axis
                        const penX1 = pMaxX - blockMin[0]; // Push -X
                        const penX2 = blockMax[0] - pMinX; // Push +X
                        const penY1 = pMaxY - blockMin[1]; // Push -Y
                        const penY2 = blockMax[1] - pMinY; // Push +Y
                        const penZ1 = pMaxZ - blockMin[2]; // Push -Z
                        const penZ2 = blockMax[2] - pMinZ; // Push +Z

                        // Find smallest penetration
                        if (penX1 < smallestPen) { smallestPen = penX1; pushAxis = 0; pushDir = -1; }
                        if (penX2 < smallestPen) { smallestPen = penX2; pushAxis = 0; pushDir = 1; }
                        if (penY1 < smallestPen) { smallestPen = penY1; pushAxis = 1; pushDir = -1; }
                        if (penY2 < smallestPen) { smallestPen = penY2; pushAxis = 1; pushDir = 1; }
                        if (penZ1 < smallestPen) { smallestPen = penZ1; pushAxis = 2; pushDir = -1; }
                        if (penZ2 < smallestPen) { smallestPen = penZ2; pushAxis = 2; pushDir = 1; }
                    }
                }
            }

            if (pushAxis === -1) break; // No overlap

            // Push out
            pos[pushAxis] += pushDir * (smallestPen + this.TOLERANCE);
        }
    }

    /**
     * Sweep an AABB through the world and find first collision
     */
    sweepAABB(position, size, delta) {
        // Get all potential collision blocks
        const minX = Math.floor(Math.min(position[0], position[0] + delta[0]) - size[0] / 2) - 1;
        const maxX = Math.floor(Math.max(position[0], position[0] + delta[0]) + size[0] / 2) + 1;
        const minY = Math.floor(Math.min(position[1], position[1] + delta[1])) - 1;
        const maxY = Math.floor(Math.max(position[1], position[1] + delta[1]) + size[1]) + 1;
        const minZ = Math.floor(Math.min(position[2], position[2] + delta[2]) - size[2] / 2) - 1;
        const maxZ = Math.floor(Math.max(position[2], position[2] + delta[2]) + size[2] / 2) + 1;

        let nearestCollision = null;
        let nearestTime = 1.0;

        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    const block = this.worldSystem.getBlock(bx, by, bz);
                    if (!block) continue;

                    // Block AABB (block occupies [bx, bx+1] x [by, by+1] x [bz, bz+1])
                    const blockMin = [bx, by, bz];
                    const blockMax = [bx + 1, by + 1, bz + 1];

                    const collision = this.sweepAABBvsAABB(
                        position, size, delta,
                        blockMin, blockMax
                    );

                    if (collision && collision.time < nearestTime) {
                        nearestTime = collision.time;
                        nearestCollision = collision;
                    }
                }
            }
        }

        return nearestCollision;
    }

    /**
     * Swept AABB vs AABB collision test
     */
    sweepAABBvsAABB(pos, size, delta, blockMin, blockMax) {
        // Player AABB bounds (centered horizontally, feet at position)
        const playerMin = [
            pos[0] - size[0] / 2,
            pos[1],
            pos[2] - size[2] / 2
        ];
        const playerMax = [
            pos[0] + size[0] / 2,
            pos[1] + size[1],
            pos[2] + size[2] / 2
        ];

        // Expand block by player size (Minkowski sum)
        const expandedMin = [
            blockMin[0] - size[0] / 2,
            blockMin[1] - size[1],
            blockMin[2] - size[2] / 2
        ];
        const expandedMax = [
            blockMax[0] + size[0] / 2,
            blockMax[1],
            blockMax[2] + size[2] / 2
        ];

        // Ray vs AABB test (ray from player center)
        const origin = [pos[0], pos[1] + size[1] / 2, pos[2]];

        let tMin = 0;
        let tMax = 1;
        let normal = [0, 0, 0];
        let hitAxis = -1;

        for (let axis = 0; axis < 3; axis++) {
            const min = expandedMin[axis] - (axis === 1 ? size[1] / 2 : 0);
            const max = expandedMax[axis] + (axis === 1 ? size[1] / 2 : 0);

            if (Math.abs(delta[axis]) < 0.0001) {
                // Ray parallel to slab
                if (origin[axis] < min || origin[axis] > max) {
                    return null;
                }
            } else {
                const invD = 1.0 / delta[axis];
                let t1 = (min - origin[axis]) * invD;
                let t2 = (max - origin[axis]) * invD;

                let sign = 1;
                if (t1 > t2) {
                    [t1, t2] = [t2, t1];
                    sign = -1;
                }

                if (t1 > tMin) {
                    tMin = t1;
                    hitAxis = axis;
                    normal = [0, 0, 0];
                    normal[axis] = -sign * Math.sign(delta[axis]);
                }

                tMax = Math.min(tMax, t2);

                if (tMin > tMax) {
                    return null;
                }
            }
        }

        if (tMin < 0 || tMin > 1) {
            return null;
        }

        // Check if we're already overlapping
        if (tMin === 0) {
            // Push out in the direction of smallest penetration
            const overlaps = [];
            for (let axis = 0; axis < 3; axis++) {
                const playerMinAxis = playerMin[axis];
                const playerMaxAxis = playerMax[axis];
                const blockMinAxis = blockMin[axis];
                const blockMaxAxis = blockMax[axis];

                if (playerMaxAxis > blockMinAxis && playerMinAxis < blockMaxAxis) {
                    const overlapLeft = playerMaxAxis - blockMinAxis;
                    const overlapRight = blockMaxAxis - playerMinAxis;
                    overlaps.push({
                        axis,
                        amount: Math.min(overlapLeft, overlapRight),
                        direction: overlapLeft < overlapRight ? -1 : 1
                    });
                }
            }

            if (overlaps.length === 3) {
                overlaps.sort((a, b) => a.amount - b.amount);
                const smallest = overlaps[0];
                normal = [0, 0, 0];
                normal[smallest.axis] = smallest.direction;
            }
        }

        return { time: tMin, normal };
    }

    /**
     * Slide a vector along a surface defined by a normal (modifies vec in-place)
     */
    slideVectorInPlace(vec, normal) {
        const dot = vec[0] * normal[0] + vec[1] * normal[1] + vec[2] * normal[2];
        vec[0] -= normal[0] * dot;
        vec[1] -= normal[1] * dot;
        vec[2] -= normal[2] * dot;
    }

    /**
     * Check if an AABB overlaps any blocks
     */
    checkAABBCollision(position, size) {
        const minX = Math.floor(position[0] - size[0] / 2);
        const maxX = Math.floor(position[0] + size[0] / 2);
        const minY = Math.floor(position[1]);
        const maxY = Math.floor(position[1] + size[1]);
        const minZ = Math.floor(position[2] - size[2] / 2);
        const maxZ = Math.floor(position[2] + size[2] / 2);

        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    if (this.worldSystem.getBlock(bx, by, bz)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Get all blocks within an AABB
     */
    getBlocksInAABB(minPos, maxPos) {
        const blocks = [];
        const minX = Math.floor(minPos[0]);
        const maxX = Math.floor(maxPos[0]);
        const minY = Math.floor(minPos[1]);
        const maxY = Math.floor(maxPos[1]);
        const minZ = Math.floor(minPos[2]);
        const maxZ = Math.floor(maxPos[2]);

        for (let bx = minX; bx <= maxX; bx++) {
            for (let by = minY; by <= maxY; by++) {
                for (let bz = minZ; bz <= maxZ; bz++) {
                    const block = this.worldSystem.getBlock(bx, by, bz);
                    if (block) {
                        blocks.push({ x: bx, y: by, z: bz, block });
                    }
                }
            }
        }

        return blocks;
    }
}

GUTS.CollisionSystem = CollisionSystem;
