class VisionSystem extends GUTS.BaseSystem {
    static services = [
        'hasLineOfSight',
        'canSeePosition'
    ];

    constructor(game) {
        super(game);
        this.game.visionSystem = this;

        // Default unit height for line of sight calculations
        this.DEFAULT_UNIT_HEIGHT = 25;

        // Cached values - populated on first use
        this._gridSize = null;
        this._terrainSize = null;

        // Pre-allocated bresenham line array to avoid per-call allocation
        this._bresenhamTiles = [];
        this._maxBresenhamLength = 100;
        for (let i = 0; i < this._maxBresenhamLength; i++) {
            this._bresenhamTiles.push({ x: 0, z: 0 });
        }
    }

    init() {
    }

    /**
     * Fast visibility check - only checks height levels, not obstacles
     * Use this for targeting checks where full LOS is too expensive
     * Returns false if target is on a higher elevation (e.g., up a cliff)
     * @param {Object} from - Source position {x, z}
     * @param {Object} to - Target position {x, z}
     * @returns {boolean} - Can the source see the target based on elevation
     */
    canSeePosition(from, to) {
        const gridSize = this._getGridSize();
        const terrainSize = this._getTerrainSize();

        // Convert world positions to grid coordinates
        const fromGridX = Math.floor((from.x + terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSize / 2) / gridSize);

        // Get height levels for both positions
        const fromHeightLevel = this.game.call("getHeightLevelAtGridPosition", fromGridX, fromGridZ);
        const toHeightLevel = this.game.call("getHeightLevelAtGridPosition", toGridX, toGridZ);

        // Cannot see up to tiles with higher heightmap values (e.g., up a cliff)
        return toHeightLevel <= fromHeightLevel;
    }

    /**
     * Get cached grid size (only fetches once)
     */
    _getGridSize() {
        if (this._gridSize === null) {
            this._gridSize = this.game.call('getGridSize');
        }
        return this._gridSize;
    }

    /**
     * Get cached terrain size (only fetches once)
     */
    _getTerrainSize() {
        if (this._terrainSize === null) {
            this._terrainSize = this.game.call('getTerrainSize');
        }
        return this._terrainSize;
    }


    hasLineOfSight(from, to, unitType, viewerEntityId = null) {
        const log = GUTS.HeadlessLogger;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const distanceSq = dx * dx + dz * dz;
        const distance = Math.sqrt(distanceSq);
        const gridSize = this._getGridSize();
        const terrainSize = this._getTerrainSize();

        // Get viewer info for logging
        let viewerName = 'unknown';
        if (viewerEntityId !== null) {
            const viewerUnitTypeComp = this.game.getComponent(viewerEntityId, 'unitType');
            const viewerUnitType = this.game.call('getUnitTypeDef', viewerUnitTypeComp);
            viewerName = viewerUnitType?.id || viewerEntityId;
        }

        if (distance < gridSize*2) {
            log.trace('Vision', `${viewerName} LOS check: PASS (too close)`, {
                from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
                to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
                distance: distance.toFixed(0)
            });
            return true;
        }

        // Get discrete heightmap levels for from and to positions
        const fromGridX = Math.floor((from.x + terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSize / 2) / gridSize);

        const fromHeightLevel = this.game.call("getHeightLevelAtGridPosition", fromGridX, fromGridZ);
        const toHeightLevel = this.game.call("getHeightLevelAtGridPosition", toGridX, toGridZ);

        // If height data is not available (e.g., headless mode without full terrain),
        // assume flat terrain and allow LOS
        if (fromHeightLevel === null || fromHeightLevel === undefined) {
            return true;
        }

        // Cannot see up to tiles with higher heightmap values
        if (toHeightLevel !== null && toHeightLevel > fromHeightLevel) {
            log.trace('Vision', `${viewerName} LOS check: BLOCKED (height)`, {
                from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
                to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
                fromHeightLevel,
                toHeightLevel
            });
            return false;
        }

        const fromTerrainHeight = this.game.call("getTerrainHeightAtPositionSmooth", from.x, from.z);
        const toTerrainHeight = this.game.call("getTerrainHeightAtPositionSmooth", to.x, to.z);

        // Use unit height from unitType, or fall back to default if not available
        const unitHeight = (unitType && unitType.height) ? unitType.height : this.DEFAULT_UNIT_HEIGHT;

        const fromEyeHeight = fromTerrainHeight + unitHeight;
        const toEyeHeight = toTerrainHeight + unitHeight;

        // Check for terrain blocking along the path (for same-level or downward vision)
        if (!this.checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel)) {
            log.trace('Vision', `${viewerName} LOS check: BLOCKED (terrain)`, {
                from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
                to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
                distance: distance.toFixed(0)
            });
            return false;
        }
        
