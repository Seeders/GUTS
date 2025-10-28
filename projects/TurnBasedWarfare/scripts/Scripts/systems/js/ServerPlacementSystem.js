class ServerPlacementSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);  
        this.game.placementSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;  
        this.playerPlacements = new Map();
        this.leftPlacements = [];
        this.rightPlacements = [];
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
     }

    init(params) {
        this.params = params || {};
         this.subscribeToEvents();
    }
    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('No event manager found on engine');
            return;
        }

        // Subscribe to room management events
        this.game.serverEventManager.subscribe('GET_STARTING_STATE', this.handleGetStartingState.bind(this));
        this.game.serverEventManager.subscribe('SUBMIT_PLACEMENT', this.handleSubmitPlacement.bind(this));
        this.game.serverEventManager.subscribe('PURCHASE_UPGRADE', this.handlePurchaseUpgrade.bind(this));
        this.game.serverEventManager.subscribe('READY_FOR_BATTLE', this.handleReadyForBattle.bind(this));
        this.game.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGET', this.handleSetSquadTarget.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGETS', this.handleSetSquadTargets.bind(this));
    
    }

    getPlacementById(placementId) {
        // Search in player placements first
        const leftPlacements = this.leftPlacements.find(placement => placement.placementId === placementId);
        if (leftPlacements) {
            return leftPlacements;
        }
        
        // Search in opponent placements
        const rightPlacements = this.rightPlacements.find(placement => placement.placementId === placementId);
        if (rightPlacements) {
            return rightPlacements;
        }
        
        // Return null if no matching placement is found
        return null;
    }
    getPlayerIdByPlacementId(placementId) {
        // Iterate through all players and their placements
        for (const [playerId, placements] of this.playerPlacements) {
            // Check if any placement in this player's placements matches the placementId
            const foundPlacement = placements.find(placement => placement.placementId === placementId);
            if (foundPlacement) {
                return playerId;
            }
        }
        
        // Return null if no matching placement is found
        return null;
    }
    getPlacementsForSide(side){
        if(side == 'left'){
            return this.leftPlacements;
        } else {
            return this.rightPlacements;
        }
    }

    handleGetStartingState(eventData) {
        try {
            const { playerId, data } = eventData;
  
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) { 
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', { 
                    error: 'Room not found'
                });
                return;
            }
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            // Broadcast ready state update to all players in room
            if(player){
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', this.getStartingState(player));
            }
            
        } catch (error) {
            console.error('Error getting starting state:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'GOT_STARTING_STATE', { 
                error: 'Server error while submitting placements',
                playerId: eventData.playerId,
                ready: false,
                received: data,
                success: false
            });
        }
    }

    async handleLevelSquad(eventData){
        const { playerId, data } = eventData;
        const { placementId, specializationId } = data;
        let playerGold = 0;
        if(playerId){
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);         
            if(roomId){
                const room = this.engine.getRoom(roomId);
                if(room){
                    const player = room.players.get(playerId);                    
                    playerGold = player.stats.gold;
                    console.log('got player gold', playerGold);
            
                    if (!this.game.squadExperienceSystem.canAffordLevelUp(placementId, playerGold)) {            
                        console.log("not enough gold to level up");
                        this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                            playerId: playerId,
                            error: "gold_low_error",
                            success: false
                        });
                        return false;
                    }
                    const success1 = specializationId ? this.game.squadExperienceSystem.applySpecialization(placementId, specializationId, playerId) : true;
       
                    await this.game.squadExperienceSystem.levelUpSquad(placementId, null, playerId, (success) => {
                        console.log('success?: ', success1, success);
                        if(success1 && success){
                            const levelUpCost = this.game.squadExperienceSystem.getLevelUpCost(placementId);        
                            
                            player.stats.gold -= levelUpCost;
                            console.log('leveled, new gold amt:', player.stats.gold);
                            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                                playerId: playerId,
                                currentGold: player.stats.gold,
                                success: true
                            });
                        }
                    });
           
                }
            }
        } 
    }

    handleSubmitPlacement(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placement, ready } = data;
  
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) { 
                this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', { 
                    error: 'Room not found'
                });
                return;
            }
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            // Broadcast ready state update to all players in room
            this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', this.submitPlayerPlacement(playerId, player, placement, true));
            
        } catch (error) {
            console.error('Error submitting placements:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'READY_FOR_BATTLE_UPDATE', { 
                error: 'Server error while submitting placements',
                playerId: eventData.playerId,
                ready: false,
                received: data
            });
        }
    }

    handlePurchaseUpgrade(eventData) {
        try {
            const { playerId, data } = eventData;
            
  
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) { 
                this.serverNetworkManager.sendToPlayer(playerId, 'PURCHASED_UPGRADE', { 
                    error: 'Room not found'
                });
                return;
            }
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            // Broadcast ready state update to all players in room
            this.serverNetworkManager.sendToPlayer(playerId, 'PURCHASED_UPGRADE', this.purchaseUpgrade(playerId, player, data.data, true));
            
        } catch (error) {
            console.error('Error purchasing upgrades:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'PURCHASED_UPGRADE', { 
                error: 'Server error while purchasing upgrades',
                playerId: eventData.playerId,
                ready: false,
                received: data
            });
        }
    }

    handleSetSquadTarget(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementId, targetPosition } = data;
            
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { 
                    error: 'Room not found'
                });
                return;
            }
            
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            
            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { 
                    error: 'Player not found'
                });
                return;
            }
            
            // Validate placement belongs to player            
            const placement = this.getPlacementById(placementId);
            
            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { 
                    error: 'Placement not found'
                });
                return;
            }
            
            // Store target position in placement data
            placement.targetPosition = targetPosition;
            
            // Send success response to requesting player
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { 
                success: true,
                placementId,
                targetPosition
            });
            
            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGET_SET', {
                        placementId,
                        targetPosition
                    });
                }
            }
            
            console.log(`Player ${playerId} set target for squad ${placementId}:`, targetPosition);
            
        } catch (error) {
            console.error('Error setting squad target:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SQUAD_TARGET_SET', { 
                error: 'Server error while setting squad target'
            });
        }
    }

    handleSetSquadTargets(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementIds, targetPositions } = data;
            
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { 
                    error: 'Room not found'
                });
                return;
            }
            
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            
            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { 
                    error: 'Player not found'
                });
                return;
            }
            
            for(let i = 0; i < placementIds.length; i++){
                let placementId = placementIds[i];
                let targetPosition = targetPositions[i];
                // Validate placement belongs to player            
                const placement = this.getPlacementById(placementId);
                
                if (!placement) {
                    console.log(placementId, 'not found');
                    this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { 
                        error: 'Placement not found'
                    });
                    return;
                }
                
                // Store target position in placement data
                placement.targetPosition = targetPosition;
                

                
                console.log(`Player ${playerId} set target for squad ${placementId}:`, targetPosition);
            }

                        // Send success response to requesting player
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { 
                success: true
            });
            
            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGETS_SET', {
                        placementIds,
                        targetPositions
                    });
                }
            }
            
        } catch (error) {
            console.error('Error setting squad target:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SQUAD_TARGETS_SET', { 
                error: 'Server error while setting squad target'
            });
        }
    }


    handleReadyForBattle(eventData) {
        const { playerId, data } = eventData; 
        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (!roomId) { 
            this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { 
                error: 'Room not found'
            });
            return;
        }
        const room = this.engine.getRoom(roomId);
          
        const player = room.getPlayer(playerId);
        // Update ready state
        player.placementReady = true;
        this.placementReadyStates.set(playerId, true);
        
        this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { success: true });
            
        // Check if all players are ready and start battle if so
        if (this.areAllPlayersReady() && this.game.state.phase === 'placement') {

            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {                       
                gameState: gameState,
                allReady: true
            });
            this.placementReadyStates.clear();
            // Small delay to ensure clients receive the ready update

            this.game.resetCurrentTime();
            this.applyTargetPositions();
            this.game.desyncDebugger.displaySync(true);
            this.resetAI();
            this.game.serverBattlePhaseSystem.startBattle(room);
        } else {
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {                       
                gameState: gameState,
                allReady: false
            });
        }

    }
    
    resetAI() {
        const componentTypes = this.game.componentManager.getComponentTypes();            
        const AIEntities = this.game.getEntitiesWith(componentTypes.AI_STATE, componentTypes.COMBAT);      
        AIEntities.forEach((entityId) => {
            const aiState = this.game.getComponent(entityId, componentTypes.AI_STATE);
            const combat = this.game.getComponent(entityId, componentTypes.COMBAT);
            combat.lastAttack = 0;
            aiState.aiBehavior = {};
        });
    }

    applyTargetPositions() {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        console.log('APPLY TARGET POSITIONS');
        for (const [playerId, placements] of this.playerPlacements) {
            placements.forEach(placement => {
                const targetPosition = placement.targetPosition;
                if (!targetPosition) return;
                console.log(placement);
                if (placement.squadUnits.length > 0) {
                    placement.squadUnits.forEach(entityId => {                        
                        const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
                        if (aiState) {
                            aiState.targetPosition = { ...targetPosition };            
                           
                console.log('aiState targetPosition', entityId, aiState.targetPosition);
                        }
                    });
                }
            });
        }
    }

    areAllPlayersReady() {
        let states = [...this.placementReadyStates.values()]
        return states.length == this.numPlayers && states.every(ready => ready === true);
    }


    submitPlayerPlacement(playerId, player, placement) {
        console.log(`=== SUBMIT PLACEMENT DEBUG ===`);
        console.log(`Player ID: ${playerId}`);
        console.log(`Room ID: ${this.game.room?.id || 'NO ROOM'}`);
        console.log(`Game phase: ${this.game.state.phase}`);
        console.log(`================================`);
    
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }
        
        // Validate placements if provided
        if ( !this.validatePlacement(placement, player)) {
            return { success: false, error: 'Invalid placement' };
        }


        // Deduct gold only for new units
        if (placement.unitType?.value > 0 && !placement.isStartingState) {
            player.stats.gold -= placement.unitType?.value;
        }            
        
        
        // Store placements
        let playerPlacements = this.playerPlacements.get(playerId);
        if(playerPlacements){
            playerPlacements.push(placement);
        } else {
            playerPlacements = [placement];
        }
        this.playerPlacements.set(playerId, playerPlacements);

        if(player.stats.side == 'left'){
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }
        
        const result = this.game.serverBattlePhaseSystem.spawnSquadFromPlacement(playerId, placement);

        if(result.success && result.squad){
            let squadUnits = [];
            result.squad.squadUnits.forEach((entityId) => {
                squadUnits.push(entityId);
            })
            placement.squadUnits = squadUnits;
            if (this.game.squadExperienceSystem && placement.placementId) {
                this.game.squadExperienceSystem.initializeSquad(
                    placement.placementId, 
                    placement.unitType,
                    placement.squadUnits, 
                    placement.team
                );
            }
            if (placement.peasantInfo && placement.collection === 'buildings') {
                const peasantInfo = placement.peasantInfo;
                const peasantIds = peasantInfo.peasantIds || [];
                const buildTime = peasantInfo.buildTime;
                const entityId = placement.squadUnits[0];
                const ComponentTypes = this.game.componentManager.getComponentTypes();
                const placementComponent = this.game.getComponent(entityId, ComponentTypes.PLACEMENT);
                
                if (placementComponent) {
                    placementComponent.isUnderConstruction = true;
                    placementComponent.buildTime = buildTime;
                    placementComponent.assignedBuilder = peasantIds[0] || null;
                }
                
                // Get the build ability from the peasant's abilities
                if (peasantIds.length > 0) {
                    const peasantAbilities = this.game.abilitySystem.entityAbilities.get(peasantIds[0]);
                    if (peasantAbilities) {
                        console.log("peasantAbilities", peasantAbilities);
                        const buildAbility = peasantAbilities.find(a => a.id === 'build');
                        if (buildAbility) {
                            buildAbility.assignToBuild(peasantIds[0], entityId);
                        }
                    }
                }
                
                // Clear the flag (only once for first building entity)
                this.game.state.peasantBuildingPlacement = null;
            }
        }


        return { success: result.success };
    }


    handleBattleEnd() {        
        this.removeDeadSquadsAfterRound();
       // this.updateGridPositionsAfterRound();
    }
    
    removeDeadSquadsAfterRound() {
        if (!this.game.componentManager) return;

        const ComponentTypes = this.game.componentManager.getComponentTypes();

        this.playerPlacements.forEach((placements, playerId) => {
            const survivingPlacements = placements.filter(placement => {
                if (!placement.experience?.unitIds || placement.experience.unitIds.length === 0) {
                    this.cleanupDeadSquad(placement);
                    return false;
                }

                const aliveUnits = placement.experience.unitIds.filter(entityId => {
                    const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                    const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
                    return health && health.current > 0 && (!deathState || !deathState.isDying);
                });

                if (aliveUnits.length === 0) {
                    this.cleanupDeadSquad(placement);
                    return false;
                }

                placement.experience.unitIds = aliveUnits;
                return true;
            });

            this.playerPlacements.set(playerId, survivingPlacements);
        });
    }

    cleanupDeadSquad(placement) {
        if (this.game.gridSystem && placement.placementId) {
            this.game.gridSystem.freeCells(placement.placementId);
        }

        if (this.game.squadExperienceSystem && placement.placementId) {
            this.game.squadExperienceSystem.removeSquad(placement.placementId);
        }

        console.log(`Squad eliminated: ${placement.unitType?.title || placement.placementId}`);
    }

    updateGridPositionsAfterRound() {
        if (!this.game.gridSystem || !this.game.componentManager) return;

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        this.game.gridSystem.clear();

        this.playerPlacements.forEach((placements, playerId) => {
            placements.forEach(placement => {
                if (!placement.experience?.unitIds || placement.experience.unitIds.length === 0) return;

                const aliveUnits = placement.experience.unitIds.filter(entityId => {
                    const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                    const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
                    return health && health.current > 0 && (!deathState || !deathState.isDying);
                });

                if (aliveUnits.length === 0) return;

                const positions = aliveUnits.map(entityId => {
                    const pos = this.game.getComponent(entityId, ComponentTypes.POSITION);
                    return pos ? { x: pos.x, z: pos.z } : null;
                }).filter(p => p !== null);

                if (positions.length === 0) return;

                const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
                const avgZ = positions.reduce((sum, p) => sum + p.z, 0) / positions.length;
                const newGridPos = this.game.gridSystem.worldToGrid(avgX, avgZ);

                if (this.game.gridSystem.isValidPosition(newGridPos)) {
                    placement.gridPosition = newGridPos;
                    placement.experience.unitIds = aliveUnits;

                    const squadData = this.game.squadManager?.getSquadData(placement.unitType);
                    if (squadData) {
                        const cells = this.game.squadManager.getSquadCells(newGridPos, squadData);
                        placement.cells = cells;
                        this.game.gridSystem.occupyCells(cells, placement.placementId);
                    }
                }
            });
        });
    }


    validatePlacement(placement, player) {
       

        // Calculate cost of only NEW units
        const newUnitCost =  placement.unitType?.value;
        
        
        if (newUnitCost > player.stats.gold) {
            console.log(`Player ${player.id} insufficient gold: ${newUnitCost} > ${player.stats.gold}`);
            return false;
        }
        
        // Check placement positions (basic validation)
    
        if (!placement.gridPosition || !placement.unitType) {
            console.log(`Player ${player.id} invalid placement data:`, placement);
            return false;
        }
        
        // Validate side placement - no mirroring, direct side enforcement
        const squadData = this.game.squadManager.getSquadData(placement.unitType);
        const cells = this.game.squadManager.getSquadCells(placement.gridPosition, squadData);
        if(!this.game.gridSystem.isValidPlacement(cells, player.stats.side)){
            console.log('Invalid Placement', placement);
            return false;
        }
    
        
        return true;
    }
    clearAllPlacements(){

        this.playerPlacements.keys().forEach((playerId) => {
            this.clearPlayerPlacements(playerId);
        });

        this.playerPlacements = new Map();
        this.leftPlacements = new Map();
        this.rightPlacements = new Map();
        this.placementReadyStates = new Map();  
    }
    clearPlayerPlacements(playerId) {
        try {
            // Get player's placements
            const placements = this.playerPlacements.get(playerId) || [];
            
            // Remove entities created by this player's placements
            placements.forEach(placement => {
                if (placement.unitIds) {
                    placement.unitIds.forEach(entityId => {
                        try {
                            if (this.game.destroyEntity) {
                                this.game.destroyEntity(entityId);
                            }
                        } catch (error) {
                            console.warn(`Error destroying entity ${entityId}:`, error);
                        }
                    });
                }
                
                // Free grid cells
                if (placement.placementId) {
                    this.game.gridSystem.freeCells(placement.placementId);
                }
            });
            
            // Clear from maps
            this.playerPlacements.delete(playerId);
            
            // Clear from undo stack if it's this player
            if (this.undoStack) {
                this.undoStack = this.undoStack.filter(undo => undo.playerId !== playerId);
            }
            
            console.log(`Cleared placements for player ${playerId}`);
            
        } catch (error) {
            console.error(`Error clearing placements for player ${playerId}:`, error);
        }
    }

    saveBuilding(entityId, team, gridPosition, unitType) {
        console.log(`=== Purchase Building DEBUG ===`);     
        console.log(`Data received:`, entityId, team, unitType);

        if (unitType.id === 'goldMine') {
            const gridWidth = unitType.placementGridWidth || 2;
            const gridHeight = unitType.placementGridHeight || 2;
            
            const result = this.game.goldMineSystem.buildGoldMine(entityId, team, gridPosition, gridWidth, gridHeight);
            if (!result.success) {
                return result;
            }
        }            
        console.log(`SUCCESS`);
        console.log(`================================`);
        return { success: true };
    }

    purchaseUpgrade(playerId, player, data) {
        console.log(`=== Purchase Upgrade DEBUG ===`);       
        console.log(`Data received:`, data);
    
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        const upgrade = this.game.getCollections().upgrades[data.upgradeId];
        if(upgrade?.value <= player.stats.gold){
            player.stats.gold -= upgrade.value;
            if(!this.game.state.teams){
                this.game.state.teams = {};
            }
            if(!this.game.state.teams[player.stats.side]) {
                this.game.state.teams[player.stats.side] = {};
            } 
            if(!this.game.state.teams[player.stats.side].effects) {
                this.game.state.teams[player.stats.side].effects = {};
            }
            upgrade.effects.forEach((effectId) => {
                const effect = this.game.getCollections().effects[effectId];
                this.game.state.teams[player.stats.side].effects[effectId] = effect;
            })
            
            console.log(`SUCCESS`);
            console.log(`================================`);
            return { success: true };
        }

        console.log(`ERROR`);    
        console.log(`================================`);
        
        return { success: false, error: "Not enough gold." };
    }

    getStartingState(player){

        let startPosition = { x: 5, z: 5 };
        if(player.stats.side == 'right'){
            startPosition = { x: 58, z: 58 };
        }
        
        // Find nearest unclaimed gold vein
        let nearestGoldVeinLocation = null;
        let minDistance = Infinity;
        
        if (this.game.goldMineSystem && this.game.goldMineSystem.goldVeinLocations) {
            this.game.goldMineSystem.goldVeinLocations.forEach(vein => {
                // Skip if already claimed
                if (vein.claimed) return;
                
                // Calculate distance from start position to vein
                const dx = vein.gridPos.x - startPosition.x;
                const dz = vein.gridPos.z - startPosition.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestGoldVeinLocation = vein.gridPos;
                }
            });
        }
        
        
        // Calculate peasant positions on the same side as gold mine
        // TownHall is 2x2, so it occupies a 2x2 area centered at startPosition
        const dx = nearestGoldVeinLocation.x - startPosition.x;
        const dz = nearestGoldVeinLocation.z - startPosition.z;
        
        let peasantPositions = [];
        
        // Determine which side the gold mine is on and place peasants accordingly
        if (Math.abs(dx) > Math.abs(dz)) {
            // Gold mine is more to the east or west
            if (dx > 0) {
                // Gold mine is to the EAST, place peasants on east side
                // TownHall occupies x to x+1, so peasants start at x+2
                peasantPositions = [
                    { x: startPosition.x + 2, z: startPosition.z - 1 },
                    { x: startPosition.x + 2, z: startPosition.z },
                    { x: startPosition.x + 2, z: startPosition.z + 1 },
                    { x: startPosition.x + 2, z: startPosition.z + 2 }
                ];
            } else {
                // Gold mine is to the WEST, place peasants on west side
                // TownHall occupies x-1 to x, so peasants start at x-2
                peasantPositions = [
                    { x: startPosition.x - 2, z: startPosition.z - 1 },
                    { x: startPosition.x - 2, z: startPosition.z },
                    { x: startPosition.x - 2, z: startPosition.z + 1 },
                    { x: startPosition.x - 2, z: startPosition.z + 2 }
                ];
            }
        } else {
            // Gold mine is more to the north or south
            if (dz > 0) {
                // Gold mine is to the SOUTH, place peasants on south side
                // TownHall occupies z to z+1, so peasants start at z+2
                peasantPositions = [
                    { x: startPosition.x - 1, z: startPosition.z + 2 },
                    { x: startPosition.x, z: startPosition.z + 2 },
                    { x: startPosition.x + 1, z: startPosition.z + 2 },
                    { x: startPosition.x + 2, z: startPosition.z + 2 }
                ];
            } else {
                // Gold mine is to the NORTH, place peasants on north side
                // TownHall occupies z-1 to z, so peasants start at z-2
                peasantPositions = [
                    { x: startPosition.x - 1, z: startPosition.z - 2 },
                    { x: startPosition.x, z: startPosition.z - 2 },
                    { x: startPosition.x + 1, z: startPosition.z - 2 },
                    { x: startPosition.x + 2, z: startPosition.z - 2 }
                ];
            }
        }
        
        const startingUnits = [
            {
                type: "townHall",
                collection: "buildings",
                position: startPosition
            },
            {
                type: "goldMine",
                collection: "buildings",
                position: nearestGoldVeinLocation
            },
            {
                type: "peasant",
                collection: "units",
                position: peasantPositions[0]
            },
            {
                type: "peasant",
                collection: "units",
                position: peasantPositions[1]
            },
            {
                type: "peasant",
                collection: "units",
                position: peasantPositions[2]
            },
            {
                type: "peasant",
                collection: "units",
                position: peasantPositions[3]
            }
        ];
        return {
            success: true, 
            startingUnits: startingUnits
        }
    }
}
