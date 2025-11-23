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

        const enemies = game.combatSystem.findEnemiesInRange(
            entityId, pos, combat.visionRange, team
        );

        if (enemies.length === 0) return null;

        const target = this.selectTarget(pos, enemies, game);

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
