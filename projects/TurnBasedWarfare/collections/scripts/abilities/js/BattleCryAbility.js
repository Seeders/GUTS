class BattleCryAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'battle_cry',
            name: 'Battle Cry',
            description: 'Rally nearby allies, boosting their damage and morale (does not stack)',
            cooldown: 15.0,
            range: 150,
            manaCost: 40,
            targetType: 'allies',
            animation: 'cast',
            priority: 8,
            castTime: 1.0,
            ...abilityData
        });
        
        this.damageMultiplier = 1.3; // 30% damage boost
        this.duration = 20.0; // 20 seconds
    }

    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Only use if there are at least 2 allies to rally (including potentially the caster)
        return allies.length >= 2;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', casterPos);

        // DESYNC SAFE: Use scheduling system for the rally effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.performBattleCry(casterEntity);
        }, this.castTime, casterEntity);
        
        // Log immediately when cast starts
        const allies = this.getAlliesInRange(casterEntity);
        this.logAbilityUsage(casterEntity, `Warlord rallies ${allies.length} allies to battle!`, true);
    }
    
    performBattleCry(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        let ralliedCount = 0;
        
        sortedAllies.forEach(allyId => {
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            const allyHealth = this.game.getComponent(allyId, "health");

            // Only rally living allies
            if (!allyPos || !allyHealth || allyHealth.current <= 0) return;

            // DESYNC SAFE: Check if already rallied - don't stack multiple battle cries
            const enums = this.game.getEnums();
            const existingBuff = this.game.getComponent(allyId, "buff");

            if (existingBuff && existingBuff.buffType === enums.buffTypes.rallied) {
                // DESYNC SAFE: Refresh duration instead of stacking
                existingBuff.endTime = this.game.state.now + this.duration;
                existingBuff.appliedTime = this.game.state.now; // Update applied time
            } else {
                // Apply new rally buff
                this.game.addComponent(allyId, "buff", {
                    buffType: enums.buffTypes.rallied,
                    endTime: this.game.state.now + this.duration,
                    appliedTime: this.game.state.now,
                    stacks: 1,
                    sourceEntity: casterEntity
                });
            }
            
            // Visual rally effect on each ally
            this.playConfiguredEffects('buff', allyPos);

            // DESYNC SAFE: Schedule buff removal
            this.game.schedulingSystem.scheduleAction(() => {
                this.removeRallyBuff(allyId);
            }, this.duration, allyId);

            ralliedCount++;
        });

        // Screen effect for dramatic rally
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.4);
        }

        // Additional visual effect at caster position
        this.playConfiguredEffects('burst', casterPos);
    }
    
    // DESYNC SAFE: Remove rally buff
    removeRallyBuff(allyId) {
        // Check if ally still exists and has the rally buff
        const enums = this.game.getEnums();
        if (this.game.hasComponent(allyId, "buff")) {
            const buff = this.game.getComponent(allyId, "buff");
            if (buff && buff.buffType === enums.buffTypes.rallied) {
                this.game.removeComponent(allyId, "buff");

                // Visual effect when rally expires
                const transform = this.game.getComponent(allyId, "transform");
                const allyPos = transform?.position;
                if (allyPos) {
                    this.playConfiguredEffects('expiration', allyPos);
                }
            }
        }
    }
}
