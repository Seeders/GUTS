class PeasantBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        const controller = game.getComponent(entityId, game.componentTypes.UNIT_CONTROLLER);
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);

        // Selector: Pick highest priority that can run
        return this.select([
            () => this.checkPlayerOrder(controller),
            () => this.checkBuildOrder(entityId, game),
            () => this.checkMining(entityId, game),
            () => ({ action: "IDLE", priority: 0 })
        ]);
    }

    checkPlayerOrder(controller) {
        if (!controller.playerOrder) return null;

        const order = controller.playerOrder;
        return {
            action: order.action,
            target: order.target,
            priority: 10,
            playerOrdered: true
        };
    }

    checkBuildOrder(entityId, game) {
        const buildState = game.getComponent(entityId, game.componentTypes.BUILDER);
        if (!buildState || !buildState.assignedBuilding) return null;

        return {
            action: "BUILD",
            target: buildState.assignedBuilding,
            priority: 20,
            data: { buildingId: buildState.assignedBuilding }
        };
    }

    checkMining(entityId, game) {
        const team = game.getComponent(entityId, game.componentTypes.TEAM);
        const nearbyMine = this.findNearestMine(entityId, team.team, game);

        if (!nearbyMine) return null;

        return {
            action: "MINE",
            target: nearbyMine,
            priority: 5,
            data: { mineId: nearbyMine }
        };
    }

    findNearestMine(entityId, team, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);

        // Query all entities with RESOURCE component (gold mines)
        // Use gameManager if available, otherwise query directly
        let mines = game.getEntitiesWith('RESOURCE');
  

        let nearest = null;
        let minDist = Infinity;

        // Sort for determinism
        const sortedMines = Array.from(mines).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        for (const mineId of sortedMines) {
            const minePos = game.getComponent(mineId, game.componentTypes.POSITION);
            if (!minePos) continue;

            const dist = this.distance(pos, minePos);

            if (dist < minDist) {
                minDist = dist;
                nearest = mineId;
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
