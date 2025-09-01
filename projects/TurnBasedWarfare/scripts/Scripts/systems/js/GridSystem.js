class GridSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.gridSystem = this;
        
        this.state = new Map();
        this.validationCache = new Map();
        this.lastCacheClean = 0;
        this.CACHE_CLEAN_INTERVAL = 10000;

        // NEW: track which half each team owns
        this.teamSides = { player: 'left', enemy: 'right' };
        this.leftBounds = null;
        this.rightBounds = null;
    }
    
    init({terrainSize = 1536, cellSize = 48}) {
        console.log('grid system initialized', terrainSize, cellSize);
        this.cellSize = cellSize;
        this.showGrid = true;
        this.snapToGrid = true;
        this.highlightValidCells = true;
        
        this.dimensions = {
            width: Math.floor(terrainSize / cellSize),
            height: Math.floor(terrainSize / cellSize),
            cellSize: cellSize,
            startX: -terrainSize / 2,
            startZ: -terrainSize / 2
        };
        console.log('dimensions', this.dimensions);
        
        this.gridVisualization = null;

        // Compute half-splits once
        const half = Math.floor(this.dimensions.width / 2);
        this.leftBounds = {
            minX: 0,
            maxX: half - 1,
            minZ: 0,
            maxZ: this.dimensions.height - 1
        };
        this.rightBounds = {
            minX: half,
            maxX: this.dimensions.width - 1,
            minZ: 0,
            maxZ: this.dimensions.height - 1
        };

        // Default: player=left, enemy=right (can be swapped later)
        this.playerBounds = this.leftBounds;
        this.enemyBounds  = this.rightBounds;
        
        // Pre-calculate world bounds for faster collision detection
        this.worldBounds = {
            minX: this.dimensions.startX,
            maxX: this.dimensions.startX + (this.dimensions.width * cellSize),
            minZ: this.dimensions.startZ,
            maxZ: this.dimensions.startZ + (this.dimensions.height * cellSize)
        };
    }

    // NEW: set which half each team owns (call this when you learn sides from the server)
    setTeamSides(sides) {
        if (sides?.player === 'left' || sides?.player === 'right') {
            this.teamSides.player = sides.player;
        }
        if (sides?.enemy === 'left' || sides?.enemy === 'right') {
            this.teamSides.enemy = sides.enemy;
        }

        // Point player/enemy bounds at the correct half
        this.playerBounds = (this.teamSides.player === 'left') ? this.leftBounds : this.rightBounds;
        this.enemyBounds  = (this.teamSides.enemy  === 'left') ? this.leftBounds : this.rightBounds;

    }
    
    createVisualization(scene) {
        if (this.gridVisualization) {
            scene.remove(this.gridVisualization);
        }
        
        const group = new THREE.Group();
        const { width, height, cellSize, startX, startZ } = this.dimensions;
        
        // Use BufferGeometry for better performance
        const linePositions = [];
        
        // Vertical lines
        for (let x = 0; x <= width; x++) {
            const worldX = startX + (x * cellSize);
            linePositions.push(
                worldX, 1, startZ,
                worldX, 1, startZ + (height * cellSize)
            );
        }
        
        // Horizontal lines
        for (let z = 0; z <= height; z++) {
            const worldZ = startZ + (z * cellSize);
            linePositions.push(
                startX, 1, worldZ,
                startX + (width * cellSize), 1, worldZ
            );
        }
        
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x444444, 
            transparent: true, 
            opacity: 0.3 
        });
        
        const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
        group.add(lines);
        
        // Center divider line
        const dividerPositions = [
            startX + (width * cellSize / 2), 2, startZ,
            startX + (width * cellSize / 2), 2, startZ + (height * cellSize)
        ];
        
        const dividerGeometry = new THREE.BufferGeometry();
        dividerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dividerPositions, 3));
        
        const dividerMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff0000, 
            transparent: true, 
            opacity: 0.5 
        });
        
        const dividerLine = new THREE.LineSegments(dividerGeometry, dividerMaterial);
        group.add(dividerLine);
        
        this.gridVisualization = group;
        scene.add(this.gridVisualization);
    }
    
    worldToGrid(worldX, worldZ) {
        const { cellSize, startX, startZ } = this.dimensions;
        return {
            x: Math.floor((worldX - startX) / cellSize),
            z: Math.floor((worldZ - startZ) / cellSize)
        };
    }
    
    gridToWorld(gridX, gridZ) {
        const { cellSize, startX, startZ } = this.dimensions;
        return {
            x: startX + (gridX * cellSize) + (cellSize / 2),
            z: startZ + (gridZ * cellSize) + (cellSize / 2)
        };
    }
    
    // OPTIMIZED: Early bounds checking
    isValidPosition(gridPos) {
        return gridPos.x >= 0 && gridPos.x < this.dimensions.width &&
               gridPos.z >= 0 && gridPos.z < this.dimensions.height;
    }

    isValidPlacement(cells, team) {
        if (!cells || cells.length === 0) return false;
                
        // IMPORTANT: use dynamic bounds based on current side assignment
        const bounds = (team === 'right') ? this.rightBounds : this.leftBounds;
        
        for (const cell of cells) {
            if (cell.x < bounds.minX || cell.x > bounds.maxX ||
                cell.z < bounds.minZ || cell.z > bounds.maxZ) {
                    console.log('placement out of bounds', team, cells, bounds);
                return false;
            }
        }
        
        for (const cell of cells) {
            const key = `${cell.x},${cell.z}`;
            const cellState = this.state.get(key);
            if (cellState && cellState.occupied) {
                console.log('cellstate occupied');
                return false;
            }
        }

        
        return true;
    }
            
    cleanValidationCache() {
        const now = Date.now();
        const maxAge = 5000;
        
        for (const [key, value] of this.validationCache.entries()) {
            if (now - value.timestamp > maxAge) {
                this.validationCache.delete(key);
            }
        }
        
        this.lastCacheClean = now;
    }
    
    occupyCells(cells, placementId) {
        const updates = cells.map(cell => ({
            key: `${cell.x},${cell.z}`,
            value: {
                occupied: true,
                placementId: placementId
            }
        }));
        
        updates.forEach(({ key, value }) => {
            this.state.set(key, value);
        });
        
        this.invalidateCache(cells);
    }

    freeCells(placementId) {
        const keysToDelete = [];
        
        for (const [key, value] of this.state.entries()) {
            if (value.placementId === placementId) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => {
            this.state.delete(key);
        });
        
        // Clear all cache since we don't know which entries are affected
        this.validationCache.clear();
    }
        
    invalidateCache(cells) {
        const affectedKeys = new Set();
        
        for (const cell of cells) {
            for (const [cacheKey] of this.validationCache.entries()) {
                if (cacheKey.includes(`${cell.x},${cell.z}`)) {
                    affectedKeys.add(cacheKey);
                }
            }
        }
        
        affectedKeys.forEach(key => {
            this.validationCache.delete(key);
        });
    }
        
    clear() {
        this.state.clear();
        this.validationCache.clear();
    }
    
    toggleVisibility(scene) {
        this.showGrid = !this.showGrid;
        
        if (this.showGrid) {
            this.createVisualization(scene);
        } else if (this.gridVisualization) {
            scene.remove(this.gridVisualization);
            this.gridVisualization = null;
        }
    }
    
    getBounds(team) {
        // Keep API compatibility; these references are updated by setTeamSides()
        return team === 'right' ? this.rightBounds : this.leftBounds;
    }
    
    getCellState(gridX, gridZ) {
        const key = `${gridX},${gridZ}`;
        return this.state.get(key);
    }
    
    getOccupiedCells() {
        return Array.from(this.state.entries()).map(([key, value]) => {
            const [x, z] = key.split(',').map(Number);
            return { x, z, ...value };
        });
    }
    
    getGridInfo() {
        return {
            dimensions: this.dimensions,
            leftBounds: this.leftBounds,
            rightBounds: this.rightBounds,
            teamSides: { ...this.teamSides },
            occupiedCells: this.getOccupiedCells(),
            totalCells: this.dimensions.width * this.dimensions.height,
            occupiedCount: this.state.size,
            cacheSize: this.validationCache.size
        };
    }
    
    // OPTIMIZED: Batch cell queries for better performance
    areCellsOccupied(cells) {
        for (const cell of cells) {
            const key = `${cell.x},${cell.z}`;
            if (this.state.has(key)) {
                return true;
            }
        }
        return false;
    }
    
    // OPTIMIZED: Fast world bounds check
    isInWorldBounds(worldX, worldZ) {
        return worldX >= this.worldBounds.minX && worldX <= this.worldBounds.maxX &&
               worldZ >= this.worldBounds.minZ && worldZ <= this.worldBounds.maxZ;
    }
}
