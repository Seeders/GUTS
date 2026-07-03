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

    // Mechabellum scale: 200 supply ≈ 14g. Income is 200 x round (200, 400,
    // 600...), so at our scale each round grants 14g x round number — round 1
    // buys exactly 2 tier-1 squads, and economies steepen every round.
    static INCOME_PER_ROUND_STEP = 14;
    static SUPPLY_SPECIALIST_GOLD = 4;      // +50 supply/round at our scale
    static COST_CONTROL_GOLD      = 7;      // +100 supply/round (units pay for it)
    static QUICK_SUPPLY_GOLD      = 14;     // +200 supply in round 1

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
            let income = AutobattlerEconomySystem.INCOME_PER_ROUND_STEP * round;
            const leaderDef = this.call.getLeaderDef?.(stats.leaderId);
            if (leaderDef?.id === 'supply')      income += AutobattlerEconomySystem.SUPPLY_SPECIALIST_GOLD;
            if (leaderDef?.id === 'costControl') income += AutobattlerEconomySystem.COST_CONTROL_GOLD;
            if (leaderDef?.id === 'quickSupply' && round <= 1) income += AutobattlerEconomySystem.QUICK_SUPPLY_GOLD;
            if (round <= 1) {
                stats.gold = income;   // round 1 SETS the purse (deterministic)
                continue;
            }

            let gold = (stats.gold || 0) + income;

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

            stats.gold = gold;
        }
    }
}
