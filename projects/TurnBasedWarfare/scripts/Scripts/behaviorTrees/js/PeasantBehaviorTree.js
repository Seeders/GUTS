class PeasantBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const pos = game.getComponent(entityId, 'position');

        // Selector: Pick highest priority that can run
        const results = [
            () => this.checkPlayerOrder(aiState),
            () => this.checkBuildOrder(entityId, game),
            () => this.checkMining(entityId, game),
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

    checkMining(entityId, game) {
        const team = game.getComponent(entityId, 'team');
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
        const pos = game.getComponent(entityId, "position");

        // Query all entities with RESOURCE component (gold mines)
        // Use gameManager if available, otherwise query directly
        let buildings = game.getEntitiesWith('building');
  

        let nearest = null;
        let minDist = Infinity;

        // Sort for determinism
        const sortedBuildings = Array.from(buildings).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        for (const buildingId of sortedBuildings) {
            const buildingComp = game.getComponent(buildingId, "building");
            if(buildingComp.type != "goldMine") continue;
            const buildingPos = game.getComponent(buildingId, "position");
            if (!buildingPos) continue;

            const dist = this.distance(pos, buildingPos);

            if (dist < minDist) {
                minDist = dist;
                nearest = buildingId;
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
