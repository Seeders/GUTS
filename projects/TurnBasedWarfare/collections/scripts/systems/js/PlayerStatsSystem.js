class PlayerStatsSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.playerStatsSystem = this;
    }

    init() {
        // Register service functions
        this.game.register('getPlayerEntityId', this.getPlayerEntityId.bind(this));
        this.game.register('getPlayerStats', this.getPlayerStats.bind(this));
        this.game.register('getLocalPlayerStats', this.getLocalPlayerStats.bind(this));
        this.game.register('getPlayerStatsBySide', this.getPlayerStatsBySide.bind(this));
        this.game.register('getPlayerEntities', this.getPlayerEntities.bind(this));
        this.game.register('getSerializedPlayerEntities', this.getSerializedPlayerEntities.bind(this));
        this.game.register('getPlayerGold', this.getPlayerGold.bind(this));
        this.game.register('addPlayerGold', this.addPlayerGold.bind(this));
        this.game.register('deductPlayerGold', this.deductPlayerGold.bind(this));
        this.game.register('canAffordCost', this.canAffordCost.bind(this));
        this.game.register('createPlayerEntity', this.createPlayerEntity.bind(this));
    }

    /**
     * Get player entity ID from player/socket ID
     * @param {string} playerId - The player's socket ID
     * @returns {string} The player entity ID
     */
    getPlayerEntityId(playerId) {
        return `player_${playerId}`;
    }

    /**
     * Get playerStats component for a player
     * @param {string} playerId - The player's socket ID
     * @returns {Object|null} The playerStats component or null
     */
    getPlayerStats(playerId) {
        const entityId = this.getPlayerEntityId(playerId);
        return this.game.getComponent(entityId, 'playerStats');
    }

    /**
     * Get playerStats for the local player (client only)
     * @returns {Object|null} The local player's stats or null
     */
    getLocalPlayerStats() {
        const playerId = this.game.state.playerId || this.game.clientNetworkManager?.playerId;
        if (!playerId) return null;
        return this.getPlayerStats(playerId);
    }

    /**
     * Get playerStats by team side
     * @param {string} side - 'left' or 'right'
     * @returns {Object|null} The playerStats component for that side
     */
    getPlayerStatsBySide(side) {
        const playerEntities = this.game.getEntitiesWith('playerStats');
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.side === side) {
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
     * Add gold to a player by side
     * @param {string} side - 'left' or 'right'
     * @param {number} amount - Gold to add
     */
    addPlayerGold(side, amount) {
        const stats = this.getPlayerStatsBySide(side);
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
     * @param {string} playerId - The player's socket ID
     * @param {Object} statsData - Initial stats data
     * @returns {string} The created entity ID
     */
    createPlayerEntity(playerId, statsData) {
        const entityId = this.getPlayerEntityId(playerId);

        if (!this.game.entities.has(entityId)) {
            this.game.createEntity(entityId);
        }

        this.game.addComponent(entityId, 'playerStats', {
            odId: playerId,
            side: statsData.side || 'left',
            gold: statsData.gold || 0,
            upgrades: statsData.upgrades || []
        });

        return entityId;
    }
}
