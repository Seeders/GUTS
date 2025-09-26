class DisruptionBombAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
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
            ...params
        });
        
        this.explosionRadius = 90;
        this.disruptionDuration = 12.0;
        this.accuracyReduction = 0.4; // 40% accuracy reduction
        this.movementSlowed = 0.6; // Movement slowed to 60%
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xFF4500,
                    colorRange: { start: 0xFF4500, end: 0xFF8C00 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.8
                }
            },
            explosion: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0x8A2BE2,
                    colorRange: { start: 0x8A2BE2, end: 0x4B0082 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 2.0
                }
            },
            disruption: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x9932CC,
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        // Only use if there are at least 2 enemies to disrupt
        return enemies.length >= 2;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, `Saboteur prepares a disruption bomb!`);
        
        // DESYNC SAFE: Use scheduling system for bomb throw and explosion
        this.game.schedulingSystem.scheduleAction(() => {
            this.throwDisruptionBomb(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    throwDisruptionBomb(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // DESYNC SAFE: Find best cluster position deterministically
        const clusterPos = this.findBestClusterPosition(enemies, 2);
        const targetPos = clusterPos || pos;
        
        // Visual explosion effect
        this.createVisualEffect(targetPos, 'explosion');
        
        // Screen effects for dramatic explosion
        if (this.game.effectsSystem) {
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
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let disruptedCount = 0;
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            
            // Only affect living enemies
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            
            // Check if enemy is in explosion radius
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - bombPos.x, 2) + 
                Math.pow(enemyPos.z - bombPos.z, 2)
            );
            
            if (distance <= this.explosionRadius) {
                // DESYNC SAFE: Check if already disrupted - don't stack disruptions
                const existingBuff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
                
                if (existingBuff && existingBuff.buffType === 'disrupted') {
                    // DESYNC SAFE: Just refresh duration instead of stacking
                    existingBuff.endTime = this.game.state.now + this.disruptionDuration;
                    existingBuff.appliedTime = this.game.state.now;
                } else {
                    // Apply new disruption buff
                    const Components = this.game.componentManager.getComponents();
                    this.game.addComponent(enemyId, this.componentTypes.BUFF, 
                        Components.Buff('disrupted', { 
                            abilitiesDisabled: true,
                            accuracyReduction: this.accuracyReduction,
                            movementSlowed: this.movementSlowed
                        }, this.game.state.now + this.disruptionDuration, false, 1, this.game.state.now));
                    
                    // DESYNC SAFE: Schedule disruption removal
                    this.game.schedulingSystem.scheduleAction(() => {
                        this.removeDisruption(enemyId);
                    }, this.disruptionDuration, enemyId);
                }
                
                // Visual disruption effect on each affected enemy
                this.createVisualEffect(enemyPos, 'disruption');
                
                disruptedCount++;
            }
        });
        
        // Log results
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `Saboteur's bomb disrupts ${disruptedCount} enemy systems!`,
                'log-ability'
            );
        }
    }
    
    // DESYNC SAFE: Find best cluster position deterministically
    findBestClusterPosition(enemies, minCluster = 2) {
        if (enemies.length < minCluster) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let bestPos = null;
        let bestScore = 0;
        
        sortedEnemies.forEach(enemyId => {
            const pos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!pos) return;
            
            // Count nearby enemies within explosion radius
            let nearbyCount = 0;
            sortedEnemies.forEach(otherId => {
                if (otherId === enemyId) return;
                const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);
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
        if (this.game.hasComponent(enemyId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(enemyId, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'disrupted') {
                this.game.removeComponent(enemyId, this.componentTypes.BUFF);
                
                // Visual effect when disruption expires
                const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
                if (enemyPos) {
                    this.createVisualEffect(enemyPos, 'disruption', { 
                        count: 3, 
                        scaleMultiplier: 0.8,
                        color: 0x87CEEB 
                    });
                }
                
                // Log disruption expiration
                if (this.game.battleLogSystem) {
                    const unitType = this.game.getComponent(enemyId, this.componentTypes.UNIT_TYPE);
                    if (unitType) {
                        this.game.battleLogSystem.add(
                            `${unitType.type}'s systems come back online.`,
                            'log-ability'
                        );
                    }
                }
            }
        }
    }
}