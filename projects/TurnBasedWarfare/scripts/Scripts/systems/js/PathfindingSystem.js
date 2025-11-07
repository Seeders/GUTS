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
        
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        
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
        const terrainSize = this.game.terrainSystem.terrainSize;
        
        this.navGridWidth = Math.ceil(terrainSize / this.navGridSize);
        this.navGridHeight = Math.ceil(terrainSize / this.navGridSize);
        
        this.navMesh = new Uint8Array(this.navGridWidth * this.navGridHeight);
        
        const halfTerrain = terrainSize / 2;
        
        for (let z = 0; z < this.navGridHeight; z++) {
            for (let x = 0; x < this.navGridWidth; x++) {
                const worldX = (x * this.navGridSize) - halfTerrain + this.navGridSize / 2;
                const worldZ = (z * this.navGridSize) - halfTerrain + this.navGridSize / 2;
                
                const terrainType = this.game.terrainSystem.getTerrainTypeAtPosition(worldX, worldZ);
                
                const idx = z * this.navGridWidth + x;
                this.navMesh[idx] = terrainType !== null ? terrainType : 0;
            }
        }
        
        console.log(`PathfindingSystem: Baked nav mesh ${this.navGridWidth}x${this.navGridHeight}`);
    }

    worldToNavGrid(worldX, worldZ) {
        const halfTerrain = this.game.terrainSystem.terrainSize / 2;
        const gridX = Math.floor((worldX + halfTerrain) / this.navGridSize);
        const gridZ = Math.floor((worldZ + halfTerrain) / this.navGridSize);
        return { x: gridX, z: gridZ };
    }

    navGridToWorld(gridX, gridZ) {
        const halfTerrain = this.game.terrainSystem.terrainSize / 2;
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
            
            const currentTerrain = this.getTerrainAtNavGrid(current.x, current.z);
            
            for (const dir of directions) {
                const neighborX = current.x + dir.dx;
                const neighborZ = current.z + dir.dz;
                const neighborKey = `${neighborX},${neighborZ}`;
                
                if (closedSet.has(neighborKey)) continue;
                
                const neighborTerrain = this.getTerrainAtNavGrid(neighborX, neighborZ);
                if (neighborTerrain === null) continue;
                
                if (!this.canWalkBetweenTerrains(currentTerrain, neighborTerrain)) {
                    continue;
                }
                
                const isDiagonal = dir.dx !== 0 && dir.dz !== 0;
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
            
            for (let i = path.length - 1; i > currentIdx + 1; i--) {
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
            if (currentTerrain === null) return false;
            
            if (!this.canWalkBetweenTerrains(lastTerrain, currentTerrain)) {
                return false;
            }
            
            lastTerrain = currentTerrain;
            
            const e2 = 2 * err;
            if (e2 > -dz) {
                err -= dz;
                x += sx;
            }
            if (e2 < dx) {
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

    ping() {
        console.log('pong');
    }
}

