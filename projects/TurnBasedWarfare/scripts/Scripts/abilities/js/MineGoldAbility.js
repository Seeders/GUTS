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
    }

    canExecute(entityId) {
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        let miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
        
        if (!miningState) {
            const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
            
            
            this.game.addComponent(entityId, ComponentTypes.MINING_STATE, {
                state: 'idle',
                targetMine: null,
                targetTownHall: null,
                hasGold: false,
                miningStartTime: 0,
                depositStartTime: 0,
                team: team?.team,
                entityId: entityId
            });
            
            console.log('[MineGoldAbility] Created MINING_STATE for entity', entityId, 'team:', team);
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
        console.log('[MineGoldAbility] Finding mine for team:', miningState.team);
        
        const goldMine = this.game.goldMineSystem?.claimedGoldMines.get(miningState.team);
        
        if (!goldMine) {
            console.log('[MineGoldAbility] No gold mine found for player:', miningState.team);
            return;
        }

        miningState.targetMine = goldMine.worldPosition;
        miningState.state = 'walking_to_mine';
        console.log('[MineGoldAbility] Set target mine:', miningState.targetMine);
    }

    walkToMine(miningState, pos, vel) {
        if (!miningState.targetMine) {
            this.findMineTarget(miningState);
            if (!miningState.targetMine) {
                miningState.state = 'idle';
                return;
            }
        }

        const dx = miningState.targetMine.x - pos.x;
        const dz = miningState.targetMine.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < this.miningRange) {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'idle';
                aiState.targetPosition = null;
            }
            
            vel.vx = 0;
            vel.vz = 0;
            miningState.state = 'mining';
            miningState.miningStartTime = this.game.state.now;
            console.log('[MineGoldAbility] Started mining');
        } else {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetMine;
            }
        }
    }

    mineGold(miningState) {
        const elapsed = this.game.state.now - miningState.miningStartTime;
        
        if (elapsed > this.miningDuration) {
            miningState.hasGold = true;
            miningState.state = 'walking_to_hall';
            this.findTownHall(miningState);
            console.log('[MineGoldAbility] Finished mining, walking to hall');
        }
    }

    findTownHall(miningState) {
        const CT = this.game.componentManager.getComponentTypes();
        const combatUnits = this.game.getEntitiesWith(
            CT.POSITION, CT.TEAM, CT.UNIT_TYPE
        );
        for (let i = 0; i < combatUnits.length; i++) {
            const entityId = combatUnits[i];
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);
            const team = this.game.getComponent(entityId, CT.TEAM);
            
            if(team.team == miningState.team && unitType.id == "townHall"){
                miningState.targetTownHall = pos;
                break;
            }
        } 
        console.log('[MineGoldAbility] Set target town hall:', miningState.targetTownHall);
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
            
            vel.vx = 0;
            vel.vz = 0;
            miningState.state = 'depositing';
            miningState.depositStartTime = this.game.state.now;
            console.log('[MineGoldAbility] Arrived at town hall, depositing');
        } else {
            const ComponentTypes = this.game.componentManager.getComponentTypes();
            const aiState = this.game.getComponent(miningState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetTownHall;
            }
        }
    }

    depositGold(miningState) {
        const elapsed = this.game.state.now - miningState.depositStartTime;
        
        if (elapsed > this.depositDuration) {
            this.awardGold(miningState.team);
            miningState.hasGold = false;
            miningState.state = 'idle';
            console.log('[MineGoldAbility] Deposited gold, returning to idle');
        }
    }

    awardGold(team) {
        console.log('awardGold', team);
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
                console.log(`[MineGoldAbility] CLIENT: Earned ${this.goldPerTrip} gold. Total: ${this.game.state.playerGold}`);
            }
        }
    }
    handleEndBattle() {
        // Reset all mining states for next round
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entities = this.game.getEntitiesWith(ComponentTypes.MINING_STATE);
        
        entities.forEach(entityId => {
            const miningState = this.game.getComponent(entityId, ComponentTypes.MINING_STATE);
            if (miningState) {
                miningState.targetMine = null;
                miningState.targetTownHall = null;
                miningState.miningStartTime = 0;
                miningState.depositStartTime = 0;
            }
        });
    }
    logAbilityUsage(entityId) {
        // Passive ability, no logging needed
    }
}