// Manages leader selection and applies each leader's passive bonus to the party.
// Stat bonuses are applied per-hero at spawn (see applyLeaderBonuses, called from
// HeroRosterSystem._tagHeroEntity). The two gold leaders (Alchemist, Warlord) are
// resolved in AutobattlerEconomySystem.grantRoundIncome instead, since their effect
// is income, not a per-hero stat.
class LeaderSystem extends GUTS.BaseSystem {

    static services = [
        'selectLeader',
        'getLeaderDef',
        'applyLeaderBonuses'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    // Leader definitions. `archetype` + `mods` drive per-hero stat bonuses applied at
    // spawn; leaders with neither (alchemist/warlord) are gold effects handled by the
    // economy system. mods spec mirrors ArmyShopSystem upgrade statModifiers:
    // { <combatField>: { add?, pct? } }, with maxHP routed to the health component.
    static LEADERS = [
        { id: 'commander', label: 'The Commander', bonus: '+10% HP to STR heroes',
          archetype: 'str', mods: { maxHP: { pct: 0.10 } } },
        { id: 'alchemist', label: 'The Alchemist', bonus: '+5 gold each round' },
        { id: 'warlord',   label: 'The Warlord',   bonus: '+1 gold per win streak' },
        { id: 'scholar',   label: 'The Scholar',   bonus: '+15% damage to INT heroes',
          archetype: 'int', mods: { damage: { pct: 0.15 } } },
        { id: 'ranger',    label: 'The Ranger',    bonus: '+15% damage to DEX heroes',
          archetype: 'dex', mods: { damage: { pct: 0.15 } } },
        { id: 'trickster', label: 'The Trickster', bonus: '+10 evasion to DEX heroes',
          archetype: 'dex', mods: { evasion: { add: 10 } } }
    ];

    constructor(game) {
        super(game);
        this.game.leaderSystem = this;
    }

    // Called when a player picks their leader. Stores leaderId on playerStats.
    selectLeader(numericPlayerId, leaderId) {
        const leaderDef = this.getLeaderDef(leaderId);
        if (!leaderDef) return { success: false, reason: 'invalid_leader' };

        const stats = this._statsByPlayerId(numericPlayerId);
        if (!stats) return { success: false, reason: 'player_not_found' };
        stats.leaderId = leaderId;
        return { success: true };
    }

    getLeaderDef(leaderId) {
        return LeaderSystem.LEADERS.find(l => l.id === leaderId) || null;
    }

    // Apply the player's leader stat bonus to a freshly spawned hero entity, if the
    // hero's archetype matches. Called by HeroRosterSystem at spawn (after upgrades),
    // so it composes with level scaling / upgrades on the same combat/health values.
    applyLeaderBonuses(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info) return;
        const stats = this._statsByPlayerId(info.playerId);
        const def = this.getLeaderDef(stats?.leaderId);
        if (!def?.mods || !def.archetype) return;   // gold leaders / no leader → nothing here

        if (!this._heroHasArchetype(entityId, def.archetype)) return;
        this._applyStatMods(
            this.game.getComponent(entityId, 'combat'),
            this.game.getComponent(entityId, 'health'),
            def.mods
        );
    }

    // A hero "is" an archetype when its unit def has that attribute > 0. Dual-stat
    // units (e.g. acolyte = STR+INT) match both — same rule ArmyShopSystem uses.
    _heroHasArchetype(entityId, archetype) {
        const def = this.game.getUnitTypeDef?.(this.game.getComponent(entityId, 'unitType')) || {};
        if (archetype === 'str') return (def.strength || 0) > 0;
        if (archetype === 'dex') return (def.dexterity || 0) > 0;
        if (archetype === 'int') return (def.intelligence || 0) > 0;
        return false;
    }

    // statModifiers: { <field>: { add?, pct? } }. maxHP maps to health (preserving the
    // current/max ratio); everything else maps to the combat component. Mirrors
    // ArmyShopSystem._applyStatMods so leader + upgrade bonuses behave identically.
    _applyStatMods(combat, health, mods) {
        for (const [field, spec] of Object.entries(mods || {})) {
            if (field === 'maxHP') {
                if (!health) continue;
                const base = health.max || 0;
                const v = base + (spec.add || 0) + base * (spec.pct || 0);
                const ratio = health.max ? (health.current / health.max) : 1;
                health.max = v;
                health.current = Math.round(v * ratio);
                continue;
            }
            if (!combat) continue;
            const base = combat[field] || 0;
            combat[field] = base + (spec.add || 0) + base * (spec.pct || 0);
        }
    }

    _statsByPlayerId(numericPlayerId) {
        if (numericPlayerId == null) return null;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }
}
