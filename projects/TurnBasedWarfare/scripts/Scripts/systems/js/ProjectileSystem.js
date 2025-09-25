class ProjectileSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.projectileSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration
        this.HIT_DETECTION_RADIUS = 24;
        this.TRAIL_UPDATE_INTERVAL = 0.05;
        
        // Ballistic configuration
        this.DEFAULT_LAUNCH_ANGLE = Math.PI / 4; // 45 degrees
        this.MIN_LAUNCH_ANGLE = Math.PI / 6; // 30 degrees
        this.MAX_LAUNCH_ANGLE = Math.PI / 3; // 60 degrees
        this.BALLISTIC_HEIGHT_MULTIPLIER = 0.3; // How high the arc goes relative to distance
        this.PROJECTILE_LIFETIME = 200;
        
        // Ground impact detection
        this.GROUND_IMPACT_THRESHOLD = 0; // Distance from ground to trigger impact
        
        // Trail tracking for visual effects
        this.projectileTrails = new Map();
        
        // Get gravity from movement system
        this.GRAVITY = this.game.movementSystem?.GRAVITY;
    }
    
    // Deterministic rounding helper
    roundForDeterminism(value, precision = 6) {
        return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
    }
    
    fireProjectile(sourceId, targetId, projectileData = {}) {
        const sourcePos = this.game.getComponent(sourceId, this.componentTypes.POSITION);
        const sourceCombat = this.game.getComponent(sourceId, this.componentTypes.COMBAT);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
        if (!sourcePos || !sourceCombat || !targetPos) return null;
        
        // Create projectile entity
        const projectileId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        
        // Determine projectile element (from weapon, combat component, or projectile data)
        const projectileElement = this.determineProjectileElement(sourceId, projectileData);
        
        // Pass source ID to trajectory calculation for ballistic projectiles
        const projectileDataWithSource = { ...projectileData, sourceId: sourceId };
        
        // Calculate trajectory based on projectile type
        const trajectory = this.calculateTrajectory(sourcePos, targetPos, projectileDataWithSource);
        
        // Determine spawn height - ballistic projectiles start above ground to avoid immediate impact
        const spawnHeight = Math.max(sourcePos.y + 20, 20);           
        
        // Add components with full 3D support
        this.game.addComponent(projectileId, this.componentTypes.POSITION, 
            components.Position(sourcePos.x, spawnHeight, sourcePos.z));
        
        this.game.addComponent(projectileId, this.componentTypes.VELOCITY, 
            components.Velocity(trajectory.vx, trajectory.vy, trajectory.vz, projectileData.speed, projectileData.ballistic || false));
        
         // Enhanced projectile component with element
        this.game.addComponent(projectileId, this.componentTypes.PROJECTILE, {
            damage: sourceCombat.damage,
            speed: projectileData.speed,
            range: sourceCombat.range * 1.5,
            target: targetId,
            source: sourceId,
            startTime: this.game.state.now,
            startX: sourcePos.x,
            startY: spawnHeight,
            startZ: sourcePos.z,
            isBallistic: projectileData.ballistic || false,
            targetX: targetPos.x,
            targetY: targetPos.y + 20,
            targetZ: targetPos.z,
            launchAngle: trajectory.launchAngle,
            timeToTarget: trajectory.timeToTarget,
            weaponRange: trajectory.weaponRange || sourceCombat.range,
            element: projectileElement
        });

        const sourceTeam = this.game.getComponent(sourceId, this.componentTypes.TEAM);
        
        // Add UNIT_TYPE component for projectiles
        this.game.addComponent(projectileId, this.componentTypes.UNIT_TYPE, 
            components.UnitType(projectileData.id, projectileData.title, 0));
        
        // Add TEAM component (same team as source)
        if (sourceTeam) {
            this.game.addComponent(projectileId, this.componentTypes.TEAM, 
                components.Team(sourceTeam.team));
        }

        // Visual component        
        this.game.addComponent(projectileId, this.componentTypes.RENDERABLE, 
            components.Renderable("projectiles", projectileData.id));
        
        // Use LifetimeSystem instead of direct component
        if (this.game.lifetimeSystem) {
            this.game.lifetimeSystem.addLifetime(projectileId, this.PROJECTILE_LIFETIME, {
                fadeOutDuration: 1.0, // Fade out in last second
                destructionEffect: {
                    type: 'magic',
                    count: 5,
                    color: this.getElementalEffectColor(projectileElement),
                    scaleMultiplier: 0.8
                },
                onDestroy: (entityId) => {
                    // Custom cleanup for projectiles
                    this.cleanupProjectileData(entityId);
                }
            });
        } else {
            // Fallback to old method if LifetimeSystem not available
            this.game.addComponent(projectileId, this.componentTypes.LIFETIME, 
                components.Lifetime(this.PROJECTILE_LIFETIME, this.game.state.now));
        }
        
        // Homing component if specified
        if (projectileData.homing && projectileData.homingStrength > 0) {
            const homingStrength = projectileData.ballistic ? 
                projectileData.homingStrength * 0.3 : projectileData.homingStrength;
            this.game.addComponent(projectileId, this.componentTypes.HOMING_TARGET, 
                components.HomingTarget(targetId, homingStrength, { x: targetPos.x, y: targetPos.y, z: targetPos.z }));
        }
        
        return projectileId;
    }
    
    cleanupProjectileData(projectileId) {
        // Clean up trail data
        this.projectileTrails.delete(projectileId);
    }

    /**
     * Determine the element of a projectile based on various sources
     */
    determineProjectileElement(sourceId, projectileData) {
        // Priority order: projectile data > weapon element > combat element > default physical
        
        // 1. Check projectile data for explicit element
        if (projectileData.element) {
            return projectileData.element;
        }
        
        // 2. Check combat component element
        const sourceCombat = this.game.getComponent(sourceId, this.componentTypes.COMBAT);
        if (sourceCombat && sourceCombat.element) {
            return sourceCombat.element;
        }
        
        // 3. Default to physical
        return this.game.damageSystem?.ELEMENT_TYPES?.PHYSICAL || 'physical';
    }

    calculateTrajectory(sourcePos, targetPos, projectileData) {
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y; // Height difference
        const dz = targetPos.z - sourcePos.z; // Forward/backward distance
        const projectileSpeed = projectileData.speed;
        
        // For ballistic projectiles, calculate arc trajectory based on weapon range
        if (projectileData.ballistic) {
            return this.calculateBallisticTrajectory(sourcePos, targetPos, projectileSpeed, projectileData);
        } else {
            // Direct trajectory for non-ballistic projectiles
            const totalDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (totalDistance === 0) {
                return { vx: 0, vy: 0, vz: 0, launchAngle: 0, timeToTarget: 0 };
            }
            
            const initialVx = (dx / totalDistance) * projectileSpeed;
            const initialVy = (dy / totalDistance) * projectileSpeed;
            const initialVz = (dz / totalDistance) * projectileSpeed;
            
            return {
                vx: this.roundForDeterminism(initialVx),
                vy: this.roundForDeterminism(initialVy),
                vz: this.roundForDeterminism(initialVz),
                launchAngle: this.roundForDeterminism(Math.atan2(Math.sqrt(dx * dx + dz * dz), dy)),
                timeToTarget: this.roundForDeterminism(totalDistance / projectileSpeed)
            };
        }
    }
    
    calculateBallisticTrajectory(sourcePos, targetPos, speed, projectileData) {
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y; // Height difference
        const dz = targetPos.z - sourcePos.z; // Forward/backward distance
        
        const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
        
        if (horizontalDistance === 0) {
            return { vx: 0, vy: 0, vz: 0, launchAngle: 0, timeToTarget: 0 };
        }
        
        // Get the firing unit's combat range to determine proper ballistic trajectory
        const sourceId = projectileData.sourceId;
        const sourceCombat = sourceId ? this.game.getComponent(sourceId, this.componentTypes.COMBAT) : null;
        const weaponRange = sourceCombat ? sourceCombat.range : horizontalDistance;
        
        // Use 45-degree angle for optimal range (gives maximum distance for given initial velocity)
        const launchAngle = Math.PI / 4; // 45 degrees
        const g = this.GRAVITY;
        
        // Calculate the initial velocity needed to reach the weapon's maximum range at 45 degrees
        const optimalInitialVelocity = Math.sqrt(weaponRange * g);
        
        // Calculate what range this velocity would achieve at our target distance
        const actualRange = Math.min(horizontalDistance, weaponRange);
        
        // If target is within range, calculate trajectory to hit it exactly
        let initialVelocity;
        let actualLaunchAngle = launchAngle;
        
        if (horizontalDistance <= weaponRange) {
            // Target is within range - calculate exact trajectory
            const maxRangeAtOptimalVelocity = (optimalInitialVelocity * optimalInitialVelocity) / g;
            
            if (horizontalDistance <= maxRangeAtOptimalVelocity) {
                // We can reach this distance with our optimal velocity
                initialVelocity = optimalInitialVelocity;
                // Calculate the required angle: sin(2θ) = (range * g) / v₀²
                const sin2Theta = (horizontalDistance * g) / (initialVelocity * initialVelocity);
                
                // We want the lower trajectory angle (there are two solutions)
                const angle2Theta = Math.asin(Math.min(1, sin2Theta));
                actualLaunchAngle = angle2Theta / 2;
                
                // Prefer angles between 15° and 75° for realistic artillery
                if (actualLaunchAngle < Math.PI / 12) { // Less than 15°
                    actualLaunchAngle = Math.PI / 12;
                } else if (actualLaunchAngle > 5 * Math.PI / 12) { // More than 75°
                    actualLaunchAngle = 5 * Math.PI / 12;
                }
            } else {
                // Use 45° and calculate required velocity for this specific distance
                actualLaunchAngle = Math.PI / 4;
                initialVelocity = Math.sqrt(horizontalDistance * g);
            }
        } else {
            // Target is beyond weapon range - fire at maximum range in target direction
            initialVelocity = optimalInitialVelocity;
            actualLaunchAngle = Math.PI / 4; // 45° for maximum range
        }
        
        // Calculate time of flight
        const timeToTarget = (2 * initialVelocity * Math.sin(actualLaunchAngle)) / g;
        
        // Calculate horizontal direction unit vector
        const horizontalDirectionX = dx / horizontalDistance;
        const horizontalDirectionZ = dz / horizontalDistance;
        
        // Calculate initial velocity components
        const horizontalVelocity = initialVelocity * Math.cos(actualLaunchAngle);
        const vx = horizontalDirectionX * horizontalVelocity;
        const vz = horizontalDirectionZ * horizontalVelocity;
        const vy = initialVelocity * Math.sin(actualLaunchAngle); // Initial upward velocity
        
        // Adjust for height difference if target is at different elevation
        if (Math.abs(dy) > 5) { // Only adjust for significant height differences
            const heightAdjustment = dy / timeToTarget;
            const adjustedVy = vy + heightAdjustment;
            
            return {
                vx: this.roundForDeterminism(vx),
                vy: this.roundForDeterminism(adjustedVy),
                vz: this.roundForDeterminism(vz),
                launchAngle: this.roundForDeterminism(actualLaunchAngle),
                timeToTarget: this.roundForDeterminism(timeToTarget),
                weaponRange: this.roundForDeterminism(weaponRange),
                calculatedRange: this.roundForDeterminism((initialVelocity * initialVelocity * Math.sin(2 * actualLaunchAngle)) / g)
            };
        }
        
        return {
            vx: this.roundForDeterminism(vx),
            vy: this.roundForDeterminism(vy),
            vz: this.roundForDeterminism(vz),
            launchAngle: this.roundForDeterminism(actualLaunchAngle),
            timeToTarget: this.roundForDeterminism(timeToTarget),
            weaponRange: this.roundForDeterminism(weaponRange),
            calculatedRange: this.roundForDeterminism((initialVelocity * initialVelocity * Math.sin(2 * actualLaunchAngle)) / g)
        };
    }
    
    update() {
        if (this.game.state.phase !== 'battle') return;
        
        const projectiles = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.VELOCITY, 
            this.componentTypes.PROJECTILE
        );        
        projectiles.forEach(projectileId => {
            const pos = this.game.getComponent(projectileId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(projectileId, this.componentTypes.VELOCITY);
            const projectile = this.game.getComponent(projectileId, this.componentTypes.PROJECTILE);
            const homing = this.game.getComponent(projectileId, this.componentTypes.HOMING_TARGET);
                        
            // Update homing behavior
            if (homing && homing.targetId && projectile.isBallistic) {
                this.updateBallisticHoming(projectileId, pos, vel, projectile, homing);
            } else if (homing && homing.targetId) {
                this.updateHomingProjectile(projectileId, pos, vel, projectile, homing);
            }
            
            // Handle different collision types based on projectile type
            if (projectile.isBallistic) {
                // Ballistic projectiles ONLY check for ground impact
                this.handleProjectileGroundImpact(projectileId, pos, projectile);
            } else {
                // Non-ballistic projectiles check for direct unit hits
                this.checkProjectileCollisions(projectileId, pos, projectile);
            }
            
            // Update visual trail
            this.updateProjectileTrail(projectileId, pos);
        });
    }
    
    updateBallisticHoming(projectileId, pos, vel, projectile, homing) {
        // Get current target position
        const targetPos = this.game.getComponent(homing.targetId, this.componentTypes.POSITION);
        
        if (targetPos) {
            // Update last known position
            homing.lastKnownPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
            
            // For ballistic projectiles, we adjust the trajectory mid-flight
            // Calculate time elapsed since launch
            const timeElapsed = this.game.state.now - projectile.startTime;
            const remainingTime = Math.max(0.1, projectile.timeToTarget - timeElapsed);
            
            // Calculate where we need to be to hit the moving target
            const dx = targetPos.x - pos.x;
            const dy = targetPos.y - pos.y;
            const dz = targetPos.z - pos.z;
            
            // Adjust horizontal velocity to reach new target position
            const requiredHorizontalVelX = dx / remainingTime;
            const requiredHorizontalVelZ = dz / remainingTime;
            
            // Apply homing adjustment with strength factor
            const homingStrength = homing.homingStrength * this.game.state.deltaTime * 2; // Reduced for ballistic
            vel.vx = this.roundForDeterminism(vel.vx * (1 - homingStrength) + requiredHorizontalVelX * homingStrength);
            vel.vz = this.roundForDeterminism(vel.vz * (1 - homingStrength) + requiredHorizontalVelZ * homingStrength);
            
            // For vertical homing, we need to be more careful to maintain ballistic arc
            // Only adjust if we're in the descending phase
            if (vel.vy < 0) { // Falling down
                const requiredVerticalVel = (dy + 0.5 * this.GRAVITY * remainingTime * remainingTime) / remainingTime;
                vel.vy = this.roundForDeterminism(vel.vy * (1 - homingStrength * 0.5) + requiredVerticalVel * (homingStrength * 0.5));
            }
        } else if (homing.lastKnownPosition) {
            // Target is gone, continue toward last known position
            const dx = homing.lastKnownPosition.x - pos.x;
            const dy = homing.lastKnownPosition.y - pos.y;
            const dz = homing.lastKnownPosition.z - pos.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (distance < 20) {
                // Close enough to last known position, destroy projectile
                this.destroyProjectile(projectileId);
                return;
            }
        }
    }
    
    updateHomingProjectile(projectileId, pos, vel, projectile, homing) {
        // Get current target position
        const targetPos = this.game.getComponent(homing.targetId, this.componentTypes.POSITION);
        
        if (targetPos) {
            // Update last known position
            homing.lastKnownPosition = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
            
            // Calculate direction to target
            const dx = targetPos.x - pos.x;
            const dy = targetPos.y - pos.y;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (distance > 0) {
                // Calculate desired velocity direction
                const desiredVx = (dx / distance) * projectile.speed;
                const desiredVy = (dy / distance) * projectile.speed;
                const desiredVz = (dz / distance) * projectile.speed;
                
                // Blend current velocity with desired velocity based on homing strength
                const homingStrength = homing.homingStrength * this.game.state.deltaTime * 5; // Adjust responsiveness
                vel.vx = this.roundForDeterminism(vel.vx * (1 - homingStrength) + desiredVx * homingStrength);
                vel.vy = this.roundForDeterminism(vel.vy * (1 - homingStrength) + desiredVy * homingStrength);
                vel.vz = this.roundForDeterminism(vel.vz * (1 - homingStrength) + desiredVz * homingStrength);
                
                // Maintain speed
                const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy + vel.vz * vel.vz);
                if (currentSpeed > 0) {
                    const speedRatio = projectile.speed / currentSpeed;
                    vel.vx = this.roundForDeterminism(vel.vx * speedRatio);
                    vel.vy = this.roundForDeterminism(vel.vy * speedRatio);
                    vel.vz = this.roundForDeterminism(vel.vz * speedRatio);
                }
            }
        } else {
            homing.targetId = null;
        }
    }
    
    checkProjectileCollisions(projectileId, pos, projectile) {
        // Only for NON-ballistic projectiles
        if (projectile.isBallistic) return; // Skip collision check for ballistic
        
        // Get all potential targets
        const allEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        );
        
        const sourceTeam = this.game.getComponent(projectile.source, this.componentTypes.TEAM);
        if (!sourceTeam) return;
        
        let hitDetected = false;

        for (const entityId of allEntities) {
            if (hitDetected) break; // Stop after first hit to ensure consistency
            if (entityId === projectile.source) continue; // Don't hit the source
            
            const entityPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const entityTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const entityHealth = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            if (!entityPos || !entityTeam || !entityHealth) continue;
            if (entityTeam.team === sourceTeam.team) continue; // Don't hit allies
            
            // Calculate 3D distance with consistent precision
            const dx = Math.round((entityPos.x - pos.x) * 1000) / 1000;
            const dy = Math.round((entityPos.y - pos.y) * 1000) / 1000;
            const dz = Math.round((entityPos.z - pos.z) * 1000) / 1000;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            // Get entity radius for collision detection
            const entityUnitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const entityRadius = this.getUnitRadius(entityUnitType);

            // Check collision for direct hit
            if (distance <= entityRadius + this.HIT_DETECTION_RADIUS) {
                // Direct hit detected!
                this.handleProjectileHit(projectileId, entityId, projectile);
                hitDetected = true;
                break;
            }
        }
    }
    
    handleProjectileGroundImpact(entityId, pos, projectile) {
        // Only for ballistic projectiles
        if (!projectile.isBallistic) return;
        
        // Get actual terrain height for projectile impact
        const terrainHeight = this.game.worldSystem.getTerrainHeightAtPosition(pos.x, pos.z);
        const actualGroundLevel = terrainHeight !== null ? terrainHeight : this.game.movementSystem?.GROUND_LEVEL || 0;
        
        // Check if projectile hit the ground
        if (pos.y <= actualGroundLevel + this.GROUND_IMPACT_THRESHOLD) {
            // Ballistic projectiles explode on ground impact
            this.triggerBallisticExplosion(entityId, pos, projectile, actualGroundLevel);
            return;
        }
    }

    handleProjectileHit(projectileId, targetId, projectile) {
        // Use centralized damage system for projectile hits
        if (this.game.damageSystem) {
            const damage = projectile.damage;
            const element = projectile.element || this.game.damageSystem.ELEMENT_TYPES.PHYSICAL;
            
            // Apply elemental damage through the damage system
            const result = this.game.damageSystem.applyDamage(projectile.source, targetId, damage, element, {
                isProjectile: true,
                projectileId: projectileId
            });
            
            // Log projectile hit
            if (result.damage > 0 && this.game.battleLogSystem) {
                const sourceUnitType = this.game.getComponent(projectile.source, this.componentTypes.UNIT_TYPE);
                const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
                const sourceTeam = this.game.getComponent(projectile.source, this.componentTypes.TEAM);
                const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
                
                if (sourceUnitType && targetUnitType && sourceTeam && targetTeam) {
                    const elementText = element !== this.game.damageSystem.ELEMENT_TYPES.PHYSICAL ? ` (${element})` : '';
                    this.game.battleLogSystem.add(
                        `${sourceTeam.team} ${sourceUnitType.type} projectile${elementText} hits ${targetTeam.team} ${targetUnitType.type} for ${result.damage} damage`, 
                        'log-damage'
                    );
                }
            }
        }
        
        // Create hit effect
        this.createHitEffect(projectileId, targetId, false);
        
        // Destroy projectile
        this.destroyProjectile(projectileId);
    }

    triggerBallisticExplosion(entityId, pos, projectile, groundLevel) {
        // Create explosion effect at ground impact point
        this.createGroundExplosion(entityId, pos, projectile, groundLevel);
        
        // Apply splash damage using centralized damage system
        if (this.game.damageSystem) {
            const splashRadius = 80; // Reasonable explosion radius
            const splashDamage = Math.floor(projectile.damage);
            const element = projectile.element || this.game.damageSystem.ELEMENT_TYPES.PHYSICAL;
            
            const results = this.game.damageSystem.applySplashDamage(
                projectile.source,
                pos,
                splashDamage,
                element,
                splashRadius,
                {
                    isBallistic: true,
                    projectileId: entityId,
                    allowFriendlyFire: false
                }
            );
            
            // Log explosion with results
            if (this.game.battleLogSystem) {
                const elementText = element !== this.game.damageSystem.ELEMENT_TYPES.PHYSICAL ? ` ${element}` : '';
                this.game.battleLogSystem.add(`Ballistic${elementText} projectile explodes on impact!`, 'log-explosion');
            }
        }
        
        // Destroy the projectile
        this.destroyProjectile(entityId);
    }
    
    createHitEffect(projectileId, targetId, isBallistic = false) {

    
    }

    createGroundExplosion(projectileId, pos, projectile, groundLevel) {

    }

    // Get visual effect color based on element
    getElementalEffectColor(element) {
        if (!this.game.damageSystem) return '#ffaa00'; // Default orange
        
        switch (element) {
            case this.game.damageSystem.ELEMENT_TYPES.FIRE:
                return '#ff4400'; // Orange-red
            case this.game.damageSystem.ELEMENT_TYPES.COLD:
                return '#44aaff'; // Light blue
            case this.game.damageSystem.ELEMENT_TYPES.LIGHTNING:
                return '#ffff44'; // Bright yellow
            case this.game.damageSystem.ELEMENT_TYPES.POISON:
                return '#44ff44'; // Green
            case this.game.damageSystem.ELEMENT_TYPES.DIVINE:
                return '#ffddaa'; // Golden
            case this.game.damageSystem.ELEMENT_TYPES.PHYSICAL:
            default:
                return '#ffaa00'; // Default orange
        }
    }

    // Get explosion effect type based on element
    getElementalExplosionEffect(element) {
        if (!this.game.damageSystem) return 'explosion';
        
        switch (element) {
            case this.game.damageSystem.ELEMENT_TYPES.FIRE:
                return 'fire_explosion';
            case this.game.damageSystem.ELEMENT_TYPES.COLD:
                return 'ice_explosion';
            case this.game.damageSystem.ELEMENT_TYPES.LIGHTNING:
                return 'lightning_explosion';
            case this.game.damageSystem.ELEMENT_TYPES.POISON:
                return 'poison_explosion';
            case this.game.damageSystem.ELEMENT_TYPES.DIVINE:
                return 'divine_explosion';
            case this.game.damageSystem.ELEMENT_TYPES.PHYSICAL:
            default:
                return 'explosion';
        }
    }
    
    updateProjectileTrail(projectileId, pos) {
        const projectileVisual = this.game.getComponent(projectileId, this.componentTypes.PROJECTILE_VISUAL);
        if (!projectileVisual || projectileVisual.trailLength <= 0) return;
        
        if (!this.projectileTrails.has(projectileId)) {
            this.projectileTrails.set(projectileId, []);
        }
        
        const trail = this.projectileTrails.get(projectileId);
        
        // Add current position to trail (full 3D)
        trail.push({ x: pos.x, y: pos.y, z: pos.z, time: (this.game.state.now || 0) });
        
        // Remove old trail points
        while (trail.length > projectileVisual.trailLength) {
            trail.shift();
        }
    }
        
    destroyProjectile(projectileId) {
        // Use LifetimeSystem for destruction if available
        if (this.game.lifetimeSystem) {
            this.game.lifetimeSystem.destroyEntityImmediately(projectileId, true);
        } else {
            // Fallback cleanup
            this.cleanupProjectileData(projectileId);
            this.game.destroyEntity(projectileId);
        }
    }
    
    getUnitRadius(unitType) {
        const DEFAULT_UNIT_RADIUS = 15;
        
        if (unitType && unitType.size) {
            return Math.max(DEFAULT_UNIT_RADIUS, unitType.size);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return Math.max(DEFAULT_UNIT_RADIUS, unitDef.size);
            }
        }
        
        return DEFAULT_UNIT_RADIUS;
    }
    
    getProjectileTrail(projectileId) {
        return this.projectileTrails.get(projectileId) || [];
    }
    entityDestroyed(entityId) {
        // Clean up projectile trails
        if (this.projectileTrails) {
            this.projectileTrails.delete(entityId);
        }
        
        // Clean up any projectile tracking
        if (this.activeProjectiles) {
            this.activeProjectiles.delete(entityId);
        }
    }
}