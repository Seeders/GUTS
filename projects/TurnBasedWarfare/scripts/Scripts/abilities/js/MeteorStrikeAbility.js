class MeteorStrikeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'meteor_strike',
            name: 'Meteor Strike',
            description: 'Devastating strike on the densest enemy formation',
            cooldown: 5.0,
            range: 300,
            manaCost: 0,
            targetType: 'enemies',
            animation: 'cast',
            priority: 10,
            castTime: 1.0,
            ...params
        });
        
        this.damage = 200;
        this.splashRadius = 120;
        this.delay = 3.0;
        this.element = 'fire';
        this.minTargets = 0;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xffaa00 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            },
            warning: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff0000,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            meteor_explosion: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xff2200,
                    colorRange: { start: 0xff2200, end: 0xffaa00 },
                    scaleMultiplier: 4.0,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);        
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        const targetPos = this.findBestClusterPosition(enemies, this.minTargets);
        
        if (!targetPos) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `A massive meteor approaches from the heavens!`);
        
        // Schedule warning indicator after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createMeteorWarning(targetPos);
        }, this.castTime, casterEntity);
        
        // Schedule meteor impact after cast time + delay
        this.game.schedulingSystem.scheduleAction(() => {
            this.meteorImpact(casterEntity, targetPos);
        }, this.castTime + this.delay, casterEntity);
    }
    
    createMeteorWarning(position) {
        // Create warning effect instead of entity for better desync safety
        this.createVisualEffect(position, 'warning');
        
        // Schedule repeated warning effects during the delay period
        const warningInterval = 0.5;
        const warningCount = Math.floor(this.delay / warningInterval);
        
        for (let i = 1; i < warningCount; i++) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.createVisualEffect(position, 'warning');
            }, i * warningInterval, null);
        }
        
        this.logAbilityUsage(null, `The ground trembles as a meteor approaches!`);
    }
    
    meteorImpact(casterEntity, position) {
        // Create massive explosion effect
        this.createVisualEffect(position, 'meteor_explosion');
        
        // Screen effects for dramatic impact
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.8, 4);
            this.game.effectsSystem.playScreenFlash('#ff4400', 0.5);
        }
        
        // Apply splash damage
        if (this.game.damageSystem) {
            const results = this.game.damageSystem.applySplashDamage(
                casterEntity,
                position,
                this.damage,
                this.element,
                this.splashRadius,
                { allowFriendlyFire: false, isSpell: true }
            );
            
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `Meteor strike devastates ${results.length} enemies!`,
                    'log-explosion'
                );
            }
            
            this.logAbilityUsage(casterEntity, 
                `Meteor impact devastates ${results.length} enemies for massive damage!`);
        }
    }
    
    // FIXED: Deterministic cluster position finding
    findBestClusterPosition(enemies, minTargets) {
        if (enemies.length === 0) return null;
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let bestPosition = null;
        let maxTargetsHit = 0;
        let bestScore = 0; // For tie-breaking: prefer positions with lower total distance
        
        // Check each enemy position as potential impact center
        sortedEnemies.forEach(potentialCenter => {
            const centerPos = this.game.getComponent(potentialCenter, this.componentTypes.POSITION);
            if (!centerPos) return;
            
            let targetsInRange = 0;
            let totalDistance = 0;
            
            // Count enemies within splash radius of this position
            sortedEnemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (!enemyPos) return;
                
                const distance = Math.sqrt(
                    Math.pow(enemyPos.x - centerPos.x, 2) + 
                    Math.pow(enemyPos.z - centerPos.z, 2)
                );
                
                if (distance <= this.splashRadius) {
                    targetsInRange++;
                    totalDistance += distance;
                }
            });
            
            // Calculate score: prioritize more targets, then lower total distance for tie-breaking
            const score = (targetsInRange * 1000) - totalDistance;
            
            // Use >= for consistent tie-breaking (first in sorted order wins when scores are equal)
            if (targetsInRange > maxTargetsHit || 
                (targetsInRange === maxTargetsHit && score >= bestScore)) {
                maxTargetsHit = targetsInRange;
                bestScore = score;
                bestPosition = { x: centerPos.x, y: centerPos.y, z: centerPos.z };
            }
        });
        
        // If no good cluster found but we have enemies, target the first enemy deterministically
        if (!bestPosition && sortedEnemies.length > 0) {
            const firstEnemyPos = this.game.getComponent(sortedEnemies[0], this.componentTypes.POSITION);
            if (firstEnemyPos) {
                bestPosition = { x: firstEnemyPos.x, y: firstEnemyPos.y, z: firstEnemyPos.z };
            }
        }
        
        return bestPosition;
    }
}