class MineGoldAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, abilityData) {
        super(game, abilityData);
        this.id = 'mineGold';
        this.name = 'Mine Gold';
        this.description = 'Automatically mines gold from gold mines';
        this.isPassive = true;
        this.autocast = true;
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
        
        if (aiState) {
            aiState.targetPosition = miningState.targetMinePosition;
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
            if (miningState.targetMineEntityId) {
                this.game.goldMineSystem.removeFromQueue(miningState.targetMineEntityId, miningState.entityId);
            }
            miningState.targetMineEntityId = null;
            miningState.targetMinePosition = null;
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
                const queuePosition = this.game.goldMineSystem.getQueuePosition(mineEntityId, miningState.entityId);
                
                if (queuePosition === -1) {
                    this.game.goldMineSystem.addToQueue(mineEntityId, miningState.entityId);
                }
                
                const newQueuePosition = this.game.goldMineSystem.getQueuePosition(mineEntityId, miningState.entityId);
                const waitPos = this.getWaitingPosition(miningState.targetMinePosition, newQueuePosition);
                
                miningState.waitingPosition = waitPos;
                miningState.state = 'waiting_at_mine';
                
                if (aiState) {
                    aiState.state = 'chasing';
                    aiState.targetPosition = waitPos;
                }
            } else if (!isOccupied) {
                this.game.goldMineSystem.claimMine(mineEntityId, miningState.entityId);
                
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
            
            if (aiState) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetMinePosition;
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
            pos.x = miningState.targetTownHall.x;
            pos.z = miningState.targetTownHall.z;
            vel.vx = 0;
            vel.vz = 0;
            miningState.state = 'depositing';
            miningState.depositStartTime = this.game.state.now;
        } else {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetTownHall;
            }
        }
    }
    waitAtMine(miningState, pos, vel) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);

        if (miningState.waitingPosition && aiState && aiState.state !== 'idle') {
            aiState.state = 'idle';
            aiState.targetPosition = null;
            pos.x = miningState.waitingPosition.x;
            pos.z = miningState.waitingPosition.z;
            vel.vx = 0;
            vel.vz = 0;
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
            // Release the mine when done mining
            if (miningState.targetMineEntityId) {
                this.game.goldMineSystem.releaseMine(miningState.targetMineEntityId, miningState.entityId);
            }
            
            miningState.hasGold = true;
            miningState.state = 'walking_to_hall';
            this.findTownHall(miningState);
        }
    }

    depositGold(miningState) {
        const elapsed = this.game.state.now - miningState.depositStartTime;
        
        if (elapsed >= this.depositDuration) {
            this.awardGold(miningState.team);
            miningState.hasGold = false;
            this.findMineTarget(miningState);
        }
    }

    awardGold(team) {
        if (this.game.isServer) {
            const room = this.game.room;
            for (const [playerId, player] of room.players) {
                if(player.stats.side == team){
                    player.stats.gold += this.goldPerTrip;
                    break;
                }
            }
        } else {
            if (team === this.game.state.mySide) {
                this.game.state.playerGold += this.goldPerTrip;
            }
        }
    }
    
    logAbilityUsage(entityId) {
        // Passive ability, no logging needed
    }
}