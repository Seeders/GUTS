class MineGoldAbility extends GUTS.BaseAbility {
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

    // Behavior contribution for UniversalBehaviorTree
    getBehavior(entityId, game, context = null) {
        if (!this.enabled) return null;

        // Check if unit is doing a player command
        const aiState = game.getComponent(entityId, 'aiState');
        if (aiState && aiState.meta && aiState.meta.isPlayerOrder) {
            return null; // Player commands take priority
        }

        // Check if unit is building
        const buildState = game.getComponent(entityId, 'builder');
        if (buildState && buildState.assignedBuilding) {
            return null; // Building takes priority
        }

        // Find nearest gold mine
        const team = game.getComponent(entityId, 'team');
        if (!team) return null;

        const nearbyMine = this.findNearestMine(entityId, team.team, game);
        if (!nearbyMine) return null;

        // Calculate utility based on context (if provided)
        let utility = 0.7; // Base utility for mining

        if (context) {
            // Reduce utility if enemies are nearby (workers should be cautious)
            if (context.nearbyEnemies.length > 0) {
                const closestEnemyDist = context.closestEnemyDistance;

                // If enemy is very close (< 150), mining utility drops significantly
                if (closestEnemyDist < 150) {
                    utility -= 0.6; // High penalty for close enemies
                } else if (closestEnemyDist < 250) {
                    utility -= 0.3; // Moderate penalty for nearby enemies
                } else {
                    utility -= 0.1; // Small penalty for distant enemies
                }
            }

            // Reduce utility if low health (should seek safety)
            if (context.healthPercent < 0.3) {
                utility -= 0.4;
            } else if (context.healthPercent < 0.6) {
                utility -= 0.2;
            }

            // Increase utility if safe and healthy (ideal mining conditions)
            if (context.isSafe && context.healthPercent > 0.8) {
                utility += 0.2;
            }
        }

        // Clamp utility to 0-1 range
        utility = Math.max(0, Math.min(1, utility));

        // Return mining behavior with utility score
        return {
            action: "MINE",
            target: nearbyMine,
            utility: utility, // Use utility instead of fixed priority
            priority: 5,      // Fallback priority for backward compatibility
            data: { mineId: nearbyMine }
        };
    }

    findNearestMine(entityId, team, game) {
        const pos = game.getComponent(entityId, "position");
        if (!pos) return null;

        let nearest = null;
        let minDist = Infinity;

        // Get sorted mine entityIds for deterministic iteration
        const sortedMineIds = Array.from(game.goldMineSystem.claimedGoldMines.keys()).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        // Search through all claimed gold mines in deterministic order
        for (const mineEntityId of sortedMineIds) {
            const goldMine = game.goldMineSystem.claimedGoldMines.get(mineEntityId);

            // Check if this mine belongs to our team
            if (goldMine.team === team) {
                // Calculate distance to this mine
                const dx = goldMine.worldPosition.x - pos.x;
                const dz = goldMine.worldPosition.z - pos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < minDist) {
                    minDist = distance;
                    nearest = mineEntityId;
                }
            }
        }

        return nearest;
    }

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }
        let miningState = this.game.getComponent(entityId, "miningState");
        if (!miningState) {
            const team = this.game.getComponent(entityId, "team");

            this.game.addComponent(entityId, "miningState", {
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
            miningState = this.game.getComponent(entityId, "miningState");
        }

        // Autocast behavior: only activate mining if there's NO current command
        const currentCommand = this.game.gameManager.call('getCurrentCommand', entityId);

        // If there's a current command, mark that we were interrupted and don't execute mining
        if (currentCommand) {
            // Mark that mining was interrupted - we'll reset state when resuming
            miningState.wasInterrupted = true;
            return false;
        }

        // Check if a player order just completed this round
        // If so, don't resume mining until next round
        const commandQueue = this.game.getComponent(entityId, "commandQueue");
        if (commandQueue && commandQueue.playerOrderCompletedThisRound) {
            return false;
        }

        // No current command and no recently completed player order - activate mining (autocast)
        // If we were interrupted, reset state to start fresh
        if (miningState.wasInterrupted) {
            miningState.state = 'idle';
            miningState.targetMineEntityId = null;
            miningState.targetMinePosition = null;
            miningState.targetTownHall = null;
            miningState.waitingPosition = null;
            miningState.miningStartTime = 0;
            miningState.depositStartTime = 0;
            miningState.wasInterrupted = false;
            // Note: Keep hasGold if they were carrying gold when interrupted
        }

        // If we were interrupted (controller was changed), reset mining state to idle
        const currentAIController = this.game.aiSystem.getCurrentAIControllerId(entityId);
        if(currentAIController !== "miningState"){
            // Mining was interrupted, reset state to idle so it can start fresh
            miningState.state = 'idle';
            miningState.targetMineEntityId = null;
            miningState.targetMinePosition = null;
            miningState.targetTownHall = null;
            miningState.waitingPosition = null;
            miningState.miningStartTime = 0;
            miningState.depositStartTime = 0;
            // Note: Keep hasGold if they were carrying gold when interrupted

            let currentMiningStateAI = this.game.aiSystem.getAIControllerData(entityId, "miningState");
            this.game.aiSystem.setCurrentAIController(entityId, "miningState", currentMiningStateAI);
        }

        return true;
    }

    execute(entityId, targetData) {
        const miningState = this.game.getComponent(entityId, "miningState");
        const pos = this.game.getComponent(entityId, "position");
        const vel = this.game.getComponent(entityId, "velocity");
        const health = this.game.getComponent(entityId, "health");
        
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

        const pos = this.game.getComponent(miningState.entityId, "position");
        const aiState = this.game.getComponent(miningState.entityId, "aiState");

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
        const combatUnits = this.game.getEntitiesWith("position", "team", "unitType");
        const aiState = this.game.getComponent(miningState.entityId, "aiState");
        const pos = this.game.getComponent(miningState.entityId, "position");

        if (!pos) return;

        let closestTownHall = null;
        let closestDistance = Infinity;

        for (let i = 0; i < combatUnits.length; i++) {
            const entityId = combatUnits[i];
            const townHallPos = this.game.getComponent(entityId, "position");
            const unitType = this.game.getComponent(entityId, "unitType");
            const team = this.game.getComponent(entityId, "team");
        
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
            const aiState = this.game.getComponent(miningState.entityId, "aiState");
            
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
            const aiState = this.game.getComponent(miningState.entityId, "aiState");

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
            const aiState = this.game.getComponent(miningState.entityId, "aiState");
            
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
            const aiState = this.game.getComponent(miningState.entityId, "aiState");

            if (aiState && aiState.targetPosition != miningState.targetTownHall) {
                aiState.state = 'chasing';
                aiState.targetPosition = miningState.targetTownHall;
                aiState.path = [];
                aiState.meta = {};
            }
        }
    }

    waitAtMine(miningState, pos, vel) {
        const aiState = this.game.getComponent(miningState.entityId, "aiState");

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