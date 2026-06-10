// Drives the autobattler gold economy. A small, deterministic starting purse keeps
// round 1 lean (you can afford ~1 extra unit beyond the free starter hero), then a
// flat income is granted each subsequent round. No interest or streak bonuses. Gold
// carries forward between rounds.
//
// Round 1 SETS the purse (rather than adding) so it's deterministic regardless of
// whatever starting gold the lobby/scene config seeded — this system is the single
// source of truth for autobattler gold.
class AutobattlerEconomySystem extends GUTS.BaseSystem {

    static services = [
        'grantRoundIncome'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    static STARTING_GOLD = 10;   // round-1 purse (a tier-1 unit costs ~7)
    static ROUND_INCOME  = 10;   // flat income granted every round after round 1

    constructor(game) {
        super(game);
        this.game.autobattlerEconomySystem = this;
    }

    // Called by AutobattlerRoundSystem at the start of every prep phase.
    grantRoundIncome() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const round = this.game.state?.round || 1;
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (round <= 1) {
                stats.gold = AutobattlerEconomySystem.STARTING_GOLD;
            } else {
                stats.gold = (stats.gold || 0) + AutobattlerEconomySystem.ROUND_INCOME;
            }
        }
    }
}
