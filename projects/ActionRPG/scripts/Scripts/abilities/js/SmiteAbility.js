class SmiteAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'smite',
            name: 'Divine Smite',
            description: 'Calls down divine wrath upon the strongest enemy',
            cooldown: 6.0,
            range: 400,
            manaCost: 65,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 1.8,
            autoTrigger: 'strong_enemy',
            ...params
        });
        
        this.damage = 80;
        this.bonusDamageVsUndead = 2.0; // Double damage vs undead
        this.pillarDelay = 0.5; // Time between pillar and damage
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFD700,
                    colorRange: { start: 0xFFD700, end: 0xFFFACD },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.2
                }
            },
            smite: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFF8DC,
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.8
                }
            },
            pillar: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xF0E68C,
                    scaleMultiplier: 4.0,
                    speedMultiplier: 2.0
                }
            },
            divine_judgment: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFFFFE0,
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Target the strongest enemy (highest health) deterministically
        const target = this.findHighestHealthEnemyDeterministic(enemies);
        if (!target) return null;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Divine judgment descends from the heavens!`);
        
        // Schedule the divine smite after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performDivineSmite(casterEntity, target, targetPos);
        }, this.castTime, casterEntity);
    }
    
    performDivineSmite(casterEntity, targetId, originalTargetPos) {
        // Get current target position (target may have moved)
        const currentTargetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const targetPos = currentTargetPos || originalTargetPos; // Fallback to original position
        
        // Create pillar of light effect
        this.createVisualEffect(targetPos, 'pillar');
        
        // Create divine judgment aura effect
        this.createVisualEffect(targetPos, 'divine_judgment');
        
        // Screen flash and shake
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.5);
            this.game.effectsSystem.playScreenShake(0.3, 3);
        }
        
        this.logAbilityUsage(casterEntity, `A pillar of divine light appears!`);
        
        // Schedule the actual damage after pillar effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.applySmiteDamage(casterEntity, targetId, targetPos);
        }, this.pillarDelay, targetId);
    }
    
    applySmiteDamage(casterEntity, targetId, targetPos) {
        // Validate target still exists
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        if (!targetHealth || targetHealth.current <= 0) {
            this.logAbilityUsage(casterEntity, `Divine judgment finds no target!`);
            return;
        }
        
        // Calculate damage (bonus vs undead)
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        let damage = this.damage;
        let isUndeadTarget = false;
        
        if (targetUnitType && (
            targetUnitType.title.includes('undead') || 
            targetUnitType.title.includes('skeleton') ||
            targetUnitType.title.includes('zombie') ||
            targetUnitType.id.includes('undead')
        )) {
            damage = Math.floor(damage * this.bonusDamageVsUndead);
            isUndeadTarget = true;
        }
        
        // Apply divine damage
        this.dealDamageWithEffects(casterEntity, targetId, damage, this.element, {
            isSmite: true,
            isCritical: true,
            isAntiUndead: isUndeadTarget,
            criticalMultiplier: 1.5
        });
        
        // Create smite impact effect
        this.createVisualEffect(targetPos, 'smite');
      
    
    }
    
    // FIXED: Deterministic highest health enemy selection
    findHighestHealthEnemyDeterministic(enemies) {
        if (enemies.length === 0) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let strongest = null;
        let highestHealth = 0;
        
        // Process enemies in deterministic order
        sortedEnemies.forEach(enemyId => {
            const health = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            if (!health) return;
            
            // Use >= for consistent tie-breaking (first in sorted order wins when health is equal)
            if (health.current >= highestHealth) {
                highestHealth = health.current;
                strongest = enemyId;
            }
        });
        
        return strongest;
    }
    
    // Helper method to check if target is undead (for potential future use)
    isUndeadTarget(targetId) {
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        if (!targetUnitType) return false;
        
        return targetUnitType.title.includes('undead') || 
               targetUnitType.title.includes('skeleton') ||
               targetUnitType.title.includes('zombie') ||
               targetUnitType.id.includes('undead');
    }
    
    // Helper method to get effective damage against target
    getEffectiveDamage(targetId) {
        let damage = this.damage;
        
        if (this.isUndeadTarget(targetId)) {
            damage = Math.floor(damage * this.bonusDamageVsUndead);
        }
        
        return damage;
    }
}