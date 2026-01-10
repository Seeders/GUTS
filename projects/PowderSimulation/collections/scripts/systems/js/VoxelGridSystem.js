/**
 * VoxelGridSystem - Manages the 3D voxel grid for settled particles
 *
 * Handles grid storage, queries, and boundary detection.
 * Material IDs: 0=air, 1=sand, 2=water, 3=stone, 4=fire, 5=wood, 6=steam
 */
class VoxelGridSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.voxelGridSystem = this;

        // Grid dimensions
        this.sizeX = 100;
        this.sizeY = 100;
        this.sizeZ = 100;
        this.cellSize = 1.0;

        // Grid data - flat Uint8Array for performance
        this.grid = null;
        this.settledCount = 0;

        // Boundary settings
        this.enableWalls = true;

        // Material constants
        this.MATERIAL = {
            AIR: 0,
            SAND: 1,
            WATER: 2,
            STONE: 3,
            FIRE: 4,
            WOOD: 5,
            STEAM: 6,
            WET_WOOD: 7,
            LIVING_WOOD: 8
        };

        // Material colors (RGB as hex)
        this.MATERIAL_COLORS = {
            0: 0x000000,  // Air (invisible)
            1: 0xe8d174,  // Sand - yellow
            2: 0x4a90d9,  // Water - blue
            3: 0x808080,  // Stone - gray
            4: 0xff6600,  // Fire - orange
            5: 0x8b4513,  // Wood - brown
            6: 0xdddddd,  // Steam - white/gray
            7: 0x5c3317,  // Wet Wood - darker brown
            8: 0x228b22   // Living Wood - forest green
        };

        // Track dirty regions for render updates
        this.isDirty = false;

        // Track water voxel positions for efficient simulation (uses index for performance)
        this.waterVoxels = new Set();

        // Track ALL non-air voxels for efficient rendering (index -> material)
        this.nonAirVoxels = new Map();

        // Process water in batches for performance
        this.waterProcessBatchSize = 200;  // Process water per tick
        this.waterTickCounter = 0;
        this.waterTickInterval = 8; // Process water every 8 ticks for smoother flow

        // Paused state and speed multiplier
        this.paused = false;
        this.speedMultiplier = 1.0;
    }

    init() {
        console.log('VoxelGridSystem initializing...');
        this.allocateGrid();
        console.log(`VoxelGridSystem initialized: ${this.sizeX}x${this.sizeY}x${this.sizeZ} grid`);
    }

    allocateGrid() {
        const totalCells = this.sizeX * this.sizeY * this.sizeZ;
        this.grid = new Uint8Array(totalCells);
        this.settledCount = 0;
        this.isDirty = true;
        this.waterVoxels.clear();
        this.nonAirVoxels.clear();

        // Add a stone floor at y=0
        this.addFloor();
    }

    addFloor() {
        for (let x = 0; x < this.sizeX; x++) {
            for (let z = 0; z < this.sizeZ; z++) {
                this.set(x, 0, z, this.MATERIAL.STONE);
            }
        }
    }

    /**
     * Resize the grid (clears all data)
     */
    resize(newSizeX, newSizeY, newSizeZ) {
        this.sizeX = newSizeX;
        this.sizeY = newSizeY;
        this.sizeZ = newSizeZ;
        this.allocateGrid();
    }

    /**
     * Convert 3D coordinates to flat array index
     */
    toIndex(x, y, z) {
        return x + y * this.sizeX + z * this.sizeX * this.sizeY;
    }

    /**
     * Check if coordinates are within bounds
     */
    inBounds(x, y, z) {
        return x >= 0 && x < this.sizeX &&
               y >= 0 && y < this.sizeY &&
               z >= 0 && z < this.sizeZ;
    }

    /**
     * Get material at position (returns AIR if out of bounds)
     */
    get(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return this.enableWalls ? this.MATERIAL.STONE : this.MATERIAL.AIR;
        }
        return this.grid[this.toIndex(x, y, z)];
    }

    /**
     * Set material at position
     * @param {boolean} wakeNeighbors - If true, wake neighbors when removing a solid voxel
     */
    set(x, y, z, material, wakeNeighbors = true) {
        if (!this.inBounds(x, y, z)) return false;

        const idx = this.toIndex(x, y, z);
        const oldMaterial = this.grid[idx];

        if (oldMaterial !== material) {
            // Check if we're removing a solid that might support other voxels
            const wasSupporting = wakeNeighbors &&
                oldMaterial !== this.MATERIAL.AIR &&
                material === this.MATERIAL.AIR;

            // Update settled count
            if (oldMaterial === this.MATERIAL.AIR && material !== this.MATERIAL.AIR) {
                this.settledCount++;
            } else if (oldMaterial !== this.MATERIAL.AIR && material === this.MATERIAL.AIR) {
                this.settledCount--;
            }

            const key = `${x},${y},${z}`;

            // Track water voxels for efficient simulation
            if (material === this.MATERIAL.WATER) {
                this.waterVoxels.add(key);
            } else if (oldMaterial === this.MATERIAL.WATER) {
                this.waterVoxels.delete(key);
            }

            // Track all non-air voxels for efficient rendering
            if (material !== this.MATERIAL.AIR) {
                this.nonAirVoxels.set(key, material);
            } else {
                this.nonAirVoxels.delete(key);
            }

            this.grid[idx] = material;
            this.isDirty = true;

            // Wake up neighbors that may have lost support
            if (wasSupporting) {
                this.wakeNeighbors(x, y, z);
            }
        }
        return true;
    }

    /**
     * Wake up neighboring voxels that may have lost support
     * Converts them back to active particles
     */
    wakeNeighbors(x, y, z) {
        const physicsSystem = this.game.particlePhysicsSystem;
        if (!physicsSystem) return;

        // Check the voxel directly above (most likely to need waking)
        // and adjacent horizontal neighbors
        const neighbors = [
            { dx: 0, dy: 1, dz: 0 },   // Above
            { dx: -1, dy: 0, dz: 0 },  // Left
            { dx: 1, dy: 0, dz: 0 },   // Right
            { dx: 0, dy: 0, dz: -1 },  // Front
            { dx: 0, dy: 0, dz: 1 },   // Back
            { dx: -1, dy: 1, dz: 0 },  // Above-left
            { dx: 1, dy: 1, dz: 0 },   // Above-right
            { dx: 0, dy: 1, dz: -1 },  // Above-front
            { dx: 0, dy: 1, dz: 1 },   // Above-back
        ];

        for (const n of neighbors) {
            const nx = x + n.dx;
            const ny = y + n.dy;
            const nz = z + n.dz;

            const mat = this.get(nx, ny, nz);

            // Only wake materials that can fall (not stone, not air)
            if (mat !== this.MATERIAL.AIR &&
                mat !== this.MATERIAL.STONE &&
                mat !== this.MATERIAL.FIRE) {

                // Convert to active particle
                const worldPos = this.gridToWorld(nx, ny, nz);
                physicsSystem.spawnParticle(
                    worldPos.x, worldPos.y, worldPos.z,
                    mat,
                    (Math.random() - 0.5) * 2,  // Small random velocity
                    -1,                          // Slight downward
                    (Math.random() - 0.5) * 2
                );

                // Remove the voxel (don't wake its neighbors recursively to avoid cascade)
                this.set(nx, ny, nz, this.MATERIAL.AIR, false);
            }
        }
    }

    /**
     * Check if cell is empty (air)
     */
    isEmpty(x, y, z) {
        return this.get(x, y, z) === this.MATERIAL.AIR;
    }

    /**
     * Check if cell is solid (blocks movement)
     */
    isSolid(x, y, z) {
        const mat = this.get(x, y, z);
        return mat === this.MATERIAL.STONE ||
               mat === this.MATERIAL.SAND ||
               mat === this.MATERIAL.WOOD ||
               mat === this.MATERIAL.WET_WOOD ||
               mat === this.MATERIAL.LIVING_WOOD;
    }

    /**
     * Clear entire grid
     */
    clear() {
        this.grid.fill(0);
        this.settledCount = 0;
        this.isDirty = true;
        this.waterVoxels.clear();
        this.nonAirVoxels.clear();
        this.addFloor();
    }

    /**
     * World position to grid coordinates
     */
    worldToGrid(wx, wy, wz) {
        // Grid is centered at origin
        const halfX = (this.sizeX * this.cellSize) / 2;
        const halfZ = (this.sizeZ * this.cellSize) / 2;

        return {
            x: Math.floor((wx + halfX) / this.cellSize),
            y: Math.floor(wy / this.cellSize),
            z: Math.floor((wz + halfZ) / this.cellSize)
        };
    }

    /**
     * Grid coordinates to world position (center of cell)
     */
    gridToWorld(gx, gy, gz) {
        const halfX = (this.sizeX * this.cellSize) / 2;
        const halfZ = (this.sizeZ * this.cellSize) / 2;

        return {
            x: (gx + 0.5) * this.cellSize - halfX,
            y: (gy + 0.5) * this.cellSize,
            z: (gz + 0.5) * this.cellSize - halfZ
        };
    }

    /**
     * Get all non-empty voxels for rendering
     * Returns array of {x, y, z, material}
     */
    getSettledVoxels() {
        const voxels = [];
        for (let z = 0; z < this.sizeZ; z++) {
            for (let y = 0; y < this.sizeY; y++) {
                for (let x = 0; x < this.sizeX; x++) {
                    const mat = this.grid[this.toIndex(x, y, z)];
                    if (mat !== this.MATERIAL.AIR) {
                        voxels.push({ x, y, z, material: mat });
                    }
                }
            }
        }
        return voxels;
    }

    /**
     * Get grid bounds in world coordinates
     */
    getWorldBounds() {
        const halfX = (this.sizeX * this.cellSize) / 2;
        const halfZ = (this.sizeZ * this.cellSize) / 2;

        return {
            minX: -halfX,
            maxX: halfX,
            minY: 0,
            maxY: this.sizeY * this.cellSize,
            minZ: -halfZ,
            maxZ: halfZ
        };
    }

    update() {
        if (this.paused) return;

        // Adjust tick interval based on speed multiplier (faster = more frequent water sim)
        const adjustedInterval = Math.max(1, Math.round(this.waterTickInterval / this.speedMultiplier));

        // Only simulate water every few ticks for performance
        this.waterTickCounter++;
        if (this.waterTickCounter >= adjustedInterval) {
            this.waterTickCounter = 0;
            // Process more water at higher speeds
            const batchMultiplier = Math.max(1, Math.ceil(this.speedMultiplier));
            for (let i = 0; i < batchMultiplier; i++) {
                this.simulateWaterFlow();
            }
        }
    }

    /**
     * Simulate settled water - water falls and spreads to fill gaps
     * Simple rules: fall if possible, spread horizontally to fill the level
     */
    simulateWaterFlow() {
        const WATER = this.MATERIAL.WATER;
        const AIR = this.MATERIAL.AIR;

        if (this.waterVoxels.size === 0) return;

        const waterArray = Array.from(this.waterVoxels);
        const batchSize = Math.min(this.waterProcessBatchSize, waterArray.length);
        const toMove = [];

        // Shuffle for fair processing
        for (let i = waterArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [waterArray[i], waterArray[j]] = [waterArray[j], waterArray[i]];
        }

        for (let i = 0; i < batchSize; i++) {
            const key = waterArray[i];
            const [x, y, z] = key.split(',').map(Number);

            // Skip if no longer water
            if (this.get(x, y, z) !== WATER) continue;

            // Skip boundary cells
            if (x <= 0 || x >= this.sizeX - 1 || y <= 1 || z <= 0 || z >= this.sizeZ - 1) continue;

            // Rule 1: Fall straight down if possible
            if (this.get(x, y - 1, z) === AIR) {
                toMove.push({ fromX: x, fromY: y, fromZ: z, toX: x, toY: y - 1, toZ: z });
                continue;
            }

            // Rule 2: Fall diagonally if there's air below-adjacent
            const fallDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            // Shuffle
            for (let j = fallDirs.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1));
                [fallDirs[j], fallDirs[k]] = [fallDirs[k], fallDirs[j]];
            }

            let fell = false;
            for (const [dx, dz] of fallDirs) {
                const nx = x + dx;
                const nz = z + dz;
                const adjMat = this.get(nx, y, nz);
                // Can fall diagonally if adjacent is passable and below-adjacent is air
                if ((adjMat === AIR || adjMat === WATER) && this.get(nx, y - 1, nz) === AIR) {
                    toMove.push({ fromX: x, fromY: y, fromZ: z, toX: nx, toY: y - 1, toZ: nz });
                    fell = true;
                    break;
                }
            }
            if (fell) continue;

            // Rule 3: Spread horizontally to adjacent empty cells with support
            // Check if there's an empty spot nearby at same level
            let spreadHorizontally = false;
            for (const [dx, dz] of fallDirs) {
                const nx = x + dx;
                const nz = z + dz;
                if (this.get(nx, y, nz) === AIR) {
                    const belowAdj = this.get(nx, y - 1, nz);
                    // Only spread if there's solid support (not air)
                    if (belowAdj !== AIR) {
                        toMove.push({ fromX: x, fromY: y, fromZ: z, toX: nx, toY: y, toZ: nz });
                        spreadHorizontally = true;
                        break;
                    }
                }
            }
            if (spreadHorizontally) continue;

            // Rule 4: If water is stacked (has water above), move toward empty space (one cell at a time)
            const hasWaterAbove = this.get(x, y + 1, z) === WATER;
            if (hasWaterAbove) {
                // Search for direction with empty space, but only move 1 cell
                let foundDirection = false;
                for (const [dx, dz] of fallDirs) {
                    // Check if adjacent cell is water (can move through it)
                    const adjMat = this.get(x + dx, y, z + dz);
                    if (adjMat !== WATER) continue; // Can only move through water

                    // Look ahead to see if there's eventually empty space in this direction
                    for (let dist = 2; dist <= 5; dist++) {
                        const nx = x + dx * dist;
                        const nz = z + dz * dist;
                        const mat = this.get(nx, y, nz);

                        // Check if path is blocked by non-water solid
                        if (mat !== AIR && mat !== WATER) {
                            break; // Hit solid wall
                        }

                        if (mat === AIR) {
                            const belowMat = this.get(nx, y - 1, nz);
                            if (belowMat !== AIR) {
                                // Found empty spot - move ONE cell toward it
                                toMove.push({ fromX: x, fromY: y, fromZ: z, toX: x + dx, toY: y, toZ: z + dz });
                                foundDirection = true;
                                break;
                            }
                        }
                    }
                    if (foundDirection) break;
                }

                // Rule 5: If level seems full, try to move water UP to next level
                // This allows water to stack and fill a tank from bottom up
                if (!foundDirection) {
                    // Check if there's air directly above and this water has support
                    const aboveMat = this.get(x, y + 1, z);
                    if (aboveMat === AIR) {
                        // Move up - this creates space for water below to spread
                        toMove.push({ fromX: x, fromY: y, fromZ: z, toX: x, toY: y + 1, toZ: z });
                    }
                }
            }
        }

        // Apply moves
        for (const move of toMove) {
            if (this.get(move.fromX, move.fromY, move.fromZ) === WATER &&
                this.get(move.toX, move.toY, move.toZ) === AIR) {
                this.set(move.fromX, move.fromY, move.fromZ, AIR, false);
                this.set(move.toX, move.toY, move.toZ, WATER, false);
            }
        }
    }

    /**
     * Get the height of the water column at this position (how many water cells stacked)
     */
    getWaterColumnHeight(x, y, z) {
        const WATER = this.MATERIAL.WATER;
        let height = 1;

        // Count water above
        let checkY = y + 1;
        while (checkY < this.sizeY && this.get(x, checkY, z) === WATER) {
            height++;
            checkY++;
        }

        return height;
    }

    /**
     * Find an empty spot for water to flow to by searching outward
     * Prefers solid support, but will return positions on water if that's the only option
     */
    findEmptyWaterSpot(startX, startY, startZ, dx, dz, maxDist) {
        const WATER = this.MATERIAL.WATER;
        const AIR = this.MATERIAL.AIR;

        let x = startX + dx;
        let z = startZ + dz;
        let y = startY;

        // Track best position on water as fallback
        let bestOnWater = null;

        for (let dist = 1; dist <= maxDist; dist++) {
            // Check bounds
            if (x <= 0 || x >= this.sizeX - 1 || z <= 0 || z >= this.sizeZ - 1) {
                break;
            }

            const mat = this.get(x, y, z);

            if (mat === AIR) {
                // Found empty space - find the lowest point
                let targetY = y;
                while (targetY > 1 && this.get(x, targetY - 1, z) === AIR) {
                    targetY--;
                }
                const belowMat = this.get(x, targetY - 1, z);

                // Prefer solid support
                if (belowMat !== AIR && belowMat !== WATER) {
                    return { x, y: targetY, z };
                }
                // Track position on water as fallback
                if (belowMat === WATER && !bestOnWater) {
                    bestOnWater = { x, y: targetY, z };
                }
            } else if (mat !== WATER) {
                // Hit a solid - can't continue this direction
                break;
            }

            // Continue through water
            x += dx;
            z += dz;
        }

        // Return position on water if no solid support found
        return bestOnWater;
    }
}
