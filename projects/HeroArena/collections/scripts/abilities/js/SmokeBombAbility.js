class SmokeBombAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.smoke_screen);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Disappears in a cloud of smoke!");

        this.game.schedulingSystem.scheduleAction(() => {
            this._applySmokeScreenBuff(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    _applySmokeScreenBuff(casterEntity) {
        const enums = this.game.getEnums();
        const existing = this.getBuff(casterEntity, enums.buffTypes.smoke_screen);
        if (existing) {
            existing.endTime = this.game.state.now + this.duration;
            existing.appliedTime = this.game.state.now;
            return;
        }
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.smoke_screen,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this._expireSmokeScreenBuff(casterEntity);
        }, this.duration, casterEntity);
    }

    _expireSmokeScreenBuff(casterEntity) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(casterEntity, enums.buffTypes.smoke_screen);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(casterEntity, enums.buffTypes.smoke_screen);
        const t = this.game.getComponent(casterEntity, "transform");
        if (t?.position) this.playConfiguredEffects('expiration', t.position);
    }
}

