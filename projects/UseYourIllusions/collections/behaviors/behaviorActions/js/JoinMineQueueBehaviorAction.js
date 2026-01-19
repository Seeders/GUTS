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
 *   - FAILURE if no targetMine in shared state
 */
class JoinMineQueueBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const targetMine = shared.targetMine;

       
        // targetMine is -1 when not set
        if (targetMine === undefined || targetMine === null || targetMine < 0) {
            return this.failure();
        }

        const goldMine = game.getComponent(targetMine, 'goldMine');

        if (goldMine) {
            // Check if already current miner or in queue
            const queuePos = game.call('getMinerQueuePosition', targetMine, entityId);
            if (goldMine.currentMiner === entityId || queuePos >= 0) {
                 return this.success({ targetMine: targetMine });
            }
        }
        game.call('addMinerToQueue', targetMine, entityId);
        return this.success({
            targetMine: targetMine
        });
    }

 
}
