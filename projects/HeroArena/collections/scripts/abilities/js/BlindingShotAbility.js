// DEX debuff — a flash/powder shot that BLINDS the target, tanking its accuracy so
// its attacks miss. Distinct from Cripple (speed) and Curse (damage): pure to-hit
// denial, strong against high-value single attackers.
class BlindingShotAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 6.0;
    }
    canExecute(casterEntity) { return this.getEnemiesInRange(casterEntity).length > 0; }
    execute(casterEntity) {
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!cpos) return;
        const enemies = this.getEnemiesInRange(casterEntity);
        let target = null, best = Infinity;
        for (const eid of enemies.slice().sort((a, b) => a - b)) {
            const p = this.game.getComponent(eid, "transform")?.position;
            const h = this.game.getComponent(eid, "health");
            if (!p || !h || h.current <= 0) continue;
            const d = (p.x - cpos.x) ** 2 + (p.z - cpos.z) ** 2;
            if (d < best) { best = d; target = eid; }
        }
        if (target == null) return;
        this.playConfiguredEffects('cast', cpos);
        this.logAbilityUsage(casterEntity, "Blinds the enemy!");
        const enums = this.game.getEnums();
        this.game.schedulingSystem.scheduleAction(() => {
            const p = this.game.getComponent(target, "transform")?.position;
            const h = this.game.getComponent(target, "health");
            if (!p || !h || h.current <= 0) return;
            this.playConfiguredEffects('impact', p);
            this.applyBuff(target, { buffType: enums.buffTypes.blinded,
                endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
                stacks: 1, sourceEntity: casterEntity });
        }, 0, casterEntity);
    }
}
