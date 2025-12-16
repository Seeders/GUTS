class ChargeAbility extends GUTS.BaseAbility {
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
                    count: 3,
                    color: 0xC0C0C0,
                    colorRange: { start: 0xC0C0C0, end: 0xFFFFFF },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            charge: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B4513,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 3.0
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 3,
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
        const charging = this.game.getComponent(casterEntity, "charging");
        if (charging && charging.isCharging) return false;
        
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let closest = null;
        let closestDistance = Infinity;
        
        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
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
        const transform1 = this.game.getComponent(casterEntity, "transform");
        const pos = transform1?.position;
        const transform2 = this.game.getComponent(targetId, "transform");
        const targetPos = transform2?.position;
        const velocity = this.game.getComponent(casterEntity, "velocity");

        if (!pos || !targetPos || !velocity) return;
        
        // DESYNC SAFE: Calculate charge direction deterministically
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance === 0) return; // Avoid division by zero
        
        // DESYNC SAFE: Add charging component for state tracking
        this.game.addComponent(casterEntity, "charging", {
            target: targetId,
            chargeSpeed: this.chargeSpeed,
            chargeDamage: this.chargeDamage,
            chargeStartTime: this.game.state.now,
            chargeDistance: 0,
            maxChargeDistance: distance,
            isCharging: 1
        });
        
        // Set velocity for charge
        velocity.vx = (dx / distance) * this.chargeSpeed;
        velocity.vz = (dz / distance) * this.chargeSpeed;
        
        // Visual charge effect
        this.createVisualEffect(pos, 'charge');

        // Enhanced charge initiation - dust burst and battle cry using preset effect
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'charge_initiate',
                new THREE.Vector3(pos.x, pos.y + 10, pos.z));

            // Create dust trail during charge using preset effects
            const trailSteps = 6;
            for (let i = 1; i <= trailSteps; i++) {
                const delay = (this.chargeDuration / trailSteps) * i * 0.5;
                const progress = i / trailSteps;
                const trailX = pos.x + (targetPos.x - pos.x) * progress;
                const trailZ = pos.z + (targetPos.z - pos.z) * progress;

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.call('playEffect', 'charge_dust_trail',
                        new THREE.Vector3(trailX, pos.y + 5, trailZ));
                }, delay, casterEntity);
            }
        }

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
        if (this.game.hasComponent(casterEntity, "charging")) {
            this.game.removeComponent(casterEntity, "charging");
        }

        // Stop movement
        const velocity = this.game.getComponent(casterEntity, "velocity");
        if (velocity) {
            velocity.vx = 0;
            velocity.vz = 0;
        }

        // Check if target still exists and is in range for impact
        const transform1 = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform1?.position;
        const transform2 = this.game.getComponent(targetId, "transform");
        const targetPos = transform2?.position;
        const targetHealth = this.game.getComponent(targetId, "health");

        if (!casterPos || !targetPos || !targetHealth || targetHealth.current <= 0) return;
        
        // Check if we're close enough to hit the target
        const distance = Math.sqrt(
            Math.pow(targetPos.x - casterPos.x, 2) + 
            Math.pow(targetPos.z - casterPos.z, 2)
        );
        
        if (distance <= 50) { // Hit range
            // Visual impact effect
            this.createVisualEffect(targetPos, 'impact');

            // Enhanced massive impact explosion using preset effect
            if (!this.game.isServer) {
                this.game.call('playEffectSystem', 'charge_impact',
                    new THREE.Vector3(targetPos.x, targetPos.y + 20, targetPos.z));

                // Ground crack ring using preset effect
                this.game.call('playEffect', 'ground_crack_ring',
                    new THREE.Vector3(targetPos.x, targetPos.y + 3, targetPos.z));
            }

            // Deal damage
            this.dealDamageWithEffects(casterEntity, targetId, this.chargeDamage, this.enums.element.physical, {
                isCharge: true,
                knockback: true
            });

            // DESYNC SAFE: Apply stun using buff system
            const enums = this.game.getEnums();
            this.game.addComponent(targetId, "buff", {
                buffType: enums.buffTypes.stunned,
                endTime: this.game.state.now + this.stunDuration,
                appliedTime: this.game.state.now,
                stacks: 1,
                sourceEntity: casterEntity
            });

            // DESYNC SAFE: Schedule stun removal
            this.game.schedulingSystem.scheduleAction(() => {
                this.removeStun(targetId);
            }, this.stunDuration, targetId);

            // Screen effect for impact
            if (this.game.effectsSystem) {
                this.game.effectsSystem.playScreenShake(0.4, 2);
            }
        }
    }
    
    // DESYNC SAFE: Remove stun effect
    removeStun(targetId) {
        // Check if target still exists and has the stun buff
        const enums = this.game.getEnums();
        if (this.game.hasComponent(targetId, "buff")) {
            const buff = this.game.getComponent(targetId, "buff");
            if (buff && buff.buffType === enums.buffTypes.stunned) {
                this.game.removeComponent(targetId, "buff");

                // Visual effect when stun expires
                const transform = this.game.getComponent(targetId, "transform");
                const targetPos = transform?.position;
                if (targetPos) {
                    this.createVisualEffect(targetPos, 'cast', { 
                        count: 3, 
                        scaleMultiplier: 0.8,
                        color: 0x87CEEB 
                    });
                }
          
            }
        }
    }
    
    // Helper method to handle charge interruption (e.g., if caster dies mid-charge)
    cancelCharge(casterEntity) {
        if (this.game.hasComponent(casterEntity, "charging")) {
            this.game.removeComponent(casterEntity, "charging");

            // Stop movement
            const velocity = this.game.getComponent(casterEntity, "velocity");
            if (velocity) {
                velocity.vx = 0;
                velocity.vz = 0;
            }
        }
    }
}
