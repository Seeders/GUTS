class SmiteAbility extends GUTS.BaseAbility {
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
        this.logAbilityUsage(casterEntity, `Divine judgment descends from the heavens!`);
        
        // Schedule the divine smite after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performDivineSmite(casterEntity, target, targetPos);
        }, this.castTime, casterEntity);
    }
    
    performDivineSmite(casterEntity, targetId, originalTargetPos) {
        // Get current target position (target may have moved)
        const transform = this.game.getComponent(targetId, "transform");
        const currentTargetPos = transform?.position;
        const targetPos = currentTargetPos || originalTargetPos; // Fallback to original position

        // Create pillar of light effect
        this.createVisualEffect(targetPos, 'pillar');

        // Create divine judgment aura effect
        this.createVisualEffect(targetPos, 'divine_judgment');

        // Enhanced divine pillar descending from sky (client only)
        if (!this.game.isServer) {
            // Pillar of golden light descending
            const pillarSteps = 8;
            for (let i = 0; i < pillarSteps; i++) {
                const delay = i * 0.05;
                const height = 300 - (i * 35);

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.call('createParticles', {
                        position: new THREE.Vector3(targetPos.x, targetPos.y + height, targetPos.z),
                        count: 15,
                        lifetime: 0.4,
                        visual: {
                            color: 0xffd700,
                            colorRange: { start: 0xffffff, end: 0xffa500 },
                            scale: 20,
                            scaleMultiplier: 1.8,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-30, 30], y: [-150, -80], z: [-30, 30] },
                        gravity: 100,
                        drag: 0.9,
                        emitterShape: 'ring',
                        emitterRadius: 15
                    });
                }, delay, targetId);
            }

            // Warning ring on ground
            this.game.call('createParticles', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 5, targetPos.z),
                count: 24,
                lifetime: 0.6,
                visual: {
                    color: 0xffd700,
                    colorRange: { start: 0xffffff, end: 0xffaa00 },
                    scale: 15,
                    scaleMultiplier: 1.2,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-10, 10], y: [20, 60], z: [-10, 10] },
                gravity: -20,
                drag: 0.95,
                emitterShape: 'ring',
                emitterRadius: 40
            });

            // Holy symbols/sparkles rising
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 20, targetPos.z),
                layers: [
                    // Golden core glow
                    {
                        count: 10,
                        lifetime: 0.5,
                        color: 0xffd700,
                        colorRange: { start: 0xffffff, end: 0xffa500 },
                        scale: 30,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-20, 20], y: [50, 120], z: [-20, 20] },
                        gravity: -30,
                        drag: 0.85,
                        blending: 'additive'
                    },
                    // White divine sparkles
                    {
                        count: 20,
                        lifetime: 0.7,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffffcc },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-60, 60], y: [80, 180], z: [-60, 60] },
                        gravity: -50,
                        drag: 0.92,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Screen flash and shake (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
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
        const targetHealth = this.game.getComponent(targetId, "health");
        if (!targetHealth || targetHealth.current <= 0) {
            this.logAbilityUsage(casterEntity, `Divine judgment finds no target!`);
            return;
        }
        
        // Calculate damage (bonus vs undead)
        const targetUnitType = this.game.getComponent(targetId, "unitType");
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

        // Enhanced divine explosion on impact (client only)
        if (!this.game.isServer) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 20, targetPos.z),
                layers: [
                    // Blinding flash
                    {
                        count: 8,
                        lifetime: 0.2,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffd700 },
                        scale: 50,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-50, 50], y: [20, 80], z: [-50, 50] },
                        gravity: 0,
                        drag: 0.7,
                        blending: 'additive'
                    },
                    // Golden explosion
                    {
                        count: 25,
                        lifetime: 0.5,
                        color: 0xffd700,
                        colorRange: { start: 0xffffff, end: 0xff8800 },
                        scale: 18,
                        scaleMultiplier: 1.5,
                        velocityRange: { x: [-100, 100], y: [50, 150], z: [-100, 100] },
                        gravity: 150,
                        drag: 0.93,
                        blending: 'additive'
                    },
                    // Holy embers
                    {
                        count: 15,
                        lifetime: 0.8,
                        color: 0xffffaa,
                        colorRange: { start: 0xffffff, end: 0xffcc00 },
                        scale: 6,
                        scaleMultiplier: 0.5,
                        velocityRange: { x: [-80, 80], y: [100, 200], z: [-80, 80] },
                        gravity: 100,
                        drag: 0.96,
                        blending: 'additive'
                    }
                ]
            });
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
        const targetUnitType = this.game.getComponent(targetId, "unitType");
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