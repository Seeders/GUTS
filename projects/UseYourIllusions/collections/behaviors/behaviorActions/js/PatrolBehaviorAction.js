/**
 * PatrolBehaviorAction - Movement action
 * Moves between waypoints in a patrol pattern
 *
 * Parameters:
 *   waypoints: array (default: []) - Array of {x, z} positions to patrol between
 *   waypointsKey: string (optional) - Key in shared state containing waypoints
 *   waitTime: number (default: 1000) - Time to wait at each waypoint (ms)
 *   loop: boolean (default: true) - Loop back to start or reverse
 *   arrivalDistance: number (default: 20) - Distance to consider "arrived"
 *
 * Returns RUNNING while patrolling, SUCCESS never (continuous), FAILURE if no waypoints
 */
class PatrolBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const waypointsKey = params.waypointsKey;
        const waitTime = params.waitTime !== undefined ? params.waitTime : 1000;
        const loop = params.loop !== false;
        const arrivalDistance = params.arrivalDistance || 20;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) {
            return this.failure();
        }

        // Get shared state for storing targetPosition
        const shared = this.getShared(entityId, game);

        // Get waypoints from params or shared state
        let waypoints = params.waypoints || [];
        if (waypointsKey) {
            waypoints = shared[waypointsKey] || waypoints;
        }

        if (!waypoints || waypoints.length === 0) {
            return this.failure();
        }

        const memory = this.getMemory(entityId);

        // Initialize patrol state
        if (memory.waypointIndex === undefined) {
            memory.waypointIndex = 0;
            memory.direction = 1; // 1 = forward, -1 = backward
            memory.waitingUntil = 0;
            memory.patrolState = 'moving';
            memory.hasMovedOnce = false; // Track if we've ever moved
        }

        const now = game.state?.now || Date.now();
        // Convert waitTime from ms to seconds (game.state.now is in seconds)
        const waitTimeSeconds = waitTime / 1000;

        // Check if we're waiting at a waypoint
        if (memory.patrolState === 'waiting') {
            if (now < memory.waitingUntil) {
                return this.running({
                    state: 'waiting',
                    waypointIndex: memory.waypointIndex,
                    waitingFor: memory.waitingUntil - now
                });
            }
            // Done waiting, move to next waypoint
            memory.patrolState = 'moving';
            this.advanceWaypoint(memory, waypoints.length, loop);
        }

        // Get current target waypoint
        const targetWaypoint = waypoints[memory.waypointIndex];
        if (!targetWaypoint) {
            return this.failure();
        }

        const distance = this.distance(pos, targetWaypoint);

        // Check if arrived at waypoint
        if (distance <= arrivalDistance) {
            // If we haven't moved yet (spawned at waypoint), skip waiting and advance immediately
            if (!memory.hasMovedOnce) {
                this.advanceWaypoint(memory, waypoints.length, loop);
                // Get the new target waypoint after advancing
                const newTargetWaypoint = waypoints[memory.waypointIndex];
                const targetPosition = { x: newTargetWaypoint.x, z: newTargetWaypoint.z };
                shared.targetPosition = targetPosition; // For MovementSystem
                memory.hasMovedOnce = true;
                return this.running({
                    state: 'moving',
                    targetPosition: targetPosition,
                    waypointIndex: memory.waypointIndex,
                    distance: this.distance(pos, newTargetWaypoint)
                });
            }

            if (waitTimeSeconds > 0) {
                memory.patrolState = 'waiting';
                memory.waitingUntil = now + waitTimeSeconds;
                // Clear targetPosition so guard stops moving during wait
                shared.targetPosition = null;
                return this.running({
                    state: 'arrived',
                    waypointIndex: memory.waypointIndex,
                    waitTime: waitTimeSeconds
                });
            } else {
                // No wait time, immediately advance
                this.advanceWaypoint(memory, waypoints.length, loop);
            }
        }

        // Set target position for movement system
        const targetPosition = { x: targetWaypoint.x, z: targetWaypoint.z };
        shared.targetPosition = targetPosition; // For MovementSystem
        memory.hasMovedOnce = true;

        return this.running({
            state: 'moving',
            targetPosition: targetPosition,
            waypointIndex: memory.waypointIndex,
            distance
        });
    }

    advanceWaypoint(memory, waypointCount, loop) {
        if (loop) {
            // Loop back to start
            memory.waypointIndex = (memory.waypointIndex + 1) % waypointCount;
        } else {
            // Ping-pong pattern
            memory.waypointIndex += memory.direction;
            if (memory.waypointIndex >= waypointCount - 1) {
                memory.direction = -1;
                memory.waypointIndex = waypointCount - 1;
            } else if (memory.waypointIndex <= 0) {
                memory.direction = 1;
                memory.waypointIndex = 0;
            }
        }
    }

    onEnd(entityId, game) {
        this.clearMemory(entityId);
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
