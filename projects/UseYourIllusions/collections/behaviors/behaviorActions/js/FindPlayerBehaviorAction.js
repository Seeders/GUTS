/**
 * FindPlayerBehaviorAction - Detects if the player or player clone is within vision range
 *
 * Sets shared.playerTarget to the player/clone entity ID if found
 * Returns SUCCESS if player/clone found and visible, FAILURE otherwise
 */
class FindPlayerBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef',
        'hasLineOfSight',
        'getCamera',
        'playSynthSound'
    ];

    execute(entityId, game) {
        const params = this.parameters || {};

        // Get vision range from unit type definition (prefab), combat component, or params
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitTypeDef = this.call.getUnitTypeDef( unitTypeComp);
        const combat = game.getComponent(entityId, 'combat');
        const detectionRange = unitTypeDef?.visionRange || combat?.visionRange || params.detectionRange || 300;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) {
            return this.failure();
        }

        // Find entities with playerController component (the player)
        const playerEntities = game.getEntitiesWith('playerController', 'transform');

        // Also find player clones - they should be detected as targets too
        const cloneEntities = game.getEntitiesWith('playerClone', 'transform');

        // Combine player and clone entities into targets to check
        const targetEntities = [...playerEntities, ...cloneEntities];

        let closestTarget = null;
        let closestDistance = Infinity;

        const enums = game.getEnums();

        for (const targetId of targetEntities) {
            // Skip dead targets (no health, health <= 0, or dying/corpse state)
            const targetHealth = game.getComponent(targetId, 'health');
            const targetDeathState = game.getComponent(targetId, 'deathState');
            const isDead = !targetHealth ||
                           targetHealth.current <= 0 ||
                           (targetDeathState && targetDeathState.state !== enums.deathState?.alive);
            if (isDead) continue;

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            // Check distance
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > detectionRange) continue;

            // Check line of sight
            const hasLOS = this.call.hasLineOfSight( pos, targetPos);
            if (!hasLOS) continue;

            // Track closest visible target
            if (dist < closestDistance) {
                closestTarget = targetId;
                closestDistance = dist;
            }
        }

        if (closestTarget !== null) {
            // Target found and visible
            const shared = this.getShared(entityId, game);

            // Check if this is a new alert (wasn't tracking before)
            const wasAlerted = shared.playerTarget !== null && shared.playerTarget !== undefined;

            shared.playerTarget = closestTarget;
            shared.playerTargetDistance = closestDistance;

            // Play alert sound when guard first spots player
            if (!wasAlerted && game.hasService('playSynthSound')) {
                const soundConfig = game.getCollections()?.sounds?.guard_alert?.audio;
                if (soundConfig) {
                    // Calculate distance-based volume
                    const camera = game.hasService('getCamera') ? this.call.getCamera() : null;
                    let volume = soundConfig.volume || 0.2;
                    if (camera?.position && pos) {
                        const dx = pos.x - camera.position.x;
                        const dz = pos.z - camera.position.z;
                        const distToCamera = Math.sqrt(dx * dx + dz * dz);
                        const refDistance = 50;
                        const maxDistance = 400;
                        if (distToCamera >= maxDistance) {
                            volume = 0;
                        } else if (distToCamera > refDistance) {
                            volume *= 1.0 - (distToCamera - refDistance) / (maxDistance - refDistance);
                        }
                    }
                    if (volume > 0) {
                        this.call.playSynthSound( `guard_alert_${entityId}`, soundConfig, { volume });
                    }
                }
            }

            return this.success({
                targetId: closestTarget,
                distance: closestDistance
            });
        }

        // No target found
        const shared = this.getShared(entityId, game);
        shared.playerTarget = null;
        shared.playerTargetDistance = null;

        return this.failure();
    }
}
