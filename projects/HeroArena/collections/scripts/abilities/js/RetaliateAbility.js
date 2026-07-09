class RetaliateAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.retaliation);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Steels for the counter!");

        this.game.schedulingSystem.scheduleAction(() => {
            this._applyRetaliationBuff(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    _applyRetaliationBuff(casterEntity) {
        const enums = this.game.getEnums();
        const existing = this.getBuff(casterEntity, enums.buffTypes.retaliation);
        if (existing) {
            existing.endTime = this.game.state.now + this.duration;
            existing.appliedTime = this.game.state.now;
            return;
        }
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.retaliation,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this._expireRetaliationBuff(casterEntity);
        }, this.duration, casterEntity);
    }

    _expireRetaliationBuff(casterEntity) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(casterEntity, enums.buffTypes.retaliation);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(casterEntity, enums.buffTypes.retaliation);
        const t = this.game.getComponent(casterEntity, "transform");
        if (t?.position) this.playConfiguredEffects('expiration', t.position);
    }
}

