class GridSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.gridSystem = this;

        this.state = new Map();

        // NEW: track which half each team owns
        this.teamSides = { player: 'left', enemy: 'right' };
        this.leftBounds = null;
        this.rightBounds = null;

        // CoordinateTranslator for all coordinate space transformations
        this.coordinateTranslator = null;
    }

    init() {
        // Grid state management
        this.game.gameManager.register('getNearbyUnits', this.getNearbyUnits.bind(this));
        this.game.gameManager.register('isValidGridPlacement', this.isValidGridPlacement.bind(this));
        this.game.gameManager.register('reserveGridCells', this.occupyCells.bind(this));
        this.game.gameManager.register('releaseGridCells', this.freeCells.bind(this));
        this.game.gameManager.register('getUnitGridCells', this.getUnitCells.bind(this));

        // Grid configuration
        this.game.gameManager.register('getGridSize', () => this.terrainGridSize);
        this.game.gameManager.register('getPlacementGridSize', () => this.cellSize);

        // Placement Grid ↔ World coordinate transformations (legacy names for backward compatibility)
        this.game.gameManager.register('convertGridToWorldPosition', this.gridToWorld.bind(this));
        this.game.gameManager.register('convertWorldToGridPosition', this.worldToGrid.bind(this));

        // Tile ↔ World coordinate transformations (3D terrain grid)
        this.game.gameManager.register('tileToWorld', (tileX, tileZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] tileToWorld called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.tileToWorld(tileX, tileZ, useExtension);
        });
        this.game.gameManager.register('worldToTile', (worldX, worldZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] worldToTile called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.worldToTile(worldX, worldZ, useExtension);
        });
        this.game.gameManager.register('tileToWorldCorner', (tileX, tileZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] tileToWorldCorner called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.tileToWorldCorner(tileX, tileZ, useExtension);
        });

        // Quadrant positioning (for sub-tile positioning like cliffs)
        this.game.gameManager.register('applyQuadrantOffset', (tileWorldX, tileWorldZ, quadrant) =>
            this.coordinateTranslator.applyQuadrantOffset(tileWorldX, tileWorldZ, quadrant));

        // Tile ↔ Pixel coordinate transformations (for heightmap access)
        this.game.gameManager.register('tileToPixel', (tileX, tileZ) =>
            this.coordinateTranslator.tileToPixel(tileX, tileZ));
        this.game.gameManager.register('pixelToTile', (pixelX, pixelZ) =>
            this.coordinateTranslator.pixelToTile(pixelX, pixelZ));

        // Pixel ↔ World coordinate transformations (for worldObjects)
        this.game.gameManager.register('pixelToWorld', (pixelX, pixelZ) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] pixelToWorld called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.pixelToWorld(pixelX, pixelZ);
        });
        this.game.gameManager.register('worldToPixel', (worldX, worldZ) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] worldToPixel called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.worldToPixel(worldX, worldZ);
        });

        // Coordinate validation
        this.game.gameManager.register('isValidTile', (tileX, tileZ) =>
            this.coordinateTranslator.isValidTile(tileX, tileZ));
        this.game.gameManager.register('isValidWorldPosition', (worldX, worldZ) =>
            this.coordinateTranslator.isValidWorldPosition(worldX, worldZ));

        // Configuration updates (for dynamic changes like extension size)
        this.game.gameManager.register('updateCoordinateConfig', (config) =>
            this.coordinateTranslator.updateConfig(config));

        const collections = this.game.getCollections();

        const terrainGridSize = collections.configs.game.gridSize;
        const placementGridSize = terrainGridSize / 2; // Placement grid is always half the terrain grid
        const currentLevel = collections.configs.state.level;
        const tileMapSize = collections.levels[currentLevel]?.tileMap?.size || 32;
        const terrainSize = tileMapSize * terrainGridSize;

        this.cellSize = placementGridSize;
        this.terrainGridSize = terrainGridSize;
        this.showGrid = true;
        this.snapToGrid = true;
        this.highlightValidCells = true;

        this.dimensions = {
            width: Math.floor(terrainSize / placementGridSize),
            height: Math.floor(terrainSize / placementGridSize),
            cellSize: placementGridSize,
            startX: -terrainSize / 2,
            startZ: -terrainSize / 2
        };

        // Initialize CoordinateTranslator for centralized coordinate transformations
        this.coordinateTranslator = new GUTS.CoordinateTranslator({
            gridSize: terrainGridSize,
            tileMapSize: tileMapSize,
            placementGridDimensions: {
                startX: this.dimensions.startX,
                startZ: this.dimensions.startZ
            }
        });

        console.log("dimensions", this.dimensions);
        console.log("[GridSystem] Initialized CoordinateTranslator with gridSize:", terrainGridSize, "tileMapSize:", tileMapSize);
        
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
            maxX: this.dimensions.startX + (this.dimensions.width * placementGridSize),
            minZ: this.dimensions.startZ,
            maxZ: this.dimensions.startZ + (this.dimensions.height * placementGridSize)
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
        // Use CoordinateTranslator for placement grid conversions
        return this.coordinateTranslator.worldToPlacementGrid(worldX, worldZ);
    }

    gridToWorld(gridX, gridZ) {
        // Use CoordinateTranslator for placement grid conversions
        return this.coordinateTranslator.placementGridToWorld(gridX, gridZ);
    }
    
    // OPTIMIZED: Early bounds checking
    isValidPosition(gridPos) {
        return gridPos.x >= 0 && gridPos.x < this.dimensions.width &&
               gridPos.z >= 0 && gridPos.z < this.dimensions.height;
    }

    isValidGridPlacement(cells, team) {
        if (!cells || cells.length === 0) return false;
        
        for (const cell of cells) {
            const key = `${cell.x},${cell.z}`;
            const cellState = this.state.get(key);
            if (cellState && cellState.occupied) {
                return false;
            }
        }

        
        return true;
    }

    getUnitCells(entityId) {

        const unitType = this.game.getComponent(entityId, this.game.gameManager.call('getComponentTypes').UNIT_TYPE);
        const pos = this.game.getComponent(entityId, this.game.gameManager.call('getComponentTypes').POSITION);

        if(!unitType) return null;
        const cells = [];

        // For buildings, convert footprint (terrain grid units) to placement grid cells
        // For units, use placementGridWidth/Height directly (already in placement grid units)
        let placementGridWidth, placementGridHeight;

        if (unitType.collection === 'buildings') {
            // Buildings use footprint in terrain grid units, convert to placement grid cells (2x)
            const footprintWidth = unitType.footprintWidth || unitType.placementGridWidth || 1;
            const footprintHeight = unitType.footprintHeight || unitType.placementGridHeight || 1;
            placementGridWidth = footprintWidth * 2;
            placementGridHeight = footprintHeight * 2;
        } else {
            // Units use placement grid units directly
            placementGridWidth = unitType.placementGridWidth || 1;
            placementGridHeight = unitType.placementGridHeight || 1;
        }

        const gridPos = this.worldToGrid(pos.x, pos.z);
        // Calculate starting position to center the formation
        const startX = gridPos.x - Math.floor(placementGridWidth / 2);
        const startZ = gridPos.z - Math.floor(placementGridHeight / 2);
        for (let x = 0; x < placementGridWidth; x++) {
            for (let z = 0; z < placementGridHeight; z++) {
                cells.push({
                    x: startX + x,
                    z: startZ + z
                });
            }
        }

        return cells;
    }

    getNearbyUnits(pos, radius, excludeEntityId = null, collection = null) {
        const gridPos = this.worldToGrid(pos.x, pos.z);
        const cellRadius = Math.ceil(radius / this.cellSize);
        
        const nearbyUnits = [];
        const radiusSq = radius * radius;
        const seen = new Set(); // Prevent duplicates

        for (let gz = gridPos.z - cellRadius; gz <= gridPos.z + cellRadius; gz++) {
            for (let gx = gridPos.x - cellRadius; gx <= gridPos.x + cellRadius; gx++) {
                if (!this.isValidPosition({ x: gx, z: gz })) continue;
                
                const cellState = this.getCellState(gx, gz);
                if (!cellState?.entities?.length) continue;

                for (const entityId of cellState.entities) {
                    if (entityId === excludeEntityId || seen.has(entityId)) continue;

                    const entityPos = this.game.getComponent(entityId, this.game.gameManager.call('getComponentTypes').POSITION);
                    const unitType = this.game.getComponent(entityId, this.game.gameManager.call('getComponentTypes').UNIT_TYPE);
                    
                    if (!entityPos || !unitType) continue;

                    const dx = entityPos.x - pos.x;
                    const dz = entityPos.z - pos.z;
                    const distSq = dx * dx + dz * dz;
                    
                    if(collection && unitType.collection != collection) continue;

                    if (distSq <= radiusSq) {
                        seen.add(entityId);
                        nearbyUnits.push({
                            x: entityPos.x,
                            z: entityPos.z,
                            y: entityPos.y,
                            id: entityId,
                            ...unitType
                        });
                    }
                }
            }
        }
        return nearbyUnits.sort((a, b) => a.id.localeCompare(b.id));
    }

    onEntityPositionUpdated(entityId) {
        const cells = this.getUnitCells(entityId);
        this.freeCells(entityId);
        this.occupyCells(cells, entityId);
    }

    occupyCells(cells, entityId) {       
        for (const cell of cells) {
            const key = `${cell.x},${cell.z}`;
            let cellState = this.state.get(key);

            if (!cellState) {
                cellState = { occupied: true, entities: [] };
                this.state.set(key, cellState);
            }

            // Add entity if not already present
            if (!cellState.entities.includes(entityId)) {
                cellState.entities.push(entityId);
            }
            cellState.entities.sort((a, b) => a.localeCompare(b));     
        }           
    }
        
    freeCells(entityId) {
        for (const [key, cellState] of this.state.entries()) {
            if (cellState.entities.includes(entityId)) {
                cellState.entities = cellState.entities.filter(id => id !== entityId);
                
                // Clean up empty cell
                if (cellState.entities.length === 0) {
                    this.state.delete(key);
                } else {                    
                    cellState.entities.sort((a, b) => a.localeCompare(b));
                }
            }
        }
    }

    clear() {
        console.log('grid system cleared');
        this.state.clear();
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
        return this.state.get(`${gridX},${gridZ}`);
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
            occupiedCount: this.state.size
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

    onDestroyBuilding(entityId){ 
        this.freeCells(entityId);
    }

    onUnitKilled(entityId){  
        this.freeCells(entityId);
    }

    
    // OPTIMIZED: Fast world bounds check
    isInWorldBounds(worldX, worldZ) {
        return worldX >= this.worldBounds.minX && worldX <= this.worldBounds.maxX &&
               worldZ >= this.worldBounds.minZ && worldZ <= this.worldBounds.maxZ;
    }
}