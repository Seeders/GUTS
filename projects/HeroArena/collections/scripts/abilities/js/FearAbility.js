class FearAbility extends GUTS.BaseAbility {
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
        this.logAbilityUsage(casterEntity, "Strikes fear into the target!");

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
            buffType: enums.buffTypes.feared,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });

        // Persistent debuff visual: dark wisps tremble over the fleeing unit's
        // head for the whole duration (client-only; each burst reads the unit's
        // current position so it follows the runner).
        this._scheduleFearVisual(targetId, 0);

        this.game.schedulingSystem.scheduleAction(() => {
            this.removeDebuff(targetId);
        }, this.duration, targetId);
    }

    static FEAR_VISUAL_INTERVAL = 0.55;   // seconds between overhead wisps
    static FEAR_VISUAL_HEIGHT   = 22;     // spawn offset above the unit

    _scheduleFearVisual(targetId, elapsed) {
        if (elapsed >= this.duration) return;
        this.game.schedulingSystem.scheduleAction(() => {
            const enums = this.game.getEnums();
            if (!this.hasBuff(targetId, enums.buffTypes.feared)) return;   // expired early
            if (!this.game.isServer) {
                const p = this.game.getComponent(targetId, "transform")?.position;
                if (p) {
                    this.call.playEffect?.('shadow_wisps',
                        new THREE.Vector3(p.x, (p.y || 0) + FearAbility.FEAR_VISUAL_HEIGHT, p.z));
                }
            }
            this._scheduleFearVisual(targetId, elapsed + FearAbility.FEAR_VISUAL_INTERVAL);
        }, FearAbility.FEAR_VISUAL_INTERVAL, targetId);
    }

    // Expiry handled centrally by BuffEffectsSystem._reapExpiredBuffs.
    // This schedule only plays the expiration visual.
    removeDebuff(targetId) {
        const enums = this.game.getEnums();
        if (this.hasBuff(targetId, enums.buffTypes.feared)) {
            const t = this.game.getComponent(targetId, "transform");
            if (t?.position) this.playConfiguredEffects('expiration', t.position);
        }
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
