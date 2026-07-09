// STR debuff — shatter the armor of nearby enemies (armor-shred). Distinct from
// Curse (damage down) and Cripple (speed down): this lowers ARMOR so the whole
// team's hits land harder.
class SunderArmorAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 12.0;
    }
    canExecute(casterEntity) { return this.getEnemiesInRange(casterEntity).length > 0; }
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!pos) return;
        const enemies = this.getEnemiesInRange(casterEntity);
        if (!enemies.length) return;
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Shatters enemy armor!");
        const enums = this.game.getEnums();
        this.game.schedulingSystem.scheduleAction(() => {
            for (const eid of enemies.slice().sort((a, b) => a - b)) {
                const h = this.game.getComponent(eid, "health");
                const p = this.game.getComponent(eid, "transform")?.position;
                if (!h || h.current <= 0 || !p) continue;
                this.playConfiguredEffects('impact', p);
                this.applyBuff(eid, { buffType: enums.buffTypes.sundered,
                    endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
                    stacks: 1, sourceEntity: casterEntity });
            }
        }, 0, casterEntity);
    }
}
