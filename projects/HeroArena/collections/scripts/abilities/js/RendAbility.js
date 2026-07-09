// DEX damage-over-time — a deep cut that bleeds the target for physical damage over
// time. Distinct from Poison Coat (a passive on-hit weapon coat): Rend is an active
// cast that stacks a bleed on one priority target.
class RendAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 6.0;
        this.tick = abilityData.tick ?? 1.0;          // seconds between bleed ticks
        this.tickDamage = abilityData.tickDamage ?? 14;
        this.element = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }
    canExecute(casterEntity) { return this.getEnemiesInRange(casterEntity).length > 0; }
    execute(casterEntity) {
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!cpos) return;
        const enemies = this.getEnemiesInRange(casterEntity);
        let target = null, best = -1;
        for (const eid of enemies.slice().sort((a, b) => a - b)) {   // biggest HP pool = juiciest bleed
            const h = this.game.getComponent(eid, "health");
            if (!h || h.current <= 0) continue;
            if (h.max > best) { best = h.max; target = eid; }
        }
        if (target == null) return;
        this.playConfiguredEffects('cast', cpos);
        this.logAbilityUsage(casterEntity, "Rends the enemy - bleeding!");
        const enums = this.game.getEnums();
        this.applyBuff(target, { buffType: enums.buffTypes.bleeding,
            endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
            stacks: 1, sourceEntity: casterEntity });
        for (let t = this.tick; t <= this.duration + 0.001; t += this.tick) {
            this.game.schedulingSystem.scheduleAction(() => {
                const h = this.game.getComponent(target, "health");
                const p = this.game.getComponent(target, "transform")?.position;
                if (!h || h.current <= 0 || !p) return;
                if (this.game.state.phase !== this.enums.gamePhase.battle) return;
                this.dealDamageWithEffects(casterEntity, target, this.tickDamage, this.element);
            }, t, target);
        }
    }
}
