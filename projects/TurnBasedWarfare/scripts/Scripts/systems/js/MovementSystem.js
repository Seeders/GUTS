class MovementSystem {
    constructor(game){
        this.game = game;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 15;
        this.COLLISION_BUFFER_DISTANCE = 5;
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;
        this.STRONG_AVOIDANCE_FORCE = 100;
        this.GENTLE_AVOIDANCE_FORCE = 20;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        // NEW: Smooth turning configuration
        this.MAX_TURN_RATE = Math.PI * 2; // Maximum radians per second (full rotation in 1 second)
        this.VELOCITY_SMOOTHING = 0.85; // How much to blend with previous velocity (0-1)
        this.MIN_VELOCITY_FOR_TURNING = 1.0; // Don't turn if moving very slowly
        this.ACCELERATION_RATE = 200; // Units per second squared
        this.DECELERATION_RATE = 400; // Units per second squared for stopping
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.VELOCITY);
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            
            // Get or create smooth movement component
            let smoothMovement = this.game.getComponent(entityId, this.componentTypes.SMOOTH_MOVEMENT);
            if (!smoothMovement) {
                smoothMovement = {
                    targetVx: vel.vx,
                    targetVy: vel.vy,
                    currentFacing: Math.atan2(vel.vy, vel.vx),
                    targetFacing: Math.atan2(vel.vy, vel.vx),
                    previousVx: vel.vx,
                    previousVy: vel.vy
                };
                try {
                    this.game.addComponent(entityId, this.componentTypes.SMOOTH_MOVEMENT, smoothMovement);
                } catch (e) {
                    // If SMOOTH_MOVEMENT component doesn't exist, we'll track it manually
                    vel.smoothMovement = smoothMovement;
                    smoothMovement = vel.smoothMovement;
                }
            }
            
            // Get AI state to determine movement behavior
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            
            // Calculate desired velocity based on AI state
            let desiredVx = 0;
            let desiredVy = 0;
            
            if (aiState && aiState.state === 'chasing' && aiState.aiBehavior && aiState.aiBehavior.targetPosition) {
                // AI wants to chase - calculate movement towards target
                const targetPos = aiState.aiBehavior.targetPosition;
                const dx = targetPos.x - pos.x;
                const dy = targetPos.y - pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    const moveSpeed = Math.max((vel.maxSpeed || 100) * 0.1, 50);
                    desiredVx = (dx / distance) * moveSpeed;
                    desiredVy = (dy / distance) * moveSpeed;
                }
            } else if (aiState && aiState.state === 'attacking') {
                // AI is attacking - stop moving
                desiredVx = 0;
                desiredVy = 0;
            } else {
                // Default behavior - use existing velocity or stop if idle
                desiredVx = aiState && aiState.state === 'idle' ? 0 : vel.vx;
                desiredVy = aiState && aiState.state === 'idle' ? 0 : vel.vy;
            }
            
            // Get unit size for collision detection
            const unitRadius = this.getUnitRadius(unitType);
            
            // Apply collision avoidance
            const avoidance = this.calculateCollisionAvoidance(entityId, pos, unitRadius, entities);
            
            // Calculate target velocity (desired + avoidance)
            smoothMovement.targetVx = desiredVx + avoidance.x * deltaTime;
            smoothMovement.targetVy = desiredVy + avoidance.y * deltaTime;
            
            // Smooth velocity transitions
            this.smoothVelocityTransition(vel, smoothMovement, deltaTime);
            
            // Smooth facing direction
            this.smoothFacingDirection(entityId, vel, smoothMovement, deltaTime);
            
            // Update position
            pos.x += vel.vx * deltaTime;
            pos.y += vel.vy * deltaTime;
            
            // Keep units within boundaries
            const terrainSize = this.game.worldSystem?.terrainSize || 768;
            const halfTerrain = terrainSize / 2;
            
            pos.x = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.x));
            pos.y = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.y));
            
            // Store previous velocity for next frame
            smoothMovement.previousVx = vel.vx;
            smoothMovement.previousVy = vel.vy;
        });
    }
    
    smoothVelocityTransition(vel, smoothMovement, deltaTime) {
        // Calculate velocity difference
        const dvx = smoothMovement.targetVx - vel.vx;
        const dvy = smoothMovement.targetVy - vel.vy;
        
        // Use exponential smoothing for gentle transitions
        vel.vx = vel.vx + dvx * (1 - this.VELOCITY_SMOOTHING);
        vel.vy = vel.vy + dvy * (1 - this.VELOCITY_SMOOTHING);
        
        // Alternative: Use acceleration-based smoothing for more realistic movement
        /*
        const targetSpeed = Math.sqrt(smoothMovement.targetVx * smoothMovement.targetVx + smoothMovement.targetVy * smoothMovement.targetVy);
        const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
        
        if (targetSpeed > currentSpeed) {
            // Accelerating
            const accel = Math.min(this.ACCELERATION_RATE * deltaTime, targetSpeed - currentSpeed);
            const ratio = (currentSpeed + accel) / Math.max(currentSpeed, 0.001);
            vel.vx *= ratio;
            vel.vy *= ratio;
        } else if (targetSpeed < currentSpeed) {
            // Decelerating
            const decel = Math.min(this.DECELERATION_RATE * deltaTime, currentSpeed - targetSpeed);
            const ratio = Math.max(0, currentSpeed - decel) / Math.max(currentSpeed, 0.001);
            vel.vx *= ratio;
            vel.vy *= ratio;
        }
        */
    }
    
    smoothFacingDirection(entityId, vel, smoothMovement, deltaTime) {
        const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
        
        // Only update facing if moving fast enough
        if (currentSpeed < this.MIN_VELOCITY_FOR_TURNING) return;
        
        // Calculate target facing direction
        smoothMovement.targetFacing = Math.atan2(vel.vy, vel.vx);
        
        // Calculate angular difference (handling wrap-around)
        let angleDiff = smoothMovement.targetFacing - smoothMovement.currentFacing;
        
        // Normalize angle difference to [-π, π]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Limit turn rate
        const maxTurn = this.MAX_TURN_RATE * deltaTime;
        if (Math.abs(angleDiff) > maxTurn) {
            angleDiff = Math.sign(angleDiff) * maxTurn;
        }
        
        // Update current facing
        smoothMovement.currentFacing += angleDiff;
        
        // Normalize current facing to [0, 2π]
        while (smoothMovement.currentFacing < 0) smoothMovement.currentFacing += 2 * Math.PI;
        while (smoothMovement.currentFacing >= 2 * Math.PI) smoothMovement.currentFacing -= 2 * Math.PI;
        
        // Update 3D model rotation
        if (this.game.renderSystem && this.game.renderSystem.entityModels) {
            const modelGroup = this.game.renderSystem.entityModels.get(entityId);
            if (modelGroup) {
                modelGroup.rotation.y = -smoothMovement.currentFacing + Math.PI / 2;
            }
        }
        
        // Update facing component
        const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
        if (facing) {
            facing.angle = smoothMovement.currentFacing;
            facing.direction = { 
                x: Math.cos(smoothMovement.currentFacing), 
                y: Math.sin(smoothMovement.currentFacing) 
            };
        }
    }
    
    calculateCollisionAvoidance(entityId, pos, unitRadius, allEntities) {
        let avoidX = 0;
        let avoidY = 0;
        let count = 0;
        
        const avoidanceRadius = unitRadius * this.AVOIDANCE_RADIUS_MULTIPLIER;
        
        allEntities.forEach(otherId => {
            if (otherId === entityId) return;
            
            const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);
            const otherUnitType = this.game.getComponent(otherId, this.componentTypes.UNIT_TYPE);
            
            if (!otherPos) return;
            
            const otherRadius = this.getUnitRadius(otherUnitType);
            
            const dx = pos.x - otherPos.x;
            const dy = pos.y - otherPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const minDistance = unitRadius + otherRadius + this.COLLISION_BUFFER_DISTANCE;
            
            if (distance < avoidanceRadius && distance > 0) {
                let strength = 0;
                
                if (distance < minDistance) {
                    // Very close - strong repulsion
                    strength = (minDistance - distance) / minDistance * this.STRONG_AVOIDANCE_FORCE;
                } else {
                    // Nearby - gentle avoidance
                    strength = (avoidanceRadius - distance) / avoidanceRadius * this.GENTLE_AVOIDANCE_FORCE;
                }
                
                avoidX += (dx / distance) * strength;
                avoidY += (dy / distance) * strength;
                count++;
            }
        });
        
        // Smooth the avoidance forces to prevent jitter
        if (count > 0) {
            avoidX /= count; // Average the forces
            avoidY /= count;
        }
        
        return { x: avoidX, y: avoidY };
    }
    
    getUnitRadius(unitType) {
        if (unitType && unitType.size) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, unitType.size * 0.1);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return Math.max(this.DEFAULT_UNIT_RADIUS, unitDef.size * 0.1);
            }
        }
        
        return this.DEFAULT_UNIT_RADIUS;
    }
}