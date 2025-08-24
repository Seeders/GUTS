class DrainLifeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
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
            ...params
        });
        
        this.drainAmount = 60;
        this.healRatio = 0.8; // Heal 80% of drained health
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0x800080,
                    colorRange: { start: 0x800080, end: 0x4B0082 },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            },
            drain: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x8B008B,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.5
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 5,
                    color: 0x9400D3,
                    scaleMultiplier: 1.0,
                    speedMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Use when injured and enemies are available
        return enemies.length >= 1 && 
               casterHealth && casterHealth.current < casterHealth.max * 0.6;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Target enemy with highest current health
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Create drain beam effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: { color: 0x8B008B, linewidth: 4 },
                    animation: { duration: 1000, pulseEffect: true }
                }
            );
        }
        
        // Apply drain effect
        setTimeout(() => {
            this.performDrain(casterEntity, target);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `Dark energy siphons life force!`);
    }
    
    performDrain(casterEntity, targetId) {
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
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
            
            // Drain effect on target
            this.createVisualEffect(targetPos, 'drain');
            
            // Heal effect on caster
            if (actualHeal > 0) {
                this.createVisualEffect(casterPos, 'heal');
                
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.showDamageNumber(
                        casterPos.x, casterPos.y + 15, casterPos.z,
                        actualHeal, 'heal'
                    );
                }
            }
        }
    }
    
    findHighestHealthEnemy(enemies) {
        let strongest = null;
        let highestHealth = 0;
        
        enemies.forEach(enemyId => {
            const health = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            if (health && health.current > highestHealth) {
                highestHealth = health.current;
                strongest = enemyId;
            }
        });
        
        return strongest;
    }
}