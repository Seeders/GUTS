class LifetimeSystem extends GUTS.BaseSystem {
    static services = [
        'addLifetime',
        'destroyEntityImmediately',
        'extendLifetime'
    ];

    constructor(game) {
        super(game);
        this.game.lifetimeSystem = this;

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

    init() {
    }

    update() {
        // Only check periodically for performance
        if (this.game.state.now - this.lastCheck < this.CHECK_INTERVAL) return;
        this.lastCheck = this.game.state.now;

        // Get all entities with lifetime components
        const lifetimeEntities = this.game.getEntitiesWith("lifetime");

        lifetimeEntities.forEach(entityId => {
            const lifetime = this.game.getComponent(entityId, "lifetime");
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
        if (this.game.hasComponent(entityId, "projectile")) {
            // Clean up projectile-specific data
            this.game.call('deleteProjectileTrail', entityId);

        }

        // Handle summons
        if (this.game.hasComponent(entityId, "summoned")) {
            this.handleSummonExpiration(entityId);
        }

        // Handle mirror images
        if (this.game.hasComponent(entityId, "mirrorImage")) {
            this.handleMirrorImageExpiration(entityId);
        }

        // Handle traps
        if (this.game.hasComponent(entityId, "trap")) {
            this.handleTrapExpiration(entityId);
        }

        // Handle temporary effects
        if (this.game.hasComponent(entityId, "temporaryEffect")) {
            this.handleTemporaryEffectExpiration(entityId);
        }

        // Handle mind controlled entities
        if (this.game.hasComponent(entityId, "mindControlled")) {
            this.handleMindControlExpiration(entityId);
        }
        
        // Handle thorns effect
        if (this.game.thornsEntities && this.game.thornsEntities.has(entityId)) {
            this.game.thornsEntities.delete(entityId);
        }
    }
    
    handleSummonExpiration(entityId) {
        const transform = this.game.getComponent(entityId, "transform");
        const summonPos = transform?.position;
        if (summonPos) {
            // Create disappearing effect
            this.game.call('createParticleEffect',
                summonPos.x, summonPos.y, summonPos.z,
                'magic',
                { count: 3, color: 0x9370DB, scaleMultiplier: 1.5 }
            );
        }

    }

    handleMirrorImageExpiration(entityId) {
        const transform = this.game.getComponent(entityId, "transform");
        const imagePos = transform?.position;
        if (imagePos) {
            // Create shimmering dissolution effect
            this.game.call('createParticleEffect',
                imagePos.x, imagePos.y, imagePos.z,
                'magic',
                { count: 3, color: 0x6495ED, scaleMultiplier: 1.2 }
            );
        }
    }

    handleTrapExpiration(entityId) {
        const transform = this.game.getComponent(entityId, "transform");
        const trapPos = transform?.position;
        if (trapPos) {
            // Create fizzling effect for expired trap
            this.game.call('createParticleEffect',
                trapPos.x, trapPos.y, trapPos.z,
                'magic',
                { count: 3, color: 0x696969, scaleMultiplier: 0.8 }
            );
        }


    }

    handleTemporaryEffectExpiration(entityId) {
        // For visual effect entities, just let them fade naturally
        const transform = this.game.getComponent(entityId, "transform");
        const effectPos = transform?.position;
        if (effectPos) {
            this.game.call('createParticleEffect',
                effectPos.x, effectPos.y, effectPos.z,
                'magic',
                { count: 3, color: 0xFFFFFF, scaleMultiplier: 0.5 }
            );
        }
    }

    handleMindControlExpiration(entityId) {
        const mindControl = this.game.getComponent(entityId, "mindControlled");
        const targetTeam = this.game.getComponent(entityId, "team");
        const transform = this.game.getComponent(entityId, "transform");
        const targetPos = transform?.position;

        if (mindControl && targetTeam) {
            // Restore original team
            targetTeam.team = mindControl.originalTeam;

            // Clear AI behavior state
            this.game.call('clearBehaviorState', entityId);
            this.game.call('clearEntityPath', entityId);
            
            // Visual effect
            if (targetPos) {
                this.game.call('createParticleEffect',
                    targetPos.x, targetPos.y, targetPos.z,
                    'magic',
                    { count: 3, color: 0xDA70D6, scaleMultiplier: 1.0 }
                );
            }
            
            // Remove mind control component
            this.game.removeComponent(entityId, "mindControlled");


        }
    }

    
    // =============================================
    // DESTRUCTION EFFECTS
    // =============================================
    
    createDestructionEffects(entityId, lifetime) {
        if (!lifetime.destructionEffect) return;

        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
        if (!pos) return;

        const effectConfig = lifetime.destructionEffect;

        // Create particle effect
        this.game.call('createParticleEffect',
            pos.x, pos.y, pos.z,
            effectConfig.type || 'magic',
            {
                count: effectConfig.count || 3,
                color: effectConfig.color || 0xFFFFFF,
                scaleMultiplier: effectConfig.scaleMultiplier || 1.0,
                speedMultiplier: effectConfig.speedMultiplier || 1.0
            }
        );

        // Screen effects if specified
        if (effectConfig.screenShake) {
            this.game.call('playScreenShake',
                effectConfig.screenShake.duration || 0.2,
                effectConfig.screenShake.intensity || 1
            );
        }

        if (effectConfig.screenFlash) {
            this.game.call('playScreenFlash',
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


        this.game.addComponent(entityId, "lifetime", lifetimeData);
        
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
        const lifetime = this.game.getComponent(entityId, "lifetime");
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
        const lifetime = this.game.getComponent(entityId, "lifetime");
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
        const lifetime = this.game.getComponent(entityId, "lifetime");
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
        if (this.game.hasComponent(entityId, "lifetime")) {
            this.game.removeComponent(entityId, "lifetime");
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
        const lifetime = this.game.getComponent(entityId, "lifetime");
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
        return this.game.getEntitiesWith("lifetime");
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
            const lifetime = this.game.getComponent(entityId, "lifetime");
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
