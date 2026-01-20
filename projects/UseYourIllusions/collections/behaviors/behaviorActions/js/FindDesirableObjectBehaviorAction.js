/**
 * FindDesirableObjectBehaviorAction - Detects nearby objects with desired: true flag
 *
 * Parameters:
 *   detectionRange: number (default: 500) - Range to search for desirable objects
 *
 * Sets shared.desirableTarget to the nearest desirable object entity ID
 * Returns SUCCESS if found, FAILURE if none found
 */
class FindDesirableObjectBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};

        // Check if PickUpObjectBehaviorAction is in waiting state
        // If so, return success to allow the sequence to continue to PickUpObjectBehaviorAction
        const pickupNode = game.call('getNodeByType', 'PickUpObjectBehaviorAction');
        if (pickupNode) {
            const pickupMemory = pickupNode.getMemory(entityId);
            if (pickupMemory && pickupMemory.waitingAfterPickup) {
                // Already picked up an object and waiting - pass through to pickup action
                return this.success({ waitingAfterPickup: true });
            }
        }

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

        // Get all world objects and check if they have the desired flag
        const collections = game.getCollections();
        const worldObjectPrefabs = collections.worldObjects || {};

        // Find entities that are desirable world objects
        const worldObjectEntities = game.getEntitiesWith('transform', 'renderable');

        let nearestId = null;
        let nearestDist = Infinity;

        for (const targetId of worldObjectEntities) {
            // Skip self
            if (targetId === entityId) continue;

            // Skip entities with preview component (illusion previews)
            if (game.hasComponent(targetId, 'preview')) continue;

            // Check if this is a world object with desired flag
            const unitType = game.getComponent(targetId, 'unitType');
            if (!unitType) continue;

            // Get the reverse enums to find the object type name
            const reverseEnums = game.getReverseEnums();
            const objectTypeName = reverseEnums.worldObjects?.[unitType.type];
            if (!objectTypeName) continue;

            // Check if the prefab has desired: true
            const prefabData = worldObjectPrefabs[objectTypeName];
            if (!prefabData || !prefabData.desired) continue;

            // Check distance
            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > detectionRange || dist >= nearestDist) continue;

            // Check line of sight - guard must be able to see the object
            const hasLOS = game.call('hasLineOfSight', pos, targetPos);
            if (!hasLOS) continue;

            nearestDist = dist;
            nearestId = targetId;
        }

        if (nearestId !== null) {
            // Store the target in shared state
            const shared = this.getShared(entityId, game);
            shared.desirableTarget = nearestId;
            shared.desirableTargetDistance = nearestDist;

            return this.success({
                targetId: nearestId,
                distance: nearestDist
            });
        }

        // Clear any previous target
        const shared = this.getShared(entityId, game);
        shared.desirableTarget = null;
        shared.desirableTargetDistance = null;

        return this.failure();
    }
}
