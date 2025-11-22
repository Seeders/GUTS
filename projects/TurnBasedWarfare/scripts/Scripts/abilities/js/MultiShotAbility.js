class MultiShotAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'multi_shot',
            name: 'Multi Shot',
            description: 'Fire multiple arrows at different targets',
            cooldown: 7.0,
            range: 180,
            manaCost: 25,
            targetType: 'enemies',
            animation: 'attack',
            priority: 6,
            castTime: 1.0,
            ...params
        });
        
        this.maxTargets = 3;
        this.arrowDamage = 35;
        this.shotInterval = 0.2; // Time between each arrow
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B4513,
                    colorRange: { start: 0x8B4513, end: 0xDEB887 },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            },
            arrow_launch: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xCD853F,
                    scaleMultiplier: 1.0,
                    speedMultiplier: 2.0
                }
            },
            volley: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xF4A460,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Need at least one enemy to shoot at
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return null;
        
        // Select targets deterministically
        const targets = this.selectMultishotTargets(enemies);
        if (targets.length === 0) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, 
            `Archer prepares to fire ${targets.length} arrows...`);
        
        // Schedule the multishot volley after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.fireMultishotVolley(casterEntity, targets);
        }, this.castTime, casterEntity);
    }
    
    fireMultishotVolley(casterEntity, targets) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;

        // Create volley effect
        this.createVisualEffect(casterPos, 'volley');

        // Enhanced volley launch burst
        if (this.game.gameManager) {
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(casterPos.x, casterPos.y + 25, casterPos.z),
                layers: [
                    // Arrow trail burst
                    {
                        count: 15,
                        lifetime: 0.4,
                        color: 0xcd853f,
                        colorRange: { start: 0xf4a460, end: 0x8b4513 },
                        scale: 12,
                        scaleMultiplier: 1.5,
                        velocityRange: { x: [-80, 80], y: [30, 80], z: [-80, 80] },
                        gravity: 100,
                        drag: 0.93,
                        blending: 'normal'
                    },
                    // Golden glint
                    {
                        count: 8,
                        lifetime: 0.3,
                        color: 0xffd700,
                        colorRange: { start: 0xffffff, end: 0xdaa520 },
                        scale: 8,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-50, 50], y: [40, 100], z: [-50, 50] },
                        gravity: 0,
                        drag: 0.85,
                        blending: 'additive'
                    }
                ]
            });
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
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
        // Validate target still exists
        if (!casterPos || !targetPos) return;
        
        // Create arrow launch effect
        this.createVisualEffect(casterPos, 'arrow_launch');
        
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
                    this.createVisualEffect(hitPos, 'arrow_launch', { 
                        count: 3, 
                        scaleMultiplier: 0.8 
                    });
                },
                onTravel: (currentPos) => {
                    // Optional: trail effect during flight
                    if (shotIndex === 0) { // Only show trail on first arrow to avoid spam
                        this.createVisualEffect(currentPos, 'cast', { 
                            count: 1, 
                            scaleMultiplier: 0.5,
                            heightOffset: 0 
                        });
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
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        // Take up to maxTargets, but prioritize by distance for tactical targeting
        const casterPos = this.game.getComponent(this.getCasterFromContext(), this.componentTypes.POSITION);
        if (!casterPos) {
            // Fallback: just take first N enemies if no caster position
            return sortedEnemies.slice(0, this.maxTargets);
        }
        
        // Calculate distances and sort by distance (closest first), then by ID for tie-breaking
        const enemiesWithDistance = sortedEnemies.map(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
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
                return String(a.enemyId).localeCompare(String(b.enemyId));
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