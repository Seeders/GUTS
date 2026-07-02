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

    static serviceDependencies = [];

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
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.getUnitTypeDef( unitTypeComp);

        if (!pos) {
            return this.failure();
        }

        // Filter enemies by line of sight
        const visibleEnemies = this.filterByLineOfSight(entityId, game, pos, unitType, nearbyEnemies);

        if (visibleEnemies.length === 0) {
            return this.failure();
        }

        // Store plain snapshots — shared state is persisted behavior data and
        // must not hold live component/position references.
        shared[targetKey] = visibleEnemies.map(e => ({
            id: e.id,
            distance: e.distance,
            position: e.position ? { x: e.position.x, y: e.position.y, z: e.position.z } : null
        }));

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
        // HeroArena: open arena — never filter out enemies by terrain line-of-sight,
        // so every unit engages each round (see FindNearestEnemyBehaviorAction). The
        // input list is already sorted by distance, so [0] remains the nearest.
        return enemies;
    }
}
