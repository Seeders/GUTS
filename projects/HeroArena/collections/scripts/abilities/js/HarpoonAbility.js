// DEX displacement — hook the nearest enemy and YANK it toward the caster (a pull),
// dragging back-line threats into the melee. New mechanic: inward displacement,
// the opposite of Shockwave's knockback.
class HarpoonAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.pull = abilityData.pull ?? 140;
        this.damage = abilityData.damage ?? 15;
        this.element = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
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
        this.logAbilityUsage(casterEntity, "Harpoons a foe!");
        this.game.schedulingSystem.scheduleAction(() => {
            const p = this.game.getComponent(target, "transform")?.position;
            const h = this.game.getComponent(target, "health");
            if (!p || !h || h.current <= 0) return;
            if (!this.game.getComponent(target, "velocity")?.anchored) {
                const dx = cpos.x - p.x, dz = cpos.z - p.z;
                const d = Math.sqrt(dx * dx + dz * dz) || 1;
                const step = Math.min(this.pull, d - 20);
                if (step > 0) { p.x += (dx / d) * step; p.z += (dz / d) * step; }
            }
            this.playConfiguredEffects('impact', { x: p.x, y: p.y, z: p.z });
            if (this.damage > 0) this.dealDamageWithEffects(casterEntity, target, this.damage, this.element);
        }, 0, casterEntity);
    }
}
