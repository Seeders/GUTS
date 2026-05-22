import BaseBehaviorSystem from '../../../../../../global/collections/scripts/systems/js/BaseBehaviorSystem.js';

/**
 * BehaviorSystem for TurnBasedWarfare
 * Extends BaseBehaviorSystem with battle phase gating
 *
 * During placement phase: Only AI opponents run (for build orders and readying up)
 * During battle phase: All unit behaviors run
 */
class BehaviorSystem extends BaseBehaviorSystem {
    /**
     * Override update to handle phase-specific behavior
     * - Placement phase: Only run AI opponent behaviors
     * - Battle phase: Run all unit behaviors
     */
    update(dt) {
        const isBattlePhase = this.game.state?.phase === this.enums.gamePhase.battle;
        // Battle has ended but we're in the post-battle intermission (showing the winner)
        // — freeze unit behaviors so heroes don't keep swinging/dying for the next 3.5s.
        const isIntermission = !!this.game.state?.battleIntermission;

        if (isBattlePhase && !isIntermission) {
            // Battle phase: run all behaviors via parent update()
            super.update(dt);
        } else if (!isBattlePhase) {
            // Placement phase: only run AI opponent behaviors (build orders, ready up)
            this.updateAIOpponents(dt);
        }
        // During intermission: skip all behavior updates
    }
}

export default BehaviorSystem;
export { BehaviorSystem };
