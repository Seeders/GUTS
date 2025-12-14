/**
 * UnitOrderSystem - Core player order logic
 *
 * Handles applying playerOrder components to entities.
 * Runs identically on client and server.
 *
 * UI interactions are handled separately by UnitOrderUISystem (client-only).
 */
class UnitOrderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderSystem = this;
    }

    init() {
        this.game.register('applySquadTargetPosition', this.applySquadTargetPosition.bind(this));
        this.game.register('applySquadsTargetPositions', this.applySquadsTargetPositions.bind(this));

        // Debug: Log the playerOrder type ID
        const playerOrderTypeId = this.game._componentTypeId?.get('playerOrder');
        console.log('[UnitOrderSystem] Initialized, playerOrder typeId:', playerOrderTypeId);
    }

    /**
     * Apply a squad target position to all units in the placement
     * This is the core logic that both client and server use
     * @param {number} placementId - The placement ID
     * @param {Object} targetPosition - Target position { x, y, z }
     * @param {Object} meta - Order metadata (isMoveOrder, preventEnemiesInRangeCheck, etc.)
     * @param {number} commandCreatedTime - The issued time from server
     */
    applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime) {
        const placement = this.game.call('getPlacementById', placementId);
        if (!placement) {
            // Placement doesn't exist yet - entity sync at battle start will handle it
            console.log(`[UnitOrderSystem] applySquadTargetPosition - placement ${placementId} not found (may be synced later)`);
            return;
        }

        const createdTime = commandCreatedTime || this.game.state.now;

        console.log(`[UnitOrderSystem] applySquadTargetPosition: placementId=${placementId}, targetPosition=`, targetPosition, `meta=`, meta, `issuedTime=${createdTime}, squadUnits=`, placement.squadUnits);

        placement.squadUnits.forEach((unitId) => {
            if (targetPosition) {
                // Remove existing player order if present, then add new one
                if (this.game.hasComponent(unitId, "playerOrder")) {
                    console.log(`[UnitOrderSystem] Removing existing playerOrder from entity ${unitId}`);
                    this.game.removeComponent(unitId, "playerOrder");
                }

                const playerOrderData = {
                    targetPositionX: targetPosition.x || 0,
                    targetPositionY: targetPosition.y || 0,
                    targetPositionZ: targetPosition.z || 0,
                    isMoveOrder: !!meta?.isMoveOrder,
                    preventEnemiesInRangeCheck: !!meta?.preventEnemiesInRangeCheck,
                    completed: false,
                    issuedTime: createdTime
                };

                console.log(`[UnitOrderSystem] Adding playerOrder to entity ${unitId}:`, playerOrderData);
                this.game.addComponent(unitId, "playerOrder", playerOrderData);

                // Verify it was added
                const verifyOrder = this.game.getComponent(unitId, "playerOrder");
                console.log(`[UnitOrderSystem] Verified playerOrder on entity ${unitId}:`, verifyOrder?.toJSON ? verifyOrder.toJSON() : verifyOrder);

                // Debug: Check if component bit is set in mask
                const typeId = this.game._componentTypeId?.get('playerOrder');
                const maskIndex = unitId * 2;
                const mask0 = this.game.entityComponentMask[maskIndex];
                const mask1 = this.game.entityComponentMask[maskIndex + 1];
                const hasBit = typeId < 32
                    ? (mask0 & (1 << typeId)) !== 0
                    : (mask1 & (1 << (typeId - 32))) !== 0;
                console.log(`[UnitOrderSystem] Entity ${unitId} mask after add: [${mask0}, ${mask1}], typeId=${typeId}, hasBit=${hasBit}`);
            }
        });
    }

    /**
     * Apply squad target positions to multiple placements
     * @param {Array<number>} placementIds - Array of placement IDs
     * @param {Array<Object>} targetPositions - Array of target positions
     * @param {Object} meta - Order metadata
     * @param {number} commandCreatedTime - The issued time from server
     */
    applySquadsTargetPositions(placementIds, targetPositions, meta, commandCreatedTime) {
        for (let i = 0; i < placementIds.length; i++) {
            const placementId = placementIds[i];
            const targetPosition = targetPositions[i];
            this.applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime);
        }
    }
}
