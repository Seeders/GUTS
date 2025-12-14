/**
 * Extract Gold Action
 * Performs the actual mining over a duration, extracting gold from the mine
 *
 * Reads from shared state:
 *   - targetMine: entityId of the gold mine
 *
 * Sets in shared state:
 *   - goldAmount: amount of gold being carried
 *   - hasGold: true when carrying gold
 *   - miningProgress: 0-1 progress of current mining
 *
 * Parameters:
 *   - duration: number - Time in seconds to mine (default: 2)
 *   - goldPerTrip: number - Gold extracted per mining cycle (default: 10)
 *
 * Returns:
 *   - SUCCESS when mining is complete
 *   - RUNNING while mining
 *   - FAILURE if no targetMine
 */
class ExtractGoldBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);
        const targetMine = shared.targetMine;

        // targetMine is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetMine === undefined || targetMine === null || targetMine < 0) {
            console.log(`[ExtractGold] Entity ${entityId}: FAILURE - no targetMine (value: ${targetMine})`);
            return this.failure();
        }

        const duration = (this.parameters.duration || 2);
        const goldPerTrip = this.parameters.goldPerTrip || 10;

        console.log(`[ExtractGold] Entity ${entityId}: targetMine=${targetMine}, miningStartTime=${memory.miningStartTime}, now=${game.state.now}`);

        // Initialize mining start time
        if (!memory.miningStartTime) {
            memory.miningStartTime = game.state.now;
        }

        const elapsed = game.state.now - memory.miningStartTime;
        const progress = Math.min(1, elapsed / duration);

        // Update shared state with progress
        shared.miningProgress = progress;
        shared.goldAmount = goldPerTrip * progress;
        shared.hasGold = progress > 0;

        if (elapsed >= duration) {
            // Mining complete!
            shared.goldAmount = goldPerTrip;
            shared.hasGold = true;
            shared.miningProgress = 1;

            // Process next miner in queue
            game.call('processNextMinerInQueue', targetMine);


            // Clear mine-related shared state
            shared.targetMine = null;
            shared.targetMinePosition = null;
            shared.inMineQueue = false;
            shared.canMine = false;

            // Reset memory
            memory.miningStartTime = null;

            return this.success({
                goldAmount: goldPerTrip,
                miningComplete: true
            });
        }

        // Still mining
        return this.running({
            progress: progress,
            goldAmount: shared.goldAmount,
            timeRemaining: (duration - elapsed)
        });
    }

    onStart(entityId, game) {
        const memory = this.getMemory(entityId);
        memory.miningStartTime = game.state.now;
    }

    onEnd(entityId, game) {
        const memory = this.getMemory(entityId);
        memory.miningStartTime = null;
        super.onEnd(entityId, game);
    }
}