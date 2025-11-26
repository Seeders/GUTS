class MovementSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.movementSystem = this;
        
        this.DEFAULT_UNIT_RADIUS = 25;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        this.AI_SPEED_MULTIPLIER = 0.1;
        this.DEFAULT_AI_SPEED = 50;
        this.POSITION_UPDATE_MULTIPLIER = 1;
        this.DEFAULT_TERRAIN_SIZE = 768 * 2;
        
        this.GRAVITY = 200;
        this.GROUND_LEVEL = 0;
        this.GROUND_IMPACT_THRESHOLD = 5;
        this.TERRAIN_FOLLOW_SPEED = 8;
        
        this.SEPARATION_FORCE = 80;
        this.SEPARATION_RADIUS_MULTIPLIER = 0.1;
        this.MAX_SEPARATION_CHECKS = 8;
        this.AVOIDANCE_SMOOTHING = 0.15;
        
        this.PATHFINDING_LOOKAHEAD = 100;
        this.OBSTACLE_AVOIDANCE_FORCE = 70;
        this.AVOIDANCE_ANGLE = Math.PI / 3;
        this.STUCK_THRESHOLD = 5;
        this.STUCK_TIME_LIMIT = 2000;
        this.REPATH_DISTANCE = 50;
        
        this.PATH_REACHED_DISTANCE = 3;
        this.PATH_REREQUEST_INTERVAL = 0.5;
        
        this.SPATIAL_GRID_SIZE = 80;
        this.MAX_PATHFINDING_CHECKS = 6;
        this.PATHFINDING_CHECK_POINTS = 3;
        this.PATHFINDING_UPDATE_INTERVAL = 3;
        this.NEAR_UNIT_RADIUS = 150;
        
        this.VELOCITY_SMOOTHING = 0.9;
        this.DIRECTION_SMOOTHING = 0.9;
        this.FORCE_DAMPING = 0.85;
        this.MIN_DIRECTION_CHANGE = 0.1;
        this.OSCILLATION_DETECTION_FRAMES = 5;
        this.OSCILLATION_THRESHOLD = Math.PI / 6;
        
        this.unitStates = new Map();
        this.frameCounter = 0;
        this.pathfindingQueue = [];
        this.pathfindingQueueIndex = 0;
        
        this.movementHistory = new Map();
    }
    
    update() {
        if (this.game.state.phase !== 'battle') return;
        
        this.frameCounter++;
        const entities = this.game.getEntitiesWith("position", "velocity");
        // Sort for deterministic processing order (prevents desync)
        entities.sort((a, b) => String(a).localeCompare(String(b)));

        const unitData = new Map();

        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, "position");
            const vel = this.game.getComponent(entityId, "velocity");
            const unitType = this.game.getComponent(entityId, "unitType");
            const collision = this.game.getComponent(entityId, "collision");
            const aiState = this.game.getComponent(entityId, "aiState");
            const projectile = this.game.getComponent(entityId, "projectile");
            
            if (!projectile) {
                const unitRadius = this.getUnitRadius(collision);

                // Unit is anchored if explicitly set, or if attacking and in range of target
                const isAnchored = vel.anchored ||
                    (!!aiState &&
                    (aiState.currentAction === 'AttackBehaviorAction' || aiState.currentAction === 'CombatBehaviorAction') &&
                    !!aiState.meta.target &&
                    this.isInAttackRange(pos, aiState.meta.target, entityId));

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
        
        const sortedEntityIds = Array.from(unitData.keys());

        sortedEntityIds.forEach((entityId) => {
            this.calculateDesiredVelocity(entityId, unitData.get(entityId));
        });
        
        sortedEntityIds.forEach((entityId) => {
            this.calculateSeparationForceOptimized(entityId, unitData.get(entityId));
        });
        
        this.updatePathfindingStaggered(unitData);
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, "position");
            const vel = this.game.getComponent(entityId, "velocity");
            const collision = this.game.getComponent(entityId, "collision");
            const projectile = this.game.getComponent(entityId, "projectile");
            const unitType = this.game.getComponent(entityId, "unitType");
            
            const isAffectedByGravity = vel.affectedByGravity;
            
            if (!projectile && unitData.has(entityId)) {
                let entityData = unitData.get(entityId);
                if(vel.vx != 0 || vel.vz != 0 || entityData.desiredVelocity.vx != 0 || entityData.desiredVelocity.vz != 0){
                    this.applyUnitMovementWithSmoothing(entityId, unitData.get(entityId));
                }
            }
            
            if (isAffectedByGravity) {
                vel.vy -= this.GRAVITY * this.game.state.deltaTime;
            }
            
            pos.x += vel.vx * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.y += vel.vy * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.z += vel.vz * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
      
            if(!projectile){
                this.handleGroundInteraction(pos, vel);
                if(!vel.anchored){
                    this.enforceBoundaries(pos, collision);
                }
                 
                this.game.triggerEvent("onEntityPositionUpdated", entityId);
            }
        });
    }
    
    updateMovementHistory(entityId, vel) {
        if (!this.movementHistory.has(entityId)) {
            this.movementHistory.set(entityId, {
                velocityHistory: [],
                smoothedDirection: { x: 0, z: 0 },
                dampedForces: { separation: { x: 0, z: 0 }, avoidance: { x: 0, z: 0 } }
            });
        }
        
        const history = this.movementHistory.get(entityId);
        
        history.velocityHistory.push({ 
            vx: vel.vx, 
            vz: vel.vz, 
            frame: this.frameCounter 
        });
        
        if (history.velocityHistory.length > this.OSCILLATION_DETECTION_FRAMES) {
            history.velocityHistory.shift();
        }
    }
    
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
        
        return directionChanges >= 2;
    }
    
    updatePathfindingStaggered(unitData) {
        if (this.pathfindingQueue.length === 0) {
            const sortedEntityIds = Array.from(unitData.keys()).sort((a, b) => String(a).localeCompare(String(b)));
            sortedEntityIds.forEach(entityId => {
                const data = unitData.get(entityId);
                // Chasing means: has a target or targetPosition they're moving toward but not in range yet
                const isChasing = data.aiState &&
                    data.aiState.currentAction &&
                    (data.aiState.actionTarget || (data.aiState.actionData && data.aiState.actionData.targetPos)) &&
                    !data.isAnchored;

                if (isChasing) {
                    this.pathfindingQueue.push(entityId);
                }
            });
        }

        const unitsPerFrame = Math.max(1, Math.ceil(this.pathfindingQueue.length / this.PATHFINDING_UPDATE_INTERVAL));

        for (let i = 0; i < unitsPerFrame && this.pathfindingQueueIndex < this.pathfindingQueue.length; i++) {
            const entityId = this.pathfindingQueue[this.pathfindingQueueIndex];
            if (unitData.has(entityId)) {
                this.calculatePathfindingAvoidanceOptimized(entityId, unitData.get(entityId), unitData);
            }
            this.pathfindingQueueIndex++;
        }

        if (this.pathfindingQueueIndex >= this.pathfindingQueue.length) {
            this.pathfindingQueueIndex = 0;
            this.pathfindingQueue = [];
        }
    }
    
    updateUnitState(entityId, pos, vel) {
        const currentTime = this.game.state.now;
        
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
    
    calculateSeparationForceOptimized(entityId, data) {
        const { pos, unitRadius, isAnchored } = data;

        if (isAnchored) {
            data.separationForce.x = 0;
            data.separationForce.y = 0;
            data.separationForce.z = 0;
            return;
        }
        
        const separationRadius = unitRadius * this.SEPARATION_RADIUS_MULTIPLIER;
        const nearbyUnits = this.game.gameManager.call('getNearbyUnits', pos, separationRadius, entityId);
        
        let separationForceX = 0;
        let separationForceZ = 0;
        let neighborCount = 0;
        let checksPerformed = 0;
        
        for (const otherEntityId of nearbyUnits) {
            if (checksPerformed >= this.MAX_SEPARATION_CHECKS) break;
            
            checksPerformed++;
            
            const otherPos = this.game.getComponent(otherEntityId, "position");
            const otherCollision = this.game.getComponent(otherEntityId, "collision");
            
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
            const history = this.movementHistory.get(entityId);
            if (history) {
                const dampedSeparation = history.dampedForces.separation;
                dampedSeparation.x *= this.FORCE_DAMPING;
                dampedSeparation.z *= this.FORCE_DAMPING;
                
                separationForceX = (separationForceX / neighborCount) * 0.7 + dampedSeparation.x * 0.3;
                separationForceZ = (separationForceZ / neighborCount) * 0.7 + dampedSeparation.z * 0.3;
                
                dampedSeparation.x = separationForceX;
                dampedSeparation.z = separationForceZ;
            } else {
                separationForceX /= neighborCount;
                separationForceZ /= neighborCount;
            }
        }
        
        data.separationForce.x = separationForceX;
        data.separationForce.z = separationForceZ;
    }
    
    calculatePathfindingAvoidanceOptimized(entityId, data, allUnitData) {
        const { pos, vel, aiState, unitRadius, isAnchored } = data;

        // Only apply avoidance if chasing (has target but not anchored)
        const isChasing = aiState &&
            aiState.currentAction &&
            (aiState.actionTarget || (aiState.actionData && aiState.actionData.targetPos)) &&
            !isAnchored;

        if (!isChasing) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }

        // Get target from aiState
        let targetPos = null;
        const targetEntityId = aiState.actionTarget;

        if(targetEntityId){
            targetPos = this.game.getComponent(targetEntityId, "position");
        } else if (aiState.actionData?.targetPos) {
            targetPos = aiState.actionData.targetPos;
        }

        if (!targetPos) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }
        
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
        
        const obstacleInfo = this.findObstaclesInPathOptimized(pos, desiredDirection, unitRadius, entityId, targetEntityId);
        
        if (obstacleInfo.hasObstacle) {
            const unitState = this.unitStates.get(entityId);
            const avoidanceForce = this.calculateAvoidanceVector(
                pos, desiredDirection, obstacleInfo, unitState, unitRadius
            );
            
            const history = this.movementHistory.get(entityId);
            if (history) {
                const dampedAvoidance = history.dampedForces.avoidance;
                dampedAvoidance.x *= this.FORCE_DAMPING;
                dampedAvoidance.z *= this.FORCE_DAMPING;
                
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
    
    findObstaclesInPathOptimized(pos, direction, unitRadius, entityId, targetEntityId = null) {
        const lookaheadDistance = this.PATHFINDING_LOOKAHEAD;
        const checkRadius = unitRadius * 1.5;
        
        const nearbyUnits = this.game.gameManager.call('getNearbyUnits', pos, lookaheadDistance + checkRadius, entityId);
        
        let closestObstacle = null;
        let closestDistance = Infinity;
        let checksPerformed = 0;
        
        for (let i = 1; i <= this.PATHFINDING_CHECK_POINTS; i++) {
            const checkDistance = (lookaheadDistance / this.PATHFINDING_CHECK_POINTS) * i;
            const checkPos = {
                x: pos.x + direction.x * checkDistance,
                z: pos.z + direction.z * checkDistance
            };
            
            for (const otherEntityId of nearbyUnits) {
                if (targetEntityId && otherEntityId === targetEntityId) continue;
                if (checksPerformed >= this.MAX_PATHFINDING_CHECKS) break;
                
                checksPerformed++;
                
                const otherPos = this.game.getComponent(otherEntityId, "position");
                const otherCollision = this.game.getComponent(otherEntityId, "collision");
                
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

        if (isAnchored || aiState.meta.reachedTarget) {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vy = 0;
            data.desiredVelocity.vz = 0;
            return;
        }


        // Get movement target from aiState
        let targetPos = null;

        // Then check for position target in actionData
        if (!targetPos && aiState && aiState.meta?.targetPosition) {
            targetPos = aiState.meta.targetPosition;
        }

        if (targetPos) {
            // Get pathfinding component
            const pathfinding = this.game.getComponent(entityId, "pathfinding");

            // Use pathfinding if available and useDirectMovement not set
            if (pathfinding && !pathfinding.useDirectMovement) {
                // Check if we have a path to follow
                if (pathfinding.path && pathfinding.path.length > 0) {
                    this.followPath(entityId, data);
                    return;
                }

                // No path yet, request one
                this.requestPathIfNeeded(entityId, data);

                // While waiting for path, move directly
                this.moveDirectlyToTarget(entityId, data);
                return;
            }

            // Direct movement (for units with useDirectMovement flag or no pathfinding)
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distToTarget = Math.sqrt(dx * dx + dz * dz);

            if (distToTarget < 0.1) {
                data.desiredVelocity.vx = 0;
                data.desiredVelocity.vz = 0;
                data.desiredVelocity.vy = 0;
                return;
            }

            const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
            data.desiredVelocity.vx = (dx / distToTarget) * moveSpeed;
            data.desiredVelocity.vz = (dz / distToTarget) * moveSpeed;
            data.desiredVelocity.vy = 0;
            return;
        }

        // No velocity target, don't move
        data.desiredVelocity.vx = 0;
        data.desiredVelocity.vy = 0;
        data.desiredVelocity.vz = 0;
    }
    
    moveDirectlyToTarget(entityId, data) {
        const { pos, vel, aiState } = data;

        // Get target from aiState
        let targetPos = null;
        if (aiState.actionTarget) {
            const currentTargetPos = this.game.getComponent(aiState.actionTarget, "position");
            if (currentTargetPos) {
                targetPos = currentTargetPos;
            }
        } else if (aiState.actionData?.targetPos) {
            targetPos = aiState.actionData.targetPos;
        }

        if (!targetPos) {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vz = 0;
            data.desiredVelocity.vy = 0;
            return;
        }

        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distToTarget = Math.sqrt(dx * dx + dz * dz);

        if (distToTarget < 0.1) {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vz = 0;
            data.desiredVelocity.vy = 0;
            return;
        }

        const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
        data.desiredVelocity.vx = (dx / distToTarget) * moveSpeed;
        data.desiredVelocity.vz = (dz / distToTarget) * moveSpeed;
        data.desiredVelocity.vy = 0;
    }

    requestPathIfNeeded(entityId, data) {
        const { pos, vel, aiState } = data;
        const now = this.game.state.now;

        const pathfinding = this.game.getComponent(entityId, "pathfinding");
        if (!pathfinding) return;

        if (!pathfinding.lastPathRequest || (now - pathfinding.lastPathRequest) > this.PATH_REREQUEST_INTERVAL) {
            pathfinding.lastPathRequest = now;

            // Get target from aiState
            let targetX = null;
            let targetZ = null;

            // If targeting an entity, use its current position
            if (aiState && aiState.meta.target) {
                const targetPos = this.game.getComponent(aiState.meta.target, "position");
                if (targetPos) {
                    targetX = targetPos.x;
                    targetZ = targetPos.z;
                }
            } else if (aiState && aiState.meta?.targetPosition) {
                targetX = aiState.meta.targetPosition.x;
                targetZ = aiState.meta.targetPosition.z;
            }

            if ((!pathfinding.path || pathfinding.path.length == 0) && targetX != null && targetZ != null) {
                pathfinding.path = this.game.gameManager.call('requestPath',
                    entityId,
                    pos.x,
                    pos.z,
                    targetX,
                    targetZ,
                    1
                );
            }
        } else {
            console.log('pathfinding too often');
        }
    }
    
    followPath(entityId, data) {
        const { pos, vel } = data;

        const pathfinding = this.game.getComponent(entityId, "pathfinding");
        if (!pathfinding || !pathfinding.path) return;

        if (pathfinding.pathIndex === undefined) {
            pathfinding.pathIndex = 0;
        }

        if (pathfinding.pathIndex >= pathfinding.path.length) {
            pathfinding.path = null;
            pathfinding.pathIndex = 0;
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vz = 0;
            data.desiredVelocity.vy = 0;
            return;
        }
        const waypoint = pathfinding.path[pathfinding.pathIndex];
        const dx = waypoint.x - pos.x;
        const dz = waypoint.z - pos.z;
        const distToWaypoint = Math.sqrt(dx * dx + dz * dz);

        if (distToWaypoint < this.PATH_REACHED_DISTANCE) {
            pathfinding.pathIndex++;
            if (pathfinding.pathIndex >= pathfinding.path.length) {
                pathfinding.path = null;
                pathfinding.pathIndex = 0;
            }
            return;
        }

        const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
        data.desiredVelocity.vx = (dx / distToWaypoint) * moveSpeed;
        data.desiredVelocity.vz = (dz / distToWaypoint) * moveSpeed;
        data.desiredVelocity.vy = 0;
    }
    
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
        
        let targetVx = desiredVelocity.vx + separationForce.x + avoidanceForce.x;
        let targetVz = desiredVelocity.vz + separationForce.z + avoidanceForce.z;
        
        if (isOscillating) {
            targetVx = desiredVelocity.vx + (separationForce.x + avoidanceForce.x) * 0.3;
            targetVz = desiredVelocity.vz + (separationForce.z + avoidanceForce.z) * 0.3;
        }
        
        const velocitySmoothing = isOscillating ? this.VELOCITY_SMOOTHING * 0.5 : this.VELOCITY_SMOOTHING;
        const directionSmoothing = isOscillating ? this.DIRECTION_SMOOTHING * 0.3 : this.DIRECTION_SMOOTHING;
        
        const newVx = this.lerp(vel.vx, targetVx, velocitySmoothing);
        const newVz = this.lerp(vel.vz, targetVz, velocitySmoothing);

        // Only apply direction smoothing if there's actual desired movement
        // If targetVx and targetVz are both near zero, skip smoothing to preserve current facing
        const targetSpeedSqrd = targetVx * targetVx + targetVz * targetVz;
        const hasTargetMovement = targetSpeedSqrd > 0.01;

        if (history && history.smoothedDirection && hasTargetMovement) {
            const targetDirection = Math.atan2(targetVz, targetVx);

            let currentDirection;
            const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);

            if (currentSpeed < this.MIN_MOVEMENT_THRESHOLD) {
                const facing = this.game.getComponent(entityId, "facing");
                currentDirection = facing ? facing.angle : 0;
            } else {
                currentDirection = Math.atan2(vel.vz, vel.vx);
            }

            let directionDiff = targetDirection - currentDirection;
            if (directionDiff > Math.PI) directionDiff -= 2 * Math.PI;
            if (directionDiff < -Math.PI) directionDiff += 2 * Math.PI;

            if (Math.abs(directionDiff) > this.MIN_DIRECTION_CHANGE) {
                const smoothedDirection = currentDirection + directionDiff * directionSmoothing;
                const speed = Math.sqrt(newVx * newVx + newVz * newVz);

                if (speed > 0.1) {
                    vel.vx = Math.cos(smoothedDirection) * speed;
                    vel.vz = Math.sin(smoothedDirection) * speed;

                    const facing = this.game.getComponent(entityId, "facing");
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

        const speedSqrd = vel.vx * vel.vx + vel.vz * vel.vz;
        if (speedSqrd < this.MIN_MOVEMENT_THRESHOLD * this.MIN_MOVEMENT_THRESHOLD) {
            // Preserve facing direction before zeroing velocity
            if (speedSqrd > 0.001) {
                const facing = this.game.getComponent(entityId, "facing");
                if (facing) {
                    facing.angle = Math.atan2(vel.vz, vel.vx);
                }
            }
            vel.vx = 0;
            vel.vz = 0;
        }
        
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
        
        if (unitType) {
            const collections = this.game.getCollections && this.game.getCollections();
            if (collections && collections.units) {
                const unitDef = collections.units[unitType.id];
                if (unitDef && unitDef.flying) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    handleGroundInteraction(pos, vel) {
        const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z);
        
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
    
    
    enforceBoundaries(pos, collision) {
        const collections = this.game.getCollections();
        const currentLevel = this.game.state.level;
        const level = collections.levels[currentLevel];
        const tileMap = level.tileMap;

        const terrainSize = tileMap.size * this.game.gameManager.call('getGridSize');
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
    
    entityDestroyed(entityId) {

        if (this.unitStates) {
            this.unitStates.delete(entityId);
        }

        if (this.movementTracking) {
            this.movementTracking.delete(entityId);
        }

        if (this.movementHistory) {
            this.movementHistory.delete(entityId);
        }
    }

    isInAttackRange(pos, targetEntityId, entityId) {
        if (!targetEntityId) return false;

        const targetPos = this.game.getComponent(targetEntityId, 'position');
        if (!targetPos) return false;

        const combat = this.game.getComponent(entityId, 'combat');
        if (!combat) return false;

        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        return distance <= (combat.range || combat.attackRange || 50);
    }

    ping() {
        console.log('pong');
    }
}