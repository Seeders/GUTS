/**
 * Wait For Mine Action
 * Waits until it's the entity's turn to mine at the gold mine
 *
 * Reads from shared state:
 *   - targetMine: entityId of the gold mine
 *
 * Sets in shared state:
 *   - canMine: true when it's our turn
 *
 * Returns:
 *   - SUCCESS if it's our turn to mine (we're current miner or next in queue and mine is free)
 *   - RUNNING if still waiting in queue
 *   - FAILURE if no targetMine or goldMineSystem unavailable
 */
class WaitForMineBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const targetMine = shared.targetMine;

        if (!targetMine) {
            return this.failure();
        }

        const goldMine = game.getComponent(targetMine, 'goldMine');
        if (!goldMine) {
            return this.failure();
        }

        // Check if we're the current miner
        const isCurrentMiner = goldMine.currentMiner === entityId;

        // Check if we're next in queue and mine is free
        const isNextInQueue = game.call('isNextInMinerQueue', targetMine, entityId);
        const isMineOccupied = game.call('isMineOccupied', targetMine);

        if (isCurrentMiner || (isNextInQueue && !isMineOccupied)) {
            // It's our turn!
            if (!isCurrentMiner) {
                // Process queue to become current miner
                game.call('processNextMinerInQueue', targetMine);
            }

            shared.canMine = true;

            // Snap to mine position for precise mining
            const minePos = shared.targetMinePosition;
            if (minePos) {
                const transform = game.getComponent(entityId, 'transform');
                const pos = transform?.position;
                const vel = game.getComponent(entityId, 'velocity');
                if (pos) {
                    pos.x = minePos.x;
                    pos.z = minePos.z;
                }
                if (vel) {
                    vel.vx = 0;
                    vel.vz = 0;
                }
            }

            return this.success({
                isCurrentMiner: true,
                targetMine: targetMine
            });
        }

        // Still waiting
        shared.canMine = false;

        return this.running({
            waiting: true,
            isNextInQueue: isNextInQueue,
            isMineOccupied: isMineOccupied
        });
    }
}
