/**
 * Join Mine Queue Action
 * Adds the entity to the mining queue for the target gold mine
 *
 * Reads from shared state:
 *   - targetMine: entityId of the gold mine to queue at
 *
 * Sets in shared state:
 *   - inMineQueue: true
 *
 * Returns:
 *   - SUCCESS if successfully joined queue (or already in queue)
 *   - FAILURE if no targetMine in shared state or goldMineSystem unavailable
 */
class JoinMineQueueBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const targetMine = shared.targetMine;

        if (!targetMine) {
            return this.failure();
        }

        // Check if goldMineSystem is available
        if (!game.goldMineSystem) {
            console.warn('JoinMineQueueBehaviorAction: goldMineSystem not available');
            return this.failure();
        }

        // Check if already in queue
        if (shared.inMineQueue) {
            return this.success({ alreadyInQueue: true });
        }

        // Add to queue
        game.goldMineSystem.addMinerToQueue(targetMine, entityId);
        shared.inMineQueue = true;

        return this.success({
            targetMine: targetMine,
            joinedQueue: true
        });
    }

    onEnd(entityId, game) {
        // Clean up shared state
        const shared = this.getShared(entityId, game);
        shared.inMineQueue = false;
        super.onEnd(entityId, game);
    }
}
