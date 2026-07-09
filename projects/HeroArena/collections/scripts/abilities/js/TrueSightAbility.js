// INT True Sight — arcane detection with a wider reach and a longer hold than the
// DEX Reveal. Exposes nearby hidden enemies (cloaked OR invisible) with the
// `revealed` buff, zeroing their stealth so the whole team can target them.
class TrueSightAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.duration = abilityData.duration ?? 12.0;
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
        this.logAbilityUsage(casterEntity, "Arcane sight pierces the veil!");
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
