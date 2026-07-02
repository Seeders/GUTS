import BaseMovementSystem from '../../../../../../global/collections/scripts/systems/js/BaseMovementSystem.js';

/**
 * MovementSystem for Ashfall
 * Extends BaseMovementSystem with battle phase gating and direct player control.
 *
 * Entities with a playerControlled component get their desired velocity from
 * the component's moveX/moveZ (set by PlayerControllerSystem from WASD input)
 * instead of from AI behavior targets.
 */
class MovementSystem extends BaseMovementSystem {
    /**
     * Only process movement during battle phase
     */
    shouldProcessUpdate() {
        return this.game.state.phase === this.enums.gamePhase.battle;
    }

    calculateDesiredVelocity(entityId, data) {
        const pc = this.game.getComponent(entityId, 'playerControlled');
        if (pc) {
            const { vel } = data;
            const baseSpeed = vel.maxSpeed != null ? vel.maxSpeed : this.DEFAULT_AI_SPEED;
            const moveSpeed = baseSpeed === 0
                ? 0
                : Math.max(baseSpeed * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
            data.desiredVelocity.vx = pc.moveX * moveSpeed;
            data.desiredVelocity.vz = pc.moveZ * moveSpeed;
            data.desiredVelocity.vy = 0;
            return;
        }
        super.calculateDesiredVelocity(entityId, data);
    }
}
