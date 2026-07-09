// Multi-Shot — PASSIVE. Modifies the unit's basic attack instead of being cast:
// every attack fires arrows at up to maxTargets DISTINCT enemies in attack
// range (closest first, one arrow per target). 1 enemy in range → 1 arrow,
// 2 → 2, 3+ → maxTargets. ALL arrows (primary included) deal arrowDamageMult
// of normal attack damage — specializing trades single-target power for
// spread. The attack-side logic lives in
// AttackEnemyBehaviorAction.fireMultishotExtras, which checks for this ability
// on the attacker at projectile release time.
class MultiShotAbility extends GUTS.BaseAbility {

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.isPassive       = true;
        this.maxTargets      = abilityData.maxTargets ?? 3;
        this.arrowDamageMult = abilityData.arrowDamageMult ?? 0.65;
    }

    // Never actively cast — the AbilitySystem autocaster must skip it.
    canExecute() {
        return false;
    }

    execute() {
        return null;
    }
}
