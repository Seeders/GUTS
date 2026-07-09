// STR reactive — when the caster drops below a health threshold it digs in: heavy
// damage reduction + a damage boost for a short time. A defensive low-HP trigger
// (unlike Rage's on-cast burst or Bloodlust's on-kill ramp).
class LastStandAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 8.0;
        this.threshold = abilityData.threshold ?? 0.35;   // fraction of max HP
    }
    canExecute(casterEntity) {
        const h = this.game.getComponent(casterEntity, "health");
        if (!h || !h.max || h.current <= 0) return false;
        if (this.hasBuff(casterEntity, this.game.getEnums().buffTypes.lastStand)) return false;
        return (h.current / h.max) <= this.threshold;
    }
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!pos) return;
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Makes a last stand!");
        const enums = this.game.getEnums();
        this.applyBuff(casterEntity, { buffType: enums.buffTypes.lastStand,
            endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
            stacks: 1, sourceEntity: casterEntity });
    }
}
