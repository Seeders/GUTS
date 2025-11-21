class VisionSystem extends GUTS.BaseSystem {
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
        const gridSize = this.game.gameManager.call('getGridSize');

        if (distance < gridSize*2) return true;

        const terrainSize = this.game.gameManager.call("getTerrainSize");
        // Get discrete heightmap levels for from and to positions
        const fromGridX = Math.floor((from.x + terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSize / 2) / gridSize);

        const fromHeightLevel = this.game.gameManager.call("getHeightLevelAtGridPosition", fromGridX, fromGridZ);
        const toHeightLevel = this.game.gameManager.call("getHeightLevelAtGridPosition", toGridX, toGridZ);

        // Cannot see up to tiles with higher heightmap values
        if (toHeightLevel > fromHeightLevel) {
            return false;
        }

        const fromTerrainHeight = this.game.gameManager.call("getTerrainHeightAtPositionSmooth", from.x, from.z);
        const toTerrainHeight = this.game.gameManager.call("getTerrainHeightAtPositionSmooth", to.x, to.z);

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
        const terrainSize = this.game.gameManager.call("getTerrainSize");
        const gridSize = this.game.gameManager.call('getGridSize');

        const fromGridX = Math.floor((from.x + terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSize / 2) / gridSize);

        const tiles = this.bresenhamLine(fromGridX, fromGridZ, toGridX, toGridZ);

        // Check intermediate tiles along the path
        for (let i = 1; i < tiles.length - 1; i++) {
            const tile = tiles[i];

            // Check if this intermediate tile has a higher heightmap level than the viewer
            const tileHeightLevel = this.game.gameManager.call('getHeightLevelAtGridPosition', tile.x, tile.z);
            if (tileHeightLevel > fromHeightLevel) {
                // Cannot see through a tile with higher elevation
                return false;
            }

            // Also check if the ray goes below the terrain at this point (for smooth terrain variations)
            const t = i / (tiles.length - 1);
            const worldX = tile.x * gridSize - terrainSize / 2;
            const worldZ = tile.z * gridSize - terrainSize / 2;
            const rayHeight = fromEyeHeight + (toTerrainHeight - fromEyeHeight) * t;
            const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPositionSmooth', worldX, worldZ);

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