/**
 * FindPlayerBehaviorAction - Detects if the player or player clone is within vision range
 *
 * Sets shared.playerTarget to the player/clone entity ID if found
 * Returns SUCCESS if player/clone found and visible, FAILURE otherwise
 */
class FindPlayerBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};

        // Get vision range from unit type definition (prefab), combat component, or params
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitTypeDef = game.call('getUnitTypeDef', unitTypeComp);
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

        for (const targetId of targetEntities) {
            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            // Check distance
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > detectionRange) continue;

            // Check line of sight
            const hasLOS = game.call('hasLineOfSight', pos, targetPos);
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
            shared.playerTarget = closestTarget;
            shared.playerTargetDistance = closestDistance;

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
