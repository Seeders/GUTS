class ResurrectionAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.healPercent = abilityData.healPercent ?? 0.5;
    }

    canExecute(casterEntity) {
        return !!this._findFallenAlly(casterEntity);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        const target = this._findFallenAlly(casterEntity);
        if (!target) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Calls a fallen hero back to life!");

        this.game.schedulingSystem.scheduleAction(() => {
            this._resurrect(casterEntity, target);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    // Looks for dead allies (health <= 0 but entity still exists, e.g. before despawn)
    _findFallenAlly(casterEntity) {
        const casterTeam = this.game.getComponent(casterEntity, "team");
        if (!casterTeam) return null;
        const ents = this.game.getEntitiesWith('health');
        for (const eid of ents) {
            if (eid === casterEntity) continue;
            const team = this.game.getComponent(eid, "team");
            const health = this.game.getComponent(eid, "health");
            if (!team || !health) continue;
            if (team.team !== casterTeam.team) continue;
            if (health.current > 0) continue;
            return eid;
        }
        return null;
    }

    _resurrect(casterEntity, targetId) {
        const health = this.game.getComponent(targetId, "health");
        if (!health) return;
        health.current = Math.max(1, Math.floor(health.max * this.healPercent));
        const t = this.game.getComponent(targetId, "transform");
        if (t?.position) this.playConfiguredEffects('impact', t.position);
        // Clear deathState if present so the death system can return them to action
        if (this.game.hasComponent(targetId, "deathState")) {
            this.game.removeComponent(targetId, "deathState");
        }
    }
}

