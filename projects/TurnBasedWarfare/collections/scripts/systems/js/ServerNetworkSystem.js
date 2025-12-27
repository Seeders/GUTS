/**
 * ServerNetworkSystem - Server-side network event handlers
 *
 * This system handles:
 * 1. Event subscriptions via serverEventManager (on actual server)
 * 2. Event handlers (handle* methods) for game events
 * 3. Broadcasting to players via sendToPlayer/broadcastToRoom
 *
 * In multiplayer: routes through ServerNetworkManager to Socket.IO
 * In local game: checks isLocalGame() and routes directly to ClientNetworkSystem handlers
 *
 * Handler methods are exposed as services so they can be called via game.call()
 * in local game mode (ClientNetworkSystem calls them directly with callbacks).
 */
class ServerNetworkSystem extends GUTS.BaseNetworkSystem {
    static services = [
        // Broadcast services
        'sendToPlayer',
        // Handler services (for local game mode game.call() access)
        'handleSubmitPlacement',
        'handleSetSquadTarget',
        'handleSetSquadTargets',
        'handleCancelBuilding',
        'handleUpgradeBuilding',
        'handlePurchaseUpgrade',
        'handleReadyForBattle',
        'handleGetStartingState',
        'handleLevelSquad',
        'handleExecuteCheat'
    ];

    constructor(game) {
        super(game);
        this.game.serverNetworkSystem = this;
        this.placementReadyStates = new Map();
        this.numPlayers = 2;
        // Queue networkUnitData per player for battle start sync
        // Map<playerId, Array<networkUnitData>>
        this.pendingNetworkUnitData = new Map();
    }

    init(params) {
        this.params = params || {};

        // Subscribe to events only on actual server (not in local game mode on client)
        if (this.engine?.isServer && this.game.serverEventManager) {
            this.subscribeToEvents();
        }
    }

    // ==================== NETWORK HELPERS ====================

    /**
     * Check if player exists (has player entity)
     */
    playerExists(playerId) {
        return this.game.call('getPlayerStats', playerId) !== null;
    }

    /**
     * Send response to a player (multiplayer only - local game uses callbacks)
     */
    sendToPlayer(playerId, eventName, data) {
        // In local game mode, responses go through callbacks, not events
        if (this.game.state.isLocalGame) return;
        this.engine?.serverNetworkManager?.sendToPlayer(playerId, eventName, data);
    }

    /**
     * Unified response helper - sends result via callback (local) or sendToPlayer (multiplayer)
     * @param {string} playerId - Player to respond to
     * @param {string} responseName - Event name for multiplayer response
     * @param {Object} result - Result data to send
     * @param {Function} callback - Callback for local mode
     * @returns {*} Returns callback result if callback exists
     */
    respond(playerId, responseName, result, callback) {
        if (callback) return callback(result);
        this.sendToPlayer(playerId, responseName, result);
    }

    /**
     * Create and send an error response
     * @param {string} playerId - Player to respond to
     * @param {string} responseName - Event name for multiplayer response
     * @param {string} error - Error message
     * @param {Function} callback - Callback for local mode
     * @returns {*} Returns callback result if callback exists
     */
    respondError(playerId, responseName, error, callback) {
        return this.respond(playerId, responseName, { error, success: false }, callback);
    }

