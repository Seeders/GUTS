class SmiteAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'smite',
            name: 'Divine Smite',
            description: 'Calls down divine wrath upon the strongest enemy',
            cooldown: 6.0,
            range: 400,
            manaCost: 65,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 1.8,
            autoTrigger: 'strong_enemy',
            ...params
        });
        
        this.damage = 80;
        this.bonusDamageVsUndead = 2.0; // Double damage vs undead
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFD700,
                    colorRange: { start: 0xFFD700, end: 0xFFFACD },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.2
                }
            },
            smite: {
                type: 'magic',
                options: {
                    count: 4,
                    color: 0xFFF8DC,
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.8
                }
            },
            pillar: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xF0E68C,
                    scaleMultiplier: 4.0,
                    speedMultiplier: 2.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Target the strongest enemy (highest health)
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Divine smite
        setTimeout(() => {
            this.performSmite(casterEntity, target, targetPos);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `Divine judgment descends from the heavens!`, true);
    }
    
    performSmite(casterEntity, targetId, targetPos) {
        // Create pillar of light effect
        this.createVisualEffect(targetPos, 'pillar');
        
        // Screen flash
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#FFD700', 500);
            this.game.effectsSystem.playScreenShake(300, 3);
        }
        
        // Calculate damage (bonus vs undead)
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        let damage = this.damage;
        
        if (targetUnitType && targetUnitType.type.includes('undead')) {
            damage = Math.floor(damage * this.bonusDamageVsUndead);
        }
        
        // Apply divine damage
        setTimeout(() => {
            this.dealDamageWithEffects(casterEntity, targetId, damage, this.element, {
                isSmite: true,
                isCritical: true
            });
            
            // Smite effect on target
            this.createVisualEffect(targetPos, 'smite');
        }, 500);
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
