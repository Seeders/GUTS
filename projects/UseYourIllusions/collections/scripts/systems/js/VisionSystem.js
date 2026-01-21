class VisionSystem extends GUTS.BaseSystem {
    static services = [
        'hasLineOfSight',
        'canSeePosition',
        'getVisibleEnemiesInRange',
        'findNearestVisibleEnemy',
        'findWeakestVisibleEnemy',
        'isEntityVisibleToTeam'
    ];

    constructor(game) {
        super(game);
        this.game.visionSystem = this;

        // Default unit height for line of sight calculations
        this.DEFAULT_UNIT_HEIGHT = 25;

        // Pre-allocated bresenham line array to avoid per-call allocation
        this._bresenhamTiles = [];
        this._maxBresenhamLength = 100;
        for (let i = 0; i < this._maxBresenhamLength; i++) {
            this._bresenhamTiles.push({ x: 0, z: 0 });
        }

        // Pre-allocated sectors array for _filterByLOS to avoid per-call allocation
        this._sectors = [];
        this._visibleEnemies = [];
        for (let i = 0; i < 16; i++) {
            this._sectors.push({ enemies: [], maxDistance: 0, visibleDistance: 0 });
        }
    }

    init() {
        // Cache direct TypedArray references for hot path optimization
        this._posXArray = null;
        this._posYArray = null;
        this._posZArray = null;
        this._teamArray = null;
        this._healthCurrentArray = null;
        this._healthMaxArray = null;
    }

    /**
     * Ensure cached field arrays are initialized (lazy init)
     */
    _ensureFieldArrays() {
        if (!this._posXArray) {
            this._posXArray = this.game.getFieldArray('transform', 'position.x');
            this._posYArray = this.game.getFieldArray('transform', 'position.y');
            this._posZArray = this.game.getFieldArray('transform', 'position.z');
            this._teamArray = this.game.getFieldArray('team', 'team');
            this._healthCurrentArray = this.game.getFieldArray('health', 'current');
            this._healthMaxArray = this.game.getFieldArray('health', 'max');
        }
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

    _getGridSize() {
        return this.game.call('getGridSize');
    }

    _getTerrainSize() {
        return this.game.call('getTerrainSize');
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

        // Check worldObjects (trees, etc.) blocking vision
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

        // Check illusions blocking vision (guards can't see through illusions)
        const illusionIds = this.game.illusionSystem?.getActiveIllusions();
        if (illusionIds && illusionIds.length > 0) {
            const collections = this.game.getCollections();
            const numSamples = Math.max(2, Math.ceil(distance / (gridSize * 0.5)));
            const stepX = dx / numSamples;
            const stepZ = dz / numSamples;

            for (let i = 1; i < numSamples; i++) {
                const t = i / numSamples;
                const sampleX = from.x + stepX * i;
                const sampleZ = from.z + stepZ * i;
                const rayHeight = fromEyeHeight + (toEyeHeight - fromEyeHeight) * t;

                for (const illusionId of illusionIds) {
                    const illusionTransform = this.game.getComponent(illusionId, 'transform');
                    const illusionPos = illusionTransform?.position;
                    if (!illusionPos) continue;

                    const illusion = this.game.getComponent(illusionId, 'illusion');
                    if (!illusion?.sourcePrefab) continue;

                    // Get the source object's data
                    const prefabData = collections.worldObjects?.[illusion.sourcePrefab];
                    if (!prefabData) continue;

                    // Only block vision if the source object would block vision (has size and height)
                    // Size can be a number (radius) or object with x/z (tile dimensions)
                    const illusionSize = typeof prefabData.size === 'number' ? prefabData.size : (prefabData.size?.x || 1) * gridSize;
                    const illusionHeight = prefabData.height || 0;

                    // Skip if illusion has no height (can't block vision)
                    if (illusionHeight <= 0) continue;

                    const illusionDx = sampleX - illusionPos.x;
                    const illusionDz = sampleZ - illusionPos.z;
                    const distSq = illusionDx * illusionDx + illusionDz * illusionDz;

                    if (distSq < illusionSize * illusionSize) {
                        if (rayHeight < illusionPos.y + illusionHeight) {
                            log.trace('Vision', `${viewerName} LOS check: BLOCKED (illusion)`, {
                                from: { x: from.x?.toFixed(0), z: from.z?.toFixed(0) },
                                to: { x: to.x?.toFixed(0), z: to.z?.toFixed(0) },
                                illusionPos: { x: illusionPos.x.toFixed(0), z: illusionPos.z.toFixed(0) }
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


    /**
     * Calculate total stealth for a target entity (base + terrain + hiding bonuses)
     * @private
     */
    _calculateTargetStealth(targetId) {
        const targetCombat = this.game.getComponent(targetId, 'combat');
        let stealth = targetCombat?.stealth ?? 0;

        const targetTransform = this.game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;
        if (targetPos) {
            // Terrain stealth bonus
            const terrainTypeIndex = this.game.call('getTerrainTypeAtPosition', targetPos.x, targetPos.z);
            if (terrainTypeIndex !== null && terrainTypeIndex !== undefined) {
                const terrainType = this.game.call('getTileMapTerrainType', terrainTypeIndex);
                if (terrainType?.stealthBonus) {
                    stealth += terrainType.stealthBonus;
                }
            }

            // Hiding stealth bonus (+30)
            const targetPlayerOrder = this.game.getComponent(targetId, 'playerOrder');
            if (targetPlayerOrder?.isHiding) {
                stealth += 30;
            }
        }

        return stealth;
    }

    /**
     * Get all visible enemies within range of an entity
     * Handles: spatial lookup, team filtering, health check, death state, stealth/awareness, range checking
     * @param {number} entityId - The entity looking for enemies
     * @param {number} range - The search range
     * @returns {number[]} - Array of visible enemy entity IDs
     */
    getVisibleEnemiesInRange(entityId, range) {
        // Ensure field arrays are ready
        this._ensureFieldArrays();

        const posXArr = this._posXArray;
        const posZArr = this._posZArray;
        const teamArr = this._teamArray;
        const healthCurrentArr = this._healthCurrentArray;

        // Get entity data directly from arrays
        const myPosX = posXArr[entityId];
        const myPosZ = posZArr[entityId];
        const myTeam = teamArr ? teamArr[entityId] : undefined;

        if (myPosX === undefined || myTeam === undefined) return [];

        const pos = { x: myPosX, y: 0, z: myPosZ };

        // Get viewer's awareness (default 50) - still need proxy for this less frequent access
        const combat = this.game.getComponent(entityId, 'combat');
        const awareness = combat?.awareness ?? 50;

        // Search with extended range to find all potential targets
        const nearbyEntityIds = this.game.call('getNearbyUnits', pos, range, entityId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return [];

        const enums = this.game.getEnums();
        const aliveState = enums.deathState?.alive ?? 0;
        const enemies = [];

        // Get deathState array for fast checks
        const deathStateArr = this.game.getFieldArray('deathState', 'state');

        for (const targetId of nearbyEntityIds) {
            // HOT PATH: Direct array access for common checks
            // Team check - must be enemy
            const targetTeam = teamArr ? teamArr[targetId] : undefined;
            if (targetTeam === undefined || targetTeam === myTeam) continue;

            // Health check - must be alive
            const targetHealthCurrent = healthCurrentArr ? healthCurrentArr[targetId] : undefined;
            if (targetHealthCurrent === undefined || targetHealthCurrent <= 0) continue;

            // Death state check - must not be dying/dead
            if (deathStateArr) {
                const targetDeathState = deathStateArr[targetId];
                if (targetDeathState !== undefined && targetDeathState !== aliveState) continue;
            }

            // Stealth check (still uses getComponent internally - less frequent)
            const targetStealth = this._calculateTargetStealth(targetId);
            if (targetStealth > awareness) continue;

            enemies.push(targetId);
        }

        return enemies;
    }

    /**
     * Build enemy list with positions and distances from visible enemy IDs
     * @private
     */
    _buildEnemyList(entityId, visibleEnemyIds, includeHealth = false, maxHealthPercent = 1.0) {
        // Ensure field arrays are ready
        this._ensureFieldArrays();

        const posXArr = this._posXArray;
        const posZArr = this._posZArray;
        const healthCurrentArr = this._healthCurrentArray;
        const healthMaxArr = this._healthMaxArray;

        // Get entity position directly
        const myPosX = posXArr[entityId];
        const myPosZ = posZArr[entityId];
        if (myPosX === undefined) return { pos: null, enemies: [] };

        const pos = { x: myPosX, z: myPosZ };
        const enemies = [];

        for (const targetId of visibleEnemyIds) {
            // HOT PATH: Direct array access instead of getComponent
            const targetPosX = posXArr[targetId];
            const targetPosZ = posZArr[targetId];
            if (targetPosX === undefined) continue;

            const dx = targetPosX - myPosX;
            const dz = targetPosZ - myPosZ;
            const distance = Math.sqrt(dx * dx + dz * dz);

            const enemy = { id: targetId, pos: { x: targetPosX, z: targetPosZ }, distance, dx, dz };

            if (includeHealth) {
                const healthCurrent = healthCurrentArr ? healthCurrentArr[targetId] : undefined;
                const healthMax = healthMaxArr ? healthMaxArr[targetId] : undefined;
                if (healthCurrent === undefined || healthMax === undefined || healthMax <= 0) continue;
                enemy.healthPercent = healthCurrent / healthMax;
                enemy.healthCurrent = healthCurrent;
                if (enemy.healthPercent > maxHealthPercent) continue;
            }

            enemies.push(enemy);
        }

        return { pos, enemies };
    }

    /**
     * Filter enemies by line of sight using sector-based raycasting
     * @private
     */
    _filterByLOS(entityId, pos, enemies) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

        const NUM_SECTORS = 16;
        const sectorAngle = (Math.PI * 2) / NUM_SECTORS;

        // Reuse pre-allocated sectors array - clear previous data
        for (let i = 0; i < NUM_SECTORS; i++) {
            this._sectors[i].enemies.length = 0;
            this._sectors[i].maxDistance = 0;
            this._sectors[i].visibleDistance = 0;
        }

        for (const enemy of enemies) {
            const angle = Math.atan2(enemy.dz, enemy.dx);
            const normalizedAngle = angle < 0 ? angle + Math.PI * 2 : angle;
            const sectorIndex = Math.floor(normalizedAngle / sectorAngle) % NUM_SECTORS;

            this._sectors[sectorIndex].enemies.push(enemy);
            if (enemy.distance > this._sectors[sectorIndex].maxDistance) {
                this._sectors[sectorIndex].maxDistance = enemy.distance;
            }
        }

        // Raycast for each sector
        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = this._sectors[i];
            if (sector.enemies.length === 0) continue;

            const sectorCenterAngle = (i + 0.5) * sectorAngle;
            const dirX = Math.cos(sectorCenterAngle);
            const dirZ = Math.sin(sectorCenterAngle);
            const rayDist = sector.maxDistance;

            const targetX = pos.x + dirX * rayDist;
            const targetZ = pos.z + dirZ * rayDist;

            if (this.hasLineOfSight({ x: pos.x, z: pos.z }, { x: targetX, z: targetZ }, unitType, entityId)) {
                sector.visibleDistance = rayDist;
            } else {
                // Binary search to find visible distance
                let minDist = 0;
                let maxDist = rayDist;
                for (let iter = 0; iter < 4; iter++) {
                    const midDist = (minDist + maxDist) / 2;
                    const midX = pos.x + dirX * midDist;
                    const midZ = pos.z + dirZ * midDist;
                    if (this.hasLineOfSight({ x: pos.x, z: pos.z }, { x: midX, z: midZ }, unitType, entityId)) {
                        minDist = midDist;
                    } else {
                        maxDist = midDist;
                    }
                }
                sector.visibleDistance = minDist;
            }
        }

        // Collect visible enemies - reuse array
        this._visibleEnemies.length = 0;
        for (let i = 0; i < NUM_SECTORS; i++) {
            const sector = this._sectors[i];
            for (const enemy of sector.enemies) {
                if (enemy.distance <= sector.visibleDistance) {
                    this._visibleEnemies.push(enemy);
                }
            }
        }

        return this._visibleEnemies;
    }

    /**
     * Find the nearest visible enemy, with LOS checking
     * @param {number} entityId - The entity looking for enemies
     * @param {number} range - The search range
     * @returns {object|null} - { id, distance } or null if no enemy found
     */
    findNearestVisibleEnemy(entityId, range) {
        const visibleEnemyIds = this.getVisibleEnemiesInRange(entityId, range);
        if (!visibleEnemyIds || visibleEnemyIds.length === 0) return null;

        const { pos, enemies } = this._buildEnemyList(entityId, visibleEnemyIds);
        if (!pos || enemies.length === 0) return null;

        const visibleEnemies = this._filterByLOS(entityId, pos, enemies);
        if (visibleEnemies.length === 0) return null;

        visibleEnemies.sort((a, b) => a.distance - b.distance);
        return { id: visibleEnemies[0].id, distance: visibleEnemies[0].distance };
    }

    /**
     * Check if an entity is visible to a specific team
     * Used by RenderSystem to hide units that can't be seen by the player
     * Returns true if ANY unit on the viewing team can see the target entity
     * @param {number} entityId - The entity to check visibility for
     * @param {number} viewingTeam - The team trying to see the entity
     * @returns {boolean} - Whether the entity is visible to the team
     */
    isEntityVisibleToTeam(entityId, viewingTeam) {
        const targetTeam = this.game.getComponent(entityId, 'team');

        // If entity has no team, it's visible (neutral/decorative)
        if (!targetTeam) return true;

        // Entities on the same team are always visible to themselves
        if (targetTeam.team === viewingTeam) return true;

        // Get target entity position and stealth
        const targetTransform = this.game.getComponent(entityId, 'transform');
        const targetPos = targetTransform?.position;
        if (!targetPos) return false;

        // Calculate total stealth for the target
        const targetStealth = this._calculateTargetStealth(entityId);

        // If target has no stealth, it's visible to enemies
        if (targetStealth <= 0) return true;

        // Check if ANY unit on the viewing team can see this entity
        // Find all units on the viewing team
        const viewingTeamEntities = this.game.getEntitiesWith('team', 'transform', 'combat');

        for (const viewerId of viewingTeamEntities) {
            const viewerTeam = this.game.getComponent(viewerId, 'team');
            if (viewerTeam?.team !== viewingTeam) continue;

            // Check if this viewer can see the target
            const viewerCombat = this.game.getComponent(viewerId, 'combat');
            const viewerAwareness = viewerCombat?.awareness ?? 50;

            // If viewer's awareness >= target's stealth, target is visible
            if (viewerAwareness >= targetStealth) {
                // Also check if within vision range
                const viewerTransform = this.game.getComponent(viewerId, 'transform');
                const viewerPos = viewerTransform?.position;
                if (!viewerPos) continue;

                const viewerUnitTypeComp = this.game.getComponent(viewerId, 'unitType');
                const viewerUnitType = this.game.call('getUnitTypeDef', viewerUnitTypeComp);
                const visionRange = viewerUnitType?.visionRange || 500;

                const dx = targetPos.x - viewerPos.x;
                const dz = targetPos.z - viewerPos.z;
                const distSq = dx * dx + dz * dz;

                if (distSq <= visionRange * visionRange) {
                    return true;
                }
            }
        }

        // No unit on the viewing team can see this entity
        return false;
    }

    /**
     * Find the weakest visible enemy (lowest health), with LOS checking
     * @param {number} entityId - The entity looking for enemies
     * @param {number} range - The search range
     * @param {object} options - { usePercentage: true, maxHealthPercent: 1.0 }
     * @returns {object|null} - { id, distance, healthPercent } or null if no enemy found
     */
    findWeakestVisibleEnemy(entityId, range, options = {}) {
        const usePercentage = options.usePercentage !== false;
        const maxHealthPercent = options.maxHealthPercent ?? 1.0;

        const visibleEnemyIds = this.getVisibleEnemiesInRange(entityId, range);
        if (!visibleEnemyIds || visibleEnemyIds.length === 0) return null;

        const { pos, enemies } = this._buildEnemyList(entityId, visibleEnemyIds, true, maxHealthPercent);
        if (!pos || enemies.length === 0) return null;

        const visibleEnemies = this._filterByLOS(entityId, pos, enemies);
        if (visibleEnemies.length === 0) return null;

        visibleEnemies.sort((a, b) => {
            const healthDiff = usePercentage
                ? a.healthPercent - b.healthPercent
                : a.healthCurrent - b.healthCurrent;
            if (Math.abs(healthDiff) > 0.01) return healthDiff;
            return a.distance - b.distance;
        });

        return {
            id: visibleEnemies[0].id,
            distance: visibleEnemies[0].distance,
            healthPercent: visibleEnemies[0].healthPercent
        };
    }
}
