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
        if (!this.engine.serverEventManager) {
            console.error('No event manager found on engine');
            return;
        }

        // Subscribe to room management events
        this.engine.serverEventManager.subscribe('SUBMIT_PLACEMENTS', this.handleSubmitPlacements.bind(this));
        this.engine.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        this.engine.serverEventManager.subscribe('APPLY_SPECIALIZATION', this.handleApplySpecialization.bind(this));
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
        const { placementId } = data;
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
                    const success = await this.game.squadExperienceSystem.levelUpSquad(placementId, null, playerId);
                    if(success){
                        const levelUpCost = this.game.squadExperienceSystem.getLevelUpCost(placementId);        
                  
                        player.stats.gold -= levelUpCost;
                
                        this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                            playerId: playerId,
                            success: true
                        });
                    }
                }
            }
        } 
    }

    handleApplySpecialization(eventData){
        const { playerId, data } = eventData;
        const { placementId, specializationId } = data;
        const success = this.game.squadExperienceSystem.applySpecialization(placementId, specializationId, playerId);
        if(success){   
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);         
            const room = this.engine.getRoom(roomId);
            const gameState = room.getGameState();
            this.serverNetworkManager.sendToPlayer(playerId, 'SPECIALIZATION_APPLIED', {
                playerId: playerId,
                success: true,
                gameState: gameState
            });
        }
    }

    handleSubmitPlacements(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placements, ready } = data;
  
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) { 
                console.log("room not found");
               
                this.serverNetworkManager.sendToPlayer(playerId, 'PLACEMENT_READY_UPDATE', { 
                    error: 'Room not found',
                    playerId: playerId,
                    ready: false
                });
                return;
            }
            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);
            // Submit placements and update ready state
            const result = this.submitPlayerPlacements(playerId, player, placements, true);
            
            if (result.success) {
                // Broadcast ready state update to all players in room
                this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENTS', {
                    playerId: playerId,
                    ready: true
                });
                
              
                // Check if all players are ready and start battle if so
                if (this.areAllPlayersReady() && this.game.state.phase === 'placement') {

                                // Spawn units from placements
                    this.game.serverBattlePhaseSystem.spawnSquadsFromPlacements(room);
                    const gameState = room.getGameState();
                    this.serverNetworkManager.broadcastToRoom(roomId, 'PLACEMENT_READY_UPDATE', {                       
                        gameState: gameState,
                        allReady: true
                    });
                    this.placementReadyStates.clear();
                    // Small delay to ensure clients receive the ready update
                    setTimeout(() => {
                        this.game.serverBattlePhaseSystem.startBattle(room);
                    }, 500);
                }
            } else {
                console.log('Error submitting placements', result.error);
               
                this.serverNetworkManager.sendToPlayer(playerId, 'PLACEMENT_READY_UPDATE', { 
                    error: result.error,
                    playerId: playerId,
                    ready: false
                });
            }
        } catch (error) {
            console.error('Error submitting placements:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'PLACEMENT_READY_UPDATE', { 
                error: 'Server error while submitting placements',
                playerId: eventData.playerId,
                ready: false
            });
        }
    }

    areAllPlayersReady() {
        let states = [...this.placementReadyStates.values()]
        return states.length == this.numPlayers && states.every(ready => ready === true);
    }


    submitPlayerPlacements(playerId, player, placements, ready = true) {
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state})` };
        }
        
        // Validate placements if provided
        if (placements.length > 0 && !this.validatePlacements(placements, player)) {
            return { success: false, error: 'Invalid placements' };
        }

        if (placements.length > 0) {
            // Filter to only NEW placements from this round
            const newPlacements = placements.filter(placement => 
                placement.roundPlaced === this.game.state.round
            );
            // Calculate cost of only NEW units
            const newUnitsCost = newPlacements.reduce((sum, p) => sum + (p.unitType?.value || 0), 0);
            

            // Deduct gold only for new units
            if (newUnitsCost > 0) {
                player.stats.gold -= newUnitsCost;
            }            
        }
        
        // Store placements
        this.playerPlacements.set(playerId, placements);
        player.stats.squadsPlacedThisRound = placements.length;
        
        if(player.stats.side == 'left'){
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }

        // Update ready state
        player.placementReady = ready;
        this.placementReadyStates.set(playerId, ready);
        
        return { success: true };
    }



    validatePlacements(placements, player) {
        // Check squad count limit
        if (placements.length > this.maxSquadsPerRound) {
            console.log(`Player ${player.id} exceeded squad limit: ${placements.length} > ${this.maxSquadsPerRound}`);
            return false;
        }
        
        // Filter to only NEW placements from this round
        const newPlacements = placements.filter(placement => 
            placement.roundPlaced === this.game.state.round
        );
        // Calculate cost of only NEW units
        const newUnitsCost = newPlacements.reduce((sum, p) => sum + (p.unitType?.value || 0), 0);
        
        
        if (newUnitsCost > player.stats.gold) {
            console.log(`Player ${player.id} insufficient gold: ${newUnitsCost} > ${player.stats.gold}`);
            console.log(newPlacements);
            return false;
        }
        
        // Check placement positions (basic validation)
        for (const placement of placements) {
            if (!placement.gridPosition || !placement.unitType) {
                console.log(`Player ${player.id} invalid placement data:`, placement);
                return false;
            }
            
            // Validate side placement - no mirroring, direct side enforcement
               // Validate side placement - no mirroring, direct side enforcement
            const squadData = this.game.squadManager.getSquadData(placement.unitType);
            const cells = this.game.squadManager.getSquadCells(placement.gridPosition, squadData);
            if(!this.game.gridSystem.isValidPlacement(cells, player.stats.side)){
                console.log('Invalid Placement', placement);
                return false;
            }
        }
        
        return true;
    }



}
