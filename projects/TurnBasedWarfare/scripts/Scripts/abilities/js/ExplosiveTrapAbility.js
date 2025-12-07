class ExplosiveTrapAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'explosive_trap',
            name: 'Explosive Trap',
            description: 'Place a hidden trap that explodes when enemies approach (max 2 per Trapper)',
            cooldown: 15.0,
            range: 100,
            manaCost: 35,
            targetType: 'ground',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        
        this.maxTrapsPerTrapper = 2;
        this.trapDamage = 80;
        this.explosionRadius = 100;
        this.triggerRadius = 40;
        this.trapPlacementDistance = 60;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B4513,
                    colorRange: { start: 0x8B4513, end: 0xA0522D },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            },
            trap_place: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x696969,
                    scaleMultiplier: 0.8,
                    speedMultiplier: 1.0
                }
            },
            trap_explosion: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xFF4500,
                    colorRange: { start: 0xFF4500, end: 0xFF8C00 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 2.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // DESYNC SAFE: Check how many traps this trapper already has active
        const existingTraps = this.game.getEntitiesWith(
            "trap",
            "transform"
        );
        
        // Sort traps for consistent processing
        const sortedTraps = existingTraps.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        const myTraps = sortedTraps.filter(trapId => {
            const trap = this.game.getComponent(trapId, "trap");
            return trap && trap.caster === casterEntity && !trap.triggered;
        });
        
        return myTraps.length < this.maxTrapsPerTrapper;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Trapper prepares an explosive surprise!");
        
        // DESYNC SAFE: Use scheduling system for trap placement
        this.game.schedulingSystem.scheduleAction(() => {
            this.placeTrap(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    placeTrap(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Calculate trap position deterministically
        const trapPos = this.calculateTrapPosition(casterEntity, pos);
        
        // Create trap entity
        const trapId = this.game.createEntity();

        // Transform component
        this.game.addComponent(trapId, "transform", {
            position: { x: trapPos.x, y: trapPos.y, z: trapPos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        // DESYNC SAFE: Trap component with proper game time
        this.game.addComponent(trapId, "trap", {
            damage: this.trapDamage,
            radius: this.explosionRadius,
            triggerRadius: this.triggerRadius,
            element: 'physical',
            caster: casterEntity,
            triggered: false,
            triggerCount: 0,
            maxTriggers: 1
        });

        // Visual indicator (hidden from enemies in actual gameplay)
        this.game.addComponent(trapId, "renderable", {
            objectType: "effects",
            spawnType: "hidden_trap",
            capacity: 128
        });

        // DESYNC SAFE: Add lifetime to prevent permanent traps
        this.game.addComponent(trapId, "lifetime", {
            duration: 60.0,
            startTime: this.game.state.now
        });
        
        // Visual trap placement effect
        this.createVisualEffect(trapPos, 'trap_place');
        
      
        // DESYNC SAFE: Schedule trap cleanup after lifetime
        this.game.schedulingSystem.scheduleAction(() => {
            this.cleanupTrap(trapId);
        }, 60.0, trapId);
    }
    
    // DESYNC SAFE: Calculate trap position deterministically
    calculateTrapPosition(casterEntity, casterPos) {
        // Get facing direction from transform for consistent placement
        const transform = this.game.getComponent(casterEntity, "transform");
        const facingAngle = transform?.rotation?.y || 0;

        // Calculate position ahead of caster
        const trapPos = {
            x: casterPos.x + Math.cos(facingAngle) * this.trapPlacementDistance,
            y: casterPos.y,
            z: casterPos.z + Math.sin(facingAngle) * this.trapPlacementDistance
        };
        
        // DESYNC SAFE: Validate position and adjust if needed
        return this.validateTrapPosition(trapPos, casterPos);
    }
    
    // DESYNC SAFE: Validate and adjust trap position if needed
    validateTrapPosition(proposedPos, fallbackPos) {
        // Basic bounds checking
        if (proposedPos.x < -1000 || proposedPos.x > 1000 || 
            proposedPos.z < -1000 || proposedPos.z > 1000) {
            return fallbackPos; // Use caster position as fallback
        }
        
        // Check for existing traps nearby (prevent stacking)
        const existingTraps = this.game.getEntitiesWith(
            "trap",
            "transform"
        );
        
        for (const trapId of existingTraps) {
            const transform = this.game.getComponent(trapId, "transform");
            const trapPos = transform?.position;
            if (trapPos) {
                const distance = Math.sqrt(
                    Math.pow(trapPos.x - proposedPos.x, 2) + 
                    Math.pow(trapPos.z - proposedPos.z, 2)
                );
                
                if (distance < 30) { // Too close to existing trap
                    // Offset the position slightly
                    return {
                        x: proposedPos.x + 20,
                        y: proposedPos.y,
                        z: proposedPos.z + 20
                    };
                }
            }
        }
        
        return proposedPos; // Position is valid
    }
    
    // DESYNC SAFE: Handle trap trigger (called by game systems when enemy approaches)
    triggerTrap(trapId, triggeringEnemyId) {
        const trapComponent = this.game.getComponent(trapId, "trap");
        const transform = this.game.getComponent(trapId, "transform");
        const trapPos = transform?.position;
        
        if (!trapComponent || !trapPos || trapComponent.triggered) return;
        
        // Mark trap as triggered
        trapComponent.triggered = true;
        trapComponent.triggerCount++;
        
        // Visual explosion effect
        this.createVisualEffect(trapPos, 'trap_explosion');

        // Enhanced massive trap explosion (client only)
        if (!this.game.isServer && this.game.gameSystem) {
            this.game.call('createLayeredEffect', {
                position: new THREE.Vector3(trapPos.x, trapPos.y + 20, trapPos.z),
                layers: [
                    // Blinding flash
                    {
                        count: 10,
                        lifetime: 0.15,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffaa44 },
                        scale: 60,
                        scaleMultiplier: 4.0,
                        velocityRange: { x: [-40, 40], y: [30, 80], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.7,
                        blending: 'additive'
                    },
                    // Orange fireball
                    {
                        count: 35,
                        lifetime: 0.6,
                        color: 0xff6600,
                        colorRange: { start: 0xffaa44, end: 0xff3300 },
                        scale: 25,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-150, 150], y: [80, 200], z: [-150, 150] },
                        gravity: 200,
                        drag: 0.93,
                        blending: 'additive'
                    },
                    // Dark smoke
                    {
                        count: 25,
                        lifetime: 1.0,
                        color: 0x333333,
                        colorRange: { start: 0x555555, end: 0x111111 },
                        scale: 35,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-100, 100], y: [50, 150], z: [-100, 100] },
                        gravity: -30,
                        drag: 0.88,
                        blending: 'normal'
                    },
                    // Flying debris
                    {
                        count: 20,
                        lifetime: 0.8,
                        color: 0x8b4513,
                        colorRange: { start: 0xa0522d, end: 0x654321 },
                        scale: 8,
                        scaleMultiplier: 0.6,
                        velocityRange: { x: [-120, 120], y: [100, 250], z: [-120, 120] },
                        gravity: 500,
                        drag: 0.97,
                        blending: 'normal'
                    },
                    // Hot embers
                    {
                        count: 15,
                        lifetime: 1.2,
                        color: 0xff4400,
                        colorRange: { start: 0xffaa66, end: 0xcc2200 },
                        scale: 5,
                        scaleMultiplier: 0.4,
                        velocityRange: { x: [-80, 80], y: [120, 220], z: [-80, 80] },
                        gravity: 150,
                        drag: 0.98,
                        blending: 'additive'
                    }
                ]
            });

            // Ground scorch ring
            this.game.call('createParticles', {
                position: new THREE.Vector3(trapPos.x, trapPos.y + 3, trapPos.z),
                count: 24,
                lifetime: 0.6,
                visual: {
                    color: 0x886644,
                    colorRange: { start: 0xaa8866, end: 0x553322 },
                    scale: 18,
                    scaleMultiplier: 2.0,
                    fadeOut: true,
                    blending: 'normal'
                },
                velocityRange: { x: [-60, 60], y: [5, 20], z: [-60, 60] },
                gravity: 20,
                drag: 0.9,
                emitterShape: 'ring',
                emitterRadius: 50
            });
        }

        // Screen effects for dramatic explosion (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.showExplosionEffect(trapPos.x, trapPos.y, trapPos.z);
            this.game.effectsSystem.playScreenShake(0.3, 2);
        }
        
        // DESYNC SAFE: Apply explosion damage to all enemies in radius
        this.applyExplosionDamage(trapComponent.caster, trapPos, trapComponent);
        
        // DESYNC SAFE: Schedule trap cleanup after explosion
        this.game.schedulingSystem.scheduleAction(() => {
            this.cleanupTrap(trapId);
        }, 0.5, trapId); // Small delay for explosion effects
    }
    
    // DESYNC SAFE: Apply explosion damage deterministically
    applyExplosionDamage(casterId, explosionPos, trapComponent) {
        // Get all entities that could be damaged
        const allEntities = this.game.getEntitiesWith(
            "transform",
            "health",
            "team"
        );
        
        const casterTeam = this.game.getComponent(casterId, "team");
        if (!casterTeam) return;
        
        // Sort entities for consistent processing
        const sortedEntities = allEntities.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let damageTargets = [];
        
        sortedEntities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const entityPos = transform?.position;
            const entityHealth = this.game.getComponent(entityId, "health");
            const entityTeam = this.game.getComponent(entityId, "team");
            
            if (!entityPos || !entityHealth || !entityTeam || entityHealth.current <= 0) return;
            
            // Don't damage allies
            if (entityTeam.team === casterTeam.team) return;
            
            // Check if in explosion radius
            const distance = Math.sqrt(
                Math.pow(entityPos.x - explosionPos.x, 2) + 
                Math.pow(entityPos.z - explosionPos.z, 2)
            );
            
            if (distance <= trapComponent.radius) {
                damageTargets.push({
                    id: entityId,
                    distance: distance,
                    position: entityPos
                });
            }
        });
        
        // Apply damage to all targets
        damageTargets.forEach(target => {
            // Calculate damage falloff based on distance
            const damageMultiplier = Math.max(0.3, 1.0 - (target.distance / trapComponent.radius));
            const finalDamage = Math.floor(trapComponent.damage * damageMultiplier);
            
            this.dealDamageWithEffects(casterId, target.id, finalDamage, trapComponent.element, {
                isTrap: true,
                isExplosion: true
            });
        });
        
     
    }
    
    // DESYNC SAFE: Clean up trap entity
    cleanupTrap(trapId) {
        if (this.game.hasComponent(trapId, "trap")) {
            // Small visual effect for trap disappearing
            const transform = this.game.getComponent(trapId, "transform");
            const trapPos = transform?.position;
            if (trapPos) {
                this.createVisualEffect(trapPos, 'trap_place', { 
                    count: 2, 
                    scaleMultiplier: 0.5 
                });
            }
            
            this.game.destroyEntity(trapId);
        }
    }
    
    // Helper method for other systems to check trap count
    getActiveTrapCount(trapperId) {
        const existingTraps = this.game.getEntitiesWith(
            "trap",
            "transform"
        );
        
        return existingTraps.filter(trapId => {
            const trap = this.game.getComponent(trapId, "trap");
            return trap && trap.caster === trapperId && !trap.triggered;
        }).length;
    }
}