/**
 * Move To Shared Target Action
 * Moves entity toward a target position stored in shared state
 *
 * Reads from shared state:
 *   - targetPosition: {x, z} position to move to
 *   OR uses targetKey parameter to read from a different shared key
 *
 * Parameters:
 *   - targetKey: string - Shared state key for target position (default: 'targetPosition')
 *   - arrivalRange: number - Distance considered "arrived" (default: 25)
 *   - stopOnArrival: boolean - Stop velocity when arrived (default: true)
 *
 * Returns:
 *   - SUCCESS when within arrivalRange of target
 *   - RUNNING while moving
 *   - FAILURE if no target position
 */
class MoveToSharedTargetBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'clearEntityPath'
    ];

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const targetKey = this.parameters.targetKey || 'targetPosition';
        const arrivalRange = this.parameters.arrivalRange || 25;
        const stopOnArrival = this.parameters.stopOnArrival !== false;

        const targetPosition = shared[targetKey];

        if (!targetPosition) {
            return this.failure();
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) {
            return this.failure();
        }

        const distance = this.distance(pos, targetPosition);

        if (distance <= arrivalRange) {
            // Arrived at target
            if (stopOnArrival) {
                const vel = game.getComponent(entityId, 'velocity');
                if (vel) {
                    vel.vx = 0;
                    vel.vz = 0;
                }
            }

            // Clear targetPosition from shared state to stop pathfinding requests
            shared.targetPosition = null;

            // Clear the path so a new one can be requested for the next destination
            this.call.clearEntityPath( entityId);

            // Reset pathfinding state
            const pathfinding = game.getComponent(entityId, 'pathfinding');
            if (pathfinding) {
                pathfinding.pathIndex = 0;
                pathfinding.lastPathRequest = 0;
            }

            return this.success({
                arrived: true,
                distance: distance
            });
        }

        // Still moving - return running with target for MovementSystem
        return this.running({
            targetPosition: targetPosition,
            distance: distance,
            moving: true
        });
    }
}

