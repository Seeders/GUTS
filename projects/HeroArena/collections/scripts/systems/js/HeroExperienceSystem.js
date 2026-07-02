// Unit experience and leveling — the Mechabellum model. SERVER-AUTHORITATIVE.
//
// • XP: earned by KILLING. The killer takes 50% of the victim's XP worth
//   (cost × (2·level−1)); nearby allies split the rest; indirect kills split
//   the full worth across the side. XP lives on the persistent roster entry.
// • Leveling is ALWAYS a purchase (ArmyShopSystem.buySquadLevel): a full XP
//   bar never auto-levels — it earns the right to promote at HALF price.
//   Bars steepen per rank (XP_THRESHOLD_CHAIN) and cap at MAX_LEVEL.
// • Ranks are transformative: HP and damage are multiplied by the level
//   (applyLevelScaling), and surviving squads deal commander damage scaled
//   the same way.
// • (Legacy) tier-2 specialization machinery remains below but the redesign
//   no longer calls processSpecializations — promotion is a unit tech now.
class HeroExperienceSystem extends GUTS.BaseSystem {

    static services = [
        'processSpecializations',
        'applySpecializationChoice',
        'applyLevelScaling',
        'getEntryLevel'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'getHeroEntityId',
        'respawnRosterEntry',
        'broadcastToRoom'
    ];

    // Mechabellum cap: level 9.
    static MAX_LEVEL = 9;

    // XP-bar size per level, as multiples of the unit's shop cost. Mechabellum's
    // published progression: second rank +122%, then +32%, +17%, +11%, +8%,
    // +6%, +5%. (Cumulative products of those increases; 8 bars -> level 9.)
    static XP_THRESHOLD_CHAIN = [1.0, 2.22, 2.93, 3.43, 3.81, 4.11, 4.36, 4.58];
    static SPEC_LEVEL = 3;           // tier-1 → tier-2 transform unlocks here
    static AI_PLAYER_ID = 1;

    constructor(game) {
        super(game);
        this.game.heroExperienceSystem = this;
    }

    // ─── Combat XP (Mechabellum model) ────────────────────────────────────────
    //
    // Units earn experience BY KILLING (not by merely surviving):
    // - The killer (victim's combatState.lastAttacker) gets 50% of the victim's
    //   XP worth; living allies near the victim split the other 50%.
    // - No valid killer (indirect death) → the worth splits among ALL of the
    //   killing side's living units.
    // - A victim's worth scales with its value and level: cost × (2·level − 1).
    // - Earned levels stack with paid level-ups (ArmyShopSystem.buySquadLevel);
    //   the threshold mirrors the paid price (cost × level, in kill-value),
    //   so a rank is "earned" by destroying about what it would cost to buy.
    // Feeding kills to a carry is a real strategy; stat scaling applies on the
    // next round's respawn.
    static PARTICIPATION_RADIUS = 220;

    onUnitKilled(deadEntityId) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const deadTeam = this.game.getComponent(deadEntityId, 'team')?.team;
        if (deadTeam == null) return;

        const worth = this._victimWorth(deadEntityId);
        if (worth <= 0) return;

        // Killer: the victim's last attacker, if it's a living enemy roster unit
        let killer = this.game.getComponent(deadEntityId, 'combatState')?.lastAttacker;
        if (killer != null && !this._isEligibleGainer(killer, deadTeam)) killer = null;

        // Participants: living enemy roster units near the victim (excluding the killer)
        const deadPos = this.game.getComponent(deadEntityId, 'transform')?.position;
        const participants = [];
        const allSide = [];
        for (const eid of (this.game.getEntitiesWith?.('heroRosterInfo', 'health') || [])) {
            if (eid === deadEntityId || !this._isEligibleGainer(eid, deadTeam)) continue;
            allSide.push(eid);
            if (eid === killer || !deadPos) continue;
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            const dx = pos.x - deadPos.x, dz = pos.z - deadPos.z;
            if (dx * dx + dz * dz <= HeroExperienceSystem.PARTICIPATION_RADIUS ** 2) {
                participants.push(eid);
            }
        }

