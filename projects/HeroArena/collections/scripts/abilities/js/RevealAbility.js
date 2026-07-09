// DEX Reveal — a scout's flare / keen senses that expose nearby hidden enemies
// (cloaked OR invisible). Applies the `revealed` buff, which zeroes their stealth so
// the whole team can target them. Scans past stealth (a hidden unit is invisible to
// normal vision, so this looks at raw positions).
class RevealAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 8.0;
    }
    _hiddenEnemies(casterEntity) {
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        const myTeam = this.game.getComponent(casterEntity, "team")?.team;
        if (!cpos || myTeam == null) return [];
        const enums = this.game.getEnums();
        const inv = enums.buffTypes.invisible, clo = enums.buffTypes.cloaked;
        const r2 = this.range * this.range;
        const out = [];
        for (const eid of this.game.getEntitiesWith("team", "transform")) {
            const t = this.game.getComponent(eid, "team")?.team;
            if (t == null || t === myTeam) continue;
            const h = this.game.getComponent(eid, "health");
            if (!h || h.current <= 0) continue;
            const p = this.game.getComponent(eid, "transform")?.position;
            if (!p) continue;
            const dx = p.x - cpos.x, dz = p.z - cpos.z;
            if (dx * dx + dz * dz > r2) continue;
            if (this.hasBuff(eid, inv) || this.hasBuff(eid, clo)) out.push(eid);
        }
        return out;
    }
    canExecute(casterEntity) { return this._hiddenEnemies(casterEntity).length > 0; }
    execute(casterEntity) {
        const targets = this._hiddenEnemies(casterEntity);
        if (!targets.length) return;
        const cpos = this.game.getComponent(casterEntity, "transform")?.position;
        if (cpos) this.playConfiguredEffects('cast', cpos);
        this.logAbilityUsage(casterEntity, "Reveals hidden foes!");
        const enums = this.game.getEnums();
        for (const eid of targets.slice().sort((a, b) => a - b)) {
            const p = this.game.getComponent(eid, "transform")?.position;
            if (p) this.playConfiguredEffects('impact', p);
            this.applyBuff(eid, { buffType: enums.buffTypes.revealed,
                endTime: this.game.state.now + this.duration, appliedTime: this.game.state.now,
                stacks: 1, sourceEntity: casterEntity });
        }
    }
}
