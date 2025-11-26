class BehaviorSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.behaviorSystem = this;

        // Use shared BehaviorTreeProcessor for all behavior tree logic
        this.processor = new GUTS.BehaviorTreeProcessor(game);
        this.processor.initializeFromCollections(game.collections);

        this.rootTree = null;
    }

    init() {
        this.game.gameManager.register('getActionByType', this.processor.getActionByType.bind(this.processor));
        this.game.gameManager.register('getBehaviorTreeByType', this.processor.getBehaviorTreeByType.bind(this.processor));
    }

    /**
     * Main update loop - runs for all units with aiState
     */
    update(dt) {
        const entities = this.getBehaviorEntities();

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

        this.rootTree = this.processor.getBehaviorTreeByType('UniversalBehaviorTree');
        if (!this.rootTree) {
            return;
        }

        // Evaluate behavior tree to get desired action
        const desiredAction = this.processor.evaluate('UniversalBehaviorTree', entityId);

        // Check if we need to switch actions
        if (this.shouldSwitchAction(aiState, desiredAction)) {
            this.switchAction(entityId, aiState, desiredAction);
        }
    }

    getBehaviorEntities() {
        const entities = this.game.getEntitiesWith("aiState", "unitType");
        entities.sort((a, b) => String(a).localeCompare(String(b)));
        return entities;
    }

    onPlacementPhaseStart() {
        const entities = this.getBehaviorEntities();

        for (const entityId of entities) {
            const aiState = this.game.getComponent(entityId, "aiState");
            if (aiState.currentAction) {
                const executor = this.processor.getActionByType(aiState.currentAction);
                console.log('executing', entityId, this.game.getComponent);
                executor.onPlacementPhaseStart(entityId, this.game);
            }
            this.rootTree = this.processor.getBehaviorTreeByType('UniversalBehaviorTree');
            if (this.rootTree) {
                this.rootTree.onPlacementPhaseStart(entityId, this.game);
            }
        }
    }

    /**
     * Determine if we should switch from current action to desired action
     */
    shouldSwitchAction(aiState, desiredAction) {
        if (!desiredAction || !desiredAction.action || !desiredAction.meta) return false;
        if (!aiState.currentAction) return true;

        // If the desired action is running, always continue with it
        if (desiredAction.status === 'running') {
            // Only switch if it's a different action
            return aiState.currentAction !== desiredAction.action;
        }

        // For success status, allow switching to new action
        return true;
    }

    /**
     * Switch from current action to a new action
     */
    switchAction(entityId, aiState, desiredAction) {
        const isNewAction = aiState.currentAction !== desiredAction.action;

        // End current action if switching to a different one
        if (isNewAction && aiState.currentAction) {
            const currentExecutor = this.processor.getActionByType(aiState.currentAction);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, this.game);
            }
        }

        // Update action state
        aiState.currentAction = desiredAction.action;
        aiState.status = desiredAction.status || 'success';
        aiState.meta = desiredAction.meta;
        while (aiState.meta.meta && aiState.meta.action) {
            aiState.currentAction = desiredAction.meta.action;
            aiState.meta = desiredAction.meta.meta;
        }

        // Only call onStart for new actions
        if (isNewAction) {
            const newExecutor = this.processor.getActionByType(aiState.currentAction);
            if (newExecutor && newExecutor.onStart) {
                newExecutor.onStart(entityId, this.game);
            }
        }
    }
}
