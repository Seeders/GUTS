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
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', {
                    error: 'Room not found'
                });
                return;
            }

            const room = this.engine.getRoom(roomId);
            if (!room || !room.players || !room.players.has(playerId)) {
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', {
                    error: 'Player not found'
                });
                return;
            }

            const player = room.getPlayer(playerId);
            if (!player) {
                this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', {
                    error: 'Player not found'
                });
                return;
            }

            // Calculate starting state (units, camera)
            const startingState = this.calculateStartingState(player);
            this.serverNetworkManager.sendToPlayer(playerId, 'GOT_STARTING_STATE', startingState);

        } catch (error) {
            console.error('[NetworkHandlers] Error getting starting state:', error);
            this.serverNetworkManager.sendToPlayer(eventData.playerId, 'GOT_STARTING_STATE', {
                error: 'Server error while getting starting state'
            });
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

            // Reconstruct unitType from server's collections
            // Client sends unitTypeId (string like "townHall") instead of full object
            // because complex objects get corrupted during network transmission
            if (placement.unitTypeId && placement.collection) {
                const collections = this.game.getCollections();
                const collection = collections[placement.collection];
                if (collection) {
                    const fullUnitType = collection[placement.unitTypeId];
                    if (fullUnitType) {
                        placement.unitType = fullUnitType;
                    } else {
                        console.error(`[NetworkHandlers] Unit type not found: ${placement.unitTypeId} in collection ${placement.collection}`);
                    }
                } else {
                    console.error(`[NetworkHandlers] Collection not found: ${placement.collection}`);
                }
            } else {
                console.error('[NetworkHandlers] Missing unitTypeId or collection on placement', {
                    hasUnitTypeId: !!placement.unitTypeId,
                    hasCollection: !!placement.collection,
                    placement
                });
            }

            // Recalculate cells from gridPosition and unitType
            // (Arrays don't serialize well over network, so recalculate on server)
            if (placement.gridPosition && placement.unitType) {
                placement.cells = this.game.gameManager.call('getCellsForGridPosition',
                    placement.gridPosition,
                    placement.unitType.placementGridWidth || 1,
                    placement.unitType.placementGridHeight || 1
                );
            }

            // Debug: Check if unitType was reconstructed
            console.log('[NetworkHandlers] About to submit placement:', {
                hasUnitType: !!placement.unitType,
                unitTypeId: placement.unitType?.id,
                collection: placement.collection,
                placementId: placement.placementId
            });

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

    // ==========================================
    // STARTING STATE CALCULATION
    // ==========================================

    getStartingPositionFromLevel(side) {
        // Try to get level data from game collections
        const level = this.game.getCollections().levels[this.game.state.level];
        if (!level || !level.tileMap || !level.tileMap.startingLocations) {
            return null;
        }

        // Find starting location for this side
        const startingLoc = level.tileMap.startingLocations.find(loc => loc.side === side);
        if (startingLoc && startingLoc.gridPosition) {
            return { x: startingLoc.gridPosition.x, z: startingLoc.gridPosition.z };
        }

        return null;
    }

    calculateStartingState(player) {
        // Get starting position from level data if available
        let startPosition = this.getStartingPositionFromLevel(player.stats.side);
        console.log('startPosition', startPosition);

        // Find nearest gold vein
        let nearestGoldVeinLocation = null;
        let minDistance = Infinity;

        const goldVeinLocations = this.game.gameManager.call('getGoldVeinLocations');
        console.log("goldVeinLocations", goldVeinLocations);
        if (goldVeinLocations) {
            goldVeinLocations.forEach(vein => {
                // Calculate distance from start position to vein
                const dx = vein.gridPos.x - startPosition.x;
                const dz = vein.gridPos.z - startPosition.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < minDistance) {
                    minDistance = distance;
                    nearestGoldVeinLocation = vein.gridPos;
                    console.log("nearestGoldVeinLocation", vein.gridPos);
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
                    { x: startPosition.x + 4, z: startPosition.z - 2 },
                    { x: startPosition.x + 4, z: startPosition.z },
                    { x: startPosition.x + 4, z: startPosition.z + 2 },
                    { x: startPosition.x + 4, z: startPosition.z + 4 }
                ];
            } else {
                // Gold mine is to the WEST, place peasants on west side
                // TownHall occupies x-1 to x, so peasants start at x-2
                peasantPositions = [
                    { x: startPosition.x - 4, z: startPosition.z - 2 },
                    { x: startPosition.x - 4, z: startPosition.z },
                    { x: startPosition.x - 4, z: startPosition.z + 2 },
                    { x: startPosition.x - 4, z: startPosition.z + 4 }
                ];
            }
        } else {
            // Gold mine is more to the north or south
            if (dz > 0) {
                // Gold mine is to the SOUTH, place peasants on south side
                // TownHall occupies z to z+1, so peasants start at z+2
                peasantPositions = [
                    { x: startPosition.x - 2, z: startPosition.z + 4 },
                    { x: startPosition.x, z: startPosition.z + 4 },
                    { x: startPosition.x + 2, z: startPosition.z + 4 },
                    { x: startPosition.x + 4, z: startPosition.z + 4 }
                ];
            } else {
                // Gold mine is to the NORTH, place peasants on north side
                // TownHall occupies z-1 to z, so peasants start at z-2
                peasantPositions = [
                    { x: startPosition.x - 2, z: startPosition.z - 4 },
                    { x: startPosition.x, z: startPosition.z - 4 },
                    { x: startPosition.x + 2, z: startPosition.z - 4 },
                    { x: startPosition.x + 4, z: startPosition.z - 4 }
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
}
