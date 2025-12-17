class RageAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });
        
        this.rageDuration = 8.0;
        this.damageMultiplier = 1.5;
        this.attackSpeedMultiplier = 1.3;
        this.element = this.enums.element.physical;
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
        this.playConfiguredEffects('cast', casterPos);
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
        this.playConfiguredEffects('buff', casterPos);

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
            this.playConfiguredEffects('expiration', casterPos);
        }
    }
}
