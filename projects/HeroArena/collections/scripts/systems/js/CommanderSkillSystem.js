/**
 * CommanderSkillSystem - Single-use commander skills cast at a ground target
 * during battle (Mechabellum-style).
 *
 * Charges are earned from reinforcement cards (stats.skillCharges, max 2
 * banked). Casting consumes the charge, applies the skill's area effect at
 * the target point, and broadcasts the cast for opponent-side visuals.
 * Server-authoritative; skill definitions live in data/commanderSkills.
 */
class CommanderSkillSystem extends GUTS.BaseSystem {
    static services = [
        'castCommanderSkill'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'applyDamage',
        'broadcastToRoom',
        'summonUnitsForTeamAt'
    ];

    constructor(game) {
        super(game);
        this.game.commanderSkillSystem = this;
    }

    init() {}

    castCommanderSkill(numericPlayerId, skillId, x, z) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) {
            return { success: false, reason: 'not_authoritative' };
        }
        if (this.game.state.phase !== this.enums.gamePhase.battle) {
            return { success: false, reason: 'wrong_phase' };
        }

        const stats = this._statsByPlayerId(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };

        const charges = stats.skillCharges || [];
        const chargeIndex = charges.indexOf(skillId);
        if (chargeIndex === -1) return { success: false, reason: 'no_charge' };

        const def = this.collections.commanderSkills?.[skillId];
        if (!def) return { success: false, reason: 'no_skill' };

        charges.splice(chargeIndex, 1);

        this._applySkill(stats, def, x, z);

        const payload = { playerId: numericPlayerId, skillId, x, z };
        this.call.broadcastToRoom(null, 'COMMANDER_SKILL_CAST', payload);
        this.game.triggerEvent('onCommanderSkillCast', payload);

        return { success: true, charges: [...charges] };
    }

    _applySkill(stats, def, x, z) {
        // Summon skills spawn throwaway units for the caster at the target point
        // (Mechabellum "Underground Threat" / "Wasp Swarm") — no area target scan.
        if (def.summon) {
            this.call.summonUnitsForTeamAt?.(
                def.summon.unit, def.summon.count || 3, stats.team, x, z);
            this._playEffect(def, x, z);
            return;
        }

        const radius = def.radius || 120;
        const radiusSq = radius * radius;

        // A nominal damage source: the caster's first living unit (modifier
        // aggregation and combat-log attribution need an entity id).
        let sourceId = null;
        for (const eid of (this.game.getEntitiesWith('heroRosterInfo', 'health') || [])) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            const health = this.game.getComponent(eid, 'health');
            if (info?.playerId === stats.playerId && health?.current > 0) {
                sourceId = eid;
                break;
            }
        }

        for (const eid of (this.game.getEntitiesWith('health', 'team', 'transform') || [])) {
            if (this.game.getComponent(eid, 'buildingOwner')) continue;
            if (this.game.getComponent(eid, 'projectile')) continue;
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            const dx = pos.x - x, dz = pos.z - z;
            if (dx * dx + dz * dz > radiusSq) continue;

            const team = this.game.getComponent(eid, 'team')?.team;
            const health = this.game.getComponent(eid, 'health');
            if (!health || health.current <= 0) continue;

            if (def.healPct) {
                // Heals affect only the caster's own units
                if (team === stats.team) {
                    health.current = Math.min(health.max,
                        health.current + Math.round(health.max * def.healPct));
                }
            } else if (def.damage) {
                // Damage affects only enemies
                if (team !== stats.team && sourceId != null) {
                    const element = this.enums.element?.[def.element] ?? this.enums.element?.physical ?? 0;
                    this.call.applyDamage(sourceId, eid, def.damage, element,
                        { isSpell: true, isArea: true });
                }
            }
        }

        this._playEffect(def, x, z);
    }

    _playEffect(def, x, z) {
        if (this.game.isServer || !this.game.effectsSystem) return;
        this.game.effectsSystem.createParticleEffect(x, 20, z, def.effect || 'magic', {
            count: 60, scaleMultiplier: 2.2, speedMultiplier: 1.4
        });
    }

    // Opponent-side visual for online play (local mode plays it in _applySkill)
    onCommanderSkillCastRemote(data) {
        const def = this.collections.commanderSkills?.[data?.skillId];
        if (def) this._playEffect(def, data.x, data.z);
    }

    _statsByPlayerId(numericPlayerId) {
        for (const eid of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }
}
