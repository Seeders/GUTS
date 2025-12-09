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

        if (!targetMine) {
            return this.failure();
        }


        const goldMine = game.getComponent(targetMine, 'goldMine');
        if (goldMine && (goldMine.minerQueue.includes(entityId) || goldMine.currentMiner === entityId)) {
            return this.success({ 
                targetMine: targetMine
            });
        }    
        game.call('addMinerToQueue', targetMine, entityId);
        return this.success({
            targetMine: targetMine
        });
    }

 
}
