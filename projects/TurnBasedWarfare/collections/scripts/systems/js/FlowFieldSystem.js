/**
 * FlowFieldSystem - Optimized pathfinding for large groups of units
 *
 * When many units need to reach the same destination, computing individual A* paths
 * for each unit is expensive. Flow fields solve this by computing a single field
 * that stores the optimal direction to move from every cell toward the goal.
 *
 * Algorithm:
 * 1. Integration Field: Dijkstra from goal outward, storing cost-to-goal per cell
 * 2. Flow Field: For each cell, compute direction toward lowest-cost neighbor
 *
 * Usage:
 * - Units query getFlowDirection(worldX, worldZ, flowFieldId) to get movement direction
 * - Flow fields are cached and shared across all units with same destination
 * - Automatically batches path requests to detect group movements
 */
class FlowFieldSystem extends GUTS.BaseSystem {
    static services = [
        'getFlowDirection',
        'getOrCreateFlowField',
        'hasFlowField',
        'clearFlowFields',
        'getFlowFieldForDestination',
        'removeFlowField'
    ];

    constructor(game) {
        super(game);
        this.game.flowFieldSystem = this;

        // Flow field cache: destinationKey -> FlowField
        this.flowFields = new Map();

        // Entity to flow field mapping: entityId -> destinationKey
        this.entityFlowFields = new Map();

        // Configuration
        this.MAX_FLOW_FIELDS = 50;           // Maximum cached flow fields
        this.FLOW_FIELD_EXPIRY = 10000;      // 10 seconds before expiry
        this.DESTINATION_QUANTIZATION = 64;   // Group destinations within this radius
        this.MIN_GROUP_SIZE = 5;              // Minimum units for flow field (otherwise use A*)

        // Pre-allocated data structures for Dijkstra
        this._costQueue = [];
        this._visited = new Set();

        // Reference to pathfinding system (set during init)
        this.pathfindingSystem = null;

        this.initialized = false;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        // Get reference to pathfinding system for navmesh access
        this.pathfindingSystem = this.game.pathfindingSystem;

        if (!this.pathfindingSystem) {
            console.warn('FlowFieldSystem: PathfindingSystem not available');
            return;
        }

        this.initialized = true;
    }

    /**
     * Encode destination into a cache key based on quantized position
     */
    getDestinationKey(worldX, worldZ) {
        const qx = Math.floor(worldX / this.DESTINATION_QUANTIZATION);
        const qz = Math.floor(worldZ / this.DESTINATION_QUANTIZATION);
        return (qz << 16) | (qx & 0xFFFF);
    }

    /**
     * Check if a flow field exists for a destination
     */
    hasFlowField(worldX, worldZ) {
        const key = this.getDestinationKey(worldX, worldZ);
        return this.flowFields.has(key);
    }

    /**
     * Get existing flow field for destination, or null if none exists
     */
    getFlowFieldForDestination(worldX, worldZ) {
        const key = this.getDestinationKey(worldX, worldZ);
        const field = this.flowFields.get(key);

        if (field && (this.game.state.now - field.timestamp) < this.FLOW_FIELD_EXPIRY) {
            return field;
        }

        return null;
    }

    /**
     * Get or create a flow field for the given destination
     * Returns the flow field object
     */
    getOrCreateFlowField(worldX, worldZ) {
        if (!this.initialized || !this.pathfindingSystem?.navMesh) {
            return null;
        }

        const key = this.getDestinationKey(worldX, worldZ);

        // Check cache
        const cached = this.flowFields.get(key);
        if (cached && (this.game.state.now - cached.timestamp) < this.FLOW_FIELD_EXPIRY) {
            cached.lastAccessed = this.game.state.now;
            return cached;
        }

        // Generate new flow field
        const flowField = this.generateFlowField(worldX, worldZ);
        if (!flowField) {
            return null;
        }

        // Cache management: evict oldest if at capacity
        if (this.flowFields.size >= this.MAX_FLOW_FIELDS) {
            this.evictOldestFlowField();
        }

        flowField.key = key;
        flowField.timestamp = this.game.state.now;
        flowField.lastAccessed = this.game.state.now;
        flowField.goalX = worldX;
        flowField.goalZ = worldZ;

        this.flowFields.set(key, flowField);
        return flowField;
    }

