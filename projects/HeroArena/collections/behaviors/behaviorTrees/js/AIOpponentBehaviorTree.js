/**
 * AIOpponentBehaviorTree - Behavior tree for AI opponent during placement phase
 *
 * This tree runs during placement phase and executes build order actions:
 * 1. Place buildings (using peasants)
 * 2. Purchase units from buildings
 * 3. Issue move orders
 * 4. Ready for battle
 *
 * All actions use GameInterfaceSystem services (ui_*) just like a player would.
 */
class AIOpponentBehaviorTree extends GUTS.BaseBehaviorTree {

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

        const aiOpponent = game.getComponent(entityId, 'aiOpponent');
        if (!aiOpponent) {
            return null;
        }

        // Check if already executed actions for this round
        if (aiOpponent.actionsExecuted && aiOpponent.currentRound === game.state.round) {
            return null;
        }

        // Reset action index if new round
        if (aiOpponent.currentRound !== game.state.round) {
            aiOpponent.currentRound = game.state.round;
            aiOpponent.actionIndex = 0;
            aiOpponent.actionsExecuted = false;
        }

        // Evaluate children (the behavior actions)
        return super.evaluate(entityId, game);
    }

    get enums() {
        return this.game.getEnums();
    }
}
