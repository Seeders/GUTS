// DEX Stealth — the unit slips into stealth (the `cloaked` buff raises its stealth
// above normal awareness, so enemies can't target it). It persists through attacks;
// only a Reveal / True Sight caster exposes it. (Weaker cloak than INT Invisibility.)
class StealthAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 14.0;
    }
    canExecute(casterEntity) {
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.cloaked)
            && !this.hasBuff(casterEntity, enums.buffTypes.invisible);
    }
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (pos) this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Slips into stealth!");
        const enums = this.game.getEnums();
        this.applyBuff(casterEntity, { buffType: enums.buffTypes.cloaked,
            endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
            stacks: 1, sourceEntity: casterEntity });
    }
}
