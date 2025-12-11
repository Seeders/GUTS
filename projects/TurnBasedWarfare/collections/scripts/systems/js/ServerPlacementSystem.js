class ServerPlacementSystem extends GUTS.BasePlacementSystem {
    constructor(game) {
        super(game);
        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
    }

    init(params) {
        this.params = params || {};
        // Register base class methods with gameManager
        this.game.register('getPlacementsForSide', this.getPlacementsForSide.bind(this));
        this.game.register('getPlacementById', this.getPlacementById.bind(this));
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
        this.game.serverEventManager.subscribe('CANCEL_BUILDING', this.handleCancelBuilding.bind(this));
    }

    /**
     * Called when scene loads - spawn starting units deterministically
     * Server spawns first (before any clients connect) so entity IDs are consistent
     */
    onSceneLoad(sceneData) {
        console.log('[ServerPlacementSystem] onSceneLoad - spawning starting units');
        this.spawnStartingUnits();
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
            // Send camera position and player entities (starting units are already spawned)
            if(player){
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', this.getStartingStateResponse(player));
            }

        } catch (error) {
            console.error('Error getting starting state:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'GOT_STARTING_STATE', {
                error: 'Server error while getting starting state',
                playerId: eventData.playerId,
                ready: false,
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
                    const playerStats = this.game.call('getPlayerStats', playerId);
                    playerGold = playerStats?.gold || 0;
                    console.log('got player gold', playerGold);

                    if (!this.game.call('canAffordLevelUp', placementId, playerGold)) {
                        console.log("not enough gold to level up");
                        this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                            playerId: playerId,
                            error: "gold_low_error",
                            success: false
                        });
                        return false;
                    }
                    const success1 = specializationId ? this.game.call('applySpecialization', placementId, specializationId, playerId) : true;

                    await this.game.call('levelUpSquad', placementId, null, playerId, (success) => {
                        console.log('success?: ', success1, success);
                        if(success1 && success){
                            const levelUpCost = this.game.call('getLevelUpCost', placementId);

                            playerStats.gold -= levelUpCost;
                            console.log('leveled, new gold amt:', playerStats.gold);
                            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                                playerId: playerId,
                                currentGold: playerStats.gold,
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
            const { placementId, targetPosition, meta } = data;
            if(this.game.state.phase != "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { 
                    success: false
                });
                return;
            };
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

            // Server is authoritative for issuedTime
            const serverIssuedTime = this.game.state.now;

            // Handle build order - update building's assignedBuilder
            if (meta?.isBuildOrder && meta?.buildingId) {
                const buildingPlacement = this.game.getComponent(meta.buildingId, 'placement');
                if (buildingPlacement) {
                    // Get the builder entity from the placement's squad
                    const builderEntityId = placement.squadUnits?.[0];
                    if (builderEntityId) {
                        buildingPlacement.assignedBuilder = builderEntityId;
                    }
                }
            }

            // Store target position in placement data
            // Use UnitOrderSystem to properly queue MOVE commands
            if (this.game.unitOrderSystem) {
                this.game.unitOrderSystem.applySquadTargetPosition(placementId, targetPosition, meta, serverIssuedTime);
            } else {
                // Fallback if UnitOrderSystem not available
                placement.targetPosition = targetPosition;
                placement.squadUnits.forEach((unitId) => {
                    // Remove existing player order if present, then add new one
                    if (this.game.hasComponent(unitId, "playerOrder")) {
                        this.game.removeComponent(unitId, "playerOrder");
                    }
                    this.game.addComponent(unitId, "playerOrder", {
                        targetPosition: targetPosition,
                        meta: meta,
                        issuedTime: serverIssuedTime
                    });
                });
            }

            // Send success response to requesting player with server-authoritative time
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                success: true,
                placementId,
                targetPosition,
                meta,
                issuedTime: serverIssuedTime
            });

            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGET_SET', {
                        placementId,
                        targetPosition,
                        meta,
                        issuedTime: serverIssuedTime
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
            const { placementIds, targetPositions, meta } = data;
            if(this.game.state.phase != "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { 
                    success: false
                });
                return;
            };
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
            
            // Server is authoritative for issuedTime
            const serverIssuedTime = this.game.state.now;

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

                // Store target position and queue MOVE command immediately
                // This ensures abilities like mining are properly interrupted during placement phase
                if (this.game.unitOrderSystem) {
                    this.game.unitOrderSystem.applySquadTargetPosition(placementId, targetPosition, meta, serverIssuedTime);
                } else {
                    // Fallback if UnitOrderSystem not available
                    placement.targetPosition = targetPosition;
                    placement.squadUnits.forEach((unitId) => {
                        // Remove existing player order if present, then add new one
                        if (this.game.hasComponent(unitId, "playerOrder")) {
                            this.game.removeComponent(unitId, "playerOrder");
                        }
                        this.game.addComponent(unitId, "playerOrder", {
                            targetPosition: targetPosition,
                            meta: meta,
                            issuedTime: serverIssuedTime
                        });
                        this.game.triggerEvent('onIssuedPlayerOrders', unitId);

                        console.log(`Player ${playerId} set target for squad ${unitId}:`, targetPosition);
                    });
                }


            }

            // Send success response to requesting player with server-authoritative time
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                success: true,
                placementIds,
                targetPositions,
                meta,
                issuedTime: serverIssuedTime
            });

            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGETS_SET', {
                        placementIds,
                        targetPositions,
                        meta,
                        issuedTime: serverIssuedTime
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
        player.ready = true;
        this.placementReadyStates.set(playerId, true);
        
        this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { success: true });

        console.log('[ServerPlacementSystem] Ready for battle:', {
            playerId,
            readyStates: [...this.placementReadyStates.entries()],
            numPlayers: this.numPlayers,
            phase: this.game.state.phase,
            allReady: this.areAllPlayersReady()
        });

        // Check if all players are ready and start battle if so
        if (this.areAllPlayersReady() && this.game.state.phase === 'placement') {

            const gameState = room.getGameState();

            // Reset time and apply target positions before serializing
            this.game.resetCurrentTime();
            this.applyTargetPositions();
            this.game.desyncDebugger.enabled = true;
            this.game.desyncDebugger.displaySync(true);
            this.resetAI();
            this.game.triggerEvent("onBattleStart");

            // Serialize all entities for client sync (similar to battle end)
            const entitySync = this.game.serverBattlePhaseSystem.serializeAllEntities();

            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {
                gameState: gameState,
                allReady: true,
                entitySync: entitySync,
                serverTime: this.game.state.now,
                nextEntityId: this.game.nextEntityId // Sync entity ID counter
            });
            this.placementReadyStates.clear();

            this.game.call('startBattle', room);
        } else {
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {                       
                gameState: gameState,
                allReady: false
            });
        }

    }
    
    resetAI() {
        const combatEntities = this.game.getEntitiesWith("combat");
        combatEntities.forEach((entityId) => {
            const combat = this.game.getComponent(entityId, "combat");
            combat.lastAttack = 0;
        });
    }

    applyTargetPositions() {
        // Query all entities with placement component
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        const processedPlacements = new Set();

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId || processedPlacements.has(placementComp.placementId)) {
                continue;
            }
            processedPlacements.add(placementComp.placementId);

            const targetPosition = placementComp.targetPosition;
            if (!targetPosition) continue;

            // Get all squad units for this placement
            for (const eid of entitiesWithPlacement) {
                const pc = this.game.getComponent(eid, 'placement');
                if (pc?.placementId !== placementComp.placementId) continue;

                const aiState = this.game.getComponent(eid, "aiState");
                const transform = this.game.getComponent(eid, "transform");
                const position = transform?.position;
                if (aiState && position) {
                    // With behavior tree system, check distance and update aiState
                    const dx = position.x - targetPosition.x;
                    const dz = position.z - targetPosition.z;
                    const distSq = dx * dx + dz * dz;
                    const placementGridSize = this.game.call('getPlacementGridSize');
                    const threshold = placementGridSize * 0.5;

                    if (distSq <= threshold * threshold) {
                        // Reached target - stop movement
                        const vel = this.game.getComponent(eid, "velocity");
                        if (vel) {
                            vel.vx = 0;
                            vel.vz = 0;
                        }
                        if (aiState) {
                            aiState.meta = {};
                        }
                        placementComp.targetPosition = null;
                    }
                    // Movement is handled by behavior actions now
                    // Behavior tree reads from playerOrder component
                }
            }
        }
    }

    areAllPlayersReady() {
        let states = [...this.placementReadyStates.values()]
        return states.length == this.numPlayers && states.every(ready => ready === true);
    }


    submitPlayerPlacement(playerId, player, placement) {
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        // Look up full unitType from collections using unitTypeId and collection
        const unitTypeId = placement.unitTypeId || placement.unitType?.id;
        const collection = placement.collection;

        if (!unitTypeId || !collection) {
            return { success: false, error: 'Missing unitTypeId or collection' };
        }

        const collections = this.game.getCollections();
        const unitType = collections[collection]?.[unitTypeId];

        if (!unitType) {
            return { success: false, error: `Unit type not found: ${collection}/${unitTypeId}` };
        }

        // Build full placement with unitType from server collections
        const fullPlacement = {
            ...placement,
            unitType: unitType
        };

        // Get player stats from entity
        const playerStats = this.game.call('getPlayerStats', playerId);

        // Validate placement
        if (!this.validatePlacement(fullPlacement, player, playerStats)) {
            return { success: false, error: 'Invalid placement' };
        }

        // Deduct gold only for new units
        if (unitType.value > 0 && !fullPlacement.isStartingState && playerStats) {
            playerStats.gold -= unitType.value;
        }

        // Spawn entities using shared base class method
        const result = this.spawnSquad(fullPlacement, player.side, playerId);

        // Return entity IDs and server time so client can use them for sync
        return {
            success: result.success,
            squadUnits: result.squad?.squadUnits || [],
            placementId: result.squad?.placementId,
            serverTime: this.game.state.now  // Authoritative time for playerOrder sync
        };
    }


    onBattleEnd() {        
        this.removeDeadSquadsAfterRound();
       
        this.game.desyncDebugger.displaySync(true);
        this.game.desyncDebugger.enabled = false;
    }
    
    removeDeadSquadsAfterRound() {
        if (!this.game.componentSystem) return;

        // Query all entities with placement component
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        const processedPlacements = new Set();
        const placementsToCleanup = [];

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId || processedPlacements.has(placementComp.placementId)) {
                continue;
            }
            processedPlacements.add(placementComp.placementId);

            // Get all squad units for this placement
            const squadUnits = [];
            for (const eid of entitiesWithPlacement) {
                const pc = this.game.getComponent(eid, 'placement');
                if (pc?.placementId === placementComp.placementId) {
                    squadUnits.push(eid);
                }
            }

            // Check if squad has alive units
            const aliveUnits = squadUnits.filter(eid => {
                const health = this.game.getComponent(eid, "health");
                const deathState = this.game.getComponent(eid, "deathState");
                const buildingState = this.game.getComponent(eid, "buildingState");
                if (buildingState) return true;
                return health && health.current > 0 && (!deathState || !deathState.isDying);
            });

            if (aliveUnits.length === 0) {
                placementsToCleanup.push({ ...placementComp, squadUnits });
            } else if (placementComp.experience) {
                // Update experience unitIds with alive units
                placementComp.experience.unitIds = aliveUnits;
            }
        }

        // Cleanup dead squads
        for (const placement of placementsToCleanup) {
            this.cleanupDeadSquad(placement);
        }
    }

    // cleanupDeadSquad is inherited from BasePlacementSystem

    validatePlacement(placement, player, playerStats) {

        if(placement.isStartingState) return true;
        // Calculate cost of only NEW units
        const newUnitCost =  placement.unitType?.value;
        const playerGold = playerStats?.gold || 0;
        const playerSide = player.side;

        if (newUnitCost > playerGold) {
            console.log(`Player ${player.id} insufficient gold: ${newUnitCost} > ${playerGold}`);
            return false;
        }
        if (this.game.hasService('canAffordSupply') && !this.game.call('canAffordSupply', playerSide, placement.unitType)) {
            console.log(`Player ${player.id} insufficient supply for unit: ${placement.unitType.id}`);
            return false;
        }
        if (!placement.gridPosition || !placement.unitType) {
            console.log(`Player ${player.id} invalid placement data:`, placement);
            return false;
        }

        // Validate side placement - no mirroring, direct side enforcement
        const squadData = this.game.squadSystem.getSquadData(placement.unitType);
        const cells = this.game.squadSystem.getSquadCells(placement.gridPosition, squadData);
        if(!this.game.call('isValidGridPlacement', cells, playerSide)){
            console.log('Invalid Placement', placement);
            for (const cell of cells) {
                const key = `${cell.x},${cell.z}`;
                const cellState = this.game.gridSystem.state.get(key);
                if (cellState && cellState.occupied) {
                    console.log('occupied:', cell, cellState);
                }
            }

            return false;
        }


        return true;
    }
    
    handleCancelBuilding(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementId, buildingEntityId } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    error: 'Room not found'
                });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    error: 'Player not found'
                });
                return;
            }

            // Get placement and unitType directly from the building entity
            const placement = this.game.getComponent(buildingEntityId, 'placement');
            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    error: 'Building not found'
                });
                return;
            }

            // Validate it belongs to this player
            if (placement.playerId !== playerId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    error: 'Building does not belong to this player'
                });
                return;
            }

            // Validate it's under construction
            if (!placement.isUnderConstruction) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    error: 'Building is not under construction'
                });
                return;
            }

            // Get unitType directly from entity for refund
            const unitType = this.game.getComponent(buildingEntityId, 'unitType');
            const refundAmount = unitType?.value || 0;
            if (refundAmount > 0) {
                player.gold = (player.gold || 0) + refundAmount;
            }

            // Clean up the builder if assigned
            const assignedBuilder = placement.assignedBuilder;
            if (assignedBuilder) {
                if (this.game.hasComponent(assignedBuilder, "buildingState")) {
                    this.game.removeComponent(assignedBuilder, "buildingState");
                }
                const builderVel = this.game.getComponent(assignedBuilder, "velocity");
                if (builderVel) {
                    builderVel.vx = 0;
                    builderVel.vz = 0;
                }
            }

            // Destroy the building entity
            this.game.call('removeInstance', buildingEntityId);
            this.game.destroyEntity(buildingEntityId);

            // Send success response to requesting player
            this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                success: true,
                placementId,
                refundAmount,
                gold: player.gold
            });

            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_BUILDING_CANCELLED', {
                        placementId,
                        side: player.side
                    });
                }
            }

            console.log(`Player ${playerId} cancelled building construction: ${placementId}`);

        } catch (error) {
            console.error('Error cancelling building:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'BUILDING_CANCELLED', {
                error: 'Server error while cancelling building'
            });
        }
    }

    clearAllPlacements() {
        // Destroy all entities with placement component
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (placementComp?.placementId) {
                this.game.call('releaseGridCells', placementComp.placementId);
            }
            this.game.destroyEntity(entityId);
        }
        this.placementReadyStates = new Map();
    }
    clearPlayerPlacements(playerId) {
        try {
            // Query entities with placement component for this player
            const entitiesWithPlacement = this.game.getEntitiesWith('placement');
            const entitiesToDestroy = [];

            for (const entityId of entitiesWithPlacement) {
                const placementComp = this.game.getComponent(entityId, 'placement');
                if (placementComp?.playerId === playerId) {
                    entitiesToDestroy.push({ entityId, placementId: placementComp.placementId });
                }
            }

            // Destroy entities
            for (const { entityId, placementId } of entitiesToDestroy) {
                try {
                    if (placementId) {
                        this.game.call('releaseGridCells', placementId);
                    }
                    this.game.destroyEntity(entityId);
                } catch (error) {
                    console.warn(`Error destroying entity ${entityId}:`, error);
                }
            }

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
            // Convert footprint (terrain grid units) to placement grid cells
            const footprintWidth = unitType.footprintWidth || unitType.placementGridWidth || 2;
            const footprintHeight = unitType.footprintHeight || unitType.placementGridHeight || 2;
            const gridWidth = footprintWidth * 2;
            const gridHeight = footprintHeight * 2;

            const result = this.game.call('buildGoldMine', entityId, team, gridPosition, gridWidth, gridHeight);
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

        // Get player stats from entity
        const playerStats = this.game.call('getPlayerStats', playerId);
        const playerGold = playerStats?.gold || 0;
        const playerSide = player.side;

        const upgrade = this.game.getCollections().upgrades[data.upgradeId];
        if(upgrade?.value <= playerGold){
            playerStats.gold -= upgrade.value;
            if(!this.game.state.teams){
                this.game.state.teams = {};
            }
            if(!this.game.state.teams[playerSide]) {
                this.game.state.teams[playerSide] = {};
            }
            if(!this.game.state.teams[playerSide].effects) {
                this.game.state.teams[playerSide].effects = {};
            }
            upgrade.effects.forEach((effectId) => {
                const effect = this.game.getCollections().effects[effectId];
                this.game.state.teams[playerSide].effects[effectId] = effect;
            })

            console.log(`SUCCESS`);
            console.log(`================================`);
            return { success: true };
        }

        console.log(`ERROR`);
        console.log(`================================`);

        return { success: false, error: "Not enough gold." };
    }

    getStartingPositionFromLevel(side) {
        // Get level name from terrain entity (scene-based architecture)
        const terrainEntities = this.game.getEntitiesWith('terrain');
        if (terrainEntities.length === 0) {
            console.warn('[ServerPlacementSystem] No terrain entity found');
            return null;
        }

        const terrainComponent = this.game.getComponent(terrainEntities[0], 'terrain');
        if (!terrainComponent?.level) {
            console.warn('[ServerPlacementSystem] Terrain entity has no level');
            return null;
        }

        // Try to get level data from game collections
        const level = this.game.getCollections().levels[terrainComponent.level];
        if (!level || !level.tileMap || !level.tileMap.startingLocations) {
            console.warn(`[ServerPlacementSystem] Level '${terrainComponent.level}' has no startingLocations`);
            return null;
        }

        // Find starting location for this side
        const startingLoc = level.tileMap.startingLocations.find(loc => loc.side === side);
        if (startingLoc && startingLoc.gridX !== undefined) {
            return { x: startingLoc.gridX, z: startingLoc.gridZ };
        }

        return null;
    }

    /**
     * Get starting state response for a player (player entities only).
     * Starting units and camera are set up deterministically on scene load.
     */
    getStartingStateResponse(player) {
        // Get all player entities with playerStats component (serialized for network)
        const playerEntities = this.game.call('getSerializedPlayerEntities') || [];

        return {
            success: true,
            playerEntities
        };
    }
}
