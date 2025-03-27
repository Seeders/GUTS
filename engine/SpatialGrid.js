 
    class SpatialGrid {
        constructor(worldSize, cellSize) {
            this.cellSize = cellSize;
            this.cols = worldSize;
            this.rows = worldSize;
            this.grid = new Array(this.cols * this.rows).fill().map(() => []);
            
            // Track which cell each entity is in
            this.entityCells = new Map(); // Map of entity -> cell index
        }
        
        getIndex(x, y) {
            return y * this.cols + x;
        }

        insert(entity) {
            const newIndex = this.getIndex(entity.gridPosition.x, entity.gridPosition.y);
            const oldIndex = this.entityCells.get(entity);
            
            // If entity moved to a new cell
            if (oldIndex !== newIndex) {
                // Remove from old cell if it exists
                if (oldIndex !== undefined) {
                    const oldCell = this.grid[oldIndex];
                    const entityIndex = oldCell.indexOf(entity);
                    if (entityIndex !== -1) {
                        oldCell.splice(entityIndex, 1);
                    }
                }
                
                // Add to new cell
                if (newIndex >= 0 && newIndex < this.grid.length) {
                    this.grid[newIndex].push(entity);
                    this.entityCells.set(entity, newIndex);
                }
            }
        }
        
        remove(entity) {
            const index = this.entityCells.get(entity);
            if (index !== undefined) {
                const cell = this.grid[index];
                const entityIndex = cell.indexOf(entity);
                if (entityIndex !== -1) {
                    cell.splice(entityIndex, 1);
                }
                this.entityCells.delete(entity);
            }
        }
        getNearbyEntities(x, y, radius) {
            const nearby = [];
            // Get cells that could contain entities within radius
            const startX = Math.max(0, Math.floor((x - radius)));
            const endX = Math.min(this.cols - 1, Math.floor((x + radius)));
            const startY = Math.max(0, Math.floor((y - radius)));
            const endY = Math.min(this.rows - 1, Math.floor((y + radius)));
       
            // Collect potential candidates from relevant cells
            for (let row = startY; row <= endY; row++) {
                for (let col = startX; col <= endX; col++) {
                    const index = row * this.cols + col;
                    if (index >= 0 && index < this.grid.length) {
                        for (let entity of this.grid[index]) {
                            const dx = entity.gridPosition.x - x;
                            const dy = entity.gridPosition.y - y;
                            const distSquared = dx * dx + dy * dy;
                            
                            if (distSquared <= radius * radius) {
                                let healthComp = entity.getComponent('health');
                                if (healthComp) {
                                    nearby.push(entity);
                                }
                            }                            
                        }
                    }
                }
            }
            
            return nearby;
        }
        clear() {
            this.grid = this.grid.map(() => []);
            this.entityCells.clear();
        }
        
        // Optional: Only clear but maintain all entity positions
        // Useful for when reusing the same grid across updates
        resetKeepingEntities() {
            const allEntities = [];
            this.entityCells.forEach((_, entity) => {
                allEntities.push(entity);
            });
            
            this.clear();
            
            allEntities.forEach(entity => {
                this.insert(entity);
            });
        }
    }

    export { SpatialGrid };