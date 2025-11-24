class UniversalBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const pos = game.getComponent(entityId, 'position');
        this.pathSize = this.game.gameManager.call('getPlacementGridSize');
        // Selector: Pick highest priority that can run
        const results = [
            () => this.checkPlayerOrder(pos, aiState, entityId, game),
            () => this.checkCombat(entityId, game),
            () => this.checkBuildOrder(entityId, game),
            () => this.checkAbilityBehaviors(entityId, game),
            () => ({ action: "IdleBehaviorAction", priority: 0 })
        ];

        return this.select(results);
    }

    checkPlayerOrder(pos, aiState, entityId, game) {
        // Read from playerOrder component
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.targetPosition) return null;
        if (!playerOrder.meta || !playerOrder.meta.isPlayerOrder) return null;

        // Use aiState.meta for behavior tree's own state tracking
        if(aiState.meta.reachedTarget || this.distance(pos, playerOrder.targetPosition) < this.pathSize){
            aiState.meta.reachedTarget = true;
            return null;
        }
        return {
            action: "MoveBehaviorAction",
            target: playerOrder.targetPosition,
            priority: 10,
            data: {
                playerOrdered: true,
                preventEnemiesInRangeCheck: playerOrder.meta.preventEnemiesInRangeCheck || false
            }
        };
    }

    onBattleEnd(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if(aiState.meta.reachedTarget){
            // Clear player order
            if (playerOrder) {
                playerOrder.targetPosition = null;
            }
            aiState.meta = {};
        }
    }

    checkBuildOrder(entityId, game) {
        // Read from playerOrder component
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.buildingId) return null;

        // Copy player order to aiState.meta for action execution
        const aiState = game.getComponent(entityId, 'aiState');
        if (aiState) {
            aiState.meta.buildingId = playerOrder.meta.buildingId;
            aiState.meta.buildingPosition = playerOrder.meta.buildingPosition;
            aiState.meta.isPlayerOrder = playerOrder.meta.isPlayerOrder;
        }

        return {
            action: "BuildBehaviorAction",
            target: playerOrder.meta.buildingId,
            priority: 20,
            data: {}
        };
    }

    checkCombat(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const combat = game.getComponent(entityId, 'combat');
        const team = game.getComponent(entityId, 'team');

        // Only units with combat component can fight
        if (!combat || !pos || !team) return null;

        // Respect preventEnemiesInRangeCheck flag (for force move orders)
        // Read from playerOrder component
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        const preventEnemiesInRangeCheck = playerOrder && playerOrder.meta && playerOrder.meta.preventEnemiesInRangeCheck;
        if (preventEnemiesInRangeCheck) {
            return null; // Skip combat when player wants to force move
        }

        // Find enemies in vision range
        const visionRange = combat.visionRange || combat.attackRange || 10;
        const enemies = this.findEnemiesInRange(entityId, pos, team.team, visionRange, game);

        if (enemies.length === 0) return null;

        const target = this.selectCombatTarget(entityId, pos, enemies, game);

        return {
            action: "AttackBehaviorAction",
            target: target,
            priority: 30
        };
    }

    findEnemiesInRange(entityId, pos, team, range, game) {
        let enemies = [];

        // Try to use gameManager if available
        if (game.gameManager && game.gameManager.getEnemies) {
            enemies = game.gameManager.getEnemies(entityId);
        } else {
            // Fallback: manually find enemies
            const allEntities = game.getAllEntityIds ? game.getAllEntityIds() : [];
            for (const otherId of allEntities) {
                if (otherId === entityId) continue;
                const otherTeam = game.getComponent(otherId, 'team');
                if (otherTeam && otherTeam.team !== team) {
                    enemies.push(otherId);
                }
            }
        }

        // Filter by range
        return enemies.filter(enemyId => {
            const enemyPos = game.getComponent(enemyId, 'position');
            if (!enemyPos) return false;
            const dist = this.distance(pos, enemyPos);
            return dist <= range;
        });
    }

    selectCombatTarget(entityId, pos, enemies, game) {
        // Read from combatState component
        const combatState = game.getComponent(entityId, 'combatState');

        // Prioritize retaliating against last attacker if they're still in range
        if (combatState && combatState.lastAttacker) {
            const attackerHealth = game.getComponent(combatState.lastAttacker, 'health');
            const attackerPos = game.getComponent(combatState.lastAttacker, 'position');

            // Check if attacker is still alive and in our enemy list
            if (attackerHealth && attackerHealth.current > 0 &&
                enemies.includes(combatState.lastAttacker) && attackerPos) {
                // Return the last attacker as priority target
                return combatState.lastAttacker;
            } else {
                // Attacker is dead or out of range, clear the retaliation
                combatState.lastAttacker = null;
                combatState.lastAttackTime = null;
            }
        }

        // Pick closest enemy (deterministic)
        let nearest = null;
        let minDist = Infinity;

        // Sort for determinism
        const sortedEnemies = enemies.sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        for (const enemyId of sortedEnemies) {
            const enemyPos = game.getComponent(enemyId, 'position');
            const dist = this.distance(pos, enemyPos);

            if (dist < minDist) {
                minDist = dist;
                nearest = enemyId;
            }
        }

        return nearest;
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

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
