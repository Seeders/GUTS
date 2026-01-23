class ShadowStrikeAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'playEffectSystem'
    ];

    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Shadow Strike',
            description: 'Teleport behind an enemy and deal critical damage',
            cooldown: 9.0,
            range: 120,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'attack',
            priority: 8,
            castTime: 0.5,
            ...abilityData
        });
        this.backstabDamage = 65;
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Select target deterministically (closest enemy)
        const target = this.findClosestEnemy(casterEntity, enemies);
        if (!target) return;
        
        const targetTransform = this.game.getComponent(target, "transform");
        const targetPos = targetTransform?.position;
        if (!targetPos) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Rogue strikes from the shadows!");
        
        // DESYNC SAFE: Use scheduling system for teleport and attack
        this.game.schedulingSystem.scheduleAction(() => {
            this.performShadowStrike(casterEntity, target);
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
    
    performShadowStrike(casterEntity, targetId) {
        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterPos = casterTransform?.position;
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!casterPos || !targetPos) return;

        // DESYNC SAFE: Calculate teleport position deterministically
        const teleportPos = this.calculateTeleportPosition(targetPos);

        // Visual effect at original position before teleport
        this.playConfiguredEffects('launch', casterPos);

        // Use preset shadow_teleport effect system at departure (client only)
        if (!this.game.isServer) {
            this.call.playEffectSystem( 'shadow_teleport',
                new THREE.Vector3(casterPos.x, casterPos.y + 30, casterPos.z));
        }

        // Teleport behind target
        casterPos.x = teleportPos.x;
        casterPos.z = teleportPos.z;

        // Visual effect at new position after teleport
        this.playConfiguredEffects('target', teleportPos);

        // Use preset shadow_arrive effect system at arrival (client only)
        if (!this.game.isServer) {
            this.call.playEffectSystem( 'shadow_arrive',
                new THREE.Vector3(teleportPos.x, teleportPos.y + 30, teleportPos.z));
        }

        // Deal critical backstab damage
        this.dealDamageWithEffects(casterEntity, targetId, this.backstabDamage, this.enums.element.physical, {
            isCritical: true,
            criticalMultiplier: 2.0,
            isBackstab: true
        });

        // Backstab effect
        this.playConfiguredEffects('impact', targetPos);

        // Use preset backstab effect system (client only)
        if (!this.game.isServer) {
            this.call.playEffectSystem( 'backstab',
                new THREE.Vector3(targetPos.x, targetPos.y + 25, targetPos.z));
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
