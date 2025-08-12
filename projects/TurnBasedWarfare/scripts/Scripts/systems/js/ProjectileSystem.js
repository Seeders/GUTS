class ProjectileSystem {
    constructor(game) {
        this.game = game;
        this.game.projectileSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration
        this.GRAVITY = 0; // Set to positive value for arcing projectiles
        this.HIT_DETECTION_RADIUS = 5;
        this.TRAIL_UPDATE_INTERVAL = 0.05;
        
        // Trail tracking for visual effects
        this.projectileTrails = new Map();
    }
    
    fireProjectile(sourceId, targetId, projectileData = {}) {
        const sourcePos = this.game.getComponent(sourceId, this.componentTypes.POSITION);
        const sourceCombat = this.game.getComponent(sourceId, this.componentTypes.COMBAT);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        
        if (!sourcePos || !sourceCombat || !targetPos) return null;
        
        // Create projectile entity
        const projectileId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        const now = Date.now() / 1000;
        
        // Calculate initial direction and velocity
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const projectileSpeed = projectileData.speed || 200;
        const initialVx = distance > 0 ? (dx / distance) * projectileSpeed : 0;
        const initialVy = distance > 0 ? (dy / distance) * projectileSpeed : 0;
        
        console.log('fire projectile', projectileData, sourcePos, initialVx, initialVy, projectileSpeed);
        // Add components
        this.game.addComponent(projectileId, this.componentTypes.POSITION, 
            components.Position(sourcePos.x, sourcePos.y));
        
        this.game.addComponent(projectileId, this.componentTypes.VELOCITY, 
            components.Velocity(initialVx, initialVy, projectileSpeed));
        
        this.game.addComponent(projectileId, this.componentTypes.PROJECTILE, {
            damage: sourceCombat.damage,
            speed: projectileSpeed,
            range: sourceCombat.range * 1.5, // Projectiles can travel a bit further
            target: targetId,
            source: sourceId,
            startTime: now,
            startX: sourcePos.x,
            startY: sourcePos.y
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
        this.game.addComponent(projectileId, this.componentTypes.RENDERABLE, components.Renderable("projectiles", projectileData.id));
        
        // Lifetime component
        this.game.addComponent(projectileId, this.componentTypes.LIFETIME, 
            components.Lifetime(10, now)); // 10 second max lifetime
        
        // Homing component if specified
        if (projectileData.homing && projectileData.homingStrength > 0) {
            this.game.addComponent(projectileId, this.componentTypes.HOMING_TARGET, 
                components.HomingTarget(targetId, projectileData.homingStrength, { x: targetPos.x, y: targetPos.y }));
        }
        
        return projectileId;
    }
    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        
        const projectiles = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.VELOCITY, 
            this.componentTypes.PROJECTILE
        );
        
        const now = Date.now() / 1000;
        
        projectiles.forEach(projectileId => {
            const pos = this.game.getComponent(projectileId, this.componentTypes.POSITION);
            const vel = this.game.getComponent(projectileId, this.componentTypes.VELOCITY);
            const projectile = this.game.getComponent(projectileId, this.componentTypes.PROJECTILE);
            const lifetime = this.game.getComponent(projectileId, this.componentTypes.LIFETIME);
            const homing = this.game.getComponent(projectileId, this.componentTypes.HOMING_TARGET);
            
            // Check lifetime expiration
            if (lifetime && (now - lifetime.startTime) > lifetime.duration) {
                this.destroyProjectile(projectileId);
                return;
            }
            
            // Check range limit
            const distanceTraveled = Math.sqrt(
                Math.pow(pos.x - projectile.startX, 2) + 
                Math.pow(pos.y - projectile.startY, 2)
            );
            if (distanceTraveled > projectile.range) {
                this.destroyProjectile(projectileId);
                return;
            }
            
            // Update homing behavior
            if (homing && homing.targetId) {
                this.updateHomingProjectile(projectileId, pos, vel, projectile, homing, deltaTime);
            }
            
            // Apply gravity if configured
            if (this.GRAVITY > 0) {
                vel.vy += this.GRAVITY * deltaTime;
            }
            
            // Update position
            pos.x += vel.vx * deltaTime;
            pos.y += vel.vy * deltaTime;
            
            // Check for collisions with targets
            this.checkProjectileCollisions(projectileId, pos, projectile);
            
            // Update visual trail
            this.updateProjectileTrail(projectileId, pos);
        });
    }
    
    updateHomingProjectile(projectileId, pos, vel, projectile, homing, deltaTime) {
        // Get current target position
        const targetPos = this.game.getComponent(homing.targetId, this.componentTypes.POSITION);
        
        if (targetPos) {
            // Update last known position
            homing.lastKnownPosition = { x: targetPos.x, y: targetPos.y };
            
            // Calculate direction to target
            const dx = targetPos.x - pos.x;
            const dy = targetPos.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                // Calculate desired velocity direction
                const desiredVx = (dx / distance) * projectile.speed;
                const desiredVy = (dy / distance) * projectile.speed;
                
                // Blend current velocity with desired velocity based on homing strength
                const homingStrength = homing.homingStrength * deltaTime * 5; // Adjust responsiveness
                vel.vx = vel.vx * (1 - homingStrength) + desiredVx * homingStrength;
                vel.vy = vel.vy * (1 - homingStrength) + desiredVy * homingStrength;
                
                // Maintain speed
                const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
                if (currentSpeed > 0) {
                    const speedRatio = projectile.speed / currentSpeed;
                    vel.vx *= speedRatio;
                    vel.vy *= speedRatio;
                }
            }
        } else if (homing.lastKnownPosition) {
            // Target is gone, continue toward last known position
            const dx = homing.lastKnownPosition.x - pos.x;
            const dy = homing.lastKnownPosition.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 10) {
                // Close enough to last known position, destroy projectile
                this.destroyProjectile(projectileId);
                return;
            }
        } else {
            // No target and no last known position, continue straight
            homing.targetId = null;
        }
    }
    
    checkProjectileCollisions(projectileId, pos, projectile) {
        // Get all potential targets
        const allEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        );
        
        const sourceTeam = this.game.getComponent(projectile.source, this.componentTypes.TEAM);
        if (!sourceTeam) return;
        
        allEntities.forEach(entityId => {
            if (entityId === projectile.source) return; // Don't hit the source
            
            const entityPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const entityTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const entityHealth = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            if (!entityPos || !entityTeam || !entityHealth) return;
            if (entityTeam.team === sourceTeam.team) return; // Don't hit allies
            
            // Calculate distance
            const dx = entityPos.x - pos.x;
            const dy = entityPos.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Get entity radius for collision detection
            const entityUnitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const entityRadius = this.getUnitRadius(entityUnitType);
            
            if (distance <= entityRadius + this.HIT_DETECTION_RADIUS) {
                // Hit detected!
                this.handleProjectileHit(projectileId, entityId, projectile);
                return;
            }
        });
    }
    
    handleProjectileHit(projectileId, targetId, projectile) {
        // Apply damage
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        if (targetHealth) {
            targetHealth.current -= projectile.damage;
            
            // Visual feedback
            const targetAnimation = this.game.getComponent(targetId, this.componentTypes.ANIMATION);
            if (targetAnimation) {
                targetAnimation.flash = 0.5;
            }
            
            // Logging
            if (this.game.battleLogSystem) {
                const sourceUnitType = this.game.getComponent(projectile.source, this.componentTypes.UNIT_TYPE);
                const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
                const sourceTeam = this.game.getComponent(projectile.source, this.componentTypes.TEAM);
                const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
                
                this.game.battleLogSystem.add(
                    `${sourceTeam.team} ${sourceUnitType.type} projectile hits ${targetTeam.team} ${targetUnitType.type} for ${projectile.damage} damage`, 
                    'log-damage'
                );
            }
            
            // Check if target is killed
            if (targetHealth.current <= 0) {
                if (this.game.battleLogSystem) {
                    const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
                    const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
                    this.game.battleLogSystem.add(`${targetTeam.team} ${targetUnitType.type} defeated by projectile!`, 'log-death');
                }
                this.game.destroyEntity(targetId);
                this.game.combatAISystems?.checkBattleEnd();
            }
        }
        
        // Create hit effect
        this.createHitEffect(projectileId, targetId);
        
        // Destroy projectile
        this.destroyProjectile(projectileId);
    }
    
    createHitEffect(projectileId, targetId) {
        const projectilePos = this.game.getComponent(projectileId, this.componentTypes.POSITION);
        const projectileVisual = this.game.getComponent(projectileId, this.componentTypes.PROJECTILE_VISUAL);
        
        if (!projectilePos) return;
        
        // Create a temporary visual effect entity
        const effectId = this.game.createEntity();
        const components = this.game.componentManager.getComponents();
        
        // Position at hit location
        this.game.addComponent(effectId, this.componentTypes.POSITION, 
            components.Position(projectilePos.x, projectilePos.y));
        
        // Visual component for the effect
        const effectColor = projectileVisual?.color || '#ffaa00';
        this.game.addComponent(effectId, this.componentTypes.RENDERABLE, 
            components.Renderable(effectColor, 8, 'explosion'));
        
        // Short lifetime
        this.game.addComponent(effectId, this.componentTypes.LIFETIME, 
            components.Lifetime(0.3, Date.now() / 1000));
        
        // Animation for the effect
        this.game.addComponent(effectId, this.componentTypes.ANIMATION, 
            components.Animation(2, 0, 1)); // Scale 2x, flash
    }
    
    updateProjectileTrail(projectileId, pos) {
        const projectileVisual = this.game.getComponent(projectileId, this.componentTypes.PROJECTILE_VISUAL);
        if (!projectileVisual || projectileVisual.trailLength <= 0) return;
        
        if (!this.projectileTrails.has(projectileId)) {
            this.projectileTrails.set(projectileId, []);
        }
        
        const trail = this.projectileTrails.get(projectileId);
        
        // Add current position to trail
        trail.push({ x: pos.x, y: pos.y, time: Date.now() / 1000 });
        
        // Remove old trail points
        while (trail.length > projectileVisual.trailLength) {
            trail.shift();
        }
    }
    
    
    destroyProjectile(projectileId) {
        // Clean up trail data
        this.projectileTrails.delete(projectileId);
        
        // Destroy the entity
        this.game.destroyEntity(projectileId);
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
}
