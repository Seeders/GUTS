// Drives the autobattler gold economy. A deterministic starting purse funds an opening
// army (you start with only a free building now, no free hero), then a flat income is
// granted each subsequent round. No interest or streak bonuses. Gold carries forward
// between rounds.
//
// Round 1 SETS the purse (rather than adding) so it's deterministic regardless of
// whatever starting gold the lobby/scene config seeded — this system is the single
// source of truth for autobattler gold.
class AutobattlerEconomySystem extends GUTS.BaseSystem {

    static services = [
        'grantRoundIncome'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'getEconomyEffects',
        'getLeaderDef'
    ];

    // Mechabellum scale: 200 starting supply / 100-cost chaff = 2 squads in
    // round 1. Our tier-1 squad is 7g, so 14g start and a flat 14g per round
    // (Mechabellum's base income is flat; growth comes from upgrades/cards).
    static STARTING_GOLD = 14;
    static ROUND_INCOME  = 14;
    static INCOME_ESCALATION = 0;
    static ALCHEMIST_GOLD = 5;   // The Alchemist leader: flat bonus gold each round

    constructor(game) {
        super(game);
        this.game.autobattlerEconomySystem = this;
    }

    // Called by AutobattlerRoundSystem at the start of every prep phase.
    // Round 1 SETS the purse; later rounds ADD flat income plus the economic bonuses
    // unlocked through the Town Hall economy tree (interest, win/loss-streak gold, flat
    // income) and the two gold leaders (Alchemist, Warlord). Streaks are current here:
    // _updateStreaks runs in resolveRound before this next startPrep.
    grantRoundIncome() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const round = this.game.state?.round || 1;
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (round <= 1) {
                stats.gold = AutobattlerEconomySystem.STARTING_GOLD;
                continue;
            }

            let gold = (stats.gold || 0) + AutobattlerEconomySystem.ROUND_INCOME
                + round * AutobattlerEconomySystem.INCOME_ESCALATION;

            const eff = this.call.getEconomyEffects?.(stats) || {};
            // Interest: +1 per `interestPer` banked, capped (rewards saving).
            if (eff.interestPer > 0 && eff.interestCap > 0) {
                gold += Math.min(Math.floor(gold / eff.interestPer), eff.interestCap);
            }
            // Streak gold (only if unlocked in the Momentum branch).
            gold += (stats.winStreak  || 0) * (eff.winStreakGold  || 0);
            gold += (stats.lossStreak || 0) * (eff.lossStreakGold || 0);
            // Flat income upgrade.
            gold += eff.flatIncome || 0;

            // Gold leaders.
            const leader = this.call.getLeaderDef?.(stats.leaderId);
            if (leader?.id === 'alchemist') gold += AutobattlerEconomySystem.ALCHEMIST_GOLD;
            if (leader?.id === 'warlord')   gold += (stats.winStreak || 0);

            stats.gold = gold;
        }
    }
}
