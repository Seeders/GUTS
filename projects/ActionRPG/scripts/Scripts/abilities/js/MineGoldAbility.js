class MineGoldAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, abilityData) {
        super(game, abilityData);
        this.id = 'mineGold';
        this.name = 'Mine Gold';
        this.description = 'Automatically mines gold from gold mines';
        this.isPassive = true;
        this.autocast = true;
        this.enabled = true;
        this.castTime = 0;
        this.cooldown = 0;
        this.priority = 0;
        
        this.goldPerTrip = 10;
        this.miningRange = 25;
        this.depositRange = 25;
        this.miningDuration = 2;
        this.depositDuration = 1;
        this.waitingDistance = 30; // Distance to wait from mine when queued
    }

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        let miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
        if (!miningState) {
            const team = this.game.getComponent(entityId, ComponentTypes.TEAM);

            this.game.addComponent(entityId, ComponentTypes.MINING_STATE, {
                state: 'idle',
                targetMineEntityId: null,
                targetMinePosition: null,
                targetTownHall: null,
                waitingPosition: null,
                hasGold: false,
                miningStartTime: 0,
                depositStartTime: 0,
                team: team?.team,
                entityId: entityId
            });
            miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
        }

        // Autocast behavior: only activate mining if there's NO current command
        const currentCommand = this.game.gameManager.call('getCurrentCommand', entityId);

        // If there's a current command, don't execute mining
        if (currentCommand) {
            return false;
        }

        // No current command - activate mining (autocast)
        // If we were interrupted (controller was changed), reset mining state to idle
        const currentAIController = this.game.aiSystem.getCurrentAIControllerId(entityId);
        if(currentAIController !== ComponentTypes.MINING_STATE){
            // Mining was interrupted, reset state to idle so it can start fresh
            miningState.state = 'idle';
            miningState.targetMineEntityId = null;
            miningState.targetMinePosition = null;
            miningState.targetTownHall = null;
            miningState.waitingPosition = null;
            miningState.miningStartTime = 0;
            miningState.depositStartTime = 0;
            // Note: Keep hasGold if they were carrying gold when interrupted

            let currentMiningStateAI = this.game.aiSystem.getAIControllerData(entityId, ComponentTypes.MINING_STATE);
            this.game.aiSystem.setCurrentAIController(entityId, ComponentTypes.MINING_STATE, currentMiningStateAI);
        }

        return true;
    }

    execute(entityId, targetData) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
        const pos = this.game.getComponent(entityId, ComponentTypes.POSITION);
        const vel = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
        
        if (!miningState || !pos || !vel || !health || health.current <= 0) {
            this.enabled = false;
            return null;
        }
        this.updateMinerState(entityId, miningState, pos, vel);
        return null;
    }

    updateMinerState(entityId, miningState, pos, vel) {
        miningState.entityId = entityId;
        switch (miningState.state) {
            case 'idle':
                this.findMineTarget(miningState);
                break;
            case 'walking_to_mine':
                this.walkToMine(miningState, pos, vel);
                break;
            case 'waiting_at_mine':
                this.waitAtMine(miningState, pos, vel);
                break;
            case 'mining':
                this.mineGold(miningState);
                break;
            case 'walking_to_hall':
                this.walkToTownHall(miningState, pos, vel);
                break;
            case 'depositing':
                this.depositGold(miningState);
                break;
        }
    }

    findMineTarget(miningState) {
        let closestMine = null;
        let closestDistance = Infinity;
        let closestMineEntityId = null;

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const pos = this.game.getComponent(miningState.entityId, ComponentTypes.POSITION);
        const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);

        if (!pos) return;

        // Get sorted mine entityIds for deterministic iteration
        const sortedMineIds = Array.from(this.game.goldMineSystem.claimedGoldMines.keys()).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        // Search through all claimed gold mines in deterministic order
        for (const mineEntityId of sortedMineIds) {
            const goldMine = this.game.goldMineSystem.claimedGoldMines.get(mineEntityId);

            // Check if this mine belongs to our team
            if (goldMine.team === miningState.team) {
                // Calculate distance to this mine
                const dx = goldMine.worldPosition.x - pos.x;
                const dz = goldMine.worldPosition.z - pos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestMine = goldMine;
                    closestMineEntityId = mineEntityId;
                }
            }
        }

        if (!closestMine) {
            return;
        }

        miningState.targetMineEntityId = closestMineEntityId;
        miningState.targetMinePosition = {
            x: closestMine.worldPosition.x,
            y: closestMine.worldPosition.y || 0,
            z: closestMine.worldPosition.z
        };
        miningState.state = 'walking_to_mine';

        if (aiState && aiState.targetPosition != miningState.targetMinePosition) {
            aiState.targetPosition = miningState.targetMinePosition;
            aiState.path = [];
            aiState.meta = {};
        }
    }

    findTownHall(miningState) {
        const CT = this.game.componentManager.getComponentTypes();
        const combatUnits = this.game.getEntitiesWith(CT.POSITION, CT.TEAM, CT.UNIT_TYPE);        
        const aiState = this.game.getComponent(miningState.entityId, CT.AI_STATE);
        const pos = this.game.getComponent(miningState.entityId, CT.POSITION);
        
        if (!pos) return;
        
        let closestTownHall = null;
        let closestDistance = Infinity;
    
        for (let i = 0; i < combatUnits.length; i++) {
            const entityId = combatUnits[i];
            const townHallPos = this.game.getComponent(entityId, CT.POSITION);
            const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);
            const team = this.game.getComponent(entityId, CT.TEAM);
        
            if (team.team == miningState.team && unitType.id == "townHall") {
                // Calculate distance to this town hall
                const dx = townHallPos.x - pos.x;
                const dz = townHallPos.z - pos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
            
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestTownHall = { x: townHallPos.x, y: townHallPos.y, z: townHallPos.z };
                }
            }
        }
        
        if (closestTownHall) {
            miningState.targetTownHall = closestTownHall;
            if (aiState) {
                aiState.targetPosition = miningState.targetTownHall;
                aiState.path = [];
                aiState.meta = {};
            }
        }
    }

    walkToMine(miningState, pos, vel) {
        if (!miningState.targetMinePosition || !miningState.targetMineEntityId) {
            this.findMineTarget(miningState);
            if (!miningState.targetMinePosition) {
                miningState.state = 'idle';
                return;
            }
        }

        const mine = this.game.goldMineSystem.claimedGoldMines.get(miningState.targetMineEntityId);
        if (!mine || mine.team !== miningState.team) {
            // Mine no longer exists or changed teams - reset to idle
            miningState.targetMineEntityId = null;
            miningState.targetMinePosition = null;
            miningState.waitingPosition = null;
            miningState.state = 'idle';
            return;
        }

        const dx = miningState.targetMinePosition.x - pos.x;
        const dz = miningState.targetMinePosition.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);


        if (dist < this.miningRange) {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            const mineEntityId = miningState.targetMineEntityId;
            const isOccupied = this.game.goldMineSystem.isMineOccupied(mineEntityId);
            const currentOccupant = this.game.goldMineSystem.getCurrentMiner(mineEntityId);

            if (isOccupied && currentOccupant !== miningState.entityId) {
                // Mine is occupied, need to wait
                const queuePosition = this.game.goldMineSystem.getQueuePosition(mineEntityId, miningState.entityId);
                const waitPos = this.getWaitingPosition(miningState.targetMinePosition, queuePosition);
                
                miningState.waitingPosition = waitPos;
                miningState.state = 'waiting_at_mine';

                if (aiState) {
                    aiState.state = 'chasing';
                    aiState.targetPosition = waitPos;
                }
            } else if (!isOccupied) {
                // Mine is free, start mining
                if (aiState) {
                    aiState.state = 'idle';
                    aiState.targetPosition = null;
                }
                pos.x = miningState.targetMinePosition.x;
                pos.z = miningState.targetMinePosition.z;
                vel.vx = 0;
                vel.vz = 0;
                miningState.state = 'mining';
                miningState.miningStartTime = this.game.state.now;
            }
        } else {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState && aiState.targetPosition != miningState.targetMinePosition) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetMinePosition;        
                aiState.path = [];                        
                aiState.meta = {};
            }
        }
    }

    walkToTownHall(miningState, pos, vel) {
        if (!miningState.targetTownHall) {
            this.findTownHall(miningState);
            if (!miningState.targetTownHall) {
                miningState.state = 'idle';
                return;
            }
        }

        const dx = miningState.targetTownHall.x - pos.x;
        const dz = miningState.targetTownHall.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < this.depositRange) {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'idle';
                aiState.targetPosition = null;
            }
            pos.x = miningState.targetTownHall.x - 5;
            pos.z = miningState.targetTownHall.z - 5;
            vel.vx = 0;
            vel.vz = 0;
            miningState.state = 'depositing';
            miningState.depositStartTime = this.game.state.now;
        } else {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState && aiState.targetPosition != miningState.targetTownHall) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetTownHall;
                aiState.path = [];
                aiState.meta = {};
            }
        }
    }

    waitAtMine(miningState, pos, vel) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);

        // Check if we're next in queue
        const isNextInQueue = this.game.goldMineSystem.isNextInQueue(
            miningState.targetMineEntityId, 
            miningState.entityId
        );
        
        const isMineOccupied = this.game.goldMineSystem.isMineOccupied(miningState.targetMineEntityId);
        
        // If we're next and the mine is free, start mining
        if (isNextInQueue && !isMineOccupied) {
            // The goldMineSystem.processNextInQueue will be called from mineGold when mining completes
            // But we can also transition directly here if we detect we're next
            if (aiState) {
                aiState.state = 'idle';
                aiState.targetPosition = null;
            }
            pos.x = miningState.targetMinePosition.x;
            pos.z = miningState.targetMinePosition.z;
            vel.vx = 0;
            vel.vz = 0;
            
            miningState.state = 'mining';
            miningState.miningStartTime = this.game.state.now;
            miningState.waitingPosition = null;
        } else {
            // Otherwise stay at waiting position
            if (miningState.waitingPosition && aiState && aiState.state !== 'idle') {
                aiState.state = 'idle';
                aiState.targetPosition = null;
                pos.x = miningState.waitingPosition.x;
                pos.z = miningState.waitingPosition.z;
                vel.vx = 0;
                vel.vz = 0;
            }
        }
    }

    getWaitingPosition(minePosition, queuePosition) {
        // Line up miners in a row next to each other
        // Each miner stands 10 units apart
        const spacing = 10;
        const offsetX = queuePosition * spacing;
        
        return {
            x: minePosition.x + this.waitingDistance + offsetX,
            y: minePosition.y,
            z: minePosition.z
        };
    }

    mineGold(miningState) {
        const elapsed = this.game.state.now - miningState.miningStartTime;
        
        if (elapsed >= this.miningDuration) {
            miningState.hasGold = true;
            miningState.goldAmt = 10;

            if(this.game.state.teams){
                let teamState = this.game.state.teams[miningState.team];
                if(teamState && teamState.effects){
                    let teamStateEffects = teamState.effects;
                    if(teamStateEffects['goldPerTrip']){
                        let goldPerTrip = teamStateEffects['goldPerTrip'];
                        if(goldPerTrip && goldPerTrip.value){
                            miningState.goldAmt += goldPerTrip.value;
                        }
                    }
                }
            }
            
            // Change state first, then process queue
            miningState.state = 'walking_to_hall';
            
            // Process next miner in queue now that this mine is free
            if (miningState.targetMineEntityId) {
                this.game.goldMineSystem.processNextInQueue(miningState.targetMineEntityId);
            }
            
            this.findTownHall(miningState);
        }
    }

    depositGold(miningState) {
        const elapsed = this.game.state.now - miningState.depositStartTime;
        
        if (elapsed >= this.depositDuration) {
            this.awardGold(miningState.team, miningState.goldAmt);
            miningState.hasGold = false;
            this.findMineTarget(miningState);
        }
    }

    awardGold(team, goldAmt) {
        if (this.game.isServer) {
            const room = this.game.room;
            for (const [playerId, player] of room.players) {
                if(player.stats.side == team){
                    player.stats.gold += goldAmt;
                    break;
                }
            }
        } else {
            if (team === this.game.state.mySide) {
                this.game.state.playerGold += goldAmt;
            }
        }
    }
    
    logAbilityUsage(entityId) {
        // Passive ability, no logging needed
    }
}