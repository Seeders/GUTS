class IronSkinAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 15.0;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        const enums = this.game.getEnums();
        const buff = this.game.getComponent(casterEntity, "buff");
        return !(buff && buff.buffType === enums.buffTypes.iron_skin);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Skin turns to iron!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyBuff(casterEntity);
        }, this.castTime, casterEntity);
    }

    applyBuff(casterEntity) {
        const enums = this.game.getEnums();
        const existing = this.game.getComponent(casterEntity, "buff");
        if (existing && existing.buffType === enums.buffTypes.iron_skin) {
            existing.endTime = this.game.state.now + this.duration;
            existing.appliedTime = this.game.state.now;
            return;
        }
        this.game.addComponent(casterEntity, "buff", {
            buffType: enums.buffTypes.iron_skin,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });
        const transform = this.game.getComponent(casterEntity, "transform");
        if (transform?.position) this.playConfiguredEffects('buff', transform.position);

        this.game.schedulingSystem.scheduleAction(() => {
            this.removeBuff(casterEntity);
        }, this.duration, casterEntity);
    }

    removeBuff(casterEntity) {
        const enums = this.game.getEnums();
        if (!this.game.hasComponent(casterEntity, "buff")) return;
        const buff = this.game.getComponent(casterEntity, "buff");
        if (buff && buff.buffType === enums.buffTypes.iron_skin) {
            this.game.removeComponent(casterEntity, "buff");
            const t = this.game.getComponent(casterEntity, "transform");
            if (t?.position) this.playConfiguredEffects('expiration', t.position);
        }
    }
}

