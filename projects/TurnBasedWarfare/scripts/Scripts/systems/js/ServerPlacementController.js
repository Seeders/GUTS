/**
 * ServerPlacementController - Server-only placement logic
 * Handles network events, room management, and server-side validation
 */
class ServerPlacementController {
    constructor(placementSystem, engine) {
        this.placementSystem = placementSystem;
        this.game = placementSystem.game;
        this.engine = engine;
        this.serverNetworkManager = this.engine.serverNetworkManager;
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

    // ==================== Network Event Handlers ====================

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

            if (player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', this.getStartingState(player));
            }
        } catch (error) {
            console.error('Error getting starting state:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'GOT_STARTING_STATE', {
                error: 'Server error while getting starting state',
                playerId: eventData.playerId,
                success: false
            });
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

            this.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT',
                this.placementSystem.submitPlayerPlacement(playerId, player, placement, true));
        } catch (error) {
            console.error('Error submitting placements:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'SUBMITTED_PLACEMENT', {
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

            this.serverNetworkManager.sendToPlayer(playerId, 'PURCHASED_UPGRADE',
                this.purchaseUpgrade(playerId, player, data.data, true));
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

    async handleLevelSquad(eventData) {
        const { playerId, data } = eventData;
        const { placementId, specializationId } = data;
        let playerGold = 0;

        if (playerId) {
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (roomId) {
                const room = this.engine.getRoom(roomId);
                if (room) {
                    const player = room.players.get(playerId);
                    playerGold = player.stats.gold;
                    console.log('got player gold', playerGold);

                    if (!this.game.gameManager.call('canAffordLevelUp', placementId, playerGold)) {
                        console.log("not enough gold to level up");
                        this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_LEVELED', {
                            playerId: playerId,
                            error: "gold_low_error",
                            success: false
                        });
                        return false;
                    }

                    const success1 = specializationId ?
                        this.game.gameManager.call('applySpecialization', placementId, specializationId, playerId) : true;

                    await this.game.gameManager.call('levelUpSquad', placementId, null, playerId, (success) => {
                        console.log('success?: ', success1, success);
                        if (success1 && success) {
                            const levelUpCost = this.game.gameManager.call('getLevelUpCost', placementId);

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

    handleSetSquadTarget(eventData) {
        try {
            const { playerId, data } = eventData;
            const { placementId, targetPosition, meta } = data;

            if (this.game.state.phase !== "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                    success: false
                });
                return;
            }

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
            const placement = this.placementSystem.getPlacementById(placementId);

            if (!placement) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                    error: 'Placement not found'
                });
                return;
            }

            // Store target position in placement data
            placement.targetPosition = targetPosition;
            placement.squadUnits.forEach((unitId) => {
                if (targetPosition) {
                    let currentOrderAI = this.game.gameManager.call('getAIControllerData', unitId, "UnitOrderSystem");
                    currentOrderAI.targetPosition = targetPosition;
                    currentOrderAI.path = [];
                    currentOrderAI.meta = meta;
                    this.game.gameManager.call('setCurrentAIController', unitId, "UnitOrderSystem", currentOrderAI);
                }
            });

            // Send success response to requesting player
            this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                success: true,
                placementId,
                targetPosition,
                meta
            });

            // Broadcast to other players in the room
            for (const [otherPlayerId, otherPlayer] of room.players) {
                if (otherPlayerId !== playerId) {
                    this.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGET_SET', {
                        placementId,
                        targetPosition,
                        meta
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

            if (this.game.state.phase !== "placement") {
                this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                    success: false
                });
                return;
            }

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

            for (let i = 0; i < placementIds.length; i++) {
                let placementId = placementIds[i];
                let targetPosition = targetPositions[i];

                const placement = this.placementSystem.getPlacementById(placementId);

                if (!placement) {
                    console.log(placementId, 'not found');
                    this.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                        error: 'Placement not found'
                    });
                    return;
                }

                // Store target position in placement data
                placement.targetPosition = targetPosition;
                placement.squadUnits.forEach((unitId) => {
                    if (targetPosition) {
                        let currentOrderAI = this.game.gameManager.call('getAIControllerData', unitId, "UnitOrderSystem");
                        currentOrderAI.targetPosition = targetPosition;
                        currentOrderAI.path = [];
                        currentOrderAI.meta = meta;
                        this.game.gameManager.call('setCurrentAIController', unitId, "UnitOrderSystem", currentOrderAI);
                    }
                });

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
                        targetPositions,
                        meta
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
        this.placementSystem.placementReadyStates.set(playerId, true);

        this.serverNetworkManager.sendToPlayer(playerId, 'READY_FOR_BATTLE_RESPONSE', { success: true });

        // Check if all players are ready and start battle if so
        if (this.areAllPlayersReady() && this.game.state.phase === 'placement') {
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {
                gameState: gameState,
                allReady: true
            });
            this.placementSystem.placementReadyStates.clear();

            this.game.resetCurrentTime();
            this.placementSystem.applyTargetPositions();
            this.game.desyncDebugger.enabled = true;
            this.game.desyncDebugger.displaySync(true);
            this.placementSystem.resetAI();
            this.game.gameManager.call('startBattle', room);
        } else {
            const gameState = room.getGameState();
            this.serverNetworkManager.broadcastToRoom(roomId, 'READY_FOR_BATTLE_UPDATE', {
                gameState: gameState,
                allReady: false
            });
        }
    }

    // ==================== Server-Side Logic ====================

    areAllPlayersReady() {
        let states = [...this.placementSystem.placementReadyStates.values()];
        return states.length === this.placementSystem.numPlayers && states.every(ready => ready === true);
    }

    purchaseUpgrade(playerId, player, data) {
        console.log(`=== Purchase Upgrade DEBUG ===`);
        console.log(`Data received:`, data);

        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        const upgrade = this.game.getCollections().upgrades[data.upgradeId];
        if (upgrade?.value <= player.stats.gold) {
            player.stats.gold -= upgrade.value;

            if (!this.game.state.teams) {
                this.game.state.teams = {};
            }
            if (!this.game.state.teams[player.stats.side]) {
                this.game.state.teams[player.stats.side] = {};
            }
            if (!this.game.state.teams[player.stats.side].effects) {
                this.game.state.teams[player.stats.side].effects = {};
            }

            upgrade.effects.forEach((effectId) => {
                const effect = this.game.getCollections().effects[effectId];
                this.game.state.teams[player.stats.side].effects[effectId] = effect;
            });

            console.log(`SUCCESS`);
            console.log(`================================`);
            return { success: true };
        }

        console.log(`ERROR`);
        console.log(`================================`);

        return { success: false, error: "Not enough gold." };
    }

    saveBuilding(entityId, team, gridPosition, unitType) {
        console.log(`=== Save Building DEBUG ===`);
        console.log(`Data received:`, entityId, team, unitType);

        if (unitType.id === 'goldMine') {
            const gridWidth = unitType.placementGridWidth || 2;
            const gridHeight = unitType.placementGridHeight || 2;

            const result = this.game.gameManager.call('buildGoldMine', entityId, team, gridPosition, gridWidth, gridHeight);
            if (!result.success) {
                return result;
            }
        }

        console.log(`SUCCESS`);
        console.log(`================================`);
        return { success: true };
    }

    getStartingState(player) {
        let startPosition = { x: 5, z: 5 };
        if (player.stats.side === 'right') {
            startPosition = { x: 58, z: 58 };
        }

        // Find nearest unclaimed gold vein
        let nearestGoldVeinLocation = null;
        let minDistance = Infinity;

        const goldVeinLocations = this.game.gameManager.call('getGoldVeinLocations');
        if (goldVeinLocations) {
            goldVeinLocations.forEach(vein => {
                if (vein.claimed) return;

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
        const dx = nearestGoldVeinLocation.x - startPosition.x;
        const dz = nearestGoldVeinLocation.z - startPosition.z;

        let peasantPositions = [];

        // Determine which side the gold mine is on and place peasants accordingly
        if (Math.abs(dx) > Math.abs(dz)) {
            if (dx > 0) {
                // Gold mine is to the EAST
                peasantPositions = [
                    { x: startPosition.x + 2, z: startPosition.z - 1 },
                    { x: startPosition.x + 2, z: startPosition.z },
                    { x: startPosition.x + 2, z: startPosition.z + 1 },
                    { x: startPosition.x + 2, z: startPosition.z + 2 }
                ];
            } else {
                // Gold mine is to the WEST
                peasantPositions = [
                    { x: startPosition.x - 2, z: startPosition.z - 1 },
                    { x: startPosition.x - 2, z: startPosition.z },
                    { x: startPosition.x - 2, z: startPosition.z + 1 },
                    { x: startPosition.x - 2, z: startPosition.z + 2 }
                ];
            }
        } else {
            if (dz > 0) {
                // Gold mine is to the SOUTH
                peasantPositions = [
                    { x: startPosition.x - 1, z: startPosition.z + 2 },
                    { x: startPosition.x, z: startPosition.z + 2 },
                    { x: startPosition.x + 1, z: startPosition.z + 2 },
                    { x: startPosition.x + 2, z: startPosition.z + 2 }
                ];
            } else {
                // Gold mine is to the NORTH
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

        const pitch = 35.264 * Math.PI / 180;
        const yaw = 135 * Math.PI / 180;
        const distance = 10240;

        const cdx = Math.sin(yaw) * Math.cos(pitch);
        const cdz = Math.cos(yaw) * Math.cos(pitch);

        const worldPos = this.game.gameManager.call('convertGridToWorldPosition', startPosition.x, startPosition.z);

        const cameraPosition = {
            x: worldPos.x - cdx * distance,
            y: distance,
            z: worldPos.z - cdz * distance
        };

        const lookAt = {
            x: worldPos.x,
            y: 0,
            z: worldPos.z
        };

        return {
            success: true,
            startingUnits,
            camera: {
                position: cameraPosition,
                lookAt
            }
        };
    }

    dispose() {
        // Cleanup if needed
    }
}
