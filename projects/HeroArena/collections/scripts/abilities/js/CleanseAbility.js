// INT support — purge harmful debuffs from nearby allies (a dispel). No existing
// ability removes crowd control / debuffs; this answers enemy CC and DoTs.
class CleanseAbility extends GUTS.BaseAbility {
    static DEBUFFS = ['stunned', 'frozen', 'slowed', 'rooted', 'crippled', 'silenced', 'disrupted',
        'poisoned_weapon', 'curse', 'marked', 'feared', 'sundered', 'blinded', 'bleeding', 'intimidated', 'moraleBroken'];
    _debuffIds() {
        const t = this.game.getEnums().buffTypes || {};
        return CleanseAbility.DEBUFFS.map(k => t[k]).filter(v => v != null);
    }
    canExecute(casterEntity) {
        const ids = this._debuffIds();
        return (this.getAlliesInRange(casterEntity) || []).some(a => ids.some(b => this.hasBuff(a, b)));
    }
    execute(casterEntity) {
        const ids = this._debuffIds();
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (pos) this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Cleanses allies!");
        this.game.schedulingSystem.scheduleAction(() => {
            for (const a of (this.getAlliesInRange(casterEntity) || []).slice().sort((x, y) => x - y)) {
                const h = this.game.getComponent(a, "health");
                if (!h || h.current <= 0) continue;
                let any = false;
                for (const b of ids) if (this.hasBuff(a, b)) { this.removeBuff(a, b); any = true; }
                if (any) { const p = this.game.getComponent(a, "transform")?.position; if (p) this.playConfiguredEffects('impact', p); }
            }
        }, 0, casterEntity);
    }
}
