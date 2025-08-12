class MovementSystem {
    constructor(game){
        this.game = game;
        this.game.movementSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 15;
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        // AI movement configuration
        this.AI_SPEED_MULTIPLIER = 0.1;
        this.DEFAULT_AI_SPEED = 50;
        this.POSITION_UPDATE_MULTIPLIER = 1;
        this.DEFAULT_TERRAIN_SIZE = 768;
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.VELOCITY);
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
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
                    const moveSpeed = Math.max((vel.maxSpeed || this.DEFAULT_AI_SPEED) * this.AI_SPEED_MULTIPLIER, this.DEFAULT_AI_SPEED);
                    desiredVx = (dx / distance) * moveSpeed;
                    desiredVy = (dy / distance) * moveSpeed;
                }
            } else if (aiState && aiState.state === 'attacking') {
                // AI is attacking - stop moving
                desiredVx = 0;
                desiredVy = 0;
            } else {
                // Default behavior - stop if idle
                desiredVx = vel.vx;
                desiredVy = vel.vy;
            }
            
            // Set velocity directly
            vel.vx = desiredVx;
            vel.vy = desiredVy;
            
            // Clamp very small velocities to zero
            const speedSqrd = vel.vx * vel.vx + vel.vy * vel.vy;
            if (speedSqrd < this.MIN_MOVEMENT_THRESHOLD * this.MIN_MOVEMENT_THRESHOLD) {
                vel.vx = 0;
                vel.vy = 0;
            }
            
            // Update position
            pos.x += vel.vx * deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            pos.y += vel.vy * deltaTime * this.POSITION_UPDATE_MULTIPLIER;
            
            // Keep units within boundaries
            const terrainSize = this.game.worldSystem?.terrainSize || this.DEFAULT_TERRAIN_SIZE;
            const halfTerrain = terrainSize / 2;
            const unitRadius = this.getUnitRadius(unitType);
            
            pos.x = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.x));
            pos.y = Math.max(-halfTerrain + unitRadius, Math.min(halfTerrain - unitRadius, pos.y));
        });
    }
    
    // REMOVED: setFacingDirection method entirely
    
    getUnitRadius(unitType) {
        if (unitType && unitType.size) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, unitType.size);
        }
        
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return Math.max(this.DEFAULT_UNIT_RADIUS, unitDef.size);
            }
        }
        
        return this.DEFAULT_UNIT_RADIUS;
    }
}