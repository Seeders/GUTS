class BehaviorSystem extends GUTS.BaseSystem {
    static services = [
        'getBehaviorMeta',
        'getBehaviorShared',
        'setBehaviorMeta',
        'clearBehaviorState',
        'getBehaviorNodeId',
        'getNodeByType',
        'getDebugger'
    ];

    constructor(game) {
        super(game);
        this.game.behaviorSystem = this;

        // Use shared BehaviorTreeProcessor for all behavior tree logic
        this.processor = new GUTS.BehaviorTreeProcessor(game);

        this.rootTree = null;

        // Entity behavior state storage (moved out of component for TypedArray compatibility)
        // Stores { meta: {}, shared: {} } per entity
        this.entityBehaviorState = new Map();

    }

    init() {
        // Get collection names from behaviorCollection enum (index -> name mapping)
        const behaviorCollectionEnum = this.game.call('getEnumMap', 'behaviorCollection');
        this.collectionNames = behaviorCollectionEnum?.toValue || [];

        // Cache enum maps for index-to-name lookups (toValue arrays)
        this.behaviorCollectionMaps = {};
        for (const collectionName of this.collectionNames) {
            this.behaviorCollectionMaps[collectionName] = this.game.call('getEnumMap', collectionName);
        }

        this.processor.initializeFromCollections(this.collections);
    }

    // Delegates to processor for static services registration
    getNodeByType(nodeId) {
        return this.processor.getNodeByType(nodeId);
    }

    getDebugger() {
        return this.processor.getDebugger();
    }

    // Alias for static services registration
    getBehaviorNodeId(entityId) {
        return this.getNodeId(entityId);
    }

    // ==================== Behavior State Accessors ====================

    /**
     * Get or create behavior state for an entity
     */
    getOrCreateBehaviorState(entityId) {
        if (!this.entityBehaviorState.has(entityId)) {
            this.entityBehaviorState.set(entityId, { meta: {}, shared: {} });
        }
        return this.entityBehaviorState.get(entityId);
    }

    /**
     * Get behavior meta for an entity
     */
    getBehaviorMeta(entityId) {
        return this.getOrCreateBehaviorState(entityId).meta;
    }

    /**
     * Get behavior shared state for an entity
     */
    getBehaviorShared(entityId) {
        return this.getOrCreateBehaviorState(entityId).shared;
    }

    /**
     * Set behavior meta for an entity
     */
    setBehaviorMeta(entityId, meta) {
        this.getOrCreateBehaviorState(entityId).meta = meta;
    }

    /**
     * Clear behavior state for an entity
     */
    clearBehaviorState(entityId) {
        const state = this.getOrCreateBehaviorState(entityId);
        state.meta = {};
        state.shared = {};
    }

    /**
     * Remove behavior state for a destroyed entity
     */
    removeBehaviorState(entityId) {
        this.entityBehaviorState.delete(entityId);
    }

    /**
     * Get node string ID from collection index and node index
     */
    getNodeId(collectionIndex, nodeIndex) {
        const collectionName = this.collectionNames[collectionIndex];
        const enumMap = this.behaviorCollectionMaps[collectionName];
        return enumMap?.toValue[nodeIndex];
    }

    /**
     * Get collection index and node index from node string ID
     */
    getNodeIndices(nodeId) {
        for (let i = 0; i < this.collectionNames.length; i++) {
            const collectionName = this.collectionNames[i];
            const enumMap = this.behaviorCollectionMaps[collectionName];
            if (enumMap?.toIndex[nodeId] !== undefined) {
                return { collection: i, index: enumMap.toIndex[nodeId] };
            }
        }
        return null;
    }

    /**
     * Called when battle ends - clear all state and debug data
     */
    onBattleEnd() {
        this.processor.clearAllDebugData();

        // Also notify trees
        const entities = this.getBehaviorEntities();
        for (const entityId of entities) {
            const aiState = this.game.getComponent(entityId, "aiState");
            const rootTreeId = this.getNodeId(aiState.rootBehaviorTreeCollection, aiState.rootBehaviorTree);
            const rootTree = this.processor.getNodeByType(rootTreeId);
            if (rootTree) {
                rootTree.onBattleEnd(entityId, this.game);
            }
            // Clear behavior state (meta/shared now stored in BehaviorSystem)
            this.clearBehaviorState(entityId);
            aiState.currentAction = this.enums.behaviorActions.IdleBehaviorAction;
            aiState.currentActionCollection = this.enums.behaviorCollection.behaviorActions;
        }
    }

    onBattleStart() {
        const entities = this.getBehaviorEntities();
        for (const entityId of entities) {
            const aiState = this.game.getComponent(entityId, "aiState");
            // Clear behavior state (meta/shared now stored in BehaviorSystem)
            this.clearBehaviorState(entityId);
            aiState.currentAction = this.enums.behaviorActions.IdleBehaviorAction;
            aiState.currentActionCollection = this.enums.behaviorCollection.behaviorActions;
            const rootTreeId = this.getNodeId(aiState.rootBehaviorTreeCollection, aiState.rootBehaviorTree);
            const rootTree = this.processor.getNodeByType(rootTreeId);
            if (rootTree) {
                rootTree.onBattleStart(entityId, this.game);
            }
        }
    }

    onPlacementPhaseStart() {
        const entities = this.getBehaviorEntities();

        for (const entityId of entities) {
            const aiState = this.game.getComponent(entityId, "aiState");
            const rootTreeId = this.getNodeId(aiState.rootBehaviorTreeCollection, aiState.rootBehaviorTree);
            const rootTree = this.processor.getNodeByType(rootTreeId);
            if (rootTree) {
                rootTree.onPlacementPhaseStart(entityId, this.game);
            }
        }
    }

    /**
     * Called when an entity is removed - clear its state and debug data
     */
    onEntityRemoved(entityId) {
        this.processor.clearDebugData(entityId);
        this.removeBehaviorState(entityId);
    }

    /**
     * Main update loop - runs for all units with aiState
     */
    update(dt) {
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;

        // Track battle ticks for internal use
        if (!this._firstBattleTick) {
            this._firstBattleTick = true;
            this._battleTickCount = 0;
        }
        this._battleTickCount++;

        // Increment debugger tick for this evaluation cycle
        this.processor.debugTick();

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
        const deathState = this.game.getComponent(entityId, "deathState");

        // Skip dead/dying units - they shouldn't run behavior trees
        if (deathState && deathState.state !== this.enums.deathState.alive) return;

        // Skip units that are leaping - their movement is controlled by the ability
        const leaping = this.game.getComponent(entityId, "leaping");
        if (leaping && leaping.isLeaping) return;

        if (!aiState || !unitType) return;

        const rootTreeId = this.getNodeId(aiState.rootBehaviorTreeCollection, aiState.rootBehaviorTree);
        const rootTree = this.processor.getNodeByType(rootTreeId);
        if (!rootTree) {
            return;
        }

        // Evaluate behavior tree to get desired action
        const desiredAction = this.processor.evaluate(rootTreeId, entityId);

        // Check if we need to switch actions
        if (this.shouldSwitchAction(aiState, desiredAction)) {
            this.switchAction(entityId, aiState, desiredAction);
        }
    }

    getBehaviorEntities() {
        const entities = this.game.getEntitiesWith("aiState", "unitType");
        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        entities.sort((a, b) => a - b);
        return entities;
    }

    /**
     * Determine if we should switch from current action to desired action
     */
    shouldSwitchAction(aiState, desiredAction) {
        if (!desiredAction || !desiredAction.action || !desiredAction.meta) return false;
        if (aiState.currentAction == null) return true;

        // Get indices for desired action
        const desiredIndices = this.getNodeIndices(desiredAction.action);
        if (!desiredIndices) return false;

        // If the desired action is running, always continue with it
        if (desiredAction.status === 'running') {
            // Only switch if it's a different action (compare both collection and index)
            return aiState.currentAction !== desiredIndices.index ||
                   aiState.currentActionCollection !== desiredIndices.collection;
        }

        // For success status, allow switching to new action
        return true;
    }

    /**
     * Switch from current action to a new action
     */
    switchAction(entityId, aiState, desiredAction) {
        // Get indices for desired action
        const desiredIndices = this.getNodeIndices(desiredAction.action);
        if (!desiredIndices) return;

        const isNewAction = aiState.currentAction !== desiredIndices.index ||
                           aiState.currentActionCollection !== desiredIndices.collection;

        // End current action if switching to a different one
        if (isNewAction && aiState.currentAction != null) {
            const currentActionId = this.getNodeId(aiState.currentActionCollection, aiState.currentAction);
            const currentExecutor = this.processor.getNodeByType(currentActionId);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, this.game);
            }
        }

        // Update action state (store collection and index)
        aiState.currentAction = desiredIndices.index;
        aiState.currentActionCollection = desiredIndices.collection;

        // Store meta in BehaviorSystem (not in component)
        let meta = desiredAction.meta;
        while (meta.meta && meta.action) {
            const nestedIndices = this.getNodeIndices(meta.action);
            if (nestedIndices) {
                aiState.currentAction = nestedIndices.index;
                aiState.currentActionCollection = nestedIndices.collection;
            }
            meta = meta.meta;
        }
        this.setBehaviorMeta(entityId, meta);

        // Only call onStart for new actions
        if (isNewAction) {
            const newActionId = this.getNodeId(aiState.currentActionCollection, aiState.currentAction);
            const newExecutor = this.processor.getNodeByType(newActionId);
            if (newExecutor && newExecutor.onStart) {
                newExecutor.onStart(entityId, this.game);
            }
        }
    }

}
