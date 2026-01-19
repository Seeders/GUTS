class BloodlustAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Bloodlust',
            description: 'Heal when dealing damage and gain stacking damage bonuses',
            cooldown: 5.0,
            range: 0,
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...abilityData
        });
        
        this.lifeStealAmount = 0.3; // 30% life steal
        this.damagePerKill = 5; // Damage bonus per kill
        this.maxStacks = 10; // Maximum kill stacks
        this.duration = 30.0; // 30 seconds duration
    }

    canExecute(casterEntity) {
        // Check if already has bloodlust active to prevent stacking
        const enums = this.game.getEnums();
        const existingBuff = this.game.getComponent(casterEntity, "buff");
        return !existingBuff || existingBuff.buffType !== enums.buffTypes.bloodlust;
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
        }, this.castTime, casterEntity);
    }
    
    activateBloodlust(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;

        // Check if already has bloodlust to prevent double application
        const enums = this.game.getEnums();
        const existingBuff = this.game.getComponent(casterEntity, "buff");
        if (existingBuff && existingBuff.buffType === enums.buffTypes.bloodlust) {
            // DESYNC SAFE: Refresh duration instead of stacking
            existingBuff.endTime = this.game.state.now + this.duration;
            existingBuff.appliedTime = this.game.state.now;

            // Visual refresh effect
            this.playConfiguredEffects('buff', casterPos);
            return;
        }

        // Apply bloodlust buff - static modifiers defined in buffTypes/bloodlust.json
        this.game.addComponent(casterEntity, "buff", {
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
        // Check if entity still exists and has the bloodlust buff
        const enums = this.game.getEnums();
        if (this.game.hasComponent(casterEntity, "buff")) {
            const buff = this.game.getComponent(casterEntity, "buff");
            if (buff && buff.buffType === enums.buffTypes.bloodlust) {
                this.game.removeComponent(casterEntity, "buff");

                // Visual effect when bloodlust expires
                const transform = this.game.getComponent(casterEntity, "transform");
                const casterPos = transform?.position;
                if (casterPos) {
                    this.playConfiguredEffects('expiration', casterPos);
                }
            }
        }
    }

    // Helper method to handle kill stacking (called by damage system when enemy dies)
    onEnemyKilled(killerId) {
        if (!this.game.hasComponent(killerId, "buff")) return;

        const enums = this.game.getEnums();
        const buff = this.game.getComponent(killerId, "buff");
        const buffTypeDef = this.game.call('getBuffTypeDef', buff.buffType);
        if (!buff || buff.buffType !== enums.buffTypes.bloodlust || !buffTypeDef) return;

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
