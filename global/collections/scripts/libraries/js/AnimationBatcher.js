/**
 * AnimationBatcher - Efficient batching for animation system updates
 *
 * Optimizations:
 * 1. Time-based batching: Only updates animation frames at the sprite's actual fps rate
 * 2. Visibility culling: Skips updates for entities outside visible/explored areas
 * 3. Camera direction caching: Only recalculates sprite directions when camera moves
 * 4. Dirty tracking: Only processes entities that actually need updates
 */
class AnimationBatcher {
    constructor(game) {
        this.game = game;

        // Time accumulation for frame-rate independent updates
        this._frameAccumulators = new Map();  // entityId -> accumulated time

        // Visibility cache
        this._visibilityCache = new Map();    // entityId -> { visible: bool, exploredOnly: bool, lastCheck: frame }
        this._visibilityCacheFrameInterval = 10;  // Re-check visibility every N frames
        this._currentFrame = 0;

        // Camera direction caching for sprite direction updates
        this._lastCameraPosition = { x: 0, y: 0, z: 0 };
        this._lastCameraRotation = 0;
        this._cameraMoveThreshold = 1;        // Minimum camera movement to trigger direction recalc
        this._cameraRotateThreshold = 0.01;   // Minimum camera rotation to trigger direction recalc
        this._cameraHasMoved = true;          // Force initial calculation

        // Entity tracking
        this._animatedEntities = new Set();   // Entities with sprite animations
        this._dirtyEntities = new Set();      // Entities needing frame updates this tick

        // Performance stats
        this._stats = {
            totalEntities: 0,
            visibleEntities: 0,
            updatedEntities: 0,
            skippedByVisibility: 0,
            skippedByTiming: 0
        };
    }

    /**
     * Register an entity for animation batching
     */
    registerEntity(entityId) {
        this._animatedEntities.add(entityId);
        this._frameAccumulators.set(entityId, 0);
        // Mark as dirty to ensure initial frame is set
        this._dirtyEntities.add(entityId);
    }

    /**
     * Unregister an entity from animation batching
     */
    unregisterEntity(entityId) {
        this._animatedEntities.delete(entityId);
        this._frameAccumulators.delete(entityId);
        this._visibilityCache.delete(entityId);
        this._dirtyEntities.delete(entityId);
    }

    /**
     * Check if camera has moved enough to require sprite direction updates
     */
    _checkCameraMovement() {
        const cam = this.game.call('getCamera') || this.game.camera;
        if (!cam) {
            this._cameraHasMoved = false;
            return;
        }

        const dx = cam.position.x - this._lastCameraPosition.x;
        const dy = cam.position.y - this._lastCameraPosition.y;
        const dz = cam.position.z - this._lastCameraPosition.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        // Also check rotation changes
        const rotationY = cam.rotation?.y || 0;
        const rotationDiff = Math.abs(rotationY - this._lastCameraRotation);

        if (distSq > this._cameraMoveThreshold * this._cameraMoveThreshold ||
            rotationDiff > this._cameraRotateThreshold) {
            this._cameraHasMoved = true;
            this._lastCameraPosition.x = cam.position.x;
            this._lastCameraPosition.y = cam.position.y;
            this._lastCameraPosition.z = cam.position.z;
            this._lastCameraRotation = rotationY;
        } else {
            this._cameraHasMoved = false;
        }
    }

    /**
     * Check if an entity is visible (in fog of war visible area or explored)
     * Uses cached values to avoid expensive fog checks every frame
     */
    isEntityVisible(entityId) {
        const cached = this._visibilityCache.get(entityId);

        // Return cached value if still valid
        if (cached && (this._currentFrame - cached.lastCheck) < this._visibilityCacheFrameInterval) {
            return cached.visible || cached.exploredOnly;
        }

        // Get entity position
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) {
            // No position - assume visible (don't skip)
            return true;
        }

        const pos = transform.position;

        // Check fog of war visibility
        const fogSystem = this.game.fogOfWarSystem;
        let visible = true;
        let exploredOnly = false;

        if (fogSystem) {
            visible = fogSystem.isVisibleAt(pos.x, pos.z);
            if (!visible) {
                exploredOnly = fogSystem.isExploredAt(pos.x, pos.z);
            }
        }

