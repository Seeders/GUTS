class DrainLifeAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'drain_life',
            name: 'Drain Life',
            description: 'Drains health from an enemy and heals the caster',
            cooldown: 4.5,
            range: 200,
            manaCost: 45,
            targetType: 'auto',
            animation: 'cast',
            priority: 7,
            castTime: 1.2,
            autoTrigger: 'low_health',
            ...abilityData
        });
        
        this.drainAmount = 60;
        this.healRatio = 0.8; // Heal 80% of drained health
        this.element = this.enums.element.physical;
    }

    canExecute(casterEntity) {
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Use when injured and enemies are available
        return enemies.length >= 1 && 
               casterHealth && casterHealth.current < casterHealth.max * 0.6;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Target selection
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;

        const transform2 = this.game.getComponent(target, "transform");
        const targetPos = transform2?.position;
        if (!targetPos) return;
        
        // Immediate effects (visual, audio, logging)
        this.playConfiguredEffects('cast', casterPos);

        // Create drain beam effect immediately (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: { color: 0x8B008B, linewidth: 4 },
                    animation: { duration: 1000, pulseEffect: true }
                }
            );
        }

        this.logAbilityUsage(casterEntity, `Dark energy siphons life force!`);
        
        // DESYNC SAFE: Use scheduling system for delayed effect
        this.game.schedulingSystem.scheduleAction(() => {
            const transform = this.game.getComponent(target, "transform");
            const currentTargetPos = transform?.position;
            if (currentTargetPos) {
                this.performDrain(casterEntity, target, currentTargetPos);
            }
        }, this.castTime, casterEntity);
    }
    
    performDrain(casterEntity, targetId, targetPos) {
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || !casterPos || !targetPos) return;

        // Apply damage to target
        const result = this.dealDamageWithEffects(casterEntity, targetId, this.drainAmount, this.element, {
            isDrain: true
        });

        if (result && result.damage > 0) {
            // Heal caster based on damage dealt
            const healAmount = Math.floor(result.damage * this.healRatio);
            const actualHeal = Math.min(healAmount, casterHealth.max - casterHealth.current);
            casterHealth.current += actualHeal;

            // Dark energy burst at target
            this.playConfiguredEffects('drain', targetPos);

            // Heal effect on caster
            if (actualHeal > 0) {
                this.playConfiguredEffects('heal', casterPos);

                if (!this.game.isServer && this.game.hasService('showDamageNumber')) {
                    this.game.call('showDamageNumber',
                        casterPos.x, casterPos.y + 50, casterPos.z,
                        actualHeal, 'heal'
                    );
                }
            }
        }
    }
    
    // DESYNC SAFE: Deterministic target selection
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
