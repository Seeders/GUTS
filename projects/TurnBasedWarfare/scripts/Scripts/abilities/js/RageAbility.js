class RageAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'raging_strike',
            name: 'Raging Strike',
            description: 'Unleash primal fury with increased damage and attack speed',
            cooldown: 5.0,
            range: 0, // Self-buff
            manaCost: 20,
            targetType: 'self',
            animation: 'attack',
            priority: 6,
            castTime: 0.8,
            ...params
        });
        
        this.rageDuration = 8.0;
        this.damageMultiplier = 1.5;
        this.attackSpeedMultiplier = 1.3;
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: { 
                    count: 12, 
                    color: 0xff4444, 
                    colorRange: { start: 0xff4444, end: 0xff8800 },
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.5
                }
            },
            rage: {
                type: 'magic',
                options: { 
                    count: 8, 
                    color: 0xff0000, 
                    scaleMultiplier: 1.8,
                    speedMultiplier: 2.0
                }
            },
            fury: {
                type: 'magic',
                options: { 
                    count: 15, 
                    color: 0xcc0000, 
                    scaleMultiplier: 2.2,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if there are enemies nearby to rage against
        const enemies = this.getEnemiesInRange(casterEntity, 100);
        if (enemies.length === 0) return false;
        
        // Don't stack rage buffs - check if already raged
        const existingBuff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (existingBuff && existingBuff.buffType === 'rage') return false;
        
        return true;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Primal fury begins to build...`);
        
        // Schedule the rage activation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.activateRage(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    activateRage(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Create dramatic rage effects
        this.createVisualEffect(casterPos, 'rage');
        
        // Schedule a secondary fury effect for visual impact
        this.game.schedulingSystem.scheduleAction(() => {
            if (this.game.hasComponent && this.game.hasComponent(casterEntity, this.componentTypes.POSITION)) {
                const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
                if (pos) {
                    this.createVisualEffect(pos, 'fury');
                }
            }
        }, 0.5, casterEntity);
        
        // Apply rage buff with proper timing
        const Components = this.game.componentManager.getComponents();
        const currentTime = this.game.state.now || this.game.currentTime || 0;
        const endTime = currentTime + this.rageDuration;
        
        this.game.addComponent(casterEntity, this.componentTypes.BUFF, 
            Components.Buff(
                'rage', 
                { 
                    damageMultiplier: this.damageMultiplier, 
                    attackSpeedMultiplier: this.attackSpeedMultiplier,
                    moveSpeedMultiplier: 1.1 // Slight movement speed bonus
                }, 
                endTime,     // Proper end time
                false,       // Not stackable
                1,           // Single stack
                currentTime  // Applied time
            )
        );
        
        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#ff4444', 0.4);
        }
        
        // Enhanced logging
        this.logAbilityUsage(casterEntity, 
            `Warrior enters a berserker rage, gaining ${Math.round((this.damageMultiplier - 1) * 100)}% damage!`);
            
        // Log to battle system
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (unitType && team) {
                this.game.battleLogSystem.add(
                    `${team.team} ${unitType.type} is consumed by primal fury!`,
                    'log-buff'
                );
            }
        }
        
        // Schedule buff expiration warning
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnRageEnding(casterEntity);
        }, this.rageDuration - 1.0, casterEntity);
    }
    
    // FIXED: Add rage ending warning for better gameplay feedback
    warnRageEnding(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        // Check if entity still exists and has the buff
        const buff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (!buff || buff.buffType !== 'rage') return;
        
        if (casterPos) {
            // Create fading effect
            this.createVisualEffect(casterPos, 'cast', { 
                count: 5, 
                color: 0x884444,
                scaleMultiplier: 0.8 
            });
        }
        
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (unitType && team) {
                this.game.battleLogSystem.add(
                    `${team.team} ${unitType.type}'s rage begins to fade...`,
                    'log-buff'
                );
            }
        }
    }
}