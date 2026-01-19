/**
 * Deposit Gold Action
 * Deposits carried gold at the depot, awarding it to the team
 *
 * Reads from shared state:
 *   - goldAmount: amount of gold being carried
 *   - hasGold: whether carrying gold
 *
 * Clears from shared state on success:
 *   - goldAmount
 *   - hasGold
 *   - targetDepot
 *   - targetDepotPosition
 *
 * Parameters:
 *   - duration: number - Time in seconds to deposit (default: 1)
 *
 * Returns:
 *   - SUCCESS when deposit is complete
 *   - RUNNING while depositing
 *   - FAILURE if not carrying gold
 */
class DepositGoldBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);

        // Check if carrying gold
        if (!shared.hasGold || !shared.goldAmount || shared.goldAmount <= 0) {
            return this.failure();
        }

        const duration = (this.parameters.duration || 1); // Convert to ms
        const goldAmount = shared.goldAmount;

        // Initialize deposit start time
        if (!memory.depositStartTime) {
            memory.depositStartTime = game.state.now;
        }

        const elapsed = game.state.now - memory.depositStartTime;
        const progress = Math.min(1, elapsed / duration);

        if (elapsed >= duration) {
            // Deposit complete - award gold to team
            this.awardGoldToTeam(entityId, game, goldAmount);

            // Clear gold-related shared state
            shared.goldAmount = 0;
            shared.hasGold = false;
            shared.targetDepot = null;
            shared.targetDepotPosition = null;

            // Reset memory
            memory.depositStartTime = null;

            return this.success({
                goldDeposited: goldAmount,
                depositComplete: true
            });
        }

        // Still depositing
        return this.running({
            progress: progress,
            goldAmount: goldAmount,
            timeRemaining: (duration - elapsed)
        });
    }

    /**
     * Award gold to the entity's team
     */
    awardGoldToTeam(entityId, game, amount) {
        const team = game.getComponent(entityId, 'team');
        if (!team) return;

        // Award gold to player entity
        game.call('addPlayerGold', team.team, amount);
    }

    onStart(entityId, game) {
        const memory = this.getMemory(entityId);
        memory.depositStartTime = game.state.now;
    }

    onEnd(entityId, game) {
        const memory = this.getMemory(entityId);
        memory.depositStartTime = null;
        super.onEnd(entityId, game);
    }
}