        // Cache the result
        this._visibilityCache.set(entityId, {
            visible,
            exploredOnly,
            lastCheck: this._currentFrame
        });

        // Return true if fully visible, or explored (for minimal updates)
        return visible || exploredOnly;
    }

    /**
     * Check if entity needs animation frame update based on timing
     * Returns true if enough time has passed for the next frame
     */
    needsFrameUpdate(entityId, animState, deltaTime) {
        if (!animState) return false;

        // Get frame rate for this animation type
        const entityRenderer = this.game.call('getEntityRenderer');
        const frameRates = entityRenderer?.spriteAnimationFrameRates || {};
        const defaultFrameRate = entityRenderer?.defaultFrameRate || 10;
        const fps = animState.spriteFps || frameRates[animState.spriteAnimationType] || defaultFrameRate;

        // Calculate frame duration
        let frameDuration = 1 / fps;

        // Custom duration override (for abilities with specific timing)
        if (animState.customDuration !== null && animState.customDuration > 0) {
            const animations = animState.spriteAnimations?.[animState.spriteAnimationType];
            const directionData = animations?.[animState.spriteDirection];
            const frameCount = directionData?.frames?.length || 1;
            frameDuration = animState.customDuration / frameCount;
        }

        // Accumulate time
        let accumulated = this._frameAccumulators.get(entityId) || 0;
        accumulated += deltaTime;
        this._frameAccumulators.set(entityId, accumulated);

        // Check if we've accumulated enough time for a frame
        return accumulated >= frameDuration;
    }

    /**
     * Mark that a frame update was processed for an entity
     */
    consumeFrameTime(entityId, frameDuration) {
        let accumulated = this._frameAccumulators.get(entityId) || 0;
        // Subtract frame duration (keep remainder for smooth timing)
        accumulated -= frameDuration;
        // Clamp to prevent accumulation if we fall behind
        accumulated = Math.max(0, Math.min(accumulated, frameDuration * 2));
        this._frameAccumulators.set(entityId, accumulated);
    }

    /**
     * Get entities that need animation updates this frame
     * Filters by visibility and timing
     */
    getEntitiesToUpdate(deltaTime) {
        this._currentFrame++;
        this._checkCameraMovement();

        const entitiesToUpdate = [];
        const entitiesForDirectionUpdate = [];

        // Reset stats
        this._stats.totalEntities = this._animatedEntities.size;
        this._stats.visibleEntities = 0;
        this._stats.updatedEntities = 0;
        this._stats.skippedByVisibility = 0;
        this._stats.skippedByTiming = 0;

        for (const entityId of this._animatedEntities) {
            const animState = this.game.getComponent(entityId, 'animationState');
            if (!animState || !animState.isSprite) continue;

            // Check visibility
            const isVisible = this.isEntityVisible(entityId);
            const cachedVis = this._visibilityCache.get(entityId);

            if (!isVisible) {
                this._stats.skippedByVisibility++;
                continue;
            }

            this._stats.visibleEntities++;

            // For fully visible entities, update both frame and direction
            // For explored-only entities, update direction only (so corpses face correctly)
            if (cachedVis?.visible) {
                // Check if needs frame update based on timing
                if (this.needsFrameUpdate(entityId, animState, deltaTime)) {
                    entitiesToUpdate.push(entityId);
                    this._stats.updatedEntities++;
                } else {
                    this._stats.skippedByTiming++;
                }
            }

            // Direction updates only needed when camera moves
            if (this._cameraHasMoved) {
                entitiesForDirectionUpdate.push(entityId);
            }
        }

        return {
            frameUpdates: entitiesToUpdate,
            directionUpdates: entitiesForDirectionUpdate,
            cameraHasMoved: this._cameraHasMoved
        };
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return { ...this._stats };
    }

    /**
     * Force visibility cache refresh for all entities
     */
    invalidateVisibilityCache() {
        this._visibilityCache.clear();
    }

    /**
     * Force visibility cache refresh for specific entity
     */
    invalidateEntityVisibility(entityId) {
        this._visibilityCache.delete(entityId);
    }

    /**
     * Cleanup
     */
    dispose() {
        this._frameAccumulators.clear();
        this._visibilityCache.clear();
        this._animatedEntities.clear();
        this._dirtyEntities.clear();
    }
}