        if (killer != null) {
            this._awardXp(killer, worth * 0.5);
            const share = participants.length ? (worth * 0.5) / participants.length : 0;
            for (const eid of participants) this._awardXp(eid, share);
        } else if (allSide.length) {
            // Indirect kill: split the full worth across the side
            const share = worth / allSide.length;
            for (const eid of allSide) this._awardXp(eid, share);
        }
    }

    // Victim's XP worth: shop-cost scale × (2·level − 1), Mechabellum-style.
    _victimWorth(deadEntityId) {
        const unitTypeComp = this.game.getComponent(deadEntityId, 'unitType');
        const def = this.game.getUnitTypeDef?.(unitTypeComp);
        const cost = Math.max(1, Math.ceil((def?.value || 25) / 5));
        const level = this.game.getComponent(deadEntityId, 'heroRosterInfo')?.level || 1;
        return cost * (2 * level - 1);
    }

    // Living roster unit on the opposite team of the victim.
    _isEligibleGainer(eid, deadTeam) {
        if (!this.game.getComponent(eid, 'heroRosterInfo')) return false;
        const team = this.game.getComponent(eid, 'team')?.team;
        if (team == null || team === deadTeam) return false;
        const health = this.game.getComponent(eid, 'health');
        if (!health || health.current <= 0) return false;
        const ds = this.game.getComponent(eid, 'deathState');
        return !ds || ds.state === this.enums.deathState.alive;
    }

    // XP NEVER levels a unit by itself (true Mechabellum): a full bar earns the
    // right to buy the next rank at HALF price (ArmyShopSystem.squadLevelCost).
    // The bar caps at its threshold — overkill XP is not banked toward later ranks.
    _awardXp(entityId, amount) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info || amount <= 0) return;
        const stats = this._statsByPlayerId(info.playerId);
        const entry = stats?.heroRoster?.[info.rosterIndex];
        if (!entry) return;
        if ((entry.level || 1) >= HeroExperienceSystem.MAX_LEVEL) return;

        const threshold = this.xpToNextLevel(entry);
        const wasFull = (entry.xp || 0) >= threshold;
        entry.xp = Math.min(threshold, (entry.xp || 0) + amount);

        if (!wasFull && entry.xp >= threshold) {
            this.game.triggerEvent('onSquadLevelReady', {
                entityId, playerId: info.playerId, rosterIndex: info.rosterIndex,
                level: entry.level || 1
            });
        }
    }

    // The XP bar for this entry's NEXT rank: unit shop cost × the Mechabellum
    // threshold chain (steepens hard after the first rank).
    xpToNextLevel(entry) {
        const def = this.collections.units?.[entry?.spawnType] || {};
        const cost = Math.max(1, Math.ceil((def.value || 25) / 5));
        const chain = HeroExperienceSystem.XP_THRESHOLD_CHAIN;
        const idx = Math.min(chain.length - 1, Math.max(0, (entry?.level || 1) - 1));
        return Math.ceil(cost * chain[idx]);
    }

    // Full XP bar → next rank is half price.
    isLevelReady(entry) {
        if (!entry || (entry.level || 1) >= HeroExperienceSystem.MAX_LEVEL) return false;
        return (entry.xp || 0) >= this.xpToNextLevel(entry);
    }

    // ─── Level helpers ────────────────────────────────────────────────────────

    // entry.level is mutated directly by both level sources (combat XP in
    // _awardXp, gold in ArmyShopSystem.buySquadLevel) — it is the truth.
    getEntryLevel(entry) {
        return entry?.level || 1;
    }

    // Apply per-level stat scaling to a freshly spawned unit. Called by
    // HeroRosterSystem after it sets heroRosterInfo.level.
    // Mechabellum stat scaling: a unit's HP and damage are MULTIPLIED BY ITS
    // LEVEL (rank 2 = 2× base, rank 3 = 3×...). Ranks are transformative — the
    // counterpart of their steep price.
    applyLevelScaling(entityId) {
        const level = this.game.getComponent(entityId, 'heroRosterInfo')?.level || 1;
        if (level <= 1) return;
        const mult = level;
        const combat = this.game.getComponent(entityId, 'combat');
        if (combat && combat.damage) combat.damage = Math.round(combat.damage * mult);
        const health = this.game.getComponent(entityId, 'health');
        if (health && health.max) {
            const ratio = health.current / health.max;
            health.max = Math.round(health.max * mult);
            health.current = Math.round(health.max * ratio);
        }
    }

    // ─── Specialization ───────────────────────────────────────────────────────

    // Called by AutobattlerRoundSystem.startPrep (after units spawn). Finds
    // roster entries eligible to specialize; AI auto-picks, human is prompted.
    processSpecializations() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const pending = this._pendingSpecIndices(stats);
            if (pending.length === 0) continue;

            if (stats.playerId === HeroExperienceSystem.AI_PLAYER_ID && this.game.state?.isLocalGame) {
                // AI: auto-pick a random valid specialization for each pending unit.
                for (const idx of pending) {
                    const opts = this._specOptions(stats.heroRoster[idx]);
                    if (opts.length) {
                        const pick = opts[Math.floor(Math.random() * opts.length)];
                        this._applyChoice(stats, idx, pick.id);
                    }
                }
            } else {
                // Human: queue choices and prompt for the first one.
                stats.pendingSpecs = pending.slice();
                this._emitSpecChoice(stats);
            }
        }
    }

    // Called by ServerNetworkSystem on a SPECIALIZE_CHOICE event.
    applySpecializationChoice(numericPlayerId, rosterIndex, chosenSpawnType) {
        const stats = this._statsByPlayerId(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_index' };
        const valid = this._specOptions(entry).some(o => o.id === chosenSpawnType);
        if (!valid) return { success: false, reason: 'invalid_choice' };

        this._applyChoice(stats, rosterIndex, chosenSpawnType);

        // Remove from the pending queue and prompt the next one (if any).
        stats.pendingSpecs = (stats.pendingSpecs || []).filter(i => i !== rosterIndex);
        if (stats.pendingSpecs.length > 0) this._emitSpecChoice(stats);

        return { success: true, done: stats.pendingSpecs.length === 0 };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _applyChoice(stats, rosterIndex, chosenSpawnType) {
        const entry = stats.heroRoster[rosterIndex];
        entry.spawnType = chosenSpawnType;
        entry.specialized = true;
        // Re-spawn the live unit as its new tier-2 form for the current prep.
        this.call.respawnRosterEntry(stats.playerId, rosterIndex);
    }

    _pendingSpecIndices(stats) {
        const out = [];
        const roster = stats.heroRoster || [];
        for (let i = 0; i < roster.length; i++) {
            const entry = roster[i];
            if (!entry || entry.specialized) continue;
            if (this.getEntryLevel(entry) < HeroExperienceSystem.SPEC_LEVEL) continue;
            if (this._specOptions(entry).length > 0) out.push(i);
        }
        return out;
    }

    // The tier-2 options for a roster entry (from its unit def's specUnits).
    _specOptions(entry) {
        const def = this.collections.units?.[entry?.spawnType] || {};
        const specs = def.specUnits || [];
        return specs
            .filter(id => this.collections.units?.[id])
            .map(id => ({ id, title: this.collections.units[id].title || id }));
    }

    _emitSpecChoice(stats) {
        const rosterIndex = stats.pendingSpecs?.[0];
        if (rosterIndex == null) return;
        const entry = stats.heroRoster[rosterIndex];
        const payload = {
            playerId: stats.playerId,
            rosterIndex,
            currentTitle: this.collections.units?.[entry.spawnType]?.title || entry.spawnType,
            level: this.getEntryLevel(entry),
            options: this._specOptions(entry)
        };
        // Broadcast to the room; the client filters by playerId (onSpecializeSelectStart).
        // (Numeric playerId can't be used with sendToPlayer's socket-id addressing.)
        if (this.game.hasService?.('broadcastToRoom')) {
            this.call.broadcastToRoom(null, 'SPECIALIZE_SELECT', payload);
        }
        this.game.triggerEvent?.('onSpecializeSelectStart', payload);
    }

    _statsByPlayerId(numericPlayerId) {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }
}
