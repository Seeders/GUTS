// Grants passive gold income to both players at the start of each prep phase.
// Income formula (same round for both players):
//   Base:        5g
//   Interest:    floor(current_gold / 10), capped at 5g
//   Win streak:  0/0/1/1/2/2/3 for streak 0/1/2/3/4/5/6+
//   Loss streak: 0/0/1/1/2  for streak 0/1/2/3/4+
class AutobattlerEconomySystem extends GUTS.BaseSystem {

    static services = [
        'grantRoundIncome'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    static BASE_INCOME = 5;
    static MAX_INTEREST = 5;

    // Win streak bonuses indexed by streak length (capped at last entry)
    static WIN_STREAK_BONUS  = [0, 0, 1, 1, 2, 2, 3];
    // Loss streak bonuses indexed by streak length (capped at last entry)
    static LOSS_STREAK_BONUS = [0, 0, 1, 1, 2];

    constructor(game) {
        super(game);
        this.game.autobattlerEconomySystem = this;
    }

    // Called by AutobattlerRoundSystem at the start of every prep phase.
    grantRoundIncome() {
        if (!this.game.isServer) return;
        const playerEntities = this.call.getPlayerEntities();

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;

            const income = this._calculateIncome(stats);
            stats.gold = (stats.gold || 0) + income;
        }
    }

    _calculateIncome(stats) {
        const base     = AutobattlerEconomySystem.BASE_INCOME;
        const interest = Math.min(
            AutobattlerEconomySystem.MAX_INTEREST,
            Math.floor((stats.gold || 0) / 10)
        );
        const winBonus  = this._streakBonus(stats.winStreak  || 0, AutobattlerEconomySystem.WIN_STREAK_BONUS);
        const lossBonus = this._streakBonus(stats.lossStreak || 0, AutobattlerEconomySystem.LOSS_STREAK_BONUS);
        return base + interest + winBonus + lossBonus;
    }

    _streakBonus(streak, table) {
        const idx = Math.min(streak, table.length - 1);
        return table[idx];
    }
}
