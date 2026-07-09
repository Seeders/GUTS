/**
 * ShieldWallAbility - squad damage link (Mechabellum "Damage Sharing" on
 * linked Sledgehammers).
 * Applies the shield_wall buff to the caster AND every living member of the
 * caster's squad for wallDuration seconds. While ≥2 linked members are alive,
 * damage dealt to any one of them is dispersed EQUALLY across the whole link —
 * see DamageSystem STEP 2.5 (_getDamageShareGroup). Each member mitigates its
 * own share with its own armor/resists.
 */
class ShieldWallAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies
    ];

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.wallDuration = abilityData.wallDuration ?? 10.0;
        this.engageRadius = abilityData.tauntRadius  ?? 200; // legacy field name: "enemies close enough to brace for"
        this.element      = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }

    canExecute(casterEntity) {
        // Don't re-link while the buff is still up.
        const enums = this.game.getEnums();
        if (this.hasBuff(casterEntity, enums.buffTypes.shield_wall)) return false;

        // A link needs at least one living squadmate besides the caster.
        if (this.getLivingSquadmates(casterEntity).length === 0) return false;

        // Only worth linking when enemies are actually bearing down.
        return this.getEnemiesInRange(casterEntity, this.engageRadius).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;

        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Soldiers lock shields — the line holds as one!`);

        this.game.schedulingSystem.scheduleAction(() => {
            this.formShieldWall(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    formShieldWall(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        this.playConfiguredEffects('burst', casterPos);

        const enums = this.game.getEnums();
        const now = this.game.state.now || 0;
        const endTime = now + this.wallDuration;

        // Link the whole squad: caster + every living squadmate.
        const members = [casterEntity, ...this.getLivingSquadmates(casterEntity)];
        members.forEach((memberId, index) => {
            this.applyBuff(memberId, {
                buffType: enums.buffTypes.shield_wall,
                endTime: endTime,
                appliedTime: now,
                stacks: 1,
                sourceEntity: casterEntity
            });

            // Staggered link visual across the line.
            this.game.schedulingSystem.scheduleAction(() => {
                const t = this.game.getComponent(memberId, "transform");
                if (t?.position) this.playConfiguredEffects('buff', t.position);
            }, index * 0.1, memberId);
        });

        // Expiration visual when the link drops (buff removal itself is
        // handled centrally by BuffEffectsSystem._reapExpiredBuffs).
        this.game.schedulingSystem.scheduleAction(() => {
            const t = this.game.getComponent(casterEntity, "transform");
            if (t?.position) this.playConfiguredEffects('expiration', t.position);
        }, this.wallDuration, casterEntity);
    }

    // Living members of the caster's squad, excluding the caster, in
    // deterministic entity-id order. Empty for solo units (no squad, no link).
    getLivingSquadmates(casterEntity) {
        const squad = this.game.getComponent(casterEntity, 'squadMember');
        if (!squad || squad.squadId == null) return [];

        const aliveState = this.enums.deathState?.alive;
        const mates = [];
        for (const eid of this.game.getEntitiesWith('squadMember', 'health')) {
            if (eid === casterEntity) continue;
            const sm = this.game.getComponent(eid, 'squadMember');
            if (!sm || sm.squadId !== squad.squadId) continue;
            const hp = this.game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            const ds = this.game.getComponent(eid, 'deathState');
            if (ds && aliveState != null && ds.state !== aliveState) continue;
            mates.push(eid);
        }
        return mates.sort((a, b) => a - b);
    }
}
