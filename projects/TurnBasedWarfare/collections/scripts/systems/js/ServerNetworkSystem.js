/**
 * ServerNetworkSystem - Server-side network event handlers
 *
 * Mirrors ClientNetworkSystem on the client. This system handles all
 * server-side network events: receives requests, validates, calls domain
 * systems (PlacementSystem, CheatCodeSystem, etc.), and sends responses.
 *
 * Domain systems contain the actual logic and run identically on client/server.
 * This system is purely a network adapter layer.
 */
class ServerNetworkSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverNetworkSystem = this;
        this.serverNetworkManager = this.engine?.serverNetworkManager;
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
    }

    init(params) {
        this.params = params || {};

        if (!this.serverNetworkManager) {
            console.log('[ServerNetworkSystem] No server network manager - skipping server event subscriptions');
            return;
        }

        this.subscribeToEvents();
        console.log('[ServerNetworkSystem] Initialized');
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('[ServerNetworkSystem] No event manager found');
            return;
        }

        // Placement events
        this.game.serverEventManager.subscribe('GET_STARTING_STATE', this.handleGetStartingState.bind(this));
        this.game.serverEventManager.subscribe('SUBMIT_PLACEMENT', this.handleSubmitPlacement.bind(this));
        this.game.serverEventManager.subscribe('PURCHASE_UPGRADE', this.handlePurchaseUpgrade.bind(this));
        this.game.serverEventManager.subscribe('READY_FOR_BATTLE', this.handleReadyForBattle.bind(this));
        this.game.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGET', this.handleSetSquadTarget.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGETS', this.handleSetSquadTargets.bind(this));
        this.game.serverEventManager.subscribe('CANCEL_BUILDING', this.handleCancelBuilding.bind(this));

        // Cheat events
        this.game.serverEventManager.subscribe('EXECUTE_CHEAT', this.handleExecuteCheat.bind(this));

        console.log('[ServerNetworkSystem] Server events subscribed');
    }

    // ==================== PLACEMENT HANDLERS ====================

    handleGetStartingState(eventData) {
        try {
            const { playerId } = eventData;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', {
                    error: 'Room not found'
                });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            if (player) {
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

    handleSubmitPlacement(eventData) {
        try {
            const { playerId, numericPlayerId, data } = eventData;
            const { placement } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', {
                    error: 'Room not found'
                });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            // Call PlacementSystem to handle the actual placement
            const result = this.game.call('placePlacement', playerId, numericPlayerId, player, placement);
            this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', result);

        } catch (error) {
            console.error('Error submitting placements:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SUBMITTED_PLACEMENT', {
                error: 'Server error while submitting placements',
                success: false
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

            const result = this.purchaseUpgrade(playerId, player, data.data);
            this.serverNetworkManager.sendToPlayer(playerId, 'PURCHASED_UPGRADE', result);

        } catch (error) {
            console.error('Error purchasing upgrades:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'PURCHASED_UPGRADE', {
                error: 'Server error while purchasing upgrades',
                playerId: eventData.playerId,
                ready: false
            });
        }
    }

    async handleLevelSquad(eventData) {
        const { playerId, data } = eventData;
        const { placementId, specializationId } = data;

        if (!playerId) return;

        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (!roomId) return;

        const room = this.engine.getRoom(roomId);
        if (!room) return;

        const playerStats = this.game.call('getPlayerStats', playerId);
        const playerGold = playerStats?.gold || 0;

        if (!this.game.call('canAffordLevelUp', placementId, playerGold)) {
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                playerId: playerId,
                error: "gold_low_error",
                success: false
            });
            return false;
        }

        const success1 = specializationId ? this.game.call('applySpecialization', placementId, specializationId, playerId) : true;

        await this.game.call('levelUpSquad', placementId, null, playerId, (success) => {
            if (success1 && success) {
                const levelUpCost = this.game.call('getLevelUpCost', placementId);
                playerStats.gold -= levelUpCost;

                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                    playerId: playerId,
                    currentGold: playerStats.gold,
                    success: true
                });
            }
        });
    }

    handleSetSquadTarget(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementId, targetPosition, meta } = data;

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { success: false });
                return;
            }

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { error: 'Room not found' });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { error: 'Player not found' });
                return;
            }

            // Validate placement belongs to player
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', { error: 'Placement not found' });
                return;
            }

            // Server is authoritative for issuedTime
            const serverIssuedTime = this.game.state.now;

            // Handle build order - update building's assignedBuilder and set buildingState
            if (meta?.buildingId != null) {
                const buildingPlacement = this.game.getComponent(meta.buildingId, 'placement');
                if (buildingPlacement) {
                    const builderEntityId = placement.squadUnits?.[0];
                    if (builderEntityId) {
                        buildingPlacement.assignedBuilder = builderEntityId;

                        let buildingState = this.game.getComponent(builderEntityId, "buildingState");
                        if (!buildingState) {
                            this.game.addComponent(builderEntityId, "buildingState", {
                                targetBuildingEntityId: meta.buildingId,
                                buildTime: buildingPlacement.buildTime || 5,
                                constructionStartTime: 0
                            });
                        } else {
                            buildingState.targetBuildingEntityId = meta.buildingId;
                            buildingState.buildTime = buildingPlacement.buildTime || 5;
                            buildingState.constructionStartTime = 0;
                        }
                    }
                }
            }

            // Apply target position via UnitOrderSystem
            this.game.call('applySquadTargetPosition', placementId, targetPosition, meta, serverIssuedTime);

            // Send success response
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                success: true,
                placementId,
                targetPosition,
                meta,
                issuedTime: serverIssuedTime
            });

            // Broadcast to other players
            for (const [otherPlayerId] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGET_SET', {
                        placementId,
                        targetPosition,
                        meta,
                        issuedTime: serverIssuedTime
                    });
                }
            }

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

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { success: false });
                return;
            }

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { error: 'Room not found' });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { error: 'Player not found' });
                return;
            }

            const serverIssuedTime = this.game.state.now;

            for (let i = 0; i < placementIds.length; i++) {
                const placementId = placementIds[i];
                const targetPosition = targetPositions[i];

                const placement = this.game.call('getPlacementById', placementId);
                if (!placement) {
                    this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', { error: 'Placement not found' });
                    return;
                }

                this.game.call('applySquadTargetPosition', placementId, targetPosition, meta, serverIssuedTime);
            }

            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                success: true,
                placementIds,
                targetPositions,
                meta,
                issuedTime: serverIssuedTime
            });

            for (const [otherPlayerId] of room.players) {
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
            console.error('Error setting squad targets:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SQUAD_TARGETS_SET', {
                error: 'Server error while setting squad targets'
            });
        }
    }

    handleReadyForBattle(eventData) {
        const { playerId } = eventData;

        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (!roomId) {
            this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { error: 'Room not found' });
            return;
        }

        const room = this.engine.getRoom(roomId);
        const player = room.getPlayer(playerId);

        // Update ready state
        player.ready = true;
        this.placementReadyStates.set(playerId, true);

        this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { success: true });

        console.log('[ServerNetworkSystem] Ready for battle:', {
            playerId,
            readyStates: [...this.placementReadyStates.entries()],
            numPlayers: this.numPlayers,
            phase: this.game.state.phase,
            allReady: this.areAllPlayersReady()
        });

        // Check if all players are ready
        if (this.areAllPlayersReady() && this.game.state.phase === this.enums.gamePhase.placement) {
            const gameState = room.getGameState();

            // Reset time before serializing
            this.game.resetCurrentTime();
            this.game.desyncDebugger.enabled = true;
            this.game.desyncDebugger.displaySync(true);
            this.game.call('resetAI');
            this.game.triggerEvent("onBattleStart");

            // Serialize all entities for client sync
            const entitySync = this.game.call('serializeAllEntities');

            let aliveCount = 0;
            if (entitySync.entityAlive) {
                for (let i = 0; i < entitySync.entityAlive.length; i++) {
                    if (entitySync.entityAlive[i]) aliveCount++;
                }
            }

            console.log('[SERVER SYNC DEBUG] Broadcasting READY_FOR_BATTLE_UPDATE:', {
                nextEntityId: this.game.nextEntityId,
                entitySyncNextEntityId: entitySync.nextEntityId,
                entityAliveLength: entitySync.entityAlive?.length,
                aliveEntityCount: aliveCount,
                entitiesWithPlacement: this.game.getEntitiesWith('placement').length,
                entitiesWithTeam: this.game.getEntitiesWith('team').length,
                placementsByTeam: {
                    left: this.game.call('getPlacementsForSide', this.enums.team.left).length,
                    right: this.game.call('getPlacementsForSide', this.enums.team.right).length
                }
            });

            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {
                gameState: gameState,
                allReady: true,
                entitySync: entitySync,
                serverTime: this.game.state.now,
                nextEntityId: this.game.nextEntityId
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

    handleCancelBuilding(eventData) {
        try {
            const { playerId, numericPlayerId, data } = eventData;
            const { placementId, buildingEntityId } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', { error: 'Room not found' });
                return;
            }

            const room = this.engine.getRoom(roomId);
            const player = room.getPlayer(playerId);

            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', { error: 'Player not found' });
                return;
            }

            const placement = this.game.getComponent(buildingEntityId, 'placement');
            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', { error: 'Building not found' });
                return;
            }

            if (placement.playerId !== numericPlayerId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', { error: 'Building does not belong to this player' });
                return;
            }

            if (!placement.isUnderConstruction) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', { error: 'Building is not under construction' });
                return;
            }

            // Get unitType for refund
            const unitTypeComp = this.game.getComponent(buildingEntityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const refundAmount = unitType?.value || 0;

            if (refundAmount > 0) {
                player.gold = (player.gold || 0) + refundAmount;
            }

            // Clean up builder
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

            // Destroy building
            this.game.call('removeInstance', buildingEntityId);
            this.game.destroyEntity(buildingEntityId);

            this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                success: true,
                placementId,
                refundAmount,
                gold: player.gold
            });

            // Broadcast to other players
            for (const [otherPlayerId] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_BUILDING_CANCELLED', {
                        placementId,
                        team: player.team
                    });
                }
            }

        } catch (error) {
            console.error('Error cancelling building:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'BUILDING_CANCELLED', {
                error: 'Server error while cancelling building'
            });
        }
    }

    // ==================== CHEAT HANDLERS ====================

    handleExecuteCheat(eventData) {
        const { playerId, data } = eventData;
        const { cheatName, params } = data;

        console.log(`[ServerNetworkSystem] Received cheat request from player ${playerId}: ${cheatName}`, params);

        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (!roomId) {
            this.serverNetworkManager.sendToPlayer(playerId, 'CHEAT_EXECUTED', { error: 'Room not found' });
            return;
        }

        // Validate cheat
        const validation = this.game.call('validateCheat', cheatName, params);
        if (!validation.valid) {
            this.serverNetworkManager.sendToPlayer(playerId, 'CHEAT_EXECUTED', { error: validation.error });
            return;
        }

        // Execute cheat
        const result = this.game.call('executeCheat', cheatName, params);
        if (result.error) {
            this.serverNetworkManager.sendToPlayer(playerId, 'CHEAT_EXECUTED', { error: result.error });
            return;
        }

        // Send success response
        this.serverNetworkManager.sendToPlayer(playerId, 'CHEAT_EXECUTED', {
            success: true,
            cheatName,
            params,
            result
        });

        // Broadcast to all players
        this.serverNetworkManager.broadcastToRoom(roomId, 'CHEAT_BROADCAST', {
            cheatName,
            params,
            result,
            initiatedBy: playerId
        });

        console.log(`[ServerNetworkSystem] Cheat ${cheatName} executed and broadcast to room ${roomId}`);
    }

    // ==================== HELPER METHODS ====================

    areAllPlayersReady() {
        const states = [...this.placementReadyStates.values()];
        return states.length === this.numPlayers && states.every(ready => ready === true);
    }

    purchaseUpgrade(playerId, _player, data) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        const playerStats = this.game.call('getPlayerStats', playerId);
        const playerGold = playerStats?.gold || 0;

        const upgrade = this.collections.upgrades[data.upgradeId];
        const upgradeIndex = this.enums.upgrades?.[data.upgradeId];

        if (upgradeIndex === undefined) {
            return { success: false, error: `Unknown upgrade: ${data.upgradeId}` };
        }

        // Check if already purchased (bitmask check)
        if (playerStats.upgrades & (1 << upgradeIndex)) {
            return { success: false, error: "Upgrade already purchased." };
        }

        if (upgrade?.value <= playerGold) {
            // Deduct gold
            playerStats.gold -= upgrade.value;

            // Add upgrade to bitmask
            playerStats.upgrades |= (1 << upgradeIndex);

            return { success: true, upgradeId: data.upgradeId };
        }

        return { success: false, error: "Not enough gold." };
    }

    getStartingStateResponse(player) {
        const playerEntities = this.game.call('getSerializedPlayerEntities') || [];
        return {
            success: true,
            playerEntities
        };
    }

    // ==================== LIFECYCLE ====================

    onBattleEnd() {
        this.game.desyncDebugger.displaySync(true);
        this.game.desyncDebugger.enabled = false;
    }

    clearAllPlacements() {
        this.placementReadyStates = new Map();
    }
}
