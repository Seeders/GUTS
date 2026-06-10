/**
 * FindNearestEnemyBehaviorAction - Targeting action
 * Finds the nearest enemy and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 *
 * HeroArena note: this is an open-arena autobattler — every unit must engage each
 * round rather than stand idle. We therefore pick the nearest enemy in vision range
 * DIRECTLY and deliberately skip VisionSystem's terrain line-of-sight filtering
 * (findNearestVisibleEnemy → _filterByLOS), which can block targeting across baked
 * level height differences and leave units doing nothing.
 */
class FindNearestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getVisibleEnemiesInRange'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const combat = game.getComponent(entityId, 'combat');
        const range = combat?.visionRange || params.range || 300;

        const myPos = game.getComponent(entityId, 'transform')?.position;
        const enemyIds = this.call.getVisibleEnemiesInRange( entityId, range);

        // Enemy UNITS are always preferred; buildings are engaged only when no
        // enemy unit is in vision (the post-fight siege — the win condition is
        // the enemy Town Hall). Strict-less + entity-id tiebreaks keep both
        // picks deterministic (lockstep) regardless of spatial-grid order.
        let nearestUnit = null,     nearestUnitDistSq = Infinity;
        let nearestBuilding = null, nearestBuildingDistSq = Infinity;
        if (myPos && enemyIds) {
            for (const eid of enemyIds) {
                const pos = game.getComponent(eid, 'transform')?.position;
                if (!pos) continue;
                const dx = pos.x - myPos.x;
                const dz = pos.z - myPos.z;
                const distSq = dx * dx + dz * dz;
                if (game.getComponent(eid, 'buildingOwner')) {
                    if (distSq < nearestBuildingDistSq ||
                        (distSq === nearestBuildingDistSq && (nearestBuilding == null || eid < nearestBuilding))) {
                        nearestBuildingDistSq = distSq;
                        nearestBuilding = eid;
                    }
                } else if (distSq < nearestUnitDistSq ||
                    (distSq === nearestUnitDistSq && (nearestUnit == null || eid < nearestUnit))) {
                    nearestUnitDistSq = distSq;
                    nearestUnit = eid;
                }
            }
        }

        let nearestId = nearestUnit ?? nearestBuilding;
        let nearestDistSq = nearestUnit != null ? nearestUnitDistSq : nearestBuildingDistSq;

        // Nothing in vision at all: fall back to the nearest living enemy building
        // anywhere on the map, so a victorious army marches on the enemy base
        // instead of idling once the opposing army is wiped.
        if (nearestId == null && myPos &&
            game.state.phase === game.getEnums().gamePhase.battle) {
            const found = this._nearestEnemyBuildingGlobal(entityId, game, myPos);
            if (found) {
                nearestId = found.id;
                nearestDistSq = found.distSq;
            }
        }

        if (nearestId != null) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = nearestId;

            const distance = Math.sqrt(nearestDistSq);
            log.debug('FindNearestEnemy', `Entity ${entityId} FOUND enemy`, {
                targetId: nearestId,
                distance: distance.toFixed(0)
            });

            return this.success({ target: nearestId, distance, range });
        }

        return this.failure();
    }

    // Deterministic map-wide scan for the closest living enemy building.
    // Building counts are small (~10/side), so the linear scan is cheap.
    _nearestEnemyBuildingGlobal(entityId, game, myPos) {
        const enums = game.getEnums();
        const neutral = enums.team?.neutral ?? 0;
        const aliveState = enums.deathState?.alive ?? 0;
        const myTeam = game.getComponent(entityId, 'team')?.team;
        if (myTeam === undefined || myTeam === neutral) return null;

        let best = null;
        let bestDistSq = Infinity;
        for (const eid of game.getEntitiesWith('buildingOwner')) {
            const team = game.getComponent(eid, 'team');
            if (!team || team.team === myTeam || team.team === neutral) continue;
            const health = game.getComponent(eid, 'health');
            if (!health || health.current <= 0) continue;
            const ds = game.getComponent(eid, 'deathState');
            if (ds && ds.state !== aliveState) continue;
            const pos = game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            const dx = pos.x - myPos.x;
            const dz = pos.z - myPos.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < bestDistSq || (distSq === bestDistSq && (best == null || eid < best))) {
                bestDistSq = distSq;
                best = eid;
            }
        }
        return best != null ? { id: best, distSq: bestDistSq } : null;
    }
}
