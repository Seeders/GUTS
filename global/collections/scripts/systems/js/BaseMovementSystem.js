/**
 * BaseMovementSystem - Core physics and movement logic for units
 *
 * This is the base class that handles:
 * - Velocity/position updates
 * - Separation forces (units pushing apart)
 * - Pathfinding integration
 * - Obstacle avoidance
 * - Ground interaction
 * - Boundary enforcement
 * - Oscillation detection
 *
 * Games can extend this class and override hook methods:
 * - shouldProcessUpdate() - Return false to skip update (e.g., wrong game phase)
 * - getMovementEntities() - Filter which entities to process
 * - onEntityMoved(entityId, speed) - Called when entity moves (e.g., for footstep audio)
 */
class BaseMovementSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getBehaviorMeta',
        'getBehaviorShared',
        'getNearbyUnits',
        'getEntityPath',
        'clearEntityPath',
        'requestPath',
        'setEntityPath',
        'getBehaviorNodeId',
        'getTerrainHeightAtPosition',
        'getGridSize'
    ];

    constructor(game) {
        super(game);
        this.game.movementSystem = this;

        // Movement thresholds
        this.DEFAULT_UNIT_RADIUS = 25;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;

        // Speed configuration
        this.AI_SPEED_MULTIPLIER = 0.1;
        this.DEFAULT_AI_SPEED = 50;
        this.POSITION_UPDATE_MULTIPLIER = 1;
        this.DEFAULT_TERRAIN_SIZE = 768 * 2;

        // Gravity and ground interaction
        this.GRAVITY = 200;
        this.GROUND_LEVEL = 0;
        this.GROUND_IMPACT_THRESHOLD = 5;
        this.TERRAIN_FOLLOW_SPEED = 8;

        // Separation force (units pushing apart)
        this.SEPARATION_FORCE = 80;
        this.SEPARATION_RADIUS_MULTIPLIER = 0.1;
        this.MAX_SEPARATION_CHECKS = 8;
        this.AVOIDANCE_SMOOTHING = 0.15;

        // Pathfinding and obstacle avoidance
        this.PATHFINDING_LOOKAHEAD = 100;
        this.OBSTACLE_AVOIDANCE_FORCE = 70;
        this.AVOIDANCE_ANGLE = Math.PI / 3;
        this.STUCK_THRESHOLD = 5;
        this.STUCK_TIME_LIMIT = 2000;
        this.REPATH_DISTANCE = 50;

        // Path following
        this.PATH_REACHED_DISTANCE = 3;
        this.PATH_REREQUEST_INTERVAL = 0.5;

        // Spatial optimization
        this.SPATIAL_GRID_SIZE = 80;
        this.MAX_PATHFINDING_CHECKS = 6;
        this.PATHFINDING_CHECK_POINTS = 3;
        this.PATHFINDING_UPDATE_INTERVAL = 3;
        this.NEAR_UNIT_RADIUS = 150;

        // Velocity smoothing
        this.VELOCITY_SMOOTHING = 0.9;
        this.DIRECTION_SMOOTHING = 0.9;
        this.FORCE_DAMPING = 0.85;
        this.MIN_DIRECTION_CHANGE = 0.1;
        this.OSCILLATION_DETECTION_FRAMES = 5;
        this.OSCILLATION_THRESHOLD = Math.PI / 6;

        this.frameCounter = 0;
        this.pathfindingQueue = [];
        this.pathfindingQueueIndex = 0;

        // Pre-allocate reusable structures to avoid per-frame allocations
        this._unitDataMap = new Map();
        this._unitDataPool = [];
        this._sortedEntityIds = [];
    }

    init() {
        // Cache direct TypedArray references for hot path optimization
        this._posXArray = null;
        this._posYArray = null;
        this._posZArray = null;
        this._collisionRadiusArray = null;
    }

    /**
     * Hook: Override to add conditions for when update should run
     * @returns {boolean} True if update should proceed
     */
    shouldProcessUpdate() {
        return true;
    }

    /**
     * Hook: Override to customize which entities are processed
     * @returns {number[]} Array of entity IDs to process
     */
    getMovementEntities() {
        return this.game.getEntitiesWith("transform", "velocity");
    }

    /**
     * Hook: Called when an entity moves (after velocity is applied)
     * Override to add effects like footstep sounds
     * @param {number} entityId
     * @param {number} speed - Current movement speed
     */
    onEntityMoved(entityId, speed) {
        // Override in subclass for footstep sounds, etc.
    }

    /**
     * Ensure cached field arrays are initialized (lazy init on first frame)
     */
    _ensureFieldArrays() {
        if (!this._posXArray) {
            this._posXArray = this.game.getFieldArray('transform', 'position.x');
            this._posYArray = this.game.getFieldArray('transform', 'position.y');
            this._posZArray = this.game.getFieldArray('transform', 'position.z');
            this._collisionRadiusArray = this.game.getFieldArray('collision', 'radius');
        }
    }

    // Get or create a pooled unit data object
    _getPooledUnitData() {
        if (this._unitDataPool.length > 0) {
            return this._unitDataPool.pop();
        }
        return {
            pos: null, vel: null, unitType: null, collision: null, aiState: null, projectile: null,
            unitRadius: 0,
            isAnchored: false,
            desiredVelocity: { vx: 0, vy: 0, vz: 0 },
            separationForce: { x: 0, y: 0, z: 0 },
            avoidanceForce: { x: 0, y: 0, z: 0 }
        };
    }

    update() {
        if (!this.shouldProcessUpdate()) return;

        this._ensureFieldArrays();
        this.frameCounter++;

        const entities = this.getMovementEntities();
        entities.sort((a, b) => a - b);

        // Return all current unitData objects to pool and clear map
        for (const data of this._unitDataMap.values()) {
            this._unitDataPool.push(data);
        }
        this._unitDataMap.clear();

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) return;
            const vel = this.game.getComponent(entityId, "velocity");
            const unitType = this.game.getComponent(entityId, "unitType");
            const collision = this.game.getComponent(entityId, "collision");
            const aiState = this.game.getComponent(entityId, "aiState");
            const projectile = this.game.getComponent(entityId, "projectile");

            if (!projectile) {
                const unitRadius = this.getUnitRadius(collision);

                const behaviorMeta = aiState ? this.call.getBehaviorMeta(entityId) : null;
                const isAttacking = !!aiState &&
                    aiState.currentActionCollection === this.enums.behaviorCollection.behaviorActions &&
                    (aiState.currentAction === this.enums.behaviorActions.AttackEnemyBehaviorAction || aiState.currentAction === this.enums.behaviorActions.CombatBehaviorAction) &&
                    !!behaviorMeta?.target &&
                    this.isInAttackRange(behaviorMeta.target, entityId);
                const isAnchored = vel.anchored || isAttacking;

                const data = this._getPooledUnitData();
                data.pos = pos;
                data.vel = vel;
                data.unitType = unitType;
                data.collision = collision;
                data.aiState = aiState;
                data.projectile = projectile;
                data.unitRadius = unitRadius;
                data.isAnchored = isAnchored;
                data.desiredVelocity.vx = 0;
                data.desiredVelocity.vy = 0;
                data.desiredVelocity.vz = 0;
                data.separationForce.x = 0;
                data.separationForce.y = 0;
                data.separationForce.z = 0;
                data.avoidanceForce.x = 0;
                data.avoidanceForce.y = 0;
                data.avoidanceForce.z = 0;

                this._unitDataMap.set(entityId, data);

                this.updateUnitState(entityId, pos, vel);
                this.updateMovementHistory(entityId, vel);
            }
        });

        // Reuse sorted array
        this._sortedEntityIds.length = 0;
        for (const key of this._unitDataMap.keys()) {
            this._sortedEntityIds.push(key);
        }

        this._sortedEntityIds.forEach((entityId) => {
            this.calculateDesiredVelocity(entityId, this._unitDataMap.get(entityId));
        });

        this._sortedEntityIds.forEach((entityId) => {
            this.calculateSeparationForceOptimized(entityId, this._unitDataMap.get(entityId));
        });

        this.updatePathfindingStaggered(this._unitDataMap);

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            if (!pos) return;
            const vel = this.game.getComponent(entityId, "velocity");
            const collision = this.game.getComponent(entityId, "collision");
            const projectile = this.game.getComponent(entityId, "projectile");

            const isAffectedByGravity = vel.affectedByGravity;

            if (!projectile && this._unitDataMap.has(entityId)) {
                let entityData = this._unitDataMap.get(entityId);
                if (vel.vx != 0 || vel.vz != 0 || entityData.desiredVelocity.vx != 0 || entityData.desiredVelocity.vz != 0) {
                    this.applyUnitMovementWithSmoothing(entityId, this._unitDataMap.get(entityId));
                }
            }

            if (isAffectedByGravity) {
                vel.vy -= this.GRAVITY * this.game.state.deltaTime;
            }

            pos.x += vel.vx * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.y += vel.vy * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.z += vel.vz * this.game.state.deltaTime * this.POSITION_UPDATE_MULTIPLIER;

            if (!projectile) {
                const leaping = this.game.getComponent(entityId, "leaping");
                if (!(leaping && leaping.isLeaping)) {
                    this.handleGroundInteraction(pos, vel);
                }
                if (!vel.anchored) {
                    this.enforceBoundaries(pos, collision);
                }
            }
        });
    }

    updateMovementHistory(entityId, vel) {
        let movementState = this.game.getComponent(entityId, 'movementState');
        if (!movementState) {
            this.game.addComponent(entityId, 'movementState', {
                lastPosition: { x: 0, z: 0 },
                lastMovementTime: 0,
                stuckTime: 0,
                lastPathTime: 0,
                avoidanceDirection: 0,
                velocityHistoryIndex: 0,
                velocityHistoryCount: 0,
                smoothedDirection: { x: 0, z: 0 },
                dampedForces: { separation: { x: 0, z: 0 }, avoidance: { x: 0, z: 0 } }
            });
            movementState = this.game.getComponent(entityId, 'movementState');
        }

        const BUFFER_SIZE = 5;
        const idx = movementState.velocityHistoryIndex;

        movementState.velocityHistory[idx].vx = Math.round(vel.vx * 1000000) / 1000000;
        movementState.velocityHistory[idx].vz = Math.round(vel.vz * 1000000) / 1000000;
        movementState.velocityHistory[idx].frame = this.frameCounter;

        movementState.velocityHistoryIndex = (idx + 1) % BUFFER_SIZE;
        if (movementState.velocityHistoryCount < BUFFER_SIZE) {
            movementState.velocityHistoryCount++;
        }
    }

    isUnitOscillating(entityId) {
        const movementState = this.game.getComponent(entityId, 'movementState');
        if (!movementState || movementState.velocityHistoryCount < this.OSCILLATION_DETECTION_FRAMES) {
            return false;
        }

        let directionChanges = 0;
        let lastDirection = null;

        const BUFFER_SIZE = 5;
        const count = movementState.velocityHistoryCount;
        const startIdx = (movementState.velocityHistoryIndex - count + BUFFER_SIZE) % BUFFER_SIZE;

        for (let i = 0; i < count; i++) {
            const bufferIdx = (startIdx + i) % BUFFER_SIZE;
            const vel = movementState.velocityHistory[bufferIdx];
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
            this._sortedEntityIds.length = 0;
            for (const entityId of unitData.keys()) {
                this._sortedEntityIds.push(entityId);
            }
            this._sortedEntityIds.sort((a, b) => a - b);
            this._sortedEntityIds.forEach(entityId => {
                const data = unitData.get(entityId);
                const behaviorShared = data.aiState ? this.call.getBehaviorShared(entityId) : null;
                const isChasing = data.aiState &&
                    data.aiState.currentAction >= 0 &&
                    (behaviorShared || behaviorShared?.targetPosition) &&
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

        let movementState = this.game.getComponent(entityId, 'movementState');
        if (!movementState) {
            this.game.addComponent(entityId, 'movementState', {
                lastPosition: { x: pos.x, z: pos.z },
                lastMovementTime: currentTime,
                stuckTime: 0,
                lastPathTime: 0,
                avoidanceDirection: 0,
                velocityHistory: [],
                smoothedDirection: { x: 0, z: 0 },
                dampedForces: { separation: { x: 0, z: 0 }, avoidance: { x: 0, z: 0 } }
            });
            return;
        }

        const speed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
        const distanceMoved = Math.sqrt(
            Math.pow(pos.x - movementState.lastPosition.x, 2) +
            Math.pow(pos.z - movementState.lastPosition.z, 2)
        );

        if (speed < this.STUCK_THRESHOLD && distanceMoved < 1) {
            movementState.stuckTime += this.game.state.deltaTime;
        } else {
            movementState.stuckTime = 0;
            movementState.lastPosition.x = pos.x;
            movementState.lastPosition.z = pos.z;
        }

        if (distanceMoved > this.REPATH_DISTANCE) {
            movementState.avoidanceDirection = 0;
            movementState.lastPathTime = currentTime;
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
        const nearbyUnits = this.call.getNearbyUnits(pos, separationRadius, entityId);

        let separationForceX = 0;
        let separationForceZ = 0;
        let neighborCount = 0;
        let checksPerformed = 0;

        const posXArr = this._posXArray;
        const posZArr = this._posZArray;
        const radiusArr = this._collisionRadiusArray;
        const myPosX = pos.x;
        const myPosZ = pos.z;

        for (const otherEntityId of nearbyUnits) {
            if (checksPerformed >= this.MAX_SEPARATION_CHECKS) break;
            checksPerformed++;

            const otherPosX = posXArr[otherEntityId];
            const otherPosZ = posZArr[otherEntityId];

            if (otherPosX === undefined || otherPosX === 0 && otherPosZ === 0) continue;

            const otherRadiusRaw = radiusArr ? radiusArr[otherEntityId] : 0;
            const otherRadius = otherRadiusRaw > 0 ? Math.max(this.DEFAULT_UNIT_RADIUS, otherRadiusRaw) : this.DEFAULT_UNIT_RADIUS;

            const dx = myPosX - otherPosX;
            const dz = myPosZ - otherPosZ;
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
            const movementState = this.game.getComponent(entityId, 'movementState');
            if (movementState && movementState.dampedForces) {
                const dampedSeparation = movementState.dampedForces.separation;
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

        const behaviorShared = aiState ? this.call.getBehaviorShared(entityId) : null;
        const isChasing = aiState &&
            aiState.currentAction >= 0 &&
            (behaviorShared || behaviorShared?.targetPosition) &&
            !isAnchored;

        if (!isChasing) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }

        let targetPos = behaviorShared?.targetPosition;

        if (!targetPos) {
            data.avoidanceForce.x = 0;
            data.avoidanceForce.z = 0;
            return;
        }

        const behaviorMeta = this.call.getBehaviorMeta(entityId);
        const targetEntityId = behaviorShared?.target ?? behaviorMeta?.target ?? null;

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
            const movementState = this.game.getComponent(entityId, 'movementState');
            const avoidanceForce = this.calculateAvoidanceVector(
                pos, desiredDirection, obstacleInfo, movementState, unitRadius
            );

            if (movementState && movementState.dampedForces) {
                const dampedAvoidance = movementState.dampedForces.avoidance;
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

        const nearbyUnits = this.call.getNearbyUnits(pos, lookaheadDistance + checkRadius, entityId);

        let closestObstacle = null;
        let closestDistance = Infinity;
        let checksPerformed = 0;

        const posXArr = this._posXArray;
        const posZArr = this._posZArray;
        const radiusArr = this._collisionRadiusArray;

        for (let i = 1; i <= this.PATHFINDING_CHECK_POINTS; i++) {
            const checkDistance = (lookaheadDistance / this.PATHFINDING_CHECK_POINTS) * i;
            const checkPosX = pos.x + direction.x * checkDistance;
            const checkPosZ = pos.z + direction.z * checkDistance;

            for (const otherEntityId of nearbyUnits) {
                if (targetEntityId >= 0 && otherEntityId === targetEntityId) continue;
                if (checksPerformed >= this.MAX_PATHFINDING_CHECKS) break;
                checksPerformed++;

                const otherPosX = posXArr[otherEntityId];
                const otherPosZ = posZArr[otherEntityId];
                if (otherPosX === undefined) continue;

                const otherRadiusRaw = radiusArr ? radiusArr[otherEntityId] : 0;
                const otherRadius = otherRadiusRaw > 0 ? Math.max(this.DEFAULT_UNIT_RADIUS, otherRadiusRaw) : this.DEFAULT_UNIT_RADIUS;

                const dx = checkPosX - otherPosX;
                const dz = checkPosZ - otherPosZ;
                const distance = Math.sqrt(dx * dx + dz * dz);
                const minDistance = checkRadius + otherRadius;

                if (distance < minDistance && distance < closestDistance) {
                    closestDistance = distance;
                    closestObstacle = {
                        pos: { x: otherPosX, z: otherPosZ },
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

    calculateAvoidanceVector(pos, desiredDirection, obstacleInfo, movementState, unitRadius) {
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

        let avoidanceDirection = movementState?.avoidanceDirection || 0;

        if (avoidanceDirection === 0) {
            const perpLeft = { x: -toObstacle.z, z: toObstacle.x };
            const perpRight = { x: toObstacle.z, z: -toObstacle.x };
            const leftAlignment = perpLeft.x * desiredDirection.x + perpLeft.z * desiredDirection.z;
            const rightAlignment = perpRight.x * desiredDirection.x + perpRight.z * desiredDirection.z;
            avoidanceDirection = leftAlignment > rightAlignment ? 1 : -1;
            if (movementState) {
                movementState.avoidanceDirection = avoidanceDirection;
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

        const behaviorMeta = aiState ? this.call.getBehaviorMeta(entityId) : null;
        if (isAnchored || behaviorMeta?.reachedTarget) {
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vy = 0;
            data.desiredVelocity.vz = 0;
            return;
        }

        let targetPos = null;

        if (!targetPos && behaviorMeta?.targetPosition) {
            targetPos = behaviorMeta.targetPosition;
        }

        if (targetPos) {
            const pathfinding = this.game.getComponent(entityId, "pathfinding");

            if (pathfinding && !pathfinding.useDirectMovement) {
                let path = this.call.getEntityPath(entityId);

                if (path && path.length > 0) {
                    const currentTargetX = targetPos.x;
                    const currentTargetZ = targetPos.z;
                    const dx = currentTargetX - pathfinding.lastTargetX;
                    const dz = currentTargetZ - pathfinding.lastTargetZ;
                    const targetDistanceSq = dx * dx + dz * dz;
                    const TARGET_CHANGE_THRESHOLD_SQ = 50 * 50;

                    if (targetDistanceSq > TARGET_CHANGE_THRESHOLD_SQ) {
                        this.call.clearEntityPath(entityId);
                        pathfinding.lastPathRequest = 0;
                        pathfinding.pathIndex = 0;
                        path = null;
                    }
                }

                if (path && path.length > 0) {
                    this.followPath(entityId, data, path);
                    return;
                }

                this.requestPathIfNeeded(entityId, data);
                this.moveDirectlyToTarget(entityId, data);
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
            return;
        }

        data.desiredVelocity.vx = 0;
        data.desiredVelocity.vy = 0;
        data.desiredVelocity.vz = 0;
    }

    moveDirectlyToTarget(entityId, data) {
        const { pos, vel } = data;

        const behaviorShared = this.call.getBehaviorShared(entityId);
        const targetPos = behaviorShared?.targetPosition;

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
        const transform = this.game.getComponent(entityId, "transform");
        if (!pathfinding) return;

        let targetX = null;
        let targetZ = null;

        const behaviorMeta = aiState ? this.call.getBehaviorMeta(entityId) : null;
        if (behaviorMeta?.target) {
            const targetTransform = this.game.getComponent(behaviorMeta.target, "transform");
            const targetPos = targetTransform?.position;
            if (targetPos) {
                targetX = targetPos.x;
                targetZ = targetPos.z;
            }
        } else if (behaviorMeta?.targetPosition) {
            targetX = behaviorMeta.targetPosition.x;
            targetZ = behaviorMeta.targetPosition.z;
        }

        if (targetX != null && targetZ != null) {
            const dx = targetX - pathfinding.lastTargetX;
            const dz = targetZ - pathfinding.lastTargetZ;
            const targetDistanceSq = dx * dx + dz * dz;
            const TARGET_CHANGE_THRESHOLD_SQ = 50 * 50;

            if (targetDistanceSq > TARGET_CHANGE_THRESHOLD_SQ) {
                this.call.clearEntityPath(entityId);
                pathfinding.lastPathRequest = 0;
                pathfinding.pathIndex = 0;
            }
        }

        if (!pathfinding.lastPathRequest || (now - pathfinding.lastPathRequest) > this.PATH_REREQUEST_INTERVAL) {
            pathfinding.lastPathRequest = now;

            const existingPath = this.call.getEntityPath(entityId);
            if ((!existingPath || existingPath.length == 0) && targetX != null && targetZ != null) {
                pathfinding.lastTargetX = targetX;
                pathfinding.lastTargetZ = targetZ;

                const cachedPath = this.call.requestPath(
                    entityId,
                    pos.x,
                    pos.z,
                    targetX,
                    targetZ,
                    1
                );

                if (cachedPath && cachedPath.length > 0) {
                    this.call.setEntityPath(entityId, cachedPath);
                    pathfinding.pathIndex = 0;
                }
            }
        } else {
            const existingPath = this.call.getEntityPath(entityId);
            const timeSinceLastRequest = now - pathfinding.lastPathRequest;

            if (timeSinceLastRequest < 0.1) {
                return;
            }

            const behaviorShared = aiState ? this.call.getBehaviorShared(entityId) : null;
            const actionName = this.call.getBehaviorNodeId(aiState?.currentActionCollection, aiState?.currentAction)
                ?? aiState?.currentAction;
            // IMPORTANT: Never remove this debug message - it is very useful for debugging pathfinding issues
            // NEVER.  EVER.  THAT MEANS YOU CLAUDE.  DO NOT REMOVE THIS CONSOLE LOG MESSAGE.
            console.log('pathfinding too often', entityId, {
                hasPath: !!existingPath,
                pathLength: existingPath?.length,
                targetX, targetZ,
                metaMoving: behaviorMeta?.moving,
                sharedTargetPos: behaviorShared?.targetPosition,
                actionName,
                timeSinceLastRequest
            });
            behaviorMeta.targetPosition = transform.position;
            behaviorMeta.target = null;
            // I SWEAR TO GOD IF YOU REMOVED THAT MESSAGE...
        }
    }

    followPath(entityId, data, path) {
        const { pos, vel } = data;

        const pathfinding = this.game.getComponent(entityId, "pathfinding");
        if (!pathfinding || !path) return;

        if (pathfinding.pathIndex === undefined) {
            pathfinding.pathIndex = 0;
        }

        if (pathfinding.pathIndex >= path.length) {
            this.call.clearEntityPath(entityId);
            pathfinding.pathIndex = 0;
            data.desiredVelocity.vx = 0;
            data.desiredVelocity.vz = 0;
            data.desiredVelocity.vy = 0;
            return;
        }
        const waypoint = path[pathfinding.pathIndex];
        const dx = waypoint.x - pos.x;
        const dz = waypoint.z - pos.z;
        const distToWaypoint = Math.sqrt(dx * dx + dz * dz);

        if (distToWaypoint < this.PATH_REACHED_DISTANCE) {
            pathfinding.pathIndex++;
            if (pathfinding.pathIndex >= path.length) {
                this.call.clearEntityPath(entityId);
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
        const leaping = this.game.getComponent(entityId, "leaping");
        if (leaping && leaping.isLeaping) return;

        const { vel, desiredVelocity, separationForce, avoidanceForce, isAnchored } = data;

        if (isAnchored) {
            vel.vx = 0;
            vel.vz = 0;
            vel.vy = desiredVelocity.vy || vel.vy || 0;
            return;
        }

        const movementState = this.game.getComponent(entityId, 'movementState');
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

        const targetSpeedSqrd = targetVx * targetVx + targetVz * targetVz;
        const hasTargetMovement = targetSpeedSqrd > 0.01;

        if (movementState && movementState.smoothedDirection && hasTargetMovement) {
            const targetDirection = Math.atan2(targetVz, targetVx);
            let currentDirection;
            const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);

            if (currentSpeed < this.MIN_MOVEMENT_THRESHOLD) {
                const transform = this.game.getComponent(entityId, "transform");
                currentDirection = transform?.rotation?.y || 0;
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

                    if (!vel.anchored) {
                        const transform = this.game.getComponent(entityId, "transform");
                        if (transform && transform.rotation) {
                            transform.rotation.y = Math.round(smoothedDirection * 1000000) / 1000000;
                        }
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
            if (speedSqrd > 0.001 && !vel.anchored) {
                const transform = this.game.getComponent(entityId, "transform");
                if (transform && transform.rotation) {
                    transform.rotation.y = Math.round(Math.atan2(vel.vz, vel.vx) * 1000000) / 1000000;
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

        // Call hook for movement effects (footsteps, etc.)
        const finalSpeed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);
        if (finalSpeed > this.MIN_MOVEMENT_THRESHOLD) {
            this.onEntityMoved(entityId, finalSpeed);
        }
    }

    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    shouldApplyGravity(entityId, projectile, unitType) {
        if (projectile) {
            return true;
        }
        if (unitType && unitType.flying) {
            return true;
        }
        return false;
    }

    handleGroundInteraction(pos, vel) {
        const terrainHeight = this.call.getTerrainHeightAtPosition(pos.x, pos.z);

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
        const terrainEntities = this.game.getEntitiesWith('terrain');
        if (terrainEntities.length === 0) return;
        const terrainComponent = this.game.getComponent(terrainEntities[0], 'terrain');
        const levelKey = this.reverseEnums.levels[terrainComponent?.level];
        const level = this.collections.levels[levelKey];
        if (!level?.tileMap) return;
        const tileMap = level.tileMap;

        const terrainSize = tileMap.size * this.call.getGridSize();
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
        // movementState component is automatically cleaned up by ECS when entity is destroyed
    }

    isInAttackRange(targetEntityId, entityId) {
        if (targetEntityId === undefined || targetEntityId === null || targetEntityId < 0) return false;

        const combat = this.game.getComponent(entityId, 'combat');
        if (!combat) return false;

        const baseRange = combat.range || combat.attackRange || 50;
        return GUTS.GameUtils.isInRange(this.game, entityId, targetEntityId, baseRange);
    }
}

// Register on GUTS namespace for subclassing
if (typeof GUTS !== 'undefined') {
    GUTS.BaseMovementSystem = BaseMovementSystem;
}
