class LifetimeSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.lifetimeSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Configuration
        this.CHECK_INTERVAL = 0.1; // Check lifetimes every 100ms for performance
        this.lastCheck = 0;
        
        // Track entities with custom destruction callbacks
        this.destructionCallbacks = new Map(); // entityId -> callback function
        
        // Track entities that should fade out before destruction
        this.fadeOutEntities = new Map(); // entityId -> fade data
        
        // Statistics
        this.stats = {
            entitiesDestroyed: 0,
            entitiesExpired: 0,
            entitiesFaded: 0
        };
    }
    
    update() {        
        // Only check periodically for performance
        if (this.game.state.now - this.lastCheck < this.CHECK_INTERVAL) return;
        this.lastCheck = this.game.state.now;
        
        // Get all entities with lifetime components
        const lifetimeEntities = this.game.getEntitiesWith(this.componentTypes.LIFETIME);
        
        lifetimeEntities.forEach(entityId => {
            const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
            if (!lifetime) return;
            
            const age = (this.game.state.now - lifetime.startTime);
            
            // Check if entity has expired
            if (age >= lifetime.duration) {
                this.handleExpiredEntity(entityId, lifetime);
            } 
        });
    }
    
    // =============================================
    // ENTITY EXPIRATION HANDLING
    // =============================================
    
    handleExpiredEntity(entityId, lifetime) {
        // Call custom destruction callback if registered
        const callback = this.destructionCallbacks.get(entityId);
        if (callback) {
            try {
                callback(entityId, lifetime);
            } catch (error) {
                console.warn(`Lifetime destruction callback error for entity ${entityId}:`, error);
            }
            this.destructionCallbacks.delete(entityId);
        }
        
        // Special handling for different entity types
        this.handleSpecialEntityTypes(entityId, lifetime);
        
        // Create destruction effects if specified
        this.createDestructionEffects(entityId, lifetime);
        
        // Log destruction if enabled
        this.logEntityDestruction(entityId, lifetime);
        
        // Remove from fade tracking
        this.fadeOutEntities.delete(entityId);
        
        // Destroy the entity
        this.game.destroyEntity(entityId);
        
        // Update statistics
        this.stats.entitiesDestroyed++;
        this.stats.entitiesExpired++;
    }
    
    handleSpecialEntityTypes(entityId, lifetime) {
        // Handle projectiles
        if (this.game.hasComponent(entityId, this.componentTypes.PROJECTILE)) {
            // Clean up projectile-specific data
            if (this.game.projectileSystem && this.game.projectileSystem.projectileTrails) {
                this.game.projectileSystem.projectileTrails.delete(entityId);
            }
        }
        
        // Handle summons
        if (this.game.hasComponent(entityId, this.componentTypes.SUMMONED)) {
            this.handleSummonExpiration(entityId);
        }
        
        // Handle mirror images
        if (this.game.hasComponent(entityId, this.componentTypes.MIRROR_IMAGE)) {
            this.handleMirrorImageExpiration(entityId);
        }
        
        // Handle traps
        if (this.game.hasComponent(entityId, this.componentTypes.TRAP)) {
            this.handleTrapExpiration(entityId);
        }
        
        // Handle temporary effects
        if (this.game.hasComponent(entityId, this.componentTypes.TEMPORARY_EFFECT)) {
            this.handleTemporaryEffectExpiration(entityId);
        }
        
        // Handle mind controlled entities
        if (this.game.hasComponent(entityId, this.componentTypes.MIND_CONTROLLED)) {
            this.handleMindControlExpiration(entityId);
        }
        
        // Handle thorns effect
        if (this.game.thornsEntities && this.game.thornsEntities.has(entityId)) {
            this.game.thornsEntities.delete(entityId);
        }
    }
    
    handleSummonExpiration(entityId) {
        const summonPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (summonPos && this.game.effectsSystem) {
            // Create disappearing effect
            this.game.effectsSystem.createParticleEffect(
                summonPos.x, summonPos.y, summonPos.z, 
                'magic', 
                { count: 20, color: 0x9370DB, scaleMultiplier: 1.5 }
            );
        }
        
        if (this.game.battleLogSystem) {
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            if (unitType) {
                this.game.battleLogSystem.add(
                    `${unitType.title || unitType.type} fades back to its realm`,
                    'log-summon'
                );
            }
        }
    }
    
    handleMirrorImageExpiration(entityId) {
        const imagePos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (imagePos && this.game.effectsSystem) {
            // Create shimmering dissolution effect
            this.game.effectsSystem.createParticleEffect(
                imagePos.x, imagePos.y, imagePos.z, 
                'magic', 
                { count: 15, color: 0x6495ED, scaleMultiplier: 1.2 }
            );
        }
    }
    
    handleTrapExpiration(entityId) {
        const trapPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (trapPos && this.game.effectsSystem) {
            // Create fizzling effect for expired trap
            this.game.effectsSystem.createParticleEffect(
                trapPos.x, trapPos.y, trapPos.z, 
                'magic', 
                { count: 10, color: 0x696969, scaleMultiplier: 0.8 }
            );
        }
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                'An unused trap crumbles away',
                'log-trap'
            );
        }
    }
    
    handleTemporaryEffectExpiration(entityId) {
        // For visual effect entities, just let them fade naturally
        const effectPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (effectPos && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                effectPos.x, effectPos.y, effectPos.z, 
                'magic', 
                { count: 5, color: 0xFFFFFF, scaleMultiplier: 0.5 }
            );
        }
    }
    
    handleMindControlExpiration(entityId) {
        const mindControl = this.game.getComponent(entityId, this.componentTypes.MIND_CONTROLLED);
        const targetTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
        const targetPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        
        if (mindControl && targetTeam) {
            // Restore original team
            targetTeam.team = mindControl.originalTeam;
            
            // Clear AI target
            const targetAI = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
            if (targetAI && targetAI.aiBehavior) {
                targetAI.aiBehavior.currentTarget = null;
                targetAI.aiBehavior.targetPosition = null;
            }
            
            // Visual effect
            if (targetPos && this.game.effectsSystem) {
                this.game.effectsSystem.createParticleEffect(
                    targetPos.x, targetPos.y, targetPos.z, 
                    'magic', 
                    { count: 15, color: 0xDA70D6, scaleMultiplier: 1.0 }
                );
            }
            
            // Remove mind control component
            this.game.removeComponent(entityId, this.componentTypes.MIND_CONTROLLED);
            
            if (this.game.battleLogSystem) {
                const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
                if (unitType) {
                    this.game.battleLogSystem.add(
                        `${unitType.title || unitType.type} breaks free from mind control!`,
                        'log-control'
                    );
                }
            }
        }
    }

    
    // =============================================
    // DESTRUCTION EFFECTS
    // =============================================
    
    createDestructionEffects(entityId, lifetime) {
        if (!lifetime.destructionEffect) return;
        
        const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (!pos || !this.game.effectsSystem) return;
        
        const effectConfig = lifetime.destructionEffect;
        
        // Create particle effect
        this.game.effectsSystem.createParticleEffect(
            pos.x, pos.y, pos.z,
            effectConfig.type || 'magic',
            {
                count: effectConfig.count || 10,
                color: effectConfig.color || 0xFFFFFF,
                scaleMultiplier: effectConfig.scaleMultiplier || 1.0,
                speedMultiplier: effectConfig.speedMultiplier || 1.0
            }
        );
        
        // Screen effects if specified
        if (effectConfig.screenShake) {
            this.game.effectsSystem.playScreenShake(
                effectConfig.screenShake.duration || 0.2,
                effectConfig.screenShake.intensity || 1
            );
        }
        
        if (effectConfig.screenFlash) {
            this.game.effectsSystem.playScreenFlash(
                effectConfig.screenFlash.color || '#FFFFFF',
                effectConfig.screenFlash.duration || 0.2
            );
        }
    }
    
    // =============================================
    // PUBLIC API METHODS
    // =============================================
    
    /**
     * Add a lifetime component to an entity
     * @param {number} entityId - Entity to add lifetime to
     * @param {number} duration - Duration in seconds
     * @param {Object} options - Additional options
     */
    addLifetime(entityId, duration, options = {}) {
        
        const lifetimeData = {
            duration: duration,
            startTime: this.game.state.now,
            fadeOutDuration: options.fadeOutDuration || 0,
            destructionEffect: options.destructionEffect || null,
            onDestroy: options.onDestroy || null
        };
        
        this.game.addComponent(entityId, this.componentTypes.LIFETIME, lifetimeData);
        
        // Register destruction callback if provided
        if (options.onDestroy && typeof options.onDestroy === 'function') {
            this.destructionCallbacks.set(entityId, options.onDestroy);
        }
        
        return entityId;
    }
    
    /**
     * Extend the lifetime of an entity
     * @param {number} entityId - Entity to extend
     * @param {number} additionalDuration - Additional time in seconds
     */
    extendLifetime(entityId, additionalDuration) {
        const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
        if (lifetime) {
            lifetime.duration += additionalDuration;
            return true;
        }
        return false;
    }
    
    /**
     * Reduce the lifetime of an entity
     * @param {number} entityId - Entity to reduce
     * @param {number} reductionAmount - Time to reduce in seconds
     */
    reduceLifetime(entityId, reductionAmount) {
        const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
        if (lifetime) {
            lifetime.duration = Math.max(0, lifetime.duration - reductionAmount);
            return true;
        }
        return false;
    }
    
    /**
     * Get remaining lifetime of an entity
     * @param {number} entityId - Entity to check
     * @returns {number} Remaining time in seconds, or -1 if no lifetime component
     */
    getRemainingLifetime(entityId) {
        const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
        if (lifetime) {
            const age = (this.game.state.now - lifetime.startTime);
            return Math.max(0, (lifetime.duration) - age);
        }
        return -1;
    }
    
    /**
     * Check if an entity will expire soon
     * @param {number} entityId - Entity to check
     * @param {number} threshold - Time threshold in seconds
     * @returns {boolean} True if entity will expire within threshold
     */
    willExpireSoon(entityId, threshold = 5.0) {
        const remaining = this.getRemainingLifetime(entityId);
        return remaining >= 0 && remaining <= threshold;
    }
    
    /**
     * Remove lifetime component from an entity (makes it permanent)
     * @param {number} entityId - Entity to make permanent
     */
    makeEntityPermanent(entityId) {
        if (this.game.hasComponent(entityId, this.componentTypes.LIFETIME)) {
            this.game.removeComponent(entityId, this.componentTypes.LIFETIME);
            this.destructionCallbacks.delete(entityId);
            this.fadeOutEntities.delete(entityId);
            return true;
        }
        return false;
    }
    
    /**
     * Force immediate destruction of an entity with lifetime
     * @param {number} entityId - Entity to destroy
     * @param {boolean} triggerEffects - Whether to trigger destruction effects
     */
    destroyEntityImmediately(entityId, triggerEffects = true) {
        const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
        if (lifetime) {
            if (triggerEffects) {
                this.handleExpiredEntity(entityId, lifetime);
            } else {
                this.destructionCallbacks.delete(entityId);
                this.fadeOutEntities.delete(entityId);
                this.game.destroyEntity(entityId);
                this.stats.entitiesDestroyed++;
            }
            return true;
        }
        return false;
    }
    
    /**
     * Register a custom destruction callback for an entity
     * @param {number} entityId - Entity to register callback for
     * @param {Function} callback - Function to call on destruction
     */
    registerDestructionCallback(entityId, callback) {
        if (typeof callback === 'function') {
            this.destructionCallbacks.set(entityId, callback);
        }
    }
    
    /**
     * Get all entities with lifetime components
     * @returns {Array} Array of entity IDs
     */
    getAllLifetimeEntities() {
        return this.game.getEntitiesWith(this.componentTypes.LIFETIME);
    }
    
    /**
     * Get entities that will expire within a time threshold
     * @param {number} threshold - Time threshold in seconds
     * @returns {Array} Array of entity IDs
     */
    getExpiringEntities(threshold = 5.0) {
        const expiringEntities = [];
        
        const lifetimeEntities = this.getAllLifetimeEntities();
        
        lifetimeEntities.forEach(entityId => {
            const lifetime = this.game.getComponent(entityId, this.componentTypes.LIFETIME);
            if (lifetime) {
                const age = (this.game.state.now - lifetime.startTime);
                const remaining = lifetime.duration - age;
                
                if (remaining <= threshold && remaining > 0) {
                    expiringEntities.push(entityId);
                }
            }
        });
        
        return expiringEntities;
    }
    
    // =============================================
    // LOGGING AND STATISTICS
    // =============================================
    
    logEntityDestruction(entityId, lifetime) {
        if (!this.game.battleLogSystem || !lifetime.logDestruction) return;
        
        const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        if (unitType) {
            const age = ((this.game.state.now || 0)) - lifetime.startTime;
            this.game.battleLogSystem.add(
                `${unitType.title || unitType.type} expires after ${age.toFixed(1)} seconds`,
                'log-lifetime'
            );
        }
    }
    
    getStatistics() {
        return { ...this.stats };
    }
    
    resetStatistics() {
        this.stats.entitiesDestroyed = 0;
        this.stats.entitiesExpired = 0;
        this.stats.entitiesFaded = 0;
    }
    
    // =============================================
    // SYSTEM MANAGEMENT
    // =============================================
    
    destroy() {
        // Clean up all tracking maps
        this.destructionCallbacks.clear();
        this.fadeOutEntities.clear();
        this.resetStatistics();
    }
}