/**
 * UnitOrderSystem - Core player order logic
 *
 * Handles applying playerOrder components to entities.
 * Runs identically on client and server.
 *
 * UI interactions are handled separately by UnitOrderUISystem (client-only).
 */
class UnitOrderSystem extends GUTS.BaseSystem {
    static services = [
        'applySquadTargetPosition',
        'applySquadsTargetPositions'
    ];

    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderSystem = this;
    }

    init() {
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
                // Get or create playerOrder component and update its values
                let playerOrder = this.game.getComponent(unitId, "playerOrder");
                if (!playerOrder) {
                    this.game.addComponent(unitId, "playerOrder", {});
                    playerOrder = this.game.getComponent(unitId, "playerOrder");
                }

                // DEBUG: Log order changes
                const unitTypeComp = this.game.getComponent(unitId, 'unitType');
                const unitTypeDef = this.game.call('getUnitTypeDef', unitTypeComp);
                const unitName = unitTypeDef?.id || unitId;
                console.log(`[UnitOrderSystem] applySquadTargetPosition entity=${unitId} (${unitName}) placementId=${placementId} isHiding=${!!meta?.isHiding} isMoveOrder=${!!meta?.isMoveOrder} wasHiding=${playerOrder.isHiding}`);

                // Update playerOrder values
                playerOrder.targetPositionX = targetPosition.x || 0;
                playerOrder.targetPositionY = targetPosition.y || 0;
                playerOrder.targetPositionZ = targetPosition.z || 0;
                playerOrder.isMoveOrder = !!meta?.isMoveOrder;
                playerOrder.preventEnemiesInRangeCheck = !!meta?.preventEnemiesInRangeCheck;
                playerOrder.isHiding = !!meta?.isHiding;
                playerOrder.completed = false;
                playerOrder.issuedTime = createdTime;
                playerOrder.enabled = true;

                // Clear any existing pathfinding path so the unit doesn't continue following
                // an old path to a previous destination when battle starts
                if (this.game.hasService('clearEntityPath')) {
                    this.game.call('clearEntityPath', unitId);
                }

                // Also reset pathfinding component state to force immediate path recalculation
                const pathfinding = this.game.getComponent(unitId, 'pathfinding');
                if (pathfinding) {
                    pathfinding.lastPathRequest = 0;
                    pathfinding.pathIndex = 0;
                    pathfinding.lastTargetX = 0;
                    pathfinding.lastTargetZ = 0;
                }
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
