class ShadowStrikeAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'shadow_strike',
            name: 'Shadow Strike',
            description: 'Teleport behind an enemy and deal critical damage',
            cooldown: 9.0,
            range: 120,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.5,
            ...params
        });
        this.backstabDamage = 65;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x2F2F2F,
                    colorRange: { start: 0x2F2F2F, end: 0x000000 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            },
            teleport: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B0000,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 3.0
                }
            },
            backstab: {
                type: 'damage',
                options: {
                    count: 3,
                    color: 0xFF0000,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Select target deterministically (closest enemy)
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Rogue strikes from the shadows!");
        
        // DESYNC SAFE: Use scheduling system for teleport and attack
        this.game.schedulingSystem.scheduleAction(() => {
            this.performShadowStrike(casterEntity, target);
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
    
    performShadowStrike(casterEntity, targetId) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);

        if (!casterPos || !targetPos) return;

        // DESYNC SAFE: Calculate teleport position deterministically
        const teleportPos = this.calculateTeleportPosition(targetPos);

        // Visual effect at original position before teleport
        this.createVisualEffect(casterPos, 'teleport');

        // Enhanced shadow dissolution effect at departure (client only)
        if (!this.game.isServer && this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 30, casterPos.z),
                layers: [
                    // Dark smoke burst
                    {
                        count: 20,
                        lifetime: 0.6,
                        color: 0x1a1a1a,
                        colorRange: { start: 0x333333, end: 0x000000 },
                        scale: 25,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-80, 80], y: [30, 100], z: [-80, 80] },
                        gravity: -30,
                        drag: 0.9,
                        blending: 'normal'
                    },
                    // Purple shadow wisps
                    {
                        count: 15,
                        lifetime: 0.5,
                        color: 0x6622aa,
                        colorRange: { start: 0x8844cc, end: 0x220066 },
                        scale: 12,
                        scaleMultiplier: 1.5,
                        velocityRange: { x: [-60, 60], y: [50, 120], z: [-60, 60] },
                        gravity: -50,
                        drag: 0.92,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Teleport behind target
        casterPos.x = teleportPos.x;
        casterPos.z = teleportPos.z;

        // Visual effect at new position after teleport
        this.createVisualEffect(teleportPos, 'teleport');

        // Enhanced shadow coalesce effect at arrival (client only)
        if (!this.game.isServer && this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(teleportPos.x, teleportPos.y + 30, teleportPos.z),
                layers: [
                    // Shadow gathering inward
                    {
                        count: 18,
                        lifetime: 0.4,
                        color: 0x2a2a2a,
                        colorRange: { start: 0x444444, end: 0x111111 },
                        scale: 20,
                        scaleMultiplier: 0.3,
                        velocityRange: { x: [-40, 40], y: [-20, 40], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.85,
                        blending: 'normal'
                    },
                    // Dark red malice
                    {
                        count: 12,
                        lifetime: 0.3,
                        color: 0x880000,
                        colorRange: { start: 0xaa2222, end: 0x440000 },
                        scale: 15,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-50, 50], y: [20, 80], z: [-50, 50] },
                        gravity: -20,
                        drag: 0.88,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Deal critical backstab damage
        this.dealDamageWithEffects(casterEntity, targetId, this.backstabDamage, 'physical', {
            isCritical: true,
            criticalMultiplier: 2.0,
            isBackstab: true
        });

        // Backstab effect
        this.createVisualEffect(targetPos, 'backstab');

        // Enhanced backstab blood/shadow burst (client only)
        if (!this.game.isServer && this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 25, targetPos.z),
                layers: [
                    // Blood spray
                    {
                        count: 20,
                        lifetime: 0.5,
                        color: 0xcc0000,
                        colorRange: { start: 0xff2222, end: 0x880000 },
                        scale: 10,
                        scaleMultiplier: 0.8,
                        velocityRange: { x: [-80, 80], y: [40, 120], z: [-80, 80] },
                        gravity: 200,
                        drag: 0.94,
                        blending: 'normal'
                    },
                    // Dark energy slash
                    {
                        count: 10,
                        lifetime: 0.3,
                        color: 0x440044,
                        colorRange: { start: 0x660066, end: 0x220022 },
                        scale: 25,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-30, 30], y: [10, 50], z: [-30, 30] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Screen effect for dramatic teleport (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.2, 1.5);
        }
    }
    
    // DESYNC SAFE: Calculate teleport position deterministically
    calculateTeleportPosition(targetPos) {
        // Try positions behind the target in a deterministic order
        const offsets = [
            { x: -25, z: -25 }, // Behind and to the left
            { x: -25, z: 0 },   // Directly behind
            { x: -25, z: 25 },  // Behind and to the right
            { x: 0, z: -25 },   // To the left
            { x: 0, z: 25 },    // To the right
        ];
        
        // Use the first valid position
        for (const offset of offsets) {
            const testPos = {
                x: targetPos.x + offset.x,
                y: targetPos.y,
                z: targetPos.z + offset.z
            };
            
            if (this.isValidTeleportPosition(testPos)) {
                return testPos;
            }
        }
        
        // Fallback position if no valid position found
        return {
            x: targetPos.x - 25,
            y: targetPos.y,
            z: targetPos.z - 25
        };
    }
    
    isValidTeleportPosition(pos) {
        // Basic validation - ensure position is within reasonable bounds
        // This could be enhanced with collision detection if needed
        return pos.x >= -1000 && pos.x <= 1000 && pos.z >= -1000 && pos.z <= 1000;
    }
}