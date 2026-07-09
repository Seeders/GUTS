class RapidFireAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.rapid_fire);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Unleashes a flurry of shots!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyRapidFireBuff(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    applyRapidFireBuff(casterEntity) {
        const enums = this.game.getEnums();
        const existing = this.getBuff(casterEntity, enums.buffTypes.rapid_fire);
        if (existing) {
            existing.endTime = this.game.state.now + this.duration;
            existing.appliedTime = this.game.state.now;
            return;
        }
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.rapid_fire,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this.expireRapidFireBuff(casterEntity);
        }, this.duration, casterEntity);
    }

    // Expiry handled centrally by BuffEffectsSystem._reapExpiredBuffs.
    // This schedule only plays the expiration visual.
    expireRapidFireBuff(casterEntity) {
        const enums = this.game.getEnums();
        if (this.hasBuff(casterEntity, enums.buffTypes.rapid_fire)) {
            const t = this.game.getComponent(casterEntity, "transform");
            if (t?.position) this.playConfiguredEffects('expiration', t.position);
        }
    }
}

