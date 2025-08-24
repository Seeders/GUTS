class WindShieldAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'wind_shield',
            name: 'Wind Shield',
            description: 'Creates protective wind barriers that deflect projectiles',
            cooldown: 8.0,
            range: 200,
            manaCost: 60,
            targetType: 'defensive',
            animation: 'cast',
            priority: 4,
            castTime: 1.2,
            autoTrigger: 'projectiles_incoming',
            ...params
        });
        
        this.shieldDuration = 15.0;
        this.deflectionChance = 0.7; // 70% chance to deflect projectiles
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xE0FFFF,
                    colorRange: { start: 0xE0FFFF, end: 0x87CEEB },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.5
                }
            },
            shield: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xAFEEEE,
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Use when there are allies to protect and enemies with projectiles nearby
        const enemies = this.getEnemiesInRange(casterEntity, 300);
        return allies.length >= 1 && enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Create wind shields
        setTimeout(() => {
            this.createWindShields(casterEntity);
        }, this.castTime * 1000);
        
        this.logAbilityUsage(casterEntity, `Protective winds swirl around allies!`);
    }
    
    createWindShields(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        
        allies.forEach(allyId => {
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            if (!allyPos) return;
            
            // Shield effect
            this.createVisualEffect(allyPos, 'shield');
            
            // Create wind barrier aura
            if (this.game.effectsSystem) {
                this.game.effectsSystem.createAuraEffect(
                    allyPos.x, allyPos.y, allyPos.z,
                    'magic',
                    this.shieldDuration * 1000
                );
            }
            
            // Add shield component (if you have a shield system)
            // This would need to be integrated with your projectile system
            // to actually deflect incoming projectiles
        });
    }
}