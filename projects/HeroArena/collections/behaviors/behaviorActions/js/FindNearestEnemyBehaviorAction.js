/**
 * FindNearestEnemyBehaviorAction - Targeting action
 * Mechabellum-style target selection: picks the enemy with the lowest
 * TIME-TO-ENGAGE and stores it in shared state.
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

    // Mechabellum re-checks for a better target roughly every 2 seconds while
    // a unit is still APPROACHING (not yet in attack range).
    static RETARGET_INTERVAL = 2;

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const combat = game.getComponent(entityId, 'combat');
        const range = combat?.visionRange || params.range || 300;
        const atkRange = combat?.range || 0;

        const myTransform = game.getComponent(entityId, 'transform');
        const myPos = myTransform?.position;

        // Mechabellum targeting model:
        // 1) ENGAGED lock — current target alive and inside ATTACK range:
        //    never retarget until attacker or defender dies.
        // 2) APPROACHING — keep the current pick between rechecks, but
        //    re-evaluate the field every RETARGET_INTERVAL seconds.
        // 3) Fresh pick — lowest TIME-TO-ENGAGE wins (see scan below).
        const shared = this.getShared(entityId, game);

        // Taunt overrides targeting outright: a taunted unit drops what it's
        // doing and hunts the taunter (AttackEnemyBehaviorAction also enforces
        // this at swing time — this makes the unit CHASE the taunter too,
        // instead of only swapping targets once the taunter is in range).
        const tauntTarget = game.buffEffectsSystem?.getTauntForcedTarget?.(entityId);
        if (tauntTarget != null && myPos) {
            const tpos = game.getComponent(tauntTarget, 'transform')?.position;
            if (tpos) {
                shared[targetKey] = tauntTarget;
                const tdx = tpos.x - myPos.x, tdz = tpos.z - myPos.z;
                return this.success({
                    target: tauntTarget,
                    distance: Math.sqrt(tdx * tdx + tdz * tdz),
                    range
                });
            }
        }

        const current = shared[targetKey];
        if (current != null && game.entityAlive?.[current] === 1 && myPos) {
            const chp = game.getComponent(current, 'health');
            const cpos = game.getComponent(current, 'transform')?.position;
            if (chp && chp.current > 0 && cpos) {
                const ddx = cpos.x - myPos.x, ddz = cpos.z - myPos.z;
                const d2 = ddx * ddx + ddz * ddz;
                // Same payload shape as a fresh find — downstream nodes
                // read distance/range off the result.
                if (d2 <= atkRange * atkRange) {
                    return this.success({ target: current, distance: Math.sqrt(d2), range });
                }
                if (!this._retargetAt) this._retargetAt = new Map();
                if (d2 <= range * range * 1.44 &&
                    game.state.now < (this._retargetAt.get(entityId) || 0)) {
                    return this.success({ target: current, distance: Math.sqrt(d2), range });
                }
            }
        }
        // A scan that found NOTHING isn't repeated for 0.3s — marching
        // armies were burning most of the tick budget re-scanning nothing.
        if (!this._noEnemyUntil) this._noEnemyUntil = new Map();
        const nextAllowed = this._noEnemyUntil.get(entityId);
        if (nextAllowed !== undefined && game.state.now < nextAllowed) {
            return this.failure();
        }

        const enemyIds = this.call.getVisibleEnemiesInRange( entityId, range);

        // Buildings and units are EQUAL targets — no type preference. The pick
        // is the lowest TIME-TO-ENGAGE, Mechabellum-style: turn time (angle to
        // face the candidate / turnSpeed) plus travel time (distance beyond
        // attack range / move speed). A slow-turning unit walks at the tower
        // ahead of it instead of wheeling around for a closer enemy behind it.
        // Vision is FINITE (fog of war) and the terrain LOS filter keeps
        // targeting consistent with what the fog shows. Deterministic pick:
        // strict-less score, then distance, then entity-id tiebreak (lockstep).
        let bestId = null;
        let bestScore = Infinity;
        let bestDistSq = Infinity;
        const myDef = game.getUnitTypeDef(game.getComponent(entityId, 'unitType'));
        if (myPos && enemyIds) {
            // Def flags OR the tech-granted flag (Skyward Pikes sets
            // heroRosterInfo.canTargetAir — the def alone misses it).
            const canHitAir = !!(myDef?.canTargetAir || myDef?.isFlying ||
                game.getComponent(entityId, 'heroRosterInfo')?.canTargetAir);
            const vel = game.getComponent(entityId, 'velocity');
            const anchored = !!vel?.anchored;
            const moveSpeed = anchored ? 0 : (vel?.maxSpeed || 0);
            // Anchored units (towers) fire in any direction — no turn cost.
            const turnSpeed = anchored ? 0 : (combat?.turnSpeed || 10);
            const myFacing = myTransform?.rotation?.y || 0;
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
                const dist = Math.sqrt(distSq);
                const travel = Math.max(0, dist - atkRange);
                // Immobile attacker can never close the gap — unreachable.
                if (travel > 0 && moveSpeed <= 0) continue;
                const travelTime = travel > 0 ? travel / moveSpeed : 0;
                let turnTime = 0;
                if (turnSpeed > 0) {
                    let ang = Math.atan2(dz, dx) - myFacing;
                    while (ang > Math.PI) ang -= 2 * Math.PI;
                    while (ang < -Math.PI) ang += 2 * Math.PI;
                    turnTime = Math.abs(ang) / turnSpeed;
                }
                const score = travelTime + turnTime;
                if (score < bestScore ||
                    (score === bestScore && (distSq < bestDistSq ||
                        (distSq === bestDistSq && (bestId == null || eid < bestId))))) {
                    bestScore = score;
                    bestDistSq = distSq;
                    bestId = eid;
                }
            }
        }

        const po = game.getComponent(entityId, 'playerOrder');

        // A COMPLETED move order anchors the unit at its destination: it only
        // engages enemies within vision of the ORDERED SPOT. Without this, each
        // chase leg re-measures vision from the unit's drifting position and a
        // defender ratchets across the map one fight at a time.
        if (bestId != null && po?.enabled && po.isMoveOrder && po.completed) {
            const pos = game.getComponent(bestId, 'transform')?.position;
            if (pos) {
                const ax = pos.x - po.targetPositionX;
                const az = pos.z - po.targetPositionZ;
                if (ax * ax + az * az > range * range) {
                    bestId = null;
                }
            }
        }

        if (bestId != null) {
            shared[targetKey] = bestId;
            if (!this._retargetAt) this._retargetAt = new Map();
            this._retargetAt.set(entityId,
                game.state.now + FindNearestEnemyBehaviorAction.RETARGET_INTERVAL);

            const distance = Math.sqrt(bestDistSq);
            log.debug('FindNearestEnemy', `Entity ${entityId} FOUND enemy`, {
                targetId: bestId,
                distance: distance.toFixed(0),
                timeToEngage: bestScore.toFixed(2)
            });

            return this.success({ target: bestId, distance, range });
        }

        this._noEnemyUntil.set(entityId, game.state.now + 0.3);
        return this.failure();
    }
}
