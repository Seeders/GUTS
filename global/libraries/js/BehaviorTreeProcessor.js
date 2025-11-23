/**
 * Shared Behavior Tree Processor
 * Used by both the game (BehaviorSystem) and editor (simulation)
 * Provides a single source of truth for behavior tree evaluation logic
 */
class BehaviorTreeProcessor {
    /**
     * Evaluate a behavior tree and return the selected action
     * @param {Object} nodes - The behavior tree nodes (from the nodes property)
     * @param {Object|BehaviorTreeBlackboard} state - The current state/conditions (plain object or Blackboard)
     * @param {string} rootNode - The name of the root node (default: 'root')
     * @returns {Object} - { success: boolean, action: string, target: any, priority: number, activePath: string[] }
     */
    static evaluate(nodes, state, rootNode = 'root') {
        // Convert plain object to blackboard if needed
        const blackboard = this.ensureBlackboard(state);
        return this.evaluateNode(rootNode, nodes, blackboard, []);
    }

    /**
     * Ensure we have a blackboard instance
     * @private
     */
    static ensureBlackboard(state) {
        // If it's already a Blackboard instance, return it
        if (state && state.constructor && state.constructor.name === 'BehaviorTreeBlackboard') {
            return state;
        }

        // If GUTS.BehaviorTreeBlackboard is available, create instance
        if (typeof GUTS !== 'undefined' && GUTS.BehaviorTreeBlackboard) {
            const blackboard = new GUTS.BehaviorTreeBlackboard();
            // Copy state into blackboard
            if (state && typeof state === 'object') {
                for (const [key, value] of Object.entries(state)) {
                    blackboard.set(key, value);
                }
            }
            return blackboard;
        }

        // Fallback: wrap plain object with get method
        return {
            get: (path) => {
                const parts = path.split('.');
                let current = state;
                for (const part of parts) {
                    if (current && typeof current === 'object') {
                        current = current[part];
                    } else {
                        return undefined;
                    }
                }
                return current;
            }
        };
    }

    /**
     * Recursively evaluate a node in the behavior tree
     * @private
     */
    static evaluateNode(nodeName, nodes, state, activePath = []) {
        const node = nodes[nodeName];
        if (!node) {
            return { success: false, action: null, activePath };
        }

        activePath = [...activePath, nodeName];

        switch (node.type) {
            case 'selector':
                return this.evaluateSelector(node, nodes, state, activePath);

            case 'sequence':
                return this.evaluateSequence(node, nodes, state, activePath);

            case 'condition':
                return this.evaluateCondition(node, nodes, state, activePath);

            case 'action':
                return this.evaluateAction(node, state, activePath);

            default:
                console.warn(`Unknown node type: ${node.type}`);
                return { success: false, action: null, activePath };
        }
    }

    /**
     * Evaluate a selector node - try children until one succeeds
     * @private
     */
    static evaluateSelector(node, nodes, state, activePath) {
        for (const childName of node.children || []) {
            const result = this.evaluateNode(childName, nodes, state, activePath);
            if (result.success) {
                return result;
            }
        }
        return { success: false, action: null, activePath };
    }

    /**
     * Evaluate a sequence node - execute children in order, all must succeed
     * @private
     */
    static evaluateSequence(node, nodes, state, activePath) {
        let lastResult = { success: true, action: null, activePath };

        for (const childName of node.children || []) {
            const result = this.evaluateNode(childName, nodes, state, activePath);
            if (!result.success) {
                return { success: false, action: null, activePath };
            }
            // Keep track of the last action found
            if (result.action) {
                lastResult = result;
            }
        }

        return lastResult;
    }

    /**
     * Evaluate a condition node - check if condition is met, then evaluate onSuccess
     * @private
     */
    static evaluateCondition(node, nodes, state, activePath) {
        const conditionMet = this.checkCondition(node.condition, state);

        if (conditionMet && node.onSuccess) {
            return this.evaluateNode(node.onSuccess, nodes, state, activePath);
        }

        return { success: conditionMet, action: null, activePath };
    }

