// Manages loot drops between rounds.
// After each battle the server generates item offers per player, broadcasts them,
// and waits for each player to claim one item before advancing.
// Items live on playerStats.inventory as plain objects.
class LootDropSystem extends GUTS.BaseSystem {

    static services = [
        'dropLootForRound',
        'claimLootItem',
        'skipLoot'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'broadcastToRoom',
        'sendToPlayer',
        'generateItem'
    ];

    // Items offered per player per round (min/max scales with round number)
    static OFFER_COUNT = 4;
    // How many items a player may keep per round
    static CLAIM_COUNT = 1;

    constructor(game) {
        super(game);
        this.game.lootDropSystem = this;
        // { numericPlayerId: { offers: item[], claimed: boolean } }
        this.pendingOffers = {};
    }

    // ─── Server-side: called by AutobattlerRoundSystem before prep phase ─────

    dropLootForRound(round) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.pendingOffers = {};

        const dropLevel = Math.min(20, round);
        const playerEntities = this.call.getPlayerEntities();

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;

            const offers = this._generateOffers(dropLevel);

            // Auto-claim: push every dropped item directly to the player's inventory.
            // No picker UI — players see new items in their inventory and equip from there.
            if (!Array.isArray(stats.inventory)) stats.inventory = [];
            for (const item of offers) {
                stats.inventory.push(item);
            }

            // Mark as resolved so any old `allPlayersResolved()` callers still work
            this.pendingOffers[stats.playerId] = { offers, claimed: true };

            // Notify the player so the client UI can flash/highlight the new drops
            this.call.sendToPlayer(stats.playerId, 'LOOT_DROPPED', { round, items: offers });
        }
    }

    // Called by ServerNetworkSystem when a player picks an item.
    // itemIndex: index into that player's offers array.
    claimLootItem(numericPlayerId, itemIndex) {
        if (!this.game.isServer) return { success: false };

        const playerData = this.pendingOffers[numericPlayerId];
        if (!playerData) return { success: false, reason: 'no_offers' };
        if (playerData.claimed) return { success: false, reason: 'already_claimed' };

        const item = playerData.offers[itemIndex];
        if (!item) return { success: false, reason: 'invalid_index' };

        // Add to inventory
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) {
                if (!Array.isArray(stats.inventory)) stats.inventory = [];
                stats.inventory.push(item);
                break;
            }
        }

        playerData.claimed = true;
        return { success: true, item };
    }

    // Player skips loot — just marks them as done without taking anything.
    skipLoot(numericPlayerId) {
        if (!this.game.isServer) return { success: false };
        const playerData = this.pendingOffers[numericPlayerId];
        if (!playerData) return { success: false };
        playerData.claimed = true;
        return { success: true };
    }

    // True once every player has claimed or skipped.
    allPlayersResolved() {
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const data = this.pendingOffers[stats.playerId];
            if (!data || !data.claimed) return false;
        }
        return true;
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    _generateOffers(dropLevel) {
        // Fixed offer pattern: weapon, bodyArmor, gem, rune
        // Gives players one of each category each round so every slot can progress
        const pattern = ['weapon', 'bodyArmor', 'gem', 'rune'];
        const offers  = [];
        for (let i = 0; i < LootDropSystem.OFFER_COUNT; i++) {
            offers.push(this.call.generateItem({ itemType: pattern[i], dropLevel }));
        }
        return offers;
    }
}
