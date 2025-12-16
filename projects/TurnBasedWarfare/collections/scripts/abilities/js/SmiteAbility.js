class SmiteAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'smite',
            name: 'Holy Smite',
            description: 'Calls down holy wrath upon the strongest enemy',
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
        this.element = 'holy';
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
            holy_judgment: {
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Target the strongest enemy (highest health) deterministically
        const target = this.findHighestHealthEnemyDeterministic(enemies);
        if (!target) return null;
        
        const targetTransform = this.game.getComponent(target, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Holy judgment descends from the heavens!`);

        // Schedule the holy smite after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performHolySmite(casterEntity, target, targetPos);
        }, this.castTime, casterEntity);
    }
    
    performHolySmite(casterEntity, targetId, originalTargetPos) {
        // Get current target position (target may have moved)
        const transform = this.game.getComponent(targetId, "transform");
        const currentTargetPos = transform?.position;
        const targetPos = currentTargetPos || originalTargetPos; // Fallback to original position

        // Create pillar of light effect
        this.createVisualEffect(targetPos, 'pillar');

        // Create holy judgment aura effect
        this.createVisualEffect(targetPos, 'holy_judgment');

        // Use preset particle effects (client only)
        if (!this.game.isServer) {
            const pos = new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);

            // Pillar of golden light descending using preset effect
            const pillarSteps = 8;
            for (let i = 0; i < pillarSteps; i++) {
                const delay = i * 0.05;
                const height = 300 - (i * 35);

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.call('playEffect', 'holy_pillar',
                        new THREE.Vector3(targetPos.x, targetPos.y + height, targetPos.z));
                }, delay, targetId);
            }

            // Warning ring on ground
            this.game.call('playEffect', 'holy_ring', pos);

            // Holy sparkles rising
            this.game.call('playEffect', 'holy_light', new THREE.Vector3(pos.x, pos.y + 20, pos.z));
            this.game.call('playEffect', 'holy_sparkles', new THREE.Vector3(pos.x, pos.y + 20, pos.z));
        }

        // Screen flash and shake (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.5);
            this.game.effectsSystem.playScreenShake(0.3, 3);
        }

        this.logAbilityUsage(casterEntity, `A pillar of holy light appears!`);

        // Schedule the actual damage after pillar effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.applySmiteDamage(casterEntity, targetId, targetPos);
        }, this.pillarDelay, targetId);
    }
    
    applySmiteDamage(casterEntity, targetId, targetPos) {
        // Validate target still exists
        const targetHealth = this.game.getComponent(targetId, "health");
        if (!targetHealth || targetHealth.current <= 0) {
            this.logAbilityUsage(casterEntity, `Holy judgment finds no target!`);
            return;
        }
        
        // Calculate damage (bonus vs undead)
        const targetUnitTypeComp = this.game.getComponent(targetId, "unitType");
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        let damage = this.damage;
        let isUndeadTarget = false;

        if (targetUnitType && (
            targetUnitType.title?.includes('undead') ||
            targetUnitType.title?.includes('skeleton') ||
            targetUnitType.title?.includes('zombie') ||
            targetUnitType.id?.includes('undead')
        )) {
            damage = Math.floor(damage * this.bonusDamageVsUndead);
            isUndeadTarget = true;
        }
        
        // Apply holy damage
        this.dealDamageWithEffects(casterEntity, targetId, damage, this.element, {
            isSmite: true,
            isCritical: true,
            isAntiUndead: isUndeadTarget,
            criticalMultiplier: 1.5
        });
        
        // Create smite impact effect
        this.createVisualEffect(targetPos, 'smite');

        // Use preset holy_smite effect system for impact (client only)
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'holy_smite',
                new THREE.Vector3(targetPos.x, targetPos.y + 20, targetPos.z));
        }
    }
    
    // FIXED: Deterministic highest health enemy selection
    findHighestHealthEnemyDeterministic(enemies) {
        if (enemies.length === 0) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let strongest = null;
        let highestHealth = 0;
        
        // Process enemies in deterministic order
        sortedEnemies.forEach(enemyId => {
            const health = this.game.getComponent(enemyId, "health");
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
        const targetUnitTypeComp = this.game.getComponent(targetId, "unitType");
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        if (!targetUnitType) return false;

        return targetUnitType.title?.includes('undead') ||
               targetUnitType.title?.includes('skeleton') ||
               targetUnitType.title?.includes('zombie') ||
               targetUnitType.id?.includes('undead');
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
