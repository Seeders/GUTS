/**
 * Behavior Tree Blackboard System
 * Manages variables and state for behavior tree simulation and execution
 * Similar to Unity's Behavior Designer blackboard
 */
class BehaviorTreeBlackboard {
    constructor() {
        this.variables = new Map();
    }

    /**
     * Set a variable value
     * @param {string} path - Variable path (e.g., "hasPlayerOrder" or "playerOrder.action")
     * @param {any} value - The value to set
     * @param {string} type - The variable type (boolean, string, number, object, etc.)
     */
    set(path, value, type = 'auto') {
        if (type === 'auto') {
            type = this.inferType(value);
        }

        this.variables.set(path, {
            value,
            type,
            path
        });
    }

    /**
     * Get a variable value
     * @param {string} path - Variable path
     * @returns {any} - The variable value, or undefined if not found
     */
    get(path) {
        // First try direct lookup
        const variable = this.variables.get(path);
        if (variable !== undefined) {
            return variable.value;
        }

        // Try nested path lookup (e.g., "playerOrder.action")
        const parts = path.split('.');
        if (parts.length > 1) {
            const rootVar = this.variables.get(parts[0]);
            if (rootVar && rootVar.type === 'object') {
                let current = rootVar.value;
                for (let i = 1; i < parts.length; i++) {
                    if (current && typeof current === 'object') {
                        current = current[parts[i]];
                    } else {
                        return undefined;
                    }
                }
                return current;
            }
        }

        return undefined;
    }

    /**
     * Check if a variable exists
     * @param {string} path - Variable path
     * @returns {boolean}
     */
    has(path) {
        return this.get(path) !== undefined;
    }

    /**
     * Get variable metadata
     * @param {string} path - Variable path
     * @returns {Object|undefined} - Variable metadata
     */
    getMetadata(path) {
        return this.variables.get(path);
    }

    /**
     * Get all variables
     * @returns {Map}
     */
    getAll() {
        return this.variables;
    }

    /**
     * Clear all variables
     */
    clear() {
        this.variables.clear();
    }

    /**
     * Infer the type of a value
     * @private
     */
    inferType(value) {
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') return 'number';
        if (typeof value === 'string') return 'string';
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object') return 'object';
        return 'unknown';
    }

    /**
     * Extract variables from a behavior tree
     * Analyzes conditions and actions to find all referenced variables
     * @param {Object} nodes - The behavior tree nodes
     * @returns {Map} - Map of variable paths to inferred types
     */
    static extractVariables(nodes) {
        const variables = new Map();

        const traverse = (nodeName) => {
            const node = nodes[nodeName];
            if (!node) return;

            // Extract from conditions
            if (node.type === 'condition' && node.condition) {
                const condVars = this.parseCondition(node.condition);
                condVars.forEach(({ name, type }) => {
                    if (!variables.has(name)) {
                        variables.set(name, type);
                    }
                });
            }

            // Extract from action targets and properties
            if (node.type === 'action') {
                if (node.action && typeof node.action === 'string') {
                    const actionVars = this.parseExpression(node.action);
                    actionVars.forEach(({ name, type }) => {
                        if (!variables.has(name)) {
                            variables.set(name, type);
                        }
                    });
                }

                if (node.target && typeof node.target === 'string') {
                    const targetVars = this.parseExpression(node.target);
                    targetVars.forEach(({ name, type }) => {
                        if (!variables.has(name)) {
                            variables.set(name, type);
                        }
                    });
                }
            }

            // Traverse children
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

        return variables;
    }

    /**
     * Parse a condition string to extract variable names
     * @private
     */
    static parseCondition(condition) {
        const variables = [];

        // Match variable patterns:
        // - hasPlayerOrder
        // - playerOrder.action
        // - playerOrder.action === "MOVE_TO"
        // - hasEnemiesInRange && distance < 100

        // First, find all identifiers (words that could be variables)
        const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
        const matches = condition.match(identifierRegex) || [];

        // Filter out JavaScript keywords and operators
        const keywords = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'new', 'return', 'if', 'else', 'for', 'while']);

