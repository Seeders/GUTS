/**
 * PickUpObjectBehaviorAction - Moves to and picks up (destroys) a desirable object
 *
 * Parameters:
 *   pickupRange: number (default: 30) - Distance at which to pick up the object
 *
 * Uses shared.desirableTarget set by FindDesirableObjectBehaviorAction
 * Returns RUNNING while moving, SUCCESS when picked up, FAILURE if no target
 */
class PickUpObjectBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const pickupRange = params.pickupRange || 30;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) {
            return this.failure();
        }

        // Get the target from shared state
        const shared = this.getShared(entityId, game);
        const targetId = shared.desirableTarget;

        if (targetId === null || targetId === undefined) {
            return this.failure();
        }

        // Check if target still exists
        if (!game.hasEntity(targetId)) {
            shared.desirableTarget = null;
            return this.failure();
        }

        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;
        if (!targetPos) {
            shared.desirableTarget = null;
            return this.failure();
        }

        // Calculate distance to target
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Check if in pickup range
        if (distance <= pickupRange) {
            // Pick up (destroy) the object
            console.log(`[PickUpObjectBehaviorAction] Guard ${entityId} picked up object ${targetId}`);

            // Trigger event before destroying
            game.triggerEvent('onObjectPickedUp', {
                entityId: entityId,
                objectId: targetId,
                position: { x: targetPos.x, y: targetPos.y, z: targetPos.z }
            });

            // Destroy the object
            game.destroyEntity(targetId);

            // Clear the target
            shared.desirableTarget = null;

            return this.success({
                pickedUp: true,
                objectId: targetId
            });
        }

        // Not in range yet - set movement target in shared state for MovementSystem
        shared.targetPosition = { x: targetPos.x, z: targetPos.z };

        return this.running({
            state: 'moving',
            targetPosition: shared.targetPosition,
            distance: distance
        });
    }

    onEnd(entityId, game) {
        this.clearMemory(entityId);
    }
}
