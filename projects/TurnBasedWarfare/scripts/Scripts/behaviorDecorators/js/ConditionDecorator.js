/**
 * Condition Decorator
 * Only executes child if a condition is met
 *
 * Parameters:
 *   conditionType: string - Type of condition to check
 *     - 'hasComponent': Entity has specified component
 *     - 'componentValue': Component property matches value
 *     - 'sharedValue': Shared state value matches
 *     - 'custom': Uses custom condition function name
 *
 *   component: string - Component name (for hasComponent, componentValue)
 *   property: string - Property path (for componentValue, sharedValue)
 *   operator: string - Comparison operator: '==', '!=', '>', '<', '>=', '<=', 'exists', 'notExists'
 *   value: any - Value to compare against
 *   invert: boolean - Invert the condition result (default: false)
 *
 * Usage:
 *   {
 *     "fileName": "ConditionDecorator",
 *     "childAction": "AttackAction",
 *     "parameters": {
 *       "conditionType": "componentValue",
 *       "component": "health",
 *       "property": "current",
 *       "operator": ">",
 *       "value": 50
 *     }
 *   }
 */
class ConditionDecorator extends GUTS.BaseBehaviorDecorator {

    constructor(game, config) {
        super(game, config);

        this.conditionType = this.parameters.conditionType || 'sharedValue';
        this.component = this.parameters.component || null;
        this.property = this.parameters.property || null;
        this.operator = this.parameters.operator || '==';
        this.value = this.parameters.value;
        this.invert = this.parameters.invert || false;
        this.sharedKey = this.parameters.sharedKey || this.property;
    }

    /**
     * Execute - only run child if condition passes
     */
    execute(entityId, game) {
        const conditionMet = this.evaluateCondition(entityId, game);
        const finalResult = this.invert ? !conditionMet : conditionMet;

        if (finalResult) {
            // Condition passed - execute child
            const childResult = this.executeChild(entityId, game);
            if (childResult) {
                return {
                    ...childResult,
                    meta: {
                        ...childResult.meta,
                        conditionPassed: true,
                        conditionType: this.conditionType
                    }
                };
            }
            return childResult;
        }

        // Condition failed - return failure
        return this.failure();
    }

    /**
     * Evaluate the condition
     */
    evaluateCondition(entityId, game) {
        switch (this.conditionType) {
            case 'hasComponent':
                return this.checkHasComponent(entityId, game);

            case 'componentValue':
                return this.checkComponentValue(entityId, game);

            case 'sharedValue':
                return this.checkSharedValue(entityId, game);

            case 'custom':
                return this.checkCustomCondition(entityId, game);

            default:
                console.warn(`Unknown condition type: ${this.conditionType}`);
                return false;
        }
    }

    /**
     * Check if entity has a component
     */
    checkHasComponent(entityId, game) {
        const component = game.getComponent(entityId, this.component);
        return component !== null && component !== undefined;
    }

    /**
     * Check a component property value
     */
    checkComponentValue(entityId, game) {
        const component = game.getComponent(entityId, this.component);
        if (!component) return false;

        const actualValue = this.getNestedValue(component, this.property);
        return this.compare(actualValue, this.value);
    }

    /**
     * Check a shared state value
     */
    checkSharedValue(entityId, game) {
        const shared = this.getShared(entityId, game);
        const actualValue = this.getNestedValue(shared, this.sharedKey);
        return this.compare(actualValue, this.value);
    }

    /**
     * Check using a custom condition function registered on gameManager
     */
    checkCustomCondition(entityId, game) {
        const conditionName = this.parameters.conditionName;
        if (!conditionName) {
            console.warn('ConditionDecorator: custom condition requires conditionName parameter');
            return false;
        }

        try {
            return game.gameManager.call(conditionName, entityId, this.parameters);
        } catch (e) {
            console.warn(`ConditionDecorator: custom condition '${conditionName}' failed:`, e);
            return false;
        }
    }

    /**
     * Get a nested value from an object using dot notation
     */
    getNestedValue(obj, path) {
        if (!obj || !path) return undefined;

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }

        return current;
    }

    /**
     * Compare two values using the configured operator
     */
    compare(actual, expected) {
        switch (this.operator) {
            case '==':
            case 'equals':
                return actual == expected;

            case '===':
            case 'strictEquals':
                return actual === expected;

            case '!=':
            case 'notEquals':
                return actual != expected;

            case '!==':
            case 'strictNotEquals':
                return actual !== expected;

            case '>':
            case 'greaterThan':
                return actual > expected;

            case '<':
            case 'lessThan':
                return actual < expected;

            case '>=':
            case 'greaterOrEqual':
                return actual >= expected;

            case '<=':
            case 'lessOrEqual':
                return actual <= expected;

            case 'exists':
                return actual !== null && actual !== undefined;

            case 'notExists':
                return actual === null || actual === undefined;

            case 'contains':
                if (Array.isArray(actual)) {
                    return actual.includes(expected);
                }
                if (typeof actual === 'string') {
                    return actual.includes(expected);
                }
                return false;

            case 'notContains':
                if (Array.isArray(actual)) {
                    return !actual.includes(expected);
                }
                if (typeof actual === 'string') {
                    return !actual.includes(expected);
                }
                return true;

            default:
                console.warn(`Unknown operator: ${this.operator}`);
                return false;
        }
    }
}
