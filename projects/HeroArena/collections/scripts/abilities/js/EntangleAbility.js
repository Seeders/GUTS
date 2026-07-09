class EntangleAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 4.0;
        this.damage   = abilityData.damage   ?? 0;
        this.element  = this.enums.element[abilityData.element || 'physical'] ?? this.enums.element.physical;
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
        this.logAbilityUsage(casterEntity, "Vines wrap around the enemy!");

        this.game.schedulingSystem.scheduleAction(() => {
            this.applyDebuff(casterEntity, target);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    applyDebuff(casterEntity, targetId) {
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return;

        this.playConfiguredEffects('impact', targetPos);

        if (this.damage > 0) {
            this.dealDamageWithEffects(casterEntity, targetId, this.damage, this.element);
        }

        const enums = this.game.getEnums();
        this.applyBuff(targetId, {
            buffType: enums.buffTypes.rooted,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });

        this.game.schedulingSystem.scheduleAction(() => {
            this.removeDebuff(targetId);
        }, this.duration, targetId);
    }

    removeDebuff(targetId) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(targetId, enums.buffTypes.rooted);
        if (!buff) return;
        // Refreshed since this schedule was armed — the later expiry (or the
        // central reaper) owns removal now.
        if (buff.endTime - (this.game.state.now || 0) > 0.1) return;
        this.removeBuff(targetId, enums.buffTypes.rooted);
        const t = this.game.getComponent(targetId, "transform");
        if (t?.position) this.playConfiguredEffects('expiration', t.position);
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

