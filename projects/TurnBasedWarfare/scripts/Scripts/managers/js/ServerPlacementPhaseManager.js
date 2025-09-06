class ServerPlacementPhaseManager {
    constructor(game) {
        this.game = game;
        this.engine = this.game.app;    
        this.game.serverPlacementPhaseManager = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;  
        this.playerPlacements = new Map();
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
                    ready: true,
                    gameState: room.getGameState(),
                    placements: placements
                });
                
              
                // Check if all players are ready and start battle if so
                if (this.areAllPlayersReady() && this.game.state.phase === 'placement') {
                
                    let gameState = room.getGameState();
                    let allPlacements = {};
                    gameState.players.forEach((player) => {
                        allPlacements[player.id] = this.playerPlacements.get(player.id)
                    });
                    this.serverNetworkManager.broadcastToRoom(roomId, 'PLACEMENT_READY_UPDATE', {                       
                        gameState: gameState,
                        allReady: true,
                        allPlacements: allPlacements
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
        
        // Store placements
        this.playerPlacements.set(playerId, placements);
        player.squadsPlacedThisRound = placements.length;
        
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
        
        // Check gold cost
        let totalCost = 0;
        for (const placement of placements) {
            totalCost += placement.unitType?.value || 0;
        }
        
        if (totalCost > player.gold) {
            console.log(`Player ${player.id} insufficient gold: ${totalCost} > ${player.gold}`);
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
            if(!this.game.gridSystem.isValidPlacement(cells, player.side)){
                console.log('Invalid Placement', placement);
                return false;
            }
        }
        
        return true;
    }



}
