import BaseMovementSystem from '../../../../../../global/collections/scripts/systems/js/BaseMovementSystem.js';

/**
 * MovementSystem for TurnBasedWarfare
 * Extends BaseMovementSystem with battle phase gating
 */
class MovementSystem extends BaseMovementSystem {
    /**
     * Only process movement during battle phase
     */
    shouldProcessUpdate() {
        return this.game.state.phase === this.enums.gamePhase.battle;
    }
}
