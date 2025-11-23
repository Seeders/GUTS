/**
 * PlayerInputInterface
 *
 * UNIFIED INPUT INTERFACE for both client and server.
 * This class handles all player input actions and applies them to the game.
 *
 * Architecture:
 * - Client (own actions): Player UI → PlayerInputInterface → Network Send → Wait → Game Logic
 * - Server: Network Receive → PlayerInputInterface → Game Logic + Broadcast
 * - Client (opponent actions): Network Receive → PlayerInputInterface → Game Logic
 *
 * ALL game state changes go through this interface, ensuring:
 * - Consistent application of game logic
 * - Single source of truth for state changes
 * - Server authority with client wait-for-confirmation
 */
class PlayerInputInterface {
    constructor(game) {
        this.game = game;
        // Auto-detect mode based on available managers
        this.mode = this.game.clientNetworkManager ? 'client' : 'server';
        this.game.playerInputInterface = this;

        console.log(`[PlayerInputInterface] Initialized in ${this.mode} mode`);
    }

    /**
     * Set squad target position (move order)
     *
     * @param {string} placementId - Squad/placement ID
     * @param {object} targetPosition - Target position {x, z}
     * @param {object} meta - Metadata (isPlayerOrder, etc.)
     * @param {number} commandCreatedTime - Timestamp
     * @param {object} networkData - Network-specific data (playerId, etc.) - server only
     * @param {function} callback - Callback for client after network confirmation
     */
    setSquadTarget(placementId, targetPosition, meta, commandCreatedTime, networkData = null, callback = null) {
        // Server: Apply immediately, then broadcast
        if (this.mode === 'server') {
            // Apply to game state (unified logic)
            this.applySquadTargetPosition(
                placementId,
                targetPosition,
                meta,
                commandCreatedTime
            );

            // Broadcast to other players
            if (networkData && this.game.serverNetworkManager) {
                const { playerId, roomId, room } = networkData;

                // Send confirmation to requesting player
                this.game.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGET_SET', {
                    success: true,
                    placementId,
                    targetPosition,
                    meta,
                    commandCreatedTime
                });

                // Broadcast to other players in room
                for (const [otherPlayerId, otherPlayer] of room.players) {
                    if (otherPlayerId !== playerId) {
                        this.game.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGET_SET', {
                            placementId,
                            targetPosition,
                            meta
                        });
                    }
                }
            }
        }

        // Client: Send to network, wait for confirmation, then apply
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.sendSquadTarget(
                { placementId, targetPosition, meta, commandCreatedTime },
                (success, responseData) => {
                    if (success) {
                        // Use server's timestamp for determinism
                        const createdTime = responseData?.commandCreatedTime || commandCreatedTime;

                        // Now apply to game state after server confirmation
                        this.applySquadTargetPosition(
                            placementId,
                            targetPosition,
                            meta,
                            createdTime
                        );

                        // Call callback if provided
                        if (callback) {
                            callback(success, responseData);
                        }
                    } else {
                        console.error('[PlayerInputInterface] Server rejected squad target');
                        if (callback) {
                            callback(success, responseData);
                        }
                    }
                }
            );
        }
    }

    /**
     * Set squad targets (batch move orders)
     *
     * @param {string[]} placementIds - Array of squad/placement IDs
     * @param {object[]} targetPositions - Array of target positions
     * @param {object} meta - Metadata
     * @param {number} commandCreatedTime - Timestamp
     * @param {object} networkData - Network-specific data - server only
     * @param {function} callback - Callback for client after network confirmation
     */
    setSquadTargets(placementIds, targetPositions, meta, commandCreatedTime, networkData = null, callback = null) {
        // Server: Apply immediately, then broadcast
        if (this.mode === 'server') {
            // Apply to game state (unified logic)
            this.applySquadsTargetPositions(
                placementIds,
                targetPositions,
                meta,
                commandCreatedTime
            );

            // Broadcast to other players
            if (networkData && this.game.serverNetworkManager) {
                const { playerId, roomId, room } = networkData;

                this.game.serverNetworkManager.sendToPlayer(playerId, 'SQUAD_TARGETS_SET', {
                    success: true,
                    commandCreatedTime
                });

                for (const [otherPlayerId, otherPlayer] of room.players) {
                    if (otherPlayerId !== playerId) {
                        this.game.serverNetworkManager.sendToPlayer(otherPlayerId, 'OPPONENT_SQUAD_TARGETS_SET', {
                            placementIds,
                            targetPositions,
                            meta,
                            commandCreatedTime
                        });
                    }
                }
            }
        }

        // Client: Send to network, wait for confirmation, then apply
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.setSquadTargets(
                { placementIds, targetPositions, meta, commandCreatedTime },
                (success, responseData) => {
                    if (success) {
                        // Use server's timestamp for determinism
                        const createdTime = responseData?.commandCreatedTime || commandCreatedTime;

                        // Now apply to game state after server confirmation
                        this.applySquadsTargetPositions(
                            placementIds,
                            targetPositions,
                            meta,
                            createdTime
                        );

                        // Call callback if provided
                        if (callback) {
                            callback(success, responseData);
                        }
                    } else {
                        console.error('[PlayerInputInterface] Server rejected squad targets');
                        if (callback) {
                            callback(success, responseData);
                        }
                    }
                }
            );
        }
    }

    /**
     * Apply opponent's squad target (received from server broadcast)
     *
     * Called when other clients' move orders are broadcast to this client.
     * Already server-validated, so just apply directly.
     *
     * @param {string} placementId - Squad/placement ID
     * @param {object} targetPosition - Target position {x, z}
     * @param {object} meta - Metadata
     * @param {number} commandCreatedTime - Server timestamp
     */
    applyOpponentSquadTarget(placementId, targetPosition, meta, commandCreatedTime) {
        // Apply directly - this is already server-validated
        this.applySquadTargetPosition(
            placementId,
            targetPosition,
            meta,
            commandCreatedTime
        );
    }

    /**
     * Apply opponent's squad targets (batch, received from server broadcast)
     *
     * Called when other clients' move orders are broadcast to this client.
     * Already server-validated, so just apply directly.
     *
     * @param {string[]} placementIds - Array of squad/placement IDs
     * @param {object[]} targetPositions - Array of target positions
     * @param {object} meta - Metadata
     * @param {number} commandCreatedTime - Server timestamp
     */
    applyOpponentSquadTargets(placementIds, targetPositions, meta, commandCreatedTime) {
        // Apply directly - this is already server-validated
        this.applySquadsTargetPositions(
            placementIds,
            targetPositions,
            meta,
            commandCreatedTime
        );
    }

    /**
     * Apply a move order to a single squad
     *
     * SHARED GAME LOGIC: This method is called by both client and server to ensure
     * identical behavior. Do NOT duplicate this logic elsewhere.
     *
     * @param {string} placementId - The placement/squad ID
     * @param {object} targetPosition - The target position {x, z}
     * @param {object} meta - Metadata including isPlayerOrder flag
     * @param {number} commandCreatedTime - Timestamp for deterministic command creation
     */
    applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime) {
        const placement = this.game.gameManager.call('getPlacementById', placementId);
        if (!placement) {
            // Placement doesn't exist yet on client - entity sync at battle start will handle it
            return;
        }
        const createdTime = commandCreatedTime || this.game.state.now;
        placement.targetPosition = targetPosition;
        placement.squadUnits.forEach((unitId) => {
            if (targetPosition) {
                // Clear any existing commands (including mining/building)
                this.game.gameManager.call('clearCommands', unitId);

                // Store player order for persistence through combat
                const aiState = this.game.getComponent(unitId, ComponentTypes.AI_STATE);
                if (aiState) {
                    aiState.playerOrder = {
                        targetPosition: targetPosition,
                        meta: meta,
                        issuedTime: createdTime
                    };
                    aiState.meta = meta;
                }

                // Queue MOVE command through command queue system
                // This properly interrupts abilities like mining
                this.game.gameManager.call('queueCommand', unitId, {
                    type: 'move',
                    controllerId: "UnitOrderSystem",
                    targetPosition: targetPosition,
                    meta: meta,
                    priority: this.game.commandQueueSystem?.PRIORITY.MOVE || 10,
                    interruptible: true,
                    createdTime: createdTime
                }, true); // true = interrupt current command
            }
        });
    }

    /**
     * Apply move orders to multiple squads
     *
     * SHARED GAME LOGIC: Wrapper around applySquadTargetPosition for batch operations.
     * Both client and server call this to ensure identical behavior.
     *
     * @param {string[]} placementIds - Array of placement/squad IDs
     * @param {object[]} targetPositions - Array of target positions
     * @param {object} meta - Metadata including isPlayerOrder flag
     * @param {number} commandCreatedTime - Timestamp for deterministic command creation
     */
    applySquadsTargetPositions(placementIds, targetPositions, meta, commandCreatedTime) {
        for (let i = 0; i < placementIds.length; i++) {
            let placementId = placementIds[i];
            let targetPosition = targetPositions[i];
            this.applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime);
        }
    }

    /**
     * Place squad on battlefield
     *
     * @param {object} placement - Placement data
     * @param {object} networkData - Network-specific data - server only
     * @param {function} callback - Callback for client after network confirmation
     * @returns {object} Result with success flag (server only, client returns via callback)
     */
    placeSquad(placement, networkData = null, callback = null) {
        // Server: Apply immediately, then broadcast
        if (this.mode === 'server') {
            // Server-specific unit creation
            const createUnitFn = (pos, placement) => {
                const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z) || 0;
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const entityId = this.game.unitCreationManager.create(
                    pos.x, unitY, pos.z,
                    placement.targetPosition,
                    placement,
                    placement.team,
                    placement.playerId
                );

                this.game.gameManager.call('reserveGridCells', placement.cells, entityId);

                if (placement.unitType.id === 'goldMine') {
                    const footprintWidth = placement.unitType.footprintWidth || placement.unitType.placementGridWidth || 2;
                    const footprintHeight = placement.unitType.footprintHeight || placement.unitType.placementGridHeight || 2;
                    const gridWidth = footprintWidth * 2;
                    const gridHeight = footprintHeight * 2;
                    this.game.gameManager.call('buildGoldMine', entityId, placement.team, placement.gridPosition, gridWidth, gridHeight);
                }

                return entityId;
            };

            // Apply to game state (unified logic)
            const result = this.game.squadManager.applyPlacementToGame(placement, createUnitFn);

            // Send confirmation to requesting player
            if (networkData && this.game.serverNetworkManager) {
                const { playerId } = networkData;
                this.game.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', {
                    success: result.success
                });
            }

            return result;
        }

        // Client: Send to network, wait for confirmation, then apply
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.submitPlacement(
                placement,
                (success, responseData) => {
                    if (success) {
                        // Client-specific unit creation
                        const createUnitFn = (pos, placement) => {
                            const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z) || 0;
                            const unitY = terrainHeight !== null ? terrainHeight : 0;

                            let playerId = placement.playerId || null;
                            if (!playerId && placement.team === this.game.state.mySide) {
                                playerId = this.game.clientNetworkManager?.playerId || null;
                            }

                            const entityId = this.game.unitCreationManager.create(
                                pos.x, unitY, pos.z,
                                placement.targetPosition,
                                placement,
                                placement.team,
                                playerId
                            );

                            this.game.gameManager.call('reserveGridCells', placement.cells, entityId);

                            if (placement.unitType.id === 'goldMine') {
                                const footprintWidth = placement.unitType.footprintWidth || placement.unitType.placementGridWidth || 2;
                                const footprintHeight = placement.unitType.footprintHeight || placement.unitType.placementGridHeight || 2;
                                const gridWidth = footprintWidth * 2;
                                const gridHeight = footprintHeight * 2;
                                this.game.gameManager.call('buildGoldMine', entityId, placement.team, placement.gridPosition, gridWidth, gridHeight);
                            }

                            return entityId;
                        };

                        // Now apply to game state after server confirmation
                        const result = this.game.squadManager.applyPlacementToGame(placement, createUnitFn);

                        // Call callback if provided
                        if (callback) {
                            callback(success, result);
                        }
                    } else {
                        console.error('[PlayerInputInterface] Server rejected placement');
                        if (callback) {
                            callback(success, null);
                        }
                    }
                }
            );
        }
    }
}
