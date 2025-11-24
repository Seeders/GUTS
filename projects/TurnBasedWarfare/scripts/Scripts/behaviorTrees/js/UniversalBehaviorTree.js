class UniversalBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');

        // Selector: Pick highest priority that can run
        const results = [
            () => this.checkPlayerOrder(aiState),
            () => this.checkBuildOrder(entityId, game),
            () => this.checkAbilityBehaviors(entityId, game),
            () => ({ action: "IDLE", priority: 0 })
        ];

        return this.select(results);
    }

    checkPlayerOrder(aiState) {
        if (!aiState || !aiState.targetPosition) return null;
        if (!aiState.meta || !aiState.meta.isPlayerOrder) return null;

        return {
            action: "MOVE_TO",
            target: aiState.targetPosition,
            priority: 10,
            data: {
                playerOrdered: true,
                preventEnemiesInRangeCheck: aiState.meta.preventEnemiesInRangeCheck || false
            }
        };
    }

    checkBuildOrder(entityId, game) {
        const buildState = game.getComponent(entityId, 'builder');
        if (!buildState || !buildState.assignedBuilding) return null;

        return {
            action: "BUILD",
            target: buildState.assignedBuilding,
            priority: 20,
            data: { buildingId: buildState.assignedBuilding }
        };
    }

    checkAbilityBehaviors(entityId, game) {
        // Get all abilities for this unit from the AbilitySystem
        if (!game.abilitySystem) return null;

        const abilities = game.abilitySystem.entityAbilities.get(entityId);
        if (!abilities || abilities.length === 0) return null;

        // Collect all behaviors from abilities that can provide them
        const behaviors = [];

        for (const ability of abilities) {
            // Check if ability can provide a behavior
            if (typeof ability.getBehavior === 'function') {
                const behavior = ability.getBehavior(entityId, game);
                if (behavior) {
                    behaviors.push(behavior);
                }
            }
        }

        // If no behaviors available, return null
        if (behaviors.length === 0) return null;

        // Sort by priority (highest first) and return the best one
        behaviors.sort((a, b) => b.priority - a.priority);
        return behaviors[0];
    }
}