    /**
     * Evaluate an action node - return the action to execute
     * @private
     */
    static evaluateAction(node, blackboard, activePath) {
        // Resolve action and target from blackboard if they're variable references
        let action = node.action;
        let target = node.target;

        if (typeof action === 'string' && !action.match(/^[A-Z_]+$/)) {
            // It might be a variable reference
            const resolved = blackboard.get ? blackboard.get(action) : undefined;
            if (resolved !== undefined) {
                action = resolved;
            }
        }

        if (typeof target === 'string' && !target.match(/^[A-Z_]+$/)) {
            // It might be a variable reference
            const resolved = blackboard.get ? blackboard.get(target) : undefined;
            if (resolved !== undefined) {
                target = resolved;
            }
        }

        return {
            success: true,
            action,
            target,
            priority: node.priority || 0,
            activePath
        };
    }

    /**
     * Check if a condition is met given the current state
     * @param {string} condition - The condition string to evaluate
     * @param {Object|BehaviorTreeBlackboard} state - The current state/conditions
     * @returns {boolean} - Whether the condition is met
     */
    static checkCondition(condition, state) {
        if (!condition) return false;

        // Use Blackboard evaluation if available
        if (typeof GUTS !== 'undefined' && GUTS.BehaviorTreeBlackboard && GUTS.BehaviorTreeBlackboard.evaluateCondition) {
            return GUTS.BehaviorTreeBlackboard.evaluateCondition(condition, state);
        }

        // Fallback to simple evaluation
        try {
            // Build context from state
            const context = {};

            if (state.getAll) {
                // It's a blackboard
                for (const [path, metadata] of state.getAll()) {
                    const parts = path.split('.');
                    if (parts.length === 1) {
                        context[path] = metadata.value;
                    }
                }
            } else {
                // It's a plain object
                Object.assign(context, state);
            }

            // Replace constants (e.g., MOVE_TO) with string literals
            let evalStr = condition.replace(/\b([A-Z_]+)\b/g, '"$1"');

            // Create function with context
            const func = new Function(...Object.keys(context), `return ${evalStr};`);
            return func(...Object.values(context)) || false;
        } catch (e) {
            // If evaluation fails, treat as a simple boolean lookup
            return state.get ? state.get(condition) : state[condition] || false;
        }
    }

    /**
     * Escape special regex characters in a string
     * @private
     */
    static escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Extract all condition strings from a behavior tree
     * Useful for setting up simulation variables or debugging
     * @param {Object} nodes - The behavior tree nodes
     * @returns {string[]} - Array of unique condition strings
     */
    static extractConditions(nodes) {
        const conditions = new Set();

        const traverse = (nodeName) => {
            const node = nodes[nodeName];
            if (!node) return;

            if (node.type === 'condition' && node.condition) {
                conditions.add(node.condition);
            }

            if (node.children && Array.isArray(node.children)) {
                node.children.forEach(child => traverse(child));
            }
            if (node.onSuccess) {
                traverse(node.onSuccess);
            }
        };

        if (nodes.root) {
            traverse('root');
        }

        return Array.from(conditions);
    }

    /**
     * Validate a behavior tree structure
     * @param {Object} nodes - The behavior tree nodes
     * @returns {Object} - { valid: boolean, errors: string[] }
     */
    static validate(nodes) {
        const errors = [];

        const validateNode = (nodeName, visited = new Set()) => {
            if (visited.has(nodeName)) {
                errors.push(`Circular reference detected: ${nodeName}`);
                return;
            }

            visited.add(nodeName);

            const node = nodes[nodeName];
            if (!node) {
                errors.push(`Node not found: ${nodeName}`);
                return;
            }

            // Validate node type
            const validTypes = ['selector', 'sequence', 'condition', 'action'];
            if (!validTypes.includes(node.type)) {
                errors.push(`Invalid node type "${node.type}" for node: ${nodeName}`);
            }

            // Validate children
            if (node.children) {
                if (!Array.isArray(node.children)) {
                    errors.push(`Children must be an array for node: ${nodeName}`);
                } else {
                    node.children.forEach(childName => {
                        validateNode(childName, new Set(visited));
                    });
                }
            }

            // Validate onSuccess
            if (node.onSuccess) {
                validateNode(node.onSuccess, new Set(visited));
            }

            // Validate action nodes have action specified
            if (node.type === 'action' && !node.action) {
                errors.push(`Action node missing action property: ${nodeName}`);
            }

            // Validate condition nodes have condition specified
            if (node.type === 'condition' && !node.condition) {
                errors.push(`Condition node missing condition property: ${nodeName}`);
            }
        };

        if (!nodes.root) {
            errors.push('Missing root node');
        } else {
            validateNode('root');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehaviorTreeProcessor;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.BehaviorTreeProcessor = BehaviorTreeProcessor;
}
