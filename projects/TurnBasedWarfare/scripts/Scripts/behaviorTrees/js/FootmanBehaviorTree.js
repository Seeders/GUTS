class FootmanBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        return this.select([
            () => this.checkPlayerOrder(entityId, game),
            () => this.checkCombat(entityId, game),
            () => this.checkMoveOrder(entityId, game),
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }

    checkPlayerOrder(entityId, game) {
        const aiState = game.getComponent(entityId, "aiState");
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

    checkCombat(entityId, game) {
        const aiState = game.getComponent(entityId, "aiState");
        const pos = game.getComponent(entityId, "position");
        const combat = game.getComponent(entityId, "combat");
        const team = game.getComponent(entityId, "team");

        // Respect preventEnemiesInRangeCheck flag (for force move orders)
        // This matches old CombatAISystem behavior: line 105
        const preventEnemiesInRangeCheck = aiState.meta && aiState.meta.preventEnemiesInRangeCheck;
        if (preventEnemiesInRangeCheck) {
            return null; // Skip combat when player wants to force move
        }

        // Find enemies using gameManager or direct query
        let enemies;
        if (game.gameManager && game.gameManager.getEnemies) {
            enemies = game.gameManager.getEnemies(entityId);
        } else {
            // Fallback: manually find enemies
            enemies = [];
            const allEntities = game.getAllEntityIds ? game.getAllEntityIds() : [];
            for (const otherId of allEntities) {
                if (otherId === entityId) continue;
                const otherTeam = game.getComponent(otherId, "team");
                if (otherTeam && otherTeam.team !== team.team) {
                    enemies.push(otherId);
                }
            }
        }

        // Filter by vision range if combat component has it
        const visionRange = combat.visionRange || combat.attackRange || 10;
        const enemiesInRange = enemies.filter(enemyId => {
            const enemyPos = game.getComponent(enemyId, "position");
            if (!enemyPos) return false;
            const dist = this.distance(pos, enemyPos);
            return dist <= visionRange;
        });

        if (enemiesInRange.length === 0) return null;

        const target = this.selectTarget(pos, enemiesInRange, game);

        return {
            action: "ATTACK",
            target: target,
            priority: 30
        };
    }

    checkMoveOrder(entityId, game) {
        const aiState = game.getComponent(entityId, "aiState");
        if (!aiState || !aiState.targetPosition) return null;
        if (aiState.meta && aiState.meta.isPlayerOrder) return null; // Already handled by checkPlayerOrder

        // This is for non-player move orders (e.g., autonomous movement)
        return {
            action: "MOVE_TO",
            target: aiState.targetPosition,
            priority: 5,
            data: {}
        };
    }

    selectTarget(pos, enemies, game) {
        // Pick closest enemy (deterministic)
        let nearest = null;
        let minDist = Infinity;

        // Sort for determinism
        const sortedEnemies = enemies.sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        for (const enemyId of sortedEnemies) {
            const enemyPos = game.getComponent(enemyId, "position");
            const dist = this.distance(pos, enemyPos);

            if (dist < minDist) {
                minDist = dist;
                nearest = enemyId;
            }
        }

        return nearest;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
