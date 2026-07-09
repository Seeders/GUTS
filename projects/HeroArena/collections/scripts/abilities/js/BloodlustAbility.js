class BloodlustAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'getBuffTypeDef'
    ];

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.lifeStealAmount = abilityData.lifeStealAmount ?? 0.3;
        this.damagePerKill   = abilityData.damagePerKill   ?? 5;
        this.maxStacks       = abilityData.maxStacks       ?? 10;
        this.duration        = abilityData.duration        ?? 30.0;
    }

    canExecute(casterEntity) {
        // Check if already has bloodlust active to prevent stacking
        const enums = this.game.getEnums();
        return !this.hasBuff(casterEntity, enums.buffTypes.bloodlust);
    }

    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Berserker enters a bloodthirsty frenzy!", true);
        
        // DESYNC SAFE: Use scheduling system for bloodlust activation
        this.game.schedulingSystem.scheduleAction(() => {
            this.activateBloodlust(casterEntity);
        }, 0, casterEntity); // payload at execute — queue already waited to the release point
    }
    
    activateBloodlust(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;

        // Check if already has bloodlust to prevent double application
        const enums = this.game.getEnums();
        const existingBuff = this.getBuff(casterEntity, enums.buffTypes.bloodlust);
        if (existingBuff) {
            // DESYNC SAFE: Refresh duration instead of stacking
            existingBuff.endTime = this.game.state.now + this.duration;
            existingBuff.appliedTime = this.game.state.now;

            // Visual refresh effect
            this.playConfiguredEffects('buff', casterPos);
            return;
        }

        // Apply bloodlust buff - static modifiers defined in buffTypes/bloodlust.json
        this.applyBuff(casterEntity, {
            buffType: enums.buffTypes.bloodlust,
            endTime: this.game.state.now + this.duration,
            appliedTime: this.game.state.now,
            stacks: 0, // Start with 0 kill stacks
            sourceEntity: casterEntity
        });

        // Visual bloodlust effect
        this.playConfiguredEffects('buff', casterPos);
        
        // Screen effect for dramatic activation
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.2, 1.5);
            this.game.effectsSystem.playScreenFlash('#8B0000', 0.3);
        }
        
        // DESYNC SAFE: Schedule buff removal
        this.game.schedulingSystem.scheduleAction(() => {
            this.removeBloodlust(casterEntity);
        }, this.duration, casterEntity);
        
 
    }
    
    // DESYNC SAFE: Remove bloodlust buff
    removeBloodlust(casterEntity) {
        // Expiry handled centrally by BuffEffectsSystem._reapExpiredBuffs.
        // Check if entity still exists and has the bloodlust buff
        const enums = this.game.getEnums();
        if (this.hasBuff(casterEntity, enums.buffTypes.bloodlust)) {
            // Visual effect when bloodlust expires
            const transform = this.game.getComponent(casterEntity, "transform");
            const casterPos = transform?.position;
            if (casterPos) {
                this.playConfiguredEffects('expiration', casterPos);
            }
        }
    }

    // Helper method to handle kill stacking (called by damage system when enemy dies)
    onEnemyKilled(killerId) {
        const enums = this.game.getEnums();
        const buff = this.getBuff(killerId, enums.buffTypes.bloodlust);
        if (!buff) return;

        const buffTypeDef = this.call.getBuffTypeDef( buff.buffType);
        if (!buffTypeDef) return;

        // Increase kill stacks up to maximum (maxStacks from buffType definition)
        const maxStacks = buffTypeDef.maxStacks || 10;
        if (buff.stacks < maxStacks) {
            buff.stacks++;

            // Visual effect for gaining a kill stack
            const transform = this.game.getComponent(killerId, "transform");
            const killerPos = transform?.position;
            if (killerPos) {
                this.playConfiguredEffects('stack', killerPos);
            }
        }
    }
}
