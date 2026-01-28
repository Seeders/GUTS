import BaseMovementSystem from '../../../../../../global/collections/scripts/systems/js/BaseMovementSystem.js';

/**
 * MovementSystem for UseYourIllusions
 * Extends BaseMovementSystem with:
 * - AI movement filtering (only process entities with aiMovement component)
 * - Footstep audio for guards
 */
class MovementSystem extends BaseMovementSystem {
    static serviceDependencies = [
        ...BaseMovementSystem.serviceDependencies,
        'getCamera',
        'playSynthSound'
    ];

    constructor(game) {
        super(game);

        // Footstep sound tracking for AI units
        this._footstepState = new Map(); // entityId -> { lastTime, side }
        this._footstepInterval = 0.45; // Time between footsteps for guards
    }

    /**
     * Only process entities with aiMovement component (skip player-controlled entities)
     */
    getMovementEntities() {
        return this.game.getEntitiesWith("transform", "velocity", "aiMovement");
    }

    /**
     * Play footstep sounds when guards move
     */
    onEntityMoved(entityId, speed) {
        if (speed > this.MIN_MOVEMENT_THRESHOLD * 2) {
            this.playGuardFootstep(entityId);
        }
    }

    playGuardFootstep(entityId) {
        const now = this.game.state.now || 0;

        // Get or create footstep state for this entity
        let state = this._footstepState.get(entityId);
        if (!state) {
            state = { lastTime: 0, side: 0 };
            this._footstepState.set(entityId, state);
        }

        // Check if enough time has passed since last footstep
        if (now - state.lastTime < this._footstepInterval) {
            return;
        }

        // Calculate distance to camera for volume attenuation
        const guardPos = this.game.getComponent(entityId, 'transform')?.position;
        if (!guardPos) return;

        // Get camera position
        let distanceToCamera = 0;
        const camera = this.game.hasService('getCamera') ? this.call.getCamera() : null;
        if (camera?.position) {
            const dx = guardPos.x - camera.position.x;
            const dz = guardPos.z - camera.position.z;
            distanceToCamera = Math.sqrt(dx * dx + dz * dz);
        }

        // Distance-based volume attenuation
        const refDistance = 50;   // Full volume within this distance
        const maxDistance = 350;  // Silent beyond this distance

        // Skip playing if too far away
        if (distanceToCamera >= maxDistance) {
            state.lastTime = now;
            state.side = 1 - state.side;
            return;
        }

        // Linear falloff for more predictable attenuation
        let distanceVolume = 1.0;
        if (distanceToCamera > refDistance) {
            distanceVolume = 1.0 - (distanceToCamera - refDistance) / (maxDistance - refDistance);
            distanceVolume = Math.max(0, distanceVolume);
        }

        const soundName = state.side === 0 ? 'guard_footstep_left' : 'guard_footstep_right';
        const soundConfig = this.game.getCollections()?.sounds?.[soundName]?.audio;

        if (soundConfig) {
            // Clone config for randomization
            const config = JSON.parse(JSON.stringify(soundConfig));

            // Add random variation
            const pitchVariation = 0.85 + Math.random() * 0.3;
            config.frequency = (config.frequency || 200) * pitchVariation;

            // Apply distance-based volume attenuation
            const baseVolume = (config.volume || 0.12) * (0.8 + Math.random() * 0.2);
            config.volume = baseVolume * distanceVolume;

            // Debug: log distance and volume occasionally
            if (Math.random() < 0.1) {
                console.log(`[Guard footstep] dist: ${distanceToCamera.toFixed(0)}, vol: ${distanceVolume.toFixed(2)}, final: ${config.volume.toFixed(4)}`);
            }

            if (config.effects?.filter) {
                config.effects.filter.frequency *= (0.9 + Math.random() * 0.2);
            }

            if (config.effects) {
                const basePan = config.effects.pan || 0;
                config.effects.pan = basePan + (Math.random() - 0.5) * 0.15;
            }

            // Pass volume as options parameter - config.volume isn't used by AudioManager
            const finalVolume = config.volume;
            this.call.playSynthSound(`guard_footstep_${entityId}_${Date.now()}`, config, { volume: finalVolume });
        }

        state.lastTime = now;
        state.side = 1 - state.side; // Alternate between left and right
    }

    entityDestroyed(entityId) {
        super.entityDestroyed(entityId);
        // Clean up footstep tracking state
        this._footstepState.delete(entityId);
    }
}
