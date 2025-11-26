/**
 * PatrolAction - Movement action
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
class PatrolAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const waypointsKey = params.waypointsKey;
        const waitTime = params.waitTime !== undefined ? params.waitTime : 1000;
        const loop = params.loop !== false;
        const arrivalDistance = params.arrivalDistance || 20;

        const pos = game.getComponent(entityId, 'position');
        if (!pos) {
            return this.failure();
        }

        // Get waypoints from params or shared state
        let waypoints = params.waypoints || [];
        if (waypointsKey) {
            const shared = this.getShared(entityId, game);
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
        }

        const now = game.state?.now || Date.now();

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
            if (waitTime > 0) {
                memory.patrolState = 'waiting';
                memory.waitingUntil = now + waitTime;
                return this.running({
                    state: 'arrived',
                    waypointIndex: memory.waypointIndex,
                    waitTime
                });
            } else {
                // No wait time, immediately advance
                this.advanceWaypoint(memory, waypoints.length, loop);
            }
        }

        // Set target position for movement system
        memory.targetPosition = { x: targetWaypoint.x, z: targetWaypoint.z };

        return this.running({
            state: 'moving',
            targetPosition: memory.targetPosition,
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
