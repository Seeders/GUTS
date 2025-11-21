class FirestormAbility extends GUTS.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'fireStorm',
            name: 'Fire Storm',
            description: 'Rain fire on the largest enemy cluster',
            cooldown: 12.0,
            range: 200,
            manaCost: 50,
            targetType: 'auto',
            animation: 'cast',
            priority: 8,
            castTime: 2.5,
            autoTrigger: 'enemy_cluster',
            ...params
        });
        
        this.stormRadius = 90;
        this.damage = 70;
        this.element = 'fire';
        this.minTargets = 3;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff2200,
                    colorRange: { start: 0xff2200, end: 0xffaa00 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            firestorm: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xff0000 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 0.6
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, this.minTargets);
        return clusterPos !== null;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        const clusterPos = this.findBestClusterPosition(enemies, this.minTargets);
        
        if (!clusterPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `The sky darkens as firestorm approaches!`);
        
        // Schedule the firestorm to hit after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performFirestorm(casterEntity, clusterPos);
        }, this.castTime, casterEntity);
    }
    
    performFirestorm(casterEntity, targetPos) {
        // Create firestorm visual effect
        this.createVisualEffect(targetPos, 'firestorm');
        
        // Apply fire damage to all enemies in storm area
        if (this.game.damageSystem) {
            const results = this.game.damageSystem.applySplashDamage(
                casterEntity,
                targetPos,
                this.damage,
                this.element,
                this.stormRadius,
                { allowFriendlyFire: false, isSpell: true }
            );
            
            this.logAbilityUsage(casterEntity, 
                `Firestorm engulfs ${results.length} enemies in flames!`);
        }
    }
    
    // FIXED: Deterministic cluster position finding
    findBestClusterPosition(enemies, minTargets) {
        if (enemies.length < minTargets) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0; // For tie-breaking: prefer positions with lower total distance
        
        // Check each enemy position as potential cluster center
        sortedEnemies.forEach(potentialCenter => {
            const centerPos = this.game.getComponent(potentialCenter, this.componentTypes.POSITION);
            if (!centerPos) return;
            
            let targetsInRange = 0;
            let totalDistance = 0;
            
            // Count enemies within storm radius of this position
            sortedEnemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (!enemyPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - centerPos.x, 2) + 
                    Math.pow(enemyPos.z - centerPos.z, 2)
                );
                
                if (distance <= this.stormRadius) {
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
}