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

        // Debug visualization
        this.debugVisualization = null;
        this.debugEnabled = false;
        this.debugMeshes = new Map(); // cell key -> mesh

        // OPTIMIZATION: Track entity positions for incremental grid updates
        // Only update cells when entities actually move
        this._entityPositions = new Map(); // entityId -> { gridX, gridZ, cells: Set<numericKey> }
        this._reusableSeenSet = new Set(); // Reusable set for getNearbyUnits to avoid allocations
        this._reusableCellArray = []; // Reusable array for cell calculations
    }

    init() {
        // Grid state management
        this.game.register('getNearbyUnits', this.getNearbyUnits.bind(this));
        this.game.register('isValidGridPlacement', this.isValidGridPlacement.bind(this));
        this.game.register('reserveGridCells', this.occupyCells.bind(this));
        this.game.register('releaseGridCells', this.freeCells.bind(this));
        this.game.register('getUnitGridCells', this.getUnitCells.bind(this));
        this.game.register('toggleSpatialGridDebug', this.toggleDebugVisualization.bind(this));

        // Grid configuration
        this.game.register('getGridSize', () => this.terrainGridSize);
        this.game.register('getPlacementGridSize', () => this.cellSize);

        // Placement Grid ↔ World coordinate transformations
        // Use these for placement grid coordinates (2x terrain tile grid, used for unit/building placement)
        this.game.register('placementGridToWorld', this.gridToWorld.bind(this));
        this.game.register('worldToPlacementGrid', this.worldToGrid.bind(this));

        // Tile ↔ World coordinate transformations (3D terrain grid)
        this.game.register('tileToWorld', (tileX, tileZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] tileToWorld called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.tileToWorld(tileX, tileZ, useExtension);
        });
        this.game.register('worldToTile', (worldX, worldZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] worldToTile called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.worldToTile(worldX, worldZ, useExtension);
        });
        this.game.register('tileToWorldCorner', (tileX, tileZ, useExtension = false) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] tileToWorldCorner called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.tileToWorldCorner(tileX, tileZ, useExtension);
        });

        // Quadrant positioning (for sub-tile positioning like cliffs)
        this.game.register('applyQuadrantOffset', (tileWorldX, tileWorldZ, quadrant) =>
            this.coordinateTranslator.applyQuadrantOffset(tileWorldX, tileWorldZ, quadrant));

        // Tile ↔ Pixel coordinate transformations (for heightmap access)
        this.game.register('tileToPixel', (tileX, tileZ) =>
            this.coordinateTranslator.tileToPixel(tileX, tileZ));
        this.game.register('pixelToTile', (pixelX, pixelZ) =>
            this.coordinateTranslator.pixelToTile(pixelX, pixelZ));

        // Pixel ↔ World coordinate transformations (for worldObjects)
        this.game.register('pixelToWorld', (pixelX, pixelZ) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] pixelToWorld called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.pixelToWorld(pixelX, pixelZ);
        });
        this.game.register('worldToPixel', (worldX, worldZ) => {
            if (!this.coordinateTranslator) {
                console.error('[GridSystem] worldToPixel called before CoordinateTranslator initialized!');
                return { x: 0, z: 0 };
            }
            return this.coordinateTranslator.worldToPixel(worldX, worldZ);
        });

        // Coordinate validation
        this.game.register('isValidTile', (tileX, tileZ) =>
            this.coordinateTranslator.isValidTile(tileX, tileZ));
        this.game.register('isValidWorldPosition', (worldX, worldZ) =>
            this.coordinateTranslator.isValidWorldPosition(worldX, worldZ));

        // Configuration updates (for dynamic changes like extension size)
        this.game.register('updateCoordinateConfig', (config) =>
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

    // OPTIMIZATION: Convert grid coordinates to a single numeric key
    // This avoids expensive string concatenation and parsing
    _cellKey(x, z) {
        return x + z * this.dimensions.width;
    }

    // OPTIMIZATION: Convert numeric key back to coordinates (only used for debug)
    _keyToCell(key) {
        const z = Math.floor(key / this.dimensions.width);
        const x = key - z * this.dimensions.width;
        return { x, z };
    }

    isValidGridPlacement(cells, team) {
        if (!cells || cells.length === 0) return false;

        for (const cell of cells) {
            const key = this._cellKey(cell.x, cell.z);
            const cellState = this.state.get(key);
            if (cellState && cellState.occupied) {
                return false;
            }
        }


        return true;
    }

    getUnitCells(entityId) {

        const unitType = this.game.getComponent(entityId, "unitType");
        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;

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

        const nearbyEntityIds = [];
        const radiusSq = radius * radius;

        // OPTIMIZATION: Reuse the seen set to avoid allocation per call
        const seen = this._reusableSeenSet;
        seen.clear();

        // Pre-calculate bounds to avoid repeated checks
        const minGx = Math.max(0, gridPos.x - cellRadius);
        const maxGx = Math.min(this.dimensions.width - 1, gridPos.x + cellRadius);
        const minGz = Math.max(0, gridPos.z - cellRadius);
        const maxGz = Math.min(this.dimensions.height - 1, gridPos.z + cellRadius);

        for (let gz = minGz; gz <= maxGz; gz++) {
            for (let gx = minGx; gx <= maxGx; gx++) {
                const key = this._cellKey(gx, gz);
                const cellState = this.state.get(key);
                if (!cellState?.entities?.length) continue;

                for (const entityId of cellState.entities) {
                    if (entityId === excludeEntityId || seen.has(entityId)) continue;

                    const transform = this.game.getComponent(entityId, "transform");
                    const entityPos = transform?.position;

                    if (!entityPos) continue;

                    const dx = entityPos.x - pos.x;
                    const dz = entityPos.z - pos.z;
                    const distSq = dx * dx + dz * dz;

                    if (collection) {
                        const unitType = this.game.getComponent(entityId, "unitType");
                        if (!unitType || unitType.collection !== collection) continue;
                    }

                    if (distSq <= radiusSq) {
                        seen.add(entityId);
                        nearbyEntityIds.push(entityId);
                    }
                }
            }
        }

        // OPTIMIZATION: Use numeric sort instead of localeCompare (much faster)
        // Entity IDs are numbers, so numeric sort is appropriate and deterministic
        if (nearbyEntityIds.length > 1) {
            nearbyEntityIds.sort((a, b) => a - b);
        }
        return nearbyEntityIds;
    }

    update(deltaTime) {
        // OPTIMIZATION: Incremental grid update - only update cells when entities move
        // Instead of clearing and rebuilding the entire grid each frame, we:
        // 1. Track each entity's previous grid position
        // 2. Only update cells when an entity moves to different cells
        // 3. Remove entities that are no longer valid (dead/destroyed)

        const entities = this.game.getEntitiesWith('unitType', 'transform');

        // Track which entities we've seen this frame
        const currentEntitySet = this._reusableSeenSet;
        currentEntitySet.clear();

        for (const entityId of entities) {
            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            // Check if entity is alive (skip dead/dying units)
            const health = this.game.getComponent(entityId, 'health');
            const deathState = this.game.getComponent(entityId, 'deathState');
            if (health && health.current <= 0) {
                // Remove dead entity from grid if it was tracked
                this._removeEntityFromGrid(entityId);
                continue;
            }
            if (deathState && deathState.isDying) {
                this._removeEntityFromGrid(entityId);
                continue;
            }

            // Skip world objects that are not impassable (e.g., gold veins, bushes)
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (unitType && unitType.impassable === false) continue;

            currentEntitySet.add(entityId);

            // Check if entity has moved to a new grid position
            const gridPos = this.worldToGrid(pos.x, pos.z);
            const cached = this._entityPositions.get(entityId);

            if (cached && cached.gridX === gridPos.x && cached.gridZ === gridPos.z) {
                // Entity hasn't moved grid cells, skip update
                continue;
            }

            // Entity is new or has moved - update grid
            const cells = this.getUnitCells(entityId);
            if (!cells) continue;

            // Remove from old cells if entity was already tracked
            if (cached && cached.cellKeys) {
                for (const oldKey of cached.cellKeys) {
                    const cellState = this.state.get(oldKey);
                    if (cellState) {
                        const idx = cellState.entities.indexOf(entityId);
                        if (idx !== -1) {
                            cellState.entities.splice(idx, 1);
                            if (cellState.entities.length === 0) {
                                this.state.delete(oldKey);
                            }
                        }
                    }
                }
            }

            // Add to new cells and cache the position
            const newCellKeys = new Set();
            for (const cell of cells) {
                const key = this._cellKey(cell.x, cell.z);
                newCellKeys.add(key);

                let cellState = this.state.get(key);
                if (!cellState) {
                    cellState = { occupied: true, entities: [] };
                    this.state.set(key, cellState);
                }

                if (!cellState.entities.includes(entityId)) {
                    cellState.entities.push(entityId);
                }
            }

            // Update position cache
            this._entityPositions.set(entityId, {
                gridX: gridPos.x,
                gridZ: gridPos.z,
                cellKeys: newCellKeys
            });
        }

        // Clean up entities that no longer exist
        for (const [entityId, cached] of this._entityPositions) {
            if (!currentEntitySet.has(entityId)) {
                this._removeEntityFromGrid(entityId);
            }
        }

        // Update debug visualization if enabled
        if (this.debugEnabled) {
            this.updateDebugVisualization();
        }
    }

    // OPTIMIZATION: Helper to remove an entity from the grid
    _removeEntityFromGrid(entityId) {
        const cached = this._entityPositions.get(entityId);
        if (!cached) return;

        if (cached.cellKeys) {
            for (const key of cached.cellKeys) {
                const cellState = this.state.get(key);
                if (cellState) {
                    const idx = cellState.entities.indexOf(entityId);
                    if (idx !== -1) {
                        cellState.entities.splice(idx, 1);
                        if (cellState.entities.length === 0) {
                            this.state.delete(key);
                        }
                    }
                }
            }
        }

        this._entityPositions.delete(entityId);
    }

    occupyCells(cells, entityId) {
        if (!cells || cells.length === 0) return;
        for (const cell of cells) {
            const key = this._cellKey(cell.x, cell.z);
            let cellState = this.state.get(key);

            if (!cellState) {
                cellState = { occupied: true, entities: [] };
                this.state.set(key, cellState);
            }

            // Add entity if not already present
            if (!cellState.entities.includes(entityId)) {
                cellState.entities.push(entityId);
            }
        }
    }

    freeCells(entityId) {
        // Remove entity from all cells it occupies
        for (const [key, cellState] of this.state.entries()) {
            const idx = cellState.entities.indexOf(entityId);
            if (idx !== -1) {
                cellState.entities.splice(idx, 1);
                if (cellState.entities.length === 0) {
                    this.state.delete(key);
                }
            }
        }
    }

    clear() {
        this.state.clear();
        this._entityPositions.clear();
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
        return this.state.get(this._cellKey(gridX, gridZ));
    }

    getOccupiedCells() {
        return Array.from(this.state.entries()).map(([key, value]) => {
            const cell = this._keyToCell(key);
            return { x: cell.x, z: cell.z, ...value };
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
            const key = this._cellKey(cell.x, cell.z);
            if (this.state.has(key)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Called when a scene is loaded - updates CoordinateTranslator if terrain level differs
     */
    onSceneLoad(sceneData) {
        // Look for terrain entity to get the actual level
        const terrainEntities = this.game.getEntitiesWith('terrain');
        if (terrainEntities.length === 0) return;

        const terrainComponent = this.game.getComponent(terrainEntities[0], 'terrain');
        if (!terrainComponent?.level) return;

        const collections = this.game.getCollections();
        const level = collections.levels?.[terrainComponent.level];
        if (!level?.tileMap?.size) return;

        const newTileMapSize = level.tileMap.size;
        const terrainGridSize = collections.configs.game.gridSize;
        const placementGridSize = terrainGridSize / 2;
        const terrainSize = newTileMapSize * terrainGridSize;

        // Update dimensions
        this.dimensions = {
            width: Math.floor(terrainSize / placementGridSize),
            height: Math.floor(terrainSize / placementGridSize),
            cellSize: placementGridSize,
            startX: -terrainSize / 2,
            startZ: -terrainSize / 2
        };

        // Update CoordinateTranslator with correct level dimensions
        this.coordinateTranslator.updateConfig({
            tileMapSize: newTileMapSize,
            placementGridDimensions: {
                startX: this.dimensions.startX,
                startZ: this.dimensions.startZ
            }
        });

        // Recompute half-splits
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

        this.playerBounds = this.leftBounds;
        this.enemyBounds = this.rightBounds;

        // Update world bounds
        this.worldBounds = {
            minX: this.dimensions.startX,
            maxX: this.dimensions.startX + (this.dimensions.width * placementGridSize),
            minZ: this.dimensions.startZ,
            maxZ: this.dimensions.startZ + (this.dimensions.height * placementGridSize)
        };

        console.log(`[GridSystem] Updated for level: ${terrainComponent.level} (tileMapSize: ${newTileMapSize})`);
    }

    
    // OPTIMIZED: Fast world bounds check
    isInWorldBounds(worldX, worldZ) {
        return worldX >= this.worldBounds.minX && worldX <= this.worldBounds.maxX &&
               worldZ >= this.worldBounds.minZ && worldZ <= this.worldBounds.maxZ;
    }

    onSceneUnload() {
        // Clean up debug visualization
        if (this.debugVisualization) {
            while (this.debugVisualization.children.length > 0) {
                const mesh = this.debugVisualization.children[0];
                this.debugVisualization.remove(mesh);
            }
            if (this.game.uiScene) {
                this.game.uiScene.remove(this.debugVisualization);
            }
            this.debugVisualization = null;
        }

        // Dispose debug materials
        if (this.debugMaterials) {
            Object.values(this.debugMaterials).forEach(material => material.dispose());
            this.debugMaterials = null;
        }
        if (this.debugGeometry) {
            this.debugGeometry.dispose();
            this.debugGeometry = null;
        }

        // Clean up grid visualization
        if (this.gridVisualization) {
            if (this.game.scene) {
                this.game.scene.remove(this.gridVisualization);
            }
            this.gridVisualization.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.gridVisualization = null;
        }

        // Clear state
        this.state.clear();
        this._entityPositions.clear();
        this.debugMeshes.clear();
        this.debugEnabled = false;

        console.log('[GridSystem] Scene unloaded - resources cleaned up');
    }

    /**
     * Initialize debug visualization for spatial grid
     */
    initDebugVisualization() {
        if (this.game.isServer) return;

        if (!this.game.uiScene) {
            console.warn('[GridSystem] No uiScene available for debug visualization');
            return;
        }

        // Create debug group
        this.debugVisualization = new THREE.Group();
        this.debugVisualization.name = 'SpatialGridDebug';
        this.debugVisualization.visible = true;
        this.game.uiScene.add(this.debugVisualization);

        // Create shared geometry and materials
        const cellSize = this.cellSize * 0.9;
        this.debugGeometry = new THREE.PlaneGeometry(cellSize, cellSize);
        this.debugGeometry.rotateX(-Math.PI / 2);

        this.debugMaterials = {
            player: new THREE.MeshBasicMaterial({
                color: 0x00ff00, // Green for player units
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            }),
            enemy: new THREE.MeshBasicMaterial({
                color: 0xff0000, // Red for enemy units
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            }),
            mixed: new THREE.MeshBasicMaterial({
                color: 0xffff00, // Yellow for mixed
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            }),
            neutral: new THREE.MeshBasicMaterial({
                color: 0x0088ff, // Blue for neutral/buildings
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            })
        };

        console.log('[GridSystem] Debug visualization initialized');
    }

    /**
     * Update debug visualization to show current spatial grid state
     */
    updateDebugVisualization() {
        if (!this.debugVisualization) return;

        // Clear old meshes
        while (this.debugVisualization.children.length > 0) {
            const mesh = this.debugVisualization.children[0];
            this.debugVisualization.remove(mesh);
            mesh.geometry?.dispose();
        }

        // Create meshes for occupied cells
        for (const [key, cellState] of this.state.entries()) {
            if (!cellState.entities || cellState.entities.length === 0) continue;

            const cell = this._keyToCell(key);
            const worldPos = this.gridToWorld(cell.x, cell.z);

            // Determine cell color based on team composition
            let material = this.debugMaterials.neutral;
            let hasPlayer = false;
            let hasEnemy = false;

            for (const entityId of cellState.entities) {
                const team = this.game.getComponent(entityId, 'team');
                if (team) {
                    // Team values are 'left' and 'right'
                    if (team.team === 'left') hasPlayer = true;
                    else if (team.team === 'right') hasEnemy = true;
                }
            }

            if (hasPlayer && hasEnemy) {
                material = this.debugMaterials.mixed;
            } else if (hasPlayer) {
                material = this.debugMaterials.player;
            } else if (hasEnemy) {
                material = this.debugMaterials.enemy;
            }

            const mesh = new THREE.Mesh(this.debugGeometry, material);
            const terrainHeight = this.game.call('getTerrainHeightAtPosition', worldPos.x, worldPos.z) || 0;
            mesh.position.set(worldPos.x, terrainHeight + 1, worldPos.z);
            this.debugVisualization.add(mesh);
        }
    }

    /**
     * Toggle debug visualization on/off
     */
    toggleDebugVisualization() {
        console.log('[GridSystem] toggleSpatialGridDebug called');

        if (!this.debugVisualization) {
            if (!this.game.isServer && this.game.uiScene) {
                this.initDebugVisualization();
            } else {
                console.error('[GridSystem] Cannot initialize - isServer:', this.game.isServer, 'uiScene:', !!this.game.uiScene);
                return;
            }
        }

        this.debugEnabled = !this.debugEnabled;
        this.debugVisualization.visible = this.debugEnabled;

        if (this.debugEnabled) {
            this.updateDebugVisualization();
        }

        // Log current grid state for debugging
        console.log(`[GridSystem] Debug visualization ${this.debugEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`[GridSystem] Current state: ${this.state.size} occupied cells`);

        if (this.debugEnabled) {
            for (const [key, cellState] of this.state.entries()) {
                const cell = this._keyToCell(key);
                const entityNames = cellState.entities.map(id => {
                    const unitType = this.game.getComponent(id, 'unitType');
                    const team = this.game.getComponent(id, 'team');
                    const teamValue = team ? JSON.stringify(team.team) : 'NO_TEAM';
                    return `${unitType?.name || 'unknown'}(team=${teamValue})`;
                });
                console.log(`  Cell (${cell.x},${cell.z}): ${entityNames.join(', ')}`);
            }
        }
    }
}