    /**
     * Generate a flow field using Dijkstra's algorithm from the goal
     */
    generateFlowField(goalX, goalZ) {
        const ps = this.pathfindingSystem;
        const width = ps.navGridWidth;
        const height = ps.navGridHeight;

        if (width === 0 || height === 0) {
            return null;
        }

        const goalGrid = ps.worldToNavGrid(goalX, goalZ);

        // Validate goal is walkable
        const goalTerrain = ps.getTerrainAtNavGrid(goalGrid.x, goalGrid.z);
        if (goalTerrain === null || goalTerrain === 255 || !ps.isTerrainWalkable(goalTerrain)) {
            // Try to find nearest walkable cell to goal
            const nearestWalkable = this.findNearestWalkableCell(goalGrid.x, goalGrid.z);
            if (!nearestWalkable) {
                return null;
            }
            goalGrid.x = nearestWalkable.x;
            goalGrid.z = nearestWalkable.z;
        }

        // Create flow field data structure
        const flowField = {
            width: width,
            height: height,
            // Store directions as dx,dz pairs packed: ((dz+1) << 2) | (dx+1)
            // Values 0-8 for 9 possible directions (including no movement)
            // 255 = impassable
            directions: new Uint8Array(width * height),
            // Integration field: cost to reach goal from each cell
            costs: new Uint16Array(width * height)
        };

        // Initialize costs to max (unreachable)
        flowField.costs.fill(65535);
        flowField.directions.fill(255);

        // Phase 1: Build integration field using Dijkstra from goal
        this.buildIntegrationField(flowField, goalGrid.x, goalGrid.z, ps);

        // Phase 2: Build flow field from integration field
        this.buildFlowDirections(flowField, ps);

        return flowField;
    }

    /**
     * Build integration field (cost-to-goal) using Dijkstra's algorithm
     */
    buildIntegrationField(flowField, goalX, goalZ, ps) {
        const { width, height, costs } = flowField;

        // Clear and reuse pre-allocated structures
        const queue = this._costQueue;
        const visited = this._visited;
        queue.length = 0;
        visited.clear();

        // Directions: cardinal and diagonal
        const directions = [
            { dx: 1, dz: 0, cost: 10 },
            { dx: -1, dz: 0, cost: 10 },
            { dx: 0, dz: 1, cost: 10 },
            { dx: 0, dz: -1, cost: 10 },
            { dx: 1, dz: 1, cost: 14 },
            { dx: -1, dz: 1, cost: 14 },
            { dx: 1, dz: -1, cost: 14 },
            { dx: -1, dz: -1, cost: 14 }
        ];

        // Start from goal with cost 0
        const goalIdx = goalZ * width + goalX;
        costs[goalIdx] = 0;
        queue.push({ x: goalX, z: goalZ, cost: 0 });

        while (queue.length > 0) {
            // Simple priority queue: sort by cost (could optimize with proper heap for large maps)
            // For flow fields this is acceptable as we process each cell at most once
            queue.sort((a, b) => a.cost - b.cost);
            const current = queue.shift();

            const currentKey = (current.z << 16) | current.x;
            if (visited.has(currentKey)) continue;
            visited.add(currentKey);

            const currentTerrain = ps.getTerrainAtNavGrid(current.x, current.z);

            for (const dir of directions) {
                const nx = current.x + dir.dx;
                const nz = current.z + dir.dz;

                // Bounds check
                if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;

                const neighborKey = (nz << 16) | nx;
                if (visited.has(neighborKey)) continue;

                // Walkability check
                const neighborTerrain = ps.getTerrainAtNavGrid(nx, nz);
                if (neighborTerrain === null || neighborTerrain === 255) continue;
                if (!ps.isTerrainWalkable(neighborTerrain)) continue;

                // Check terrain transition with ramps
                if (!ps.canWalkBetweenTerrainsWithRamps(
                    neighborTerrain, currentTerrain,
                    nx, nz, current.x, current.z
                )) {
                    continue;
                }

                // For diagonal moves, check corner cutting
                const isDiagonal = dir.dx !== 0 && dir.dz !== 0;
                if (isDiagonal) {
                    const terrainX = ps.getTerrainAtNavGrid(current.x + dir.dx, current.z);
                    const terrainZ = ps.getTerrainAtNavGrid(current.x, current.z + dir.dz);

                    if (terrainX === null || terrainX === 255 ||
                        terrainZ === null || terrainZ === 255) {
                        continue;
                    }

                    if (!ps.isTerrainWalkable(terrainX) || !ps.isTerrainWalkable(terrainZ)) {
                        continue;
                    }
                }

                const newCost = current.cost + dir.cost;
                const nIdx = nz * width + nx;

                if (newCost < costs[nIdx]) {
                    costs[nIdx] = newCost;
                    queue.push({ x: nx, z: nz, cost: newCost });
                }
            }
        }
    }

