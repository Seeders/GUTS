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
                    count: 1,
                    color: 0xE0FFFF,
                    colorRange: { start: 0xE0FFFF, end: 0x87CEEB },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.5
                }
            },
            shield: {
                type: 'magic',
                options: {
                    count: 1,
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
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Protective winds swirl around allies!`);
        
        this.game.schedulingSystem.scheduleAction(() => {
            this.createWindShields(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    createWindShields(casterEntity) {
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        sortedAllies.forEach(allyId => {
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            if (!allyPos) return;
            // Shield effect
            this.createVisualEffect(allyPos, 'shield');            
            
            // DESYNC SAFE: Add shield component using scheduling system for duration
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(allyId, this.componentTypes.BUFF, 
                Components.Buff('wind_shield', { 
                    deflectionChance: this.deflectionChance,
                    projectileReflection: true
                }, this.game.state.now + this.shieldDuration, false, 1, this.game.state.now));
            
            // DESYNC SAFE: Schedule shield removal
            this.game.schedulingSystem.scheduleAction(() => {
                if (this.game.hasComponent(allyId, this.componentTypes.BUFF)) {
                    const buff = this.game.getComponent(allyId, this.componentTypes.BUFF);
                    if (buff && buff.buffType === 'wind_shield') {
                        this.game.removeComponent(allyId, this.componentTypes.BUFF);
                        
                        // Visual effect when shield expires
                        const currentPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
                        if (currentPos) {
                            this.createVisualEffect(currentPos, 'shield', { 
                                count: 3, 
                                scaleMultiplier: 0.5,
                                color: 0x87CEEB 
                            });
                        }
                    }
                }
            }, this.shieldDuration, allyId);
        });
    }
}