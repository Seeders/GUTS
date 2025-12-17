class InfernoAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            id: 'inferno',
            name: 'Inferno',
            description: 'Creates a blazing inferno that damages all enemies in a large area',
            cooldown: 8.0,
            range: 200,
            manaCost: 80,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 2.0,
            autoTrigger: 'multiple_enemies',
            ...abilityData
        });
        
        this.damage = 35;
        this.infernoRadius = 120;
        this.duration = 4.0;
        this.tickInterval = 0.5;
        this.element = this.enums.element.fire;
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Find best cluster position deterministically
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const infernoCenter = clusterPos || this.getDefaultTargetPosition(casterPos, enemies);
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `The battlefield prepares for an unstoppable inferno!`);
        
        // Schedule the inferno to start after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createInferno(casterEntity, infernoCenter);
        }, this.castTime, casterEntity);
    }
    
    createInferno(casterEntity, centerPos) {
        // Create initial inferno effect
        this.playConfiguredEffects('impact', centerPos);

        // Enhanced massive inferno explosion using preset effect system
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'inferno_burst',
                new THREE.Vector3(centerPos.x, centerPos.y + 30, centerPos.z));

            // Fire ring on ground using preset effect
            this.game.call('playEffect', 'fire_ground_ring',
                new THREE.Vector3(centerPos.x, centerPos.y + 5, centerPos.z));
        }

        // Screen effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ff3300', 0.4);
            this.game.effectsSystem.playScreenShake(0.4, 3);
        }

        this.logAbilityUsage(casterEntity, `The battlefield erupts in an unstoppable inferno!`);
        
        // Schedule damage ticks deterministically
        const totalTicks = Math.floor(this.duration / this.tickInterval);
        
        for (let tickNumber = 0; tickNumber < totalTicks; tickNumber++) {
            const tickDelay = tickNumber * this.tickInterval;
            
            this.game.schedulingSystem.scheduleAction(() => {
                this.performInfernoTick(casterEntity, centerPos, tickNumber, totalTicks);
            }, tickDelay, casterEntity);
        }
    }
    
    performInfernoTick(casterEntity, centerPos, tickNumber, totalTicks) {
        // Apply damage to all enemies in radius
        if (this.game.damageSystem) {
            const results = this.game.damageSystem.applySplashDamage(
                casterEntity,
                centerPos,
                this.damage,
                this.element,
                this.infernoRadius,
                { allowFriendlyFire: false, isSpell: true }
            );
            
            // Log damage on first and last ticks
            if (tickNumber === 0 && results.length > 0) {
                this.logAbilityUsage(casterEntity, `Inferno burns ${results.length} enemies!`);
            }
        }
        
        // Visual tick effect (except on last tick to avoid overlap)
        if (tickNumber < totalTicks - 1) {
            this.playConfiguredEffects('tick', centerPos);
        }
    }
    
    // FIXED: Deterministic cluster position finding
    findBestClusterPosition(enemies, minTargets) {
        if (enemies.length < minTargets) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0; // For tie-breaking: prefer positions with lower total distance
        
        // Check each enemy position as potential cluster center
        sortedEnemies.forEach(potentialCenter => {
            const transform = this.game.getComponent(potentialCenter, "transform");
            const centerPos = transform?.position;
            if (!centerPos) return;
            
            let targetsInRange = 0;
            let totalDistance = 0;
            
            // Count enemies within inferno radius of this position
            sortedEnemies.forEach(enemyId => {
                const transform = this.game.getComponent(enemyId, "transform");
                const enemyPos = transform?.position;
                if (!enemyPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - centerPos.x, 2) + 
                    Math.pow(enemyPos.z - centerPos.z, 2)
                );
                
                if (distance <= this.infernoRadius) {
                    targetsInRange++;
                    totalDistance += distance;
                }
            });
            
            // Only consider positions that hit minimum targets
            if (targetsInRange >= minTargets) {
                // Calculate score: prioritize more targets, then lower total distance for tie-breaking
                const score = (targetsInRange * 1000) - totalDistance;
                
                // Use >= for consistent tie-breaking (first in sorted order wins when scores are equal)
                if (targetsInRange > maxTargetsHit || 
                    (targetsInRange === maxTargetsHit && score >= bestScore)) {
                    maxTargetsHit = targetsInRange;
                    bestScore = score;
                    bestPosition = { x: centerPos.x, y: centerPos.y, z: centerPos.z };
                }
            }
        });
        
        return bestPosition;
    }
    
    // FIXED: Deterministic fallback position when no cluster is found
    getDefaultTargetPosition(casterPos, enemies) {
        if (enemies.length === 0) return casterPos;
        
        // Sort enemies deterministically and pick the first one
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        const firstEnemy = sortedEnemies[0];
        
        const transform = this.game.getComponent(firstEnemy, "transform");
        const enemyPos = transform?.position;
        return enemyPos ? { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z } : casterPos;
    }
}
