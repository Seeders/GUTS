class AnimationSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.animationSystem = this;

        // Animation state tracking (VAT-only, no mixers)
        this.entityAnimationStates = new Map(); // entityId -> { currentClip, lastStateChange, flags, etc. }
        
        // Animation configuration
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        // Single-play animations (play once then stop/transition)
        this.SINGLE_PLAY_ANIMATIONS = new Set([
            'attack', 'cast', 'death'
        ]);

    }

    init() {
        // Register methods with GameManager
        this.game.gameManager.register('triggerSinglePlayAnimation', this.triggerSinglePlayAnimation.bind(this));
        this.game.gameManager.register('isAnimationFinished', this.isAnimationFinished.bind(this));
        this.game.gameManager.register('setCorpseAnimation', this.setCorpseAnimation.bind(this));
        this.game.gameManager.register('startCelebration', this.startCelebration.bind(this));
        this.game.gameManager.register('stopCelebration', this.stopCelebration.bind(this));
        this.game.gameManager.register('playDeathAnimation', this.playDeathAnimation.bind(this));
        this.game.gameManager.register('getEntityAnimations', () => this.entityAnimationStates);
    }

    update() {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) return;
        this.updateEntityAnimations();
    }

    updateEntityAnimations() {
        const entities = this.game.getEntitiesWith("position", "renderable");

        entities.forEach(entityId => {
            // Only process instanced entities
            if (!this.game.renderSystem?.isInstanced(entityId)) return;

            // Skip static entities (worldObjects, cliffs) that don't have animations
            const unitType = this.game.getComponent(entityId, "unitType");
            if (unitType && (unitType.collection === 'worldObjects' || unitType.collection === 'cliffs')) {
                return;
            }

            const velocity = this.game.getComponent(entityId, "velocity");
            const health = this.game.getComponent(entityId, "health");
            const combat = this.game.getComponent(entityId, "combat");
            const aiState = this.game.getComponent(entityId, "aiState");

            // Ensure entity has animation state
            if (!this.entityAnimationStates.has(entityId)) {
                this.initializeEntityAnimationState(entityId);
            }

            // Update animation logic
            this.updateEntityAnimationLogic(entityId, velocity, health, combat, aiState);
        });

        // Clean up removed entities
        this.cleanupRemovedEntities(new Set(entities));
    }

    initializeEntityAnimationState(entityId) {
        const state = {
            currentClip: 'idle',
            lastStateChange: this.game.state?.now || 0,
            animationTime: 0,
            minAnimationTime: 0,
            pendingClip: null,
            pendingSpeed: null,
            pendingMinTime: null,
            isTriggered: false,
            isDying: false,
            isCorpse: false,
            isCelebrating: false,
            // NEW: Track fallback usage to prevent thrashing
            lastRequestedClip: null,    // What was originally requested
            lastResolvedClip: null,     // What actually got set
            fallbackCooldown: 0         // Time remaining before allowing re-request of failed clip
        };

        this.entityAnimationStates.set(entityId, state);

        // Set initial animation
        this.game.renderSystem?.setInstanceClip(entityId, 'idle', true);
        this.game.renderSystem?.setInstanceSpeed(entityId, 1);

    }

    updateEntityAnimationLogic(entityId, velocity, health, combat, aiState) {
    
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        const currentTime = this.game.state?.now || 0;
        const deltaTime = this.game.state?.deltaTime || 1/60;
        animState.animationTime += deltaTime;

        // NEW: Handle animation completion for locked states
        if (animState.isDying || animState.isCorpse || animState.isCelebrating) {
            // Handle celebration completion ONLY
            if (animState.isCelebrating && this.SINGLE_PLAY_ANIMATIONS.has(animState.currentClip)) {
                const isFinished = this.isAnimationFinished(entityId, animState.currentClip);
                
                if (isFinished) {
                    this.stopCelebration(entityId);
                    return;
                }
            }
            
            return; // Still locked, don't process normal animation logic
        }
        // Handle pending triggered animations (from external calls)
        if (animState.isTriggered && animState.pendingClip) {
            this.applyTriggeredAnimation(entityId, animState);
            return;
        }

        // Determine desired animation based on game state
        const desired = this.determineDesiredAnimation(entityId, velocity, health, combat, aiState);
    
        // Check if we should change animation
        const shouldChange = this.shouldChangeAnimation(entityId, animState, desired, currentTime);
        

        if (shouldChange) {
            this.changeAnimation(entityId, desired.clip, desired.speed, desired.minTime);
        } else {
            // Update animation speed if needed (for continuous animations)
            this.updateAnimationSpeed(entityId, desired.speed);
        }
    }

    determineDesiredAnimation(entityId, velocity, health, combat, aiState) {
        let clip = 'idle';
        let speed = 1.0;
        let minTime = 0;

        if(this.game.state.phase == 'battle'){
            // Check movement first
            const isMoving = velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD);

            if (isMoving) {
                clip = 'walk';
                speed = this.calculateWalkSpeed(velocity);
            }

            // AI action overrides based on currentAction.type
            if (aiState && aiState.currentAction) {
                const actionType = aiState.currentAction.type;

                switch (actionType) {
                    case 'AttackBehaviorAction':
                        // During combat, prefer walking if moving, otherwise idle
                        if (!isMoving) {
                            clip = 'idle';
                            speed = 1.0;
                        }
                        break;

                    case 'MoveBehaviorAction':
                        clip = 'walk';
                        speed = this.calculateWalkSpeed(velocity);
                        break;
                }
            }
        }

        return { clip, speed, minTime };
    }

    shouldChangeAnimation(entityId, animState, desired, currentTime) {
        // 1) If we are in a single-play clip, don't allow state changes until it's finished
        if (this.SINGLE_PLAY_ANIMATIONS.has(animState.currentClip)) {
            const finished = this.isAnimationFinished(entityId, animState.currentClip);

            // Respect explicit minAnimationTime as an additional guard
            const minTimeSatisfied = (animState.minAnimationTime <= 0) || (animState.animationTime >= animState.minAnimationTime);

            // Block changes until BOTH: (a) clip finished OR (b) min time satisfied (use whichever is stricter for your game)
            // If you want strictly "finished", change to: if (!finished) return false;
            if (!finished && !minTimeSatisfied) {
                return false;
            }
            // Once finished (or min time hit), we can flow through to normal logic below.
        }

        // 2) Cooldown: prevent thrashing even for continuous animations
        const timeSinceLastChange = currentTime - animState.lastStateChange;
        if(timeSinceLastChange < 0){
            return true;

        }
        if (timeSinceLastChange < this.STATE_CHANGE_COOLDOWN) {
            return false;
        }

        // 3) If the desired clip differs, allow change (this now runs AFTER the single-play guard)
        if (animState.currentClip !== desired.clip) {
            return true;
        }

        // 4) For single-play, if somehow the clip finished (edge case) allow refresh
        if (this.SINGLE_PLAY_ANIMATIONS.has(animState.currentClip)) {
            if (this.isAnimationFinished(entityId, animState.currentClip)) {
                return true;
            }
        }

        // 5) Respect minAnimationTime for non-single-play too
        if (animState.minAnimationTime > 0 && animState.animationTime < animState.minAnimationTime) {
            return false;
        }

        return false;
    }

    changeAnimation(entityId, clipName, speed = 1.0, minTime = 0) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return false;

        // Try to resolve clip name to available clip
        const resolvedClip = this.resolveClipName(entityId, clipName);
        
        // Apply animation change
        const success = this.game.renderSystem?.setInstanceClip(entityId, resolvedClip, true);
        if (success) {
            this.game.renderSystem?.setInstanceSpeed(entityId, speed);
            
            // Update state
            animState.currentClip = resolvedClip;
            animState.lastStateChange = this.game.state?.now || 0;
            animState.animationTime = 0;
            animState.minAnimationTime = minTime;
            
            return true;
        } else {
            console.warn(`[AnimationSystem] ❌ Failed to change animation for entity ${entityId}: ${clipName} -> ${resolvedClip}`);
        }

        return false;
    }

    updateAnimationSpeed(entityId, targetSpeed) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        // Only update speed for continuous animations
        if (!this.SINGLE_PLAY_ANIMATIONS.has(animState.currentClip)) {
            this.game.renderSystem?.setInstanceSpeed(entityId, targetSpeed);
        }
    }

    applyTriggeredAnimation(entityId, animState) {
        const clip = animState.pendingClip;
        const speed = animState.pendingSpeed || 1.0;
        const minTime = animState.pendingMinTime || 0;

        // Clear pending state
        animState.pendingClip = null;
        animState.pendingSpeed = null;
        animState.pendingMinTime = null;
        animState.isTriggered = false;

        // Apply the animation
        this.changeAnimation(entityId, clip, speed, minTime);
    }

    // Public API methods
    
    triggerSinglePlayAnimation(entityId, clipName, speed = 1.0, minTime = 0) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) {
            console.warn(`[AnimationSystem] No animation state for entity ${entityId}`);
            return false;
        }

        
        // Queue the animation
        animState.pendingClip = clipName;
        animState.pendingSpeed = speed;
        animState.pendingMinTime = minTime;
        animState.isTriggered = true;

        return true;
    }

    playDeathAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) {
            console.warn(`[AnimationSystem] ❌ No animation state found for entity ${entityId} during death`);
            return;
        }

        // Set death state
        animState.isDying = true;
        animState.isCorpse = false;
        animState.isCelebrating = false;
        
        // Clear any pending animations
        animState.isTriggered = false;
        animState.pendingClip = null;
        animState.pendingSpeed = null;
        animState.pendingMinTime = null;
        
        // Reset fallback tracking for death animation
        animState.lastRequestedClip = null;
        animState.lastResolvedClip = null;
        animState.fallbackCooldown = 0;
        
        // Apply death animation immediately
        this.changeAnimation(entityId, 'death', 1.0, 0);
        
    }

    setCorpseAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        // Update animation state flags
        animState.isDying = false;
        animState.isCorpse = true;
        
        // Get the current clip's duration and set to last frame
        const animationStateData = this.game.gameManager.call('getEntityAnimationState', entityId);
        
        if (animationStateData && animationStateData.clipDuration > 0) {
            // Set to 99% through the animation (last frame before loop)
            const lastFrameTime = animationStateData.clipDuration * 0.99;
            this.game.gameManager.call('setInstanceAnimationTime', entityId, lastFrameTime);
        }
        
        // Now freeze it at that frame
        this.game.gameManager.call('setInstanceSpeed', entityId, 0);
    }

    startCelebration(entityId, teamType = null) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isCelebrating = true;
        
        // Try celebration animations, fallback to idle
        const celebrationClips = ['celebrate'];
        let clipToUse = 'idle';
        
        for (const clip of celebrationClips) {
            if (this.hasClip(entityId, clip)) {
                clipToUse = clip;
                break;
            }
        }

        this.changeAnimation(entityId, clipToUse, 1.0, 0);
    }

    stopCelebration(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isCelebrating = false;
        this.changeAnimation(entityId, 'idle', 1.0, 0);
    }

    entityJump(entityId, speed = 1.0) {
        if (this.hasClip(entityId, 'leap')) {
            this.triggerSinglePlayAnimation(entityId, 'leap', speed, 0.5);
        }
    }

    entityThrow(entityId, speed = 1.0) {
        if (this.hasClip(entityId, 'throw')) {
            this.triggerSinglePlayAnimation(entityId, 'throw', speed, 0.3);
        }
    }

    stopAllAnimations(entityId) {
        this.game.renderSystem?.setInstanceSpeed(entityId, 0);
    }

    // Utility methods

    calculateWalkSpeed(velocity) {
        if (!velocity) return 1.0;
        const speed = Math.sqrt((velocity.vx || 0) ** 2 + (velocity.vz || 0) ** 2);
        return Math.min(2.0, Math.max(0.5, speed / 30)); // Adjust divisor based on your units
    }

    isAnimationFinished(entityId, clipName) {
        if (!this.SINGLE_PLAY_ANIMATIONS.has(clipName)) {
            return false; // Continuous animations never finish
        }

        const animationState = this.game.gameManager.call('getEntityAnimationState', entityId);
        if (!animationState) {
            return true;
        }

        // Check if we've played through most of the clip
        const progress = animationState.animTime / animationState.clipDuration;
        const isFinished = progress >= 0.9; // Consider finished at 90%
        
        return isFinished;
    }

    hasClip(entityId, clipName) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return false;

        const batchInfo = this.game.gameManager.call('getBatchInfo', renderable.objectType, renderable.spawnType);
        return batchInfo?.availableClips?.includes(clipName) || false;
    }

    resolveClipName(entityId, desiredClip) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return 'idle';

        const batchInfo = this.game.gameManager.call('getBatchInfo', renderable.objectType, renderable.spawnType);
        if (!batchInfo) return 'idle';

        const availableClips = batchInfo.availableClips;

        // Return if exact match exists
        if (availableClips.includes(desiredClip)) {
            return desiredClip;
        }

        // Try fallbacks
        const fallbacks = {
            'attack': ['combat', 'fight', 'swing', 'strike', 'idle'],
            'shoot': ['bow', 'cast', 'throw', 'attack', 'idle'],
            'bow': ['shoot', 'cast', 'throw', 'attack', 'idle'],
            'cast': ['shoot', 'throw', 'attack', 'idle'],
            'walk': ['run', 'move', 'step', 'idle'],
            'hurt': ['damage', 'hit', 'pain', 'idle'],
            'death': ['die', 'idle'],
            'celebrate': ['victory', 'cheer', 'dance', 'happy', 'win', 'idle']
        };

        const fallbackList = fallbacks[desiredClip] || ['idle'];
        for (const fallback of fallbackList) {
            if (availableClips.includes(fallback)) {
                return fallback;
            }
        }

        // Final fallback
        return availableClips[0] || 'idle';
    }

    // Cleanup methods

    cleanupRemovedEntities(currentEntities) {
        const toRemove = [];
        
        for (const entityId of this.entityAnimationStates.keys()) {
            if (!currentEntities.has(entityId)) {
                toRemove.push(entityId);
            }
        }

        toRemove.forEach(entityId => {
            this.removeEntityAnimations(entityId);
        });
    }

    entityDestroyed(entityId){
        this.removeEntityAnimations(entityId);
    }
    removeEntityAnimations(entityId) {
        this.entityAnimationStates.delete(entityId);        
    }

    destroy() {
        this.entityAnimationStates.clear();
    }

}