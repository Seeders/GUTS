class PlayerStatsSystem extends GUTS.BaseSystem {
    static services = [
        'getPlayerEntityId',
        'getPlayerStats',
        'getLocalPlayerStats',
        'getPlayerStatsByTeam',
        'getPlayerEntities',
        'getSerializedPlayerEntities',
        'getPlayerGold',
        'addPlayerGold',
        'deductPlayerGold',
        'canAffordCost',
        'createPlayerEntity',
        // New services for multi-player support
        'setActivePlayer',
        'getActivePlayer',
        'getActivePlayerTeam',
        'getActivePlayerStats',
        'getPlayerEntityByTeam'
    ];

    constructor(game) {
        super(game);
        this.game.playerStatsSystem = this;
        // Active player context - used for multi-player simulations
        // Set via setActivePlayer() when initializing game modes
        this._activePlayerId = null;
        // Cached team for when player entity doesn't exist yet
        this._cachedActiveTeam = undefined;
    }

    init() {
    }

    // ==================== ACTIVE PLAYER CONTEXT ====================
    // These methods manage which player is currently "active" for operations
    // In single-player/client: typically the local player
    // In headless simulations: set per-operation to the relevant AI player

    /**
     * Set the active player context
     * @param {number|null} playerId - Numeric player ID or null to use legacy myTeam
     * @param {number} [team] - Optional team value to cache (used before player entity exists)
     */
    setActivePlayer(playerId, team) {
        this._activePlayerId = playerId;
        // Cache team for cases where player entity doesn't exist yet
        if (team !== undefined) {
            this._cachedActiveTeam = team;
        }
    }

    /**
     * Get the currently active player ID
     * @returns {number|null} The active player ID or null if using legacy mode
     */
    getActivePlayer() {
        return this._activePlayerId;
    }

    /**
     * Get the team of the active player
     * @returns {number|null} The team enum value or null if no player context
     */
    getActivePlayerTeam() {
        if (this._activePlayerId !== null) {
            const stats = this.getPlayerStats(this._activePlayerId);
            if (stats) {
                return stats.team;
            }
            // Fall back to cached team if player entity doesn't exist yet
            if (this._cachedActiveTeam !== undefined) {
                return this._cachedActiveTeam;
            }
        }
        return null;
    }

    /**
     * Get the playerStats of the active player
     * @returns {Object|null} The playerStats component or null
     */
    getActivePlayerStats() {
        if (this._activePlayerId !== null) {
            return this.getPlayerStats(this._activePlayerId);
        }
        return null;
    }

    /**
     * Get player entity ID by team
     * @param {number} team - Numeric team value (from enums.team)
     * @returns {number|null} The player entity ID or null
     */
    getPlayerEntityByTeam(team) {
        const playerEntities = this.game.getEntitiesWith('playerStats');
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.team === team) {
                return entityId;
            }
        }
        return null;
    }

    /**
     * Get player entity ID from player ID (socket ID on server, converts to numeric)
     * @param {string|number} playerId - Socket ID (string) or numeric player ID
     * @returns {number|null} The player entity ID (numeric) or null if not found
     */
    getPlayerEntityId(playerId) {
        // Convert socket ID to numeric if on server
        let numericId = playerId;
        if (typeof playerId === 'string' && this.game.room) {
            numericId = this.game.room.getNumericPlayerId(playerId);
        }

        const playerEntities = this.game.getEntitiesWith('playerStats');
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericId) {
                return entityId;
            }
        }
        return null;
    }

    /**
     * Get playerStats component for a player
     * @param {string|number} playerId - Socket ID (string) or numeric player ID
     * @returns {Object|null} The playerStats component or null
     */
    getPlayerStats(playerId) {
        const entityId = this.getPlayerEntityId(playerId);
        if (entityId === null) return null;
        return this.game.getComponent(entityId, 'playerStats');
    }

    /**
     * Get playerStats for the local player (client only)
     * @returns {Object|null} The local player's stats or null
     */
    getLocalPlayerStats() {
        // Use numeric playerId for ECS lookup
        const numericId = this.game.clientNetworkManager?.numericPlayerId;
        if (numericId === undefined || numericId === -1) return null;
        return this.getPlayerStats(numericId);
    }

    /**
     * Get playerStats by team
     * @param {number} team - Numeric team value (from enums.team)
     * @returns {Object|null} The playerStats component for that team
     */
    getPlayerStatsByTeam(team) {
        const playerEntities = this.game.getEntitiesWith('playerStats');
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.team === team) {
                return stats;
            }
        }
        return null;
    }

    /**
     * Get all player entities
     * @returns {Array} Array of player entity IDs
     */
    getPlayerEntities() {
        return this.game.getEntitiesWith('playerStats');
    }

    /**
     * Get serialized player entities for network sync
     * @returns {Array} Array of { entityId, playerStats } objects
     */
    getSerializedPlayerEntities() {
        const playerEntityIds = this.game.getEntitiesWith('playerStats');
        const serialized = [];
        for (const entityId of playerEntityIds) {
            const playerStats = this.game.getComponent(entityId, 'playerStats');
            if (playerStats) {
                serialized.push({
                    entityId,
                    playerStats: JSON.parse(JSON.stringify(playerStats))
                });
            }
        }
        return serialized;
    }

    /**
     * Get gold for the local player
     * @returns {number} Gold amount
     */
    getPlayerGold() {
        const stats = this.getLocalPlayerStats();
        return stats?.gold ?? 0;
    }

    /**
     * Check if local player can afford a cost
     * @param {number} cost - The cost to check
     * @returns {boolean} Whether player can afford
     */
    canAffordCost(cost) {
        const stats = this.getLocalPlayerStats();
        return stats && stats.gold >= cost;
    }

    /**
     * Add gold to a player by team
     * @param {number} team - Numeric team value (from enums.team)
     * @param {number} amount - Gold to add
     */
    addPlayerGold(team, amount) {
        const stats = this.getPlayerStatsByTeam(team);
        if (stats) {
            stats.gold = (stats.gold || 0) + amount;
        }
    }

    /**
     * Deduct gold from the local player
     * @param {number} amount - Gold to deduct
     * @returns {boolean} Whether deduction succeeded
     */
    deductPlayerGold(amount) {
        const stats = this.getLocalPlayerStats();
        if (stats && stats.gold >= amount) {
            stats.gold -= amount;
            return true;
        }
        return false;
    }

    /**
     * Create a player entity with playerStats component
     * @param {string} socketPlayerId - The player's socket ID (server converts to numeric)
     * @param {Object} statsData - Initial stats data (team should be numeric)
     * @returns {number} The created entity ID (numeric)
     */
    createPlayerEntity(socketPlayerId, statsData) {
        // Convert socket ID to numeric for ECS storage
        let numericId = socketPlayerId;
        if (typeof socketPlayerId === 'string' && this.game.room) {
            numericId = this.game.room.getNumericPlayerId(socketPlayerId);
        }

        // Check if player entity already exists
        let entityId = this.getPlayerEntityId(numericId);

        if (entityId === null) {
            // Create new entity with numeric ID
            entityId = this.game.createEntity();
        }

        // Add or update playerStats component
        if (!this.game.hasComponent(entityId, 'playerStats')) {
            this.game.addComponent(entityId, 'playerStats', {
                playerId: numericId,
                team: statsData.team ?? this.enums.team.left,
                gold: statsData.gold || 0,
                upgrades: statsData.upgrades || []
            });
        } else {
            // Update existing stats
            const stats = this.game.getComponent(entityId, 'playerStats');
            stats.team = statsData.team ?? stats.team;
            stats.gold = statsData.gold ?? stats.gold;
            stats.upgrades = statsData.upgrades || stats.upgrades;
        }

        return entityId;
    }
}
