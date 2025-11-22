class PiercingShotAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'piercing_shot',
            name: 'Piercing Shot',
            description: 'Fire a bolt that pierces through multiple enemies',
            cooldown: 6.0,
            range: 200,
            manaCost: 25,
            targetType: 'line',
            animation: 'attack',
            priority: 6,
            castTime: 1.5,
            ...params
        });
        
        this.piercingDamage = 45;
        this.lineWidth = 20; // Width of the piercing line
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4682B4,
                    colorRange: { start: 0x4682B4, end: 0x87CEEB },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
                }
            },
            beam_charge: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x6495ED,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.8
                }
            },
            piercing_beam: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xB0C4DE,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 2.5
                }
            },
            impact: {
                type: 'damage',
                options: {
                    count: 3,
                    color: 0x4169E1,
                    scaleMultiplier: 1.0,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Need at least one enemy in range to pierce
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterFacing = this.game.getComponent(casterEntity, this.componentTypes.FACING);
        
        if (!casterPos || !casterFacing) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Crossbow charges a piercing bolt...`);
        
        // Schedule the piercing shot after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.firePiercingShot(casterEntity, casterPos, casterFacing);
        }, this.castTime, casterEntity);
    }
    
    firePiercingShot(casterEntity, casterPos, casterFacing) {
        // Calculate piercing line end position
        const endPos = this.calculateLineEndPosition(casterPos, casterFacing);
        
        // Create beam charging effect
        this.createVisualEffect(casterPos, 'beam_charge');
        
        // Schedule visual beam effect slightly before damage
        this.game.schedulingSystem.scheduleAction(() => {
            this.createPiercingBeamEffect(casterPos, endPos);
        }, 0.2, casterEntity);
        
        // Schedule damage application
        this.game.schedulingSystem.scheduleAction(() => {
            this.applyPiercingDamage(casterEntity, casterPos, endPos);
        }, 0.3, casterEntity);
    }
    
    createPiercingBeamEffect(startPos, endPos) {
        // Create piercing beam visual effect
        this.createVisualEffect(startPos, 'piercing_beam');
        this.createVisualEffect(endPos, 'piercing_beam', {
            count: 6,
            scaleMultiplier: 1.5
        });

        // Enhanced beam trail particles
        if (this.game.gameManager) {
            // Create particles along the beam path
            const beamSteps = 6;
            for (let i = 0; i <= beamSteps; i++) {
                const t = i / beamSteps;
                const trailX = startPos.x + (endPos.x - startPos.x) * t;
                const trailZ = startPos.z + (endPos.z - startPos.z) * t;

                this.game.gameManager.call('createParticles', {
                    position: new THREE.Vector3(trailX, startPos.y + 15, trailZ),
                    count: 8,
                    lifetime: 0.4,
                    visual: {
                        color: 0x4682b4,
                        colorRange: { start: 0x87ceeb, end: 0x4169e1 },
                        scale: 10,
                        scaleMultiplier: 1.2,
                        fadeOut: true,
                        blending: 'additive'
                    },
                    velocityRange: { x: [-30, 30], y: [20, 60], z: [-30, 30] },
                    gravity: 0,
                    drag: 0.9
                });
            }

            // Muzzle flash at start
            this.game.gameManager.call('createLayeredEffect', {
                position: new THREE.Vector3(startPos.x, startPos.y + 15, startPos.z),
                layers: [
                    // Bright flash
                    {
                        count: 8,
                        lifetime: 0.2,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0x87ceeb },
                        scale: 20,
                        scaleMultiplier: 2.5,
                        velocityRange: { x: [-40, 40], y: [20, 60], z: [-40, 40] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    },
                    // Blue sparks
                    {
                        count: 12,
                        lifetime: 0.4,
                        color: 0x4682b4,
                        colorRange: { start: 0x87ceeb, end: 0x4169e1 },
                        scale: 8,
                        scaleMultiplier: 0.8,
                        velocityRange: { x: [-60, 60], y: [30, 80], z: [-60, 60] },
                        gravity: 100,
                        drag: 0.94,
                        blending: 'additive'
                    }
                ]
            });
        }

        // Create energy beam if effects system supports it
        if (this.game.effectsSystem && this.game.effectsSystem.createEnergyBeam) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(startPos.x, startPos.y + 15, startPos.z),
                new THREE.Vector3(endPos.x, endPos.y + 15, endPos.z),
                {
                    style: { color: 0x4682B4, linewidth: 4 },
                    animation: { duration: 800, flickerCount: 2 }
                }
            );
        }
    }
    
    applyPiercingDamage(casterEntity, startPos, endPos) {
        // Get all enemies in range and filter those hit by the line
        const enemies = this.getEnemiesInRange(casterEntity, this.range);
        const hitEnemies = this.getEnemiesInLine(enemies, startPos, endPos);
        
        if (hitEnemies.length === 0) {
            this.logAbilityUsage(casterEntity, `Piercing bolt finds no targets!`);
            return;
        }
        
        // Sort hit enemies by distance along the line for consistent damage application
        const sortedHitEnemies = this.sortEnemiesByDistanceAlongLine(hitEnemies, startPos, endPos);
        
        // Apply damage to each enemy in order
        sortedHitEnemies.forEach((enemyData, index) => {
            const { enemyId, position } = enemyData;
            
            // Apply piercing damage
            this.dealDamageWithEffects(casterEntity, enemyId, this.piercingDamage, this.element, {
                isPiercing: true,
                piercingIndex: index,
                totalPierced: sortedHitEnemies.length
            });
            
            // Create impact effect at each enemy position
            this.createVisualEffect(position, 'impact');
            
         
        });
        
        // Screen effects for dramatic impact
        if (this.game.effectsSystem && sortedHitEnemies.length > 1) {
            this.game.effectsSystem.playScreenShake(0.4, 2);
        }
        
        this.logAbilityUsage(casterEntity, 
            `Crossbow bolt pierces through ${sortedHitEnemies.length} enemies!`);
    }
    
    // FIXED: Deterministic line end position calculation
    calculateLineEndPosition(startPos, facing) {
        return {
            x: startPos.x + Math.cos(facing.angle) * this.range,
            y: startPos.y,
            z: startPos.z + Math.sin(facing.angle) * this.range
        };
    }
    
    // FIXED: Deterministic enemy filtering in line
    getEnemiesInLine(enemies, startPos, endPos) {
        // Sort enemies deterministically first for consistent processing
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        const hitEnemies = [];
        
        sortedEnemies.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            if (!enemyPos) return;
            
            if (this.isInLine(startPos, endPos, enemyPos, this.lineWidth)) {
                hitEnemies.push({
                    enemyId: enemyId,
                    position: { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z }
                });
            }
        });
        
        return hitEnemies;
    }
    
    // FIXED: More precise and deterministic line-point distance calculation
    isInLine(start, end, point, width) {
        if (!point) return false;
        
        // Calculate line parameters more precisely
        const lineLength = Math.sqrt(
            Math.pow(end.x - start.x, 2) + Math.pow(end.z - start.z, 2)
        );
        
        if (lineLength < 0.001) return false; // Avoid division by zero
        
        // Calculate perpendicular distance from point to line
        const A = end.z - start.z;
        const B = start.x - end.x;
        const C = end.x * start.z - start.x * end.z;
        
        const distance = Math.abs(A * point.x + B * point.z + C) / Math.sqrt(A * A + B * B);
        
        // Also check if point is within the line segment bounds
        const dotProduct = (point.x - start.x) * (end.x - start.x) + (point.z - start.z) * (end.z - start.z);
        const projectionRatio = dotProduct / (lineLength * lineLength);
        
        // Point must be within line width and within line segment bounds
        return distance <= width && projectionRatio >= 0 && projectionRatio <= 1;
    }
    
    // FIXED: Sort enemies by distance along line for consistent ordering
    sortEnemiesByDistanceAlongLine(hitEnemies, startPos, endPos) {
        return hitEnemies.slice().sort((a, b) => {
            // Calculate distance from start of line for each enemy
            const distanceA = Math.sqrt(
                Math.pow(a.position.x - startPos.x, 2) + 
                Math.pow(a.position.z - startPos.z, 2)
            );
            const distanceB = Math.sqrt(
                Math.pow(b.position.x - startPos.x, 2) + 
                Math.pow(b.position.z - startPos.z, 2)
            );
            
            // Sort by distance from caster, then by entity ID for tie-breaking
            if (Math.abs(distanceA - distanceB) < 0.001) {
                return String(a.enemyId).localeCompare(String(b.enemyId));
            }
            return distanceA - distanceB;
        });
    }
}