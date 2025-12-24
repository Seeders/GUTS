/**
 * AIReadyForBattleBehaviorAction - Marks AI as ready for battle
 *
 * This action is called after all build order actions are complete.
 * It calls ui_toggleReadyForBattle to signal the AI is ready.
 */
class AIReadyForBattleBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const aiOpponent = game.getComponent(entityId, 'aiOpponent');
        if (!aiOpponent) {
            return this.failure();
        }

        // Already marked as executed for this round
        if (aiOpponent.actionsExecuted && aiOpponent.currentRound === game.state.round) {
            return this.success();
        }

        const teamComp = game.getComponent(entityId, 'team');
        const aiTeam = teamComp?.team;
        if (aiTeam === undefined) {
            return this.failure();
        }

        // Call ui_toggleReadyForBattle
        game.call('ui_toggleReadyForBattle', aiTeam, (success, response) => {
            if (!success) {
                console.warn('[AIReadyForBattle] Failed to toggle ready:', response?.error);
            }
        });

        // Mark as executed for this round
        aiOpponent.actionsExecuted = true;

        return this.success();
    }
}