        matches.forEach(match => {
            if (!keywords.has(match) && !match.match(/^[A-Z_]+$/)) { // Ignore constants like MOVE_TO
                // Determine if it's a nested property
                const parts = match.split('.');
                const rootVar = parts[0];

                if (parts.length === 1) {
                    // Simple variable (probably boolean)
                    variables.push({ name: match, type: 'boolean' });
                } else {
                    // Nested variable (object with properties)
                    variables.push({ name: rootVar, type: 'object' });

                    // Also track the full path for easier editing
                    variables.push({ name: match, type: 'auto' });
                }
            }
        });

        return variables;
    }

    /**
     * Parse an expression to extract variable names
     * @private
     */
    static parseExpression(expression) {
        // Similar to parseCondition but for simpler expressions
        const variables = [];

        // Match variable patterns
        const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
        const matches = expression.match(identifierRegex) || [];

        const keywords = new Set(['true', 'false', 'null', 'undefined']);

        matches.forEach(match => {
            if (!keywords.has(match) && !match.match(/^[A-Z_]+$/)) {
                const parts = match.split('.');
                const rootVar = parts[0];

                if (parts.length > 1) {
                    variables.push({ name: rootVar, type: 'object' });
                    variables.push({ name: match, type: 'auto' });
                } else {
                    variables.push({ name: match, type: 'auto' });
                }
            }
        });

        return variables;
    }

    /**
     * Create a default value for a variable type
     * @param {string} type - Variable type
     * @returns {any} - Default value
     */
    static getDefaultValue(type) {
        switch (type) {
            case 'boolean': return false;
            case 'number': return 0;
            case 'string': return '';
            case 'object': return {};
            case 'array': return [];
            default: return null;
        }
    }

    /**
     * Evaluate a condition expression using the blackboard
     * @param {string} condition - The condition string
     * @param {BehaviorTreeBlackboard} blackboard - The blackboard instance
     * @returns {boolean} - Whether the condition is true
     */
    static evaluateCondition(condition, blackboard) {
        try {
            // Create a safe evaluation context with blackboard variables
            const context = {};

            // Add all variables to context
            for (const [path, metadata] of blackboard.getAll()) {
                const parts = path.split('.');
                if (parts.length === 1) {
                    context[path] = metadata.value;
                } else {
                    // Handle nested paths
                    const rootVar = parts[0];
                    if (!context[rootVar]) {
                        context[rootVar] = {};
                    }
                    let current = context[rootVar];
                    for (let i = 1; i < parts.length - 1; i++) {
                        if (!current[parts[i]]) {
                            current[parts[i]] = {};
                        }
                        current = current[parts[i]];
                    }
                    current[parts[parts.length - 1]] = metadata.value;
                }
            }

            // Replace constants (e.g., MOVE_TO) with string literals
            let evalStr = condition.replace(/\b([A-Z_]+)\b/g, '"$1"');

            // Create function with context
            const func = new Function(...Object.keys(context), `return ${evalStr};`);
            return func(...Object.values(context)) || false;
        } catch (e) {
            console.warn('Failed to evaluate condition:', condition, e);
            return false;
        }
    }

    /**
     * Resolve a value from the blackboard (for action targets, etc.)
     * @param {string} expression - The expression to resolve
     * @param {BehaviorTreeBlackboard} blackboard - The blackboard instance
     * @returns {any} - The resolved value
     */
    static resolveValue(expression, blackboard) {
        // If it's a constant (all caps), return as string
        if (expression.match(/^[A-Z_]+$/)) {
            return expression;
        }

        // Otherwise try to get from blackboard
        return blackboard.get(expression);
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehaviorTreeBlackboard;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.BehaviorTreeBlackboard = BehaviorTreeBlackboard;
}
