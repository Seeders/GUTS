/**
 * PlacementSystem
 *
 * SHARED PLACEMENT LOGIC for both client and server.
 * This system handles all placement-related game state changes.
 *
 * What this system does:
 * - Track placements for each side
 * - Validate placement requests
 * - Apply placements to game state
 * - Manage placement lifecycle
 *
 * What this system does NOT do:
 * - UI (preview, effects, undo) - see PlacementUISystem
 * - Network (validation, broadcasting) - see network handlers
 */
class PlacementSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.placementSystem = this;
        this.leftPlacements = [];
        this.rightPlacements = [];
        this.playerPlacements = new Map(); // playerId -> placements array
    }

    init(params) {
        // Register public API methods
        this.game.gameManager.register('getPlacementById', this.getPlacementById.bind(this));
        this.game.gameManager.register('getPlacementsForSide', this.getPlacementsForSide.bind(this));
        this.game.gameManager.register('submitPlacement', this.submitPlacement.bind(this));
        this.game.gameManager.register('validatePlacement', this.validatePlacement.bind(this));
        this.game.gameManager.register('setPlacementExperience', this.setPlacementExperience.bind(this));
        this.game.gameManager.register('registerPlacement', this.registerPlacement.bind(this));
    }

    /**
     * Register a placement that was created outside of submitPlacement
     * (e.g., starting state units, or units created via PlayerInputInterface.placeSquad)
     *
     * @param {object} placement - Placement data
     * @param {string} playerId - Player ID who owns this placement
     */
    registerPlacement(placement, playerId) {
        if (!placement || !playerId) {
            console.error('[PlacementSystem] registerPlacement: missing placement or playerId');
            return;
        }

        // Store placement
        let playerPlacements = this.playerPlacements.get(playerId);
        if (playerPlacements) {
            // Check if already registered
            const exists = playerPlacements.find(p => p.placementId === placement.placementId);
            if (exists) {
                console.warn('[PlacementSystem] Placement already registered:', placement.placementId);
                return;
            }
            playerPlacements.push(placement);
        } else {
            playerPlacements = [placement];
        }
        this.playerPlacements.set(playerId, playerPlacements);

        // Update side placements
        if (placement.team === 'left') {
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }

        console.log('[PlacementSystem] Registered placement:', placement.placementId, 'for player:', playerId, 'team:', placement.team);
    }

    /**
     * Get placement by ID
     */
    getPlacementById(placementId) {
        // Check left placements
        if (this.leftPlacements) {
            const found = this.leftPlacements.find(p => p.placementId === placementId);
            if (found) return found;
        }

        // Check right placements
        if (this.rightPlacements) {
            const found = this.rightPlacements.find(p => p.placementId === placementId);
            if (found) return found;
        }

        return null;
    }

    /**
     * Get all placements for a side
     */
    getPlacementsForSide(side) {
        if (side == 'left') {
            return this.leftPlacements || [];
        } else {
            return this.rightPlacements || [];
        }
    }

    /**
     * Validate placement
     */
    validatePlacement(placement, player) {
        // Add your validation logic here
        // For now, basic validation
        if (!placement) {
            console.error('[PlacementSystem] Validation failed: placement is null/undefined');
            return false;
        }

        if (!placement.unitType) {
            console.error('[PlacementSystem] Validation failed: placement.unitType is missing', {
                placementId: placement.placementId,
                collection: placement.collection,
                hasUnitType: !!placement.unitType,
                keys: Object.keys(placement)
            });
            return false;
        }

        // Check if player can afford it (if player data provided)
        if (player && placement.unitType.value > 0 && !placement.isStartingState) {
            if (player.stats.gold < placement.unitType.value) {
                console.error('[PlacementSystem] Validation failed: insufficient gold', {
                    cost: placement.unitType.value,
                    playerGold: player.stats.gold
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Submit placement (apply to game)
     *
     * @param {string} playerId - Player ID
     * @param {object} player - Player data
     * @param {object} placement - Placement data
     * @returns {object} Result with success flag
     */
    submitPlacement(playerId, player, placement) {
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        // Validate placement
        if (!this.validatePlacement(placement, player)) {
            return { success: false, error: 'Invalid placement' };
        }

        // Deduct gold only for new units
        if (placement.unitType?.value > 0 && !placement.isStartingState) {
            player.stats.gold -= placement.unitType?.value;
        }

        // Store placement
        let playerPlacements = this.playerPlacements.get(playerId);
        if (playerPlacements) {
            playerPlacements.push(placement);
        } else {
            playerPlacements = [placement];
        }
        this.playerPlacements.set(playerId, playerPlacements);

        // Update side placements
        if (player.stats.side == 'left') {
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }

        // Debug: Check placement before creating units
        console.log('[PlacementSystem] submitPlacement - about to create units:', {
            hasUnitType: !!placement.unitType,
            unitTypeId: placement.unitType?.id,
            placementId: placement.placementId
        });

        // Create units using unified interface
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
console.log('PLACEMENT SYSTEM submitPlacement', placement);
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

        const result = this.game.squadManager.applyPlacementToGame(placement, createUnitFn);

        return { success: result.success };
    }

    /**
     * Placement phase start - clear placements
     */
    onPlacementPhaseStart() {
        console.log('[PlacementSystem] Placement phase started');
        // Don't clear placements here - they carry over between rounds
    }

    /**
     * Battle end - cleanup dead squads
     */
    onBattleEnd() {
        this.removeDeadSquadsAfterRound();
    }

    /**
     * Remove dead squads from placement tracking
     */
    removeDeadSquadsAfterRound() {
        this.playerPlacements.forEach((placements, playerId) => {
            const survivingPlacements = placements.filter(placement => {
                if (!placement.squadUnits || placement.squadUnits.length === 0) {
                    return false;
                }

                const aliveUnits = placement.squadUnits.filter(entityId => {
                    const health = this.game.getComponent(entityId, this.game.componentTypes.HEALTH);
                    return health && health.current > 0;
                });

                if (aliveUnits.length === 0) {
                    this.cleanupDeadSquad(placement);
                    return false;
                }

                placement.experience = placement.experience || { unitIds: [] };
                placement.experience.unitIds = aliveUnits;
                return true;
            });

            this.playerPlacements.set(playerId, survivingPlacements);
        });
    }

    /**
     * Cleanup a dead squad
     */
    cleanupDeadSquad(placement) {
        if (placement.placementId) {
            this.game.gameManager.call('releaseGridCells', placement.placementId);
            this.game.gameManager.call('removeSquad', placement.placementId);
        }
    }

    /**
     * Set experience data for placements
     */
    setPlacementExperience(placements) {
        if (!placements) return;

        placements.forEach(placement => {
            if (placement.experience && placement.placementId) {
                const experienceData = placement.experience;

                // Update SquadExperienceSystem Map data
                let squadData = this.game.gameManager.call('getSquadInfo', placement.placementId);

                if (squadData) {
                    squadData.level = experienceData.level;
                    squadData.experience = experienceData.experience;
                    squadData.experienceToNextLevel = experienceData.experienceToNextLevel;
                    squadData.canLevelUp = experienceData.canLevelUp;
                }

                // Also update the local placement object's experience field
                const localPlacement = this.getPlacementById(placement.placementId);
                if (localPlacement) {
                    localPlacement.experience = experienceData;
                }
            }
        });
    }
}
