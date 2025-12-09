/**
 * FilterVisibleEnemiesBehaviorAction - Visibility filtering action
 * Takes a list of nearby enemy positions and filters to only those visible via line of sight.
 *
 * This action efficiently batch-raycasts to determine which enemies are actually visible,
 * accounting for terrain height, trees, and other obstacles.
 *
 * Parameters:
 *   sourceKey: string (default: 'nearbyEnemies') - Key in shared state for enemy list [{id, distance, position}]
 *   targetKey: string (default: 'visibleEnemies') - Key to store filtered visible enemies
 *   alsoSetTarget: boolean (default: true) - Also set 'target' to nearest visible enemy
 *
 * Returns SUCCESS if at least one visible enemy found, FAILURE otherwise
 */
class FilterVisibleEnemiesBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const sourceKey = params.sourceKey || 'nearbyEnemies';
        const targetKey = params.targetKey || 'visibleEnemies';
        const alsoSetTarget = params.alsoSetTarget !== false;

        const shared = this.getShared(entityId, game);
        const nearbyEnemies = shared[sourceKey];

        if (!nearbyEnemies || nearbyEnemies.length === 0) {
            return this.failure();
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const unitType = game.getComponent(entityId, 'unitType');

        if (!pos) {
            return this.failure();
        }

        // Filter enemies by line of sight
        const visibleEnemies = this.filterByLineOfSight(entityId, game, pos, unitType, nearbyEnemies);

        if (visibleEnemies.length === 0) {
            return this.failure();
        }

        // Store results
        shared[targetKey] = visibleEnemies;

        if (alsoSetTarget) {
            // Set nearest visible enemy as target (list is already sorted by distance)
            shared.target = visibleEnemies[0].id;
        }

        return this.success({
            visibleCount: visibleEnemies.length,
            nearestVisible: visibleEnemies[0].id,
            nearestDistance: visibleEnemies[0].distance
        });
    }

    filterByLineOfSight(entityId, game, unitPos, unitType, enemies) {
        // Check if hasLineOfSight is available
        if (!game.hasService('hasLineOfSight')) {
            // No LOS system - return all enemies as visible
            return enemies;
        }

        const visible = [];

        // Group enemies by direction (angle sector) to optimize raycasting
        // We'll raycast once per unique direction and cache results
        const gridSize = game.call('getGridSize') || 32;
        const terrainSize = game.call('getTerrainSize') || 1024;

        // Track which tiles we've already checked visibility for
        const checkedTiles = new Map(); // "tileX_tileZ" -> boolean (visible)

        for (const enemy of enemies) {
            const enemyPos = enemy.position;
            if (!enemyPos) {
                // Try to get position from entity if not cached
                const enemyTransform = game.getComponent(enemy.id, 'transform');
                if (!enemyTransform?.position) continue;
                enemy.position = enemyTransform.position;
            }

            // Convert enemy position to tile for caching
            const tileX = Math.floor((enemy.position.x + terrainSize / 2) / gridSize);
            const tileZ = Math.floor((enemy.position.z + terrainSize / 2) / gridSize);
            const tileKey = `${tileX}_${tileZ}`;

            // Check if we've already determined visibility for this tile
            if (checkedTiles.has(tileKey)) {
                if (checkedTiles.get(tileKey)) {
                    visible.push(enemy);
                }
                continue;
            }

            // Perform LOS check
            const hasLOS = game.call('hasLineOfSight',
                { x: unitPos.x, z: unitPos.z },
                { x: enemy.position.x, z: enemy.position.z },
                unitType,
                entityId
            );

            // Cache result for this tile
            checkedTiles.set(tileKey, hasLOS);

            if (hasLOS) {
                visible.push(enemy);
            }
        }

        return visible;
    }
}
