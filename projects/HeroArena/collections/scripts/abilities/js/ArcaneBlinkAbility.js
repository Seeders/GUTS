// Defensive, reactive blink for the Apprentice. Unlike the aggressive BlinkAbility
// (which teleports TOWARD the target), this fires only when the caster has just
// been struck and teleports it AWAY from whoever hit it.
class ArcaneBlinkAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
        this.blinkDistance = abilityData.blinkDistance ?? 150;
        // How recently the caster must have been hit for the trigger to fire (s).
        this.reactWindow = abilityData.reactWindow ?? 1.0;
    }

    // Trigger condition: fire only when a living enemy struck us within the window.
    canExecute(casterEntity) {
        return this._recentAttacker(casterEntity) != null;
    }

    // The attacker that hit us within reactWindow, if it's still alive and located.
    _recentAttacker(casterEntity) {
        const cs = this.game.getComponent(casterEntity, "combatState");
        if (!cs || cs.lastAttacker == null) return null;
        const now = this.game.state.now || 0;
        if ((now - (cs.lastAttackTime || 0)) > this.reactWindow) return null;
        const attacker = cs.lastAttacker;
        const health = this.game.getComponent(attacker, "health");
        if (!health || health.current <= 0) return null;
        if (!this.game.getComponent(attacker, "transform")?.position) return null;
        return attacker;
    }

    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, "transform")?.position;
        if (!pos) return;
        const attacker = this._recentAttacker(casterEntity);
        if (attacker == null) return;
        const ap = this.game.getComponent(attacker, "transform")?.position;
        if (!ap) return;

        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Blinks away from danger!");

        // Teleport directly AWAY from the attacker.
        const dx = pos.x - ap.x;
        const dz = pos.z - ap.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        pos.x += (dx / d) * this.blinkDistance;
        pos.z += (dz / d) * this.blinkDistance;

        this.playConfiguredEffects('impact', { x: pos.x, y: pos.y, z: pos.z });
    }
}
