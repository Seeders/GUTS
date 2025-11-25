class BehaviorSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.behaviorSystem = this;
        // Register action executors
        this.actions = new Map();

        // Register behavior trees by unit type
        this.behaviorTrees = new Map();

        // Universal behavior tree used by all units
        this.universalTree = null;

        // Initialize from collections
        this.initializeFromCollections();
    }

    init() {
        this.game.gameManager.register('getActionByType', this.getActionByType.bind(this));
    }

    getActionByType(type) {
        return this.actions.get(type);
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
            let parameters = actionData.parameters;
            if(typeof parameters == 'string'){
                parameters = JSON.parse(parameters);
            }
            const actionInstance = new ActionClass(this.game, parameters);
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

       
    }

    getBehaviorEntities() {
        const entities = this.game.getEntitiesWith("aiState", "unitType");

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        return entities;
    }

    onPlacementPhaseStart() {
        const entities = this.getBehaviorEntities();

        // Sort for determinism
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        for (const entityId of entities) {
            const aiState = this.game.getComponent(entityId, "aiState");
            if(aiState.currentAction){
                const executor = this.actions.get(aiState.currentAction);
                console.log('executing', entityId, this.game.getComponent);
                executor.onPlacementPhaseStart(entityId, this.game);
            }
            this.universalTree.onPlacementPhaseStart(entityId, this.game);
        }
    }
    /**
     * Determine if we should switch from current action to desired action
     */
    shouldSwitchAction(aiState, desiredAction) {
        // No desired action, don't switch
        if (!desiredAction || !desiredAction.action || !desiredAction.meta) return false;

        // No current action, start new one
        if (!aiState.currentAction) return true;

        return true;
    }

    /**
     * Switch from current action to a new action
     */
    switchAction(entityId, aiState, desiredAction) {
        // End current action
        if (aiState.currentAction) {
            const currentExecutor = this.actions.get(aiState.currentAction);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, this.game);
            }
        }

        // Start new action - store as object with type property
        aiState.currentAction = desiredAction.action;
        aiState.meta = desiredAction.meta;

        const newExecutor = this.actions.get(aiState.currentAction);
        if (newExecutor && newExecutor.onStart) {
            newExecutor.onStart(entityId, this.game);
        }
    }

}
