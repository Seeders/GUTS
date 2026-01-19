/**
 * FindPlayerBehaviorAction - Detects if the player is within vision range
 *
 * Sets shared.playerTarget to the player entity ID if found
 * Returns SUCCESS if player found and visible, FAILURE otherwise
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

        for (const playerId of playerEntities) {
            const playerTransform = game.getComponent(playerId, 'transform');
            const playerPos = playerTransform?.position;
            if (!playerPos) continue;

            // Check distance
            const dx = playerPos.x - pos.x;
            const dz = playerPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > detectionRange) continue;

            // Check line of sight
            const hasLOS = game.call('hasLineOfSight', pos, playerPos);
            if (!hasLOS) continue;

            // Player found and visible
            const shared = this.getShared(entityId, game);
            shared.playerTarget = playerId;
            shared.playerTargetDistance = dist;

            return this.success({
                targetId: playerId,
                distance: dist
            });
        }

        // No player found
        const shared = this.getShared(entityId, game);
        shared.playerTarget = null;
        shared.playerTargetDistance = null;

        return this.failure();
    }
}
