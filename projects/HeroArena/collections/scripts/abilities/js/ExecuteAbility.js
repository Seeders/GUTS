// STR finisher — strike the enemy in range with the LOWEST health fraction for
// damage that scales with its missing HP (an execute). Distinct from positional
// crits (Backstab/Shadow Strike): reward is proportional to how hurt the target is.
class ExecuteAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.baseDamage = abilityData.baseDamage ?? 30;
        this.bonusDamage = abilityData.bonusDamage ?? 220;   // at ~0% target HP
        this.element = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }
    canExecute(casterEntity) { return this.getEnemiesInRange(casterEntity).length > 0; }
    execute(casterEntity) {
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!cpos) return;
        const enemies = this.getEnemiesInRange(casterEntity);
        if (!enemies.length) return;
        let target = null, worst = Infinity;
        for (const eid of enemies.slice().sort((a, b) => a - b)) {
            const h = this.game.getComponent(eid, "health");
            if (!h || h.current <= 0 || !h.max) continue;
            const frac = h.current / h.max;
            if (frac < worst) { worst = frac; target = eid; }
        }
        if (target == null) return;
        this.playConfiguredEffects('cast', cpos);
        this.logAbilityUsage(casterEntity, "Moves in for the kill!");
        this.game.schedulingSystem.scheduleAction(() => {
            const h = this.game.getComponent(target, "health");
            const p = this.game.getComponent(target, "transform")?.position;
            if (!h || h.current <= 0 || !p) return;
            const missing = 1 - (h.current / h.max);
            const dmg = this.baseDamage + this.bonusDamage * missing;
            this.playConfiguredEffects('impact', p);
            this.dealDamageWithEffects(casterEntity, target, dmg, this.element);
        }, 0, casterEntity);
    }
}
