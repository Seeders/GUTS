// DEPRECATED — replaced by ShopSystem.
// Kept as a no-op so existing service calls / object-type defs still resolve.
// Items now come from the round-start shop, not free loot drops.
class LootDropSystem extends GUTS.BaseSystem {

    static services = [
        'dropLootForRound',
        'claimLootItem',
        'skipLoot'
    ];

    constructor(game) {
        super(game);
        this.game.lootDropSystem = this;
    }

    dropLootForRound() { /* no-op */ }
    claimLootItem()   { return { success: false, reason: 'deprecated' }; }
    skipLoot()        { return { success: false, reason: 'deprecated' }; }
}
