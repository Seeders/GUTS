class AimedShotAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.damage  = abilityData.damage  ?? 60;
        this.element = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
    }

    canExecute(casterEntity) {
        if (!this._meetsWeaponRequirement(casterEntity)) return false;
        return this.getEnemiesInRange(casterEntity, this.range).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        if (enemies.length === 0) return;
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;

        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, "Takes careful aim — a devastating shot!");

        this.game.schedulingSystem.scheduleAction(() => {
            const t = this.game.getComponent(target, "transform");
            if (t?.position) this.playConfiguredEffects('impact', t.position);
            this.dealDamageWithEffects(casterEntity, target, this.damage, this.element, { isMelee: true });
        }, this.castTime, casterEntity);
    }

    findClosestEnemy(casterEntity, enemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        const sorted = enemies.slice().sort((a, b) => a - b);
        let closest = null, closestDist = Infinity;
        sorted.forEach(eid => {
            const t = this.game.getComponent(eid, "transform");
            const p = t?.position;
            if (!p) return;
            const d = Math.sqrt((p.x - casterPos.x) ** 2 + (p.z - casterPos.z) ** 2);
            if (d < closestDist) { closestDist = d; closest = eid; }
        });
        return closest;
    }
}

