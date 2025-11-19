class InfernoAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
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
            ...params
        });
        
        this.damage = 35;
        this.infernoRadius = 120;
        this.duration = 4.0;
        this.tickInterval = 0.5;
        this.element = 'fire';
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
            inferno: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xff4400,
                    scaleMultiplier: 3.0,
                    speedMultiplier: 0.8
                }
            },
            tick: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xff3300,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.6
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Find best cluster position deterministically
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const infernoCenter = clusterPos || this.getDefaultTargetPosition(casterPos, enemies);
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `The battlefield prepares for an unstoppable inferno!`);
        
        // Schedule the inferno to start after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.createInferno(casterEntity, infernoCenter);
        }, this.castTime, casterEntity);
    }
    
    createInferno(casterEntity, centerPos) {
        // Create initial inferno effect
        this.createVisualEffect(centerPos, 'inferno');

        // Enhanced massive inferno explosion
        if (this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(centerPos.x, centerPos.y + 30, centerPos.z),
                layers: [
                    // Massive fire eruption
                    {
                        count: 40,
                        lifetime: 1.0,
                        color: 0xff4400,
                        colorRange: { start: 0xffaa44, end: 0xcc2200 },
                        scale: 35,
                        scaleMultiplier: 3.0,
                        velocityRange: { x: [-120, 120], y: [80, 200], z: [-120, 120] },
                        gravity: -50,
                        drag: 0.9,
                        blending: 'additive'
                    },
                    // Central white-hot core
                    {
                        count: 15,
                        lifetime: 0.5,
                        color: 0xffffaa,
                        colorRange: { start: 0xffffff, end: 0xffaa44 },
                        scale: 50,
                        scaleMultiplier: 4.0,
                        velocityRange: { x: [-40, 40], y: [50, 120], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    },
                    // Smoke column
                    {
                        count: 25,
                        lifetime: 1.5,
                        color: 0x333333,
                        colorRange: { start: 0x555555, end: 0x111111 },
                        scale: 40,
                        scaleMultiplier: 3.5,
                        velocityRange: { x: [-60, 60], y: [100, 200], z: [-60, 60] },
                        gravity: -80,
                        drag: 0.85,
                        blending: 'normal'
                    },
                    // Flying embers
                    {
                        count: 30,
                        lifetime: 2.0,
                        color: 0xff6600,
                        colorRange: { start: 0xffcc44, end: 0xff3300 },
                        scale: 6,
                        scaleMultiplier: 0.5,
                        velocityRange: { x: [-100, 100], y: [150, 300], z: [-100, 100] },
                        gravity: 80,
                        drag: 0.97,
                        blending: 'additive'
                    }
                ]
            });

            // Fire ring on ground
            this.game.gameManager.call('createParticles', {
                position: new THREE.Vector3(centerPos.x, centerPos.y + 5, centerPos.z),
                count: 30,
                lifetime: 0.8,
                visual: {
                    color: 0xff4400,
                    colorRange: { start: 0xffaa44, end: 0xcc2200 },
                    scale: 20,
                    scaleMultiplier: 2.0,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-30, 30], y: [20, 60], z: [-30, 30] },
                gravity: -20,
                drag: 0.9,
                emitterShape: 'ring',
                emitterRadius: 60
            });
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
            this.createVisualEffect(centerPos, 'tick');
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
            
            // Count enemies within inferno radius of this position
            sortedEnemies.forEach(enemyId => {
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
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
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        const firstEnemy = sortedEnemies[0];
        
        const enemyPos = this.game.getComponent(firstEnemy, this.componentTypes.POSITION);
        return enemyPos ? { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z } : casterPos;
    }
}