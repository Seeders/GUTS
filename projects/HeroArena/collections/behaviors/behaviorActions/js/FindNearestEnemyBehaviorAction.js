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
 * HeroArena note: with fog of war active, targeting must MATCH what the fog
 * shows the player — candidates are filtered by terrain line of sight
 * (hasLineOfSight), so units never react to enemies hidden behind cliffs.
 */
class FindNearestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getVisibleEnemiesInRange',
        'hasLineOfSight'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const combat = game.getComponent(entityId, 'combat');
        const range = combat?.visionRange || params.range || 300;

        const myPos = game.getComponent(entityId, 'transform')?.position;
        const enemyIds = this.call.getVisibleEnemiesInRange( entityId, range);

        // Buildings and units are EQUAL targets: the nearest visible enemy wins
        // (a marching army stops to destroy a sentry tower it walks into, then
        // resumes its order — killing the target ends the engagement). Vision
        // is FINITE (fog of war) and the terrain LOS filter keeps targeting
        // consistent with what the fog shows. Strict-less + entity-id tiebreak
        // keeps the pick deterministic (lockstep) regardless of grid order.
        let nearestId = null;
        let nearestDistSq = Infinity;
        const myDef = game.getUnitTypeDef(game.getComponent(entityId, 'unitType'));
        if (myPos && enemyIds) {
            const canHitAir = !!(myDef?.canTargetAir || myDef?.isFlying);
            for (const eid of enemyIds) {
                const pos = game.getComponent(eid, 'transform')?.position;
                if (!pos) continue;
                // Air rule (Mechabellum): flying units can only be attacked by
                // units that can shoot upward — ground melee walks on past.
                if (!canHitAir) {
                    const targetDef = game.getUnitTypeDef(game.getComponent(eid, 'unitType'));
                    if (targetDef?.isFlying) continue;
                }
                // Terrain LOS: enemies behind cliffs are in fog — not targetable.
                if (!this.call.hasLineOfSight(
                    { x: myPos.x, z: myPos.z }, { x: pos.x, z: pos.z }, myDef, entityId)) {
                    continue;
                }
                const dx = pos.x - myPos.x;
                const dz = pos.z - myPos.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < nearestDistSq ||
                    (distSq === nearestDistSq && (nearestId == null || eid < nearestId))) {
                    nearestDistSq = distSq;
                    nearestId = eid;
                }
            }
        }

        const po = game.getComponent(entityId, 'playerOrder');

        // A COMPLETED move order anchors the unit at its destination: it only
        // engages enemies within vision of the ORDERED SPOT. Without this, each
        // chase leg re-measures vision from the unit's drifting position and a
        // defender ratchets across the map one fight at a time.
        if (nearestId != null && po?.enabled && po.isMoveOrder && po.completed) {
            const pos = game.getComponent(nearestId, 'transform')?.position;
            if (pos) {
                const ax = pos.x - po.targetPositionX;
                const az = pos.z - po.targetPositionZ;
                if (ax * ax + az * az > range * range) {
                    nearestId = null;
                }
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
}
