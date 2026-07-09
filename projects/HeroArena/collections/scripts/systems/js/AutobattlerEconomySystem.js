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
        'getLeaderDef',
        'shouldGrantNodeIncome'
    ];

    // Mechabellum supply numbers. Income is 200 × round (200, 400, 600...): round 1
    // buys exactly 2 tier-1 squads, and economies steepen every round.
    static INCOME_PER_ROUND_STEP = 200;
    static SUPPLY_SPECIALIST_GOLD = 50;     // +50 supply/round
    static COST_CONTROL_GOLD      = 100;    // +100 supply/round (units pay for it)
    static QUICK_SUPPLY_GOLD      = 200;    // +200 supply in round 1

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
            // Campaign: income = 14 x node depth, granted once per node so a
            // replayed (lost) node can't be farmed; the enemy shell gets none.
            const campaign = this.game.campaignRunSystem?.isCampaignMode?.();
            if (campaign) {
                if (stats.playerId !== 0) { stats.gold = 0; continue; }
                if (!this.call.shouldGrantNodeIncome?.()) continue;
                stats.gold = (stats.gold || 0)
                    + AutobattlerEconomySystem.INCOME_PER_ROUND_STEP * round;
                continue;
            }

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
            // Interest: +SUPPLY_PER_GOLD per `interestPer` banked, capped (rewards
            // saving). Both threshold and cap are already in supply, so the raw
            // count of thresholds crossed is scaled up to a supply payout.
            if (eff.interestPer > 0 && eff.interestCap > 0) {
                const F = GUTS.ArmyShopSystem.SUPPLY_PER_GOLD;
                gold += Math.floor(Math.min(Math.floor(gold / eff.interestPer) * F, eff.interestCap));
            }
            // Streak gold (only if unlocked in the Momentum branch).
            gold += (stats.winStreak  || 0) * (eff.winStreakGold  || 0);
            gold += (stats.lossStreak || 0) * (eff.lossStreakGold || 0);
            // Flat income upgrade.
            gold += eff.flatIncome || 0;
            // Recurring income from economy reinforcement cards (stacks).
            gold += stats.bonusIncome || 0;
            // Repay any Town Hall loan taken last round (Mechabellum: 300 back for
            // 200 borrowed). Can drive the purse negative-ish; floor at 0.
            if (stats.loanDebt) { gold -= stats.loanDebt; stats.loanDebt = 0; }

            stats.gold = Math.max(0, gold);
        }
    }
}
