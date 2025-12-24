class ArenaPresenceAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Arena Presence',
            description: 'Intimidate nearby enemies, reducing their damage and accuracy (does not stack)',
            cooldown: 10.0,
            range: 120,
            manaCost: 25,
            targetType: 'area',
            animation: 'cast',
            priority: 5,
            castTime: 1.2,
            ...abilityData
        });
        
        this.intimidationDuration = 15.0;
        this.damageReduction = 0.25; // 25% damage reduction
        this.accuracyReduction = 0.2; // 20% accuracy reduction
        this.fearRadius = this.range;
        this.element = 'psychological';
    }
    
    canExecute(casterEntity) {
        // Need enemies nearby to intimidate
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Gladiator's presence fills the arena with dread...`);
        
        // Schedule the intimidation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.unleashArenaPresence(casterEntity, enemies);
        }, this.castTime, casterEntity);
    }
    
    unleashArenaPresence(casterEntity, targetEnemies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;
        
        // Create intimidation aura effect
        this.playConfiguredEffects('aura', casterPos);

        // Create expanding presence wave
        this.playConfiguredEffects('burst', casterPos);
        
        // Sort enemies deterministically for consistent processing
        const sortedEnemies = targetEnemies.slice().sort((a, b) => a - b);
        
        let intimidatedCount = 0;
        let refreshedCount = 0;
        
        // Apply intimidation to each enemy in deterministic order
        sortedEnemies.forEach((enemyId, index) => {
            const intimidationResult = this.applyIntimidation(casterEntity, enemyId);
            
            if (intimidationResult.success) {
                if (intimidationResult.wasRefreshed) {
                    refreshedCount++;
                } else {
                    intimidatedCount++;
                }
                
                // Schedule staggered fear effects for visual appeal
                this.game.schedulingSystem.scheduleAction(() => {
                    const transform = this.game.getComponent(enemyId, "transform");
                    const enemyPos = transform?.position;
                    if (enemyPos) {
                        this.playConfiguredEffects('debuff', enemyPos);
                    }
                }, index * 0.1, enemyId);
            }
        });
        
        // Screen effects for dramatic presence
        if (this.game.effectsSystem && (intimidatedCount > 0 || refreshedCount > 0)) {
            this.game.effectsSystem.playScreenShake(0.4, 2);
            this.game.effectsSystem.playScreenFlash('#8B0000', 0.6);
        }
        
       
    }
    
    applyIntimidation(casterEntity, enemyId) {
        // Validate enemy still exists and is alive
        const enemyHealth = this.game.getComponent(enemyId, "health");
        const transform = this.game.getComponent(enemyId, "transform");
        const enemyPos = transform?.position;

        if (!enemyHealth || enemyHealth.current <= 0 || !enemyPos) {
            return { success: false, reason: 'target_invalid' };
        }
        
        // Check if already intimidated - don't stack multiple intimidations
        const enums = this.game.getEnums();
        const existingBuff = this.game.getComponent(enemyId, "buff");
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.intimidationDuration;

        if (existingBuff && existingBuff.buffType === enums.buffTypes.intimidated) {
            // Refresh duration instead of stacking
            existingBuff.endTime = endTime;
            existingBuff.appliedTime = currentTime;
            
         
            
            return { success: true, wasRefreshed: true };
        } else {
            // Apply new intimidation buff
            const Components = this.game.call('getComponents');

            this.game.addComponent(enemyId, "buff", {
                buffType: enums.buffTypes.intimidated,
                endTime: endTime,
                appliedTime: currentTime,
                stacks: 1,
                sourceEntity: casterEntity
            });
            
       
            
            return { success: true, wasRefreshed: false };
        }
    }
    
    // Helper method to check intimidation effectiveness
    getIntimidationEffectiveness(casterEntity, enemyId) {
        const casterCombat = this.game.getComponent(casterEntity, "combat");
        const enemyCombat = this.game.getComponent(enemyId, "combat");
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const enemyHealth = this.game.getComponent(enemyId, "health");
        
        if (!casterCombat || !enemyCombat || !casterHealth || !enemyHealth) {
            return 1.0; // Default effectiveness
        }
        
        // Calculate intimidation effectiveness based on relative power
        const casterPower = (casterCombat.damage || 1) * (casterHealth.current || 1);
        const enemyPower = (enemyCombat.damage || 1) * (enemyHealth.current || 1);
        
        const powerRatio = casterPower / Math.max(enemyPower, 1);
        
        // Effectiveness between 0.5 and 1.5 based on power difference
        return Math.max(0.5, Math.min(1.5, 0.7 + (powerRatio * 0.3)));
    }
    
    // Helper method to get current intimidation status
    getIntimidationStatus(enemyId) {
        const enums = this.game.getEnums();
        const buff = this.game.getComponent(enemyId, "buff");

        if (!buff || buff.buffType !== enums.buffTypes.intimidated) {
            return { isIntimidated: false };
        }
        
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const timeRemaining = Math.max(0, buff.endTime - currentTime);
        
        return {
            isIntimidated: true,
            timeRemaining: timeRemaining,
            damageReduction: buff.damageReduction || this.damageReduction,
            accuracyReduction: buff.accuracyReduction || this.accuracyReduction,
            intimidatedBy: buff.intimidatedBy
        };
    }
}
