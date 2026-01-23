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

    static serviceDependencies = [
        'getMinerQueuePosition',
        'addMinerToQueue',
        'processNextMinerInQueue'
    ];

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
            const queuePos = this.call.getMinerQueuePosition( targetMine, entityId);
            if (goldMine.currentMiner === entityId || queuePos >= 0) {
                 return this.success({ targetMine: targetMine });
            }
        }

        // Add to queue
        const added = this.call.addMinerToQueue( targetMine, entityId);
        if (!added) {
            return this.failure();
        }

        // If mine is unoccupied and we're first in queue, process queue to become current miner
        const goldMineAfter = game.getComponent(targetMine, 'goldMine');
        if (goldMineAfter && goldMineAfter.currentMiner === null && goldMineAfter.minerQueue[0] === entityId) {
            this.call.processNextMinerInQueue( targetMine);
        }

        return this.success({
            targetMine: targetMine
        });
    }

 
}
