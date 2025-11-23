/**
 * BehaviorSystem - Master controller for unit AI
 * Evaluates behavior trees and executes actions for all units
 *
 * This system replaces the scattered AI logic with a unified approach:
 * - Behavior trees define WHAT units should do (goals)
 * - Actions define HOW to do it (execution)
 * - Single source of truth: UnitController component
 */
class BehaviorSystem extends BaseSystem {
    constructor(game) {
        super(game);

        // Register action executors
        this.actions = new Map();

        // Register behavior trees by unit type
        this.behaviorTrees = new Map();

        // Initialize from collections
        this.initializeFromCollections();
    }

    /**
     * Load actions and behavior trees from game collections
     */
    initializeFromCollections() {
        const collections = this.game.collections;

        // Register actions
        if (collections.actions) {
            Object.entries(collections.actions).forEach(([actionId, actionData]) => {
                this.registerActionFromData(actionId, actionData);
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
    registerActionFromData(actionId, actionData) {
        // The action class should be compiled and available via game context
        const ActionClass = this.game[actionId + 'Action'] || this.game[actionData.type + 'Action'];

        if (ActionClass) {
            const actionInstance = new ActionClass(this.game, actionData.parameters);
            this.actions.set(actionData.type, actionInstance);
        } else {
            console.warn(`Action class not found for: ${actionId}`);
        }
    }

    /**
     * Register a behavior tree from collection data
     */
    registerBehaviorTreeFromData(treeId, treeData) {
        // The tree class should be compiled and available via game context
        const TreeClass = this.game[treeId + 'BehaviorTree'] || this.game[treeData.unitType + 'BehaviorTree'];

        if (TreeClass) {
            const treeInstance = new TreeClass(this.game, treeData);
            this.behaviorTrees.set(treeData.unitType, treeInstance);
        } else {
            console.warn(`Behavior tree class not found for: ${treeId}`);
        }
    }

    /**
     * Main update loop - runs for all units with UnitController
     */
    update(dt) {
        const CT = this.game.componentTypes;

        // Get all entities with UnitController
        const entities = this.game.getEntitiesWith(CT.UNIT_CONTROLLER);

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
        const CT = this.game.componentTypes;
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);
        const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);

        if (!controller || !unitType) return;

        // Get behavior tree for this unit type
        const tree = this.behaviorTrees.get(unitType.id);
        if (!tree) {
            // No behavior tree for this unit type, skip
            return;
        }

        // Evaluate behavior tree to get desired action
        const desiredAction = tree.evaluate(entityId, this.game);

        // Check if we need to switch actions
        if (this.shouldSwitchAction(controller, desiredAction)) {
            this.switchAction(entityId, controller, desiredAction);
        }

        // Execute current action
        if (controller.currentAction) {
            this.executeAction(entityId, controller, dt);
        }
    }

    /**
     * Determine if we should switch from current action to desired action
     */
    shouldSwitchAction(controller, desiredAction) {
        // No current action, start new one
        if (!controller.currentAction) return true;

        // Different action type
        if (controller.currentAction !== desiredAction.action) {
            // Only switch if higher or equal priority
            return desiredAction.priority >= controller.actionPriority;
        }

        // Same action, different target
        if (controller.actionTarget !== desiredAction.target) {
            return desiredAction.priority >= controller.actionPriority;
        }

        return false;
    }

    /**
     * Switch from current action to a new action
     */
    switchAction(entityId, controller, desiredAction) {
        // End current action
        if (controller.currentAction) {
            const currentExecutor = this.actions.get(controller.currentAction);
            if (currentExecutor) {
                currentExecutor.onEnd(entityId, controller, this.game);
            }
        }

        // Start new action
        controller.currentAction = desiredAction.action;
        controller.actionTarget = desiredAction.target;
        controller.actionData = desiredAction.data || {};
        controller.actionPriority = desiredAction.priority;
        controller.actionStartTime = this.game.state.now;

        // Call onStart if exists
        const newExecutor = this.actions.get(controller.currentAction);
        if (newExecutor && newExecutor.onStart) {
            newExecutor.onStart(entityId, controller, this.game);
        }
    }

    /**
     * Execute the current action
     */
    executeAction(entityId, controller, dt) {
        const executor = this.actions.get(controller.currentAction);
        if (!executor) {
            console.warn(`No executor for action: ${controller.currentAction}`);
            return;
        }

        // Check if action can still run
        if (!executor.canExecute(entityId, controller, this.game)) {
            // Action is no longer valid, clear it
            executor.onEnd(entityId, controller, this.game);
            controller.currentAction = null;
            controller.actionTarget = null;
            return;
        }

        // Execute action
        const result = executor.execute(entityId, controller, this.game, dt);

        // Handle completion
        if (result.complete) {
            executor.onEnd(entityId, controller, this.game);
            controller.currentAction = null;
            controller.actionTarget = null;

            // Clear player order if it was a one-time command
            if (controller.playerOrder && !controller.playerOrder.persistent) {
                controller.playerOrder = null;
            }
        }
    }

    /**
     * Public API: Issue a player command to a unit
     */
    issuePlayerCommand(entityId, action, target, data = {}) {
        const CT = this.game.componentTypes;
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);

        if (!controller) {
            console.warn(`Cannot issue command to entity ${entityId}: no UnitController component`);
            return;
        }

        controller.playerOrder = {
            action: action,
            target: target,
            data: data,
            issuedTime: this.game.state.now,
            persistent: false  // One-time command
        };
    }

    /**
     * Public API: Clear player command for a unit
     */
    clearPlayerCommand(entityId) {
        const CT = this.game.componentTypes;
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);

        if (controller) {
            controller.playerOrder = null;
        }
    }

    /**
     * Debug: Get current action for an entity
     */
    getCurrentAction(entityId) {
        const CT = this.game.componentTypes;
        const controller = this.game.getComponent(entityId, CT.UNIT_CONTROLLER);

        if (!controller) return null;

        return {
            action: controller.currentAction,
            target: controller.actionTarget,
            priority: controller.actionPriority
        };
    }
}
