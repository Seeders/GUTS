class ProjectileSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.projectileSystem = this;

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

    init() {
        this.game.gameManager.register('deleteProjectileTrail', this.deleteProjectileTrail.bind(this));
        this.game.gameManager.register('fireProjectile', this.fireProjectile.bind(this));
    }

    deleteProjectileTrail(entityId) {
        if (this.projectileTrails) {
            this.projectileTrails.delete(entityId);
        }
    }

    fireProjectile(sourceId, targetId, projectileData = {}) {
        const sourceTransform = this.game.getComponent(sourceId, "transform");
        const sourcePos = sourceTransform?.position;
        const sourceCombat = this.game.getComponent(sourceId, "combat");
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!sourcePos || !sourceCombat || !targetPos) return null;

        // Generate deterministic projectile ID using source entity and game time
        const projectileId = `projectile_${sourceId}_${Math.floor(this.game.state.now * 1000)}`;

        // Create projectile entity with explicit ID
        this.game.createEntity(projectileId);
        const components = this.game.gameManager.call('getComponents');
        
        // Determine projectile element (from weapon, combat component, or projectile data)
        const projectileElement = this.determineProjectileElement(sourceId, projectileData);
        
        // Pass source ID to trajectory calculation for ballistic projectiles
        const projectileDataWithSource = { ...projectileData, sourceId: sourceId };
        
        // Calculate trajectory based on projectile type
        const trajectory = this.calculateTrajectory(sourcePos, targetPos, projectileDataWithSource);
        
        // Determine spawn height - ballistic projectiles start above ground to avoid immediate impact
        const spawnHeight = Math.max(sourcePos.y + 20, 20);

        // Calculate rotation from velocity direction (for sprite direction)
        const rotationY = Math.atan2(trajectory.vz, trajectory.vx);

        // Add components with full 3D support
        this.game.addComponent(projectileId, "transform",
            {
                position: { x: sourcePos.x, y: spawnHeight, z: sourcePos.z },
                rotation: { x: 0, y: rotationY, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            });

        this.game.addComponent(projectileId, "velocity",
            { vx: trajectory.vx, vy: trajectory.vy, vz: trajectory.vz, maxSpeed: projectileData.speed, affectedByGravity: projectileData.ballistic || false, anchored: false });

         // Enhanced projectile component with element
        this.game.addComponent(projectileId, "projectile", {
            damage: projectileData.damage || sourceCombat.damage,
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
            element: projectileElement,
            splashRadius: projectileData.splashRadius || 80,
            onHit: projectileData.onHit || null,
            onTravel: projectileData.onTravel || null,
            lastTrailTime: this.game.state.now
        });

        const sourceTeam = this.game.getComponent(sourceId, "team");

        // Add UNIT_TYPE component for projectiles
        this.game.addComponent(projectileId, "unitType",
            {});

        // Add TEAM component (same team as source)
        if (sourceTeam) {
            this.game.addComponent(projectileId, "team",
                { team: sourceTeam.team });
        }

        // Visual component
        this.game.addComponent(projectileId, "renderable",
            { objectType: "projectiles", spawnType: projectileData.id });
        
        // Use LifetimeSystem instead of direct component
        if (this.game.gameManager) {
            this.game.gameManager.call('addLifetime', projectileId, this.PROJECTILE_LIFETIME, {
                fadeOutDuration: 1.0, // Fade out in last second
                onDestroy: (entityId) => {
                    // Custom cleanup for projectiles
                    this.cleanupProjectileData(entityId);
                }
            });
        } else {
            // Fallback to old method if LifetimeSystem not available
            this.game.addComponent(projectileId, "lifetime",
                { duration: this.PROJECTILE_LIFETIME, startTime: this.game.state.now });
        }

        // Homing component if specified
        if (projectileData.homing && projectileData.homingStrength > 0) {
            const homingStrength = projectileData.ballistic ?
                projectileData.homingStrength * 0.3 : projectileData.homingStrength;
            this.game.addComponent(projectileId, "homingTarget",
                { targetId: targetId, homingStrength: homingStrength, lastKnownPosition: { x: targetPos.x, y: targetPos.y, z: targetPos.z } });
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
        const sourceCombat = this.game.getComponent(sourceId, "combat");
        if (sourceCombat && sourceCombat.element) {
            return sourceCombat.element;
        }
        
        // 3. Default to physical
        const elementTypes = this.game.gameManager ? this.game.gameManager.call('getDamageElementTypes') : null;
        return elementTypes?.PHYSICAL || 'physical';
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
        const dy = targetPos.y - sourcePos.y;
        const dz = targetPos.z - sourcePos.z;

        const horizontalDistance = Math.sqrt(dx * dx + dz * dz);

        if (horizontalDistance === 0) {
            return { vx: 0, vy: 0, vz: 0, launchAngle: 0, timeToTarget: 0 };
        }

        const g = this.GRAVITY;

        // Choose launch angle based on distance - steeper for close, flatter for far
        // Close targets: use higher angle (60°) so arc lands on target, not behind
        // Far targets: use lower angle (30-45°) for range
        const sourceId = projectileData.sourceId;
        const sourceCombat = sourceId ? this.game.getComponent(sourceId, "combat") : null;
        const weaponRange = sourceCombat ? sourceCombat.range : 300;

        // Normalize distance ratio (0 = point blank, 1 = max range)
        const distanceRatio = Math.min(1, horizontalDistance / weaponRange);

        // Interpolate angle: 60° at close range, 30° at max range
        const closeAngle = Math.PI / 3;  // 60 degrees
        const farAngle = Math.PI / 6;    // 30 degrees
        const actualLaunchAngle = closeAngle - (closeAngle - farAngle) * distanceRatio;

        // Calculate velocity needed to hit target at this angle
        // Range formula: R = v² * sin(2θ) / g
        // Solving for v: v = sqrt(R * g / sin(2θ))
        const sin2Theta = Math.sin(2 * actualLaunchAngle);
        const initialVelocity = Math.sqrt((horizontalDistance * g) / sin2Theta);

        // Calculate time of flight
        const timeToTarget = (2 * initialVelocity * Math.sin(actualLaunchAngle)) / g;

        // Calculate horizontal direction unit vector
        const horizontalDirectionX = dx / horizontalDistance;
        const horizontalDirectionZ = dz / horizontalDistance;

        // Calculate initial velocity components
        const horizontalVelocity = initialVelocity * Math.cos(actualLaunchAngle);
        const vx = horizontalDirectionX * horizontalVelocity;
        const vz = horizontalDirectionZ * horizontalVelocity;
        let vy = initialVelocity * Math.sin(actualLaunchAngle);

        // Adjust for height difference
        if (Math.abs(dy) > 5) {
            vy += dy / timeToTarget;
        }

        return {
            vx: this.roundForDeterminism(vx),
            vy: this.roundForDeterminism(vy),
            vz: this.roundForDeterminism(vz),
            launchAngle: this.roundForDeterminism(actualLaunchAngle),
            timeToTarget: this.roundForDeterminism(timeToTarget),
            weaponRange: this.roundForDeterminism(weaponRange),
            calculatedRange: this.roundForDeterminism(horizontalDistance)
        };
    }
    
    update() {
        if (this.game.state.phase !== 'battle') return;

        const projectiles = this.game.getEntitiesWith(
            "transform",
            "velocity",
            "projectile"
        );
        // Sort for deterministic processing order (prevents desync)
        projectiles.sort((a, b) => String(a).localeCompare(String(b)));

        projectiles.forEach(projectileId => {
            const transform = this.game.getComponent(projectileId, "transform");
            const pos = transform?.position;
            const vel = this.game.getComponent(projectileId, "velocity");
            const projectile = this.game.getComponent(projectileId, "projectile");
            const homing = this.game.getComponent(projectileId, "homingTarget");

            // Skip stuck projectiles (arrows in ground, etc.) - they just wait to expire
            if (projectile.isStuck) {
                return;
            }

            // Update homing behavior
            if (homing && homing.targetId && projectile.isBallistic) {
                this.updateBallisticHoming(projectileId, pos, vel, projectile, homing);
            } else if (homing && homing.targetId) {
                this.updateHomingProjectile(projectileId, pos, vel, projectile, homing);
            }

            // Call onTravel callback for trail effects (throttled)
            if (projectile.onTravel && typeof projectile.onTravel === 'function') {
                const timeSinceLastTrail = this.game.state.now - (projectile.lastTrailTime || 0);
                if (timeSinceLastTrail >= this.TRAIL_UPDATE_INTERVAL) {
                    projectile.onTravel(pos);
                    projectile.lastTrailTime = this.game.state.now;
                }
            }

            // Handle different collision types based on projectile type
            if (projectile.isBallistic) {
                // Ballistic projectiles check for ground impact (collision check happens on landing)
                this.handleProjectileGroundImpact(projectileId, pos, projectile);
            } else {
                // Non-ballistic projectiles check for direct unit hits during flight
                this.checkProjectileCollisions(projectileId, pos, projectile);
            }

            // Update visual trail
            this.updateProjectileTrail(projectileId, pos);
        });
    }
    
    updateBallisticHoming(projectileId, pos, vel, projectile, homing) {
        // Get current target position
        const targetTransform = this.game.getComponent(homing.targetId, "transform");
        const targetPos = targetTransform?.position;

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

            // Update rotation for sprite direction
            const transform = this.game.getComponent(projectileId, "transform");
            if (transform?.rotation) {
                transform.rotation.y = Math.atan2(vel.vz, vel.vx);
            }
            
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
        const targetTransform = this.game.getComponent(homing.targetId, "transform");
        const targetPos = targetTransform?.position;

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

                // Update rotation for sprite direction
                const transform = this.game.getComponent(projectileId, "transform");
                if (transform?.rotation) {
                    transform.rotation.y = Math.atan2(vel.vz, vel.vx);
                }
            }
        } else {
            homing.targetId = null;
        }
    }
    
    checkProjectileCollisions(projectileId, pos, projectile) {
        // Skip if already destroyed by another check
        if (!this.game.hasEntity(projectileId)) return;

        // Get all potential targets
        const allEntities = this.game.getEntitiesWith(
            "transform",
            "team",
            "health"
        );

        const sourceTeam = this.game.getComponent(projectile.source, "team");
        if (!sourceTeam) return;

        // Calculate distances and sort by closest first for deterministic collision (prevents desync)
        const entitiesWithDistance = [];
        for (const entityId of allEntities) {
            if (entityId === projectile.source) continue; // Don't hit the source

            const entityTransform = this.game.getComponent(entityId, "transform");
            const entityPos = entityTransform?.position;
            const entityTeam = this.game.getComponent(entityId, "team");
            const entityHealth = this.game.getComponent(entityId, "health");

            if (!entityPos || !entityTeam || !entityHealth) continue;
            if (entityTeam.team === sourceTeam.team) continue; // Don't hit allies

            // Calculate 3D distance with consistent precision
            const dx = Math.round((entityPos.x - pos.x) * 1000) / 1000;
            const dy = Math.round((entityPos.y - pos.y) * 1000) / 1000;
            const dz = Math.round((entityPos.z - pos.z) * 1000) / 1000;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            entitiesWithDistance.push({ entityId, entityPos, distance });
        }

        // Sort by distance (closest first), then by entity ID for deterministic tie-breaking
        entitiesWithDistance.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            return String(a.entityId).localeCompare(String(b.entityId));
        });

        // Check collision in sorted order - hit closest entity first
        for (const { entityId, entityPos, distance } of entitiesWithDistance) {
            // Get entity radius for collision detection
            const entityUnitType = this.game.getComponent(entityId, "unitType");
            const entityRadius = this.getUnitRadius(entityUnitType);

            // Check collision for direct hit
            if (distance <= entityRadius + this.HIT_DETECTION_RADIUS) {
                // Direct hit detected!
                this.handleProjectileHit(projectileId, entityId, entityPos, projectile);
                break; // Stop after first hit
            }
        }
    }
    
    handleProjectileGroundImpact(entityId, pos, projectile) {
        // Only for ballistic projectiles
        if (!projectile.isBallistic) return;
        
        // Get actual terrain height for projectile impact
        const terrainHeight = this.game.gameManager ? this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z) : null;
        const actualGroundLevel = terrainHeight !== null ? terrainHeight : this.game.movementSystem?.GROUND_LEVEL || 0;
        
        // Check if projectile hit the ground
        if (pos.y <= actualGroundLevel + this.GROUND_IMPACT_THRESHOLD) {
            // Ballistic projectiles explode on ground impact
            this.triggerBallisticExplosion(entityId, pos, projectile, actualGroundLevel);
            return;
        }
    }

    handleProjectileHit(projectileId, targetId, targetPos, projectile) {
        if (this.game.gameManager) {
            const damage = projectile.damage;
            const elementTypes = this.game.gameManager.call('getDamageElementTypes');
            const element = projectile.element || elementTypes.PHYSICAL;

            this.game.gameManager.call('applyDamage', projectile.source, targetId, damage, element, {
                isProjectile: true,
                projectileId: projectileId
            });
            if(!this.game.isServer){
                this.game.gameManager.call('createParticleEffect', targetPos.x, targetPos.y, targetPos.z, 'magic', {
                    color: this.getElementalEffectColor(element),
                    count: 3
                });
            }
        }


        this.destroyProjectile(projectileId);
    }

    triggerBallisticExplosion(entityId, pos, projectile, groundLevel) {
        // Call custom onHit callback if provided
        if (projectile.onHit && typeof projectile.onHit === 'function') {
            projectile.onHit(pos);
            this.destroyProjectile(entityId);
            return;
        }

        // Handle arrows and other projectiles that stick in the ground
        if (projectile.sticksInGround) {
            this.stickProjectileInGround(entityId, pos, projectile, groundLevel);
            return;
        }

        // Default explosion behavior for splash damage projectiles
        this.createGroundExplosion(entityId, pos, projectile, groundLevel);

        if (this.game.gameManager) {
            const splashRadius = projectile.splashRadius || 80;
            const splashDamage = Math.floor(projectile.damage);
            const elementTypes = this.game.gameManager.call('getDamageElementTypes');
            const element = projectile.element || elementTypes.PHYSICAL;

            const results = this.game.gameManager.call('applySplashDamage',
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

            // With behavior tree system, units naturally respond to threats through
            // enemy detection in their behavior tree evaluation - no need for manual retaliation
        }

        this.destroyProjectile(entityId);
    }

    stickProjectileInGround(entityId, pos, projectile, groundLevel) {
        // Check if there's a unit at the landing position
        const hitTarget = this.checkLandingCollision(pos, projectile);
        if (hitTarget) {
            // Hit a unit at landing position - deal damage and destroy arrow
            const targetTransform = this.game.getComponent(hitTarget, 'transform');
            const targetPos = targetTransform?.position || pos;
            this.handleProjectileHit(entityId, hitTarget, targetPos, projectile);
            return;
        }

        // No unit at landing - stick arrow in ground
        const vel = this.game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vy = 0;
            vel.vz = 0;
            vel.affectedByGravity = false;
        }

        // Position the arrow at ground level, partially embedded
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform) {
            transform.position.y = groundLevel + 2; // Stick up slightly from ground
        }

        // Mark as stuck so it's not processed as a flying projectile
        projectile.isStuck = true;

        // Update lifetime to expire after stick duration
        const stickDuration = projectile.stickDuration || 3;
        const lifetime = this.game.getComponent(entityId, 'lifetime');
        if (lifetime) {
            lifetime.startTime = this.game.state.now;
            lifetime.duration = stickDuration;
        }
    }

    checkLandingCollision(pos, projectile) {
        // Use spatial grid lookup instead of iterating all entities
        const sourceTeam = this.game.getComponent(projectile.source, 'team');
        if (!sourceTeam) return null;

        // Get nearby units using grid system - returns array of entityIds
        const searchRadius = this.HIT_DETECTION_RADIUS + 30; // Include unit radius
        const nearbyEntityIds = this.game.gameManager.call('getNearbyUnits', pos, searchRadius, projectile.source);

        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return null;

        for (const entityId of nearbyEntityIds) {
            const entityTeam = this.game.getComponent(entityId, 'team');
            const entityHealth = this.game.getComponent(entityId, 'health');

            if (!entityTeam || !entityHealth) continue;
            if (entityTeam.team === sourceTeam.team) continue;

            const entityTransform = this.game.getComponent(entityId, 'transform');
            const entityPos = entityTransform?.position;
            if (!entityPos) continue;

            // Calculate horizontal distance
            const dx = entityPos.x - pos.x;
            const dz = entityPos.z - pos.z;
            const horizontalDistance = Math.sqrt(dx * dx + dz * dz);

            // Get entity radius for collision detection
            const entityUnitType = this.game.getComponent(entityId, 'unitType');
            const entityRadius = this.getUnitRadius(entityUnitType);

            // Check if arrow landed within unit's radius
            if (horizontalDistance <= entityRadius + this.HIT_DETECTION_RADIUS) {
                return entityId;
            }
        }

        return null;
    }
    
 

    createGroundExplosion(projectileId, pos, projectile, groundLevel) {

    }

    // Get visual effect color based on element
    getElementalEffectColor(element) {
        if (!this.game.gameManager) return '#ff2200'; // blood-red

        const elementTypes = this.game.gameManager.call('getDamageElementTypes');

        switch (element) {
            case elementTypes.FIRE:
                return '#ffaa00'; // Default orange
            case elementTypes.COLD:
                return '#44aaff'; // Light blue
            case elementTypes.LIGHTNING:
                return '#ffff44'; // Bright yellow
            case elementTypes.POISON:
                return '#44ff44'; // Green
            case elementTypes.DIVINE:
                return '#ffddaa'; // Golden
            case elementTypes.PHYSICAL:
            default:
                return '#ff2200'; // Default orange
        }
    }

    // Get explosion effect type based on element
    getElementalExplosionEffect(element) {
        if (!this.game.gameManager) return 'explosion';

        const elementTypes = this.game.gameManager.call('getDamageElementTypes');

        switch (element) {
            case elementTypes.FIRE:
                return 'fire_explosion';
            case elementTypes.COLD:
                return 'ice_explosion';
            case elementTypes.LIGHTNING:
                return 'lightning_explosion';
            case elementTypes.POISON:
                return 'poison_explosion';
            case elementTypes.DIVINE:
                return 'divine_explosion';
            case elementTypes.PHYSICAL:
            default:
                return 'explosion';
        }
    }
    
    updateProjectileTrail(projectileId, pos) {
        const projectileVisual = this.game.getComponent(projectileId, "projectileVisual");
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
        this.game.gameManager.call('destroyEntityImmediately', projectileId, true);    
        this.game.destroyEntity(projectileId);
        this.cleanupProjectileData(projectileId);
    }
    
    getUnitRadius(unitType) {
        const DEFAULT_UNIT_RADIUS = 15;
        
        if (unitType && unitType.size) {
            return Math.max(DEFAULT_UNIT_RADIUS, unitType.size);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id];
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