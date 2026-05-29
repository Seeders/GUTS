class BlinkAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.blinkDistance = abilityData.blinkDistance ?? 150;
    }

    canExecute(casterEntity) {
        return this.getEnemiesInRange(casterEntity, this.range).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        if (enemies.length === 0) return;
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;
        const tt = this.game.getComponent(target, "transform");
        const tp = tt?.position;
        if (!tp) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Blinks across the battlefield!");

        // Move caster toward target by blinkDistance (clamped to target distance)
        const dx = tp.x - pos.x;
        const dz = tp.z - pos.z;
        const d  = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.001) return;
        const step = Math.min(this.blinkDistance, d - 10);
        pos.x += (dx / d) * step;
        pos.z += (dz / d) * step;

        this.playConfiguredEffects('impact', { x: pos.x, y: pos.y, z: pos.z });
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

