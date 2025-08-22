class GridSystem {
    constructor(game) {
        this.game = game;
        this.game.gridSystem = this;        
    }
    
    init(terrainSize = 768, cellSize = 48) {
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
        
        this.state = new Map();
        this.gridVisualization = null;
        
        this.playerBounds = {
            minX: 0,
            maxX: Math.floor(this.dimensions.width / 2) - 1,
            minZ: 0,
            maxZ: this.dimensions.height - 1
        };
        
        this.enemyBounds = {
            minX: Math.floor(this.dimensions.width / 2),
            maxX: this.dimensions.width - 1,
            minZ: 0,
            maxZ: this.dimensions.height - 1
        };
    }
    
    createVisualization(scene) {
        if (this.gridVisualization) {
            scene.remove(this.gridVisualization);
        }
        
        const group = new THREE.Group();
        const { width, height, cellSize, startX, startZ } = this.dimensions;
        
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x444444, 
            transparent: true, 
            opacity: 0.3 
        });
        
        // Vertical lines
        for (let x = 0; x <= width; x++) {
            const geometry = new THREE.BufferGeometry();
            const worldX = startX + (x * cellSize);
            const points = [
                new THREE.Vector3(worldX, 1, startZ),
                new THREE.Vector3(worldX, 1, startZ + (height * cellSize))
            ];
            geometry.setFromPoints(points);
            const line = new THREE.Line(geometry, lineMaterial);
            group.add(line);
        }
        
        // Horizontal lines
        for (let z = 0; z <= height; z++) {
            const geometry = new THREE.BufferGeometry();
            const worldZ = startZ + (z * cellSize);
            const points = [
                new THREE.Vector3(startX, 1, worldZ),
                new THREE.Vector3(startX + (width * cellSize), 1, worldZ)
            ];
            geometry.setFromPoints(points);
            const line = new THREE.Line(geometry, lineMaterial);
            group.add(line);
        }
        
        // Center divider line
        const dividerMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff0000, 
            transparent: true, 
            opacity: 0.5 
        });
        const dividerGeometry = new THREE.BufferGeometry();
        const centerX = startX + (width * cellSize / 2);
        const dividerPoints = [
            new THREE.Vector3(centerX, 2, startZ),
            new THREE.Vector3(centerX, 2, startZ + (height * cellSize))
        ];
        dividerGeometry.setFromPoints(dividerPoints);
        const dividerLine = new THREE.Line(dividerGeometry, dividerMaterial);
        group.add(dividerLine);
        
        this.gridVisualization = group;
        scene.add(this.gridVisualization);
    }
    
    worldToGrid(worldX, worldZ) {
        const { cellSize, startX, startZ } = this.dimensions;
        const x = Math.floor((worldX - startX) / cellSize);
        const z = Math.floor((worldZ - startZ) / cellSize);
        return { x, z };
    }
    
    gridToWorld(gridX, gridZ) {
        const { cellSize, startX, startZ } = this.dimensions;
        const x = startX + (gridX * cellSize) + (cellSize / 2);
        const z = startZ + (gridZ * cellSize) + (cellSize / 2);
        return { x, z };
    }
    
    isValidPosition(gridPos) {
        return gridPos.x >= 0 && gridPos.x < this.dimensions.width &&
               gridPos.z >= 0 && gridPos.z < this.dimensions.height;
    }
    
    isValidPlacement(cells, team) {
        const bounds = team === 'player' ? this.playerBounds : this.enemyBounds;
        
        return cells.every(cell => {
            // Check bounds
            if (cell.x < bounds.minX || cell.x > bounds.maxX ||
                cell.z < bounds.minZ || cell.z > bounds.maxZ) {
                return false;
            }
            
            // Check if cell is occupied
            const key = `${cell.x},${cell.z}`;
            const cellState = this.state.get(key);
            return !cellState || !cellState.occupied;
        });
    }
    
    occupyCells(cells, placementId) {
        cells.forEach(cell => {
            const key = `${cell.x},${cell.z}`;
            this.state.set(key, {
                occupied: true,
                placementId: placementId
            });
        });
    }
    
    freeCells(placementId) {
        for (const [key, value] of this.state.entries()) {
            if (value.placementId === placementId) {
                this.state.delete(key);
            }
        }
    }
    
    clear() {
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
        return team === 'player' ? this.playerBounds : this.enemyBounds;
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
            playerBounds: this.playerBounds,
            enemyBounds: this.enemyBounds,
            occupiedCells: this.getOccupiedCells(),
            totalCells: this.dimensions.width * this.dimensions.height,
            occupiedCount: this.state.size
        };
    }
}