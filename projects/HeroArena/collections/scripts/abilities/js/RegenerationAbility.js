class RegenerationAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 12;
    }

    canExecute(casterEntity) {
        return this.getAlliesInRange(casterEntity).length > 0;
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        const allies = this.getAlliesInRange(casterEntity);
        const target = this._pickAlly(allies);
        if (!target) return;

        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, "Restorative magic flows!");

        this.game.schedulingSystem.scheduleAction(() => {
            this._applyBuff(casterEntity, target);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    _pickAlly(allies) {
        // Pick the most injured ally (deterministic by id when tied)
        const sorted = allies.slice().sort((a, b) => a - b);
        let chosen = null;
        let lowestRatio = Infinity;
        sorted.forEach(id => {
            const h = this.game.getComponent(id, "health");
            if (!h || h.max <= 0) return;
            const r = h.current / h.max;
            if (r < lowestRatio) { lowestRatio = r; chosen = id; }
        });
        return chosen;
    }

    _applyBuff(casterEntity, targetId) {
        const enums = this.game.getEnums();
        const t = this.game.getComponent(targetId, "transform");
        if (t?.position) this.playConfiguredEffects('impact', t.position);

        this.applyBuff(targetId, {
            buffType: enums.buffTypes.regenerating,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });

        // Expiry handled centrally by BuffEffectsSystem._reapExpiredBuffs.
    }
}

