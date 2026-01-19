/**
 * PickUpObjectBehaviorAction - Moves to and picks up (destroys) a desirable object
 *
 * Parameters:
 *   pickupRange: number (default: 30) - Distance at which to pick up the object
 *   waitTimeAfterPickup: number (default: 3) - Seconds to wait at pickup location
 *
 * Uses shared.desirableTarget set by FindDesirableObjectBehaviorAction
 * Returns RUNNING while moving or waiting, SUCCESS when wait complete, FAILURE if no target
 */
class PickUpObjectBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const pickupRange = params.pickupRange || 30;
        const waitTimeAfterPickup = params.waitTimeAfterPickup || 3;

        // Get memory for tracking wait state
        const memory = this.getMemory(entityId) || {};

        // Check if we're waiting after picking up an object
        if (memory.waitingAfterPickup) {
            const waitDuration = game.state.now - memory.pickupTime;

            if (waitDuration >= waitTimeAfterPickup) {
                // Wait complete - clear memory and return success
                console.log(`[PickUpObjectBehaviorAction] Guard ${entityId} finished waiting after pickup`);
                memory.waitingAfterPickup = false;
                memory.pickupTime = null;
                // Memory is modified in place (getMemory returns a mutable reference)
                return this.success({
                    pickedUp: true,
                    waitComplete: true
                });
            }

            // Still waiting - stop movement
            const shared = this.getShared(entityId, game);
            shared.targetPosition = null;

            return this.running({
                state: 'waiting',
                timeRemaining: waitTimeAfterPickup - waitDuration
            });
        }

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
            console.log(`[PickUpObjectBehaviorAction] Guard ${entityId} picked up object ${targetId}, waiting ${waitTimeAfterPickup}s`);

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

            // Start waiting - set memory to track wait state
            memory.waitingAfterPickup = true;
            memory.pickupTime = game.state.now;
            // Memory is modified in place (getMemory returns a mutable reference)

            // Stop movement while waiting
            shared.targetPosition = null;

            return this.running({
                state: 'waiting',
                timeRemaining: waitTimeAfterPickup
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
