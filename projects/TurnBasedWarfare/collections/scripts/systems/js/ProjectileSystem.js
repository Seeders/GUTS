class ProjectileSystem extends GUTS.BaseSystem {
    static services = [
        'deleteProjectileTrail',
        'fireProjectile'
    ];

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

        // Callback storage for onHit and onTravel (functions can't be serialized in components)
        this.projectileCallbacks = new Map();

        // Get gravity from movement system
        this.GRAVITY = this.game.movementSystem?.GRAVITY;

        // Reusable arrays to avoid per-frame allocations
        this._entitiesWithDistance = [];
    }

    // Deterministic rounding helper
    roundForDeterminism(value, precision = 6) {
        return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
    }

    init() {
    }

    deleteProjectileTrail(entityId) {
        if (this.projectileTrails) {
            this.projectileTrails.delete(entityId);
        }
    }

    fireProjectile(sourceId, targetId, projectileData = {}) {
        const log = GUTS.HeadlessLogger;
        const sourceTransform = this.game.getComponent(sourceId, "transform");
        const sourcePos = sourceTransform?.position;
        const sourceCombat = this.game.getComponent(sourceId, "combat");
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        // Get source/target info for logging
        const sourceUnitTypeComp = this.game.getComponent(sourceId, 'unitType');
        const sourceUnitType = this.game.call('getUnitTypeDef', sourceUnitTypeComp);
        const targetUnitTypeComp = this.game.getComponent(targetId, 'unitType');
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        const sourceTeamComp = this.game.getComponent(sourceId, 'team');
        const targetTeamComp = this.game.getComponent(targetId, 'team');
        const reverseEnums = this.game.getReverseEnums();
        const sourceName = sourceUnitType?.id || 'unknown';
        const targetName = targetUnitType?.id || 'unknown';
        const sourceTeamName = reverseEnums.team?.[sourceTeamComp?.team] || sourceTeamComp?.team;
        const targetTeamName = reverseEnums.team?.[targetTeamComp?.team] || targetTeamComp?.team;

        if (!sourcePos || !sourceCombat || !targetPos) {
            log.warn('Projectile', `fireProjectile FAILED - missing data`, {
                sourceId,
                targetId,
                hasSourcePos: !!sourcePos,
                hasSourceCombat: !!sourceCombat,
                hasTargetPos: !!targetPos
            });
            return null;
        }

        // Calculate distance to target
        const dx = targetPos.x - sourcePos.x;
        const dz = targetPos.z - sourcePos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        log.debug('Projectile', `${sourceName}(${sourceId}) [${sourceTeamName}] FIRING at ${targetName}(${targetId}) [${targetTeamName}]`, {
            projectileType: projectileData.id,
            damage: projectileData.damage || sourceCombat.damage,
            speed: projectileData.speed,
            distance: distance.toFixed(0),
            range: sourceCombat.range,
            isBallistic: projectileData.ballistic || false,
            sourcePos: { x: sourcePos.x.toFixed(0), z: sourcePos.z.toFixed(0) },
            targetPos: { x: targetPos.x.toFixed(0), z: targetPos.z.toFixed(0) }
        });

        // OPTIMIZATION: Use auto-incrementing numeric ID for better Map performance
        // In deterministic lockstep, both client and server execute attacks at the same tick,
        // so the counter produces identical IDs on both sides
        const projectileId = this.game.createEntity();
        const components = this.game.call('getComponents');
        
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
            { vx: trajectory.vx, vy: trajectory.vy, vz: trajectory.vz, maxSpeed: projectileData.speed, affectedByGravity: !!projectileData.ballistic, anchored: false });

         // Enhanced projectile component with element
        this.game.addComponent(projectileId, "projectile", {
            damage: projectileData.damage || sourceCombat.damage,
            speed: projectileData.speed,
            range: sourceCombat.range * 1.5,
            target: targetId,
            source: sourceId,
            startTime: this.game.state.now,
            isBallistic: projectileData.ballistic || false,
            launchAngle: trajectory.launchAngle,
            timeToTarget: trajectory.timeToTarget,
            weaponRange: trajectory.weaponRange || sourceCombat.range,
            element: projectileElement,
            splashRadius: projectileData.splashRadius || 80,
            sticksInGround: projectileData.sticksInGround || false,
            stickDuration: projectileData.stickDuration || 3,
            isStuck: false,
            lastTrailTime: this.game.state.now
        });

        // Store callbacks in Map (functions can't be serialized in components)
        if (projectileData.onHit || projectileData.onTravel) {
            this.projectileCallbacks.set(projectileId, {
                onHit: projectileData.onHit || null,
                onTravel: projectileData.onTravel || null
            });
        }

        const sourceTeam = this.game.getComponent(sourceId, "team");
   
        // Add UNIT_TYPE component for projectiles (numeric indices)
        this.game.addComponent(projectileId, "unitType", {
            collection: this.enums.objectTypeDefinitions?.projectiles ?? -1,
            type: this.enums.projectiles?.[projectileData.id] ?? -1
        });

        // Add TEAM component (same team as source)
        if (sourceTeam) {
            this.game.addComponent(projectileId, "team",
                { team: sourceTeam.team });
        }

        // Visual component - use numeric indices
        const objectTypeIndex = this.enums.objectTypeDefinitions?.projectiles ?? -1;
        const spawnTypeIndex = this.enums.projectiles?.[projectileData.id] ?? -1;
        this.game.addComponent(projectileId, "renderable",
            { objectType: objectTypeIndex, spawnType: spawnTypeIndex });
        
        // Use LifetimeSystem instead of direct component
        if (!this.game.isServer) {
            this.game.call('addLifetime', projectileId, this.PROJECTILE_LIFETIME, {
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

        // Debug: verify projectile entity has all required components
        if (!projectileData.ballistic) {
            const hasTransform = this.game.hasComponent(projectileId, "transform");
            const hasVelocity = this.game.hasComponent(projectileId, "velocity");
            const hasProjectile = this.game.hasComponent(projectileId, "projectile");
            log.debug('Projectile', `Created non-ballistic projectile ${projectileId}`, {
                hasTransform,
                hasVelocity,
                hasProjectile,
                isBallistic: projectileData.ballistic
            });
        }

        return projectileId;
    }
    
    cleanupProjectileData(projectileId) {
        // Clean up trail data
        this.projectileTrails.delete(projectileId);
        // Clean up callbacks
        this.projectileCallbacks.delete(projectileId);
    }

    /**
     * Determine the element of a projectile based on various sources
     */
    determineProjectileElement(sourceId, projectileData) {
        // Priority order: projectile damageType > projectile element > combat element > default physical

        // 1. Check projectile data for explicit damageType (string from JSON)
        if (projectileData.damageType) {
            const enumValue = this.enums.element?.[projectileData.damageType];
            if (enumValue !== undefined) {
                return enumValue;
            }
        }

        // 2. Check projectile data for explicit element (may be string or numeric)
        if (projectileData.element !== undefined && projectileData.element !== null) {
            if (typeof projectileData.element === 'string') {
                return this.enums.element?.[projectileData.element] ?? this.enums.element.physical;
            }
            return projectileData.element;
        }

        // 3. Check combat component element (already converted to numeric in UnitCreationSystem)
        const sourceCombat = this.game.getComponent(sourceId, "combat");
        if (sourceCombat && sourceCombat.element !== undefined) {
            return sourceCombat.element;
        }

        // 4. Default to physical
        return this.enums.element.physical;
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
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;

        const log = GUTS.HeadlessLogger;

        // Debug: Check if entity 1588 exists and has components (hardcoded for debugging)
        if (this.game.entityExists(1588)) {
            const hasT = this.game.hasComponent(1588, "transform");
            const hasV = this.game.hasComponent(1588, "velocity");
            const hasP = this.game.hasComponent(1588, "projectile");
            log.trace('Projectile', `Entity 1588 check: exists=true t=${hasT} v=${hasV} p=${hasP}`);
        }

        const projectiles = this.game.getEntitiesWith(
            "transform",
            "velocity",
            "projectile"
        );

        // Debug: log all projectile entities found
        if (projectiles.length > 0) {
            const nonBallistic = projectiles.filter(id => {
                const p = this.game.getComponent(id, "projectile");
                return p && !p.isBallistic;
            });
            if (nonBallistic.length > 0) {
                log.trace('Projectile', `Update found ${nonBallistic.length} non-ballistic projectiles: ${nonBallistic.join(', ')}`);
            }
        }

        // Sort for deterministic processing order (prevents desync)
        // OPTIMIZATION: Numeric IDs allow fast numeric sort instead of localeCompare
        projectiles.sort((a, b) => a - b);
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

            // Debug non-ballistic projectiles
            if (!projectile.isBallistic) {
                log.trace('Projectile', `Non-ballistic update: id=${projectileId} pos=(${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}) vel=(${vel.vx.toFixed(0)}, ${vel.vy.toFixed(0)}, ${vel.vz.toFixed(0)}) target=${projectile.target} exists=${this.game.entityExists(projectileId)}`);
            }

            // Update homing behavior (targetId is null when no target)
            if (homing && homing.targetId != null && projectile.isBallistic) {
                this.updateBallisticHoming(projectileId, pos, vel, projectile, homing);
            } else if (homing && homing.targetId != null) {
                this.updateHomingProjectile(projectileId, pos, vel, projectile, homing);
            }

            // Debug: check components after homing update for non-ballistic
            if (!projectile.isBallistic) {
                const hasT = this.game.hasComponent(projectileId, "transform");
                const hasV = this.game.hasComponent(projectileId, "velocity");
                const hasP = this.game.hasComponent(projectileId, "projectile");
                if (!hasT || !hasV || !hasP) {
                    log.warn('Projectile', `Component lost after homing update! id=${projectileId} t=${hasT} v=${hasV} p=${hasP}`);
                }
            }

            // Call onTravel callback for trail effects (throttled)
            const callbacks = this.projectileCallbacks.get(projectileId);
            if (callbacks?.onTravel && typeof callbacks.onTravel === 'function') {
                const timeSinceLastTrail = this.game.state.now - (projectile.lastTrailTime || 0);
                if (timeSinceLastTrail >= this.TRAIL_UPDATE_INTERVAL) {
                    callbacks.onTravel(pos);
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

                // Debug: check if entity still exists after collision check
                if (!this.game.entityExists(projectileId)) {
                    log.debug('Projectile', `Non-ballistic projectile ${projectileId} was destroyed during collision check`);
                }
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
                // Round to 6 decimal places to avoid floating-point precision desync
                transform.rotation.y = Math.round(Math.atan2(vel.vz, vel.vx) * 1000000) / 1000000;
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
                    // Round to 6 decimal places to avoid floating-point precision desync
                    transform.rotation.y = Math.round(Math.atan2(vel.vz, vel.vx) * 1000000) / 1000000;
                }
            }
        } else {
            // Target is gone - set to null
            homing.targetId = null;
        }
    }
    
    checkProjectileCollisions(projectileId, pos, projectile) {
        const log = GUTS.HeadlessLogger;
        // Skip if already destroyed by another check
        if (!this.game.entityExists(projectileId)) return;

        // Get all potential targets
        const allEntities = this.game.getEntitiesWith(
            "transform",
            "team",
            "health"
        );

        const sourceTeam = this.game.getComponent(projectile.source, "team");
        if (!sourceTeam) return;

        // Calculate distances and sort by closest first for deterministic collision (prevents desync)
        // Reuse array to avoid per-frame allocations
        this._entitiesWithDistance.length = 0;
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

            this._entitiesWithDistance.push({ entityId, entityPos, distance });
        }

        // Debug: log closest enemy distance for non-ballistic projectiles
        if (this._entitiesWithDistance.length > 0 && !projectile.isBallistic) {
            const closest = this._entitiesWithDistance.reduce((a, b) => a.distance < b.distance ? a : b);
            if (closest.distance < 100) {
                log.trace('Projectile', `Collision check: projectile at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}) closest enemy ${closest.entityId} at distance ${closest.distance.toFixed(1)}`);
            }
        }

        // Sort by distance (closest first), then by entity ID for deterministic tie-breaking
        // OPTIMIZATION: Numeric IDs allow fast numeric sort instead of localeCompare
        this._entitiesWithDistance.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) > 0.001) {
                return a.distance - b.distance;
            }
            return a.entityId - b.entityId;
        });

        // Check collision in sorted order - hit closest entity first
        for (const { entityId, entityPos, distance } of this._entitiesWithDistance) {
            // Get entity radius for collision detection
            const entityUnitTypeComp = this.game.getComponent(entityId, "unitType");
            const entityUnitType = this.game.call('getUnitTypeDef', entityUnitTypeComp);
            const entityRadius = this.getUnitRadius(entityUnitType);

            // Check collision for direct hit
            if (distance <= entityRadius + this.HIT_DETECTION_RADIUS) {
                // Check if target has wind shield buff - reflect projectile back
                if (this.checkWindShieldReflection(projectileId, entityId, pos, projectile)) {
                    break; // Projectile was reflected, stop processing
                }

                // Direct hit detected!
                this.handleProjectileHit(projectileId, entityId, entityPos, projectile);
                break; // Stop after first hit
            }
        }
    }

    /**
     * Check if target has wind shield and reflect projectile back to attacker
     * Returns true if projectile was reflected, false otherwise
     */
    checkWindShieldReflection(projectileId, targetId, projectilePos, projectile) {
        // Check if target has wind_shield buff
        const buff = this.game.getComponent(targetId, "buff");
        if (!buff) return false;

        const enums = this.game.getEnums();
        if (buff.buffType !== enums.buffTypes?.wind_shield) return false;

        // Check if buff is still active
        if (buff.endTime && buff.endTime < this.game.state.now) return false;

        // Wind shield active! Reflect the projectile back to attacker
        const sourceId = projectile.source;
        const sourceTransform = this.game.getComponent(sourceId, "transform");
        const sourcePos = sourceTransform?.position;

        if (!sourcePos) {
            // Source is gone, just destroy the projectile
            this.destroyProjectile(projectileId);
            return true;
        }

        // Get current velocity to reverse direction
        const vel = this.game.getComponent(projectileId, "velocity");
        const transform = this.game.getComponent(projectileId, "transform");

        if (!vel || !transform) {
            this.destroyProjectile(projectileId);
            return true;
        }

        // Calculate direction back to attacker
        const dx = sourcePos.x - projectilePos.x;
        const dy = (sourcePos.y + 20) - projectilePos.y; // Aim at center mass
        const dz = sourcePos.z - projectilePos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 1) {
            this.destroyProjectile(projectileId);
            return true;
        }

        // Maintain original speed but reverse direction toward attacker
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy + vel.vz * vel.vz);
        const reflectSpeed = Math.max(speed, projectile.speed || 200);

        vel.vx = this.roundForDeterminism((dx / dist) * reflectSpeed);
        vel.vy = this.roundForDeterminism((dy / dist) * reflectSpeed);
        vel.vz = this.roundForDeterminism((dz / dist) * reflectSpeed);

        // Update rotation to face new direction
        if (transform.rotation) {
            transform.rotation.y = this.roundForDeterminism(Math.atan2(vel.vz, vel.vx));
        }

        // Swap source and target - projectile now belongs to the defender
        const originalSource = projectile.source;
        projectile.source = targetId;
        projectile.target = originalSource;

        // Update team to match new owner
        const targetTeam = this.game.getComponent(targetId, "team");
        const projectileTeamComp = this.game.getComponent(projectileId, "team");
        if (targetTeam && projectileTeamComp) {
            projectileTeamComp.team = targetTeam.team;
        }

        // Update homing if present
        const homing = this.game.getComponent(projectileId, "homingTarget");
        if (homing) {
            homing.targetId = originalSource;
            if (sourcePos) {
                homing.lastKnownPosition = { x: sourcePos.x, y: sourcePos.y, z: sourcePos.z };
            }
        }

        // Visual effect for reflection - wind swirl
        if (!this.game.isServer) {
            const targetTransform = this.game.getComponent(targetId, "transform");
            const shieldPos = targetTransform?.position;
            if (shieldPos) {
                this.game.call('createLayeredEffect', {
                    position: new THREE.Vector3(shieldPos.x, shieldPos.y + 25, shieldPos.z),
                    layers: [
                        // Wind deflection burst
                        {
                            count: 12,
                            lifetime: 0.5,
                            color: 0xE0FFFF,
                            colorRange: { start: 0xE0FFFF, end: 0x87CEEB },
                            scale: 8,
                            scaleMultiplier: 1.2,
                            velocityRange: { x: [-50, 50], y: [30, 80], z: [-50, 50] },
                            gravity: -30,
                            drag: 0.92,
                            blending: 'additive',
                            emitterShape: 'ring',
                            emitterRadius: 15
                        },
                        // Sparkle effect
                        {
                            count: 6,
                            lifetime: 0.3,
                            color: 0xFFFFFF,
                            scale: 5,
                            scaleMultiplier: 0.8,
                            velocityRange: { x: [-30, 30], y: [50, 100], z: [-30, 30] },
                            gravity: -50,
                            drag: 0.88,
                            blending: 'additive'
                        }
                    ]
                });
            }
        }

        return true;
    }
    
    handleProjectileGroundImpact(entityId, pos, projectile) {
        // Only for ballistic projectiles
        if (!projectile.isBallistic) return;
        
        // Get actual terrain height for projectile impact
        const terrainHeight = this.game.call('getTerrainHeightAtPosition', pos.x, pos.z);
        const actualGroundLevel = terrainHeight !== null ? terrainHeight : this.game.movementSystem?.GROUND_LEVEL || 0;
        
        // Check if projectile hit the ground
        if (pos.y <= actualGroundLevel + this.GROUND_IMPACT_THRESHOLD) {
            // Ballistic projectiles explode on ground impact
            this.triggerBallisticExplosion(entityId, pos, projectile, actualGroundLevel);
            return;
        }
    }

    handleProjectileHit(projectileId, targetId, _targetPos, projectile) {
        const log = GUTS.HeadlessLogger;
        const damage = projectile.damage;
        // projectile.element is already a numeric enum value
        const element = projectile.element !== undefined ? projectile.element : this.enums.element.physical;

        // Get source/target info for logging
        const sourceUnitTypeComp = this.game.getComponent(projectile.source, 'unitType');
        const sourceUnitType = this.game.call('getUnitTypeDef', sourceUnitTypeComp);
        const targetUnitTypeComp = this.game.getComponent(targetId, 'unitType');
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        const targetHealth = this.game.getComponent(targetId, 'health');
        const reverseEnums = this.game.getReverseEnums();
        const sourceName = sourceUnitType?.id || 'unknown';
        const targetName = targetUnitType?.id || 'unknown';

        log.info('Projectile', `HIT! ${sourceName}(${projectile.source}) -> ${targetName}(${targetId})`, {
            damage,
            element: reverseEnums.element?.[element] || element,
            targetHealthBefore: targetHealth ? `${targetHealth.current}/${targetHealth.max}` : 'unknown'
        });

        // Apply damage on both client and server for sync
        this.game.call('applyDamage', projectile.source, targetId, damage, element, {
            isProjectile: true,
            projectileId: projectileId
        });

        this.destroyProjectile(projectileId);
    }

    triggerBallisticExplosion(entityId, pos, projectile, groundLevel) {
        // Call custom onHit callback if provided (stored in Map, not component)
        const callbacks = this.projectileCallbacks.get(entityId);
        if (callbacks?.onHit && typeof callbacks.onHit === 'function') {
            callbacks.onHit(pos);
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

        const splashRadius = projectile.splashRadius || 80;
        const splashDamage = Math.floor(projectile.damage);
        // projectile.element is already a numeric enum value
        const element = projectile.element !== undefined ? projectile.element : this.enums.element.physical;

        // Apply splash damage on both client and server for sync
        this.game.call('applySplashDamage',
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
        const nearbyEntityIds = this.game.call('getNearbyUnits', pos, searchRadius, projectile.source);

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
            const entityUnitTypeComp = this.game.getComponent(entityId, 'unitType');
            const entityUnitType = this.game.call('getUnitTypeDef', entityUnitTypeComp);
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
        if (this.game.isServer) return '#ff2200'; // blood-red

 
        switch (element) {
            case this.enums.element.fire:
                return '#ffaa00'; // Default orange
            case this.enums.element.cold:
                return '#44aaff'; // Light blue
            case this.enums.element.lightning:
                return '#ffff44'; // Bright yellow
            case this.enums.element.poison:
                return '#44ff44'; // Green
            case this.enums.element.holy:
                return '#ffddaa'; // Golden
            case this.enums.element.physical:
            default:
                return '#ff2200'; // Default orange
        }
    }

    // Get explosion effect type based on element
    getElementalExplosionEffect(element) {
        if (this.game.isServer) return 'explosion';

  
        switch (element) {
            case this.enums.element.fire:
                return 'fire_explosion';
            case this.enums.element.cold:
                return 'ice_explosion';
            case this.enums.element.lightning:
                return 'lightning_explosion';
            case this.enums.element.poison:
                return 'poison_explosion';
            case this.enums.element.holy:
                return 'holy_explosion';
            case this.enums.element.physical:
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
        this.game.call('destroyEntityImmediately', projectileId, true);    
        this.game.destroyEntity(projectileId);
        this.cleanupProjectileData(projectileId);
    }
    
    getUnitRadius(unitType) {
        const DEFAULT_UNIT_RADIUS = 15;

        if (unitType && unitType.size) {
            return Math.max(DEFAULT_UNIT_RADIUS, unitType.size);
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

    onSceneUnload() {
        // Clear all projectile trails
        this.projectileTrails.clear();

        // Clear all projectile callbacks
        this.projectileCallbacks.clear();

        // Clear active projectiles if tracked
        if (this.activeProjectiles) {
            this.activeProjectiles.clear();
        }
    }
}
