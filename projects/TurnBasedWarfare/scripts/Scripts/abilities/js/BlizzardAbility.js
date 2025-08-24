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
                    count: 4,
                    color: 0x88ccff,
                    colorRange: { start: 0x88ccff, end: 0xffffff },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            },
            blizzard: {
                type: 'magic',
                options: {
                    count: 6,
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
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Create blizzard covering large area
        setTimeout(() => {
            this.createBlizzard(casterEntity);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `An arctic blizzard engulfs the battlefield!`, true);
    }
    
    createBlizzard(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Screen effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#aaffff', 600);
        }
        
        let ticksRemaining = Math.floor(this.duration / this.tickInterval);
        
        const blizzardTick = () => {
            if (ticksRemaining <= 0) return;
            
            // Get all enemies on the battlefield
            const allEnemies = this.getEnemiesInRange(casterEntity, 1000); // Very large range
            
            allEnemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (enemyPos) {
                    // Create localized blizzard effect at each enemy
                    this.createVisualEffect(enemyPos, 'blizzard', { count: 3 });
                    
                    // Apply cold damage
                    this.dealDamageWithEffects(casterEntity, enemyId, this.damage, this.element);
                }
            });
            
            ticksRemaining--;
            if (ticksRemaining > 0) {
                setTimeout(blizzardTick, this.tickInterval * 1000);
            }
        };
        
        blizzardTick();
    }
}
