class ArenaPresenceAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'arena_presence',
            name: 'Arena Presence',
            description: 'Intimidate nearby enemies, reducing their damage and accuracy (does not stack)',
            cooldown: 10.0,
            range: 120,
            manaCost: 25,
            targetType: 'area',
            animation: 'cast',
            priority: 5,
            castTime: 1.2,
            ...params
        });
        
        this.intimidationDuration = 15.0;
        this.damageReduction = 0.25; // 25% damage reduction
        this.accuracyReduction = 0.2; // 20% accuracy reduction
        this.fearRadius = this.range;
        this.element = 'psychological';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B0000,
                    colorRange: { start: 0x8B0000, end: 0xFF4500 },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.0
                }
            },
            intimidation_aura: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x800000,
                    scaleMultiplier: 2.5,
                    speedMultiplier: 0.6
                }
            },
            fear_effect: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4B0000,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            presence_wave: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x660000,
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Need enemies nearby to intimidate
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Gladiator's presence fills the arena with dread...`);
        
        // Schedule the intimidation after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.unleashArenaPresence(casterEntity, enemies);
        }, this.castTime, casterEntity);
    }
    
    unleashArenaPresence(casterEntity, targetEnemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Create intimidation aura effect
        this.createVisualEffect(casterPos, 'intimidation_aura');
        
        // Create expanding presence wave
        this.createVisualEffect(casterPos, 'presence_wave');
        
        // Sort enemies deterministically for consistent processing
        const sortedEnemies = targetEnemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
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
                    const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                    if (enemyPos) {
                        this.createVisualEffect(enemyPos, 'fear_effect');
                    }
                }, index * 0.1, enemyId);
            }
        });
        
        // Screen effects for dramatic presence
        if (this.game.effectsSystem && (intimidatedCount > 0 || refreshedCount > 0)) {
            this.game.effectsSystem.playScreenShake(0.4, 2);
            this.game.effectsSystem.playScreenFlash('#8B0000', 0.6);
        }
        
        // Enhanced logging
        if (intimidatedCount > 0 && refreshedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Gladiator intimidates ${intimidatedCount} enemies and renews fear in ${refreshedCount} others!`);
        } else if (intimidatedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Gladiator intimidates ${intimidatedCount} enemies!`);
        } else if (refreshedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Gladiator's presence renews fear in ${refreshedCount} enemies!`);
        } else {
            this.logAbilityUsage(casterEntity, 
                `The arena trembles, but enemies stand firm!`);
        }
        
        // Battle log integration
        if (this.game.battleLogSystem && (intimidatedCount > 0 || refreshedCount > 0)) {
            const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
            const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
            
            if (casterUnitType && casterTeam) {
                this.game.battleLogSystem.add(
                    `${casterTeam.team} ${casterUnitType.type} unleashes intimidating arena presence! (${intimidatedCount + refreshedCount} enemies affected)`,
                    'log-intimidation'
                );
            }
        }
    }
    
    applyIntimidation(casterEntity, enemyId) {
        // Validate enemy still exists and is alive
        const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
        const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
        
        if (!enemyHealth || enemyHealth.current <= 0 || !enemyPos) {
            return { success: false, reason: 'target_invalid' };
        }
        
        // Check if already intimidated - don't stack multiple intimidations
        const existingBuff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const endTime = currentTime + this.intimidationDuration;
        
        if (existingBuff && existingBuff.buffType === 'intimidated') {
            // Refresh duration instead of stacking
            existingBuff.endTime = endTime;
            existingBuff.appliedTime = currentTime;
            
            // Log individual refresh
            if (this.game.battleLogSystem) {
                const enemyUnitType = this.game.getComponent(enemyId, this.componentTypes.UNIT_TYPE);
                const enemyTeam = this.game.getComponent(enemyId, this.componentTypes.TEAM);
                
                if (enemyUnitType && enemyTeam) {
                    this.game.battleLogSystem.add(
                        `${enemyTeam.team} ${enemyUnitType.type}'s fear is renewed!`,
                        'log-intimidation'
                    );
                }
            }
            
            return { success: true, wasRefreshed: true };
        } else {
            // Apply new intimidation buff
            const Components = this.game.componentManager.getComponents();
            
            this.game.addComponent(enemyId, this.componentTypes.BUFF, 
                Components.Buff(
                    'intimidated', 
                    { 
                        damageReduction: this.damageReduction,
                        accuracyReduction: this.accuracyReduction,
                        intimidatedBy: casterEntity,
                        fearLevel: 1
                    }, 
                    endTime,      // End time
                    false,        // Not stackable
                    1,            // Single stack
                    currentTime   // Applied time
                )
            );
            
            // Log individual intimidation
            if (this.game.battleLogSystem) {
                const enemyUnitType = this.game.getComponent(enemyId, this.componentTypes.UNIT_TYPE);
                const enemyTeam = this.game.getComponent(enemyId, this.componentTypes.TEAM);
                
                if (enemyUnitType && enemyTeam) {
                    this.game.battleLogSystem.add(
                        `${enemyTeam.team} ${enemyUnitType.type} is intimidated by arena presence!`,
                        'log-intimidation'
                    );
                }
            }
            
            return { success: true, wasRefreshed: false };
        }
    }
    
    // Helper method to check intimidation effectiveness
    getIntimidationEffectiveness(casterEntity, enemyId) {
        const casterCombat = this.game.getComponent(casterEntity, this.componentTypes.COMBAT);
        const enemyCombat = this.game.getComponent(enemyId, this.componentTypes.COMBAT);
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
        
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
        const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
        
        if (!buff || buff.buffType !== 'intimidated') {
            return { isIntimidated: false };
        }
        
        const currentTime = this.game.state.now || this.game.state.now || 0;
        const timeRemaining = Math.max(0, buff.endTime - currentTime);
        
        return {
            isIntimidated: true,
            timeRemaining: timeRemaining,
            damageReduction: buff.modifiers?.damageReduction || this.damageReduction,
            accuracyReduction: buff.modifiers?.accuracyReduction || this.accuracyReduction,
            intimidatedBy: buff.modifiers?.intimidatedBy
        };
    }
}