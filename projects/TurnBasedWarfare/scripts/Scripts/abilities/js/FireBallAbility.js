class FireballAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'fireBall',
            name: 'Fire Ball',
            description: 'Launch a fiery projectile that explodes on impact',
            cooldown: 5.0,
            range: 150,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        
        this.damage = 60;
        this.splashRadius = 80;
        this.element = 'fire';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 20,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xff8800 },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 0.8
                }
            },
            projectile: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xff2200,
                    scaleMultiplier: 0.6,
                    speedMultiplier: 1.5
                }
            },
            explosion: {
                type: 'explosion',
                options: {
                    count: 35,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xff0000 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.2
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 12,
                    color: 0xff0000,
                    scaleMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity, targetData = null) {
        if (!this.game.projectileSystem) return;
        
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Cast effect at caster
        this.createVisualEffect(casterPos, 'cast');
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Find closest enemy
        let closestEnemy = null;
        let closestDistance = Infinity;
        
        enemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemyId;
            }
        });
        
        if (!closestEnemy) return;
        
        // Create fireball projectile with enhanced effects
        const projectileData = {
            id: 'fireball',
            title: 'Fireball',
            damage: this.damage,
            speed: 80,
            element: this.element,
            ballistic: true,
            splashRadius: this.splashRadius,
            homing: true,
            homingStrength: 0.3,
            onHit: (targetPos) => {
                // Explosion effect
                this.createVisualEffect(targetPos, 'explosion');
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.playScreenShake(300, 2);
                }
            },
            onTravel: (currentPos) => {
                // Trail effect during flight
                this.createVisualEffect(currentPos, 'projectile', { heightOffset: 0 });
            }
        };
        
        this.game.projectileSystem.fireProjectile(casterEntity, closestEnemy, projectileData);
        
        this.logAbilityUsage(casterEntity, 
            `Fireball launched at enemy target!`, true);
    }
}