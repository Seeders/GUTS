class DisruptionBombAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'disruption_bomb',
            name: 'Disruption Bomb',
            description: 'Throw a bomb that disables enemy abilities and equipment (effects do not stack)',
            cooldown: 16.0,
            range: 130,
            manaCost: 40,
            targetType: 'area',
            animation: 'cast',
            priority: 6,
            castTime: 1.3,
            ...abilityData
        });
        
        this.explosionRadius = 90;
        this.disruptionDuration = 12.0;
        this.accuracyReduction = 0.4; // 40% accuracy reduction
        this.movementSlowed = 0.6; // Movement slowed to 60%
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        // Only use if there are at least 2 enemies to disrupt
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, position);
        if (!pos) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, `Saboteur prepares a disruption bomb!`);
        
        // DESYNC SAFE: Use scheduling system for bomb throw and explosion
        this.game.schedulingSystem.scheduleAction(() => {
            this.throwDisruptionBomb(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    throwDisruptionBomb(casterEntity) {
        const pos = this.game.getComponent(casterEntity, position);
        if (!pos) return;
        
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, health);
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // DESYNC SAFE: Find best cluster position deterministically
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const targetPos = clusterPos || pos;
        
        // Visual explosion effect
        this.playConfiguredEffects('impact', targetPos);
        
        // Screen effects for dramatic explosion (client only)
        if (!this.game.isServer && this.game.effectsSystem) {
            this.game.effectsSystem.showExplosionEffect(targetPos.x, targetPos.y, targetPos.z);
            this.game.effectsSystem.playScreenShake(0.4, 2);
            this.game.effectsSystem.playScreenFlash('#8A2BE2', 0.3);
        }
        
        // DESYNC SAFE: Apply disruption effects deterministically
        this.applyDisruptionEffects(casterEntity, enemies, targetPos);
    }
    
    // DESYNC SAFE: Apply disruption effects to enemies in range
    applyDisruptionEffects(casterEntity, enemies, bombPos) {
        // Sort enemies for consistent processing order
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let disruptedCount = 0;
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, position);
            const enemyHealth = this.game.getComponent(enemyId, health);
            
            // Only affect living enemies
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            
            // Check if enemy is in explosion radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - bombPos.x, 2) + 
                Math.pow(enemyPos.z - bombPos.z, 2)
            );
            
            if (distance <= this.explosionRadius) {
                // DESYNC SAFE: Check if already disrupted - don't stack disruptions
                const enums = this.game.getEnums();
                const existingBuff = this.game.getComponent(enemyId, buff);

                if (existingBuff && existingBuff.buffType === enums.buffTypes.disrupted) {
                    // DESYNC SAFE: Just refresh duration instead of stacking
                    existingBuff.endTime = this.game.state.now + this.disruptionDuration;
                    existingBuff.appliedTime = this.game.state.now;
                } else {
                    // Apply new disruption buff
                    this.game.addComponent(enemyId, "buff", {
                        buffType: enums.buffTypes.disrupted,
                        endTime: this.game.state.now + this.disruptionDuration,
                        appliedTime: this.game.state.now,
                        stacks: 1,
                        sourceEntity: casterEntity
                    });

                    // DESYNC SAFE: Schedule disruption removal
                    this.game.schedulingSystem.scheduleAction(() => {
                        this.removeDisruption(enemyId);
                    }, this.disruptionDuration, enemyId);
                }
                
                // Visual disruption effect on each affected enemy
                this.playConfiguredEffects('debuff', enemyPos);
                
                disruptedCount++;
            }
        });
        
       
    }
    
    // DESYNC SAFE: Find best cluster position deterministically
    findBestClusterPosition(enemies, minCluster = 2) {
        if (enemies.length < minCluster) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let bestPos = null;
        let bestScore = 0;
        
        sortedEnemies.forEach(enemyId => {
            const pos = this.game.getComponent(enemyId, position);
            if (!pos) return;
            
            // Count nearby enemies within explosion radius
            let nearbyCount = 0;
            sortedEnemies.forEach(otherId => {
                if (otherId === enemyId) return;
                const otherPos = this.game.getComponent(otherId, position);
                if (!otherPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(pos.x - otherPos.x, 2) + 
                    Math.pow(pos.z - otherPos.z, 2)
                );
                
                if (distance <= this.explosionRadius) nearbyCount++;
            });
            
            // Use >= for consistent tie-breaking (first in sorted order wins)
            if (nearbyCount >= minCluster - 1 && nearbyCount >= bestScore) {
                bestScore = nearbyCount;
                bestPos = { x: pos.x, y: pos.y, z: pos.z };
            }
        });
        
        return bestPos;
    }
    
    // DESYNC SAFE: Remove disruption effect
    removeDisruption(enemyId) {
        // Check if enemy still exists and has the disruption buff
        const enums = this.game.getEnums();
        if (this.game.hasComponent(enemyId, "buff")) {
            const buff = this.game.getComponent(enemyId, "buff");
            if (buff && buff.buffType === enums.buffTypes.disrupted) {
                this.game.removeComponent(enemyId, "buff");
                
                // Visual effect when disruption expires
                const transform = this.game.getComponent(enemyId, "transform");
                const enemyPos = transform?.position;
                if (enemyPos) {
                    this.playConfiguredEffects('expiration', enemyPos);
                }
                
           
            }
        }
    }
}
