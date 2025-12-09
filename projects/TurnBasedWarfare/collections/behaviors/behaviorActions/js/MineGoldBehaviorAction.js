class MineGoldBehaviorAction extends GUTS.BaseBehaviorAction {


    execute(entityId, game) {
        console.log(entityId, 'mining gold');
        const aiState = game.getComponent(entityId, 'aiState');
        const state = aiState.meta.mineState || 'traveling_to_mine';
        switch (state) {
            case 'traveling_to_mine':
                return this.travelToMine(entityId, aiState, game);
            case 'waiting_at_mine':
                return this.waitAtMine(entityId, aiState, game);
            case 'mining':
                return this.doMining(entityId, aiState, game);
            case 'traveling_to_depot':
                return this.travelToDepot(entityId, aiState, game);
            case 'depositing':
                return this.doDepositing(entityId, aiState, game);
        }
    }

    onEnd(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');

        aiState.meta = {};
        aiState.currentAction = null;
    }

    travelToMine(entityId, aiState, game) {
        let targetMine = aiState.meta.targetMine;
        let targetPosition = aiState.meta.targetPosition;
        let targetMinePosition = aiState.meta.targetMinePosition;
        if(!targetMine){
            let nearestMineData = this.findNearesetGoldMine(entityId, game);
            targetMine = nearestMineData.targetMine;
            targetPosition = nearestMineData.targetPosition;
            targetMinePosition = nearestMineData.targetPosition;
        }
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;

        const distance = this.distance(pos, targetMinePosition);
        if (distance < this.parameters.miningRange) {
            this.game.goldMineSystem.addMinerToQueue(targetMine, entityId); 
            return { 
                targetPosition: targetMinePosition,
                targetMinePosition: targetMinePosition,
                targetMine: targetMine,
                mineState: 'waiting_at_mine',
                miningStartTime: game.state.now
             };
        }

        // Set target for MovementSystem to handle
        return {
            targetPosition: targetMinePosition,
            targetMinePosition: targetMinePosition,
            targetMine: targetMine,
            mineState: 'traveling_to_mine',
        };
    }
    waitAtMine(entityId, aiState, game) {
        let targetMine = aiState.meta.targetMine;
        let targetPosition = aiState.meta.targetPosition;
        let targetMinePosition = aiState.meta.targetMinePosition;

        const goldMine = game.getComponent(targetMine, 'goldMine');
        const isCurrentMiner = goldMine && goldMine.currentMiner === entityId;
        const isNextInQueue = this.game.goldMineSystem.isNextInQueue(
            targetMine,
            entityId
        );
        const isMineOccupied = this.game.goldMineSystem.isMineOccupied(targetMine);

        // Start mining if we're the current miner OR if we're next and mine is free
        if (isCurrentMiner || (isNextInQueue && !isMineOccupied)) {            
            if (!isCurrentMiner) {
                game.call('processNextMinerInQueue', targetMine);
            }
            const transform = game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            const vel = game.getComponent(entityId, 'velocity');
            if (pos) {
                pos.x = targetMinePosition.x;
                pos.z = targetMinePosition.z;
            }
            if (vel) {
                vel.vx = 0;
                vel.vz = 0;
            }
            return {
                targetPosition: targetMinePosition,
                targetMinePosition: targetMinePosition,
                targetMine: targetMine,
                mineState: 'mining',
                miningStartTime: this.game.state.now
            }
        }
        return {
            targetPosition: targetPosition,
            targetMinePosition: targetMinePosition,
            targetMine: targetMine,
            mineState: 'waiting_at_mine',
            miningStartTime: aiState.meta.miningStartTime
        }
    }

    doMining(entityId, aiState, game) {
        const elapsed = game.state.now - aiState.meta.miningStartTime;
        let targetMine = aiState.meta.targetMine;

        if (elapsed >= this.parameters.miningDuration) {
            // Mining complete - process next miner in queue
            game.call('processNextMinerInQueue', targetMine);

            return {
                hasGold: true,
                goldAmt: this.parameters.goldPerTrip,
                mineState: 'traveling_to_depot'
            };
        }

        return {
            hasGold: elapsed > 0,
            goldAmt: this.parameters.goldPerTrip * elapsed / this.parameters.miningDuration,
            mineState: 'mining',
            miningStartTime: aiState.meta.miningStartTime,
            targetMine: aiState.meta.targetMine
        };
    }

    travelToDepot(entityId, aiState, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const depot = this.findNearestDepot(entityId, game);

        if (!depot) {
            return null;
        }

        const depotTransform = game.getComponent(depot, 'transform');
        const depotPos = depotTransform?.position;
        const distance = this.distance(pos, depotPos);

        if (distance < this.parameters.depositRange) {
            // Reached depot - clear movement target
            let depositStartTime = aiState.meta.depositStartTime;
            if(!depositStartTime){
                depositStartTime = game.state.now;
            }
            return { 
                mineState: 'depositing',
                goldAmt: aiState.meta.goldAmt,
                hasGold: aiState.meta.goldAmt > 0,
                depositStartTime  
            };
        }

        // Set target for MovementSystem to handle        
        return { 
            mineState: 'traveling_to_depot',
            goldAmt: aiState.meta.goldAmt,
            hasGold: aiState.meta.goldAmt > 0,
            targetPosition: { x: depotPos.x, z: depotPos.z }    
        };
    }

    doDepositing(entityId, aiState, game) {
        const elapsed = game.state.now - aiState.meta.depositStartTime;

        if (elapsed >= this.parameters.depositDuration) {
            const team = game.getComponent(entityId, 'team');

            // Award gold to player entity
            game.call('addPlayerGold', team.team, aiState.meta.goldAmt);

            return { 
                mineState: 'traveling_to_mine'
            };
        }

        return { 
            mineState: 'depositing',
            goldAmt: aiState.meta.goldAmt,
            hasGold: aiState.meta.goldAmt > 0,
            targetPosition: aiState.meta.targetPosition,
            depositStartTime: aiState.meta.depositStartTime    
        };
    }

    findNearestDepot(entityId, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const townHalls = game.getEntitiesWith(
            'transform',
            'team',
            'unitType'
        );

        let nearest = null;
        let minDist = Infinity;

        for (const thId of townHalls) {
            const thTeam = game.getComponent(thId, 'team');
            const thType = game.getComponent(thId, 'unitType');
            const thTransform = game.getComponent(thId, 'transform');
            const thPos = thTransform?.position;

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
    findNearesetGoldMine(entityId, game) {
        let closestMinePos = null;
        let closestDistance = Infinity;
        let closestMineEntityId = null;

        const transform = game.getComponent(entityId, "transform");
        const pos = transform?.position;

        if (!pos) return;

        // Get all entities with goldMine component
        const goldMineEntities = game.getEntitiesWith("goldMine", "transform", "team");

        // Sort for deterministic iteration
        const sortedMineIds = goldMineEntities.sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        // Search through all gold mines in deterministic order
        for (const mineEntityId of sortedMineIds) {
            const mineTeam = game.getComponent(mineEntityId, "team");
            const entityTeam = game.getComponent(entityId, "team");
            const mineTransform = game.getComponent(mineEntityId, "transform");
            const minePos = mineTransform?.position;

            // Check if this mine belongs to our team
            if (mineTeam && mineTeam.team === entityTeam.team) {
                // Calculate distance to this mine
                const dx = minePos.x - pos.x;
                const dz = minePos.z - pos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestMinePos = minePos;
                    closestMineEntityId = mineEntityId;
                }
            }
        }

        if (!closestMinePos) {
            return null;
        }

        return {
            targetMine: closestMineEntityId,
            targetPosition: {
                x: closestMinePos.x,
                y: closestMinePos.y || 0,
                z: closestMinePos.z
            }
        }

    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
