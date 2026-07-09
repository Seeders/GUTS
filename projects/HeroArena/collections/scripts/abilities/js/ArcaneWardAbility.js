// INT support — cast a protective ward on the most-injured nearby ALLY (a targeted
// shield). Distinct from Magic Shield (self only) and Shield Wall/Phalanx (squad
// mechanics): a single-target bubble you place where it's needed.
class ArcaneWardAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 12.0;
    }
    _target(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity) || [];
        const enums = this.game.getEnums();
        let best = null, worst = Infinity;
        for (const a of allies.slice().sort((x, y) => x - y)) {
            if (a === casterEntity) continue;
            const h = this.game.getComponent(a, "health");
            if (!h || h.current <= 0) continue;
            if (this.hasBuff(a, enums.buffTypes.magic_shield)) continue;
            const frac = h.max ? h.current / h.max : 1;
            if (frac < worst) { worst = frac; best = a; }
        }
        return best;
    }
    canExecute(casterEntity) { return this._target(casterEntity) != null; }
    execute(casterEntity) {
        const target = this._target(casterEntity);
        if (target == null) return;
        const enums = this.game.getEnums();
        const cp = this.game.getComponent(casterEntity, "transform")?.position;
        if (cp) this.playConfiguredEffects('cast', cp);
        this.logAbilityUsage(casterEntity, "Wards an ally!");
        this.game.schedulingSystem.scheduleAction(() => {
            const h = this.game.getComponent(target, "health");
            const tp = this.game.getComponent(target, "transform")?.position;
            if (!h || h.current <= 0) return;
            if (tp) this.playConfiguredEffects('impact', tp);
            this.applyBuff(target, { buffType: enums.buffTypes.magic_shield,
                endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
                stacks: 1, sourceEntity: casterEntity });
        }, 0, casterEntity);
    }
}
