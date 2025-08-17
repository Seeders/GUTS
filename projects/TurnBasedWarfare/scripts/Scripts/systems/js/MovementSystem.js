class MovementSystem {
    constructor(game){
        this.game = game;
        this.game.movementSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 25;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        // AI movement configuration
        this.AI_SPEED_MULTIPLIER = 0.1;
        this.DEFAULT_AI_SPEED = 50;
        this.POSITION_UPDATE_MULTIPLIER = 1;
        this.DEFAULT_TERRAIN_SIZE = 768;
        
        // Physics configuration
        this.GRAVITY = 200; // Gravity acceleration (affects Y-axis)
        this.GROUND_LEVEL = 0; // Base ground Y-coordinate
        this.GROUND_IMPACT_THRESHOLD = 5; // Distance from ground to trigger impact
        this.TERRAIN_FOLLOW_SPEED = 8; // How quickly units adjust to terrain height
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.VELOCITY);
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
            const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            const projectile = this.game.getComponent(entityId, this.componentTypes.PROJECTILE);
            
            // Check if this entity is affected by gravity
            const isAffectedByGravity = this.shouldApplyGravity(entityId, projectile, unitType);
            
            // Calculate desired velocity based on AI state (for units, not projectiles)
            if (!projectile) {
                this.updateUnitMovement(entityId, pos, vel, unitType, aiState, deltaTime);
            }
            
            // Apply gravity to entities that should be affected
            if (isAffectedByGravity) {
                vel.vy -= this.GRAVITY * deltaTime;
            }
            
            // Update position (full 3D)
            pos.x += vel.vx * deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.y += vel.vy * deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.z += vel.vz * deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            
            if(!projectile){
                // Handle ground interactions (including terrain height)
                this.handleGroundInteraction(pos, vel);
                // Keep units within boundaries (use X and Z for horizontal bounds)
                this.enforceBoundaries(pos, collision);
            }
        });
    }
    
    updateUnitMovement(entityId, pos, vel, unitType, aiState, deltaTime) {
        // Calculate desired velocity based on AI state
        let desiredVx = 0;
        let desiredVy = 0;
        let desiredVz = 0;
        
        if (aiState && aiState.state === 'chasing' && aiState.aiBehavior && aiState.aiBehavior.targetPosition) {
            // AI wants to chase - calculate movement towards target
            const targetPos = aiState.aiBehavior.targetPosition;
            const dx = targetPos.x - pos.x;
            const dy = targetPos.y - pos.y; // Height difference (usually 0 for ground units)
            const dz = targetPos.z - pos.z; // Forward/backward movement
            
            // For ground units, primarily use X and Z movement, ignore Y
            const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
            
            if (horizontalDistance > 0) {
                const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
                desiredVx = (dx / horizontalDistance) * moveSpeed;
                desiredVz = (dz / horizontalDistance) * moveSpeed;
                // Keep Y velocity as 0 for ground units (terrain following will handle Y)
                desiredVy = 0;
            }
        } else if (aiState && aiState.state === 'attacking') {
            // AI is attacking - stop moving
            desiredVx = 0;
            desiredVy = 0;
            desiredVz = 0;
        } else {
            // Default behavior - stop if idle
            desiredVx = vel.vx;
            desiredVy = vel.vy;
            desiredVz = vel.vz;
        }
        
        // Set velocity directly
        vel.vx = desiredVx;
        vel.vy = desiredVy;
        vel.vz = desiredVz;
        
        // Clamp very small velocities to zero
        const speedSqrd = vel.vx * vel.vx + vel.vz * vel.vz; // Only check horizontal movement
        if (speedSqrd < this.MIN_MOVEMENT_THRESHOLD * this.MIN_MOVEMENT_THRESHOLD) {
            vel.vx = 0;
            vel.vz = 0;
        }
    }
    
    shouldApplyGravity(entityId, projectile, unitType) {
        // Apply gravity to projectiles
        if (projectile) {
            return true;
        }
        
        // Ground units should stay on ground (no gravity needed)
        // Flying units could have gravity applied if they exist
        if (unitType && unitType.type) {
            const collections = this.game.getCollections && this.game.getCollections();
            if (collections && collections.units) {
                const unitDef = collections.units[unitType.id || unitType.type];
                if (unitDef && unitDef.flying) {
                    return true; // Flying units affected by gravity
                }
            }
        }
        
        return false; // Ground units not affected by gravity
    }
    
    handleGroundInteraction(pos, vel) {
        
        // Ground units should follow terrain height
        const terrainHeight = this.getTerrainHeightAtPosition(pos.x, pos.z);
        
        if (terrainHeight !== null) {
            // Smoothly adjust unit height to terrain
            const targetHeight = terrainHeight;   
            pos.y = targetHeight;
            
            // Stop downward velocity when on ground
            if (pos.y <= targetHeight + 0.1) {
                vel.vy = Math.max(0, vel.vy);
            }
        } else {
            // Fallback to basic ground level if no terrain data
            if (pos.y < this.GROUND_LEVEL) {
                pos.y = this.GROUND_LEVEL;
                vel.vy = Math.max(0, vel.vy);
            }
        }
    }
    
    getTerrainHeightAtPosition(worldX, worldZ) {
        // Delegate to WorldSystem
        if (this.game.worldSystem && this.game.worldSystem.getTerrainHeightAtPosition) {
            return this.game.worldSystem.getTerrainHeightAtPosition(worldX, worldZ);
        }
        return this.GROUND_LEVEL; // Fallback to flat ground
    }
    
    
    enforceBoundaries(pos, collision) {
        const terrainSize = this.game.worldSystem?.terrainSize || this.DEFAULT_TERRAIN_SIZE;
        const halfTerrain = terrainSize / 2;
        const unitRadius = this.getUnitRadius(collision);
        
        pos.x = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.x));
        pos.z = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.z));
        // Y coordinate is now handled by terrain following in handleGroundInteraction
    }
    
    getUnitRadius(collision) {
        if (collision && collision.radius) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius);
        }
  
        return this.DEFAULT_UNIT_RADIUS;
    }
}