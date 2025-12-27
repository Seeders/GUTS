class AnimationSystem extends GUTS.BaseSystem {
    static services = [
        'triggerSinglePlayAnimation',
        'isAnimationFinished',
        'setCorpseAnimation',
        'startCelebration',
        'stopCelebration',
        'playDeathAnimation',
        'calculateAnimationSpeed',
        'getEntityAnimations',
        'setBillboardAnimation',
        'setBillboardAnimationDirection',
        'getBillboardCurrentAnimation',
        'getBillboardAnimationState',
        'getSpriteAnimationData'
    ];

    constructor(game) {
        super(game);
        this.game.animationSystem = this;

        // Animation configuration
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        // Cache for availableClips as Sets (batchKey -> Set)
        this._clipSetCache = new Map();
    }

    init() {
        // Use built-in reverseEnums from BaseSystem for index->string conversion
        this.directionNames = this.reverseEnums.direction;
        this.animationTypeNames = this.reverseEnums.animationType;
        this.ballisticAngleNames = this.reverseEnums.ballisticAngle;

        // Shared cache for sprite animation data (keyed by spriteAnimationSet index)
        // This avoids storing complex objects per-entity
        this.spriteAnimationCache = new Map();

        // Callback map for animation completion (entityId -> callback)
        // Stored here instead of on component since callbacks can't be serialized
        this._animationCallbacks = new Map();

        // Single-play animations using enum values
        this.SINGLE_PLAY_ANIMATIONS = new Set([
            this.enums.animationType.attack,
            this.enums.animationType.cast,
            this.enums.animationType.death
        ]);
    }

    /**
     * Get sprite animation data from shared cache
     * @param {number} spriteAnimationSetIndex - The spriteAnimationSets collection index
     * @returns {object|null} Animation data object or null if not cached
     */
    getSpriteAnimationData(spriteAnimationSetIndex) {
        return this.spriteAnimationCache.get(spriteAnimationSetIndex) || null;
    }

    /**
     * Get sprite animations for an entity from the shared cache
     * @param {object} animState - The entity's animationState component
     * @returns {object|null} The animations object keyed by animation type name
     */
    _getSpriteAnimations(animState) {
        if (!animState || animState.spriteAnimationSet == null) return null;
        const cachedData = this.spriteAnimationCache.get(animState.spriteAnimationSet);
        return cachedData?.animations || null;
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
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const isStaticEntity = unitType && (unitType.collection === 'worldObjects' || unitType.collection === 'cliffs');

            if (isStaticEntity) {
                // For static entities with sprite animations, only update sprite direction based on camera
                const animState = this.game.getComponent(entityId, 'animationState');
                if (animState?.isSprite && this._getSpriteAnimations(animState)) {
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

        // Add animationState component to entity (all values numeric for TypedArray storage)
        // Use null for "not set" values - will be stored as -Infinity in TypedArray
        this.game.addComponent(entityId, 'animationState', {
            currentClip: this.enums.animationType.idle,
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
            spriteDirection: this.enums.direction.down,
            spriteAnimationSet: null,
            spriteFps: null,
            spriteAnimationType: null,
            spriteFrameIndex: 0,
            spriteFrameTime: 0,
            spriteLoopAnimation: true,
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
            // VAT entities use clip-based animations - convert enum to string for render system
            const idleClipName = this.animationTypeNames[this.enums.animationType.idle];
            this.game.renderSystem?.setInstanceClip(entityId, idleClipName, true);
            this.game.renderSystem?.setInstanceSpeed(entityId, 1);
        }
    }

    /**
     * Check if an entity is dead (dying or corpse) by reading deathState component
     * This is the single source of truth for death state
     */
    isEntityDead(entityId) {
        const deathState = this.game.getComponent(entityId, "deathState");
        return deathState && deathState.state >= this.enums.deathState.dying;
    }

    /**
     * Check if an entity is specifically a corpse (death animation complete)
     */
    isEntityCorpse(entityId) {
        const deathState = this.game.getComponent(entityId, "deathState");
        return deathState && deathState.state === this.enums.deathState.corpse;
    }

    updateEntityAnimationLogic(entityId, velocity, health, combat, aiState) {

        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState) return;

        const currentTime = this.game.state?.now || 0;
        const deltaTime = this.game.state?.deltaTime || 1/60;
        animState.animationTime += deltaTime;

        // Handle billboard/sprite entities separately
        if (animState.isSprite) {
            // Only process if sprite animations have been loaded (spriteAnimationSet != null)
            if (animState.spriteAnimationSet != null) {
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
        // Projectiles need direction updates and potentially ballistic angle updates
        if (this.game.hasComponent(entityId, 'projectile')) {
            this.updateSpriteDirectionFromRotation(entityId, animState);
            // Update ballistic angle if projectile has ballistic sprite animations
            this.updateProjectileBallisticAngle(entityId, animState, velocity);
            return;
        }

        // Check death state from component (single source of truth)
        if (this.isEntityDead(entityId)) {
            return;
        }

        // Only animate during battle phase - show idle during placement
        // But only for living entities (dead entities checked above)
        if (this.game.state?.phase !== this.enums.gamePhase.battle) {
            this.game.call('setBillboardAnimation', entityId, this.enums.animationType.idle, true);
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
        const animationType = isMoving ? this.enums.animationType.walk : this.enums.animationType.idle;
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

            newDirection = directionIndex; // directionIndex maps directly to enum
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

            // directionIndex maps directly to direction enum:
            // 0=down, 1=downleft, 2=left, 3=upleft, 4=up, 5=upright, 6=right, 7=downright
            newDirection = directionIndex;
        }

        // Check if direction changed and apply it
        if (newDirection !== animState.spriteDirection) {
            // Let setBillboardAnimationDirection handle setting the direction and applying the frame
            this.game.call('setBillboardAnimationDirection', entityId, newDirection);
        }
    }

    /**
     * Calculate ballistic angle index based on projectile velocity
     * Maps vertical velocity to one of 5 discrete angle states (0-4)
     * Uses ballisticAngle enum: up90=0, up45=1, level=2, down45=3, down90=4
     * @param {number} vy - Vertical velocity component
     * @param {number} vx - Horizontal X velocity component
     * @param {number} vz - Horizontal Z velocity component
     * @returns {number} Angle enum index
     */
    getBallisticAngleIndex(vy, vx, vz) {
        // Calculate pitch angle from velocity
        const horizontalSpeed = Math.sqrt(vx * vx + vz * vz);

        // Handle edge case of no horizontal movement
        if (horizontalSpeed < 0.001) {
            // Nearly vertical movement - determine direction by vy
            // up90=0, down90=4, level=2
            return vy > 0 ? this.enums.ballisticAngle.up90 : (vy < 0 ? this.enums.ballisticAngle.down90 : this.enums.ballisticAngle.level);
        }

        const pitchRadians = Math.atan2(vy, horizontalSpeed);
        const pitchDegrees = pitchRadians * (180 / Math.PI);

        // Map to discrete angles with threshold boundaries
        if (pitchDegrees >= 67.5) return this.enums.ballisticAngle.up90;    // Nearly vertical up (67.5° to 90°)
        if (pitchDegrees >= 22.5) return this.enums.ballisticAngle.up45;    // Ascending (22.5° to 67.5°)
        if (pitchDegrees >= -22.5) return this.enums.ballisticAngle.level;  // Horizontal (-22.5° to 22.5°)
        if (pitchDegrees >= -67.5) return this.enums.ballisticAngle.down45; // Descending (-67.5° to -22.5°)
        return this.enums.ballisticAngle.down90;                             // Nearly vertical down (-90° to -67.5°)
    }

    /**
     * Get ballistic angle name from velocity (for property name lookup)
     * Returns PascalCase name like 'Up90', 'Up45', 'Level', 'Down45', 'Down90'
     */
    getBallisticAngleName(vy, vx, vz) {
        const index = this.getBallisticAngleIndex(vy, vx, vz);
        // Convert enum name (lowercase) to PascalCase for property name matching
        const enumName = this.ballisticAngleNames[index];
        return enumName.charAt(0).toUpperCase() + enumName.slice(1);
    }

    /**
     * Update projectile sprite to show correct ballistic angle based on velocity
     * @param {number} entityId - The projectile entity ID
     * @param {object} animState - The entity's animationState component
     * @param {object} velocity - The entity's velocity component
     */
    updateProjectileBallisticAngle(entityId, animState, velocity) {
        if (!velocity || !animState) {
            console.warn('[Ballistic] Early exit: no velocity or animState', { velocity: !!velocity, animState: !!animState });
            return;
        }

        // Get the sprite animation data to check if ballistic animations exist
        const animSetData = this.spriteAnimationCache.get(animState.spriteAnimationSet);
        if (!animSetData?.rawAnimSetData) {
            console.warn('[Ballistic] No animSetData or rawAnimSetData for set:', animState.spriteAnimationSet);
            return;
        }

        const rawData = animSetData.rawAnimSetData;
        const hasBallisticAnimations = Object.keys(rawData).some(key =>
            key.startsWith('ballisticIdleSpriteAnimations')
        );

        if (!hasBallisticAnimations) {
            console.warn('[Ballistic] No ballistic animations found. Keys:', Object.keys(rawData).filter(k => k.includes('ballistic')));
            return;
        }

        // Calculate the ballistic angle index from velocity (0-4)
        const angleIndex = this.getBallisticAngleIndex(
            velocity.vy || 0,
            velocity.vx || 0,
            velocity.vz || 0
        );
        // Convert enum name (e.g., 'up90') to PascalCase (e.g., 'Up90') for property lookup
        const enumName = this.ballisticAngleNames[angleIndex];
        const angleName = enumName.charAt(0).toUpperCase() + enumName.slice(1);

        // Check if both angle and direction are unchanged
        const directionChanged = animState.lastBallisticDirection !== animState.spriteDirection;
        const angleChanged = animState.ballisticAngle !== angleIndex;

        if (!angleChanged && !directionChanged) {
            return;
        }

        // Store the new angle index and direction
        animState.ballisticAngle = angleIndex;
        animState.lastBallisticDirection = animState.spriteDirection;

        // Get the correct animation array for this angle
        const animType = this.animationTypeNames[animState.spriteAnimationType] || 'idle';
        const ballisticPropertyName = `ballistic${animType.charAt(0).toUpperCase() + animType.slice(1)}SpriteAnimations${angleName}`;

        const ballisticAnimationNames = rawData[ballisticPropertyName];
        if (!ballisticAnimationNames || !Array.isArray(ballisticAnimationNames)) {
            console.warn('[Ballistic] No animation names array for:', ballisticPropertyName, 'Available:', Object.keys(rawData).filter(k => k.includes('ballistic')));
            return;
        }

        // Get current direction index
        const directionIndex = animState.spriteDirection;
        if (directionIndex < 0 || directionIndex >= ballisticAnimationNames.length) {
            console.warn('[Ballistic] Direction index out of range:', directionIndex, 'Array length:', ballisticAnimationNames.length);
            return;
        }

        // Get the animation name for this direction and angle
        const animationName = ballisticAnimationNames[directionIndex];
        if (!animationName) {
            console.warn('[Ballistic] No animation name at direction index:', directionIndex);
            return;
        }

        // Load ballistic animation if not already cached
        if (!animSetData.ballisticAnimations) {
            animSetData.ballisticAnimations = {};
        }

        // Cache key is the property name (includes angle)
        if (!animSetData.ballisticAnimations[ballisticPropertyName]) {
            const spriteAnimationCollection = rawData.animationCollection;
            console.warn('[Ballistic] Loading animations from collection:', spriteAnimationCollection);
            animSetData.ballisticAnimations[ballisticPropertyName] =
                this.loadAnimationsFromCollections(ballisticAnimationNames, spriteAnimationCollection);
        }

        const ballisticAnimData = animSetData.ballisticAnimations[ballisticPropertyName];
        if (!ballisticAnimData) {
            console.warn('[Ballistic] Failed to load ballistic animation data');
            return;
        }

        // Get direction name for lookup
        const directionName = this.directionNames[directionIndex];
        const directionData = ballisticAnimData[directionName];
        if (!directionData?.frames?.[0]) {
            console.warn('[Ballistic] No direction data or frames for:', directionName, 'Available directions:', Object.keys(ballisticAnimData));
            return;
        }

        // Apply the ballistic frame directly using the same logic as applyBillboardAnimationFrame
        const entityRenderer = this.game.call('getEntityRenderer');
        if (!entityRenderer) {
            console.warn('[Ballistic] No entity renderer');
            return;
        }

        const renderData = entityRenderer.billboardAnimations?.get(entityId);
        if (!renderData) {
            console.warn('[Ballistic] No render data for entity:', entityId);
            return;
        }

        const frame = directionData.frames[animState.spriteFrameIndex % directionData.frames.length];
        if (!frame) {
            console.warn('[Ballistic] No frame at index:', animState.spriteFrameIndex);
            return;
        }

        const batch = renderData.batch;
        const instanceIndex = renderData.instanceIndex;

        // Ballistic sprites are on the same sheet as regular sprites
        if (batch?.spriteSheetTexture) {
            const sheetWidth = batch.textureWidth || batch.spriteSheetTexture.image?.width;
            const sheetHeight = batch.textureHeight || batch.spriteSheetTexture.image?.height;

            if (sheetWidth && sheetHeight) {
                const offsetX = frame.x / sheetWidth;
                const offsetY = frame.y / sheetHeight;
                const scaleX = frame.width / sheetWidth;
                const scaleY = frame.height / sheetHeight;

               
                batch.attributes.uvOffset.setXY(instanceIndex, offsetX, offsetY);
                batch.attributes.uvScale.setXY(instanceIndex, scaleX, scaleY);
                batch.attributes.uvOffset.needsUpdate = true;
                batch.attributes.uvScale.needsUpdate = true;
            }
        }
    }

    determineDesiredAnimation(entityId, velocity, health, combat, aiState) {
        let clip = this.enums.animationType.idle;
        let speed = 1.0;
        let minTime = 0;

        if(this.game.state.phase === this.enums.gamePhase.battle){
            // Check movement first
            const isMoving = velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD);

            if (isMoving) {
                clip = this.enums.animationType.walk;
                speed = this.calculateWalkSpeed(velocity);
            }

            // AI action overrides based on currentAction (collection + index)
            // Only check behaviorActions collection (aiState enum index 0)
            if (aiState && aiState.currentAction >= 0 && aiState.currentActionCollection === this.enums.behaviorCollection.behaviorActions) {
                const actionType = aiState.currentAction;

                if (actionType === this.enums.behaviorActions.AttackEnemyBehaviorAction ||
                    actionType === this.enums.behaviorActions.CombatBehaviorAction) {
                    // During combat, prefer walking if moving, otherwise idle
                    if (!isMoving) {
                        clip = this.enums.animationType.idle;
                        speed = 1.0;
                    }
                } else if (actionType === this.enums.behaviorActions.MoveBehaviorAction) {
                    clip = this.enums.animationType.walk;
                    speed = this.calculateWalkSpeed(velocity);
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

    changeAnimation(entityId, clip, speed = 1.0, minTime = 0) {
        const animState = this.game.getComponent(entityId, "animationState");
        if (!animState) return false;

        // Convert numeric enum to string clip name for render system
        const clipName = typeof clip === 'number' ? this.animationTypeNames[clip] : clip;

        // Try to resolve clip name to available clip
        const resolvedClip = this.resolveClipName(entityId, clipName);

        // Apply animation change
        const success = this.game.renderSystem?.setInstanceClip(entityId, resolvedClip, true);
        if (success) {
            this.game.renderSystem?.setInstanceSpeed(entityId, speed);

            // Update state (store numeric enum value)
            animState.currentClip = clip;
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
            if (clipName === this.enums.animationType.attack || clipName === this.enums.animationType.cast) {
                // Check if already playing this animation - don't restart it
                const billboardAnim = this.game.getComponent(entityId, 'animationState');
                if (billboardAnim && billboardAnim.spriteAnimationType === clipName) {
                    return true;  // Already playing, don't restart
                }

                // Set animation (single-play, not looping)
                // When animation completes, return to idle
                // Use minTime as customDuration to pace the animation
                this.game.call(
                    'setBillboardAnimation',
                    entityId,
                    clipName,
                    false,  // don't loop - play once
                    (completedEntityId) => {
                        // Return to idle animation after animation finishes
                        this.game.call('setBillboardAnimation', completedEntityId, this.enums.animationType.idle, true);
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
                this.enums.animationType.death,
                false  // don't loop
            );
            return;
        }

        // Apply death animation immediately for VAT/model entities
        this.changeAnimation(entityId, this.enums.animationType.death, 1.0, 0);
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
        const celebrationClips = [this.enums.animationType.celebrate];
        let clipToUse = this.enums.animationType.idle;

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
        this.changeAnimation(entityId, this.enums.animationType.idle, 1.0, 0);
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

    isAnimationFinished(entityId, clip) {
        if (!this.SINGLE_PLAY_ANIMATIONS.has(clip)) {
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
     * Convert numeric renderable indices to string names
     */
    _getRenderableNames(renderable) {
        const objectTypeIndex = renderable.objectType;
        const spawnTypeIndex = renderable.spawnType;
        const collectionName = this.reverseEnums.objectTypeDefinitions?.[objectTypeIndex];
        const spawnTypeName = collectionName ? this.reverseEnums[collectionName]?.[spawnTypeIndex] : null;
        return { collectionName, spawnTypeName };
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

    hasClip(entityId, clip) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return false;

        const { collectionName, spawnTypeName } = this._getRenderableNames(renderable);
        if (!collectionName || !spawnTypeName) return false;

        // Convert numeric enum to string clip name
        const clipName = typeof clip === 'number' ? this.animationTypeNames[clip] : clip;

        const clipSet = this._getClipSet(collectionName, spawnTypeName);
        return clipSet?.has(clipName) || false;
    }

    resolveClipName(entityId, desiredClip) {
        const renderable = this.game.getComponent(entityId, "renderable");
        if (!renderable) return 'idle';

        const { collectionName, spawnTypeName } = this._getRenderableNames(renderable);
        if (!collectionName || !spawnTypeName) return 'idle';

        const clipSet = this._getClipSet(collectionName, spawnTypeName);
        if (!clipSet) return 'idle';

        // Return if exact match exists (O(1) Set lookup)
        if (clipSet.has(desiredClip)) {
            return desiredClip;
        }

        // Return idle if desired clip not found
        return 'idle';
    }

    // Cleanup is handled automatically by ECS when entities are destroyed

    destroy() {
        // Components are managed by the ECS, no cleanup needed here
    }

    /**
     * Clean up when entity is destroyed
     */
    entityDestroyed(entityId) {
        this._animationCallbacks.delete(entityId);
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
     * @param {number} animationType - Animation type enum value (idle, walk, attack, death, celebrate)
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
        if (this.isEntityDead(entityId) && animationType !== this.enums.animationType.death) {
            return false;
        }

        // Convert numeric enum to string for animation data lookup
        const animationTypeName = this.animationTypeNames[animationType];

        // Get sprite animations from shared cache
        const spriteAnimations = this._getSpriteAnimations(animData);

        // Check if animation type is available
        if (!spriteAnimations?.[animationTypeName]) {
            console.warn(`[AnimationSystem] Animation type '${animationTypeName}' not available for entity ${entityId}`);
            return false;
        }

        // If already in this animation type, don't restart
        if (animData.spriteAnimationType === animationType) {
            return true;
        }

        // Set up new animation (store numeric enum value)
        animData.spriteAnimationType = animationType;
        animData.spriteFrameIndex = 0;
        animData.spriteFrameTime = 0;
        animData.spriteLoopAnimation = loop ? 1 : 0;
        animData.customDuration = customDuration; // Custom duration override for pacing

        // Store callback in system map (not on component - callbacks can't be serialized)
        if (onComplete) {
            this._animationCallbacks.set(entityId, onComplete);
        } else {
            this._animationCallbacks.delete(entityId);
        }

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

            // Get sprite animations from shared cache
            const spriteAnimations = this._getSpriteAnimations(animState);
            if (!spriteAnimations) continue;

            // Get animations for current type - convert numeric enum to string for lookup
            const animationTypeName = this.animationTypeNames[animState.spriteAnimationType];
            const animations = spriteAnimations[animationTypeName];
            if (!animations) continue;

            const directionName = this.directionNames[animState.spriteDirection];
            const directionData = animations[directionName];
            if (!directionData || !directionData.frames || directionData.frames.length === 0) continue;

            const frames = directionData.frames;
            // For non-looping animations, check if already finished (past the last frame)
            if (!animState.spriteLoopAnimation && animState.spriteFrameIndex >= frames.length) {
                continue;
            }

            // Update frame time
            animState.spriteFrameTime += this.game.state.deltaTime;

            // Calculate frame duration based on fps from animation set
            // Note: spriteFps defaults to -1 in TypedArray storage, so check for > 0
            const fps = (animState.spriteFps > 0 ? animState.spriteFps : null) || frameRates[animState.spriteAnimationType] || defaultFrameRate;
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

                        // Call completion callback if set (stored in system map)
                        const callback = this._animationCallbacks.get(entityId);
                        if (callback) {
                            this._animationCallbacks.delete(entityId);
                            callback(entityId);
                        } else {
                            // Default behavior: return to idle for single-play animations (except death)
                            // Death animations should stay frozen on the last frame
                            if (this.SINGLE_PLAY_ANIMATIONS.has(animState.spriteAnimationType) &&
                                animState.spriteAnimationType !== this.enums.animationType.death) {
                                this.game.call('setBillboardAnimation', entityId, this.enums.animationType.idle, true);
                            }
                        }
                        break; // Exit loop for non-looping animations
                    }
                }
            }
            // Tell EntityRenderer to apply new frame if it changed
            // Skip if this is a projectile with active ballistic angle - ballistic update handles rendering
            if (frameChanged && animState.ballisticAngle < 0) {
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

        // Get numeric index for the sprite animation set
        const spriteAnimationSetIndex = this.enums.spriteAnimationSets[spriteAnimationSet];
        if (spriteAnimationSetIndex === undefined) {
            console.warn(`[AnimationSystem] No enum index found for spriteAnimationSet '${spriteAnimationSet}'`);
            return;
        }

        // Get animation data from collections
        const animSetData = this.collections?.spriteAnimationSets?.[spriteAnimationSet];
        if (!animSetData) {
            console.warn(`[AnimationSystem] No animation set found for ${spriteAnimationSet}`);
            return;
        }

        // Check if animation data is already cached for this animation set
        let cachedData = this.spriteAnimationCache.get(spriteAnimationSetIndex);
        if (!cachedData) {
            // Build animation data structure from collections (once per animation set type)
            // Animation data is stored keyed by string names (idle, walk, etc.) for lookup
            const animations = {};

            for (let i = 0; i < this.animationTypeNames.length; i++) {
                const animTypeName = this.animationTypeNames[i];
                const animKey = `${animTypeName}SpriteAnimations`;
                const animNames = animSetData[animKey];

                if (animNames && animNames.length > 0) {
                    animations[animTypeName] = this.loadAnimationsFromCollections(animNames, spriteAnimationCollection);
                }
            }

            // Get fps from animation set's generator settings
            const animationFps = animSetData.generatorSettings?.fps || -1;

            // Cache the shared animation data
            // Include rawAnimSetData for accessing ballistic animation properties at runtime
            cachedData = {
                animations,
                fps: animationFps,
                rawAnimSetData: animSetData  // For ballistic angle sprite lookup
            };
            this.spriteAnimationCache.set(spriteAnimationSetIndex, cachedData);
        }

        // Determine initial direction based on entity type and team
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        const team = this.game.getComponent(entityId, 'team');
        const isBuilding = unitType?.collection === 'buildings';

        let initialDirection;
        if (isBuilding) {
            // Buildings face downleft for better isometric view
            initialDirection = this.enums.direction.downleft;
        } else {
            // Units face based on their team
            // Team 'left' faces upright (toward opponent on right)
            // Team 'right' faces downleft (toward opponent on left)
            initialDirection = team?.team === this.enums.team.left ? this.enums.direction.upright : this.enums.direction.downleft;
        }

        // Ensure animationState component exists, then add billboard-specific properties
        if (!this.game.hasComponent(entityId, 'animationState')) {
            this.initializeEntityAnimationState(entityId);
        }

        const animState = this.game.getComponent(entityId, 'animationState');
        if (animState) {
            // Store only numeric values - animation data is in shared cache
            animState.spriteAnimationSet = spriteAnimationSetIndex;
            animState.spriteFps = cachedData.fps;
            animState.spriteAnimationType = null; // No animation set yet
            animState.spriteDirection = initialDirection;
            animState.spriteFrameIndex = 0;
            animState.spriteFrameTime = 0;
            animState.spriteLoopAnimation = true;
            animState.isSprite = true;
        }

        // Apply initial idle animation (sets UV coordinates)
        this.setBillboardAnimation(entityId, this.enums.animationType.idle, true);

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
        const collections = this.collections;
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
     * Handles ballistic angle suffixes like "Up45", "Down90", "Level"
     */
    extractDirectionFromName(animName) {
        // Remove ballistic angle suffixes before extracting direction
        // Order matters: check longer patterns first
        const ballisticSuffixes = ['up90', 'up45', 'down90', 'down45', 'level'];
        let lowerName = animName.toLowerCase();

        for (const suffix of ballisticSuffixes) {
            if (lowerName.endsWith(suffix)) {
                lowerName = lowerName.slice(0, -suffix.length);
                break;
            }
        }

        // Check compound directions first (longest to shortest) to avoid false matches
        const directions = ['downleft', 'downright', 'upleft', 'upright', 'down', 'up', 'left', 'right'];

        for (const dir of directions) {
            if (lowerName.endsWith(dir)) {
                return dir;
            }
        }

        return null;
    }

    onSceneUnload() {
        // Clear sprite animation cache on scene unload
        this.spriteAnimationCache.clear();
    }

    dispose() {
        // Clear cached clip sets to avoid stale data on next game
        this._clipSetCache.clear();
        // Clear sprite animation cache
        this.spriteAnimationCache.clear();
    }
}
