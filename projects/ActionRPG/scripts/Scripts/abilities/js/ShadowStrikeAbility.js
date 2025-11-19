class ShadowStrikeAbility extends engine.app.appClasses['BaseAbility'] {
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
        
        // Teleport behind target
        casterPos.x = teleportPos.x;
        casterPos.z = teleportPos.z;
        
        // Visual effect at new position after teleport
        this.createVisualEffect(teleportPos, 'teleport');
        
        // Deal critical backstab damage
        this.dealDamageWithEffects(casterEntity, targetId, this.backstabDamage, 'physical', {
            isCritical: true,
            criticalMultiplier: 2.0,
            isBackstab: true
        });
        
        // Backstab effect
        this.createVisualEffect(targetPos, 'backstab');
        
        // Screen effect for dramatic teleport
        if (this.game.effectsSystem) {
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