    /**
     * Build flow directions from integration field
     * Each cell points toward its lowest-cost neighbor
     */
    buildFlowDirections(flowField, ps) {
        const { width, height, costs, directions } = flowField;

        // Direction encoding: ((dz+1) << 2) | (dx+1)
        // dx,dz are in range [-1, 1], so dx+1, dz+1 are in [0, 2]
        const encodeDirection = (dx, dz) => ((dz + 1) << 2) | (dx + 1);

        const neighborOffsets = [
            { dx: 1, dz: 0 },
            { dx: -1, dz: 0 },
            { dx: 0, dz: 1 },
            { dx: 0, dz: -1 },
            { dx: 1, dz: 1 },
            { dx: -1, dz: 1 },
            { dx: 1, dz: -1 },
            { dx: -1, dz: -1 }
        ];

        for (let z = 0; z < height; z++) {
            for (let x = 0; x < width; x++) {
                const idx = z * width + x;
                const currentCost = costs[idx];

                // Skip unreachable cells
                if (currentCost === 65535) {
                    directions[idx] = 255;
                    continue;
                }

                // At goal - no movement needed
                if (currentCost === 0) {
                    directions[idx] = encodeDirection(0, 0);
                    continue;
                }

                // Find neighbor with lowest cost
                let bestDx = 0;
                let bestDz = 0;
                let bestCost = currentCost;

                for (const offset of neighborOffsets) {
                    const nx = x + offset.dx;
                    const nz = z + offset.dz;

                    if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;

                    const nCost = costs[nz * width + nx];
                    if (nCost < bestCost) {
                        bestCost = nCost;
                        bestDx = offset.dx;
                        bestDz = offset.dz;
                    }
                }

                directions[idx] = encodeDirection(bestDx, bestDz);
            }
        }
    }

