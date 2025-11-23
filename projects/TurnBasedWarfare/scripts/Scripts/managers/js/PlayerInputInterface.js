/**
 * PlayerInputInterface
 *
 * UNIFIED INPUT INTERFACE for both client and server.
 * This class handles all player input actions and applies them to the game.
 *
 * Architecture:
 * - Client: Player UI → PlayerInputInterface → Game Logic + Network Send
 * - Server: Network Receive → PlayerInputInterface → Game Logic
 *
 * The interface doesn't care where input comes from (player or network).
 * It just applies the action to the game state.
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
     */
    setSquadTarget(placementId, targetPosition, meta, commandCreatedTime, networkData = null) {
        // Apply to game state (unified logic)
        this.game.unitOrderSystem.applySquadTargetPosition(
            placementId,
            targetPosition,
            meta,
            commandCreatedTime
        );

        // Client: Send to network
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.sendSquadTarget({
                placementId,
                targetPosition,
                meta,
                commandCreatedTime
            });
        }

        // Server: Broadcast to other players
        if (this.mode === 'server' && networkData && this.game.serverNetworkManager) {
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

    /**
     * Set squad targets (batch move orders)
     *
     * @param {string[]} placementIds - Array of squad/placement IDs
     * @param {object[]} targetPositions - Array of target positions
     * @param {object} meta - Metadata
     * @param {number} commandCreatedTime - Timestamp
     * @param {object} networkData - Network-specific data - server only
     */
    setSquadTargets(placementIds, targetPositions, meta, commandCreatedTime, networkData = null) {
        // Apply to game state (unified logic)
        this.game.unitOrderSystem.applySquadsTargetPositions(
            placementIds,
            targetPositions,
            meta,
            commandCreatedTime
        );

        // Client: Send to network
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.sendSquadTargets({
                placementIds,
                targetPositions,
                meta,
                commandCreatedTime
            });
        }

        // Server: Broadcast to other players
        if (this.mode === 'server' && networkData && this.game.serverNetworkManager) {
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

    /**
     * Place squad on battlefield
     *
     * @param {object} placement - Placement data
     * @param {object} networkData - Network-specific data - server only
     * @returns {object} Result with success flag
     */
    placeSquad(placement, networkData = null) {
        // Determine mode-specific callback
        let createUnitFn;

        if (this.mode === 'client') {
            // Client-specific unit creation
            createUnitFn = (pos, placement) => {
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
        } else {
            // Server-specific unit creation
            createUnitFn = (pos, placement) => {
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
        }

        // Apply to game state (unified logic)
        const result = this.game.squadManager.applyPlacementToGame(placement, createUnitFn);

        // Client: Send to network
        if (this.mode === 'client' && this.game.networkManager) {
            this.game.networkManager.submitPlacement({ placement, ready: false });
        }

        // Server: Send confirmation
        if (this.mode === 'server' && networkData && this.game.serverNetworkManager) {
            const { playerId } = networkData;
            this.game.serverNetworkManager.sendToPlayer(playerId, 'SUBMITTED_PLACEMENT', {
                success: result.success
            });
        }

        return result;
    }
}
