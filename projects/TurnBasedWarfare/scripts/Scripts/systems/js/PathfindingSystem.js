class PathfindingSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.pathfindingSystem = this;
        
        this.navMesh = null;
        this.navGridSize = 32;
        this.navGridWidth = 0;
        this.navGridHeight = 0;
        
        this.terrainTypes = null;
        this.walkabilityCache = new Map();
        
        this.pathCache = new Map();
        this.MAX_CACHE_SIZE = 1000;
        this.CACHE_EXPIRY_TIME = 5000;

        this.pathRequests = [];
        this.MAX_PATHS_PER_FRAME = 100;

        // Path smoothing configuration
        // Lower values = less aggressive smoothing = less corner cutting
        // Higher values = more aggressive smoothing = smoother but riskier paths
        this.MAX_SMOOTH_LOOKAHEAD = 3; // Maximum waypoints to look ahead when smoothing
        
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        this.game.gameManager.register('isPositionWalkable', this.isPositionWalkable.bind(this));
        this.game.gameManager.register('isGridPositionWalkable', this.isGridPositionWalkable.bind(this));
        this.game.gameManager.register('requestPath', this.requestPath.bind(this));

        const collections = this.game.getCollections();
        if (!collections) {
            console.warn('PathfindingSystem: Collections not available');
            return;
        }
        
        const level = collections.levels?.[this.game.state.level];
        if (!level || !level.tileMap) {
            console.warn('PathfindingSystem: Level or tileMap not available');
            return;
        }
        
        if (!this.game.terrainSystem || !this.game.terrainSystem.initialized) {
            console.warn('PathfindingSystem: Waiting for terrain system...');
            return;
        }
        
        this.terrainTypes = level.tileMap.terrainTypes;
        if (!this.terrainTypes) {
            console.warn('PathfindingSystem: No terrain types found in level');
            return;
        }
        
        this.buildWalkabilityCache();
        this.bakeNavMesh();
        this.initialized = true;
        console.log('PathfindingSystem: Initialized with', this.terrainTypes.length, 'terrain types');
    }

    buildWalkabilityCache() {
        this.walkabilityCache.clear();
        
        for (let i = 0; i < this.terrainTypes.length; i++) {
            const terrainType = this.terrainTypes[i];
            const walkableNeighbors = terrainType.walkableNeighbors || [];
            
            for (let j = 0; j < this.terrainTypes.length; j++) {
                const targetType = this.terrainTypes[j].type;
                const canWalk = walkableNeighbors.includes(targetType);
                
                const key = `${i}-${j}`;
                this.walkabilityCache.set(key, canWalk);
            }
        }
    }

    canWalkBetweenTerrains(fromTerrainIndex, toTerrainIndex) {
        const key = `${fromTerrainIndex}-${toTerrainIndex}`;
        return this.walkabilityCache.get(key) === true;
    }

    bakeNavMesh() {
        const terrainSize = this.game.gameManager.call('getTerrainSize');
        
        this.navGridWidth = Math.ceil(terrainSize / this.navGridSize);
        this.navGridHeight = Math.ceil(terrainSize / this.navGridSize);
        
        this.navMesh = new Uint8Array(this.navGridWidth * this.navGridHeight);
        
        const halfTerrain = terrainSize / 2;
        
        // First pass: populate the navmesh with terrain types
        for (let z = 0; z < this.navGridHeight; z++) {
            for (let x = 0; x < this.navGridWidth; x++) {
                const worldX = (x * this.navGridSize) - halfTerrain + this.navGridSize / 2;
                const worldZ = (z * this.navGridSize) - halfTerrain + this.navGridSize / 2;
                
                const terrainType = this.game.gameManager.call('getTerrainTypeAtPosition', worldX, worldZ);
                
                const idx = z * this.navGridWidth + x;
                this.navMesh[idx] = terrainType !== null ? terrainType : 0;
            }
        }
        
        // Second pass: mark cells adjacent to impassable terrain as impassable
        // Create a copy to read from while we modify
        const originalNavMesh = new Uint8Array(this.navMesh);
        
        // for (let z = 0; z < this.navGridHeight; z++) {
        //     for (let x = 0; x < this.navGridWidth; x++) {
        //         const idx = z * this.navGridWidth + x;
        //         const currentTerrain = originalNavMesh[idx];
                
        //         // Check if this cell is walkable
        //         if (this.isTerrainWalkable(currentTerrain)) {
        //             // Check all 8 neighbors
        //             const neighbors = [
        //                 {dx: 1, dz: 0}, {dx: -1, dz: 0}, 
        //                 {dx: 0, dz: 1}, {dx: 0, dz: -1},
        //                 {dx: 1, dz: 1}, {dx: -1, dz: 1}, 
        //                 {dx: 1, dz: -1}, {dx: -1, dz: -1}
        //             ];
                    
        //             for (const {dx, dz} of neighbors) {
        //                 const nx = x + dx;
        //                 const nz = z + dz;
                        
        //                 if (nx >= 0 && nx < this.navGridWidth && nz >= 0 && nz < this.navGridHeight) {
        //                     const neighborIdx = nz * this.navGridWidth + nx;
        //                     const neighborTerrain = originalNavMesh[neighborIdx];
                            
        //                     // If neighbor is impassable or we can't walk to it
        //                     if (!this.isTerrainWalkable(neighborTerrain) || 
        //                         !this.canWalkBetweenTerrains(currentTerrain, neighborTerrain)) {
        //                         // Mark this cell as impassable (use 255 as a special marker)
        //                         this.navMesh[idx] = 255;
        //                         break;
        //                     }
        //                 }
        //             }
        //         }
        //     }
        // }
        
        console.log(`PathfindingSystem: Baked nav mesh ${this.navGridWidth}x${this.navGridHeight} with buffer zones`);
    }
    
    isTerrainWalkable(terrainIndex) {
        if (terrainIndex === null || terrainIndex === 255) return false;
        
        // A terrain is walkable if it has at least one walkable neighbor defined
        const terrainType = this.terrainTypes[terrainIndex];
        if (!terrainType) return false;
        
        const walkableNeighbors = terrainType.walkableNeighbors || [];
        return walkableNeighbors.length > 0;
    }

    worldToNavGrid(worldX, worldZ) {
        const halfTerrain = this.game.gameManager.call('getTerrainSize') / 2;
        const gridX = Math.floor((worldX + halfTerrain) / this.navGridSize);
        const gridZ = Math.floor((worldZ + halfTerrain) / this.navGridSize);
        return { x: gridX, z: gridZ };
    }

    navGridToWorld(gridX, gridZ) {
        const halfTerrain = this.game.gameManager.call('getTerrainSize') / 2;
        const worldX = (gridX * this.navGridSize) - halfTerrain + this.navGridSize / 2;
        const worldZ = (gridZ * this.navGridSize) - halfTerrain + this.navGridSize / 2;
        return { x: worldX, z: worldZ };
    }

    getTerrainAtNavGrid(gridX, gridZ) {
        if (gridX < 0 || gridX >= this.navGridWidth || gridZ < 0 || gridZ >= this.navGridHeight) {
            return null;
        }
        return this.navMesh[gridZ * this.navGridWidth + gridX];
    }

    requestPath(entityId, startX, startZ, endX, endZ, priority = 0) {
        const cacheKey = `${Math.floor(startX/50)},${Math.floor(startZ/50)}-${Math.floor(endX/50)},${Math.floor(endZ/50)}`;
        
        const cached = this.pathCache.get(cacheKey);
        if (cached && (this.game.state.now - cached.timestamp) < this.CACHE_EXPIRY_TIME) {
            return cached.path;
        }
        
        this.pathRequests.push({
            entityId,
            startX,
            startZ,
            endX,
            endZ,
            priority,
            cacheKey,
            timestamp: this.game.state.now
        });
        
        return null;
    }

    findPath(startX, startZ, endX, endZ, cacheKey = null) {
        const startGrid = this.worldToNavGrid(startX, startZ);
        const endGrid = this.worldToNavGrid(endX, endZ);
        
        if (startGrid.x === endGrid.x && startGrid.z === endGrid.z) {
            return [{ x: endX, z: endZ }];
        }
        
        const openSet = new GUTS.MinHeap();
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        
        const startKey = `${startGrid.x},${startGrid.z}`;
        const endKey = `${endGrid.x},${endGrid.z}`;
        
        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(startGrid, endGrid));
        openSet.push({ key: startKey, x: startGrid.x, z: startGrid.z, f: fScore.get(startKey) });
        
        const directions = [
            {dx: 1, dz: 0}, {dx: -1, dz: 0}, {dx: 0, dz: 1}, {dx: 0, dz: -1},
            {dx: 1, dz: 1}, {dx: -1, dz: 1}, {dx: 1, dz: -1}, {dx: -1, dz: -1}
        ];
        
        let iterations = 0;
        const maxIterations = this.navGridWidth * this.navGridHeight;
        
        // Track the closest point we've found to the destination
        let closestNode = { key: startKey, x: startGrid.x, z: startGrid.z };
        let closestDistance = this.heuristic(startGrid, endGrid);
        
        while (!openSet.isEmpty() && iterations < maxIterations) {
            iterations++;
            
            const current = openSet.pop();
            const currentKey = current.key;
            
            if (currentKey === endKey) {
                const path = this.reconstructPath(cameFrom, currentKey, endX, endZ);
                
                if (cacheKey) {
                    this.addToCache(cacheKey, path);
                }
                
                return path;
            }
            
            closedSet.add(currentKey);
            
            // Check if this is closer to the destination than previous closest
            const distToEnd = this.heuristic({ x: current.x, z: current.z }, endGrid);
            if (distToEnd < closestDistance) {
                closestDistance = distToEnd;
                closestNode = current;
            }
            
            const currentTerrain = this.getTerrainAtNavGrid(current.x, current.z);
            
            for (const dir of directions) {
                const neighborX = current.x + dir.dx;
                const neighborZ = current.z + dir.dz;
                const neighborKey = `${neighborX},${neighborZ}`;
                
                if (closedSet.has(neighborKey)) continue;
                
                const neighborTerrain = this.getTerrainAtNavGrid(neighborX, neighborZ);
                if (neighborTerrain === null || neighborTerrain === 255) continue;
                
                if (!this.canWalkBetweenTerrains(currentTerrain, neighborTerrain)) {
                    continue;
                }
                
                const isDiagonal = dir.dx !== 0 && dir.dz !== 0;
                
                // For diagonal moves, check both adjacent cells to prevent corner cutting
                if (isDiagonal) {
                    const terrainX = this.getTerrainAtNavGrid(current.x + dir.dx, current.z);
                    const terrainZ = this.getTerrainAtNavGrid(current.x, current.z + dir.dz);
                    
                    // Both adjacent cells must exist and be walkable
                    if (terrainX === null || terrainX === 255 || 
                        terrainZ === null || terrainZ === 255) {
                        continue;
                    }
                    
                    if (!this.canWalkBetweenTerrains(currentTerrain, terrainX) || 
                        !this.canWalkBetweenTerrains(currentTerrain, terrainZ)) {
                        continue;
                    }
                }
                
                const moveCost = isDiagonal ? 1.414 : 1;
                const tentativeGScore = gScore.get(currentKey) + moveCost;
                
                if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
                    cameFrom.set(neighborKey, currentKey);
                    gScore.set(neighborKey, tentativeGScore);
                    
                    const h = this.heuristic({x: neighborX, z: neighborZ}, endGrid);
                    const f = tentativeGScore + h;
                    fScore.set(neighborKey, f);
                    
                    openSet.push({ key: neighborKey, x: neighborX, z: neighborZ, f });
                }
            }
        }
        
        // No path found to exact destination - return path to closest reachable point
        if (closestNode.key !== startKey) {
            const closestWorld = this.navGridToWorld(closestNode.x, closestNode.z);
            const path = this.reconstructPath(cameFrom, closestNode.key, closestWorld.x, closestWorld.z);
            
            if (cacheKey) {
                this.addToCache(cacheKey, path);
            }
            
            console.log(`PathfindingSystem: No path to destination, returning path to closest point (distance: ${closestDistance.toFixed(1)})`);
            return path;
        }
        
        return null;
    }

    reconstructPath(cameFrom, currentKey, endX, endZ) {
        const path = [];
        const gridPath = [];
        
        let current = currentKey;
        while (current) {
            const [x, z] = current.split(',').map(Number);
            gridPath.unshift({ x, z });
            current = cameFrom.get(current);
        }
        
        for (const gridPoint of gridPath) {
            const worldPos = this.navGridToWorld(gridPoint.x, gridPoint.z);
            path.push(worldPos);
        }
        
        if (path.length > 0) {
            path[path.length - 1] = { x: endX, z: endZ };
        }
        
        return this.smoothPath(path);
    }

    smoothPath(path) {
        if (path.length <= 2) return path;

        const smoothed = [path[0]];
        let currentIdx = 0;

        while (currentIdx < path.length - 1) {
            let farthestVisible = currentIdx + 1;

            // Limit how far ahead we look to prevent aggressive corner cutting
            const maxLookahead = Math.min(
                path.length - 1,
                currentIdx + this.MAX_SMOOTH_LOOKAHEAD
            );

            // Check from far to near within the limited lookahead range
            // This still prioritizes smoother paths but prevents excessive shortcuts
            for (let i = maxLookahead; i > currentIdx + 1; i--) {
                if (this.hasLineOfSight(path[currentIdx], path[i])) {
                    farthestVisible = i;
                    break;
                }
            }

            smoothed.push(path[farthestVisible]);
            currentIdx = farthestVisible;
        }

        return smoothed;
    }

    hasLineOfSight(from, to) {
        const fromGrid = this.worldToNavGrid(from.x, from.z);
        const toGrid = this.worldToNavGrid(to.x, to.z);
        
        const dx = Math.abs(toGrid.x - fromGrid.x);
        const dz = Math.abs(toGrid.z - fromGrid.z);
        const sx = fromGrid.x < toGrid.x ? 1 : -1;
        const sz = fromGrid.z < toGrid.z ? 1 : -1;
        let err = dx - dz;
        
        let x = fromGrid.x;
        let z = fromGrid.z;
        let lastTerrain = this.getTerrainAtNavGrid(x, z);
        
        while (true) {
            if (x === toGrid.x && z === toGrid.z) return true;
            
            const currentTerrain = this.getTerrainAtNavGrid(x, z);
            if (currentTerrain === null || currentTerrain === 255) return false;
            
            if (!this.canWalkBetweenTerrains(lastTerrain, currentTerrain)) {
                return false;
            }
            
            const e2 = 2 * err;
            const willMoveX = e2 > -dz;
            const willMoveZ = e2 < dx;
            
            // Check for diagonal movement (corner cutting)
            if (willMoveX && willMoveZ) {
                // We're moving diagonally - check both adjacent cells to prevent corner cutting
                const terrainX = this.getTerrainAtNavGrid(x + sx, z);
                const terrainZ = this.getTerrainAtNavGrid(x, z + sz);
                
                // Both adjacent cells must be valid and walkable from current position
                if (terrainX === null || terrainX === 255 || 
                    terrainZ === null || terrainZ === 255) {
                    return false;
                }
                
                if (!this.canWalkBetweenTerrains(currentTerrain, terrainX) || 
                    !this.canWalkBetweenTerrains(currentTerrain, terrainZ)) {
                    return false;
                }
            }
            
            lastTerrain = currentTerrain;
            
            if (willMoveX) {
                err -= dz;
                x += sx;
            }
            if (willMoveZ) {
                err += dx;
                z += sz;
            }
        }
    }

    heuristic(a, b) {
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        return Math.sqrt(dx * dx + dz * dz);
    }

    addToCache(key, path) {
        if (this.pathCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = null;
            let oldestTime = Infinity;
            
            for (const [k, v] of this.pathCache.entries()) {
                if (v.timestamp < oldestTime) {
                    oldestTime = v.timestamp;
                    oldestKey = k;
                }
            }
            
            if (oldestKey) {
                this.pathCache.delete(oldestKey);
            }
        }
        
        this.pathCache.set(key, {
            path: path,
            timestamp: this.game.state.now
        });
    }

    clearPathCache() {
        this.pathCache.clear();
    }

    update() {
        if (!this.initialized) {
            this.init();
            return;
        }
        
        const now = this.game.state.now;
        const keysToDelete = [];
        
        for (const [key, data] of this.pathCache.entries()) {
            if (now - data.timestamp > this.CACHE_EXPIRY_TIME) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.sort();
        for (const key of keysToDelete) {
            this.pathCache.delete(key);
        }
        
        if (this.pathRequests.length === 0) return;
        
        this.pathRequests.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return String(a.entityId).localeCompare(String(b.entityId));
        });
        
        const pathsToProcess = Math.min(this.MAX_PATHS_PER_FRAME, this.pathRequests.length);
        
        for (let i = 0; i < pathsToProcess; i++) {
            const request = this.pathRequests.shift();
            
            const path = this.findPath(
                request.startX,
                request.startZ,
                request.endX,
                request.endZ,
                request.cacheKey
            );
            
            if (path && this.game.componentManager) {
                const componentTypes = this.game.componentManager.getComponentTypes();
                const aiState = this.game.getComponent(request.entityId, componentTypes.AI_STATE);
                
                if (aiState) {
                    aiState.path = path;
                    aiState.pathIndex = 0;
                }
            }
        }
    }

    isGridPositionWalkable(gridPos) {
        const worldPos = this.game.gameManager.call('convertGridToWorldPosition', gridPos.x, gridPos.z);
        return this.isPositionWalkable(worldPos);
    }

    isPositionWalkable(pos) {
        const grid = this.worldToNavGrid(pos.x, pos.z);
        
        // Check bounds
        if (grid.x < 0 || grid.x >= this.navGridWidth || 
            grid.z < 0 || grid.z >= this.navGridHeight) {
            return false;
        }
        
        const terrain = this.getTerrainAtNavGrid(grid.x, grid.z);
        return this.isTerrainWalkable(terrain);
    }

    ping() {
        console.log('pong');
    }
}