// Grants a fixed 20g income to each player at the start of every prep phase.
// No interest, no streak bonuses — economy is intentionally flat. Leftover gold
// is mostly lost (only 1-2g can carry forward as a shop-upgrade discount);
// see ItemShopSystem.closeShop for the leftover-handling logic.
class AutobattlerEconomySystem extends GUTS.BaseSystem {

    static services = [
        'grantRoundIncome'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    static ROUND_INCOME = 20;

    constructor(game) {
        super(game);
        this.game.autobattlerEconomySystem = this;
    }

    // Called by AutobattlerRoundSystem at the start of every prep phase.
    grantRoundIncome() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            stats.gold = (stats.gold || 0) + AutobattlerEconomySystem.ROUND_INCOME;
        }
    }
}
