class AnimationSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.animationSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Animation state tracking (VAT-only, no mixers)
        this.entityAnimationStates = new Map(); // entityId -> { currentClip, lastStateChange, flags, etc. }
        
        // Animation configuration
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        // Single-play animations (play once then stop/transition)
        this.SINGLE_PLAY_ANIMATIONS = new Set([
            'attack', 'combat', 'fight', 'swing', 'strike',
            'shoot', 'bow', 'aim', 'fire', 'cast', 'spell', 'magic',
            'throw', 'leap', 'jump', 'hurt', 'damage', 'hit', 'pain',
            'death', 'die'
        ]);

        // Debug
        this.DEBUG = true;
        this.DEBUG_LEVEL = 1;

        console.log('[AnimationSystem] VAT-only animation system initialized');
    }

    update() {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) return;
        this.updateEntityAnimations();
    }

    updateEntityAnimations() {
        const CT = this.componentTypes;
        const entities = this.game.getEntitiesWith(CT.POSITION, CT.RENDERABLE);

        entities.forEach(entityId => {
            // Only process instanced entities
            if (!this.game.renderSystem?.isInstanced(entityId)) return;

            const velocity = this.game.getComponent(entityId, CT.VELOCITY);
            const health = this.game.getComponent(entityId, CT.HEALTH);
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            const aiState = this.game.getComponent(entityId, CT.AI_STATE);

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
            isCelebrating: false
        };

        this.entityAnimationStates.set(entityId, state);

        // Set initial animation
        this.game.renderSystem?.setInstanceClip(entityId, 'idle', true);
        this.game.renderSystem?.setInstanceSpeed(entityId, 1);

        if (this.DEBUG_LEVEL >= 2) {
            console.log(`[AnimationSystem] Initialized animation state for entity ${entityId}`);
        }
    }

    updateEntityAnimationLogic(entityId, velocity, health, combat, aiState) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        const currentTime = this.game.state?.now || 0;
        const deltaTime = this.game.state?.deltaTime || 1/60;
        animState.animationTime += deltaTime;

        // Handle special states
        if (animState.isDying || animState.isCorpse || animState.isCelebrating) {
            return; // Don't change animations in these states
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

        // Check movement first
        const isMoving = velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD);
        
        if (isMoving) {
            clip = 'walk';
            speed = this.calculateWalkSpeed(velocity);
        }

        // AI state overrides
        if (aiState) {
            switch (aiState.state) {
                case 'attacking':
                case 'combat':
                    // During combat, prefer walking if moving, otherwise idle
                    if (!isMoving) {
                        clip = 'idle';
                        speed = 1.0;
                    }
                    break;
                    
                case 'chasing':
                case 'moving':
                    clip = 'walk';
                    speed = this.calculateWalkSpeed(velocity);
                    break;
                    
                case 'waiting':
                    clip = isMoving ? 'walk' : 'idle';
                    if (isMoving) speed = this.calculateWalkSpeed(velocity);
                    break;
            }
        }

        // Health-based animation modifications
        if (health && health.current < health.max * 0.3 && clip === 'idle') {
            clip = 'hurt';
        }

        return { clip, speed, minTime };
    }

    shouldChangeAnimation(entityId, animState, desired, currentTime) {
        // Always change if different clip is desired
        if (animState.currentClip !== desired.clip) {
            return true;
        }

        // For single-play animations, check if finished
        if (this.SINGLE_PLAY_ANIMATIONS.has(animState.currentClip)) {
            const isFinished = this.isAnimationFinished(entityId, animState.currentClip);
            if (isFinished) {
                return true;
            }
        }

        // Check minimum animation time
        if (animState.minAnimationTime > 0 && animState.animationTime < animState.minAnimationTime) {
            return false;
        }

        // Check state change cooldown
        const timeSinceLastChange = currentTime - animState.lastStateChange;
        if (timeSinceLastChange < this.STATE_CHANGE_COOLDOWN) {
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
            
            if (this.DEBUG_LEVEL >= 2) {
                console.log(`[AnimationSystem] Changed animation for entity ${entityId}: ${clipName} -> ${resolvedClip} (speed: ${speed})`);
            }
            return true;
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

        if (this.DEBUG_LEVEL >= 2) {
            console.log(`[AnimationSystem] Triggered animation '${clipName}' for entity ${entityId}`);
        }
        return true;
    }

    playDeathAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isDying = true;
        this.changeAnimation(entityId, 'death', 1.0, 0);
        
        if (this.DEBUG_LEVEL >= 1) {
            console.log(`[AnimationSystem] Started death animation for entity ${entityId}`);
        }
    }

    setCorpseAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isDying = false;
        animState.isCorpse = true;
        
        // Stop animation by setting speed to 0
        this.game.renderSystem?.setInstanceSpeed(entityId, 0);
        
        if (this.DEBUG_LEVEL >= 1) {
            console.log(`[AnimationSystem] Set corpse state for entity ${entityId}`);
        }
    }

    startCelebration(entityId, teamType = null) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isCelebrating = true;
        
        // Try celebration animations, fallback to idle
        const celebrationClips = ['celebrate', 'victory', 'cheer', 'dance', 'happy', 'win'];
        let clipToUse = 'idle';
        
        for (const clip of celebrationClips) {
            if (this.hasClip(entityId, clip)) {
                clipToUse = clip;
                break;
            }
        }

        this.changeAnimation(entityId, clipToUse, 1.0, 0);
        
        if (this.DEBUG_LEVEL >= 1) {
            console.log(`[AnimationSystem] Started celebration '${clipToUse}' for entity ${entityId}`);
        }
    }

    stopCelebration(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;

        animState.isCelebrating = false;
        this.changeAnimation(entityId, 'idle', 1.0, 0);
        
        if (this.DEBUG_LEVEL >= 1) {
            console.log(`[AnimationSystem] Stopped celebration for entity ${entityId}`);
        }
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

        const animationState = this.game.renderSystem?.getInstanceAnimationState(entityId);
        if (!animationState) return true;

        // Check if we've played through most of the clip
        const progress = animationState.animTime / animationState.clipDuration;
        return progress >= 0.9; // Consider finished at 90%
    }

    hasClip(entityId, clipName) {
        const CT = this.componentTypes;
        const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
        if (!renderable) return false;

        const batchInfo = this.game.renderSystem?.getBatchInfo(renderable.objectType, renderable.spawnType);
        return batchInfo?.availableClips?.includes(clipName) || false;
    }

    resolveClipName(entityId, desiredClip) {
        const CT = this.componentTypes;
        const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
        if (!renderable) return 'idle';

        const batchInfo = this.game.renderSystem?.getBatchInfo(renderable.objectType, renderable.spawnType);
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

    removeEntityAnimations(entityId) {
        this.entityAnimationStates.delete(entityId);
        
        if (this.DEBUG_LEVEL >= 2) {
            console.log(`[AnimationSystem] Removed animation state for entity ${entityId}`);
        }
    }

    destroy() {
        console.log('[AnimationSystem] Destroying VAT animation system');
        this.entityAnimationStates.clear();
        console.log('[AnimationSystem] Cleanup complete');
    }

    // Debug methods

    debugEntityAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        const instanceState = this.game.renderSystem?.getInstanceAnimationState(entityId);
        
        console.log(`=== ANIMATION DEBUG for Entity ${entityId} ===`);
        console.log('Animation State:', animState);
        console.log('Instance State:', instanceState);
        
        const CT = this.componentTypes;
        const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
        if (renderable) {
            const batchInfo = this.game.renderSystem?.getBatchInfo(renderable.objectType, renderable.spawnType);
            console.log('Available Clips:', batchInfo?.availableClips);
        }
    }

    getAnimationStats() {
        return {
            trackedEntities: this.entityAnimationStates.size,
            singlePlayAnimations: Array.from(this.SINGLE_PLAY_ANIMATIONS)
        };
    }
}