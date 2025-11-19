class VisionSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.visionSystem = this;

        // Default unit height for line of sight calculations
        this.DEFAULT_UNIT_HEIGHT = 25;
    }

    init() {
        this.game.gameManager.register('hasLineOfSight', this.hasLineOfSight.bind(this));
    }


    hasLineOfSight(from, to, unitType, viewerEntityId = null) {
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const distanceSq = dx * dx + dz * dz;
        const distance = Math.sqrt(distanceSq);
        const gridSize = this.game.getCollections().configs.game.gridSize;

        if (distance < gridSize*2) return true;

        const terrainSystem = this.game.terrainSystem;
        if (!terrainSystem) {
            console.warn('[hasLineOfSight] No terrain system found!');
            return true;
        }

        // Get discrete heightmap levels for from and to positions
        const fromGridX = Math.floor((from.x + terrainSystem.terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSystem.terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSystem.terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSystem.terrainSize / 2) / gridSize);

        const fromHeightLevel = terrainSystem.getHeightLevelAtGridPosition(fromGridX, fromGridZ);
        const toHeightLevel = terrainSystem.getHeightLevelAtGridPosition(toGridX, toGridZ);

        // Cannot see up to tiles with higher heightmap values
        if (toHeightLevel > fromHeightLevel) {
            return false;
        }

        const fromTerrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(from.x, from.z);
        const toTerrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(to.x, to.z);

        // Use unit height from unitType, or fall back to default if not available
        const unitHeight = (unitType && unitType.height) ? unitType.height : this.DEFAULT_UNIT_HEIGHT;

        const fromEyeHeight = fromTerrainHeight + unitHeight;
        const toEyeHeight = toTerrainHeight + unitHeight;

        // Check for terrain blocking along the path (for same-level or downward vision)
        if (!this.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel)) {
            return false;
        }
        
        let nearbyTrees = [];

        const midX = (from.x + to.x) / 2;
        const midZ = (from.z + to.z) / 2;
        const unitSize = (unitType && unitType.size) ? unitType.size : gridSize;
        nearbyTrees = this.game.gameManager.call('getNearbyUnits', { x: midX, y: 0, z: midZ} , distance / 2 + unitSize, viewerEntityId, 'worldObjects');


        if (nearbyTrees.length > 0) {
            const numSamples = Math.max(2, Math.ceil(distance / (gridSize * 0.5)));
            const stepX = dx / numSamples;
            const stepZ = dz / numSamples;
            
            for (let i = 1; i < numSamples; i++) {
                const t = i / numSamples;
                const sampleX = from.x + stepX * i;
                const sampleZ = from.z + stepZ * i;
                const rayHeight = fromEyeHeight + (toEyeHeight - fromEyeHeight) * t;
                
                for (const unit of nearbyTrees) {                    
                    const dx = sampleX - unit.x;
                    const dz = sampleZ - unit.z;
                    const distSq = dx * dx + dz * dz;
                    if(!unit.size) unit.size = gridSize;
                    if (distSq < unit.size * unit.size) {            
                        if (rayHeight < unit.y+unit.height) {
                            return false;
                        }
                    }
                }
            }
        }
        
        return true;
    }

    checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel) {
        const terrainSystem = this.game.terrainSystem;
        const gridSize = this.game.getCollections().configs.game.gridSize;

        const fromGridX = Math.floor((from.x + terrainSystem.terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSystem.terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSystem.terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSystem.terrainSize / 2) / gridSize);

        const tiles = this.bresenhamLine(fromGridX, fromGridZ, toGridX, toGridZ);

        // Check intermediate tiles along the path
        for (let i = 1; i < tiles.length - 1; i++) {
            const tile = tiles[i];

            // Check if this intermediate tile has a higher heightmap level than the viewer
            const tileHeightLevel = terrainSystem.getHeightLevelAtGridPosition(tile.x, tile.z);
            if (tileHeightLevel > fromHeightLevel) {
                // Cannot see through a tile with higher elevation
                return false;
            }

            // Also check if the ray goes below the terrain at this point (for smooth terrain variations)
            const t = i / (tiles.length - 1);
            const worldX = tile.x * gridSize - terrainSystem.terrainSize / 2;
            const worldZ = tile.z * gridSize - terrainSystem.terrainSize / 2;
            const rayHeight = fromEyeHeight + (toTerrainHeight - fromEyeHeight) * t;
            const terrainHeight = terrainSystem.getTerrainHeightAtPositionSmooth(worldX, worldZ);

            if (rayHeight <= terrainHeight) {
                return false;
            }
        }

        return true;
    }

    bresenhamLine(x0, z0, x1, z1) {
        const tiles = [];
        
        const dx = Math.abs(x1 - x0);
        const dz = Math.abs(z1 - z0);
        const sx = x0 < x1 ? 1 : -1;
        const sz = z0 < z1 ? 1 : -1;
        let err = dx - dz;
        
        let x = x0;
        let z = z0;
        
        while (true) {
            tiles.push({ x, z });
            
            if (x === x1 && z === z1) break;
            
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
        
        return tiles;
    }
}