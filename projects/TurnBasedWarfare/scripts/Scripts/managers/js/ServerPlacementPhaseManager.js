class ServerPlacementPhaseManager {
    constructor(game) {
        this.game = game;
        this.engine = this.game.app;    
        this.game.placementSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;  
        this.playerPlacements = new Map();
        this.leftPlacements = new Map();
        this.rightPlacements = new Map();
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
        this.game.serverEventManager.subscribe('SUBMIT_PLACEMENT', this.handleSubmitPlacement.bind(this));
        this.game.serverEventManager.subscribe('READY_FOR_BATTLE', this.handleReadyForBattle.bind(this));
        this.game.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        //   const success = await this.makeNetworkCall('APPLY_SPECIALIZATION', 
        //                 { placementId, specializationId }, 'SPECIALIZATION_APPLIED');

        //             const success = await this.makeNetworkCall('LEVEL_SQUAD', 
        //                 { placementId }, 'SQUAD_LEVELED');
                    
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

                        // Spawn units from placements
            this.game.serverBattlePhaseSystem.spawnSquadsFromPlacements(room);
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {                       
                gameState: gameState,
                allReady: true
            });
            this.placementReadyStates.clear();
            // Small delay to ensure clients receive the ready update
            setTimeout(() => {
                this.game.serverBattlePhaseSystem.startBattle(room);
            }, 500);
        } else {
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {                       
                gameState: gameState,
                allReady: false
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
        console.log(`Room ID: ${this.room?.id || 'NO ROOM'}`);
        console.log(`Game phase: ${this.game.state.phase}`);
        console.log(`Player object:`, player);
        console.log(`================================`);
    
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }
        
        // Validate placements if provided
        if ( !this.validatePlacement(placement, player)) {
            return { success: false, error: 'Invalid placement' };
        }


        // Deduct gold only for new units
        if (placement.unitType?.value > 0) {
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
        player.stats.squadsPlacedThisRound++;
        
        if(player.stats.side == 'left'){
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }
        
        return { success: true };
    }



    validatePlacement(placement, player) {
        // Check squad count limit
        if (player.stats.squadsPlacedThisRound >= this.maxSquadsPerRound) {
            console.log(`Player ${player.id} exceeded squad limit: ${placements.length} > ${this.maxSquadsPerRound}`);
            return false;
        }

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

}
