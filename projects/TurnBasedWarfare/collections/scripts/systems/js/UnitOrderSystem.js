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
            return;
        }

        const createdTime = commandCreatedTime || this.game.state.now;

        placement.squadUnits.forEach((unitId) => {
            if (targetPosition) {
                // Remove existing player order if present, then add new one
                if (this.game.hasComponent(unitId, "playerOrder")) {
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

                this.game.addComponent(unitId, "playerOrder", playerOrderData);
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
