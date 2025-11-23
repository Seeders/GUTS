/**
 * NetworkHandlers
 *
 * THIN NETWORK LAYER for server.
 * This system only handles network I/O - validation, authentication, broadcasting.
 * All game logic is delegated to shared systems (PlacementSystem, PlayerInputInterface).
 *
 * This system subscribes to network events and:
 * 1. Validates the request (auth, phase check, etc.)
 * 2. Delegates to game logic (PlacementSystem, PlayerInputInterface)
 * 3. Sends network responses
 */
class NetworkHandlers extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.serverNetworkManager = this.engine.serverNetworkManager;
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
    }

    init(params) {
        this.params = params || {};
        this.subscribeToEvents();
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('[NetworkHandlers] No event manager found');
            return;
        }

        // Subscribe to network events
        this.game.serverEventManager.subscribe('GET_STARTING_STATE', this.handleGetStartingState.bind(this));
        this.game.serverEventManager.subscribe('SUBMIT_PLACEMENT', this.handleSubmitPlacement.bind(this));
        this.game.serverEventManager.subscribe('PURCHASE_UPGRADE', this.handlePurchaseUpgrade.bind(this));
        this.game.serverEventManager.subscribe('READY_FOR_BATTLE', this.handleReadyForBattle.bind(this));
        this.game.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGET', this.handleSetSquadTarget.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGETS', this.handleSetSquadTargets.bind(this));
        this.game.serverEventManager.subscribe('CANCEL_BUILDING', this.handleCancelBuilding.bind(this));
    }

    // ==========================================
    // NETWORK HANDLERS (thin validation layer)
    // ==========================================

    handleGetStartingState(eventData) {
        try {
            const { playerId } = eventData;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                return;
            }

            const room = this.engine.getRoom(roomId);
            if (!room || !room.players || !room.players.has(playerId)) {
                return;
            }

            const player = room.getPlayer(playerId);
            if (!player) {
                return;
            }

            this.serverNetworkManager.sendToPlayer(playerId, 'STARTING_STATE', {
                teamId: player.stats.side,
                level: this.game.state.level
            });
        } catch (error) {
            console.error('[NetworkHandlers] Error getting starting state:', error);
        }
    }

    handleLevelSquad(eventData) {
        const { playerId, data } = eventData;

        if (playerId) {
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (roomId) {
                const room = this.engine.getRoom(roomId);
                const player = room.getPlayer(playerId);
                const playerGold = player.stats.gold;

                if (!this.game.gameManager.call('canAffordLevelUp', data.data, playerGold)) {
                    this.serverNetworkManager.sendToPlayer(playerId, 'LEVEL_SQUAD', {
                        success: false
                    });
                    return;
                }

                let [success, cost] = this.game.gameManager.call('levelSquad', data.data);

                if (success && success) {
                    player.stats.gold -= cost;

                    this.serverNetworkManager.sendToPlayer(playerId, 'LEVEL_SQUAD', {
                        success: true,
                        goldRemaining: player.stats.gold
                    });
                } else {
                    this.serverNetworkManager.sendToPlayer(playerId, 'LEVEL_SQUAD', {
                        success: false
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

            // Delegate to PlacementSystem
            const result = this.game.placementSystem.submitPlacement(playerId, player, placement);

            this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', result);
        } catch (error) {
            console.error('[NetworkHandlers] Error submitting placement:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SUBMITTED_PLACEMENT', {
                error: 'Server error while submitting placement'
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

            // TODO: Implement purchase upgrade logic in PlacementSystem or UpgradeSystem
            this.serverNetworkManager.sendToPlayer(playerId, 'PURCHASED_UPGRADE', {
                success: false,
                error: 'Not implemented'
            });
        } catch (error) {
            console.error('[NetworkHandlers] Error purchasing upgrade:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'PURCHASED_UPGRADE', {
                error: 'Server error while purchasing upgrade'
            });
        }
    }

    handleSetSquadTarget(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementId, targetPosition, meta, commandCreatedTime } = data;

            // Validate: Phase check
            if (this.game.state.phase != "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                    success: false
                });
                return;
            }

            // Validate: Room and player exist
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

            // Validate: Placement exists
            const placement = this.game.gameManager.call('getPlacementById', placementId);
            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                    error: 'Placement not found'
                });
                return;
            }

            // Delegate to PlayerInputInterface
            this.game.playerInputInterface.setSquadTarget(
                placementId,
                targetPosition,
                meta,
                commandCreatedTime,
                { playerId, roomId, room }
            );

        } catch (error) {
            console.error('[NetworkHandlers] Error setting squad target:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SQUAD_TARGET_SET', {
                error: 'Server error while setting squad target'
            });
        }
    }

    handleSetSquadTargets(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementIds, targetPositions, meta, commandCreatedTime } = data;

            // Validate: Phase check
            if (this.game.state.phase != "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                    success: false
                });
                return;
            }

            // Validate: Room and player exist
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

            // Validate: All placements exist
            for (let i = 0; i < placementIds.length; i++) {
                const placementId = placementIds[i];
                const placement = this.game.gameManager.call('getPlacementById', placementId);

                if (!placement) {
                    this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                        error: 'Placement not found'
                    });
                    return;
                }
            }

            // Delegate to PlayerInputInterface
            this.game.playerInputInterface.setSquadTargets(
                placementIds,
                targetPositions,
                meta,
                commandCreatedTime,
                { playerId, roomId, room }
            );

        } catch (error) {
            console.error('[NetworkHandlers] Error setting squad targets:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SQUAD_TARGETS_SET', {
                error: 'Server error while setting squad targets'
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

        // Update ready state
        this.placementReadyStates.set(playerId, data.ready);

        // Broadcast ready state to all players in room
        for (const [otherPlayerId, otherPlayer] of room.players) {
            this.serverNetworkManager.sendToPlayer(otherPlayerId, 'READY_FOR_BATTLE_UPDATE', {
                playerId: playerId,
                ready: data.ready
            });
        }

        // Check if all players ready
        const allReady = Array.from(room.players.keys()).every(pid =>
            this.placementReadyStates.get(pid) === true
        );

        if (allReady && room.players.size >= this.numPlayers) {
            console.log('[NetworkHandlers] All players ready, starting battle');
            this.placementReadyStates.clear();

            for (const [otherPlayerId, otherPlayer] of room.players) {
                this.serverNetworkManager.sendToPlayer(otherPlayerId, 'START_BATTLE', {});
            }

            this.game.triggerEvent('onBattleStart');
        }
    }

    handleCancelBuilding(eventData) {
        try {
            const { playerId, data } = eventData;
            const { buildingId } = data;

            // Validate room
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                    success: false,
                    error: 'Room not found'
                });
                return;
            }

            const room = this.engine.getRoom(roomId);

            // TODO: Implement cancel building logic
            // For now, just send success
            this.serverNetworkManager.sendToPlayer(playerId, 'BUILDING_CANCELLED', {
                success: true,
                buildingId
            });

            // Broadcast to other players
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_BUILDING_CANCELLED', {
                        buildingId
                    });
                }
            }
        } catch (error) {
            console.error('[NetworkHandlers] Error canceling building:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'BUILDING_CANCELLED', {
                success: false,
                error: 'Server error'
            });
        }
    }
}
