class FireballAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'fireBall',
            name: 'Fire Ball',
            description: 'Launch a fiery projectile that explodes on impact',
            cooldown: 5.0,
            range: 150,
            manaCost: 30,
            targetType: 'enemy',
            animation: 'cast',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        
        this.damage = 60;
        this.splashRadius = 80;
        this.element = 'fire';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xff8800 },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 0.8
                }
            },
            projectile: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xff2200,
                    scaleMultiplier: 0.6,
                    speedMultiplier: 1.5
                }
            },
            explosion: {
                type: 'explosion',
                options: {
                    count: 3,
                    color: 0xff4400,
                    colorRange: { start: 0xff4400, end: 0xff0000 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.2
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 3,
                    color: 0xff0000,
                    scaleMultiplier: 1.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity, targetData = null) {
        if (!this.game.projectileSystem) return;
        
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // DESYNC SAFE: Find closest enemy deterministically
        const closestEnemy = this.findClosestEnemy(casterEntity, enemies);
        if (!closestEnemy) return;
        
        this.logAbilityUsage(casterEntity, `Fireball launched at enemy target!`, true);
        
        // DESYNC SAFE: Use scheduling system for projectile firing
        this.game.schedulingSystem.scheduleAction(() => {
            this.fireProjectile(casterEntity, closestEnemy);
        }, this.castTime, casterEntity);
    }
    
    // DESYNC SAFE: Deterministic closest enemy finding
    findClosestEnemy(casterEntity, enemies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let closestEnemy = null;
        let closestDistance = Infinity;
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            // Use < for consistent tie-breaking (first in sorted order wins)
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemyId;
            }
        });
        
        return closestEnemy;
    }
    
    fireProjectile(casterEntity, targetId) {
        if (!this.game.projectileSystem) return;
        
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
        if (!casterPos || !targetPos) return;
        
        // Create fireball projectile with enhanced effects
        const projectileData = {
            id: 'fireball',
            title: 'Fireball',
            damage: this.damage,
            speed: 80,
            element: this.element,
            ballistic: true,
            splashRadius: this.splashRadius,
            homing: true,
            homingStrength: 0.3,
            onHit: (impactPos) => {
                // Explosion effect
                this.createVisualEffect(impactPos, 'explosion');
                if (this.game.effectsSystem) {
                    this.game.effectsSystem.playScreenShake(0.3, 2);
                }
                
                // DESYNC SAFE: Handle splash damage deterministically
                this.handleSplashDamage(casterEntity, impactPos);
            },
            onTravel: (currentPos) => {
                // Trail effect during flight
                this.createVisualEffect(currentPos, 'projectile', { heightOffset: 0 });
            }
        };
        
        this.game.projectileSystem.fireProjectile(casterEntity, targetId, projectileData);
    }
    
    // DESYNC SAFE: Handle splash damage deterministically
    handleSplashDamage(casterEntity, impactPos) {
        // Get all entities in splash radius
        const allEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.TEAM
        );
        
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        if (!casterTeam) return;
        
        const splashTargets = [];
        
        // Find all valid targets in splash radius
        allEntities.forEach(entityId => {
            const entityPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const entityTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
            
            if (!entityPos || !entityTeam || entityTeam.team === casterTeam.team) return;
            
            const distance = Math.sqrt(
                Math.pow(entityPos.x - impactPos.x, 2) + 
                Math.pow(entityPos.z - impactPos.z, 2)
            );
            
            if (distance <= this.splashRadius) {
                splashTargets.push({
                    id: entityId,
                    distance: distance,
                    position: entityPos
                });
            }
        });
        
        // DESYNC SAFE: Sort splash targets deterministically
        splashTargets.sort((a, b) => {
            // Primary sort by distance
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            // Secondary sort by entity ID for deterministic tie-breaking
            return String(a.id).localeCompare(String(b.id));
        });
        
        // Apply splash damage to all targets
        splashTargets.forEach(target => {
            // Calculate damage falloff based on distance
            const damageMultiplier = Math.max(0.3, 1.0 - (target.distance / this.splashRadius));
            const splashDamage = Math.floor(this.damage * damageMultiplier);
            
            // Apply damage
            this.dealDamageWithEffects(casterEntity, target.id, splashDamage, this.element, {
                isSplash: true
            });
            
            // Impact effect on each target
            this.createVisualEffect(target.position, 'impact');
        });
    }
}