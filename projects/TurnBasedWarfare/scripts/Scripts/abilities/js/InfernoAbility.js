class InfernoAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'inferno',
            name: 'Inferno',
            description: 'Creates a blazing inferno that damages all enemies in a large area',
            cooldown: 8.0,
            range: 200,
            manaCost: 80,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 2.0,
            autoTrigger: 'multiple_enemies',
            ...params
        });
        
        this.damage = 35;
        this.infernoRadius = 120;
        this.duration = 4.0;
        this.tickInterval = 0.5;
        this.element = 'fire';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff2200,
                    colorRange: { start: 0xff2200, end: 0xffaa00 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            inferno: {
                type: 'explosion',
                options: {
                    count: 4,
                    color: 0xff4400,
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Find best cluster position
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const infernoCenter = clusterPos || casterPos;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Create inferno at target location
        setTimeout(() => {
            this.createInferno(casterEntity, infernoCenter);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `The battlefield erupts in an unstoppable inferno!`, true);
    }
    
    createInferno(casterEntity, centerPos) {
        // Create inferno effect
        this.createVisualEffect(centerPos, 'inferno');
        
        // Screen effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ff3300', 400);
        }
        
        // Create damage over time
        let ticksRemaining = Math.floor(this.duration / this.tickInterval);
        
        const infernoTick = () => {
            if (ticksRemaining <= 0) return;
            
            // Apply damage to all enemies in radius
            if (this.game.damageSystem) {
                this.game.damageSystem.applySplashDamage(
                    casterEntity,
                    centerPos,
                    this.damage,
                    this.element,
                    this.infernoRadius,
                    { allowFriendlyFire: false }
                );
            }
            
            // Visual tick effect
            if (ticksRemaining > 1) {
                this.createVisualEffect(centerPos, 'inferno', { 
                    count: 15, 
                    scaleMultiplier: 2.0 
                });
            }
            
            ticksRemaining--;
            if (ticksRemaining > 0) {
                setTimeout(infernoTick, this.tickInterval * 1000);
            }
        };
        
        infernoTick();
    }
}