        const midX = (from.x + to.x) / 2;
        const midZ = (from.z + to.z) / 2;
        const unitSize = (unitType && unitType.size) ? unitType.size : gridSize;
        const nearbyTreeIds = this.game.call('getNearbyUnits', { x: midX, y: 0, z: midZ}, distance / 2 + unitSize, viewerEntityId, 'worldObjects');

        if (nearbyTreeIds && nearbyTreeIds.length > 0) {
            const numSamples = Math.max(2, Math.ceil(distance / (gridSize * 0.5)));
            const stepX = dx / numSamples;
            const stepZ = dz / numSamples;

            for (let i = 1; i < numSamples; i++) {
                const t = i / numSamples;
                const sampleX = from.x + stepX * i;
                const sampleZ = from.z + stepZ * i;
                const rayHeight = fromEyeHeight + (toEyeHeight - fromEyeHeight) * t;

                for (const treeId of nearbyTreeIds) {
                    const treeTransform = this.game.getComponent(treeId, 'transform');
                    const treePos = treeTransform?.position;
                    if (!treePos) continue;

                    const treeUnitTypeComp = this.game.getComponent(treeId, 'unitType');
                    const treeUnitType = this.game.call('getUnitTypeDef', treeUnitTypeComp);
                    const treeSize = treeUnitType?.size || gridSize;
                    const treeHeight = treeUnitType?.height || 0;

                    const treeDx = sampleX - treePos.x;
                    const treeDz = sampleZ - treePos.z;
                    const distSq = treeDx * treeDx + treeDz * treeDz;

                    if (distSq < treeSize * treeSize) {
                        if (rayHeight < treePos.y + treeHeight) {
                            log.trace('Vision', `${viewerName} LOS check: BLOCKED (tree)`, {
                                from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
                                to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
                                treePos: { x: treePos.x.toFixed(0), z: treePos.z.toFixed(0) }
                            });
                            return false;
                        }
                    }
                }
            }
        }

        log.trace('Vision', `${viewerName} LOS check: PASS`, {
            from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
            to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
            distance: distance.toFixed(0)
        });
        return true;
    }

    checkTileBasedLOS(from, to, fromEyeHeight, toTerrainHeight, fromHeightLevel) {
        const terrainSize = this._getTerrainSize();
        const gridSize = this._getGridSize();

        const fromGridX = Math.floor((from.x + terrainSize / 2) / gridSize);
        const fromGridZ = Math.floor((from.z + terrainSize / 2) / gridSize);
        const toGridX = Math.floor((to.x + terrainSize / 2) / gridSize);
        const toGridZ = Math.floor((to.z + terrainSize / 2) / gridSize);

        const tileCount = this.bresenhamLine(fromGridX, fromGridZ, toGridX, toGridZ);

        // Check intermediate tiles along the path
        for (let i = 1; i < tileCount - 1; i++) {
            const tile = this._bresenhamTiles[i];

            // Check if this intermediate tile has a higher heightmap level than the viewer
            const tileHeightLevel = this.game.call('getHeightLevelAtGridPosition', tile.x, tile.z);
            // Only block LOS if we have valid height data and the tile is higher
            if (tileHeightLevel !== null && tileHeightLevel !== undefined &&
                tileHeightLevel > fromHeightLevel) {
                return false;
            }

            // Also check if the ray goes below the terrain at this point (for smooth terrain variations)
            const t = i / (tileCount - 1);
            const worldX = tile.x * gridSize - terrainSize / 2;
            const worldZ = tile.z * gridSize - terrainSize / 2;
            const rayHeight = fromEyeHeight + (toTerrainHeight - fromEyeHeight) * t;
            const terrainHeight = this.game.call('getTerrainHeightAtPositionSmooth', worldX, worldZ);

            if (rayHeight <= terrainHeight) {
                return false;
            }
        }

        return true;
    }

    /**
     * Bresenham line using pre-allocated array - returns count of tiles
     */
    bresenhamLine(x0, z0, x1, z1) {
        const dx = Math.abs(x1 - x0);
        const dz = Math.abs(z1 - z0);
        const sx = x0 < x1 ? 1 : -1;
        const sz = z0 < z1 ? 1 : -1;
        let err = dx - dz;

        let x = x0;
        let z = z0;
        let count = 0;

        while (count < this._maxBresenhamLength) {
            this._bresenhamTiles[count].x = x;
            this._bresenhamTiles[count].z = z;
            count++;

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

        return count;
    }

    onSceneUnload() {
        // Clear cached values
        this._gridSize = null;
        this._terrainSize = null;

    }
}
