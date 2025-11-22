class PathfindingSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.pathfindingSystem = this;

        this.navMesh = null;
        this.navGridSize = null; // Will be set from config
        this.navGridWidth = 0;
        this.navGridHeight = 0;
        
        this.terrainTypes = null;
        this.walkabilityCache = new Map();
        this.ramps = new Set(); // Stores ramp locations in "x,z" format (terrain grid coords)

        this.pathCache = new Map();
        this.MAX_CACHE_SIZE = 1000;
        this.CACHE_EXPIRY_TIME = 5000;

        this.pathRequests = [];
        this.MAX_PATHS_PER_FRAME = 100;

        // Path smoothing configuration
        // Lower values = less aggressive smoothing = less corner cutting
        // Higher values = more aggressive smoothing = smoother but riskier paths
        this.MAX_SMOOTH_LOOKAHEAD = 3; // Maximum waypoints to look ahead when smoothing

        // Debug visualization
        this.debugVisualization = null;
        this.debugEnabled = false;

        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        this.game.gameManager.register('isPositionWalkable', this.isPositionWalkable.bind(this));
        this.game.gameManager.register('isGridPositionWalkable', this.isGridPositionWalkable.bind(this));
        this.game.gameManager.register('requestPath', this.requestPath.bind(this));
        this.game.gameManager.register('hasRampAt', this.hasRampAt.bind(this));
        this.game.gameManager.register('hasDirectWalkablePath', this.hasDirectWalkablePath.bind(this));
        this.game.gameManager.register('togglePathfindingDebug', this.toggleDebugVisualization.bind(this));


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
        
        // Load terrain types from collections
        this.terrainTypesCollection = collections.terrainTypes;
        if (!this.terrainTypesCollection) {
            console.error('PathfindingSystem: No terrainTypes collection found');
            return;
        }

        // Get the terrain type IDs array from the level
        this.terrainTypeIds = level.tileMap.terrainTypes;
        if (!this.terrainTypeIds) {
            console.error('PathfindingSystem: No terrainTypes array in tileMap');
            return;
        }

        // Set navigation grid size to half of terrain grid (matches placement grid)
        this.navGridSize = this.game.gameManager.call('getPlacementGridSize');
        console.log('PathfindingSystem: Using nav grid size', this.navGridSize);

        // Load ramps data
        this.loadRamps(level.tileMap);

        this.bakeNavMesh();

        // Initialize debug visualization (only on client)
        if (!this.game.isServer && this.game.uiScene) {
            this.initDebugVisualization();
        }

        this.initialized = true;
        console.log('PathfindingSystem: Initialized');
    }

    loadRamps(tileMap) {
        this.ramps.clear();

        const ramps = tileMap.ramps || [];
        for (const ramp of ramps) {
            const key = `${ramp.x},${ramp.z}`;
            this.ramps.add(key);
        }

        console.log(`PathfindingSystem: Loaded ${ramps.length} ramps`);
    }

    canWalkBetweenTerrains(fromTerrainIndex, toTerrainIndex) {
        return this.isTerrainWalkable(fromTerrainIndex) && this.isTerrainWalkable(toTerrainIndex);;
    }

    // Convert nav grid coordinates to terrain grid coordinates
    navGridToTerrainGrid(navGridX, navGridZ) {
        const worldPos = this.navGridToWorld(navGridX, navGridZ);
        const gridSize = this.game.gameManager.call('getGridSize');
        const terrainSize = this.game.gameManager.call('getTerrainSize');

        const terrainX = Math.floor((worldPos.x + terrainSize / 2) / gridSize);
        const terrainZ = Math.floor((worldPos.z + terrainSize / 2) / gridSize);

        return { x: terrainX, z: terrainZ };
    }

    // Check if there's a ramp at the given nav grid position
    hasRampAtNav(navGridX, navGridZ) {
        const terrainGrid = this.navGridToTerrainGrid(navGridX, navGridZ);
        const key = `${terrainGrid.x},${terrainGrid.z}`;
        return this.ramps.has(key);
    }
    
    hasRampAt(gridX, gridZ) {
        return this.ramps.has(`${gridX},${gridZ}`);
    }

    // Get height level at nav grid position
    getHeightLevelAtNavGrid(navGridX, navGridZ) {
        const terrainGrid = this.navGridToTerrainGrid(navGridX, navGridZ);
        return this.game.terrainSystem?.getHeightLevelAtGridPosition(terrainGrid.x, terrainGrid.z) || 0;
    }

    // Check if movement between terrains is allowed (either through height + ramps or walkableNeighbors)
    canWalkBetweenTerrainsWithRamps(fromTerrainIndex, toTerrainIndex, fromNavGridX, fromNavGridZ, toNavGridX, toNavGridZ) {
        const tileMap = this.game.gameManager.call('getTileMap');
        // NEW: Use height-based walkability if heightMap is available
        if (tileMap.heightMap && tileMap.heightMap.length > 0) {
            const fromHeight = this.getHeightLevelAtNavGrid(fromNavGridX, fromNavGridZ);
            const toHeight = this.getHeightLevelAtNavGrid(toNavGridX, toNavGridZ);

            // Same height level = always walkable
            if (fromHeight === toHeight) {
                return true;
            }

            // Different heights = only walkable with a ramp
            // Ramps allow movement between any adjacent height levels
            if (this.hasRampAtNav(fromNavGridX, fromNavGridZ) || this.hasRampAtNav(toNavGridX, toNavGridZ)) {
                return true;
            }

            return false;
        }

        // OLD: Use walkableNeighbors logic for backwards compatibility
        // First check normal walkability
        if (this.canWalkBetweenTerrains(fromTerrainIndex, toTerrainIndex)) {
            return true;
        }

        // If not normally walkable, check if there's a ramp at either position
        // Ramps allow movement between any terrain heights
        if (this.hasRampAtNav(fromNavGridX, fromNavGridZ) || this.hasRampAtNav(toNavGridX, toNavGridZ)) {
            return true;
        }

        return false;
    }

    /**
     * Bake navigation mesh from terrain and worldObjects
     *
     * Debug visualization available via: game.gameManager.call('togglePathfindingDebug')
     * Color coding:
     * - Green (0x00ff00): Walkable terrain
     * - Red (0xff0000): Impassable terrain (unwalkable terrain types)
     * - Orange (0xffaa00): Impassable worldObjects (trees, rocks, etc. with collision)
     *
     * NavMesh values:
     * - 0-254: Terrain type indices (walkability determined by terrainTypes collection)
     * - 255: Impassable (marked for worldObjects or other obstacles)
     */
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
        
        // Second pass: mark cells occupied by impassable worldObjects as impassable
        const collections = this.game.getCollections();
        const level = collections.levels?.[this.game.state.level];
        const tileMap = level?.tileMap;

        console.log('PathfindingSystem: Checking for worldObjects...');
        console.log('  - collections exists:', !!collections);
        console.log('  - level:', this.game.state.level);
        console.log('  - tileMap exists:', !!tileMap);
        console.log('  - worldObjects exists:', !!tileMap?.worldObjects);
        console.log('  - worldObjects count:', tileMap?.worldObjects?.length);

        if (tileMap?.worldObjects) {
            let markedCells = 0;
            let processedObjects = 0;

            for (const worldObj of tileMap.worldObjects) {
                processedObjects++;

                // Get unit type definition to check if object blocks movement
                const unitType = collections.worldObjects?.[worldObj.type];

                console.log(`WorldObj #${processedObjects}: type=${worldObj.type}, x=${worldObj.x}, y=${worldObj.y}`);
                console.log(`  - unitType exists:`, !!unitType);
                console.log(`  - impassable:`, unitType?.impassable);
                console.log(`  - size:`, unitType?.size);

                // Skip if object doesn't block movement (impassable === false) or has no size
                if (!unitType || unitType.impassable === false || !unitType.size) {
                    console.log(`  - SKIPPED (not impassable or no size)`);
                    continue;
                }

                // Convert terrain tile position to world position using GridSystem
                // worldObj.x and worldObj.y are in terrain tile coordinates
                const worldPos = this.game.gameManager.call('tileToWorld', worldObj.x, worldObj.y);
                console.log(`  - worldPos:`, worldPos);

                // Convert world position to nav grid coordinates
                const navGrid = this.worldToNavGrid(worldPos.x, worldPos.z);
                console.log(`  - navGrid: (${navGrid.x}, ${navGrid.z})`);

                // Each terrain tile covers a 2x2 area of nav grid cells
                // Mark all 4 nav grid cells as impassable
                for (let dz = 0; dz < 2; dz++) {
                    for (let dx = 0; dx < 2; dx++) {
                        const nx = navGrid.x + dx;
                        const nz = navGrid.z + dz;

                        if (nx >= 0 && nx < this.navGridWidth && nz >= 0 && nz < this.navGridHeight) {
                            const idx = nz * this.navGridWidth + nx;
                            const oldValue = this.navMesh[idx];
                            this.navMesh[idx] = 255;
                            markedCells++;
                            console.log(`  - Marked nav cell (${nx}, ${nz}) idx=${idx} (was ${oldValue}, now 255)`);
                        } else {
                            console.log(`  - OUT OF BOUNDS: (${nx}, ${nz}) grid is ${this.navGridWidth}x${this.navGridHeight}`);
                        }
                    }
                }
            }
            console.log(`PathfindingSystem: Processed ${processedObjects} worldObjects, marked ${markedCells} nav cells as impassable`);
        } else {
            console.warn('PathfindingSystem: No worldObjects found in tileMap!');
        }

        console.log(`PathfindingSystem: Baked nav mesh ${this.navGridWidth}x${this.navGridHeight}`);
    }
    
    isTerrainWalkable(terrainTypeIndex) {
        if (terrainTypeIndex === null || terrainTypeIndex === undefined) return false;

        // Get the terrain type ID from the array
        const terrainTypeId = this.terrainTypeIds[terrainTypeIndex];
        if (!terrainTypeId) return false;

        // Look up the terrain type from collections
        const terrainType = this.terrainTypesCollection[terrainTypeId];
        if (!terrainType) return false;

        // Check walkable property (defaults to true if not specified)
        return terrainType.walkable !== false;
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

                if (!this.canWalkBetweenTerrainsWithRamps(currentTerrain, neighborTerrain, current.x, current.z, neighborX, neighborZ)) {
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

                    if (!this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainX, current.x, current.z, current.x + dir.dx, current.z) ||
                        !this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainZ, current.x, current.z, current.x, current.z + dir.dz)) {
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
    hasDirectWalkablePath(fromPos, toPos, entityId = null) {
        if (!this.initialized || !this.navMesh) return false;
        
        const fromGrid = this.worldToNavGrid(fromPos.x, fromPos.z);
        const toGrid = this.worldToNavGrid(toPos.x, toPos.z);
        
        // Same grid cell = direct path
        if (fromGrid.x === toGrid.x && fromGrid.z === toGrid.z) {
            return true;
        }
        
        // Bresenham's line algorithm to check every grid cell along the path
        const dx = Math.abs(toGrid.x - fromGrid.x);
        const dz = Math.abs(toGrid.z - fromGrid.z);
        const sx = fromGrid.x < toGrid.x ? 1 : -1;
        const sz = fromGrid.z < toGrid.z ? 1 : -1;
        let err = dx - dz;
        
        let x = fromGrid.x;
        let z = fromGrid.z;
        let lastX = x;
        let lastZ = z;
        let lastTerrain = this.getTerrainAtNavGrid(x, z);

        // If starting position isn't walkable, fail immediately
        if (!this.isTerrainWalkable(lastTerrain)) {
            return false;
        }

        while (true) {
            // Reached destination
            if (x === toGrid.x && z === toGrid.z) {
                return true;
            }

            const currentTerrain = this.getTerrainAtNavGrid(x, z);

            // Hit impassable terrain or out of bounds
            if (currentTerrain === null || currentTerrain === 255) {
                return false;
            }

            // Check if current terrain is walkable
            if (!this.isTerrainWalkable(currentTerrain)) {
                return false;
            }

            // Check if we can transition from last terrain to current terrain
            if (!this.canWalkBetweenTerrainsWithRamps(lastTerrain, currentTerrain, lastX, lastZ, x, z)) {
                return false;
            }
            
            const e2 = 2 * err;
            const willMoveX = e2 > -dz;
            const willMoveZ = e2 < dx;
            
            // For diagonal movement, check both adjacent cells to prevent corner cutting
            if (willMoveX && willMoveZ) {
                const terrainX = this.getTerrainAtNavGrid(x + sx, z);
                const terrainZ = this.getTerrainAtNavGrid(x, z + sz);

                // Both adjacent cells must be valid and walkable
                if (terrainX === null || terrainX === 255 ||
                    terrainZ === null || terrainZ === 255) {
                    return false;
                }

                if (!this.isTerrainWalkable(terrainX) || !this.isTerrainWalkable(terrainZ)) {
                    return false;
                }

                // Check terrain transitions for both adjacent cells
                if (!this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainX, x, z, x + sx, z) ||
                    !this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainZ, x, z, x, z + sz)) {
                    return false;
                }
            }

            lastTerrain = currentTerrain;
            lastX = x;
            lastZ = z;

            // Move along the line
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
        let lastX = x;
        let lastZ = z;
        let lastTerrain = this.getTerrainAtNavGrid(x, z);

        while (true) {
            if (x === toGrid.x && z === toGrid.z) return true;

            const currentTerrain = this.getTerrainAtNavGrid(x, z);
            if (currentTerrain === null || currentTerrain === 255) return false;

            if (!this.canWalkBetweenTerrainsWithRamps(lastTerrain, currentTerrain, lastX, lastZ, x, z)) {
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

                if (!this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainX, x, z, x + sx, z) ||
                    !this.canWalkBetweenTerrainsWithRamps(currentTerrain, terrainZ, x, z, x, z + sz)) {
                    return false;
                }
            }

            lastTerrain = currentTerrain;
            lastX = x;
            lastZ = z;

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
                console.log('FALSE: out of bounds');
            return false;
        }
        
        const terrain = this.getTerrainAtNavGrid(grid.x, grid.z);
        return this.isTerrainWalkable(terrain);
    }

    /**
     * Initialize debug visualization
     */
    initDebugVisualization() {
        console.log('PathfindingSystem: initDebugVisualization called');
        console.log('  - uiScene exists:', !!this.game.uiScene);
        console.log('  - navMesh exists:', !!this.navMesh);
        console.log('  - navGridWidth:', this.navGridWidth);
        console.log('  - navGridHeight:', this.navGridHeight);

        if (!this.game.uiScene) {
            console.warn('PathfindingSystem: No uiScene available for debug visualization');
            return;
        }

        if (!this.navMesh) {
            console.warn('PathfindingSystem: No navMesh available - must bake first');
            return;
        }

        // Create debug group
        this.debugVisualization = new THREE.Group();
        this.debugVisualization.name = 'PathfindingDebug';
        this.debugVisualization.visible = false;
        this.game.uiScene.add(this.debugVisualization);

        console.log('PathfindingSystem: Created debug group, added to uiScene');

        // Create materials for different cell types
        const cellSize = this.navGridSize * 0.8; // Slightly smaller than grid cell

        this.debugMaterials = {
            walkable: new THREE.MeshBasicMaterial({
                color: 0x00ff00, // Green for walkable
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide
            }),
            impassableTerrain: new THREE.MeshBasicMaterial({
                color: 0xff0000, // Red for impassable terrain
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            }),
            impassableObject: new THREE.MeshBasicMaterial({
                color: 0xffaa00, // Orange for worldObjects
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide
            })
        };

        const cellGeometry = new THREE.PlaneGeometry(cellSize, cellSize);

        // Create meshes for each nav grid cell
        for (let z = 0; z < this.navGridHeight; z++) {
            for (let x = 0; x < this.navGridWidth; x++) {
                const idx = z * this.navGridWidth + x;
                const terrainType = this.navMesh[idx];

                // Determine material based on cell type
                let material;
                if (terrainType === 255) {
                    material = this.debugMaterials.impassableObject;
                } else if (!this.isTerrainWalkable(terrainType)) {
                    material = this.debugMaterials.impassableTerrain;
                } else {
                    material = this.debugMaterials.walkable;
                }

                // Create mesh
                const mesh = new THREE.Mesh(cellGeometry, material);

                // Convert nav grid to world position
                const worldPos = this.navGridToWorld(x, z);
                const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', worldPos.x, worldPos.z);

                mesh.position.set(worldPos.x, terrainHeight + 0.5, worldPos.z);
                mesh.rotation.x = -Math.PI / 2;
                mesh.userData = { navX: x, navZ: z, terrainType: terrainType };

                this.debugVisualization.add(mesh);
            }
        }

        console.log(`PathfindingSystem: Created debug visualization with ${this.navGridWidth * this.navGridHeight} cells`);
    }

    /**
     * Toggle debug visualization
     */
    toggleDebugVisualization() {
        console.log('PathfindingSystem: toggleDebugVisualization called');
        console.log('  - debugVisualization exists:', !!this.debugVisualization);
        console.log('  - game.uiScene exists:', !!this.game.uiScene);
        console.log('  - isServer:', this.game.isServer);

        if (!this.debugVisualization) {
            console.warn('PathfindingSystem: Debug visualization not initialized');

            // Try to initialize it now if on client
            if (!this.game.isServer && this.game.uiScene) {
                console.log('PathfindingSystem: Attempting to initialize debug visualization now...');
                this.initDebugVisualization();
            } else {
                console.error('PathfindingSystem: Cannot initialize - isServer:', this.game.isServer, 'uiScene:', !!this.game.uiScene);
                return;
            }
        }

        this.debugEnabled = !this.debugEnabled;
        this.debugVisualization.visible = this.debugEnabled;

        console.log(`PathfindingSystem: Debug visualization ${this.debugEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log('  - Group visible:', this.debugVisualization.visible);
        console.log('  - Children count:', this.debugVisualization.children.length);
        console.log('  - Parent:', this.debugVisualization.parent?.name);
    }

    /**
     * Update debug visualization (call after navmesh changes)
     */
    updateDebugVisualization() {
        if (!this.debugVisualization) return;

        let meshIndex = 0;
        for (let z = 0; z < this.navGridHeight; z++) {
            for (let x = 0; x < this.navGridWidth; x++) {
                const idx = z * this.navGridWidth + x;
                const terrainType = this.navMesh[idx];
                const mesh = this.debugVisualization.children[meshIndex];

                if (mesh) {
                    // Update material based on current cell type
                    if (terrainType === 255) {
                        mesh.material = this.debugMaterials.impassableObject;
                    } else if (!this.isTerrainWalkable(terrainType)) {
                        mesh.material = this.debugMaterials.impassableTerrain;
                    } else {
                        mesh.material = this.debugMaterials.walkable;
                    }
                    mesh.userData.terrainType = terrainType;
                }

                meshIndex++;
            }
        }

        console.log('PathfindingSystem: Debug visualization updated');
    }

    ping() {
        console.log('pong');
    }
}