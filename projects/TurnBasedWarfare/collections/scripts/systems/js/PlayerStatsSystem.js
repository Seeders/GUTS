class PlayerStatsSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.playerStatsSystem = this;
    }

    init() {
        // Initialize enums
        // Register service functions
        this.game.register('getPlayerEntityId', this.getPlayerEntityId.bind(this));
        this.game.register('getPlayerStats', this.getPlayerStats.bind(this));
        this.game.register('getLocalPlayerStats', this.getLocalPlayerStats.bind(this));
        this.game.register('getPlayerStatsByTeam', this.getPlayerStatsByTeam.bind(this));
        this.game.register('getPlayerEntities', this.getPlayerEntities.bind(this));
        this.game.register('getSerializedPlayerEntities', this.getSerializedPlayerEntities.bind(this));
        this.game.register('getPlayerGold', this.getPlayerGold.bind(this));
        this.game.register('addPlayerGold', this.addPlayerGold.bind(this));
        this.game.register('deductPlayerGold', this.deductPlayerGold.bind(this));
        this.game.register('canAffordCost', this.canAffordCost.bind(this));
        this.game.register('createPlayerEntity', this.createPlayerEntity.bind(this));
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
            if (stats && stats.side === team) {
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
                side: statsData.team ?? this.enums.team.left,
                gold: statsData.gold || 0,
                upgrades: statsData.upgrades || []
            });
        } else {
            // Update existing stats
            const stats = this.game.getComponent(entityId, 'playerStats');
            stats.side = statsData.team ?? stats.side;
            stats.gold = statsData.gold ?? stats.gold;
            stats.upgrades = statsData.upgrades || stats.upgrades;
        }

        return entityId;
    }
}
