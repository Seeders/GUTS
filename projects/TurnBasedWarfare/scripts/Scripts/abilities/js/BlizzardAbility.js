class BlizzardAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'blizzard',
            name: 'Blizzard',
            description: 'Summons a devastating blizzard that freezes all enemies',
            cooldown: 5.0,
            range: 300,
            manaCost: 0,
            targetType: 'auto',
            animation: 'cast',
            priority: 10,
            castTime: 2.5,
            autoTrigger: 'many_enemies',
            ...params
        });
        
        this.damage = 3;
        this.blizzardRadius = 150;
        this.duration = 3.0;
        this.tickInterval = 0.4;
        this.element = 'cold';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x88ccff,
                    colorRange: { start: 0x88ccff, end: 0xffffff },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            },
            blizzard: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xaaddff,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 3;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `An arctic blizzard engulfs the battlefield!`, true);
        
        // DESYNC SAFE: Use scheduling system instead of setTimeout
        this.game.schedulingSystem.scheduleAction(() => {
            this.createBlizzard(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    createBlizzard(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Screen effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#aaffff', 0.6);
        }
        
        // DESYNC SAFE: Schedule all blizzard ticks using the scheduling system
        const totalTicks = Math.floor(this.duration / this.tickInterval);
        
        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;
            
            this.game.schedulingSystem.scheduleAction(() => {
                this.executeBlizzardTick(casterEntity, tickIndex);
            }, tickDelay, casterEntity);
        }
    }
    
    // DESYNC SAFE: Execute a single blizzard tick deterministically
    executeBlizzardTick(casterEntity, tickIndex) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Get all enemies deterministically
        const allEnemies = this.getEnemiesInRange(casterEntity, 1000); // Very large range to cover battlefield
        
        if (allEnemies.length === 0) return;
        
        // Sort enemies deterministically for consistent processing order
        const sortedEnemies = allEnemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            
            // Only affect living enemies
            if (enemyPos && enemyHealth && enemyHealth.current > 0) {
                // Create localized blizzard effect at each enemy
                this.createVisualEffect(enemyPos, 'blizzard', { count: 3 });
                
                // Apply cold damage
                this.dealDamageWithEffects(casterEntity, enemyId, this.damage, this.element, {
                    isBlizzard: true,
                    tickIndex: tickIndex
                });
            }
        });
        
        // Additional visual flair for certain ticks
        if (tickIndex === 0 || tickIndex % 3 === 0) {
            // Create additional atmospheric effects on key ticks
            const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
            if (casterPos) {
                this.createVisualEffect(casterPos, 'blizzard', { 
                    count: 8, 
                    scaleMultiplier: 2.5,
                    heightOffset: 20 
                });
            }
        }
    }
}