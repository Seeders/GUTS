class MovementSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.movementSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 25;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        // AI movement configuration
        this.AI_SPEED_MULTIPLIER = 0.1;
        this.DEFAULT_AI_SPEED = 50;
        this.POSITION_UPDATE_MULTIPLIER = 1;
        this.DEFAULT_TERRAIN_SIZE = 768 * 2;
        
        // Physics configuration
        this.GRAVITY = 200;
        this.GROUND_LEVEL = 0;
        this.GROUND_IMPACT_THRESHOLD = 5;
        this.TERRAIN_FOLLOW_SPEED = 8;
        
        // Unit separation configuration
        this.SEPARATION_FORCE = 80; // Reduced from 100
        this.SEPARATION_RADIUS_MULTIPLIER = 2.5;
        this.MAX_SEPARATION_CHECKS = 8;
        this.AVOIDANCE_SMOOTHING = 0.15; // Increased from 1 for much smoother transitions
        
        // Pathfinding configuration (optimized)
        this.PATHFINDING_LOOKAHEAD = 100;
        this.OBSTACLE_AVOIDANCE_FORCE = 120; // Reduced from 150
        this.AVOIDANCE_ANGLE = Math.PI / 3;
        this.STUCK_THRESHOLD = 5;
        this.STUCK_TIME_LIMIT = 2000;
        this.REPATH_DISTANCE = 50;
        
        // Performance optimizations
        this.SPATIAL_GRID_SIZE = 80;
        this.MAX_PATHFINDING_CHECKS = 6;
        this.PATHFINDING_CHECK_POINTS = 3;
        this.PATHFINDING_UPDATE_INTERVAL = 3;
        this.NEAR_UNIT_RADIUS = 150;
        
        // Movement smoothing configuration
        this.VELOCITY_SMOOTHING = 0.12; // How quickly velocity changes
        this.DIRECTION_SMOOTHING = 0.08; // How quickly direction changes
        this.FORCE_DAMPING = 0.85; // Dampen forces over time
        this.MIN_DIRECTION_CHANGE = 0.1; // Minimum angle change to apply
        this.OSCILLATION_DETECTION_FRAMES = 5; // Frames to track for oscillation
        this.OSCILLATION_THRESHOLD = Math.PI / 6; // 30 degrees
        
        // Track unit states and spatial optimization
        this.unitStates = new Map();
        this.spatialGrid = new Map();
        this.frameCounter = 0;
        this.pathfindingQueue = [];
        this.pathfindingQueueIndex = 0;
        
        // Movement history for smoothing
        this.movementHistory = new Map();
    }
    
    update() {
        if (this.game.state.phase !== 'battle') return;
        
        this.frameCounter++;
        // Entities are already sorted by game.getEntitiesWith()
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.VELOCITY);
        
        // Build spatial grid for fast neighbor lookups
        this.buildSpatialGrid(entities);
        
        // First pass: calculate desired velocities and separation forces
        const unitData = new Map();
        
        // No need to sort again - entities are already sorted from getEntitiesWith()
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            const projectile = this.game.getComponent(entityId, this.componentTypes.PROJECTILE);
            
            // Store unit data for calculations
            if (!projectile) {
                const unitRadius = this.getUnitRadius(collision);

                const isAnchored =
                    !!aiState &&
                    (aiState.state === 'attacking' || aiState.state === 'waiting') &&
                    aiState.aiBehavior &&
                    !!aiState.aiBehavior.currentTarget;

                unitData.set(entityId, {
                    pos, vel, unitType, collision, aiState, projectile,
                    unitRadius,
                    isAnchored,
                    desiredVelocity: { vx: 0, vy: 0, vz: 0 },
                    separationForce: { x: 0, y: 0, z: 0 },
                    avoidanceForce: { x: 0, y: 0, z: 0 }
                });
                
                this.updateUnitState(entityId, pos, vel);
                this.updateMovementHistory(entityId, vel);
            }
        });
        
        // unitData.keys() preserves insertion order, which is already sorted since entities were sorted
        const sortedEntityIds = Array.from(unitData.keys());

        // Calculate desired velocities for all units
        sortedEntityIds.forEach((entityId) => {
            this.calculateDesiredVelocity(entityId, unitData.get(entityId));
        });
        
        // Calculate separation forces (with spatial optimization)
        sortedEntityIds.forEach((entityId) => {
            this.calculateSeparationForceOptimized(entityId, unitData.get(entityId));
        });
        
        // Staggered pathfinding updates - only update subset each frame
        this.updatePathfindingStaggered(unitData);
        
        // Apply movement to all entities - entities already sorted
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
            const projectile = this.game.getComponent(entityId, this.componentTypes.PROJECTILE);
            
            const isAffectedByGravity = vel.affectedByGravity;
            
            if (!projectile && unitData.has(entityId)) {
                this.applyUnitMovementWithSmoothing(entityId, unitData.get(entityId));
            }
            
            if (isAffectedByGravity) {
                vel.vy -= this.GRAVITY * this.game.state.deltaTime;
            }
            
            // Update position
            pos.x += vel.vx * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.y += vel.vy * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.z += vel.vz * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
        
            if(!projectile){
                this.handleGroundInteraction(pos, vel);
                this.enforceBoundaries(pos, collision);
            }
        });
    }
    
    // Track movement history for oscillation detection
    updateMovementHistory(entityId, vel) {
        if (!this.movementHistory.has(entityId)) {
            this.movementHistory.set(entityId, {
                velocityHistory: [],
                smoothedDirection: { x: 0, z: 0 },
                dampedForces: { separation: { x: 0, z: 0 }, avoidance: { x: 0, z: 0 } }
            });
        }
        
        const history = this.movementHistory.get(entityId);
        
        // Store velocity history
        history.velocityHistory.push({ 
            vx: vel.vx, 
            vz: vel.vz, 
            frame: this.frameCounter 
        });
        
        // Keep only recent history
        if (history.velocityHistory.length > this.OSCILLATION_DETECTION_FRAMES) {
            history.velocityHistory.shift();
        }
    }
    
    // Detect if unit is oscillating
    isUnitOscillating(entityId) {
        const history = this.movementHistory.get(entityId);
        if (!history || history.velocityHistory.length < this.OSCILLATION_DETECTION_FRAMES) {
            return false;
        }
        
        let directionChanges = 0;
        let lastDirection = null;
        
        for (const vel of history.velocityHistory) {
            const speed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
            if (speed < 0.1) continue;
            
            const direction = Math.atan2(vel.vz, vel.vx);
            if (lastDirection !== null) {
                let angleDiff = Math.abs(direction - lastDirection);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                
                if (angleDiff > this.OSCILLATION_THRESHOLD) {
                    directionChanges++;
                }
            }
            lastDirection = direction;
        }
        
        return directionChanges >= 2; // Multiple direction changes indicate oscillation
    }
    
    // Build spatial grid for fast neighbor lookups (deterministic)
    buildSpatialGrid(entities) {
        this.spatialGrid.clear();
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const projectile = this.game.getComponent(entityId, this.componentTypes.PROJECTILE);
            
            if (!projectile && pos) {
                const gridX = Math.floor(Math.round(pos.x * 1000) / 1000 / this.SPATIAL_GRID_SIZE);
                const gridZ = Math.floor(Math.round(pos.z * 1000) / 1000 / this.SPATIAL_GRID_SIZE);
                const gridKey = `${gridX},${gridZ}`;
                
                if (!this.spatialGrid.has(gridKey)) {
                    this.spatialGrid.set(gridKey, []);
                }
                this.spatialGrid.get(gridKey).push(entityId);
            }
        });
        
        // Sort each grid cell for deterministic neighbor lookups
        for (const [gridKey, entityList] of this.spatialGrid.entries()) {
            entityList.sort((a, b) => String(a).localeCompare(String(b)));
        }
    }
    
    // Get nearby units using spatial grid (deterministic)
    getNearbyUnits(pos, radius) {
        const nearbyUnits = [];
        const gridRadius = Math.ceil(Math.round(radius * 1000) / 1000 / this.SPATIAL_GRID_SIZE);
        const centerGridX = Math.floor(Math.round(pos.x * 1000) / 1000 / this.SPATIAL_GRID_SIZE);
        const centerGridZ = Math.floor(Math.round(pos.z * 1000) / 1000 / this.SPATIAL_GRID_SIZE);
        
        // Process grid cells in deterministic order
        const gridCells = [];
        for (let gridX = centerGridX - gridRadius; gridX <= centerGridX + gridRadius; gridX++) {
            for (let gridZ = centerGridZ - gridRadius; gridZ <= centerGridZ + gridRadius; gridZ++) {
                gridCells.push(`${gridX},${gridZ}`);
            }
        }
        
        // Sort grid keys for deterministic processing
        gridCells.sort();
        
        for (const gridKey of gridCells) {
            const cellUnits = this.spatialGrid.get(gridKey);
            if (cellUnits) {
                nearbyUnits.push(...cellUnits);
            }
        }
        
        return nearbyUnits.sort((a, b) => String(a).localeCompare(String(b)));
    }
    
    // Staggered pathfinding updates (deterministic)
    updatePathfindingStaggered(unitData) {
        // Build queue of units that need pathfinding on first frame (deterministic)
        if (this.pathfindingQueue.length === 0) {
            const sortedEntityIds = Array.from(unitData.keys()).sort((a, b) => String(a).localeCompare(String(b)));
            sortedEntityIds.forEach(entityId => {
                const data = unitData.get(entityId);
                if (data.aiState?.state === 'chasing') {
                    this.pathfindingQueue.push(entityId);
                }
            });
        }
        
        // Update pathfinding for a subset of units each frame
        const unitsPerFrame = Math.max(1, Math.ceil(this.pathfindingQueue.length / this.PATHFINDING_UPDATE_INTERVAL));
        
        for (let i = 0; i < unitsPerFrame && this.pathfindingQueueIndex < this.pathfindingQueue.length; i++) {
            const entityId = this.pathfindingQueue[this.pathfindingQueueIndex];
            if (unitData.has(entityId)) {
                this.calculatePathfindingAvoidanceOptimized(entityId, unitData.get(entityId), unitData);
            }
            this.pathfindingQueueIndex++;
        }
        
        // Reset queue when we've processed all units
        if (this.pathfindingQueueIndex >= this.pathfindingQueue.length) {
            this.pathfindingQueueIndex = 0;
            this.pathfindingQueue = [];
        }
    }
    
    updateUnitState(entityId, pos, vel) {
        const currentTime = this.game.currentTime;
        
        if (!this.unitStates.has(entityId)) {
            this.unitStates.set(entityId, {
                lastPosition: { x: pos.x, z: pos.z },
                lastMovementTime: currentTime,
                stuckTime: 0,
                lastPathTime: 0,
                avoidanceDirection: 0
            });
            return;
        }
        
        const state = this.unitStates.get(entityId);
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
        const distanceMoved = Math.sqrt(
            Math.pow(pos.x - state.lastPosition.x, 2) + 
            Math.pow(pos.z - state.lastPosition.z, 2)
        );
        
        if (speed < this.STUCK_THRESHOLD && distanceMoved < 1) {
            state.stuckTime += this.game.state.deltaTime;
        } else {
            state.stuckTime = 0;
            state.lastPosition.x = pos.x;
            state.lastPosition.z = pos.z;
        }
        
        if (distanceMoved > this.REPATH_DISTANCE) {
            state.avoidanceDirection = 0;
            state.lastPathTime = currentTime;
        }
    }
    
    // Use spatial grid for separation with damping
    calculateSeparationForceOptimized(entityId, data) {
        const { pos, unitRadius, isAnchored } = data;

        if (isAnchored) {
            data.separationForce.x = 0;
            data.separationForce.y = 0;
            data.separationForce.z = 0;
            return;
        }
        
        const separationRadius = unitRadius * this.SEPARATION_RADIUS_MULTIPLIER;
        const nearbyUnits = this.getNearbyUnits(pos, separationRadius);
        
        let separationForceX = 0;
        let separationForceZ = 0;
        let neighborCount = 0;
        let checksPerformed = 0;
        
        for (const otherEntityId of nearbyUnits) {
            if (entityId === otherEntityId) continue;
            if (checksPerformed >= this.MAX_SEPARATION_CHECKS) break;
            
            checksPerformed++;
            
            const otherPos = this.game.getComponent(otherEntityId, this.componentTypes.POSITION);
            const otherCollision = this.game.getComponent(otherEntityId, this.componentTypes.COLLISION);
            
            if (!otherPos) continue;
            
            const otherRadius = this.getUnitRadius(otherCollision);
            
            const dx = pos.x - otherPos.x;
            const dz = pos.z - otherPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            const minDistance = unitRadius + otherRadius;
            const influenceDistance = Math.max(minDistance, separationRadius);
            
            if (distance < influenceDistance && distance > 0.1) {
                const force = this.SEPARATION_FORCE * (influenceDistance - distance) / influenceDistance;
                
                const dirX = dx / distance;
                const dirZ = dz / distance;
                
                separationForceX += dirX * force;
                separationForceZ += dirZ * force;
                neighborCount++;
            }
        }
        
        if (neighborCount > 0) {
            // Apply damping to previous forces
            const history = this.movementHistory.get(entityId);
            if (history) {
                const dampedSeparation = history.dampedForces.separation;
                dampedSeparation.x *= this.FORCE_DAMPING;
                dampedSeparation.z *= this.FORCE_DAMPING;
                
                // Blend new forces with damped old forces
                separationForceX = (separationForceX / neighborCount) * 0.7 + dampedSeparation.x * 0.3;
                separationForceZ = (separationForceZ / neighborCount) * 0.7 + dampedSeparation.z * 0.3;
                
                dampedSeparation.x = separationForceX;
                dampedSeparation.z = separationForceZ;
            } else {
                separationForceX /= neighborCount;
                separationForceZ /= neighborCount;
            }
            
            data.separationForce.x = separationForceX;
            data.separationForce.z = separationForceZ;
        } else {
            data.separationForce.x = 0;
            data.separationForce.z = 0;
        }
        data.separationForce.y = 0;
    }
    
    // Faster pathfinding with limited checks and damping
    calculatePathfindingAvoidanceOptimized(entityId, data, allUnitData) {
        const { pos, vel, aiState, unitRadius, isAnchored } = data;
        
        if (isAnchored) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }
        
        if (!aiState || aiState.state !== 'chasing' || !aiState.aiBehavior?.targetPosition) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }
        
        const targetPos = aiState.aiBehavior.targetPosition;
        const targetEntityId = aiState.aiBehavior?.currentTarget;
        
        const desiredDirection = {
            x: targetPos.x - pos.x,
            z: targetPos.z - pos.z
        };
        
        const desiredDistance = Math.sqrt(desiredDirection.x * desiredDirection.x + desiredDirection.z * desiredDirection.z);
        
        if (desiredDistance < 0.1) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }
        
        desiredDirection.x /= desiredDistance;
        desiredDirection.z /= desiredDistance;
        
        // Use spatial grid for faster obstacle detection
        const obstacleInfo = this.findObstaclesInPathOptimized(pos, desiredDirection, unitRadius, entityId, targetEntityId);
        
        if (obstacleInfo.hasObstacle) {
            const unitState = this.unitStates.get(entityId);
            const avoidanceForce = this.calculateAvoidanceVector(
                pos, desiredDirection, obstacleInfo, unitState, unitRadius
            );
            
            // Apply damping to avoidance forces
            const history = this.movementHistory.get(entityId);
            if (history) {
                const dampedAvoidance = history.dampedForces.avoidance;
                dampedAvoidance.x *= this.FORCE_DAMPING;
                dampedAvoidance.z *= this.FORCE_DAMPING;
                
                // Blend new forces with damped old forces
                const blendedX = avoidanceForce.x * 0.6 + dampedAvoidance.x * 0.4;
                const blendedZ = avoidanceForce.z * 0.6 + dampedAvoidance.z * 0.4;
                
                dampedAvoidance.x = blendedX;
                dampedAvoidance.z = blendedZ;
                
                data.avoidanceForce.x = blendedX;
                data.avoidanceForce.z = blendedZ;
            } else {
                data.avoidanceForce.x = avoidanceForce.x;
                data.avoidanceForce.z = avoidanceForce.z;
            }
        } else {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
        }
    }
    
    // Use spatial grid for pathfinding
    findObstaclesInPathOptimized(pos, direction, unitRadius, entityId, targetEntityId = null) {
        const lookaheadDistance = this.PATHFINDING_LOOKAHEAD;
        const checkRadius = unitRadius * 1.5;
        
        // Get units within lookahead range using spatial grid
        const nearbyUnits = this.getNearbyUnits(pos, lookaheadDistance + checkRadius);
        
        let closestObstacle = null;
        let closestDistance = Infinity;
        let checksPerformed = 0;
        
        // Reduced check points for better performance
        for (let i = 1; i <= this.PATHFINDING_CHECK_POINTS; i++) {
            const checkDistance = (lookaheadDistance / this.PATHFINDING_CHECK_POINTS) * i;
            const checkPos = {
                x: pos.x + direction.x * checkDistance,
                z: pos.z + direction.z * checkDistance
            };
            
            for (const otherEntityId of nearbyUnits) {
                if (entityId === otherEntityId) continue;
                if (targetEntityId && otherEntityId === targetEntityId) continue;
                if (checksPerformed >= this.MAX_PATHFINDING_CHECKS) break;
                
                checksPerformed++;
                
                const otherPos = this.game.getComponent(otherEntityId, this.componentTypes.POSITION);
                const otherCollision = this.game.getComponent(otherEntityId, this.componentTypes.COLLISION);
                
                if (!otherPos) continue;
                
                const otherRadius = this.getUnitRadius(otherCollision);
                
                const dx = checkPos.x - otherPos.x;
                const dz = checkPos.z - otherPos.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                const minDistance = checkRadius + otherRadius;
                
                if (distance < minDistance && distance < closestDistance) {
                    closestDistance = distance;
                    closestObstacle = {
                        pos: otherPos,
                        radius: otherRadius,
                        distance: distance,
                        entityId: otherEntityId
                    };
                }
            }
            
            if (checksPerformed >= this.MAX_PATHFINDING_CHECKS) break;
        }
        
        return {
            hasObstacle: closestObstacle !== null,
            obstacle: closestObstacle
        };
    }
    
    calculateAvoidanceVector(pos, desiredDirection, obstacleInfo, unitState, unitRadius) {
        if (!obstacleInfo.hasObstacle) {
            return { x: 0, z: 0 };
        }
        
        const obstacle = obstacleInfo.obstacle;
        const toObstacle = {
            x: obstacle.pos.x - pos.x,
            z: obstacle.pos.z - pos.z
        };
        
        const obstacleDistance = Math.sqrt(toObstacle.x * toObstacle.x + toObstacle.z * toObstacle.z);
        
        if (obstacleDistance < 0.1) {
            return { x: 0, z: 0 };
        }
        
        toObstacle.x /= obstacleDistance;
        toObstacle.z /= obstacleDistance;
        
        let avoidanceDirection = unitState?.avoidanceDirection || 0;
        
        if (avoidanceDirection === 0) {
            const perpLeft = { x: -toObstacle.z, z: toObstacle.x };
            const perpRight = { x: toObstacle.z, z: -toObstacle.x };
            
            const leftAlignment = perpLeft.x * desiredDirection.x + perpLeft.z * desiredDirection.z;
            const rightAlignment = perpRight.x * desiredDirection.x + perpRight.z * desiredDirection.z;
            
            avoidanceDirection = leftAlignment > rightAlignment ? 1 : -1;
            
            if (unitState) {
                unitState.avoidanceDirection = avoidanceDirection;
            }
        }
        
        const avoidanceVector = {
            x: -toObstacle.z * avoidanceDirection,
            z: toObstacle.x * avoidanceDirection
        };
        
        const minDistance = unitRadius + obstacle.radius + 10;
        const avoidanceStrength = Math.max(0, (minDistance - obstacleDistance) / minDistance);
        const force = this.OBSTACLE_AVOIDANCE_FORCE * avoidanceStrength;
        
        return {
            x: avoidanceVector.x * force,
            z: avoidanceVector.z * force
        };
    }
    
    calculateDesiredVelocity(entityId, data) {
        const { pos, vel, aiState, isAnchored } = data;

        if (isAnchored) {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vy = 0;
            data.desiredVelocity.vz = 0;
            return;
        }
        
        // Don't move if waiting for cooldowns
        if (aiState && aiState.state === 'waiting') {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vy = 0;
            data.desiredVelocity.vz = 0;
            return;
        }
        
        if (aiState && aiState.state === 'chasing' && aiState.aiBehavior && aiState.aiBehavior.targetPosition) {
            const targetPos = aiState.aiBehavior.targetPosition;
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            
            const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
            
            if (horizontalDistance > 0) {
                const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
                data.desiredVelocity.vx = (dx / horizontalDistance) * moveSpeed;
                data.desiredVelocity.vz = (dz / horizontalDistance) * moveSpeed;
                data.desiredVelocity.vy = 0;
            }
        } else if (aiState && aiState.state === 'attacking') {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vy = 0;
            data.desiredVelocity.vz = 0;
        } else {
            data.desiredVelocity.vx = vel.vx;
            data.desiredVelocity.vy = vel.vy;
            data.desiredVelocity.vz = vel.vz;
        }
    }
    
    // Enhanced movement application with multiple smoothing techniques
    applyUnitMovementWithSmoothing(entityId, data) {
        const { vel, desiredVelocity, separationForce, avoidanceForce, isAnchored } = data;

        if (isAnchored) {
            vel.vx = 0;
            vel.vz = 0;
            vel.vy = desiredVelocity.vy || vel.vy || 0;
            return;
        }
        
        const history = this.movementHistory.get(entityId);
        const isOscillating = this.isUnitOscillating(entityId);
        
        // Calculate target velocity
        let targetVx = desiredVelocity.vx + separationForce.x + avoidanceForce.x;
        let targetVz = desiredVelocity.vz + separationForce.z + avoidanceForce.z;
        
        // If oscillating, prioritize the desired velocity and reduce other forces
        if (isOscillating) {
            targetVx = desiredVelocity.vx + (separationForce.x + avoidanceForce.x) * 0.3;
            targetVz = desiredVelocity.vz + (separationForce.z + avoidanceForce.z) * 0.3;
        }
        
        // Apply different smoothing based on oscillation state
        const velocitySmoothing = isOscillating ? this.VELOCITY_SMOOTHING * 0.5 : this.VELOCITY_SMOOTHING;
        const directionSmoothing = isOscillating ? this.DIRECTION_SMOOTHING * 0.3 : this.DIRECTION_SMOOTHING;
        
        // Smooth velocity changes
        const newVx = this.lerp(vel.vx, targetVx, velocitySmoothing);
        const newVz = this.lerp(vel.vz, targetVz, velocitySmoothing);
        
        // Apply direction smoothing for more gradual turns
        if (history && history.smoothedDirection) {
            const targetDirection = Math.atan2(targetVz, targetVx);
            
            // Get current direction from FACING component if velocity is negligible
            let currentDirection;
            const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
            
            if (currentSpeed < this.MIN_MOVEMENT_THRESHOLD) {
                // Use facing component for direction when not moving
                const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
                currentDirection = facing ? facing.angle : 0;
            } else {
                // Use velocity direction when moving
                currentDirection = Math.atan2(vel.vz, vel.vx);
            }
            
            let directionDiff = targetDirection - currentDirection;
            if (directionDiff > Math.PI) directionDiff -= 2 * Math.PI;
            if (directionDiff < -Math.PI) directionDiff += 2 * Math.PI;
            
            // Only apply direction change if it's significant enough
            if (Math.abs(directionDiff) > this.MIN_DIRECTION_CHANGE) {
                const smoothedDirection = currentDirection + directionDiff * directionSmoothing;
                const speed = Math.sqrt(newVx * newVx + newVz * newVz);
                
                if (speed > 0.1) {
                    vel.vx = Math.cos(smoothedDirection) * speed;
                    vel.vz = Math.sin(smoothedDirection) * speed;
                    
                    // Update the facing component to match the new direction
                    const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
                    if (facing) {
                        facing.angle = smoothedDirection;
                    }
                } else {
                    vel.vx = newVx;
                    vel.vz = newVz;
                }
            } else {
                vel.vx = newVx;
                vel.vz = newVz;
            }
        } else {
            vel.vx = newVx;
            vel.vz = newVz;
        }
        
        vel.vy = desiredVelocity.vy;
        
        // Apply minimum movement threshold
        const speedSqrd = vel.vx * vel.vx + vel.vz * vel.vz;
        if (speedSqrd < this.MIN_MOVEMENT_THRESHOLD * this.MIN_MOVEMENT_THRESHOLD) {
            vel.vx = 0;
            vel.vz = 0;
        }
        
        // Enforce max speed
        const maxSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED) * 1.4;
        const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
        if (currentSpeed > maxSpeed) {
            const speedRatio = maxSpeed / currentSpeed;
            vel.vx *= speedRatio;
            vel.vz *= speedRatio;
        }
    }
    
    lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    shouldApplyGravity(entityId, projectile, unitType) {
        if (projectile) {
            return true;
        }
        
        if (unitType && unitType.type) {
            const collections = this.game.getCollections && this.game.getCollections();
            if (collections && collections.units) {
                const unitDef = collections.units[unitType.id || unitType.type];
                if (unitDef && unitDef.flying) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    handleGroundInteraction(pos, vel) {
        const terrainHeight = this.getTerrainHeightAtPosition(pos.x, pos.z);
        
        if (terrainHeight !== null) {
            const targetHeight = terrainHeight;   
            pos.y = targetHeight;
            
            if (pos.y <= targetHeight + 0.1) {
                vel.vy = Math.max(0, vel.vy);
            }
        } else {
            if (pos.y < this.GROUND_LEVEL) {
                pos.y = this.GROUND_LEVEL;
                vel.vy = Math.max(0, vel.vy);
            }
        }
    }
    
    getTerrainHeightAtPosition(worldX, worldZ) {
        if (this.game.worldSystem && this.game.worldSystem.getTerrainHeightAtPosition) {
            return this.game.worldSystem.getTerrainHeightAtPosition(worldX, worldZ);
        }
        return this.GROUND_LEVEL;
    }
    
    enforceBoundaries(pos, collision) {
        const terrainSize = this.game.worldSystem?.terrainSize || this.DEFAULT_TERRAIN_SIZE;
        const halfTerrain = terrainSize / 2;
        const unitRadius = this.getUnitRadius(collision);
        
        pos.x = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.x));
        pos.z = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.z));
    }
    
    getUnitRadius(collision) {
        if (collision && collision.radius) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius);
        }
        return this.DEFAULT_UNIT_RADIUS;
    }
}