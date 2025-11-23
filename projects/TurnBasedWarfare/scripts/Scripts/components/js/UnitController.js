/**
 * UnitController Component
 * Single source of truth for unit AI state
 *
 * Replaces:
 * - AI_STATE
 * - BUILDING_STATE
 * - MINING_STATE
 * - Multiple conflicting state machines
 */
class UnitController extends BaseComponent {
    constructor(entity, params) {
        super(entity, params);

        // Current action execution
        this.currentAction = params.currentAction || null;  // Action name: "MOVE_TO", "ATTACK", "MINE", etc.
        this.actionTarget = params.actionTarget || null;     // Entity ID or position {x, z}
        this.actionData = params.actionData || {};           // Action-specific data
        this.actionPriority = params.actionPriority || 0;    // Priority level (higher = more important)
        this.actionStartTime = params.actionStartTime || 0;  // When action started

        // Player orders (persist between rounds)
        this.playerOrder = params.playerOrder || null;       // Saved player command
    }

    /**
     * Get sync data for network replication
     * Only sync what's necessary
     */
    getSyncData() {
        return {
            currentAction: this.currentAction,
            actionTarget: this.actionTarget,
            actionPriority: this.actionPriority,
            playerOrder: this.playerOrder
        };
    }

    /**
     * Apply sync data from server
     */
    applySyncData(data) {
        this.currentAction = data.currentAction;
        this.actionTarget = data.actionTarget;
        this.actionPriority = data.actionPriority;
        this.playerOrder = data.playerOrder;
    }
}