    /**
     * Send to all other players (multiplayer only - no-op in local game)
     */
    notifyOtherPlayers(excludePlayerId, eventName, data) {
        if (!this.engine?.isServer) return; // Skip in local game
        const playerEntities = this.game.call('getPlayerEntities');
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId !== excludePlayerId) {
                this.sendToPlayer(stats.playerId, eventName, data);
            }
        }
    }

    // ==================== EVENT SUBSCRIPTIONS ====================

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
        this.game.serverEventManager.subscribe('UPGRADE_BUILDING', this.handleUpgradeBuilding.bind(this));

        // Cheat events
        this.game.serverEventManager.subscribe('EXECUTE_CHEAT', this.handleExecuteCheat.bind(this));
    }

    // ==================== PLACEMENT HANDLERS ====================

    handleGetStartingState(eventData, callback) {
        const { playerId } = eventData;
        const responseName = 'GOT_STARTING_STATE';

        try {
            if (!this.playerExists(playerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const result = this.getStartingStateResponse();
            return this.respond(playerId, responseName, result, callback);

        } catch (error) {
            console.error('Error getting starting state:', error);
            return this.respondError(playerId, responseName, 'Server error while getting starting state', callback);
        }
    }

    handleSubmitPlacement(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'SUBMITTED_PLACEMENT';

        try {
            const { placement } = data;

            // Use playerId from placement data - this allows AI to place for its own team
            // In multiplayer, the server validates this matches the authenticated user
            const effectivePlayerId = placement.playerId !== undefined ? placement.playerId : playerId;

            const playerStats = this.game.call('getPlayerStats', effectivePlayerId);
            if (!playerStats) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const result = this.processPlacement(effectivePlayerId, effectivePlayerId, playerStats, placement, null);
            console.log('[ServerNetworkSystem] handleSubmitPlacement result:', {
                success: result.success,
                squadUnits: result.squadUnits,
                placementId: result.placementId
            });

            if (result.success) {
                // Queue networkUnitData for battle start sync
                this.queueNetworkUnitData(effectivePlayerId, effectivePlayerId, playerStats.team, placement, result);
            }

            return this.respond(playerId, responseName, result, callback);

        } catch (error) {
            console.error('Error submitting placements:', error);
            return this.respondError(playerId, responseName, 'Server error while submitting placements', callback);
        }
    }

    /**
     * Queue networkUnitData for a placement to be sent at battle start
     */
    queueNetworkUnitData(playerId, numericPlayerId, team, placement, result) {
        if (!this.pendingNetworkUnitData.has(playerId)) {
            this.pendingNetworkUnitData.set(playerId, { team, numericPlayerId, placements: [] });
        }

        this.pendingNetworkUnitData.get(playerId).placements.push({
            placementId: result.placementId,
            gridPosition: placement.gridPosition,
            unitTypeId: placement.unitTypeId,
            collection: placement.collection,
            team: team,
            playerId: numericPlayerId,
            squadUnits: result.squadUnits || [],
            roundPlaced: placement.roundPlaced || this.game.state.round || 1,
            // Include pending building info for deferred spawning
            isPendingBuilding: result.squad?.isPendingBuilding || false,
            assignedBuilder: placement.peasantInfo?.peasantId
        });
    }

    /**
     * Build players array with networkUnitData for battle start
     */
    buildPlayersForBattleStart() {
        const players = [];
        for (const [socketPlayerId, data] of this.pendingNetworkUnitData) {
            console.log('[ServerNetworkSystem] buildPlayersForBattleStart player:', socketPlayerId, 'placements:', data.placements.map(p => ({
                placementId: p.placementId,
                squadUnits: p.squadUnits
            })));
            players.push({
                id: socketPlayerId,
                team: data.team,
                networkUnitData: data.placements
            });
        }
        return players;
    }

    handlePurchaseUpgrade(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'PURCHASED_UPGRADE';

        try {
            if (!this.playerExists(playerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const upgradeId = data?.data?.upgradeId || data?.upgradeId;
            const upgrade = this.collections.upgrades[upgradeId];
            if (!upgrade) {
                return this.respondError(playerId, responseName, `Unknown upgrade: ${upgradeId}`, callback);
            }

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, `Not in placement phase (${this.game.state.phase})`, callback);
            }

            const result = this.processPurchaseUpgrade(playerId, upgradeId, upgrade);
            return this.respond(playerId, responseName, result, callback);

        } catch (error) {
            console.error('Error purchasing upgrades:', error);
            return this.respondError(playerId, responseName, 'Server error while purchasing upgrades', callback);
        }
    }

    async handleLevelSquad(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'SQUAD_LEVELED';
        const { placementId, specializationId } = data;

        if (!playerId) return;

        const playerStats = this.game.call('getPlayerStats', playerId);
        if (!playerStats) {
            return this.respondError(playerId, responseName, 'Player not found', callback);
        }

        const playerGold = playerStats.gold || 0;

        if (!this.game.call('canAffordLevelUp', placementId, playerGold)) {
            return this.respondError(playerId, responseName, 'gold_low_error', callback);
        }

        const success1 = specializationId ? this.game.call('applySpecialization', placementId, specializationId, playerId) : true;

        await this.game.call('levelUpSquad', placementId, null, playerId, (success) => {
            if (success1 && success) {
                const levelUpCost = this.game.call('getLevelUpCost', placementId);
                playerStats.gold -= levelUpCost;

                const result = {
                    playerId: playerId,
                    currentGold: playerStats.gold,
                    success: true
                };
                this.respond(playerId, responseName, result, callback);
            }
        });
    }

    handleSetSquadTarget(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'SQUAD_TARGET_SET';

        try {
            const { placementId, targetPosition, meta } = data;

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, 'Not in placement phase', callback);
            }

            if (!this.playerExists(playerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) {
                return this.respondError(playerId, responseName, 'Placement not found', callback);
            }

            const serverIssuedTime = this.game.state.now;
            this.processSquadTarget(placementId, targetPosition, meta, serverIssuedTime);

            const result = {
                success: true,
                placementId,
                targetPosition,
                meta,
                issuedTime: serverIssuedTime
            };

            this.respond(playerId, responseName, result, callback);

            // Notify other players (multiplayer only)
            this.notifyOtherPlayers(playerId, 'OPPONENT_SQUAD_TARGET_SET', {
                placementId,
                targetPosition,
                meta,
                issuedTime: serverIssuedTime
            });

        } catch (error) {
            console.error('Error setting squad target:', error);
            return this.respondError(playerId, responseName, 'Server error while setting squad target', callback);
        }
    }

    handleSetSquadTargets(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'SQUAD_TARGETS_SET';

        try {
            const { placementIds, targetPositions, meta } = data;

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, 'Not in placement phase', callback);
            }

            if (!this.playerExists(playerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const serverIssuedTime = this.game.state.now;

            for (let i = 0; i < placementIds.length; i++) {
                const placement = this.game.call('getPlacementById', placementIds[i]);
                if (!placement) {
                    return this.respondError(playerId, responseName, 'Placement not found', callback);
                }
            }

            this.processSquadTargets(placementIds, targetPositions, meta, serverIssuedTime);

            const result = {
                success: true,
                placementIds,
                targetPositions,
                meta,
                issuedTime: serverIssuedTime
            };

            this.respond(playerId, responseName, result, callback);

            // Notify other players (multiplayer only)
            this.notifyOtherPlayers(playerId, 'OPPONENT_SQUAD_TARGETS_SET', {
                placementIds,
                targetPositions,
                meta,
                issuedTime: serverIssuedTime
            });

        } catch (error) {
            console.error('Error setting squad targets:', error);
            return this.respondError(playerId, responseName, 'Server error while setting squad targets', callback);
        }
    }

    handleReadyForBattle(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'READY_FOR_BATTLE_RESPONSE';

        // Derive effective playerId from team if provided (allows AI to ready for its own team)
        let effectivePlayerId = playerId;
        if (data?.team !== undefined) {
            // team.left = 2 -> playerId 0, team.right = 3 -> playerId 1
            effectivePlayerId = data.team === this.enums.team.left ? 0 : 1;
        }

        console.log('[DEBUG] handleReadyForBattle called', {
            playerId,
            effectivePlayerId,
            team: data?.team,
            isLocalGame: this.game.state.isLocalGame,
            phase: this.game.state.phase,
            playerExists: this.playerExists(effectivePlayerId)
        });

        if (!this.playerExists(effectivePlayerId)) {
            console.log('[DEBUG] Player not found, returning error');
            return this.respondError(playerId, responseName, 'Player not found', callback);
        }

        this.placementReadyStates.set(effectivePlayerId, true);

        this.respond(playerId, responseName, { success: true }, callback);

        // Check if ready to start battle
        // Both local and multiplayer: wait for all players to be ready
        const allReady = this.areAllPlayersReady();

        console.log('[DEBUG] allReady check', {
            allReady,
            phase: this.game.state.phase,
            phaseEnum: this.enums.gamePhase.placement,
            phaseMatch: this.game.state.phase === this.enums.gamePhase.placement
        });

        if (allReady && this.game.state.phase === this.enums.gamePhase.placement) {
            console.log('[DEBUG] Starting battle!');
            this.game.resetCurrentTime();
            if (this.game.desyncDebugger) {
                this.game.desyncDebugger.enabled = true;
                this.game.desyncDebugger.displaySync(true);
            }

            // CRITICAL: Serialize entities BEFORE resetAI/onBattleStart
            // This ensures the entitySync captures the authoritative pre-battle state
            // (including playerOrder.isHiding) that clients need to match
            const entitySync = this.game.call('serializeAllEntities');
            // Build gameState with players array containing networkUnitData
            const gameState = {
                ...this.game.state,
                players: this.buildPlayersForBattleStart()
            };

            this.broadcastToRoom(null, 'READY_FOR_BATTLE_UPDATE', {
                gameState: gameState,
                allReady: true,
                entitySync: entitySync,
                serverTime: this.game.state.now,
                nextEntityId: this.game.nextEntityId
            });

            // Now trigger battle start AFTER broadcasting the sync
            this.game.call('resetAI');
            this.game.triggerEvent("onBattleStart");

            // Clear queued data after sending
            this.pendingNetworkUnitData.clear();
            this.placementReadyStates.clear();
            this.game.call('startBattle');

        } else if (this.engine?.isServer) {
            // Multiplayer only - notify that not all players are ready yet
            this.broadcastToRoom(null, 'READY_FOR_BATTLE_UPDATE', {
                gameState: this.game.state,
                allReady: false
            });
        }
    }

    handleCancelBuilding(eventData, callback) {
        const { playerId, numericPlayerId, data } = eventData;
        const responseName = 'BUILDING_CANCELLED';

        try {
            const { buildingEntityId } = data;

            const playerStats = this.game.call('getPlayerStats', playerId);
            if (!playerStats) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const procResult = this.processCancelBuilding(buildingEntityId, numericPlayerId);

            if (!procResult.success) {
                return this.respond(playerId, responseName, procResult, callback);
            }

            const result = {
                success: true,
                placementId: procResult.placementId,
                refundAmount: procResult.refundAmount,
                gold: playerStats.gold ?? 0
            };

            this.respond(playerId, responseName, result, callback);

            // Notify other players (multiplayer only)
            this.notifyOtherPlayers(playerId, 'OPPONENT_BUILDING_CANCELLED', {
                placementId: procResult.placementId,
                team: playerStats.team
            });

        } catch (error) {
            console.error('Error cancelling building:', error);
            return this.respondError(playerId, responseName, 'Server error while cancelling building', callback);
        }
    }

    handleUpgradeBuilding(eventData, callback) {
        const { playerId, numericPlayerId, data } = eventData;
        const responseName = 'BUILDING_UPGRADED';

        try {
            const { buildingEntityId, placementId, targetBuildingId } = data;

            const playerStats = this.game.call('getPlayerStats', playerId);
            if (!playerStats) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, 'Not in placement phase', callback);
            }

            const targetBuilding = this.collections.buildings[targetBuildingId];
            if (!targetBuilding) {
                return this.respondError(playerId, responseName, 'Invalid target building', callback);
            }

            const upgradeCost = targetBuilding.value || 0;
            if (playerStats.gold < upgradeCost) {
                return this.respondError(playerId, responseName, 'Not enough gold', callback);
            }

            const oldTransform = this.game.getComponent(buildingEntityId, 'transform');
            if (!oldTransform?.position) {
                return this.respondError(playerId, responseName, 'Building not found', callback);
            }

            const procResult = this.processUpgradeBuilding(playerId, numericPlayerId, playerStats, buildingEntityId, placementId, targetBuildingId, null);

            if (!procResult.success) {
                return this.respondError(playerId, responseName, procResult.error, callback);
            }

            const result = {
                success: true,
                newEntityId: procResult.newEntityId,
                newPlacementId: procResult.newPlacementId,
                gridPosition: procResult.gridPosition,
                gold: playerStats.gold
            };

            this.respond(playerId, responseName, result, callback);

            // Notify other players (multiplayer only)
            this.notifyOtherPlayers(playerId, 'OPPONENT_BUILDING_UPGRADED', {
                buildingEntityId: buildingEntityId,
                placementId: placementId,
                targetBuildingId: targetBuildingId,
                newEntityId: procResult.newEntityId,
                newPlacementId: procResult.newPlacementId,
                gridPosition: procResult.gridPosition
            });

        } catch (error) {
            console.error('Error upgrading building:', error);
            return this.respondError(playerId, responseName, 'Server error while upgrading building', callback);
        }
    }

    // ==================== CHEAT HANDLERS ====================

    handleExecuteCheat(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'CHEAT_EXECUTED';
        const { cheatName, params } = data;

        if (!this.playerExists(playerId)) {
            return this.respondError(playerId, responseName, 'Player not found', callback);
        }

        const cheatResult = this.processCheat(cheatName, params);

        if (!cheatResult.success) {
            return this.respondError(playerId, responseName, cheatResult.error, callback);
        }

        const result = {
            success: true,
            cheatName,
            params,
            result: cheatResult.result
        };

        this.respond(playerId, responseName, result, callback);

        this.broadcastToRoom(null, 'CHEAT_BROADCAST', {
            cheatName,
            params,
            result: cheatResult.result,
            initiatedBy: playerId
        });
    }

    // ==================== HELPER METHODS ====================

    areAllPlayersReady() {
        const states = [...this.placementReadyStates.values()];
        return states.length === this.numPlayers && states.every(ready => ready === true);
    }

    getStartingStateResponse() {
        const playerEntities = this.game.call('getSerializedPlayerEntities') || [];
        return {
            success: true,
            playerEntities
        };
    }

    // ==================== LIFECYCLE ====================

    onBattleEnd() {
        if (this.game.desyncDebugger) {
            this.game.desyncDebugger.displaySync(true);
            this.game.desyncDebugger.enabled = false;
        }
    }

    clearAllPlacements() {
        this.placementReadyStates = new Map();
        this.pendingNetworkUnitData.clear();
    }

    cleanup() {
        console.log('ServerNetworkSystem cleaned up');
    }
}
