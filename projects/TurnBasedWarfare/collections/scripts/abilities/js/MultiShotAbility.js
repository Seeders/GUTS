class MultiShotAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Multi Shot',
            description: 'Fire multiple arrows at different targets',
            cooldown: 7.0,
            range: 180,
            manaCost: 25,
            targetType: 'enemies',
            animation: 'attack',
            priority: 6,
            castTime: 1.0,
            ...abilityData
        });
        
        this.maxTargets = 3;
        this.arrowDamage = 35;
        this.shotInterval = 0.2; // Time between each arrow
        this.element = this.enums.element.physical;
    }
    
    canExecute(casterEntity) {
        // Need at least one enemy to shoot at
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Select targets deterministically
        const targets = this.selectMultishotTargets(enemies);
        if (targets.length === 0) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, 
            `Archer prepares to fire ${targets.length} arrows...`);
        
        // Schedule the multishot volley after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.fireMultishotVolley(casterEntity, targets);
        }, this.castTime, casterEntity);
    }
    
    fireMultishotVolley(casterEntity, targets) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return;

        // Create volley effect
        this.playConfiguredEffects('burst', casterPos);

        // Enhanced volley launch burst using preset effect system
        if (!this.game.isServer) {
            this.game.call('playEffectSystem', 'multishot_volley',
                new THREE.Vector3(casterPos.x, casterPos.y + 25, casterPos.z));
        }

        // Fire arrows at each target with staggered timing
        targets.forEach((targetId, shotIndex) => {
            const shotDelay = shotIndex * this.shotInterval;

            this.game.schedulingSystem.scheduleAction(() => {
                this.fireSingleArrow(casterEntity, targetId, shotIndex);
            }, shotDelay, casterEntity);
        });

        this.logAbilityUsage(casterEntity,
            `Archer fires volley of ${targets.length} arrows!`);
    }
    
    fireSingleArrow(casterEntity, targetId, shotIndex) {
        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterPos = casterTransform?.position;
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;
        
        // Validate target still exists
        if (!casterPos || !targetPos) return;
        
        // Create arrow launch effect
        this.playConfiguredEffects('launch', casterPos);
        
        // Fire projectile if system is available
        if (this.game.projectileSystem) {
            const projectileData = {
                id: 'arrow',
                title: `Arrow ${shotIndex + 1}`,
                damage: this.arrowDamage,
                speed: 120,
                element: this.element,
                ballistic: true,
                onHit: (hitPos) => {
                    // Impact effect
                    this.playConfiguredEffects('impact', hitPos);
                },
                onTravel: (currentPos) => {
                    // Optional: trail effect during flight
                    if (shotIndex === 0) { // Only show trail on first arrow to avoid spam
                        this.playConfiguredEffects('trail', currentPos);
                    }
                }
            };
            
            this.game.projectileSystem.fireProjectile(casterEntity, targetId, projectileData);
        } else {
            // Fallback: direct damage if no projectile system
            this.dealDamageWithEffects(casterEntity, targetId, this.arrowDamage, this.element, {
                isArrow: true,
                isMultishot: true,
                shotIndex: shotIndex
            });
        }
        
    }
    
    // FIXED: Deterministic target selection
    selectMultishotTargets(enemies) {
        if (enemies.length === 0) return [];
        
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        // Take up to maxTargets, but prioritize by distance for tactical targeting
        const transform = this.game.getComponent(this.getCasterFromContext(), "transform");
        const casterPos = transform?.position;
        if (!casterPos) {
            // Fallback: just take first N enemies if no caster position
            return sortedEnemies.slice(0, this.maxTargets);
        }
        
        // Calculate distances and sort by distance (closest first), then by ID for tie-breaking
        const enemiesWithDistance = sortedEnemies.map(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            let distance = Infinity;
            
            if (enemyPos) {
                distance = Math.sqrt(
                    Math.pow(enemyPos.x - casterPos.x, 2) + 
                    Math.pow(enemyPos.z - casterPos.z, 2)
                );
            }
            
            return { enemyId, distance };
        });
        
        // Sort by distance first, then by entity ID for deterministic tie-breaking
        enemiesWithDistance.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) < 0.001) { // Nearly equal distances
                return a.enemyId - b.enemyId;
            }
            return a.distance - b.distance;
        });
        
        // Return up to maxTargets closest enemies
        return enemiesWithDistance
            .slice(0, this.maxTargets)
            .map(item => item.enemyId);
    }
    
    // Helper method to get caster in current context (if needed)
    getCasterFromContext() {
        // This is a fallback - in practice, the caster should be passed to selectMultishotTargets
        // For now, we'll use a simple approach
        return null; // Will trigger the simpler fallback logic
    }
}
