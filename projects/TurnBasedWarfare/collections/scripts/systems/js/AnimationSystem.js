class AnimationSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.animationSystem = this;

        // Animation configuration
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        // Single-play animations (play once then stop/transition)
        this.SINGLE_PLAY_ANIMATIONS = new Set([
            'attack', 'cast', 'death'
        ]);

        // Cache for availableClips as Sets (batchKey -> Set)
        this._clipSetCache = new Map();
    }

    init() {
        // Register methods with GameManager
        this.game.register('triggerSinglePlayAnimation', this.triggerSinglePlayAnimation.bind(this));
        this.game.register('isAnimationFinished', this.isAnimationFinished.bind(this));
        this.game.register('setCorpseAnimation', this.setCorpseAnimation.bind(this));
        this.game.register('startCelebration', this.startCelebration.bind(this));
        this.game.register('stopCelebration', this.stopCelebration.bind(this));
        this.game.register('playDeathAnimation', this.playDeathAnimation.bind(this));
        this.game.register('calculateAnimationSpeed', this.calculateAnimationSpeed.bind(this));
        this.game.register('getEntityAnimations', this.getEntityAnimations.bind(this));

        // Billboard animation management (AnimationSystem owns animation decisions)
        this.game.register('setBillboardAnimation', this.setBillboardAnimation.bind(this));
        this.game.register('setBillboardAnimationDirection', this.setBillboardAnimationDirection.bind(this));
        this.game.register('getBillboardCurrentAnimation', this.getBillboardCurrentAnimation.bind(this));
        this.game.register('getBillboardAnimationState', this.getBillboardAnimationState.bind(this));
    }

    calculateAnimationSpeed(attackerId, baseAttackSpeed) {
        let animSpeed = baseAttackSpeed;
        return animSpeed;
    }

    update() {
        if (!this.game.scene || !this.game.renderer) {
            return;
        }
        this.updateEntityAnimations();
    }

    updateEntityAnimations() {
        const entities = this.game.getEntitiesWith("transform", "renderable");

        entities.forEach(entityId => {
            // Only process instanced entities
            if (!this.game.renderSystem?.isInstanced(entityId)) return;

            // Check if this is a static entity (worldObjects, cliffs)
            const unitType = this.game.getComponent(entityId, "unitType");
            const isStaticEntity = unitType && (unitType.collection === 'worldObjects' || unitType.collection === 'cliffs');

            if (isStaticEntity) {
                // For static entities with sprite animations, only update sprite direction based on camera
                const animState = this.game.getComponent(entityId, 'animationState');
                if (animState?.isSprite && animState.spriteAnimations) {
                    this.updateSpriteDirectionFromRotation(entityId, animState);
                }
                return;
            }

            const velocity = this.game.getComponent(entityId, "velocity");
            const health = this.game.getComponent(entityId, "health");
            const combat = this.game.getComponent(entityId, "combat");
            const aiState = this.game.getComponent(entityId, "aiState");

            // Ensure entity has animation state component
            if (!this.game.hasComponent(entityId, "animationState")) {
                this.initializeEntityAnimationState(entityId);
            }

            // Update animation logic
            this.updateEntityAnimationLogic(entityId, velocity, health, combat, aiState);
        });

        // Update billboard animations (frame advancement)
        this.updateBillboardAnimations();
    }

    initializeEntityAnimationState(entityId) {
        // Check if this is a billboard entity with sprite animations
        const isBillboard = this.game.call('isBillboardWithAnimations', entityId);

        // Add animationState component to entity
        this.game.addComponent(entityId, 'animationState', {
            currentClip: 'idle',
            lastStateChange: this.game.state?.now || 0,
            animationTime: 0,
            minAnimationTime: 0,
            pendingClip: null,
            pendingSpeed: null,
            pendingMinTime: null,
            isTriggered: false,
            isCelebrating: false,
            // Billboard/sprite animation state
            isSprite: isBillboard,
            spriteDirection: 'down',
            // Track fallback usage to prevent thrashing
            lastRequestedClip: null,
            lastResolvedClip: null,
            fallbackCooldown: 0
        });

        // Set initial animation based on entity type
        if (isBillboard) {
            // Billboard animation state will be initialized by onBillboardSpawned callback from EntityRenderer
            // (this happens when EntityRenderer finishes spawning the billboard)
        } else {
            // VAT entities use clip-based animations
            this.game.renderSystem?.setInstanceClip(entityId, 'idle', true);
            this.game.renderSystem?.setInstanceSpeed(entityId, 1);
        }
    }

    /**
     * Check if an entity is dead (dying or corpse) by reading deathState component
     * This is the single source of truth for death state
     */
    isEntityDead(entityId) {
        const deathState = this.game.getComponent(entityId, "deathState");
        return deathState && deathState.isDying;
    }

    /**
     * Check if an entity is specifically a corpse (death animation complete)
     */
    isEntityCorpse(entityId) {
        const deathState = this.game.getComponent(entityId, "deathState");
        return deathState && deathState.state === 'corpse';
    }

    updateEntityAnimationLogic(entityId, velocity, health, combat, aiState) {

        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState) return;

        const currentTime = this.game.state?.now || 0;
        const deltaTime = this.game.state?.deltaTime || 1/60;
        animState.animationTime += deltaTime;

        // Handle billboard/sprite entities separately
        if (animState.isSprite) {
            // Only process if sprite animations have been loaded
            if (animState.spriteAnimations) {
                this.updateBillboardAnimationLogic(entityId, animState, velocity);
            }
            return;
        }

        // Check death state from component (single source of truth)
        const isDead = this.isEntityDead(entityId);

        // Handle animation completion for locked states
        if (isDead || animState.isCelebrating) {
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

    /**
     * Handle animation logic for billboard/sprite entities
     * Camera is isometric looking toward +x, -z (northeast)
     * Supports 8 directions: down, downleft, left, upleft, up, upright, right, downright
     * Right-side animations use left-side flipped
     *
     * Direction is derived from transform.rotation.y:
     * - When moving, rotation is updated from velocity
     * - When attacking, rotation is set by attack behavior to face target
     */
    updateBillboardAnimationLogic(entityId, animState, velocity) {
        // Skip projectiles - they don't have walk/idle animations
        if (this.game.hasComponent(entityId, 'projectile')) {
            return;
        }

        // Check death state from component (single source of truth)
        if (this.isEntityDead(entityId)) {
            return;
        }

        // Only animate during battle phase - show idle during placement
        // But only for living entities (dead entities checked above)
        if (this.game.state?.phase !== 'battle') {
            this.game.call('setBillboardAnimation', entityId, 'idle', true);
            // Still update sprite direction based on camera position (important for editor)
            this.updateSpriteDirectionFromRotation(entityId, animState);
            return;
        }

        // Don't override single-play animations (attack, cast, death) - let them complete naturally
        // These animations have their own completion callbacks that return to idle
        const billboardAnim = this.game.getComponent(entityId, 'animationState');

        if (billboardAnim && this.SINGLE_PLAY_ANIMATIONS.has(billboardAnim.spriteAnimationType)) {
            // Just update direction for single-play animations (so entity faces target during attack)
            this.updateSpriteDirectionFromRotation(entityId, animState);
            return;
        }

        const vx = velocity?.vx ?? 0;
        const vz = velocity?.vz ?? 0;

        // Determine if moving
        const isMoving = Math.abs(vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(vz) > this.MIN_MOVEMENT_THRESHOLD;

        // Set walk or idle animation based on movement
        const animationType = isMoving ? 'walk' : 'idle';
        this.game.call('setBillboardAnimation', entityId, animationType, true);

        // Update sprite direction from rotation (set by MovementSystem when moving, or by attack behavior when attacking)
        this.updateSpriteDirectionFromRotation(entityId, animState);
    }

    /**
     * Update sprite direction based on entity's rotation.y and camera position
     *
     * For PERSPECTIVE cameras:
     * Uses the same snapping calculation as the billboard vertex shader to ensure
     * the sprite direction changes at exactly the same camera angles as the
     * billboard rotation snaps.
     * Shader formula: snappedAngle = round(angle / (PI/4)) * (PI/4)
     *
     * For ORTHOGRAPHIC cameras:
     * Uses the raw camera angle (not snapped) since the billboard always faces
     * the camera directly. The sprite frame shown depends on the entity's facing
     * direction relative to camera position, which changes smoothly as the camera
     * rotates around the scene.
     */
    updateSpriteDirectionFromRotation(entityId, animState) {
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position || !transform?.rotation) return;

        // Get camera via registered function (returns live reference from worldRenderer)
        const cam = this.game.call('getCamera') || this.game.camera;
        if (!cam) return;

        const rotationY = transform.rotation.y;
        const ANGLE_STEP = Math.PI / 4; // 45 degrees
        let newDirection;

        if (cam.isOrthographicCamera) {
            // Orthographic: use camera's viewing direction (same for all objects due to parallel projection)
            // Panning doesn't change the view angle, only rotating the camera does
            // Get the camera's forward direction in world space (where it's looking)
            const cameraDirection = new THREE.Vector3(0, 0, -1);
            cameraDirection.applyQuaternion(cam.quaternion);

            // Calculate angle FROM scene TO camera (opposite of viewing direction)
            // Use same atan2(z, x) order as perspective branch for consistency
            const cameraAngle = Math.atan2(-cameraDirection.z, -cameraDirection.x);

            // Calculate relative angle (entity facing vs camera angle)
            let relativeAngle = rotationY - cameraAngle;

            // Normalize to -PI to PI
            while (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
            while (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

            // Snap relative angle to 8 directions
            const snappedRelativeAngle = Math.round(relativeAngle / ANGLE_STEP) * ANGLE_STEP;

            // Map to direction index
            let directionIndex = Math.round(snappedRelativeAngle / ANGLE_STEP);
            directionIndex = ((directionIndex % 8) + 8) % 8;

            const directions = ['down', 'downleft', 'left', 'upleft', 'up', 'upright', 'right', 'downright'];
            newDirection = directions[directionIndex];
        } else {
            // Perspective: sprite direction relative to camera angle (existing logic)
            const entityPos = transform.position;

            // Calculate angle from entity to camera in world space (same as shader)
            const dx = cam.position.x - entityPos.x;
            const dz = cam.position.z - entityPos.z;
            const angleToCamera = Math.atan2(dz, dx);

            // Snap camera angle to 8 directions using the SAME formula as the shader
            // This ensures sprite direction changes at exactly the same moment as billboard rotation
            const snappedCameraAngle = Math.round(angleToCamera / ANGLE_STEP) * ANGLE_STEP;

            // Calculate relative angle using snapped camera angle
            // This is the entity's facing direction relative to the snapped billboard facing
            let relativeAngle = rotationY - snappedCameraAngle;

            // Normalize to -PI to PI
            while (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
            while (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

            // Snap relative angle to 8 directions (same formula)
            const snappedRelativeAngle = Math.round(relativeAngle / ANGLE_STEP) * ANGLE_STEP;

            // Map snapped relative angle to sprite direction
            // Direction index: 0=down (facing camera), increasing counterclockwise
            // Normalize to 0..7 index
            let directionIndex = Math.round(snappedRelativeAngle / ANGLE_STEP);
            // Handle wrap-around for negative indices
            directionIndex = ((directionIndex % 8) + 8) % 8;

            // Map index to direction name
            // Index 0 = facing toward camera = down (front view)
            // Index increases counterclockwise: 1=downleft, 2=left, 3=upleft, 4=up, 5=upright, 6=right, 7=downright
            const directions = ['down', 'downleft', 'left', 'upleft', 'up', 'upright', 'right', 'downright'];
            newDirection = directions[directionIndex];
        }

        // Check if direction changed and apply it
        if (newDirection !== animState.spriteDirection) {
            // Let setBillboardAnimationDirection handle setting the direction and applying the frame
            this.game.call('setBillboardAnimationDirection', entityId, newDirection);
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

            // AI action overrides based on currentAction
            if (aiState && aiState.currentAction) {
                const actionType = aiState.currentAction;

                switch (actionType) {
                    case 'AttackEnemyBehaviorAction':
                    case 'CombatBehaviorAction':
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
        const animState = this.game.getComponent(entityId, "animationState");
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
          //  console.warn(`[AnimationSystem] ❌ Failed to change animation for entity ${entityId}: ${clipName} -> ${resolvedClip}`);
        }

        return false;
    }

    updateAnimationSpeed(entityId, targetSpeed) {
        const animState = this.game.getComponent(entityId, "animationState");
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
        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState) {
            console.warn(`[AnimationSystem] No animation state for entity ${entityId}`);
            return false;
        }

        // Handle billboard entities with sprite animations
        if (animState.isSprite) {
            if (clipName === 'attack') {
                // Check if already playing attack animation - don't restart it
                const billboardAnim = this.game.getComponent(entityId, 'animationState');
                if (billboardAnim && billboardAnim.spriteAnimationType === 'attack') {
                    return true;  // Already attacking, don't restart
                }

                // Set attack animation (single-play, not looping)
                // When animation completes, return to idle
                // Use minTime as customDuration to pace the animation (e.g., for leap slam)
                this.game.call(
                    'setBillboardAnimation',
                    entityId,
                    'attack',
                    false,  // don't loop - play once
                    (completedEntityId) => {
                        // Return to idle animation after attack finishes
                        this.game.call('setBillboardAnimation', completedEntityId, 'idle', true);
                    },
                    minTime > 0 ? minTime : null  // Pass minTime as custom duration if provided
                );
                return true;
            }
            // Other animation types not yet supported for billboards
            return false;
        }

        // Queue the animation for VAT entities
        animState.pendingClip = clipName;
        animState.pendingSpeed = speed;
        animState.pendingMinTime = minTime;
        animState.isTriggered = true;

        return true;
    }

    playDeathAnimation(entityId) {
        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState) {
            console.warn(`[AnimationSystem] ❌ No animation state found for entity ${entityId} during death`);
            return;
        }

        // Death state is managed by deathState component (set by DeathSystem)
        // We just need to clear animation system's local state and play the animation

        // Clear celebration state
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

        // Handle billboard entities with sprite animations
        if (animState.isSprite) {
            // Set death animation (non-looping, stays on last frame)
            this.game.call(
                'setBillboardAnimation',
                entityId,
                'death',
                false  // don't loop
            );
            return;
        }

        // Apply death animation immediately for VAT/model entities
        this.changeAnimation(entityId, 'death', 1.0, 0);
    }

    setCorpseAnimation(entityId) {
        // Corpse state is managed by deathState component (set by DeathSystem)
        // For billboard entities, death animation already stays on last frame
        const animState = this.game.getComponent(entityId, "animationState");
        if (animState?.isSprite) {
            // Billboard death animations are non-looping and stay on last frame
            return;
        }

        // For VAT/model entities: freeze at current frame
        const animationStateData = this.game.call('getEntityAnimationState', entityId);

        if (animationStateData && animationStateData.clipDuration > 0) {
            // Set to 99% through the animation (last frame before loop)
            const lastFrameTime = animationStateData.clipDuration * 0.99;
            this.game.call('setInstanceAnimationTime', entityId, lastFrameTime);
        }

        // Now freeze it at that frame
        this.game.call('setInstanceSpeed', entityId, 0);
    }

    startCelebration(entityId, teamType = null) {
        const animState = this.game.getComponent(entityId, "animationState");
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
        const animState = this.game.getComponent(entityId, "animationState");
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

        const animationState = this.game.call('getEntityAnimationState', entityId);
        if (!animationState) {
            return true;
        }

        // Check if we've played through most of the clip
        const progress = animationState.animTime / animationState.clipDuration;
        const isFinished = progress >= 0.9; // Consider finished at 90%
        
        return isFinished;
    }

    /**
     * Get or create a cached Set of available clips for faster lookup
     */
    _getClipSet(objectType, spawnType) {
        const batchKey = `${objectType}_${spawnType}`;

        if (this._clipSetCache.has(batchKey)) {
            return this._clipSetCache.get(batchKey);
        }

        const batchInfo = this.game.call('getBatchInfo', objectType, spawnType);
        if (!batchInfo?.availableClips) {
            return null;
        }

        // Create Set from array for O(1) lookup
        const clipSet = new Set(batchInfo.availableClips);
        this._clipSetCache.set(batchKey, clipSet);
        return clipSet;
    }

    hasClip(entityId, clipName) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return false;

        const clipSet = this._getClipSet(renderable.objectType, renderable.spawnType);
        return clipSet?.has(clipName) || false;
    }

    resolveClipName(entityId, desiredClip) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return 'idle';

        const clipSet = this._getClipSet(renderable.objectType, renderable.spawnType);
        if (!clipSet) return 'idle';

        // Return if exact match exists (O(1) Set lookup)
        if (clipSet.has(desiredClip)) {
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
            if (clipSet.has(fallback)) {
                return fallback;
            }
        }

        // Final fallback - get first clip from the set
        const firstClip = clipSet.values().next().value;
        return firstClip || 'idle';
    }

    // Cleanup is handled automatically by ECS when entities are destroyed

    destroy() {
        // Components are managed by the ECS, no cleanup needed here
    }

    /**
     * Get all entity animation states (for debugging/inspection)
     */
    getEntityAnimations() {
        const result = new Map();
        const entities = this.game.getEntitiesWith("animationState");
        for (const entityId of entities) {
            result.set(entityId, this.game.getComponent(entityId, "animationState"));
        }
        return result;
    }

    /**
     * Set animation for a billboard entity
     * @param {string} entityId - The entity to animate
     * @param {string} animationType - Animation type (idle, walk, attack, death, celebrate)
     * @param {boolean} loop - Whether the animation should loop (default: true)
     * @param {function} onComplete - Optional callback when animation finishes (for non-looping animations)
     * @param {number} customDuration - Optional custom duration to pace the animation (in seconds)
     */
    setBillboardAnimation(entityId, animationType, loop = true, onComplete = null, customDuration = null) {
        const animData = this.game.getComponent(entityId, "animationState");
        if (!animData || !animData.isSprite) {
            return false;
        }

        // Check death state from component (single source of truth)
        // Don't allow animation changes for dead entities (except death animation itself)
        if (this.isEntityDead(entityId) && animationType !== 'death') {
            return false;
        }

        // Check if animation type is available
        if (!animData.spriteAnimations?.[animationType]) {
            console.warn(`[AnimationSystem] Animation type '${animationType}' not available for entity ${entityId}`);
            return false;
        }

        // If already in this animation type, don't restart
        if (animData.spriteAnimationType === animationType) {
            return true;
        }

        // Set up new animation
        animData.spriteAnimationType = animationType;
        animData.spriteFrameIndex = 0;
        animData.spriteFrameTime = 0;
        animData.spriteLoopAnimation = loop;
        animData.onAnimationComplete = onComplete;
        animData.customDuration = customDuration; // Custom duration override for pacing

        // Tell EntityRenderer to apply the first frame
        const entityRenderer = this.game.call('getEntityRenderer');
        if (entityRenderer) {
            entityRenderer.applyBillboardAnimationFrame(entityId, animData);
        }

        return true;
    }

    /**
     * Get the current animation type for a billboard entity
     */
    getBillboardCurrentAnimation(entityId) {
        const animData = this.game.getComponent(entityId, "animationState");
        return animData?.spriteAnimationType || null;
    }

    /**
     * Get billboard animation state (for direct manipulation by behaviors)
     */
    getBillboardAnimationState(entityId) {
        return this.game.getComponent(entityId, "animationState") || null;
    }

    /**
     * Set sprite animation direction for a billboard entity
     */
    setBillboardAnimationDirection(entityId, direction) {
        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState || !animState.isSprite) return false;

        if (direction !== animState.spriteDirection) {
            // Don't reset frame for single-play animations - just change direction
            const shouldResetFrame = !this.SINGLE_PLAY_ANIMATIONS.has(animState.spriteAnimationType);

            animState.spriteDirection = direction;
            if (shouldResetFrame) {
                animState.spriteFrameIndex = 0;
                animState.spriteFrameTime = 0;
            }

            // Tell EntityRenderer to apply the new frame immediately
            const entityRenderer = this.game.call('getEntityRenderer');
            if (entityRenderer) {
                entityRenderer.applyBillboardAnimationFrame(entityId, animState);
            }
        }

        return true;
    }

    /**
     * Update billboard sprite animation frames (called every frame)
     */
    updateBillboardAnimations(deltaTime) {
        const entityRenderer = this.game.call('getEntityRenderer');
        if (!entityRenderer) return;

        // Get rendering data to access sprite animation frame rates
        const frameRates = entityRenderer.spriteAnimationFrameRates || {};
        const defaultFrameRate = entityRenderer.defaultFrameRate || 10;

        // Get all entities with animationState component that are billboards
        const billboardEntities = this.game.getEntitiesWith("animationState");

        for (const entityId of billboardEntities) {
            const animState = this.game.getComponent(entityId, "animationState");
            if (!animState || !animState.isSprite) continue;
            // Get animations for current type (stored in animationState)
            const animations = animState.spriteAnimations?.[animState.spriteAnimationType];
            if (!animations) continue;

            const directionData = animations[animState.spriteDirection];
            if (!directionData || !directionData.frames || directionData.frames.length === 0) continue;

            const frames = directionData.frames;
            // For non-looping animations, check if already finished (past the last frame)
            if (!animState.spriteLoopAnimation && animState.spriteFrameIndex >= frames.length) {
                continue;
            }

            // Update frame time
            animState.spriteFrameTime += this.game.state.deltaTime;

            // Calculate frame duration based on fps from animation set
            const fps = animState.spriteFps || frameRates[animState.spriteAnimationType] || defaultFrameRate;
            let frameDuration = 1 / fps;

            // Override with custom duration if set (e.g., for abilities that need specific timing)
            if (animState.customDuration !== null && animState.customDuration > 0) {
                frameDuration = animState.customDuration / frames.length;
            }
            // Advance frames based on elapsed time (handles lag/large deltaTime correctly)
            let frameChanged = false;
            const oldFrameIndex = animState.spriteFrameIndex;
            while (animState.spriteFrameTime >= frameDuration) {
                animState.spriteFrameTime -= frameDuration;
                animState.spriteFrameIndex++;
                frameChanged = true;

                // Handle animation completion
                if (animState.spriteFrameIndex >= frames.length) {
                    if (animState.spriteLoopAnimation) {
                        animState.spriteFrameIndex = 0;
                    } else {
                        animState.spriteFrameIndex = frames.length - 1;
                        animState.spriteFrameTime = 0; // Stop accumulating time

                        // Call completion callback if set
                        if (animState.onAnimationComplete) {
                            animState.onAnimationComplete(entityId);
                            animState.onAnimationComplete = null;
                        } else {
                            // Default behavior: return to idle for single-play animations (except death)
                            // Death animations should stay frozen on the last frame
                            if (this.SINGLE_PLAY_ANIMATIONS.has(animState.spriteAnimationType) &&
                                animState.spriteAnimationType !== 'death') {
                                this.game.call('setBillboardAnimation', entityId, 'idle', true);
                            }
                        }
                        break; // Exit loop for non-looping animations
                    }
                }
            }
            // Tell EntityRenderer to apply new frame if it changed
            if (frameChanged) {
                entityRenderer.applyBillboardAnimationFrame(entityId, animState);
            }
        }
    }

    /**
     * Event handler for when a billboard entity is spawned (called by game.triggerEvent)
     * @param {object} eventData - Event data with entityId, spriteAnimationSet, spriteAnimationCollection
     */
    billboardSpawned(eventData) {
        const { entityId, spriteAnimationSet, spriteAnimationCollection } = eventData;

        // Get animation data from collections
        const animSetData = this.game.getCollections()?.spriteAnimationSets?.[spriteAnimationSet];
        if (!animSetData) {
            console.warn(`[AnimationSystem] No animation set found for ${spriteAnimationSet}`);
            return;
        }

        // Build animation data structure from collections
        const animations = {};
        const animTypes = ['idle', 'walk', 'attack', 'death', 'celebrate'];

        for (const animType of animTypes) {
            const animKey = `${animType}SpriteAnimations`;
            const animNames = animSetData[animKey];

            if (animNames && animNames.length > 0) {
                animations[animType] = this.loadAnimationsFromCollections(animNames, spriteAnimationCollection);
            }
        }

        // Determine initial direction based on entity type and team
        const unitType = this.game.getComponent(entityId, 'unitType');
        const team = this.game.getComponent(entityId, 'team');
        const isBuilding = unitType?.collection === 'buildings';

        let initialDirection;
        if (isBuilding) {
            // Buildings face downleft for better isometric view
            initialDirection = 'downleft';
        } else {
            // Units face based on their team
            // Team 'left' faces upright (toward opponent on right)
            // Team 'right' faces downleft (toward opponent on left)
            initialDirection = team?.id === 'left' ? 'upright' : 'downleft';
        }

        // Get fps from animation set's generator settings
        const animationFps = animSetData.generatorSettings?.fps || null;

        // Ensure animationState component exists, then add billboard-specific properties
        if (!this.game.hasComponent(entityId, 'animationState')) {
            this.initializeEntityAnimationState(entityId);
        }

        const animState = this.game.getComponent(entityId, 'animationState');
        if (animState) {
            // Add sprite-specific properties to animationState
            animState.spriteAnimationSet = spriteAnimationSet;
            animState.spriteAnimations = animations;
            animState.spriteFps = animationFps;
            animState.spriteAnimationType = null;
            animState.spriteDirection = initialDirection;
            animState.spriteFrameIndex = 0;
            animState.spriteFrameTime = 0;
            animState.spriteLoopAnimation = true;
            animState.isSprite = true;
        }

        // Apply initial idle animation (sets UV coordinates)
        this.setBillboardAnimation(entityId, 'idle', true);

        // Update entity transform now that UV coordinates are set
        // This ensures aspect ratio calculation works correctly
        const entityRenderer = this.game.call('getEntityRenderer');
        if (entityRenderer) {
            const transform = this.game.getComponent(entityId, 'transform');
            const velocity = this.game.getComponent(entityId, 'velocity');
            if (transform) {
                entityRenderer.updateEntityTransform(entityId, {
                    position: transform.position,
                    rotation: transform.rotation?.y || 0,
                    transform: transform,
                    velocity: velocity
                });
            }
        }
    }

    /**
     * Load animation data from collections
     */
    loadAnimationsFromCollections(animNames, collectionName) {
        const collections = this.game.getCollections();
        const result = {};

        for (const animName of animNames) {
            const animData = collections?.[collectionName]?.[animName];
            if (animData && animData.sprites) {
                // Get sprite collection from animation data's spriteCollection property
                const spriteCollectionName = animData.spriteCollection;
                if (!spriteCollectionName) {
                    console.warn(`[AnimationSystem] Animation '${animName}' missing spriteCollection property`);
                    continue;
                }

                // Extract direction from animation name (e.g., "peasantIdleDown" -> "down")
                const direction = this.extractDirectionFromName(animName);

                if (direction) {
                    const frames = animData.sprites.map(spriteName => {
                        const sprite = collections?.[spriteCollectionName]?.[spriteName];
                        if (!sprite) {
                            console.warn(`[AnimationSystem] Sprite '${spriteName}' not found in collection '${spriteCollectionName}'`);
                        }
                        return sprite ? {
                            x: sprite.x,
                            y: sprite.y,
                            width: sprite.width,
                            height: sprite.height
                        } : null;
                    }).filter(f => f !== null);

                    result[direction] = {
                        frames
                    };
                }
            }
        }

        return result;
    }

    /**
     * Extract direction from animation name (e.g., "peasantIdleDown" -> "down")
     */
    extractDirectionFromName(animName) {
        const lowerName = animName.toLowerCase();
        // Check compound directions first (longest to shortest) to avoid false matches
        const directions = ['downleft', 'downright', 'upleft', 'upright', 'down', 'up', 'left', 'right'];

        for (const dir of directions) {
            if (lowerName.includes(dir)) {
                return dir;
            }
        }

        return null;
    }

    onSceneUnload() {
    }

    dispose() {
        // Clear cached clip sets to avoid stale data on next game
        this._clipSetCache.clear();
    }
}