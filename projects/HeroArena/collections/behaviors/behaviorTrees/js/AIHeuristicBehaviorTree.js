/**
 * AIHeuristicBehaviorTree - Behavior tree for heuristic-based AI opponent
 *
 * This tree runs during placement phase and makes decisions using heuristics:
 * 1. Analyze game state (own resources, visible enemies)
 * 2. Plan strategy (economy, defense, aggression, counter)
 * 3. Execute decisions (build, purchase, move)
 * 4. Ready for battle
 *
 * Unlike the build order AI, this AI adapts based on what it can see
 * and makes strategic decisions each round.
 */
class AIHeuristicBehaviorTree extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence pattern (run all children in order)
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }

    evaluate(entityId, game) {
        // Only run during placement phase
        if (game.state.phase !== this.enums.gamePhase.placement) {
            return null;
        }

        // Only run for local game (skirmish mode) or headless simulation
        if (!game.state.isLocalGame && !game.state.isHeadlessSimulation) {
            return null;
        }

        const aiState = game.getComponent(entityId, 'aiHeuristicState');
        if (!aiState) {
            return null;
        }

        // Check if already executed actions for this round
        if (aiState.executedRound === game.state.round) {
            return null;
        }

        // Evaluate children (the behavior actions)
        const result = super.evaluate(entityId, game);

        // Mark this round as executed after all actions complete
        if (result !== null) {
            aiState.executedRound = game.state.round;
        }

        return result;
    }

    get enums() {
        return this.game.getEnums();
    }
}
