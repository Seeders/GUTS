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
                // Store intent to hide - actual isHiding is set when unit reaches destination
                playerOrder.wantsToHide = !!meta?.isHiding;
                // Only set isHiding immediately if not moving to a position
                playerOrder.isHiding = !!meta?.isHiding && !meta?.isMoveOrder;
                playerOrder.completed = false;
                playerOrder.issuedTime = createdTime;
                playerOrder.enabled = true;

                // Clear any existing pathfinding path so the unit doesn't continue following
                // an old path to a previous destination when battle starts
                if (this.game.hasService('clearEntityPath')) {
                    // DEBUG: Log path clear for archer units
                    if (unitName?.includes('archer')) {
                        const existingPath = this.game.call('getEntityPath', unitId);
                        console.log(`[UnitOrderSystem] ARCHER ${unitId} CLEARING path (had ${existingPath ? existingPath.length + ' waypoints' : 'no path'})`);
                    }
                    this.game.call('clearEntityPath', unitId);
                }

                // Also reset pathfinding component state to force immediate path recalculation
                const pathfinding = this.game.getComponent(unitId, 'pathfinding');
                if (pathfinding) {
                    // DEBUG: Log pathfinding reset for archer units
                    if (unitName?.includes('archer')) {
                        console.log(`[UnitOrderSystem] ARCHER ${unitId} resetting pathfinding state (lastPathRequest was ${pathfinding.lastPathRequest})`);
                    }
                    pathfinding.lastPathRequest = 0;
                    pathfinding.pathIndex = 0;
                    pathfinding.lastTargetX = 0;
                    pathfinding.lastTargetZ = 0;
                }

                // For force move orders, clear combat target so unit stops fighting
                if (meta?.preventEnemiesInRangeCheck) {
                    const aiState = this.game.getComponent(unitId, 'aiState');
                    if (aiState?.shared) {
                        aiState.shared.target = null;
                    }
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
