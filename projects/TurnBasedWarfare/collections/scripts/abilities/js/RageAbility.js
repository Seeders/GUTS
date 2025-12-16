class RageAbility extends GUTS.BaseAbility {
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
        this.element = this.enums.element.physical;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: { 
                    count: 3, 
                    color: 0xff4444, 
                    colorRange: { start: 0xff4444, end: 0xff8800 },
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.5
                }
            },
            rage: {
                type: 'magic',
                options: { 
                    count: 3, 
                    color: 0xff0000, 
                    scaleMultiplier: 1.8,
                    speedMultiplier: 2.0
                }
            },
            fury: {
                type: 'magic',
                options: { 
                    count: 3, 
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
        const existingBuff = this.game.getComponent(casterEntity, "buff");
        const enums = this.game.getEnums();
        if (existingBuff && existingBuff.buffType === enums.buffTypes.rage) return false;
        
        return true;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        // Create dramatic rage effects
        this.createVisualEffect(casterPos, 'rage');

        // Enhanced rage activation with fiery burst using preset effect system
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'rage_buff',
                new THREE.Vector3(casterPos.x, casterPos.y + 30, casterPos.z));

            // Anger aura ring
            this.game.call('playEffect', 'rage_aura',
                new THREE.Vector3(casterPos.x, casterPos.y + 5, casterPos.z));
        }

        // Schedule a secondary fury effect for visual impact
        this.game.schedulingSystem.scheduleAction(() => {
            if (this.game.hasComponent && this.game.hasComponent(casterEntity, "position")) {
                const transform = this.game.getComponent(casterEntity, "transform");
                const pos = transform?.position;
                if (pos) {
                    this.createVisualEffect(pos, 'fury');
                }
            }
        }, 0.5, casterEntity);
        
        // Apply rage buff with proper timing
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.rageDuration;

        const enums = this.game.getEnums();
        this.game.addComponent(casterEntity, "buff", {
            buffType: enums.buffTypes.rage,
            endTime: endTime,
            appliedTime: currentTime,
            stacks: 1,
            sourceEntity: casterEntity
        });
        
        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#ff4444', 0.4);
        }
    
        
        // Schedule buff expiration warning
        this.game.schedulingSystem.scheduleAction(() => {
            this.warnRageEnding(casterEntity);
        }, this.rageDuration - 1.0, casterEntity);
    }
    
    // FIXED: Add rage ending warning for better gameplay feedback
    warnRageEnding(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        
        // Check if entity still exists and has the buff
        const buff = this.game.getComponent(casterEntity, "buff");
        const enums = this.game.getEnums();
        if (!buff || buff.buffType !== enums.buffTypes.rage) return;
        
        if (casterPos) {
            // Create fading effect
            this.createVisualEffect(casterPos, 'cast', { 
                count: 5, 
                color: 0x884444,
                scaleMultiplier: 0.8 
            });
        }
       
    }
}
