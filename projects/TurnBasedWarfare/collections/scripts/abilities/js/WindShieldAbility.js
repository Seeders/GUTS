class WindShieldAbility extends GUTS.BaseAbility {
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
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
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        sortedAllies.forEach(allyId => {
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            if (!allyPos) return;
            // Shield effect
            this.createVisualEffect(allyPos, 'shield');            
            
            // DESYNC SAFE: Add shield component using scheduling system for duration
            this.game.addComponent(allyId, "buff", {
                buffType: 'wind_shield',
                modifiers: {
                    deflectionChance: this.deflectionChance,
                    projectileReflection: true
                },
                endTime: this.game.state.now + this.shieldDuration,
                stackable: false,
                stacks: 1,
                appliedTime: this.game.state.now,
                isActive: true
            });
            
            // DESYNC SAFE: Schedule shield removal
            this.game.schedulingSystem.scheduleAction(() => {
                if (this.game.hasComponent(allyId, "buff")) {
                    const buff = this.game.getComponent(allyId, "buff");
                    if (buff && buff.buffType === 'wind_shield') {
                        this.game.removeComponent(allyId, "buff");

                        // Visual effect when shield expires
                        const transform = this.game.getComponent(allyId, "transform");
                        const currentPos = transform?.position;
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