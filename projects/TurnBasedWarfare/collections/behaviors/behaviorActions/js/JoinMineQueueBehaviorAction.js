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

        console.log(`[JoinMineQueue] entity=${entityId} targetMine=${targetMine}`);

        // targetMine is -1 when not set
        if (targetMine === undefined || targetMine === null || targetMine < 0) {
            console.log(`[JoinMineQueue] entity=${entityId} FAILURE: invalid targetMine`);
            return this.failure();
        }

        const goldMine = game.getComponent(targetMine, 'goldMine');

        if (goldMine) {
            // Check if already current miner or in queue
            const queuePos = game.call('getMinerQueuePosition', targetMine, entityId);
            console.log(`[JoinMineQueue] entity=${entityId} currentMiner=${goldMine.currentMiner} (type=${typeof goldMine.currentMiner}) queuePos=${queuePos}`);
            if (goldMine.currentMiner === entityId || queuePos >= 0) {
                console.log(`[JoinMineQueue] entity=${entityId} SUCCESS: already current miner or in queue`);
                return this.success({ targetMine: targetMine });
            }
        }
        console.log(`[JoinMineQueue] entity=${entityId} adding to queue...`);
        game.call('addMinerToQueue', targetMine, entityId);
        return this.success({
            targetMine: targetMine
        });
    }

 
}
