class LightningBoltAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.damage  = abilityData.damage ?? 55;
        // criticalChance comes from BaseAbility (data JSON keeps its high 0.3 base —
        // a big slow nuke that crits often). The roll itself is DamageSystem's now.
        this.element = this.enums.element[abilityData.element || 'lightning'] ?? this.enums.element.lightning;
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

        // Crit is rolled by DamageSystem against this ability's criticalChance plus
        // the caster's. It used to be rolled here AND doubled here, while still
        // passing isCritical:true — so a crit multiplied twice (×2 locally, then
        // ×critMultiplier again in applyDamage).
        this.dealDamageWithEffects(casterEntity, targetId, this.damage, this.element, {
            isInstant: true
        });
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
