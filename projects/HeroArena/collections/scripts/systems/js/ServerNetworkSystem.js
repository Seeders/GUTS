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
        'broadcastGameEnd',
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
        'handleSpecializeSquad',
        'handleExecuteCheat',
        'handleTransformUnit',
        'handleLeaderSelected',
        'handleHeroSelected',
        'handleHeroMoved',
        'handlePlayerLoaded',
        'handleClaimLoot',
        'handleSkipLoot',
        'handleBuyOffer',
        'handleRerollOffers',
        'handleBuyUnlockedUnit',
        'handleBuyUnitTech',
        'handleBuySquadLevel',
        'handleSellUnit',
        'handleGrantSingleAbility',
        'handleSpecializeChoice',
        'handlePlaceBuilding',
        'handleMoveBuilding',
        'handleCancelPlaceBuilding',
        'syncEntitiesToClients'
    ];

    static serviceDependencies = [
        ...GUTS.BaseNetworkSystem.serviceDependencies,
        'getPlayerStats',
        'getPlayerEntities',
        'canAffordLevelUp',
        'getLevelUpCost',
        'applySpecialization',
        'serializeAllEntities',
        'resetAI',
        'startBattle',
        'getSerializedPlayerEntities',
        // HeroArena services
        'confirmLeaderSelection',
        'confirmHeroSelection',
        'startLeaderSelect',
        'claimLootItem',
        'skipLoot',
        'getHeroEntityId',
        'moveHero',
        'buyOffer',
        'rerollOffers',
        'buyUnlockedUnit',
        'sellUnit',
        'grantSingleTargetAbility',
        'applySpecializationChoice',
        'placeBuilding',
        'moveBuilding',
        'cancelPendingBuilding'
    ];

    constructor(game) {
        super(game);
        this.game.serverNetworkSystem = this;
        this.placementReadyStates = new Map();
        // Queue networkUnitData per player for battle start sync
        // Map<playerId, Array<networkUnitData>>
        this.pendingNetworkUnitData = new Map();
        // Online game-start handshake: which players have finished loading.
        this._loadedPlayers = new Set();
        this._roundLoopStarted = false;
    }

    init(params) {
        this.params = params || {};

        // Subscribe to server-authoritative event handlers only on the real server.
        // NOTE: use this.game.isServer (set on the ECSGame) — NOT this.engine.isServer
        // (this.engine === game.app, which does NOT carry isServer), otherwise the
        // guard silently fails and NO game events are ever handled online.
        if (this.game.isServer && this.game.serverEventManager) {
            this.subscribeToEvents();
        }
    }

    // ==================== NETWORK HELPERS ====================

    /**
     * Check if player exists (has player entity)
     */
    playerExists(playerId) {
        return this.call.getPlayerStats( playerId) !== null;
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
     * Push the authoritative ECS state to all clients (multiplayer only). Used to
     * replicate server-authoritative prep-phase spawns/transforms so clients can
     * render and position units before battle. No-op in local (single instance).
     */
    syncEntitiesToClients(socketPlayerId = null, numericPlayerId = null) {
        if (this.game.state?.isLocalGame || !this.game.isServer) return;
        if (!this.game.serverEventManager) return;

        // CREATE/transform the army on clients via the proper unit-creation path
        // (applyNetworkUnitData → spawnSquad → UnitCreationSystem) using the server's
        // entity IDs. We deliberately do NOT also push a full entitySync here:
        // applyECSData is correction-only and would clear the object components that
        // UnitCreationSystem just built (re-creating "shell" entities). Final value
        // alignment happens via the existing battle-start sync.
        const allPlayers = this._buildArmyRecords();

        // INCREMENTAL (per-player) sync: a player's prep-phase buys / specializations
        // are sent ONLY to that player. This keeps them hidden from the opponent —
        // during prep each client sees its own units live, plus the enemy formation
        // captured at the previous round/battle start (frozen). The `incremental`
        // flag tells the client to prune only the acting player's own team, leaving
        // the frozen enemy snapshot intact.
        if (socketPlayerId != null && numericPlayerId != null) {
            const mine = allPlayers.filter(p => p.playerId === numericPlayerId);
            if (mine.length) {
                this.sendToPlayer(socketPlayerId, 'ARMY_SYNC', { players: mine, incremental: true });
            }
            return;
        }

        // FULL sync (round start + battle start): broadcast both armies so every
        // client creates any units it's missing. At round start this reveals the
        // enemy's previous-round formation; at battle start it ensures opponent
        // prep-buys exist before the entitySync aligns everyone's positions.
        this.broadcastToRoom(null, 'ARMY_SYNC', { players: allPlayers });
    }

    // Build per-player networkUnitData records from the live hero entities so clients
    // can recreate them with matching entity IDs (and transform on specialization).
    _buildArmyRecords() {
        const byPlacement = new Map();   // placementId -> record
        const heroes = this.game.getEntitiesWith('heroRosterInfo', 'placement') || [];
        for (const eid of heroes) {
            const placement = this.game.getComponent(eid, 'placement');
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!placement || !info) continue;
            const pid = placement.placementId;
            if (!byPlacement.has(pid)) {
                byPlacement.set(pid, {
                    placementId: pid,
                    gridPosition: placement.gridPosition,
                    unitTypeId: placement.unitTypeId,
                    collection: placement.collection,
                    team: placement.team,
                    playerId: info.playerId,
                    squadUnits: [],
                    roundPlaced: this.game.state.round || 1,
                    // Carry roster tagging so clients can make these units draggable
                    // (heroRosterInfo is added server-side by HeroRosterSystem and is
                    // required by PlacementUISystem's drag handler).
                    heroRosterInfo: {
                        playerId: info.playerId,
                        rosterIndex: info.rosterIndex,
                        level: info.level
                    },
                    // Live world positions per entity. moveHero only updates the
                    // transform (not placement.gridPosition), so clients must position
                    // synced units from these — otherwise units would render at their
                    // default spawn spot instead of where they were last moved to.
                    unitPositions: {}
                });
            }
            const rec = byPlacement.get(pid);
            rec.squadUnits.push(eid);
            const tpos = this.game.getComponent(eid, 'transform')?.position;
            if (tpos) rec.unitPositions[eid] = { x: tpos.x, z: tpos.z };
        }
        // Buildings: persistent, non-hero entities. Emit them in the same per-player records
        // (collection 'buildings') so clients create/position them via applyNetworkUnitData,
        // but tagged isBuilding (NOT heroRosterInfo) so the client tags buildingOwner instead
        // and the hero stale-prune leaves them alone.
        const buildings = this.game.getEntitiesWith('buildingOwner', 'placement') || [];
        for (const eid of buildings) {
            const placement = this.game.getComponent(eid, 'placement');
            const owner = this.game.getComponent(eid, 'buildingOwner');
            if (!placement || !owner) continue;
            const pid = placement.placementId;
            if (!byPlacement.has(pid)) {
                byPlacement.set(pid, {
                    placementId: pid,
                    gridPosition: placement.gridPosition,
                    unitTypeId: placement.unitTypeId,
                    collection: placement.collection,
                    team: placement.team,
                    playerId: owner.playerId,
                    squadUnits: [],
                    roundPlaced: owner.roundPlaced,
                    isBuilding: true,
                    buildingOwner: {
                        playerId: owner.playerId,
                        buildingId: owner.buildingId,
                        placementId: owner.placementId,
                        roundPlaced: owner.roundPlaced
                    },
                    unitPositions: {}
                });
            }
            const rec = byPlacement.get(pid);
            rec.squadUnits.push(eid);
            const tpos = this.game.getComponent(eid, 'transform')?.position;
            if (tpos) rec.unitPositions[eid] = { x: tpos.x, z: tpos.z };
        }

        const players = new Map();   // numericPlayerId -> { playerId, team, networkUnitData: [] }
        for (const rec of byPlacement.values()) {
            if (!players.has(rec.playerId)) {
                players.set(rec.playerId, { playerId: rec.playerId, team: rec.team, networkUnitData: [] });
            }
            players.get(rec.playerId).networkUnitData.push(rec);
        }

        // Neutral/hostile map creeps: the gold mines (neutral) and their dragon
        // guardians (hostile). These have no player owner, so the hero/building
        // passes above miss them — and since they only spawn server-side, they'd
        // never render on online clients. Emit them as their own team-keyed
        // groups so the client creates them via applyNetworkUnitData, exactly
        // like player units. No heroRosterInfo/buildingOwner tag → the client
        // leaves them untagged (a plain hostile dragon / neutral mine) and the
        // stale-prune skips them.
        const creepGroups = this._buildCreepRecords();
        return [...players.values(), ...creepGroups];
    }

    // Per-team networkUnitData records for the neutral mines and hostile dragons.
    _buildCreepRecords() {
        const neutral = this.enums.team.neutral;
        const hostile = this.enums.team.hostile;
        const byTeam = new Map();   // team -> { playerId, team, networkUnitData: [] }

        const creeps = this.game.getEntitiesWith('placement', 'team') || [];
        for (const eid of creeps) {
            const teamComp = this.game.getComponent(eid, 'team');
            const t = teamComp?.team;
            if (t !== neutral && t !== hostile) continue;
            // Player-owned entities are handled by the hero/building passes.
            if (this.game.getComponent(eid, 'heroRosterInfo')) continue;
            if (this.game.getComponent(eid, 'buildingOwner')) continue;
            const placement = this.game.getComponent(eid, 'placement');
            if (!placement) continue;

            if (!byTeam.has(t)) {
                // playerId null: these belong to no player. applyNetworkUnitData
                // only stamps playerId when truthy, so the units stay ownerless.
                byTeam.set(t, { playerId: null, team: t, networkUnitData: [] });
            }
            const group = byTeam.get(t);
            let rec = group.networkUnitData.find(r => r.placementId === placement.placementId);
            if (!rec) {
                rec = {
                    placementId: placement.placementId,
                    gridPosition: placement.gridPosition,
                    unitTypeId: placement.unitTypeId,
                    collection: placement.collection,
                    team: t,
                    playerId: null,
                    squadUnits: [],
                    roundPlaced: this.game.state.round || 1,
                    unitPositions: {}
                };
                group.networkUnitData.push(rec);
            }
            rec.squadUnits.push(eid);
            const tpos = this.game.getComponent(eid, 'transform')?.position;
            if (tpos) rec.unitPositions[eid] = { x: tpos.x, z: tpos.z };
        }
        return [...byTeam.values()];
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
        const playerEntities = this.call.getPlayerEntities();
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
        this.game.serverEventManager.subscribe('PLAYER_LOADED', this.handlePlayerLoaded.bind(this));
        this.game.serverEventManager.subscribe('SUBMIT_PLACEMENT', this.handleSubmitPlacement.bind(this));
        this.game.serverEventManager.subscribe('PURCHASE_UPGRADE', this.handlePurchaseUpgrade.bind(this));
        this.game.serverEventManager.subscribe('READY_FOR_BATTLE', this.handleReadyForBattle.bind(this));
        this.game.serverEventManager.subscribe('LEVEL_SQUAD', this.handleLevelSquad.bind(this));
        this.game.serverEventManager.subscribe('SPECIALIZE_SQUAD', this.handleSpecializeSquad.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGET', this.handleSetSquadTarget.bind(this));
        this.game.serverEventManager.subscribe('SET_SQUAD_TARGETS', this.handleSetSquadTargets.bind(this));
        this.game.serverEventManager.subscribe('CANCEL_BUILDING', this.handleCancelBuilding.bind(this));
        this.game.serverEventManager.subscribe('UPGRADE_BUILDING', this.handleUpgradeBuilding.bind(this));

        // HeroArena: leader selection
        this.game.serverEventManager.subscribe('LEADER_SELECTED', this.handleLeaderSelected.bind(this));

        // HeroArena: hero selection
        this.game.serverEventManager.subscribe('HERO_SELECTED', this.handleHeroSelected.bind(this));

        // HeroArena: hero reposition during prep
        this.game.serverEventManager.subscribe('HERO_MOVED', this.handleHeroMoved.bind(this));

        // HeroArena: loot claiming (deprecated — kept so legacy clients don't crash)
        this.game.serverEventManager.subscribe('CLAIM_LOOT', this.handleClaimLoot.bind(this));
        this.game.serverEventManager.subscribe('SKIP_LOOT',  this.handleSkipLoot.bind(this));

        // HeroArena: army shop
        this.game.serverEventManager.subscribe('BUY_OFFER',            this.handleBuyOffer.bind(this));
        this.game.serverEventManager.subscribe('REROLL_OFFERS',        this.handleRerollOffers.bind(this));
        this.game.serverEventManager.subscribe('BUY_UNLOCKED_UNIT',    this.handleBuyUnlockedUnit.bind(this));
        this.game.serverEventManager.subscribe('BUY_UNIT_TECH',        this.handleBuyUnitTech.bind(this));
        this.game.serverEventManager.subscribe('BUY_SQUAD_LEVEL',      this.handleBuySquadLevel.bind(this));
        this.game.serverEventManager.subscribe('SELL_UNIT',            this.handleSellUnit.bind(this));
        this.game.serverEventManager.subscribe('GRANT_SINGLE_ABILITY', this.handleGrantSingleAbility.bind(this));
        this.game.serverEventManager.subscribe('SPECIALIZE_CHOICE',    this.handleSpecializeChoice.bind(this));

        // HeroArena: buildings (instant placement + one-round move window)
        this.game.serverEventManager.subscribe('PLACE_BUILDING',        this.handlePlaceBuilding.bind(this));
        this.game.serverEventManager.subscribe('MOVE_BUILDING',         this.handleMoveBuilding.bind(this));
        this.game.serverEventManager.subscribe('CANCEL_PLACE_BUILDING', this.handleCancelPlaceBuilding.bind(this));

        // Cheat events
        this.game.serverEventManager.subscribe('EXECUTE_CHEAT', this.handleExecuteCheat.bind(this));

        // Transform events
        this.game.serverEventManager.subscribe('TRANSFORM_UNIT', this.handleTransformUnit.bind(this));
    }

    // ==================== PLACEMENT HANDLERS ====================

    handleGetStartingState(eventData, callback) {
        const { playerId } = eventData;
        const responseName = 'GOT_STARTING_STATE';

        try {
            console.log('[ServerNetworkSystem] handleGetStartingState called, playerId:', playerId);

            // Check if player entities have been created yet
            // In multiplayer, they're created in SkirmishGameSystem.postSceneLoad() via initializeOnlineMatch()
            const playerEntities = this.call.getPlayerEntities() || [];
            console.log('[ServerNetworkSystem] Player entities found:', playerEntities.length);

            if (playerEntities.length === 0) {
                console.warn('[ServerNetworkSystem] GET_STARTING_STATE called but no player entities exist yet!');
                console.warn('[ServerNetworkSystem] onlinePlayers in game.state:', this.game.state.onlinePlayers);
                console.warn('[ServerNetworkSystem] isOnlineMatch:', this.game.state.isOnlineMatch);
                console.warn('[ServerNetworkSystem] This suggests postSceneLoad has not run yet or player creation failed');
            }

            const result = this.getStartingStateResponse();
            console.log('[ServerNetworkSystem] Responding with playerEntities:', result.playerEntities?.length || 0);
            return this.respond(playerId, responseName, result, callback);

        } catch (error) {
            console.error('[ServerNetworkSystem] Error getting starting state:', error);
            return this.respondError(playerId, responseName, 'Server error while getting starting state', callback);
        }
    }

    // Online game-start handshake. Each client sends PLAYER_LOADED once its scene
    // is loaded and listeners are registered. When every player has reported in,
    // start the round loop (leader select) so no broadcast is missed.
    handlePlayerLoaded(eventData, callback) {
        const playerId = eventData?.playerId ?? eventData?.data?.playerId;
        if (playerId != null) this._loadedPlayers.add(playerId);

        const expected = this.game.state?.onlinePlayers?.length
            || (this.call.getPlayerEntities()?.length || 0)
            || 2;

        if (!this._roundLoopStarted && this._loadedPlayers.size >= expected) {
            this._roundLoopStarted = true;
            if (this.game.hasService?.('startLeaderSelect')) this.call.startLeaderSelect();
        }
        return this.respond(playerId, 'PLAYER_LOADED_ACK', { success: true }, callback);
    }

    handleSubmitPlacement(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'SUBMITTED_PLACEMENT';

        try {
            const { placement } = data;

            // Use playerId from placement data - this allows AI to place for its own team
            // In multiplayer, the server validates this matches the authenticated user
            const effectivePlayerId = placement.playerId !== undefined ? placement.playerId : playerId;

            const playerStats = this.call.getPlayerStats( effectivePlayerId);
            if (!playerStats) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const result = this.processPlacement(effectivePlayerId, effectivePlayerId, playerStats, placement, null);


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
        console.log(`[queueNetworkUnitData] playerId=${playerId}, numericPlayerId=${numericPlayerId}, team=${team}, placementId=${result.placementId}, squadUnits=${JSON.stringify(result.squadUnits)}, unitTypeId=${placement.unitTypeId}`);
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
        console.log(`[buildPlayersForBattleStart] pendingNetworkUnitData has ${this.pendingNetworkUnitData.size} entries`);
        const players = [];
        for (const [socketPlayerId, data] of this.pendingNetworkUnitData) {
            console.log(`[buildPlayersForBattleStart] Player ${socketPlayerId}: team=${data.team}, placements=${data.placements.length}`);
            data.placements.forEach((p, i) => {
                console.log(`[buildPlayersForBattleStart]   Placement ${i}: placementId=${p.placementId}, unitTypeId=${p.unitTypeId}, squadUnits=${JSON.stringify(p.squadUnits)}`);
            });
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
            const upgradeId = data?.data?.upgradeId || data?.upgradeId;
            const upgrade = this.collections.upgrades[upgradeId];
            if (!upgrade) {
                return this.respondError(playerId, responseName, `Unknown upgrade: ${upgradeId}`, callback);
            }

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, `Not in placement phase (${this.game.state.phase})`, callback);
            }

            // If a reference building is provided (from AI), derive the team from it
            const referenceBuildingId = data?.data?.referenceBuildingId || data?.referenceBuildingId;
            let effectivePlayerId = playerId;

            if (referenceBuildingId !== undefined) {
                const buildingTeamComp = this.game.getComponent(referenceBuildingId, 'team');
                if (buildingTeamComp) {
                    effectivePlayerId = buildingTeamComp.team === this.enums.team.left ? 0 : 1;
                }
            }

            if (!this.playerExists(effectivePlayerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            const result = this.processPurchaseUpgrade(effectivePlayerId, upgradeId, upgrade);
            return this.respond(playerId, responseName, result, callback);

        } catch (error) {
            console.error('Error purchasing upgrades:', error);
            return this.respondError(playerId, responseName, 'Server error while purchasing upgrades', callback);
        }
    }

    async handleLevelSquad(eventData, callback) {
        console.log('[handleLevelSquad] called with eventData:', eventData);
        const { playerId, data } = eventData;
        const responseName = 'SQUAD_LEVELED';
        const { placementId, specializationId } = data;

        if (playerId === undefined || playerId === null) {
            console.log('[handleLevelSquad] no playerId, returning');
            return;
        }

        // Must be in placement phase to level up
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            console.log('[handleLevelSquad] not in placement phase, phase:', this.game.state.phase);
            return this.respondError(playerId, responseName, 'Not in placement phase', callback);
        }

        // Get the placement to find the squad's team
        const placement = this.call.getPlacementById( placementId);
        if (!placement || !placement.squadUnits || placement.squadUnits.length === 0) {
            return this.respondError(playerId, responseName, 'Placement not found', callback);
        }

        // Get the team from the first unit in the squad
        const squadEntityId = placement.squadUnits[0];
        const teamComp = this.game.getComponent(squadEntityId, 'team');
        if (!teamComp) {
            return this.respondError(playerId, responseName, 'Squad has no team', callback);
        }

        // Determine the correct playerId based on the squad's team
        const effectivePlayerId = teamComp.team === this.enums.team.left ? 0 : 1;

        const playerStats = this.call.getPlayerStats( effectivePlayerId);
        console.log('[handleLevelSquad] playerStats:', playerStats, 'effectivePlayerId:', effectivePlayerId);
        if (!playerStats) {
            return this.respondError(playerId, responseName, 'Player not found', callback);
        }

        const playerGold = playerStats.gold || 0;
        console.log('[handleLevelSquad] playerGold:', playerGold);

        if (!this.call.canAffordLevelUp( placementId, playerGold)) {
            console.log('[handleLevelSquad] cannot afford level up');
            return this.respondError(playerId, responseName, 'gold_low_error', callback);
        }

        // Get squad data and verify it can level up
        const squadData = this.game.squadExperienceSystem?.getSquadExperience(placementId);
        console.log('[handleLevelSquad] squadData:', squadData);
        if (!squadData || !squadData.canLevelUp) {
            console.log('[handleLevelSquad] squad cannot level up, canLevelUp:', squadData?.canLevelUp);
            return this.respondError(playerId, responseName, 'Squad cannot level up', callback);
        }

        // Get level up cost BEFORE leveling (since cost is based on current squad value)
        const levelUpCost = this.call.getLevelUpCost( placementId);
        console.log('[handleLevelSquad] levelUpCost:', levelUpCost);

        // Apply specialization if provided (entity IDs are preserved by replaceUnit)
        if (specializationId) {
            this.call.applySpecialization( placementId, specializationId);
        }

        // Perform the level up directly
        console.log('[handleLevelSquad] calling finishLevelingSquad');
        const success = this.game.squadExperienceSystem?.finishLevelingSquad(squadData, placementId, specializationId);
        console.log('[handleLevelSquad] finishLevelingSquad result:', success);

        if (success) {
            playerStats.gold -= levelUpCost;

            // Update queued networkUnitData with new unit type if specialization was applied
            // This ensures opponent sees the specialized unit when battle starts
            if (specializationId) {
                console.log(`[handleLevelSquad] Calling updateQueuedNetworkUnitData with effectivePlayerId=${effectivePlayerId}, placementId=${placementId}, specializationId=${specializationId}`);
                this.updateQueuedNetworkUnitData(effectivePlayerId, placementId, specializationId);
            }

            const result = {
                playerId: playerId,
                currentGold: playerStats.gold,
                success: true,
                specializationId: specializationId || null
            };
            this.respond(playerId, responseName, result, callback);
        } else {
            return this.respondError(playerId, responseName, 'Level up failed', callback);
        }
    }

    /**
     * Handle specialization request (separate from level up)
     * Called when player selects a specialization for an already-leveled squad
     */
    handleSpecializeSquad(eventData, callback) {
        console.log('[handleSpecializeSquad] called with eventData:', eventData);
        const { playerId, data } = eventData;
        const responseName = 'SQUAD_SPECIALIZED';
        const { placementId, specializationId } = data;

        if (!placementId || !specializationId) {
            return this.respondError(playerId, responseName, 'Missing placementId or specializationId', callback);
        }

        // Must be in placement phase
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            return this.respondError(playerId, responseName, 'Not in placement phase', callback);
        }

        // Get the placement
        const placement = this.call.getPlacementById( placementId);
        if (!placement || !placement.squadUnits || placement.squadUnits.length === 0) {
            return this.respondError(playerId, responseName, 'Placement not found', callback);
        }

        // Get the team from the first unit
        const squadEntityId = placement.squadUnits[0];
        const teamComp = this.game.getComponent(squadEntityId, 'team');
        if (!teamComp) {
            return this.respondError(playerId, responseName, 'Squad has no team', callback);
        }

        const effectivePlayerId = teamComp.team === this.enums.team.left ? 0 : 1;

        // Apply the specialization
        console.log(`[handleSpecializeSquad] Applying specialization ${specializationId} to placement ${placementId}`);
        const success = this.call.applySpecialization( placementId, specializationId);

        if (success) {
            // Update queued networkUnitData so opponent sees the specialized unit at battle start
            console.log(`[handleSpecializeSquad] Calling updateQueuedNetworkUnitData`);
            this.updateQueuedNetworkUnitData(effectivePlayerId, placementId, specializationId);

            const result = {
                success: true,
                placementId,
                specializationId
            };
            this.respond(playerId, responseName, result, callback);
        } else {
            return this.respondError(playerId, responseName, 'Specialization failed', callback);
        }
    }

    /**
     * Update queued networkUnitData when a squad gets specialized
     * This ensures the opponent receives the correct unit type at battle start
     */
    updateQueuedNetworkUnitData(playerId, placementId, specializationId) {
        console.log(`[updateQueuedNetworkUnitData] playerId=${playerId}, placementId=${placementId}, specializationId=${specializationId}`);

        // If no pending data for this player, create it
        // This handles surviving units from previous rounds that weren't placed this round
        if (!this.pendingNetworkUnitData.has(playerId)) {
            const playerStats = this.call.getPlayerStats( playerId);
            console.log(`[updateQueuedNetworkUnitData] No pending data for player ${playerId}, creating entry`);
            this.pendingNetworkUnitData.set(playerId, {
                team: playerStats?.team,
                numericPlayerId: playerId,
                placements: []
            });
        }

        const playerData = this.pendingNetworkUnitData.get(playerId);
        console.log(`[updateQueuedNetworkUnitData] Found playerData with ${playerData.placements.length} placements`);

        // Find the placement in queued data and update its unit type
        let placement = playerData.placements.find(p => p.placementId === placementId);

        // If placement doesn't exist in queued data (surviving unit from previous round), add it
        if (!placement) {
            console.log(`[updateQueuedNetworkUnitData] Placement ${placementId} not found, adding entry for surviving unit`);
            const existingPlacement = this.call.getPlacementById( placementId);
            if (existingPlacement) {
                // Get squadUnits from the existing placement
                const squadUnits = existingPlacement.squadUnits || [];
                placement = {
                    placementId: placementId,
                    gridPosition: existingPlacement.gridPosition,
                    unitTypeId: existingPlacement.unitTypeId,
                    collection: existingPlacement.collection || this.enums?.objectTypeDefinitions?.units,
                    team: playerData.team,
                    squadUnits: squadUnits
                };
                playerData.placements.push(placement);
                console.log(`[updateQueuedNetworkUnitData] Added surviving unit placement with squadUnits:`, squadUnits);
            } else {
                console.log(`[updateQueuedNetworkUnitData] Could not find existing placement ${placementId}`);
                return;
            }
        }

        // Get new unit type indices for the specialization
        const newUnitTypeIndex = this.enums?.units?.[specializationId];
        console.log(`[updateQueuedNetworkUnitData] Updating placement. Old unitTypeId=${placement.unitTypeId}, new unitTypeIndex=${newUnitTypeIndex}`);

        if (newUnitTypeIndex !== undefined) {
            placement.unitTypeId = newUnitTypeIndex;
            // Update the unitType object if present
            if (placement.unitType) {
                placement.unitType = {
                    ...this.collections.units[specializationId],
                    id: specializationId,
                    collection: 'units'
                };
            }
            console.log(`[updateQueuedNetworkUnitData] Updated placement unitTypeId to ${newUnitTypeIndex}`);
        } else {
            console.log(`[updateQueuedNetworkUnitData] Could not find enum index for ${specializationId}`);
        }
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

            const placement = this.call.getPlacementById( placementId);
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
                const placement = this.call.getPlacementById( placementIds[i]);
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
            const teamPlayerId = data.team === this.enums.team.left ? 0 : 1;
            // Only local mode may ready a team other than the sender's own (that's how
            // the AI readies its side). An online client must not be able to
            // force-ready its opponent and start the battle early.
            if (!this.game.state.isLocalGame) {
                const senderStats = this.call.getPlayerStats(playerId);
                if (!senderStats || senderStats.team !== data.team) {
                    return this.respondError(playerId, responseName, 'Cannot ready another team', callback);
                }
            }
            effectivePlayerId = teamPlayerId;
        }

        if (!this.playerExists(effectivePlayerId)) {
            return this.respondError(playerId, responseName, 'Player not found', callback);
        }

        this.placementReadyStates.set(effectivePlayerId, true);

        this.respond(playerId, responseName, { success: true }, callback);

        // Check if ready to start battle
        // Both local and multiplayer: wait for all players to be ready
        const allReady = this.areAllPlayersReady();

        if (allReady && this.game.state.phase === this.enums.gamePhase.placement) {
            this.game.resetCurrentTime();
            if (this.game.desyncDebugger) {
                this.game.desyncDebugger.enabled = true;
                this.game.desyncDebugger.displaySync(true);
            }

            // Reveal both armies: a FULL ARMY_SYNC creates any units a client is
            // missing (e.g. the opponent's prep-phase buys, which were sent only to
            // the buyer during prep). The entitySync below then aligns everyone's
            // real positions — this is the moment the frozen enemy snapshot updates
            // to the opponent's actual placement.
            this.syncEntitiesToClients();

            // CRITICAL: Serialize entities BEFORE resetAI/onBattleStart
            // This ensures the entitySync captures the authoritative pre-battle state
            // (including playerOrder.isHiding) that clients need to match
            const entitySync = this.call.serializeAllEntities();
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

            // Now trigger battle start AFTER broadcasting the sync.
            // startBattle() itself fires onBattleStart — don't trigger it twice here.
            this.call.resetAI();

            // Clear queued data after sending
            this.pendingNetworkUnitData.clear();
            this.placementReadyStates.clear();
            this.call.startBattle();

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

            const playerStats = this.call.getPlayerStats( playerId);
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

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, 'Not in placement phase', callback);
            }

            const targetBuilding = this.collections.buildings[targetBuildingId];
            if (!targetBuilding) {
                return this.respondError(playerId, responseName, 'Invalid target building', callback);
            }

            const oldTransform = this.game.getComponent(buildingEntityId, 'transform');
            if (!oldTransform?.position) {
                return this.respondError(playerId, responseName, 'Building not found', callback);
            }

            // Get the team from the building being upgraded (not from playerId)
            // This ensures the upgraded building keeps the correct team in local games with 2 AIs
            const buildingTeamComp = this.game.getComponent(buildingEntityId, 'team');
            if (!buildingTeamComp) {
                return this.respondError(playerId, responseName, 'Building has no team', callback);
            }
            const buildingTeam = buildingTeamComp.team;

            // Find the player entity for the building's team to get correct player stats
            const effectivePlayerId = buildingTeam === this.enums.team.left ? 0 : 1;
            const playerStats = this.call.getPlayerStats( effectivePlayerId);
            if (!playerStats) {
                return this.respondError(playerId, responseName, 'Player not found for building team', callback);
            }

            const upgradeCost = targetBuilding.value || 0;
            if (playerStats.gold < upgradeCost) {
                return this.respondError(playerId, responseName, 'Not enough gold', callback);
            }

            const procResult = this.processUpgradeBuilding(effectivePlayerId, effectivePlayerId, playerStats, buildingEntityId, placementId, targetBuildingId, null);

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

    // ==================== TRANSFORM HANDLERS ====================

    handleTransformUnit(eventData, callback) {
        const { playerId, data } = eventData;
        const responseName = 'UNIT_TRANSFORMED';

        try {
            const { entityId, targetUnitType, animationType } = data;

            if (this.game.state.phase !== this.enums.gamePhase.placement) {
                return this.respondError(playerId, responseName, 'Not in placement phase', callback);
            }

            if (!this.playerExists(playerId)) {
                return this.respondError(playerId, responseName, 'Player not found', callback);
            }

            // Verify entity exists
            if (!this.game.entityExists(entityId)) {
                return this.respondError(playerId, responseName, 'Entity not found', callback);
            }

            const serverIssuedTime = this.game.state.now;

            // Process transform and get new entity ID
            const newEntityId = this.processTransformUnit(entityId, targetUnitType, animationType, null, serverIssuedTime);

            if (newEntityId === null) {
                return this.respondError(playerId, responseName, 'Transform failed', callback);
            }

            const result = {
                success: true,
                entityId,
                targetUnitType,
                animationType,
                newEntityId,
                issuedTime: serverIssuedTime
            };

            this.respond(playerId, responseName, result, callback);

            // Broadcast to other players
            this.notifyOtherPlayers(playerId, 'OPPONENT_UNIT_TRANSFORMED', {
                entityId,
                targetUnitType,
                animationType,
                newEntityId,
                issuedTime: serverIssuedTime
            });

        } catch (error) {
            console.error('Error transforming unit:', error);
            return this.respondError(playerId, responseName, 'Server error while transforming unit', callback);
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
        // Get actual player count from ECS player entities
        const playerEntities = this.call.getPlayerEntities() || [];
        const numPlayers = playerEntities.length;

        console.log('[areAllPlayersReady] Player entities:', playerEntities, 'numPlayers:', numPlayers);
        console.log('[areAllPlayersReady] Ready states map:', Array.from(this.placementReadyStates.entries()));

        const states = [...this.placementReadyStates.values()];
        const allReady = states.length === numPlayers && states.every(ready => ready === true);

        console.log('[areAllPlayersReady] states.length:', states.length, 'numPlayers:', numPlayers, 'allReady:', allReady);

        return allReady;
    }

    getStartingStateResponse() {
        const playerEntities = this.call.getSerializedPlayerEntities() || [];
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

    /**
     * Broadcast GAME_END to all clients
     * Handles both local routing and multiplayer broadcasting
     * @param {Object} result - Game result data from the scenario system
     */
    broadcastGameEnd(result) {
        // Inherited BaseNetworkSystem method — NOT this.call.broadcastToRoom:
        // 'broadcastToRoom' isn't in this system's serviceDependencies, so the
        // service-call form is undefined and crashes the game-over flow.
        this.broadcastToRoom(null, 'GAME_END', { result });

        // Mark room as inactive after delay (multiplayer only)
        if (this.game.room) {
            setTimeout(() => {
                this.game.room.isActive = false;
            }, 10000);
        }
    }

    // ==================== HERO ARENA: LEADER SELECTION ====================

    handleLeaderSelected(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const leaderId = eventData.data?.leaderId ?? eventData.leaderId;
        const result = this.call.confirmLeaderSelection(numericPlayerId, leaderId);
        return this.respond(playerId, 'LEADER_SELECTED_ACK', result ?? { success: false, reason: 'no_system' }, callback);
    }

    // ==================== HERO ARENA: HERO SELECTION ====================

    handleHeroSelected(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const heroClassId = eventData.data?.heroClassId ?? eventData.heroClassId;
        const result = this.call.confirmHeroSelection(numericPlayerId, heroClassId);
        return this.respond(playerId, 'HERO_SELECTED_ACK', result ?? { success: false, reason: 'no_system' }, callback);
    }

    // ==================== HERO ARENA: HERO REPOSITION ====================

    handleHeroMoved(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const entityId = eventData.data?.entityId ?? eventData.entityId;
        const x = eventData.data?.x ?? eventData.x;
        const z = eventData.data?.z ?? eventData.z;
        const rotationY = eventData.data?.rotationY ?? eventData.rotationY;

        // Only the owning player can move their own heroes. playerStats.playerId is
        // numeric, so compare against the numeric id (the socket id never matches it).
        const team = this.game.getComponent(entityId, 'team');
        if (team) {
            const playerEntities = this.call.getPlayerEntities();
            let ownerPlayerId = null;
            for (const eid of playerEntities) {
                const stats = this.game.getComponent(eid, 'playerStats');
                if (stats && stats.team === team.team) { ownerPlayerId = stats.playerId; break; }
            }
            if (ownerPlayerId !== numericPlayerId) {
                return this.respond(playerId, 'HERO_MOVED_ACK', { success: false, reason: 'not_owner' }, callback);
            }
        }

        // Deployment is permanent: units that have fought a battle hold their
        // positions for the rest of the match.
        if (this.game.heroRosterSystem?.isUnitLocked?.(entityId)) {
            return this.respond(playerId, 'HERO_MOVED_ACK', { success: false, reason: 'deployment_locked' }, callback);
        }

        const result = this.call.moveHero(entityId, x, z, rotationY);
        // Echo the authoritative (grid-snapped) position back to the MOVER only — never
        // to the opponent, so prep-phase repositioning stays hidden until battle start
        // (where the full entitySync reveals everyone's real positions). The mover
        // already moved optimistically; this just reconciles any server-side snapping.
        if (result?.success) {
            this.sendToPlayer(playerId, 'HERO_MOVED', { entityId, x, z, rotationY });
        }
        return this.respond(playerId, 'HERO_MOVED_ACK', result ?? { success: false, reason: 'no_system' }, callback);
    }

    // ==================== HERO ARENA: LOOT & EQUIPMENT ====================

    handleClaimLoot(eventData, callback) {
        const { playerId, itemIndex } = eventData;
        const result = this.call.claimLootItem(playerId, itemIndex);
        return this.respond(playerId, 'CLAIM_LOOT_ACK', result ?? { success: false }, callback);
    }

    handleSkipLoot(eventData, callback) {
        const { playerId } = eventData;
        const result = this.call.skipLoot(playerId);
        return this.respond(playerId, 'SKIP_LOOT_ACK', result ?? { success: false }, callback);
    }

    // ── Army shop ─────────────────────────────────────────────────────────────

    handleBuyOffer(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.buyOffer(numericPlayerId, d.offerIndex);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // replicate to the buyer only
        return this.respond(playerId, 'BUY_OFFER_ACK', result ?? { success: false }, callback);
    }

    handleRerollOffers(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const result = this.call.rerollOffers(numericPlayerId);
        return this.respond(playerId, 'REROLL_OFFERS_ACK', result ?? { success: false }, callback);
    }

    handleBuyUnlockedUnit(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.buyUnlockedUnit(numericPlayerId, d.unitTypeId);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // replicate to the buyer only
        return this.respond(playerId, 'BUY_UNLOCKED_UNIT_ACK', result ?? { success: false }, callback);
    }

    handleBuyUnitTech(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.buyUnitTech(numericPlayerId, d.unitId, d.techId);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // stat techs mutate live units
        return this.respond(playerId, 'BUY_UNIT_TECH_ACK', result ?? { success: false }, callback);
    }

    handleBuySquadLevel(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.buySquadLevel(numericPlayerId, d.rosterIndex);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // unit rebuilt with new level
        return this.respond(playerId, 'BUY_SQUAD_LEVEL_ACK', result ?? { success: false }, callback);
    }

    handleSellUnit(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.sellUnit(numericPlayerId, d.rosterIndex);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // sold unit despawn → buyer only
        return this.respond(playerId, 'SELL_UNIT_ACK', result ?? { success: false }, callback);
    }

    handleGrantSingleAbility(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.grantSingleTargetAbility(numericPlayerId, d.abilityId, d.rosterIndex);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // replicate to the granting player only
        return this.respond(playerId, 'GRANT_SINGLE_ABILITY_ACK', result ?? { success: false }, callback);
    }

    handleSpecializeChoice(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.applySpecializationChoice(numericPlayerId, d.rosterIndex, d.spawnType);
        this.syncEntitiesToClients(playerId, numericPlayerId);   // replicate to the owning player only
        return this.respond(playerId, 'SPECIALIZE_CHOICE_ACK', result ?? { success: false }, callback);
    }

    // ── Buildings ─────────────────────────────────────────────────────────────

    handlePlaceBuilding(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.placeBuilding(numericPlayerId, d.buildingId, d.x, d.z);
        if (result?.success) this.syncEntitiesToClients(playerId, numericPlayerId);
        return this.respond(playerId, 'PLACE_BUILDING_ACK', result ?? { success: false }, callback);
    }

    handleMoveBuilding(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const d = eventData.data || eventData;
        const result = this.call.moveBuilding(numericPlayerId, d.placementId, d.x, d.z);
        // Echo to the mover only (like HERO_MOVED) — opponent sees buildings at battle start.
        if (result?.success) this.sendToPlayer(playerId, 'BUILDING_MOVED', { placementId: d.placementId, x: d.x, z: d.z });
        return this.respond(playerId, 'MOVE_BUILDING_ACK', result ?? { success: false }, callback);
    }

    handleCancelPlaceBuilding(eventData, callback) {
        const { playerId } = eventData;
        const numericPlayerId = eventData.numericPlayerId ?? eventData.playerId;
        const result = this.call.cancelPendingBuilding(numericPlayerId);
        return this.respond(playerId, 'CANCEL_PLACE_BUILDING_ACK', result ?? { success: false }, callback);
    }

    clearAllPlacements() {
        this.placementReadyStates = new Map();
        this.pendingNetworkUnitData.clear();
    }

    cleanup() {
        console.log('ServerNetworkSystem cleaned up');
    }
}
