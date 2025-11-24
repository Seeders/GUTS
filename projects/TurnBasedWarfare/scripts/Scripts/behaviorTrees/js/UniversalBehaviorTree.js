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

        // Get context for decision-making
        const context = this.gatherContext(entityId, game);

        // Collect all behaviors from abilities that can provide them
        const behaviors = [];

        for (const ability of abilities) {
            // Check if ability can provide a behavior
            if (typeof ability.getBehavior === 'function') {
                const behavior = ability.getBehavior(entityId, game, context);
                if (behavior) {
                    // Calculate final score using utility if available, otherwise use priority
                    behavior.score = this.calculateBehaviorScore(behavior, context);
                    behaviors.push(behavior);
                }
            }
        }

        // If no behaviors available, return null
        if (behaviors.length === 0) return null;

        // Sort by score (highest first) and return the best one
        behaviors.sort((a, b) => b.score - a.score);
        return behaviors[0];
    }

    gatherContext(entityId, game) {
        // Gather situational context for decision-making
        const pos = game.getComponent(entityId, 'position');
        const health = game.getComponent(entityId, 'health');
        const team = game.getComponent(entityId, 'team');
        const unitType = game.getComponent(entityId, 'unitType');

        let nearbyEnemies = [];
        let nearbyAllies = [];

        if (pos && team) {
            // Find nearby units (within reasonable range)
            const allUnits = game.getEntitiesWith('position', 'team', 'health');

            for (const otherId of allUnits) {
                if (otherId === entityId) continue;

                const otherPos = game.getComponent(otherId, 'position');
                const otherTeam = game.getComponent(otherId, 'team');
                const otherHealth = game.getComponent(otherId, 'health');

                if (!otherPos || !otherTeam || !otherHealth || otherHealth.current <= 0) continue;

                const distance = Math.sqrt(
                    Math.pow(otherPos.x - pos.x, 2) +
                    Math.pow(otherPos.z - pos.z, 2)
                );

                if (distance < 300) { // Awareness range
                    if (otherTeam.team === team.team) {
                        nearbyAllies.push({ id: otherId, distance });
                    } else {
                        nearbyEnemies.push({ id: otherId, distance });
                    }
                }
            }
        }

        return {
            entityId,
            position: pos,
            health: health,
            healthPercent: health ? health.current / health.max : 1.0,
            team: team,
            unitType: unitType,
            nearbyEnemies: nearbyEnemies,
            nearbyAllies: nearbyAllies,
            isInCombat: nearbyEnemies.length > 0,
            isSafe: nearbyEnemies.length === 0,
            closestEnemyDistance: nearbyEnemies.length > 0 ? nearbyEnemies[0].distance : Infinity
        };
    }

    calculateBehaviorScore(behavior, context) {
        // Use utility if provided, otherwise fall back to priority
        if (behavior.utility !== undefined) {
            // Utility is 0-1, scale to comparable range with priorities
            return behavior.utility * 100;
        }

        // Fallback: use priority directly (for backward compatibility)
        return behavior.priority || 0;
    }
}
