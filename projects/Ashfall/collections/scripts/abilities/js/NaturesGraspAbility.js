class NaturesGraspAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 3.0;
        this.radius   = abilityData.radius   ?? this.range;
        this.damage   = abilityData.damage   ?? 0;
        this.element  = this.enums.element[abilityData.element || 'cold'] ?? this.enums.element.cold;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        return this.getEnemiesInRange(casterEntity, this.radius).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, "Nature's grasp slows the field!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyAoe(casterEntity);
        }, this.castTime, casterEntity);
    }

    applyAoe(casterEntity) {
        const enums = this.game.getEnums();
        const enemies = this.getEnemiesInRange(casterEntity, this.radius);
        enemies.forEach(eid => {
            const t = this.game.getComponent(eid, "transform");
            if (t?.position) this.playConfiguredEffects('impact', t.position);
            if (this.damage > 0) {
                this.dealDamageWithEffects(casterEntity, eid, this.damage, this.element);
            }
            this.game.addComponent(eid, "buff", {
                buffType: enums.buffTypes.slowed,
                endTime: this.game.state.now + this.duration,
                appliedTime: this.game.state.now,
                stacks: 1,
                sourceEntity: casterEntity
            });
            this.game.schedulingSystem.scheduleAction(() => {
                if (!this.game.hasComponent(eid, "buff")) return;
                const buff = this.game.getComponent(eid, "buff");
                if (buff && buff.buffType === enums.buffTypes.slowed) {
                    this.game.removeComponent(eid, "buff");
                }
            }, this.duration, eid);
        });
    }
}

