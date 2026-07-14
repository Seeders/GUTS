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
    // Commander HP varies by specialist (Mechabellum: starting HP = base +
    // specialist HP) — the stronger/more scalable the perk, the LESS HP it
    // brings, so weak or situational picks are compensated.
    static LEADERS = [
        { id: 'supply',      label: 'Supply Specialist',       archetype: 'int', hp: 3000,
          bonus: '+50 supply every round' },
        { id: 'quickSupply', label: 'Quick Supply Specialist', archetype: 'int', hp: 4000,
          bonus: '+200 extra supply in round 1' },
        { id: 'costControl', label: 'Cost Control Specialist', archetype: 'int', hp: 3200,
          bonus: '+100 supply every round, but all units -13% damage and HP',
          allUnits: true, mods: { damage: { pct: -0.13 }, maxHP: { pct: -0.13 } } },
        { id: 'heavyArmor',  label: 'Heavy Armor Specialist',  archetype: 'str', hp: 3500,
          bonus: 'All units +17% HP',
          allUnits: true, mods: { maxHP: { pct: 0.17 } } },
        { id: 'speed',       label: 'Speed Specialist',        archetype: 'dex', hp: 3500,
          bonus: 'All units +15% move speed',
          allUnits: true, speedPct: 0.15 },
        { id: 'giant',       label: 'Giant Specialist',        archetype: 'str', hp: 3300,
          bonus: 'Tier 3 and 4 units unlock for free' },
        { id: 'sniper',      label: 'Marksman Specialist',     archetype: 'dex', hp: 3800,
          bonus: 'Start with a free level-3 Crossbowman' },
        { id: 'golem',       label: 'Golem Specialist',        archetype: 'str', hp: 3650,
          bonus: 'A free level-2 Stone Golem arrives on round 4' },
        { id: 'aerial',      label: 'Aerial Specialist',       archetype: 'int', hp: 3650,
          bonus: 'Flying units unlock for free and gain +15 range' }
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
        if (!def) return;

        // Mechabellum specialists apply to EVERY unit (allUnits); legacy
        // archetype-gated defs still work if data reintroduces them.
        if (def.mods && (def.allUnits || (def.archetype && this._heroHasArchetype(entityId, def.archetype)))) {
            this._applyStatMods(
                this.game.getComponent(entityId, 'combat'),
                this.game.getComponent(entityId, 'health'),
                def.mods
            );
        }
        if (def.speedPct) {
            const vel = this.game.getComponent(entityId, 'velocity');
            if (vel?.maxSpeed) vel.maxSpeed *= 1 + def.speedPct;
        }
        // Aerial Specialist: flyers shoot a little farther.
        if (def.id === 'aerial') {
            const unitDef = this.game.getUnitTypeDef(this.game.getComponent(entityId, 'unitType'));
            const combat = this.game.getComponent(entityId, 'combat');
            if (unitDef?.isFlying && combat?.range) combat.range += 15;
        }
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
    // ArmyShopSystem._applyStatMods so leader + upgrade bonuses behave identically —
    // including skipping the `.pct` of the damage/speed fields, which are owned by
    // StatAggregationSystem's tagged pipeline so they reach spells too.
    _applyStatMods(combat, health, mods) {
        this.game.statAggregationSystem?.invalidateModifierCache();

        const pipelinePct = GUTS.StatAggregationSystem.PIPELINE_PCT_FIELDS;
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
            const pct = pipelinePct.has(field) ? 0 : (spec.pct || 0);
            const base = combat[field] || 0;
            combat[field] = base + (spec.add || 0) + base * pct;
        }
    }

    // The leader's unbaked stat package for this hero — StatAggregationSystem reads
    // it to build the tagged damage/speed modifiers. Same gate as applyLeaderBonuses.
    getEntityGrants(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info) return null;
        const stats = this._statsByPlayerId(info.playerId);
        const def = this.getLeaderDef(stats?.leaderId);
        if (!def?.mods) return null;
        if (!def.allUnits && !(def.archetype && this._heroHasArchetype(entityId, def.archetype))) {
            return null;
        }
        return {
            statModifiers: def.mods,
            damageModifiers: def.damageModifiers || [],
            speedModifiers: def.speedModifiers || []
        };
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
