class SchedulingSystem extends GUTS.BaseSystem {
   constructor(game) {
        super(game);
        this.game.schedulingSystem = this;
        
        // Scheduled actions storage
        this.scheduledActions = new Map();
        this.actionIdCounter = 0;
        
        // Entity tracking for cleanup
        this.entityActions = new Map(); // entityId -> Set of actionIds
    }

    init() {
        // Register methods with GameManager
        this.game.register('scheduleAction', this.scheduleAction.bind(this));
        this.game.register('cancelScheduledAction', this.cancelAction.bind(this));
    }

    update() {
        this.processScheduledActions();
    }
    
    /**
     * Schedule an action to execute after a delay
     * @param {Function} callback - Function to execute
     * @param {number} delaySeconds - Delay in seconds (game time)
     * @param {string|null} entityId - Optional entity ID for tracking/cleanup
     * @returns {string} actionId - Unique identifier for this action
     */
    scheduleAction(callback, delaySeconds, entityId = null) {
        const executeTime = this.game.state.now + delaySeconds;
        const actionId = `action_${this.actionIdCounter++}_${executeTime.toFixed(6)}`;
        
        this.scheduledActions.set(actionId, {
            callback: callback,
            executeTime: executeTime,
            entityId: entityId
        });
        
        // Track entity associations for cleanup
        if (entityId) {
            if (!this.entityActions.has(entityId)) {
                this.entityActions.set(entityId, new Set());
            }
            this.entityActions.get(entityId).add(actionId);
        }
        
        return actionId;
    }
    
    /**
     * Process all scheduled actions that are ready to execute
     */
    processScheduledActions() {
        const actionsToExecute = [];
        
        // Find all actions ready to execute
        for (const [actionId, action] of this.scheduledActions.entries()) {
            if (this.game.state.now >= action.executeTime) {
                actionsToExecute.push({ id: actionId, action: action });
            }
        }
        
        // Sort actions for deterministic execution order
        actionsToExecute.sort((a, b) => {
            // Primary sort: by execution time
            if (Math.abs(a.action.executeTime - b.action.executeTime) > 0.000001) {
                return a.action.executeTime - b.action.executeTime;
            }
            // Secondary sort: by action ID for deterministic tie-breaking
            return a.id.localeCompare(b.id);
        });
        
        // Execute actions in deterministic order
        actionsToExecute.forEach(({ id, action }) => {
            try {
                action.callback();
            } catch (error) {
                console.error(`Error executing scheduled action ${id}:`, error);
            }
            
            // Clean up
            this.removeAction(id, action.entityId);
        });
    }
    
    /**
     * Cancel a scheduled action
     * @param {string} actionId - Action to cancel
     * @returns {boolean} - True if action was found and cancelled
     */
    cancelAction(actionId) {
        const action = this.scheduledActions.get(actionId);
        if (action) {
            this.removeAction(actionId, action.entityId);
            return true;
        }
        return false;
    }
    
    /**
     * Cancel all actions associated with an entity
     * @param {string} entityId - Entity whose actions should be cancelled
     * @returns {number} - Number of actions cancelled
     */
    entityDestroyed(entityId) {
        const entityActionIds = this.entityActions.get(entityId);
        if (!entityActionIds) return 0;
        
        let cancelledCount = 0;
        for (const actionId of entityActionIds) {
            if (this.scheduledActions.has(actionId)) {
                this.scheduledActions.delete(actionId);
                cancelledCount++;
            }
        }
        
        this.entityActions.delete(entityId);
        return cancelledCount;
    }
    
    /**
     * Internal method to remove action and clean up tracking
     * @param {string} actionId 
     * @param {string|null} entityId 
     */
    removeAction(actionId, entityId) {
        this.scheduledActions.delete(actionId);
        
        if (entityId && this.entityActions.has(entityId)) {
            this.entityActions.get(entityId).delete(actionId);
            
            // Clean up empty entity tracking
            if (this.entityActions.get(entityId).size === 0) {
                this.entityActions.delete(entityId);
            }
        }
    }
    
    /**
     * Get info about scheduled actions (for debugging)
     * @returns {Object} - Statistics about scheduled actions
     */
    getSchedulingStats() {
        return {
            totalActions: this.scheduledActions.size,
            entitiesWithActions: this.entityActions.size,
            nextActionTime: this.getNextActionTime()
        };
    }
    
    /**
     * Get the time of the next scheduled action
     * @returns {number|null} - Time of next action, or null if none scheduled
     */
    getNextActionTime() {
        let nextTime = null;
        for (const action of this.scheduledActions.values()) {
            if (nextTime === null || action.executeTime < nextTime) {
                nextTime = action.executeTime;
            }
        }
        return nextTime;
    }
    
    /**
     * Check if an entity has scheduled actions
     * @param {string} entityId 
     * @returns {boolean}
     */
    hasEntityActions(entityId) {
        const entityActionIds = this.entityActions.get(entityId);
        return entityActionIds && entityActionIds.size > 0;
    }
    
    /**
     * Clear all scheduled actions (useful for game reset)
     */
    clearAllActions() {
        this.scheduledActions.clear();
        this.entityActions.clear();
    }
    
    /**
     * Convenience method: Schedule a delayed function call
     * @param {Object} obj - Object to call method on
     * @param {string} methodName - Method name to call
     * @param {Array} args - Arguments to pass
     * @param {number} delaySeconds - Delay in seconds
     * @param {string|null} entityId - Optional entity ID
     * @returns {string} actionId
     */
    scheduleMethodCall(obj, methodName, args = [], delaySeconds, entityId = null) {
        return this.scheduleAction(() => {
            if (obj && typeof obj[methodName] === 'function') {
                obj[methodName](...args);
            }
        }, delaySeconds, entityId);
    }
}
