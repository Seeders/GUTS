class MineGoldBehaviorAction extends GUTS.BaseBehaviorAction {
    static TYPE = "MINE";
    static PRIORITY = 5;

    canExecute(entityId, controller, game) {
        const mineId = controller.actionTarget;
        const mine = game.getComponent(mineId, 'goldMine');
        return !!mine;
    }

    onStart(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (!aiState.meta) aiState.meta = {};

        // Initialize mining state
        aiState.meta.mineState = 'traveling_to_mine';
    }

    execute(entityId, controller, game, dt) {
        const aiState = game.getComponent(entityId, 'aiState');
        const state = aiState.meta.mineState || 'traveling_to_mine';

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

    onEnd(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');

        // Release mine if we were occupying it
        if (controller.actionTarget) {
            const mine = game.getComponent(controller.actionTarget, 'goldMine');
            if (mine && mine.currentOccupant === entityId) {
                mine.currentOccupant = null;
            }
        }

        // Clean up mining meta data
        if (aiState && aiState.meta) {
            delete aiState.meta.mineState;
            delete aiState.meta.miningStartTime;
            delete aiState.meta.depositStartTime;
            delete aiState.meta.hasGold;
            delete aiState.meta.goldAmt;
        }
    }

    travelToMine(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const pos = game.getComponent(entityId, 'position');
        const minePos = game.getComponent(controller.actionTarget, 'position');

        const distance = this.distance(pos, minePos);

        if (distance < this.parameters.miningRange) {
            const mine = game.getComponent(controller.actionTarget, 'goldMine');

            // Check if mine is occupied by another unit
            if (mine.currentOccupant && mine.currentOccupant !== entityId) {
                // Mine is occupied, wait
                const vel = game.getComponent(entityId, 'velocity');
                if (vel) {
                    vel.vx = 0;
                    vel.vz = 0;
                }
                return { complete: false };
            }

            // Claim the mine - stop movement
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) {
                vel.vx = 0;
                vel.vz = 0;
            }
            mine.currentOccupant = entityId;
            aiState.meta.mineState = 'mining';
            aiState.meta.miningStartTime = game.state.now;
            return { complete: false };
        }

        // Move to mine position
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            const dx = minePos.x - pos.x;
            const dz = minePos.z - pos.z;
            const speed = vel.maxSpeed || 50;
            vel.vx = (dx / distance) * speed;
            vel.vz = (dz / distance) * speed;
        }
        return { complete: false };
    }

    doMining(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const elapsed = game.state.now - aiState.meta.miningStartTime;

        if (elapsed >= this.parameters.miningDuration) {
            aiState.meta.hasGold = true;
            aiState.meta.goldAmt = this.parameters.goldPerTrip;
            aiState.meta.mineState = 'traveling_to_depot';

            // Release the mine
            const mine = game.getComponent(controller.actionTarget, 'goldMine');
            if (mine && mine.currentOccupant === entityId) {
                mine.currentOccupant = null;
            }

            return { complete: false };
        }

        return { complete: false };
    }

    travelToDepot(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const pos = game.getComponent(entityId, 'position');
        const depot = this.findNearestDepot(entityId, game);

        if (!depot) {
            return { complete: true, failed: true };
        }

        const depotPos = game.getComponent(depot, 'position');
        const distance = this.distance(pos, depotPos);

        if (distance < this.parameters.depositRange) {
            // Reached depot - stop movement
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) {
                vel.vx = 0;
                vel.vz = 0;
            }
            aiState.meta.mineState = 'depositing';
            aiState.meta.depositStartTime = game.state.now;
            return { complete: false };
        }

        // Move to depot position
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            const dx = depotPos.x - pos.x;
            const dz = depotPos.z - pos.z;
            const speed = vel.maxSpeed || 50;
            vel.vx = (dx / distance) * speed;
            vel.vz = (dz / distance) * speed;
        }
        return { complete: false };
    }

    doDepositing(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const elapsed = game.state.now - aiState.meta.depositStartTime;

        if (elapsed >= this.parameters.depositDuration) {
            const team = game.getComponent(entityId, 'team');

            // Award gold
            if (game.isServer) {
                const room = game.room;
                for (const [playerId, player] of room.players) {
                    if (player.stats.side === team.team) {
                        player.stats.gold += aiState.meta.goldAmt;
                        break;
                    }
                }
            } else {
                if (team.team === game.state.mySide) {
                    game.state.playerGold += aiState.meta.goldAmt;
                }
            }

            // Reset to mine again
            aiState.meta.mineState = 'traveling_to_mine';
            aiState.meta.hasGold = false;
            return { complete: false };
        }

        return { complete: false };
    }

    findNearestDepot(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const townHalls = game.getEntitiesWith(
            'position',
            'team',
            'unitType'
        );

        let nearest = null;
        let minDist = Infinity;

        for (const thId of townHalls) {
            const thTeam = game.getComponent(thId, 'team');
            const thType = game.getComponent(thId, 'unitType');
            const thPos = game.getComponent(thId, 'position');

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
