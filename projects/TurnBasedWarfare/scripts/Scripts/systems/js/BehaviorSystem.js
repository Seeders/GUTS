class BehaviorSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        
        // Register action executors
        this.actions = new Map();

        // Register behavior trees by unit type
        this.behaviorTrees = new Map();

        // Universal behavior tree used by all units
        this.universalTree = null;

        // Initialize from collections
        this.initializeFromCollections();
    }

    /**
     * Load actions and behavior trees from game collections
     */
    initializeFromCollections() {
        const collections = this.game.collections;

        // Register behavior actions (not UI actions)
        if (collections.behaviorActions) {
            Object.entries(collections.behaviorActions).forEach(([behaviorActionId, actionData]) => {
                this.registerActionFromData(behaviorActionId, actionData);
            });
        }

        // Register behavior trees
        if (collections.behaviorTrees) {
            Object.entries(collections.behaviorTrees).forEach(([treeId, treeData]) => {
                this.registerBehaviorTreeFromData(treeId, treeData);
            });
        }
    }

    /**
     * Register an action executor from collection data
     */
    registerActionFromData(behaviorActionId, actionData) {
        // The action class should be compiled and available via game context or global scope
        // behaviorActionId is the collection key (e.g., "MoveBehaviorAction")
        const ActionClass = GUTS[behaviorActionId];

        if (ActionClass) {
            const actionInstance = new ActionClass(this.game, actionData.parameters);
            // Use the collection key (behaviorActionId) for registration
            this.actions.set(behaviorActionId, actionInstance);
            console.log(`Registered behavior action: ${behaviorActionId}`);
        } else {
            console.warn(`Action class not found for: ${behaviorActionId}`);
        }
    }

    /**
     * Register a behavior tree from collection data
     */
    registerBehaviorTreeFromData(treeId, treeData) {
        // The tree class should be compiled and available via game context or global scope
        // treeId is typically already the class name (e.g., "FootmanBehaviorTree")
        const TreeClass = GUTS[treeId];

        if (TreeClass) {
            const treeInstance = new TreeClass(this.game, treeData);
            this.universalTree = treeInstance;          
        } else {
            console.warn(`Behavior tree class not found for: ${treeId}`);
        }
    }

    /**
     * Main update loop - runs for all units with aiState
     */
    update(dt) {
        // Get all entities with aiState (AI-controlled units)
        const entities = this.getBehaviorEntities();

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        for (const entityId of entities) {
            this.updateUnit(entityId, dt);
        }
    }

    /**
     * Update a single unit's behavior
     */
    updateUnit(entityId, dt) {
        const aiState = this.game.getComponent(entityId, "aiState");
        const unitType = this.game.getComponent(entityId, "unitType");

        if (!aiState || !unitType) return;

        if (!this.universalTree) {
            // No behavior tree for this unit type, skip
            return;
        }

        // Evaluate behavior tree to get desired action
        const desiredAction = this.universalTree.evaluate(entityId, this.game);

        // Check if we need to switch actions
        if (this.shouldSwitchAction(aiState, desiredAction)) {
            this.switchAction(entityId, aiState, desiredAction);
        }

        // Execute current action
        if (aiState.currentAction) {
            this.executeAction(entityId, aiState, dt);
        }
    }

    getBehaviorEntities() {
        const entities = this.game.getEntitiesWith("aiState", "unitType");

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        return entities;
    }

    onBattleEnd() {
        const entities = this.getBehaviorEntities();

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        for (const entityId of entities) {
            this.universalTree.onBattleEnd(entityId, this.game);
        }
    }
    /**
     * Determine if we should switch from current action to desired action
     */
    shouldSwitchAction(aiState, desiredAction) {
        // No desired action, don't switch
        if (!desiredAction || !desiredAction.action) return false;

        // No current action, start new one
        if (!aiState.currentAction) return true;

        // Different action type
        if (aiState.currentAction.type !== desiredAction.action) {
            // Only switch if higher or equal priority
            return desiredAction.priority >= aiState.actionPriority;
        }

        // Same action, different target
        if (aiState.actionTarget !== desiredAction.target) {
            return desiredAction.priority >= aiState.actionPriority;
        }

        return false;
    }

    /**
     * Switch from current action to a new action
     */
    switchAction(entityId, aiState, desiredAction) {
        // End current action
        if (aiState.currentAction) {
            const currentExecutor = this.actions.get(aiState.currentAction.type);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, aiState, this.game);
            }
        }

        // Start new action - store as object with type property
        aiState.currentAction = { type: desiredAction.action };
        aiState.actionTarget = desiredAction.target;
        aiState.actionData = desiredAction.data || {};
        aiState.actionPriority = desiredAction.priority;
        aiState.actionStartTime = this.game.state.now;

        // Call onStart if exists
        const newExecutor = this.actions.get(aiState.currentAction.type);
        if (newExecutor && newExecutor.onStart) {
            newExecutor.onStart(entityId, aiState, this.game);
        }
    }

    /**
     * Execute the current action
     */
    executeAction(entityId, aiState, dt) {
        const executor = this.actions.get(aiState.currentAction.type);
        if (!executor) {
            console.warn(`No executor for action: ${aiState.currentAction.type}`);
            return;
        }

        // Check if action can still run
        if (!executor.canExecute(entityId, aiState, this.game)) {
            // Action is no longer valid, clear it
            executor.onEnd(entityId, aiState, this.game);
            aiState.currentAction = null;
            aiState.actionTarget = null;
            return;
        }

        // Execute action
        const result = executor.execute(entityId, aiState, this.game, dt);

        // Handle completion
        if (result.complete) {
            executor.onEnd(entityId, aiState, this.game);
            aiState.currentAction = null;
            aiState.actionTarget = null;
        }
    }

    /**
     * Public API: Issue a player command to a unit (DEPRECATED - use playerOrder component)
     */
    issuePlayerCommand(entityId, action, target, data = {}) {
        console.warn('issuePlayerCommand is deprecated - use playerOrder component directly');
    }

    /**
     * Public API: Clear player command for a unit (DEPRECATED - use playerOrder component)
     */
    clearPlayerCommand(entityId) {
        console.warn('clearPlayerCommand is deprecated - use playerOrder component directly');
    }

    /**
     * Debug: Get current action for an entity
     */
    getCurrentAction(entityId) {
        const aiState = this.game.getComponent(entityId, "aiState");
        const playerOrder = this.game.getComponent(entityId, "playerOrder");

        if (!aiState) return null;

        return {
            action: aiState.currentAction ? aiState.currentAction.type : null,
            target: aiState.actionTarget,
            playerOrder: playerOrder,
            priority: aiState.actionPriority
        };
    }
}
