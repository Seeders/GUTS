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
            isCharging: true
        });
        
        // Set velocity for charge
        velocity.vx = (dx / distance) * this.chargeSpeed;
        velocity.vz = (dz / distance) * this.chargeSpeed;
        
        // Visual charge effect
        this.createVisualEffect(pos, 'charge');

        // Enhanced charge initiation - dust burst and battle cry
        if (!this.game.isServer) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(pos.x, pos.y + 10, pos.z),
                layers: [
                    // Ground dust burst
                    {
                        count: 25,
                        lifetime: 0.6,
                        color: 0x8b7355,
                        colorRange: { start: 0xa08060, end: 0x665544 },
                        scale: 20,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-80, 80], y: [20, 80], z: [-80, 80] },
                        gravity: 50,
                        drag: 0.92,
                        blending: 'normal'
                    },
                    // Metal glint from armor
                    {
                        count: 8,
                        lifetime: 0.3,
                        color: 0xcccccc,
                        colorRange: { start: 0xffffff, end: 0x888888 },
                        scale: 10,
                        scaleMultiplier: 1.5,
                        velocityRange: { x: [-40, 40], y: [40, 100], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.85,
                        blending: 'additive'
                    }
                ]
            });

            // Create dust trail during charge
            const trailSteps = 6;
            for (let i = 1; i <= trailSteps; i++) {
                const delay = (this.chargeDuration / trailSteps) * i * 0.5;
                const progress = i / trailSteps;
                const trailX = pos.x + (targetPos.x - pos.x) * progress;
                const trailZ = pos.z + (targetPos.z - pos.z) * progress;

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.call('createParticles', {
                        position: new THREE.Vector3(trailX, pos.y + 5, trailZ),
                        count: 12,
                        lifetime: 0.5,
                        visual: {
                            color: 0x8b7355,
                            colorRange: { start: 0x9a8265, end: 0x554433 },
                            scale: 15,
                            scaleMultiplier: 1.5,
                            fadeOut: true,
                            blending: 'normal'
                        },
                        velocityRange: { x: [-30, 30], y: [10, 40], z: [-30, 30] },
                        gravity: 30,
                        drag: 0.9
                    });
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

            // Enhanced massive impact explosion
            if (!this.game.isServer) {
                this.game.call('createLayeredEffect', {
                    position: new THREE.Vector3(targetPos.x, targetPos.y + 20, targetPos.z),
                    layers: [
                        // Shockwave flash
                        {
                            count: 10,
                            lifetime: 0.2,
                            color: 0xffffff,
                            colorRange: { start: 0xffffff, end: 0xffaa44 },
                            scale: 40,
                            scaleMultiplier: 3.0,
                            velocityRange: { x: [-60, 60], y: [20, 60], z: [-60, 60] },
                            gravity: 0,
                            drag: 0.7,
                            blending: 'additive'
                        },
                        // Orange impact sparks
                        {
                            count: 30,
                            lifetime: 0.6,
                            color: 0xff6600,
                            colorRange: { start: 0xffaa44, end: 0xcc4400 },
                            scale: 12,
                            scaleMultiplier: 1.0,
                            velocityRange: { x: [-120, 120], y: [60, 180], z: [-120, 120] },
                            gravity: 300,
                            drag: 0.95,
                            blending: 'additive'
                        },
                        // Dust cloud
                        {
                            count: 20,
                            lifetime: 0.8,
                            color: 0x8b7355,
                            colorRange: { start: 0xa08060, end: 0x554433 },
                            scale: 25,
                            scaleMultiplier: 2.5,
                            velocityRange: { x: [-100, 100], y: [30, 100], z: [-100, 100] },
                            gravity: 80,
                            drag: 0.9,
                            blending: 'normal'
                        },
                        // Metal debris
                        {
                            count: 12,
                            lifetime: 0.7,
                            color: 0xaaaaaa,
                            colorRange: { start: 0xcccccc, end: 0x666666 },
                            scale: 6,
                            scaleMultiplier: 0.6,
                            velocityRange: { x: [-80, 80], y: [80, 160], z: [-80, 80] },
                            gravity: 400,
                            drag: 0.97,
                            blending: 'normal'
                        }
                    ]
                });

                // Ground crack ring
                this.game.call('createParticles', {
                    position: new THREE.Vector3(targetPos.x, targetPos.y + 3, targetPos.z),
                    count: 20,
                    lifetime: 0.5,
                    visual: {
                        color: 0x665544,
                        colorRange: { start: 0x887766, end: 0x443322 },
                        scale: 15,
                        scaleMultiplier: 1.8,
                        fadeOut: true,
                        blending: 'normal'
                    },
                    velocityRange: { x: [-50, 50], y: [5, 15], z: [-50, 50] },
                    gravity: 20,
                    drag: 0.9,
                    emitterShape: 'ring',
                    emitterRadius: 30
                });
            }

            // Deal damage
            this.dealDamageWithEffects(casterEntity, targetId, this.chargeDamage, 'physical', {
                isCharge: true,
                knockback: true
            });

            // DESYNC SAFE: Apply stun using buff system
            this.game.addComponent(targetId, "buff", {
                buffType: 'stunned',
                modifiers: {
                    movementDisabled: true,
                    attackDisabled: true
                },
                endTime: this.game.state.now + this.stunDuration,
                stackable: false,
                stacks: 1,
                appliedTime: this.game.state.now,
                isActive: true
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
        if (this.game.hasComponent(targetId, "buff")) {
            const buff = this.game.getComponent(targetId, "buff");
            if (buff && buff.buffType === 'stunned') {
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