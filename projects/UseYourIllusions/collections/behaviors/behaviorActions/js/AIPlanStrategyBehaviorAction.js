/**
 * AIPlanStrategyBehaviorAction - Determines strategic direction for heuristic AI
 *
 * Analyzes game state from aiHeuristicState and selects a strategy:
 * - "economy": Early game, need production buildings
 * - "aggression": We're stronger, press the advantage
 * - "defense": Enemy is stronger, build defensive units
 * - "counter": Even match, build units that counter visible enemies
 *
 * Updates the strategicPlan with target buildings and unit composition.
 */
class AIPlanStrategyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiHeuristicState');
        if (!aiState) {
            return this.failure();
        }

        const collections = game.getCollections();
        const weights = collections.aiConfig?.heuristicWeights;
        const counters = collections.aiConfig?.counters;

        if (!weights || !counters) {
            return this.failure();
        }

        const round = game.state.round || 1;
        const thresholds = weights.strategyThresholds;

        // Determine strategy based on game state
        const strategy = this.selectStrategy(aiState, round, thresholds);
        aiState.currentStrategy = strategy;

        // Update strategic plan based on strategy
        this.updateStrategicPlan(aiState, strategy, collections, counters, weights);

        return this.success();
    }

    selectStrategy(aiState, round, thresholds) {
        const hasProductionBuilding = this.hasProductionBuilding(aiState.ownBuildings);
        const ownPower = aiState.ownArmyPower || 0;
        const enemyPower = aiState.estimatedEnemyPower || 0;

        // Early game: prioritize getting a production building
        if (round <= thresholds.economyRoundLimit && !hasProductionBuilding) {
            return 'economy';
        }

        // No visible enemies yet - default to economy/building up
        if (enemyPower === 0) {
            return hasProductionBuilding ? 'counter' : 'economy';
        }

        // Calculate power ratio
        const powerRatio = enemyPower > 0 ? ownPower / enemyPower : 2.0;

        // Enemy significantly stronger - defensive build
        if (powerRatio < (1 / thresholds.defenseStrengthRatio)) {
            return 'defense';
        }

        // We're significantly stronger - press advantage
        if (powerRatio > thresholds.aggressionStrengthRatio &&
            ownPower >= thresholds.minArmyValueForAggression) {
            return 'aggression';
        }

        // Even match - build counters
        return 'counter';
    }

    hasProductionBuilding(ownBuildings) {
        if (!ownBuildings) return false;

        const productionBuildings = ['barracks', 'fletchersHall', 'mageTower'];
        for (const building of productionBuildings) {
            if (ownBuildings[building] && ownBuildings[building] > 0) {
                return true;
            }
        }
        return false;
    }

    updateStrategicPlan(aiState, strategy, collections, counters, weights) {
        const plan = aiState.strategicPlan || { targetBuildings: [], targetUnits: {} };

        switch (strategy) {
            case 'economy':
                this.planEconomy(plan, aiState, counters);
                break;
            case 'defense':
                this.planDefense(plan, aiState, counters);
                break;
            case 'aggression':
                this.planAggression(plan, aiState, counters);
                break;
            case 'counter':
                this.planCounter(plan, aiState, counters);
                break;
        }

        aiState.strategicPlan = plan;
    }

    planEconomy(plan, aiState, counters) {
        // Prioritize getting first production building
        const buildingPriority = counters.buildingPriority;
        const targetBuildings = [];

        // Find buildings we don't have
        for (const [buildingId, info] of Object.entries(buildingPriority)) {
            if (!aiState.ownBuildings?.[buildingId]) {
                targetBuildings.push({ id: buildingId, priority: info.priority });
            }
        }

        // Sort by priority
        targetBuildings.sort((a, b) => b.priority - a.priority);
        plan.targetBuildings = targetBuildings.map(b => b.id);

        // Default unit composition - balanced
        plan.targetUnits = {
            '1_s_barbarian': 2,
            '1_d_archer': 1
        };
    }

    planDefense(plan, aiState, counters) {
        // Defensive units - tanky frontline
        plan.targetUnits = {};

        // Build counters for what we see, favoring tanky units
        const visibleEnemies = aiState.visibleEnemyUnits || {};

        for (const [enemyType, count] of Object.entries(visibleEnemies)) {
            const counterUnits = this.getCountersFor(enemyType, counters);
            for (const counterUnit of counterUnits) {
                const unitInfo = counters.units[counterUnit];
                // Favor tanks for defense
                if (unitInfo?.tags?.includes('tank')) {
                    plan.targetUnits[counterUnit] = (plan.targetUnits[counterUnit] || 0) + Math.ceil(count * 1.5);
                } else {
                    plan.targetUnits[counterUnit] = (plan.targetUnits[counterUnit] || 0) + count;
                }
            }
        }

        // Default to barbarians if no specific counters
        if (Object.keys(plan.targetUnits).length === 0) {
            plan.targetUnits = { '1_s_barbarian': 3 };
        }

        plan.targetBuildings = [];
    }

    planAggression(plan, aiState, counters) {
        // Aggressive units - high damage, fast
        plan.targetUnits = {};

        const visibleEnemies = aiState.visibleEnemyUnits || {};

        for (const [enemyType, count] of Object.entries(visibleEnemies)) {
            const counterUnits = this.getCountersFor(enemyType, counters);
            for (const counterUnit of counterUnits) {
                plan.targetUnits[counterUnit] = (plan.targetUnits[counterUnit] || 0) + count;
            }
        }

        // Add extra offensive units
        if (Object.keys(plan.targetUnits).length === 0) {
            plan.targetUnits = {
                '1_s_barbarian': 2,
                '1_d_archer': 2
            };
        }

        plan.targetBuildings = [];
    }

    planCounter(plan, aiState, counters) {
        // Build units that specifically counter visible enemies
        plan.targetUnits = {};

        const visibleEnemies = aiState.visibleEnemyUnits || {};

        for (const [enemyType, count] of Object.entries(visibleEnemies)) {
            const counterUnits = this.getCountersFor(enemyType, counters);
            for (const counterUnit of counterUnits) {
                plan.targetUnits[counterUnit] = (plan.targetUnits[counterUnit] || 0) + Math.ceil(count * 1.2);
            }
        }

        // Default balanced composition if no visible enemies
        if (Object.keys(plan.targetUnits).length === 0) {
            plan.targetUnits = {
                '1_s_barbarian': 2,
                '1_d_archer': 2
            };
        }

        // Check if we need more buildings for desired units
        plan.targetBuildings = this.getBuildingsForUnits(plan.targetUnits, aiState.ownBuildings, counters);
    }

    getCountersFor(enemyType, counters) {
        // Find units that are strong against this enemy type
        const counterUnits = [];

        for (const [unitId, unitInfo] of Object.entries(counters.units)) {
            if (unitInfo.strongAgainst && unitInfo.strongAgainst.includes(enemyType)) {
                counterUnits.push(unitId);
            }
        }

        // If no specific counters, return balanced options
        if (counterUnits.length === 0) {
            return ['1_s_barbarian', '1_d_archer'];
        }

        return counterUnits;
    }

    getBuildingsForUnits(targetUnits, ownBuildings, counters) {
        const neededBuildings = [];

        for (const unitId of Object.keys(targetUnits)) {
            // Find which building produces this unit
            for (const [buildingId, buildingInfo] of Object.entries(counters.buildingPriority)) {
                if (buildingInfo.providesUnits.includes(unitId)) {
                    if (!ownBuildings?.[buildingId] && !neededBuildings.includes(buildingId)) {
                        neededBuildings.push(buildingId);
                    }
                }
            }
        }

        return neededBuildings;
    }
}
