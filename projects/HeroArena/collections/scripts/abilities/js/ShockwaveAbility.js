// STR displacement — a ground shockwave that KNOCKS BACK nearby enemies (pushes
// them away from the caster) and deals light damage. New mechanic: forced
// displacement, breaking enemy formations and peeling attackers off the front line.
class ShockwaveAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.knockback = abilityData.knockback ?? 90;
        this.damage    = abilityData.damage    ?? 20;
        this.element   = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }
    canExecute(casterEntity) { return this.getEnemiesInRange(casterEntity).length > 0; }
    execute(casterEntity) {
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!cpos) return;
        const enemies = this.getEnemiesInRange(casterEntity);
        if (!enemies.length) return;
        this.playConfiguredEffects('cast', cpos);
        this.logAbilityUsage(casterEntity, "Unleashes a shockwave!");
        this.game.schedulingSystem.scheduleAction(() => {
            for (const eid of enemies.slice().sort((a, b) => a - b)) {
                const h = this.game.getComponent(eid, "health");
                const p = this.game.getComponent(eid, "transform")?.position;
                if (!h || h.current <= 0 || !p) continue;
                const anchored = this.game.getComponent(eid, "velocity")?.anchored;
                if (this.damage > 0) this.dealDamageWithEffects(casterEntity, eid, this.damage, this.element);
                if (anchored) continue;   // buildings/towers don't move
                const dx = p.x - cpos.x, dz = p.z - cpos.z;
                const d = Math.sqrt(dx * dx + dz * dz) || 1;
                p.x += (dx / d) * this.knockback;
                p.z += (dz / d) * this.knockback;
                this.playConfiguredEffects('impact', { x: p.x, y: p.y, z: p.z });
            }
        }, 0, casterEntity);
    }
}
