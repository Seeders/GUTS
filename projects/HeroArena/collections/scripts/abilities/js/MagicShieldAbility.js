class MagicShieldAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.magic_shield);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Wraps in arcane shielding!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyMagicShieldBuff(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    // Renamed from applyBuff to avoid shadowing the BaseAbility buff-store helper.
    applyMagicShieldBuff(casterEntity) {
        const enums = this.game.getEnums();
        const refreshing = this.hasBuff(casterEntity, enums.buffTypes.magic_shield);
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.magic_shield,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        if (refreshing) return; // refreshed in place — no new visual or expiration schedule
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this.expireMagicShield(casterEntity);
        }, this.duration, casterEntity);
    }

    // Renamed from removeBuff to avoid shadowing the BaseAbility buff-store helper.
    expireMagicShield(casterEntity) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(casterEntity, enums.buffTypes.magic_shield);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(casterEntity, enums.buffTypes.magic_shield);
        const t = this.game.getComponent(casterEntity, "transform");
        if (t?.position) this.playConfiguredEffects('expiration', t.position);
    }
}

