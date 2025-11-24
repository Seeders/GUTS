class MineGoldAction extends GUTS.BaseAction {
    static TYPE = "MINE";
    static PRIORITY = 5;

    canExecute(entityId, controller, game) {
        const mineId = controller.actionTarget;
        const mine = game.goldMineSystem.getMine(mineId);
        return mine && mine.isActive;
    }

    execute(entityId, controller, game, dt) {
        const state = controller.actionData.state || 'traveling_to_mine';

        switch (state) {
            case 'traveling_to_mine':
                return this.travelToMine(entityId, controller, game);
            case 'mining':
                return this.doMining(entityId, controller, game);
            case 'traveling_to_depot':
                return this.travelToDepot(entityId, controller, game);
            case 'depositing':
                return this.doDepositing(entityId, controller, game);
        }
    }

    travelToMine(entityId, controller, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const minePos = game.getComponent(controller.actionTarget, game.componentTypes.POSITION);

        if (this.distance(pos, minePos) < this.parameters.miningRange) {
            if (game.goldMineSystem.canMine(controller.actionTarget, entityId)) {
                controller.actionData.state = 'mining';
                controller.actionData.miningStartTime = game.state.now;
                return { complete: false };
            }
            return { complete: false };
        }

        const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
        vel.targetX = minePos.x;
        vel.targetZ = minePos.z;
        return { complete: false };
    }

    doMining(entityId, controller, game) {
        const elapsed = game.state.now - controller.actionData.miningStartTime;

        if (elapsed >= this.parameters.miningDuration) {
            controller.actionData.hasGold = true;
            controller.actionData.goldAmt = this.parameters.goldPerTrip;
            controller.actionData.state = 'traveling_to_depot';
            game.goldMineSystem.releaseMine(controller.actionTarget, entityId);
            return { complete: false };
        }

        return { complete: false };
    }

    travelToDepot(entityId, controller, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const depot = this.findNearestDepot(entityId, game);

        if (!depot) {
            return { complete: true, failed: true };
        }

        const depotPos = game.getComponent(depot, game.componentTypes.POSITION);

        if (this.distance(pos, depotPos) < this.parameters.depositRange) {
            controller.actionData.state = 'depositing';
            controller.actionData.depositStartTime = game.state.now;
            return { complete: false };
        }

        const vel = game.getComponent(entityId, game.componentTypes.VELOCITY);
        vel.targetX = depotPos.x;
        vel.targetZ = depotPos.z;
        return { complete: false };
    }

    doDepositing(entityId, controller, game) {
        const elapsed = game.state.now - controller.actionData.depositStartTime;

        if (elapsed >= this.parameters.depositDuration) {
            const team = game.getComponent(entityId, game.componentTypes.TEAM);
            game.goldSystem.addGold(team.team, controller.actionData.goldAmt);

            // Reset to mine again
            controller.actionData.state = 'traveling_to_mine';
            controller.actionData.hasGold = false;
            return { complete: false };
        }

        return { complete: false };
    }

    findNearestDepot(entityId, game) {
        const pos = game.getComponent(entityId, game.componentTypes.POSITION);
        const team = game.getComponent(entityId, game.componentTypes.TEAM);
        const townHalls = game.getEntitiesWith(
            game.componentTypes.POSITION,
            game.componentTypes.TEAM,
            game.componentTypes.UNIT_TYPE
        );

        let nearest = null;
        let minDist = Infinity;

        for (const thId of townHalls) {
            const thTeam = game.getComponent(thId, game.componentTypes.TEAM);
            const thType = game.getComponent(thId, game.componentTypes.UNIT_TYPE);
            const thPos = game.getComponent(thId, game.componentTypes.POSITION);

            if (thTeam.team === team.team && thType.id === 'townHall') {
                const dist = this.distance(pos, thPos);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = thId;
                }
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
