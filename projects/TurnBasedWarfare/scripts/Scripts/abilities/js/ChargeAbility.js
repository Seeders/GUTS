class ChargeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'charge',
            name: 'Charge',
            description: 'Rush forward dealing damage and stunning enemies',
            cooldown: 5.0,
            range: 150,
            manaCost: 0,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.5,
            ...params
        });
        
        this.chargeDamage = 55;
        this.chargeSpeed = 300;
        this.chargeDuration = 0.8; // How long the charge takes
        this.stunDuration = 2.0; // How long enemies are stunned
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xC0C0C0,
                    colorRange: { start: 0xC0C0C0, end: 0xFFFFFF },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            charge: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x8B4513,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 3.0
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 10,
                    color: 0xFF4500,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Don't charge if already charging
        const charging = this.game.getComponent(casterEntity, this.componentTypes.CHARGING);
        if (charging && charging.isCharging) return false;
        
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Select closest enemy deterministically
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Knight charges into battle!", true);
        
        // DESYNC SAFE: Use scheduling system for charge execution
        this.game.schedulingSystem.scheduleAction(() => {
            this.initiateCharge(casterEntity, target);
        }, this.castTime, casterEntity);
    }
    
    // DESYNC SAFE: Find closest enemy deterministically
    findClosestEnemy(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = enemyId;
            }
        });
        
        return closest;
    }
    
    initiateCharge(casterEntity, targetId) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const velocity = this.game.getComponent(casterEntity, this.componentTypes.VELOCITY);
        
        if (!pos || !targetPos || !velocity) return;
        
        // DESYNC SAFE: Calculate charge direction deterministically
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance === 0) return; // Avoid division by zero
        
        // DESYNC SAFE: Add charging component for state tracking
        const Components = this.game.componentManager.getComponents();
        this.game.addComponent(casterEntity, this.componentTypes.CHARGING, 
            Components.Charging(targetId, this.chargeSpeed, this.chargeDamage, 
                this.game.currentTime, 0, distance));
        
        // Set velocity for charge
        velocity.vx = (dx / distance) * this.chargeSpeed;
        velocity.vz = (dz / distance) * this.chargeSpeed;
        
        // Visual charge effect
        this.createVisualEffect(pos, 'charge');
        
        // Screen effect for dramatic charge
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.2, 1);
        }
        
        // DESYNC SAFE: Schedule charge completion
        this.game.schedulingSystem.scheduleAction(() => {
            this.completeCharge(casterEntity, targetId);
        }, this.chargeDuration, casterEntity);
    }
    
    completeCharge(casterEntity, targetId) {
        // Stop the charge by removing charging component and resetting velocity
        if (this.game.hasComponent(casterEntity, this.componentTypes.CHARGING)) {
            this.game.removeComponent(casterEntity, this.componentTypes.CHARGING);
        }
        
        // Stop movement
        const velocity = this.game.getComponent(casterEntity, this.componentTypes.VELOCITY);
        if (velocity) {
            velocity.vx = 0;
            velocity.vz = 0;
        }
        
        // Check if target still exists and is in range for impact
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        
        if (!casterPos || !targetPos || !targetHealth || targetHealth.current <= 0) return;
        
        // Check if we're close enough to hit the target
        const distance = Math.sqrt(
            Math.pow(targetPos.x - casterPos.x, 2) + 
            Math.pow(targetPos.z - casterPos.z, 2)
        );
        
        if (distance <= 50) { // Hit range
            // Visual impact effect
            this.createVisualEffect(targetPos, 'impact');
            
            // Deal damage
            this.dealDamageWithEffects(casterEntity, targetId, this.chargeDamage, 'physical', {
                isCharge: true,
                knockback: true
            });
            
            // DESYNC SAFE: Apply stun using buff system
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(targetId, this.componentTypes.BUFF, 
                Components.Buff('stunned', { 
                    movementDisabled: true, 
                    attackDisabled: true 
                }, this.game.currentTime + this.stunDuration, false, 1, this.game.currentTime));
            
            // DESYNC SAFE: Schedule stun removal
            this.game.schedulingSystem.scheduleAction(() => {
                this.removeStun(targetId);
            }, this.stunDuration, targetId);
            
            // Screen effect for impact
            if (this.game.effectsSystem) {
                this.game.effectsSystem.playScreenShake(0.4, 2);
            }
            
            // Log successful charge
            if (this.game.battleLogSystem) {
                const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
                if (targetUnitType) {
                    this.game.battleLogSystem.add(
                        `Knight's charge strikes ${targetUnitType.type} with devastating force!`,
                        'log-ability'
                    );
                }
            }
        } else {
            // Charge missed - log it
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `Knight's charge misses its target!`,
                    'log-ability'
                );
            }
        }
    }
    
    // DESYNC SAFE: Remove stun effect
    removeStun(targetId) {
        // Check if target still exists and has the stun buff
        if (this.game.hasComponent(targetId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(targetId, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'stunned') {
                this.game.removeComponent(targetId, this.componentTypes.BUFF);
                
                // Visual effect when stun expires
                const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
                if (targetPos) {
                    this.createVisualEffect(targetPos, 'cast', { 
                        count: 3, 
                        scaleMultiplier: 0.8,
                        color: 0x87CEEB 
                    });
                }
                
                // Log stun expiration
                if (this.game.battleLogSystem) {
                    const unitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
                    if (unitType) {
                        this.game.battleLogSystem.add(
                            `${unitType.type} recovers from being stunned.`,
                            'log-ability'
                        );
                    }
                }
            }
        }
    }
    
    // Helper method to handle charge interruption (e.g., if caster dies mid-charge)
    cancelCharge(casterEntity) {
        if (this.game.hasComponent(casterEntity, this.componentTypes.CHARGING)) {
            this.game.removeComponent(casterEntity, this.componentTypes.CHARGING);
            
            // Stop movement
            const velocity = this.game.getComponent(casterEntity, this.componentTypes.VELOCITY);
            if (velocity) {
                velocity.vx = 0;
                velocity.vz = 0;
            }
        }
    }
}