class FootmanBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
console.log('evaluating', entityId, game);
        return this.select([
            () => this.checkPlayerOrder(entityId, game),
            () => this.checkCombat(entityId, game),
            () => this.checkMoveOrder(entityId, game),
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }

    checkPlayerOrder(entityId, game) {
        const controller = game.getComponent(entityId, game.componentTypes.UNIT_CONTROLLER);
        if (!controller.playerOrder) return null;

        return {
            action: controller.playerOrder.action,
            target: controller.playerOrder.target,
            priority: 10,
            playerOrdered: true
        };
    }

    checkCombat(entityId, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const combat = game.getComponent(entityId, game.componentTypes.COMBAT);
        const team = game.getComponent(entityId, game.componentTypes.TEAM);

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
                const otherTeam = game.getComponent(otherId, game.componentTypes.TEAM);
                if (otherTeam && otherTeam.team !== team.team) {
                    enemies.push(otherId);
                }
            }
        }

        // Filter by vision range if combat component has it
        const visionRange = combat.visionRange || combat.attackRange || 10;
        const enemiesInRange = enemies.filter(enemyId => {
            const enemyPos = game.getComponent(enemyId, game.componentTypes.POSITION);
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
        const controller = game.getComponent(entityId, game.componentTypes.UNIT_CONTROLLER);
        if (!controller.playerOrder || controller.playerOrder.action !== "MOVE_TO") {
            return null;
        }

        return {
            action: "MOVE_TO",
            target: controller.playerOrder.target,
            priority: 10
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
            const enemyPos = game.getComponent(enemyId, game.componentTypes.POSITION);
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