    /**
     * Find nearest walkable cell to given position (for invalid goals)
     */
    findNearestWalkableCell(gridX, gridZ) {
        const ps = this.pathfindingSystem;
        const maxRadius = 10;

        for (let r = 1; r <= maxRadius; r++) {
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // Only check perimeter

                    const nx = gridX + dx;
                    const nz = gridZ + dz;

                    if (nx < 0 || nx >= ps.navGridWidth || nz < 0 || nz >= ps.navGridHeight) continue;

                    const terrain = ps.getTerrainAtNavGrid(nx, nz);
                    if (terrain !== null && terrain !== 255 && ps.isTerrainWalkable(terrain)) {
                        return { x: nx, z: nz };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Get flow direction at a world position
     * Returns { x, z } normalized direction vector, or null if impassable/invalid
     */
    getFlowDirection(worldX, worldZ, flowFieldOrKey) {
        if (!this.initialized) return null;

        let flowField;
        if (typeof flowFieldOrKey === 'number') {
            flowField = this.flowFields.get(flowFieldOrKey);
        } else {
            flowField = flowFieldOrKey;
        }

        if (!flowField) return null;

        const ps = this.pathfindingSystem;
        const grid = ps.worldToNavGrid(worldX, worldZ);

        if (grid.x < 0 || grid.x >= flowField.width ||
            grid.z < 0 || grid.z >= flowField.height) {
            return null;
        }

        const idx = grid.z * flowField.width + grid.x;
        const encoded = flowField.directions[idx];

        if (encoded === 255) return null;

        // Decode direction
        const dx = (encoded & 0x3) - 1;
        const dz = ((encoded >> 2) & 0x3) - 1;

        // Normalize for diagonal movement
        if (dx !== 0 && dz !== 0) {
            const invSqrt2 = 0.7071067811865476;
            return { x: dx * invSqrt2, z: dz * invSqrt2 };
        }

        return { x: dx, z: dz };
    }

    /**
     * Check if position is at or very close to the flow field goal
     */
    isAtGoal(worldX, worldZ, flowField) {
        if (!flowField) return false;

        const ps = this.pathfindingSystem;
        const grid = ps.worldToNavGrid(worldX, worldZ);
        const goalGrid = ps.worldToNavGrid(flowField.goalX, flowField.goalZ);

        // Within 1 cell of goal
        return Math.abs(grid.x - goalGrid.x) <= 1 && Math.abs(grid.z - goalGrid.z) <= 1;
    }

    /**
     * Get cost to goal from a position (useful for priority/distance checks)
     */
    getCostToGoal(worldX, worldZ, flowField) {
        if (!flowField || !this.initialized) return Infinity;

        const ps = this.pathfindingSystem;
        const grid = ps.worldToNavGrid(worldX, worldZ);

        if (grid.x < 0 || grid.x >= flowField.width ||
            grid.z < 0 || grid.z >= flowField.height) {
            return Infinity;
        }

        const cost = flowField.costs[grid.z * flowField.width + grid.x];
        return cost === 65535 ? Infinity : cost;
    }

    /**
     * Assign an entity to use a specific flow field
     */
    assignEntityToFlowField(entityId, flowFieldKey) {
        this.entityFlowFields.set(entityId, flowFieldKey);
    }

    /**
     * Get flow direction for an entity (using assigned flow field)
     */
    getEntityFlowDirection(entityId, worldX, worldZ) {
        const flowFieldKey = this.entityFlowFields.get(entityId);
        if (flowFieldKey === undefined) return null;

        return this.getFlowDirection(worldX, worldZ, flowFieldKey);
    }

    /**
     * Remove an entity's flow field assignment
     */
    clearEntityFlowField(entityId) {
        this.entityFlowFields.delete(entityId);
    }

    /**
     * Remove a flow field
     */
    removeFlowField(key) {
        this.flowFields.delete(key);
    }

    /**
     * Clear all flow fields
     */
    clearFlowFields() {
        this.flowFields.clear();
        this.entityFlowFields.clear();
    }

    /**
     * Evict oldest flow field when cache is full
     */
    evictOldestFlowField() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, field] of this.flowFields.entries()) {
            if (field.lastAccessed < oldestTime) {
                oldestTime = field.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey !== null) {
            this.flowFields.delete(oldestKey);

            // Also clean up entity assignments pointing to this field
            for (const [entityId, fieldKey] of this.entityFlowFields.entries()) {
                if (fieldKey === oldestKey) {
                    this.entityFlowFields.delete(entityId);
                }
            }
        }
    }

    /**
     * Called when entity is destroyed - clean up flow field assignment
     */
    entityDestroyed(entityId) {
        this.entityFlowFields.delete(entityId);
    }

    /**
     * Periodic cleanup of expired flow fields
     */
    update() {
        if (!this.initialized) return;

        // Only clean up every 60 frames (roughly 1 second)
        if (this.game.state.frameCount % 60 !== 0) return;

        const now = this.game.state.now;
        const keysToDelete = [];

        for (const [key, field] of this.flowFields.entries()) {
            if (now - field.lastAccessed > this.FLOW_FIELD_EXPIRY) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.flowFields.delete(key);

            // Clean up entity assignments
            for (const [entityId, fieldKey] of this.entityFlowFields.entries()) {
                if (fieldKey === key) {
                    this.entityFlowFields.delete(entityId);
                }
            }
        }
    }

    onSceneUnload() {
        this.flowFields.clear();
        this.entityFlowFields.clear();
        this._costQueue.length = 0;
        this._visited.clear();
        this.pathfindingSystem = null;
        this.initialized = false;
    }
}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.FlowFieldSystem = FlowFieldSystem;
}

// ES6 exports for webpack bundling
export default FlowFieldSystem;
export { FlowFieldSystem };
