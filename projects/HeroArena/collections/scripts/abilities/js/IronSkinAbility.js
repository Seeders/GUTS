class IronSkinAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.iron_skin);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Skin turns to iron!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyIronSkinBuff(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    // Renamed from applyBuff to avoid shadowing the BaseAbility buff-store helper.
    applyIronSkinBuff(casterEntity) {
        const enums = this.game.getEnums();
        const refreshing = this.hasBuff(casterEntity, enums.buffTypes.iron_skin);
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.iron_skin,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        if (refreshing) return; // refreshed in place — no new visual or expiration schedule
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this.expireIronSkin(casterEntity);
        }, this.duration, casterEntity);
    }

    // Renamed from removeBuff to avoid shadowing the BaseAbility buff-store helper.
    expireIronSkin(casterEntity) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(casterEntity, enums.buffTypes.iron_skin);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(casterEntity, enums.buffTypes.iron_skin);
        const t = this.game.getComponent(casterEntity, "transform");
        if (t?.position) this.playConfiguredEffects('expiration', t.position);
    }
}

