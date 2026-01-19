/**
 * WaitBehaviorAction - Utility action
 * Waits for a specified duration before succeeding
 *
 * Parameters:
 *   duration: number (default: 1000) - Wait time in milliseconds
 *   durationKey: string (optional) - Key in shared state for dynamic duration
 *   anchor: boolean (default: true) - Anchor entity while waiting
 *
 * Returns RUNNING while waiting, SUCCESS when done
 */
class WaitBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const anchor = params.anchor !== false;
        const durationKey = params.durationKey;

        // Get duration from params or shared state
        let duration = params.duration !== undefined ? params.duration : 1000;
        if (durationKey) {
            const shared = this.getShared(entityId, game);
            if (shared[durationKey] !== undefined) {
                duration = shared[durationKey];
            }
        }

        const memory = this.getMemory(entityId);
        const now = game.state?.now || Date.now();

        // Initialize wait start time
        if (memory.waitStartTime === undefined) {
            memory.waitStartTime = now;
            memory.waitDuration = duration;
        }

        const elapsed = now - memory.waitStartTime;
        const remaining = memory.waitDuration - elapsed;

        // Anchor entity while waiting
        if (anchor) {
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) {
                vel.anchored = true;
                vel.vx = 0;
                vel.vz = 0;
            }
        }

        // Still waiting
        if (remaining > 0) {
            return this.running({
                status: 'waiting',
                elapsed,
                remaining,
                duration: memory.waitDuration,
                progress: elapsed / memory.waitDuration
            });
        }

        // Wait complete
        return this.success({
            status: 'complete',
            duration: memory.waitDuration,
            actualElapsed: elapsed
        });
    }

    onEnd(entityId, game) {
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) vel.anchored = false;
        this.clearMemory(entityId);
    }
}

