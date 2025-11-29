/**
 * HealthCheckAction - Condition action
 * Checks if entity's health is above or below a threshold
 *
 * Parameters:
 *   threshold: number (default: 0.5) - Health percentage threshold (0-1)
 *   comparison: string (default: 'below') - 'below', 'above', 'equals'
 *   usePercentage: boolean (default: true) - Use percentage or absolute value
 *
 * Returns SUCCESS if condition is met, FAILURE otherwise
 */
class HealthCheckAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const threshold = params.threshold !== undefined ? params.threshold : 0.5;
        const comparison = params.comparison || 'below';
        const usePercentage = params.usePercentage !== false;

        const health = game.getComponent(entityId, 'health');
        if (!health) {
            return this.failure();
        }

        let currentValue;
        if (usePercentage) {
            currentValue = health.current / health.max;
        } else {
            currentValue = health.current;
        }

        let conditionMet = false;
        switch (comparison) {
            case 'below':
                conditionMet = currentValue < threshold;
                break;
            case 'above':
                conditionMet = currentValue > threshold;
                break;
            case 'equals':
                conditionMet = Math.abs(currentValue - threshold) < 0.01;
                break;
            case 'atOrBelow':
                conditionMet = currentValue <= threshold;
                break;
            case 'atOrAbove':
                conditionMet = currentValue >= threshold;
                break;
        }

        if (conditionMet) {
            return this.success({
                healthPercent: health.current / health.max,
                healthCurrent: health.current,
                healthMax: health.max,
                threshold,
                comparison
            });
        }

        return this.failure();
    }
}
