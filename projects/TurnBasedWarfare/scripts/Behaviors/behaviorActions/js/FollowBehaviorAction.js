/**
 * FollowBehaviorAction - Movement action
 * Follows another entity, maintaining a certain distance
 *
 * Parameters:
 *   targetKey: string (default: 'followTarget') - Key in shared state for target
 *   followDistance: number (default: 50) - Ideal distance to maintain
 *   maxDistance: number (default: 200) - Start following if farther than this
 *   stopDistance: number (default: 30) - Stop following if closer than this
 *
 * Returns RUNNING while following, SUCCESS if at ideal distance, FAILURE if no target
 */
class FollowBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'followTarget';
        const followDistance = params.followDistance || 50;
        const maxDistance = params.maxDistance || 200;
        const stopDistance = params.stopDistance || 30;

        const pos = game.getComponent(entityId, 'position');
        const vel = game.getComponent(entityId, 'velocity');

        if (!pos) {
            return this.failure();
        }

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        if (!targetId) {
            return this.failure();
        }

        const targetPos = game.getComponent(targetId, 'position');
        const targetHealth = game.getComponent(targetId, 'health');

        // Check if target is valid
        if (!targetPos) {
            return this.failure();
        }

        // Check if target is alive (if it has health)
        if (targetHealth && targetHealth.current <= 0) {
            shared[targetKey] = null; // Clear invalid target
            return this.failure();
        }

        const memory = this.getMemory(entityId);
        const distance = this.distance(pos, targetPos);

        // Already at ideal distance
        if (distance >= stopDistance && distance <= followDistance) {
            if (vel) {
                vel.anchored = false;
            }
            delete memory.targetPosition;
            return this.success({
                status: 'inPosition',
                distance,
                target: targetId
            });
        }

        // Too close, back up slightly (or just stop)
        if (distance < stopDistance) {
            if (vel) {
                vel.anchored = true;
                vel.vx = 0;
                vel.vz = 0;
            }
            delete memory.targetPosition;
            return this.success({
                status: 'tooClose',
                distance,
                target: targetId
            });
        }

        // Too far, need to follow
        if (distance > followDistance) {
            // Calculate position at followDistance from target
            const dx = pos.x - targetPos.x;
            const dz = pos.z - targetPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 1;

            // Target a point followDistance away from the target
            const targetX = targetPos.x + (dx / dist) * followDistance;
            const targetZ = targetPos.z + (dz / dist) * followDistance;

            memory.targetPosition = { x: targetX, z: targetZ };

            if (vel) {
                vel.anchored = false;
            }

            return this.running({
                status: 'following',
                targetPosition: memory.targetPosition,
                distance,
                target: targetId
            });
        }

        return this.success({ status: 'inPosition', distance, target: targetId });
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
