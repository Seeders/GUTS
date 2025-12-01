/**
 * FleeBehaviorAction - Movement action
 * Runs away from the nearest threat
 *
 * Parameters:
 *   fleeDistance: number (default: 200) - How far to flee
 *   threatRange: number (default: 150) - Range to detect threats
 *   targetKey: string (default: 'threat') - Key in shared for specific threat to flee from
 *
 * Returns RUNNING while fleeing, SUCCESS when safe, FAILURE if no threats
 */
class FleeBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const fleeDistance = params.fleeDistance || 200;
        const threatRange = params.threatRange || 150;
        const targetKey = params.targetKey || 'threat';

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const vel = game.getComponent(entityId, 'velocity');

        if (!pos || !team) {
            return this.failure();
        }

        const memory = this.getMemory(entityId);
        const shared = this.getShared(entityId, game);

        // Find threat to flee from
        let threatId = shared[targetKey];
        let threatPos = null;

        if (threatId) {
            const threatTransform = game.getComponent(threatId, 'transform');
            threatPos = threatTransform?.position;
            const threatHealth = game.getComponent(threatId, 'health');
            if (!threatPos || !threatHealth || threatHealth.current <= 0) {
                threatId = null;
            }
        }

        // If no specific threat, find nearest enemy
        if (!threatId) {
            const nearestEnemy = this.findNearestEnemy(entityId, game, pos, team, threatRange);
            if (nearestEnemy) {
                threatId = nearestEnemy.id;
                const nearestTransform = game.getComponent(threatId, 'transform');
                threatPos = nearestTransform?.position;
            }
        }

        // No threats nearby - we're safe
        if (!threatId || !threatPos) {
            if (vel) vel.anchored = false;
            return this.success({ status: 'safe', noThreatsFound: true });
        }

        const distanceToThreat = this.distance(pos, threatPos);

        // Already far enough away
        if (distanceToThreat >= fleeDistance) {
            if (vel) vel.anchored = false;
            return this.success({ status: 'safe', distanceToThreat });
        }

        // Calculate flee direction (away from threat)
        const dx = pos.x - threatPos.x;
        const dz = pos.z - threatPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;

        // Target position is away from threat
        const targetX = pos.x + (dx / dist) * fleeDistance;
        const targetZ = pos.z + (dz / dist) * fleeDistance;

        memory.fleeState = 'fleeing';
        memory.targetPosition = { x: targetX, z: targetZ };
        memory.threat = threatId;

        return this.running({
            targetPosition: memory.targetPosition,
            threat: threatId,
            distanceToThreat,
            fleeDistance
        });
    }

    findNearestEnemy(entityId, game, pos, team, range) {
        const potentialTargets = game.getEntitiesWith('transform', 'team', 'health');
        let nearest = null;
        let nearestDistance = Infinity;

        for (const targetId of potentialTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            if (targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            const distance = this.distance(pos, targetPos);

            if (distance <= range && distance < nearestDistance) {
                nearestDistance = distance;
                nearest = { id: targetId, distance };
            }
        }

        return nearest;
    }

    onEnd(entityId, game) {
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) vel.anchored = false;
        this.clearMemory(entityId);
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
