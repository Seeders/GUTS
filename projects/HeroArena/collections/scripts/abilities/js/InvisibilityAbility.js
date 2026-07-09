// INT Invisibility — cloak the unit so thoroughly that it can attack WITHOUT
// revealing itself. The `invisible` buff raises stealth well above normal awareness
// and, unlike Stealth, does not break on attack. Only a Reveal / True Sight caster
// (the `revealed` buff) can expose it.
class InvisibilityAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 10.0;
    }
    canExecute(casterEntity) {
        return !this.hasBuff(casterEntity, this.game.getEnums().buffTypes.invisible);
    }
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (pos) this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Vanishes from sight!");
        const enums = this.game.getEnums();
        this.applyBuff(casterEntity, { buffType: enums.buffTypes.invisible,
            endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
            stacks: 1, sourceEntity: casterEntity });
    }
}
