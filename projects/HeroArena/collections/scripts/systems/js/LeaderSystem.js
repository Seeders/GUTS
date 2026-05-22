// Manages non-combat leader selection and passive bonus application.
// Phase 1: stores the selection; bonus application is a stub for Phase 2+.
class LeaderSystem extends GUTS.BaseSystem {

    static services = [
        'selectLeader',
        'getLeaderDef',
        'applyLeaderBonuses'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    // Leader definitions — each gives a passive bonus to the player's party.
    // Bonuses are applied in Phase 2; the stubs here document the intended effect.
    static LEADERS = [
        { id: 'commander',   label: 'The Commander',  bonus: '+10% HP to all STR heroes' },
        { id: 'alchemist',   label: 'The Alchemist',  bonus: 'Crafting orb costs reduced by 1g' },
        { id: 'warlord',     label: 'The Warlord',    bonus: 'Win streaks grant +1 bonus gold' },
        { id: 'scholar',     label: 'The Scholar',    bonus: '+15% spell damage to INT heroes' },
        { id: 'ranger',      label: 'The Ranger',     bonus: 'Items found have +20% chance to be one rarity higher' },
        { id: 'trickster',   label: 'The Trickster',  bonus: 'DEX heroes gain +10% evasion' }
    ];

    constructor(game) {
        super(game);
        this.game.leaderSystem = this;
    }

    // Called when a player picks their leader. Stores leaderId on playerStats.
    selectLeader(numericPlayerId, leaderId) {
        const leaderDef = this.getLeaderDef(leaderId);
        if (!leaderDef) return { success: false, reason: 'invalid_leader' };

        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) {
                stats.leaderId = leaderId;
                return { success: true };
            }
        }
        return { success: false, reason: 'player_not_found' };
    }

    getLeaderDef(leaderId) {
        return LeaderSystem.LEADERS.find(l => l.id === leaderId) || null;
    }

    // Stub: Phase 2 will implement actual stat modifications via HeroStatSystem.
    applyLeaderBonuses(numericPlayerId) {
        // TODO: read leaderId from playerStats, look up bonus, apply to heroes
    }
}
