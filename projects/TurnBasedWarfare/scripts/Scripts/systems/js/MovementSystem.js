class MovementSystem {
    constructor(game){
        this.game = game;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration variables
        this.DEFAULT_UNIT_RADIUS = 150;           // Default radius when no size specified
        this.COLLISION_BUFFER_DISTANCE = 5;     // Extra space between units (px)
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;    // How far to look for other units (radius * multiplier)
        this.STRONG_AVOIDANCE_FORCE = 100;       // Force when units are overlapping
        this.GENTLE_AVOIDANCE_FORCE = 20;        // Force when units are nearby but not overlapping
        this.MIN_MOVEMENT_THRESHOLD = 0.1;       // Minimum velocity to trigger facing rotation
    }
    
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION, this.componentTypes.VELOCITY);
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            
            // Get unit size for collision detection
            const unitRadius = this.getUnitRadius(unitType);
            
            // Apply collision avoidance
            const avoidance = this.calculateCollisionAvoidance(entityId, pos, unitRadius, entities);
            
            // Apply avoidance to velocity
            vel.vx += avoidance.x * deltaTime;
            vel.vy += avoidance.y * deltaTime;
            
            // Make unit face movement direction if moving
            if (Math.abs(vel.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(vel.vy) > this.MIN_MOVEMENT_THRESHOLD) {
                this.faceMovementDirection(entityId, vel.vx, vel.vy);
            }
            
            // Update position
            pos.x += vel.vx * deltaTime;
            pos.y += vel.vy * deltaTime;
            
            // Keep units on battlefield
            const canvas = document.getElementById('gameCanvas');
            pos.x = Math.max(unitRadius, Math.min(canvas.width - unitRadius, pos.x));
            pos.y = Math.max(unitRadius, Math.min(canvas.height - unitRadius, pos.y));
        });
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
            
            // Check if units are too close
            const minDistance = unitRadius + otherRadius + this.COLLISION_BUFFER_DISTANCE;
            
            if (distance < avoidanceRadius && distance > 0) {
                // Calculate avoidance force (stronger when closer)
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
        
        return { x: avoidX, y: avoidY };
    }
    
    faceMovementDirection(entityId, vx, vy) {
        // Don't rotate if barely moving
        if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) return;
        
        // Calculate the movement angle
        const angle = Math.atan2(vy, vx);
        
        // Try to update the 3D model rotation if RenderSystem exists
        if (this.game.renderSystem && this.game.renderSystem.entityModels) {
            const modelGroup = this.game.renderSystem.entityModels.get(entityId);
            if (modelGroup) {
                // For 3D models, rotate around Y-axis to face movement direction
                // Add PI/2 to convert from movement direction to facing direction
                modelGroup.rotation.y = -angle + Math.PI / 2;
            }
        }
        
        // Also store the facing direction in a component if it exists
        const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
        if (facing) {
            facing.angle = angle;
            facing.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        }
    }
    
    getUnitRadius(unitType) {
        // Try to get size from unit definition
        if (unitType && unitType.size) {
            return unitType.size / 2;
        }
        
        // Try to get from collections if available
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && unitType) {
            const unitDef = collections.units[unitType.id || unitType.type];
            if (unitDef && unitDef.size) {
                return unitDef.size / 2;
            }
        }
        
        // Default radius
        return this.DEFAULT_UNIT_RADIUS;
    }
}