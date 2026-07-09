class LightningBoltAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.damage         = abilityData.damage         ?? 55;
        this.criticalChance = abilityData.criticalChance ?? 0.3;
        this.element        = this.enums.element[abilityData.element || 'lightning'] ?? this.enums.element.lightning;
    }

    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }

    execute(casterEntity) {
        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterPos = casterTransform?.position;
        if (!casterPos) return;

        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;

        // DESYNC SAFE: Find target with highest health deterministically
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;

        const targetTransform = this.game.getComponent(target, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return;

        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Lightning crackles with electric fury!`, true);

        this.game.schedulingSystem.scheduleAction(() => {
            this.strikeLightning(casterEntity, target, targetPos);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }

    strikeLightning(casterEntity, targetId, targetPos) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        // Create lightning bolt visual effect
        if (this.game.effectsSystem) {
            // No style overrides: every bolt in the game uses EffectsSystem's
            // one canonical 'lightning' look.
            this.game.effectsSystem.createLightningBolt(
                new THREE.Vector3(casterPos.x, casterPos.y + 50, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z)
            );
        }

        // Lightning effect at target
        this.playConfiguredEffects('impact', targetPos);

        // Screen flash
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ffffaa', 0.15);
        }

        // DESYNC SAFE: Determine critical hit deterministically instead of random
        const isCritical = this.isDeterministicCritical(casterEntity, targetId);
        const damage = isCritical ? this.damage * 2 : this.damage;

        // Apply lightning damage
        this.dealDamageWithEffects(casterEntity, targetId, damage, this.element, {
            isCritical: isCritical,
            isInstant: true
        });
    }

    // DESYNC SAFE: Deterministic critical hit calculation
    isDeterministicCritical(casterId, targetId) {
        // Create a deterministic "random" value based on entity IDs and game time
        const seed = parseInt(casterId) + parseInt(targetId) + Math.floor(this.game.state.now * 100);
        const pseudoRandom = (seed * 9301 + 49297) % 233280 / 233280; // Simple PRNG

        return pseudoRandom < this.criticalChance;
    }

    // DESYNC SAFE: Deterministic highest health enemy finding
    findHighestHealthEnemy(enemies) {
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);

        let strongest = null;
        let highestHealth = 0;

        sortedEnemies.forEach(enemyId => {
            const health = this.game.getComponent(enemyId, "health");
            if (health && health.current >= highestHealth) { // Use >= for consistent tie-breaking
                highestHealth = health.current;
                strongest = enemyId;
            }
        });

        return strongest;
    }
}
