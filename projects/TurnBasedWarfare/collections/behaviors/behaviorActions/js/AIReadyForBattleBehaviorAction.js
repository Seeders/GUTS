/**
 * AIReadyForBattleBehaviorAction - Marks AI as ready for battle
 *
 * This action is called after all build order actions are complete.
 * It calls ui_toggleReadyForBattle to signal the AI is ready.
 *
 * Works with both aiOpponent (build order AI) and aiHeuristicState (heuristic AI).
 */
class AIReadyForBattleBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'ui_toggleReadyForBattle'
    ];

    execute(entityId, game) {
        // Support both aiOpponent (build order) and aiHeuristicState (heuristic AI)
        const aiOpponent = game.getComponent(entityId, 'aiOpponent');
        const aiHeuristicState = game.getComponent(entityId, 'aiHeuristicState');

        if (!aiOpponent && !aiHeuristicState) {
            return this.failure();
        }

        // Use whichever state component is available
        const aiState = aiOpponent || aiHeuristicState;
        const currentRoundField = aiOpponent ? 'currentRound' : 'lastAnalyzedRound';

        // Already marked as executed for this round
        if (aiState.actionsExecuted && aiState[currentRoundField] === game.state.round) {
            return this.success();
        }

        const teamComp = game.getComponent(entityId, 'team');
        const aiTeam = teamComp?.team;

        if (aiTeam === undefined) {
            return this.failure();
        }

        console.log('[AIReadyForBattle] Team', aiTeam, 'calling ui_toggleReadyForBattle');

        // Call ui_toggleReadyForBattle
        const callback = (success, response) => {
            console.log('[AIReadyForBattle] Team', aiTeam, 'ready callback - success:', success);
        };
        this.call.ui_toggleReadyForBattle(aiTeam, callback);

        // Mark as executed for this round
        aiState.actionsExecuted = true;

        return this.success();
    }
}
