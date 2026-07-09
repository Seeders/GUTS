// INT support — quicken nearby allies, boosting their attack and move speed for a
// while (team haste). Distinct from Rapid Fire (self-only burst): an army-wide tempo
// swing.
class HasteAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 8.0;
    }
    canExecute(casterEntity) { return (this.getAlliesInRange(casterEntity) || []).length > 0; }
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (pos) this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Hastens the army!");
        const enums = this.game.getEnums();
        this.game.schedulingSystem.scheduleAction(() => {
            for (const a of (this.getAlliesInRange(casterEntity) || []).slice().sort((x, y) => x - y)) {
                const h = this.game.getComponent(a, "health");
                const p = this.game.getComponent(a, "transform")?.position;
                if (!h || h.current <= 0) continue;
                if (p) this.playConfiguredEffects('impact', p);
                this.applyBuff(a, { buffType: enums.buffTypes.hasted,
                    endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
                    stacks: 1, sourceEntity: casterEntity });
            }
        }, 0, casterEntity);
    }
}
