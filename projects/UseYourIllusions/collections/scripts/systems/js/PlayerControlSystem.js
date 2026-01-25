/**
 * PlayerControlSystem - Handles direct player input for the illusionist character
 *
 * Controls:
 * - W/S: Move forward/backward relative to facing direction
 * - A/D: Strafe left/right relative to facing direction
 * - Mouse: Control facing direction (via CameraControlSystem)
 * - Q/E/R: Use assigned ability slots
 * - 1/2/3: Select belt slot for placing illusions
 * - I: Toggle inventory UI
 * - Click with item selected: Place illusion (triggers PlaceIllusionAbility)
 */
class PlayerControlSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'addAbilitiesToUnit',
        'canMoveToPosition',
        'clearEntityPath',
        'getCamera',
        'getFacingAngle',
        'getPreviewPosition',
        'getTerrainHeightAtPosition',
        'getWorldPositionFromMouse',
        'getWorldScene',
        'playSound',
        'playSynthSound',
        'setBillboardAnimation',
        'setBillboardAnimationDirection',
        'setFollowTarget',
        'storeBeltItem',
        'toggleInventoryUI',
        'useAbility'
    ];

    static services = [
        'getPlayerEntity',
        'setPlayerMoveTarget',
        'getSelectedBeltSlot',
        'setSelectedBeltSlot',
        'getBeltContents',
        'storeBeltItem',
        'consumeBeltItem',
        'toggleCloneControl',
        'triggerCollectAbility',
        'grantItem',
        'useAbilitySlot'
    ];

    constructor(game) {
        super(game);
        this.game.playerControlSystem = this;

        this.WASD_SPEED = 60;
        this.wasdInput = { forward: 0, strafe: 0 }; // forward: W/S, strafe: A/D
        this.isWASDMoving = false;

        this._keydownHandler = null;
        this._keyupHandler = null;
        this._clickHandler = null;
        this._wasMoving = false;
        this._lastDirection = null;
        this._lastCameraTarget = null;

        // Footstep sound state
        this._footstepInterval = 0.5; // Time between footsteps in seconds
        this._lastFootstepTime = 0;
        this._footstepSide = 0; // 0 = left, 1 = right (alternates)

        // Collect beam state
        this.collectModeActive = false;
        this.highlightedCollectible = null;
        this.highlightedMirror = null;
        this.collectBeamMaxRange = 200;
        this.collectBeamLine = null;
        this.collectBeamGeometry = null;
        this.collectBeamMaterial = null;

        // Container highlighting state (for E key interaction)
        this.highlightedContainer = null;
        this.containerHighlightRange = 80; // Range to detect containers

        // Sign post highlighting state
        this.highlightedSignPost = null;
        this.signPostHighlightRange = 100; // Range to detect sign posts
    }

    init() {
        // Keyboard controls are set up in onSceneLoad when canvas is ready
    }

    onSceneLoad(sceneData) {
        this._updateCount = 0; // Reset update counter for logging
        this._lastCameraTarget = null; // Reset camera target tracking so it gets set on first update
        // Clean up any existing listeners first to prevent duplicates
        this.cleanupEventListeners();
        this.setupKeyboardControls();
        this.setupCanvasClickHandler();
    }

    postSceneLoad(sceneData) {
    }

    onSceneUnload() {
        this.cleanupEventListeners();

        // Clean up collect beam
        this.deactivateCollectMode();
        this.removeCollectBeam();

        // Clean up container highlight
        if (this.highlightedContainer) {
            this.setContainerTint(this.highlightedContainer, null);
            this.highlightedContainer = null;
        }

        // Clean up sign post highlight
        if (this.highlightedSignPost) {
            this.setContainerTint(this.highlightedSignPost, null);
            this.highlightedSignPost = null;
        }
    }

    setupKeyboardControls() {
        this._keydownHandler = (event) => this.handleKeyDown(event);
        this._keyupHandler = (event) => this.handleKeyUp(event);

        document.addEventListener('keydown', this._keydownHandler);
        document.addEventListener('keyup', this._keyupHandler);
    }

    setupCanvasClickHandler() {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;

        this._clickHandler = (event) => this.handleCanvasClick(event);
        this._leftClickHandler = (event) => this.handleLeftClick(event);
        canvas.addEventListener('contextmenu', this._clickHandler);
        canvas.addEventListener('click', this._leftClickHandler);
    }

    cleanupEventListeners() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        if (this._keyupHandler) {
            document.removeEventListener('keyup', this._keyupHandler);
        }
        const canvas = document.getElementById('gameCanvas');
        if (this._clickHandler) {
            canvas?.removeEventListener('contextmenu', this._clickHandler);
        }
        if (this._leftClickHandler) {
            canvas?.removeEventListener('click', this._leftClickHandler);
        }
    }

    handleKeyDown(event) {
        const playerEntity = this.getPlayerEntity();
        if (!playerEntity) return;

        switch (event.code) {
            case 'KeyW':
                this.wasdInput.forward = 1;
                this.isWASDMoving = true;
                break;
            case 'KeyS':
                this.wasdInput.forward = -1;
                this.isWASDMoving = true;
                break;
            case 'KeyA':
                this.wasdInput.strafe = -1; // strafe left
                this.isWASDMoving = true;
                break;
            case 'KeyD':
                this.wasdInput.strafe = 1; // strafe right
                this.isWASDMoving = true;
                break;
            case 'KeyQ':
                // Q = ability slot (for item abilities like Collect)
                this.useAbilitySlot(playerEntity, 'slotQ');
                break;
            case 'KeyE':
                // E = world interaction (containers, sign posts, doors)
                this.tryWorldInteraction(playerEntity);
                break;
            case 'KeyI':
                // Toggle inventory UI
                if (this.game.hasService('toggleInventoryUI')) {
                    this.call.toggleInventoryUI();
                }
                break;
            case 'KeyR':
                // R = swap control to clone
                this.toggleCloneControl(playerEntity);
                break;
            case 'Digit1':
                this.setSelectedBeltSlot(playerEntity, 0);
                break;
            case 'Digit2':
                this.setSelectedBeltSlot(playerEntity, 1);
                break;
            case 'Digit3':
                this.setSelectedBeltSlot(playerEntity, 2);
                break;
        }
    }

    handleKeyUp(event) {
        switch (event.code) {
            case 'KeyW':
                if (this.wasdInput.forward > 0) this.wasdInput.forward = 0;
                break;
            case 'KeyS':
                if (this.wasdInput.forward < 0) this.wasdInput.forward = 0;
                break;
            case 'KeyA':
                if (this.wasdInput.strafe < 0) this.wasdInput.strafe = 0;
                break;
            case 'KeyD':
                if (this.wasdInput.strafe > 0) this.wasdInput.strafe = 0;
                break;
        }

        if (this.wasdInput.forward === 0 && this.wasdInput.strafe === 0) {
            this.isWASDMoving = false;
        }
    }

    handleCanvasClick(event) {
        event.preventDefault();

        const playerEntity = this.getPlayerEntity();
        if (!playerEntity) return;

        const worldPos = this.call.getWorldPositionFromMouse( event.clientX, event.clientY);
        if (!worldPos) return;

        // Right-click = move to position
        this.setPlayerMoveTarget(playerEntity, worldPos);
    }

    handleLeftClick(event) {
        // Left-click places illusion when pointer is locked and item is selected
        const cameraSystem = this.game.cameraControlSystem;
        if (!cameraSystem || !cameraSystem.isPointerLocked) {
            // Not locked yet - the CameraControlSystem will request pointer lock
            return;
        }

        const playerEntity = this.getPlayerEntity();
        if (!playerEntity) return;

        const belt = this.game.getComponent(playerEntity, 'magicBelt');
        if (!belt) return;

        // Check if a slot is actively selected
        const selectedSlot = belt.selectedSlot;
        if (selectedSlot < 0) {
            // No slot active, nothing to place
            return;
        }

        const slotKey = `slot${selectedSlot}`;
        const selectedItemIndex = belt[slotKey];

        // null means empty slot
        if (selectedItemIndex === null) {
            // No item in selected slot, nothing to place
            return;
        }

        // Convert index to string name
        const reverseEnums = this.game.getReverseEnums();
        const selectedItem = reverseEnums.worldObjects?.[selectedItemIndex];
        if (!selectedItem) return;

        // Get preview position from IllusionPreviewSystem
        let targetPos = null;
        if (this.game.hasService('getPreviewPosition')) {
            targetPos = this.call.getPreviewPosition();
        }

        if (!targetPos || (targetPos.x === 0 && targetPos.z === 0)) {
            // Fallback: calculate position in front of player
            const transform = this.game.getComponent(playerEntity, 'transform');
            if (!transform || !transform.position) return;

            const facingAngle = this.game.hasService('getFacingAngle')
                ? this.call.getFacingAngle()
                : 0;

            const distance = 100;
            targetPos = {
                x: transform.position.x + Math.cos(facingAngle) * distance,
                y: 0,
                z: transform.position.z + Math.sin(facingAngle) * distance
            };
        }

        // Place illusion at target position
        this.triggerPlaceIllusionAbility(playerEntity, targetPos, selectedItem);
    }

    update() {


        const playerEntity = this.getPlayerEntity();
        if (!playerEntity) return;

        const playerController = this.game.getComponent(playerEntity, 'playerController');

        // Check for clone expiration
        this.updateCloneExpiration(playerEntity, playerController);

        // Determine which entity to control (player or clone)
        const controlledEntity = this.getControlledEntity(playerEntity, playerController);

        // Handle WASD movement for the controlled entity
        if (this.isWASDMoving) {
            // Set walk animation only when starting to move
            if (!this._wasMoving && this.game.hasService('setBillboardAnimation')) {
                this.call.setBillboardAnimation( controlledEntity, this.enums.animationType.walk, true);
            }
            this.updateWASDMovement(controlledEntity);
            this.playFootstepSound();
        } else if (this._wasMoving) {
            // Just stopped moving - set idle animation
            if (this.game.hasService('setBillboardAnimation')) {
                this.call.setBillboardAnimation( controlledEntity, this.enums.animationType.idle, true);
            }
        }
        this._wasMoving = this.isWASDMoving;

        // Update camera to follow controlled entity
        this.updateCameraTarget(controlledEntity);

        // Update collect beam if in collect mode
        this.updateCollectBeam(controlledEntity);

        // Update container highlighting (for E key interaction)
        this.updateContainerHighlight(controlledEntity);

        // Update sign post highlighting (for E key interaction)
        this.updateSignPostHighlight(controlledEntity);
    }

    /**
     * Get the entity currently being controlled (player or their clone)
     */
    getControlledEntity(playerEntity, playerController) {
        if (playerController?.controllingClone && playerController?.activeCloneId) {
            if (this.game.hasEntity(playerController.activeCloneId)) {
                return playerController.activeCloneId;
            }
            // Clone no longer exists, reset state
            playerController.activeCloneId = null;
            playerController.controllingClone = false;
        }
        return playerEntity;
    }

    /**
     * Update camera to follow the controlled entity
     */
    updateCameraTarget(entityId) {
        if (this._lastCameraTarget !== entityId) {
            this._lastCameraTarget = entityId;
            if (this.game.hasService('setFollowTarget')) {
                this.call.setFollowTarget( entityId);
            }
        }
    }

    /**
     * Check for clone expiration and clean up
     */
    updateCloneExpiration(playerEntity, playerController) {
        if (!playerController?.activeCloneId) return;

        const cloneId = playerController.activeCloneId;
        if (!this.game.hasEntity(cloneId)) {
            // Clone already destroyed
            playerController.activeCloneId = null;
            playerController.controllingClone = false;
            return;
        }

        const playerClone = this.game.getComponent(cloneId, 'playerClone');
        if (!playerClone) return;

        const now = this.game.state.now || 0;
        if (now >= playerClone.expiresAt) {
            // Clone expired - destroy it and return control to player
            this.destroyClone(playerEntity, playerController, cloneId);
        }
    }

    /**
     * Toggle control between player and clone (R key)
     * Only works when a clone exists - clones are created via mirror beam
     */
    toggleCloneControl(playerEntity) {
        const playerController = this.game.getComponent(playerEntity, 'playerController');
        if (!playerController) return;

        // Only toggle if clone exists
        if (!playerController.activeCloneId || !this.game.hasEntity(playerController.activeCloneId)) {
            // No clone exists - do nothing (clones created via mirror beam)
            return;
        }

        playerController.controllingClone = !playerController.controllingClone;

        // Play clone swap sound
        this.call.playSound( 'sounds', 'clone_swap');

        // Play effect at the entity we're switching to
        const targetEntity = playerController.controllingClone
            ? playerController.activeCloneId
            : playerEntity;
        const transform = this.game.getComponent(targetEntity, 'transform');
        if (transform?.position && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                transform.position.x,
                transform.position.y + 30,
                transform.position.z,
                'magic',
                { count: 15, scaleMultiplier: 0.8 }
            );
        }
    }

    /**
     * Destroy clone and return control to player
     */
    destroyClone(playerEntity, playerController, cloneId) {
        // Create expire effect
        const transform = this.game.getComponent(cloneId, 'transform');
        if (transform?.position && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                transform.position.x,
                transform.position.y + 30,
                transform.position.z,
                'magic',
                { count: 25, scaleMultiplier: 1.0 }
            );
        }

        // Play clone disappear sound
        this.call.playSound( 'sounds', 'clone_disappear');

        // Destroy the clone entity
        this.game.destroyEntity(cloneId);

        // Reset player controller state
        playerController.activeCloneId = null;
        playerController.controllingClone = false;

        this.game.triggerEvent('onCloneExpired', { cloneId, playerEntity });
    }

    /**
     * Check if a position is valid (no cliff/height change in buffer zone)
     */
    isPositionValid(fromX, fromZ, toX, toZ, buffer) {
        // Check destination and buffer points around it
        const checkPoints = [
            { x: toX, z: toZ },
            { x: toX + buffer, z: toZ },
            { x: toX - buffer, z: toZ },
            { x: toX, z: toZ + buffer },
            { x: toX, z: toZ - buffer }
        ];

        for (const point of checkPoints) {
            if (!this.call.canMoveToPosition( fromX, fromZ, point.x, point.z)) {
                return false;
            }
        }
        return true;
    }

    updateWASDMovement(entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        const playerController = this.game.getComponent(entityId, 'playerController');

        if (!transform || !transform.position) {
            return;
        }

        const speed = playerController?.movementSpeed || this.WASD_SPEED;
        const dt = this.game.state.deltaTime || 1/60;

        // Get facing angle from CameraControlSystem (mouse-controlled)
        const facingAngle = this.game.hasService('getFacingAngle')
            ? this.call.getFacingAngle()
            : (transform.rotation.y || 0);

        // Calculate movement direction
        // Forward/backward is along facing direction
        // Strafe is perpendicular to facing direction (90 degrees offset)
        let moveX = 0;
        let moveZ = 0;

        // W/S = move forward/backward in facing direction
        if (this.wasdInput.forward !== 0) {
            moveX += Math.cos(facingAngle) * this.wasdInput.forward;
            moveZ += Math.sin(facingAngle) * this.wasdInput.forward;
        }

        // A/D = strafe left/right (perpendicular to facing)
        if (this.wasdInput.strafe !== 0) {
            // Strafe direction is 90 degrees from facing
            const strafeAngle = facingAngle + Math.PI / 2;
            moveX += Math.cos(strafeAngle) * this.wasdInput.strafe;
            moveZ += Math.sin(strafeAngle) * this.wasdInput.strafe;
        }

        // Normalize diagonal movement to prevent faster diagonal speed
        const moveLength = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLength > 0) {
            moveX = (moveX / moveLength) * speed * dt;
            moveZ = (moveZ / moveLength) * speed * dt;

            // Check if movement is allowed (height/cliff check)
            const newX = transform.position.x + moveX;
            const newZ = transform.position.z + moveZ;

            // Buffer distance to prevent getting too close to walls/cliffs
            const wallBuffer = 8;
            const curX = transform.position.x;
            const curZ = transform.position.z;

            let finalX = newX;
            let finalZ = newZ;

            if (this.game.hasService('canMoveToPosition')) {
                // Check if full movement is allowed (with buffer points)
                const canMoveBoth = this.isPositionValid(curX, curZ, newX, newZ, wallBuffer);
                const canMoveX = this.isPositionValid(curX, curZ, newX, curZ, wallBuffer);
                const canMoveZ = this.isPositionValid(curX, curZ, curX, newZ, wallBuffer);

                if (canMoveBoth) {
                    // Full diagonal movement allowed
                    finalX = newX;
                    finalZ = newZ;
                } else if (canMoveX && !canMoveZ) {
                    // Only X movement allowed - slide along wall
                    finalX = newX;
                    finalZ = curZ;
                } else if (!canMoveX && canMoveZ) {
                    // Only Z movement allowed - slide along wall
                    finalX = curX;
                    finalZ = newZ;
                } else {
                    // Neither direction allowed - stop
                    const velocity = this.game.getComponent(entityId, 'velocity');
                    if (velocity) {
                        velocity.vx = 0;
                        velocity.vz = 0;
                    }
                    return;
                }
            }

            transform.position.x = finalX;
            transform.position.z = finalZ;

            // Snap to terrain height
            if (this.game.hasService('getTerrainHeightAtPosition')) {
                const terrainHeight = this.call.getTerrainHeightAtPosition( finalX, finalZ);
                if (terrainHeight !== null) {
                    transform.position.y = terrainHeight;
                }
            }

            // Set velocity so AnimationSystem knows we're moving (for walk animation)
            const velocity = this.game.getComponent(entityId, 'velocity');
            if (velocity) {
                velocity.vx = (moveX / dt);
                velocity.vz = (moveZ / dt);
            }
        } else {
            const velocity = this.game.getComponent(entityId, 'velocity');
            if (velocity) {
                velocity.vx = 0;
                velocity.vz = 0;
            }
        }

        // Update animation direction based on facing
        this.updateAnimationDirection(entityId, facingAngle);

        // Clear any click-to-move order when using WASD
        const playerOrder = this.game.getComponent(entityId, 'playerOrder');
        if (playerOrder && playerOrder.enabled) {
            playerOrder.enabled = false;
            playerOrder.completed = true;
        }
    }

    /**
     * Play footstep sounds while walking
     */
    playFootstepSound() {
        const now = this.game.state.now || 0;

        // Check if enough time has passed since last footstep (now is in seconds)
        if (now - this._lastFootstepTime < this._footstepInterval) {
            return;
        }

        // Calculate distance to camera for volume attenuation
        const controlledEntity = this.game.getEntitiesWith('playerControlled')[0];
        const playerPos = controlledEntity ? this.game.getComponent(controlledEntity, 'transform')?.position : null;

        let distanceVolume = 1.0;
        if (playerPos) {
            const camera = this.game.hasService('getCamera') ? this.call.getCamera() : null;
            if (camera?.position) {
                const dx = playerPos.x - camera.position.x;
                const dz = playerPos.z - camera.position.z;
                const distanceToCamera = Math.sqrt(dx * dx + dz * dz);

                const refDistance = 100;   // Full volume within this distance
                const maxDistance = 500;  // Silent beyond this distance

                if (distanceToCamera >= maxDistance) {
                    // Too far, skip playing
                    this._lastFootstepTime = now;
                    this._footstepSide = 1 - this._footstepSide;
                    return;
                }

                // Linear falloff for more predictable attenuation
                if (distanceToCamera > refDistance) {
                    distanceVolume = 1.0 - (distanceToCamera - refDistance) / (maxDistance - refDistance);
                    distanceVolume = Math.max(0, distanceVolume);
                }
            }
        }

        // Play alternating left/right footstep
        const soundName = this._footstepSide === 0 ? 'footstep_left' : 'footstep_right';

        // Get sound config and apply random variations
        const soundConfig = this.game.getCollections()?.sounds?.[soundName]?.audio;
        if (soundConfig) {
            // Clone config and apply random variations
            const config = JSON.parse(JSON.stringify(soundConfig));

            // Random pitch variation (0.85 to 1.15)
            const pitchVariation = 0.85 + Math.random() * 0.3;
            config.frequency = (config.frequency || 200) * pitchVariation;

            // Apply distance-based volume attenuation
            const baseVolume = (config.volume || 0.2) * (0.8 + Math.random() * 0.2);
            config.volume = baseVolume * distanceVolume;

            // Slight random filter cutoff variation
            if (config.effects?.filter) {
                config.effects.filter.frequency *= (0.9 + Math.random() * 0.2);
            }

            // Slight random pan variation
            if (config.effects) {
                const basePan = config.effects.pan || 0;
                config.effects.pan = basePan + (Math.random() - 0.5) * 0.15;
            }

            // Pass volume as options parameter - config.volume isn't used by AudioManager
            const finalVolume = config.volume;
            this.call.playSynthSound( `footstep_${Date.now()}`, config, { volume: finalVolume });
        }

        // Update state
        this._lastFootstepTime = now;
        this._footstepSide = 1 - this._footstepSide; // Toggle between 0 and 1
    }

    updateAnimationDirection(entityId, angle) {
        if (!this.game.hasService('setBillboardAnimationDirection')) return;

        // Convert angle to 8-direction enum
        // Angle is in radians, 0 = +X (east), PI/2 = +Z (south), etc.
        // Normalize to 0-2PI range
        let normalizedAngle = angle;
        while (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
        while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2;

        // Map angle to direction enum (8 directions)
        // Each direction covers 45 degrees (PI/4 radians)
        const directionIndex = Math.round(normalizedAngle / (Math.PI / 4)) % 8;

        // Direction enum mapping: 0=down, 1=downLeft, 2=left, 3=upLeft, 4=up, 5=upRight, 6=right, 7=downRight
        // Angle mapping: 0=east(+X), PI/2=south(+Z), PI=west(-X), 3PI/2=north(-Z)
        // We need to map angles to directions based on camera perspective
        const angleToDirection = [
            this.enums.direction.right,      // 0: +X (east)
            this.enums.direction.downRight,  // PI/4: SE
            this.enums.direction.down,       // PI/2: +Z (south)
            this.enums.direction.downLeft,   // 3PI/4: SW
            this.enums.direction.left,       // PI: -X (west)
            this.enums.direction.upLeft,     // 5PI/4: NW
            this.enums.direction.up,         // 3PI/2: -Z (north)
            this.enums.direction.upRight     // 7PI/4: NE
        ];

        const direction = angleToDirection[directionIndex];

        // Only update if direction changed to avoid resetting animation frame
        if (direction !== this._lastDirection) {
            this._lastDirection = direction;
            this.call.setBillboardAnimationDirection( entityId, direction);
        }
    }

    getPlayerEntity() {
        const entities = this.game.getEntitiesWith('playerController', 'transform');
        return entities.length > 0 ? entities[0] : null;
    }

    setPlayerMoveTarget(entityId, position) {
        let playerOrder = this.game.getComponent(entityId, 'playerOrder');
        if (!playerOrder) {
            this.game.addComponent(entityId, 'playerOrder', {});
            playerOrder = this.game.getComponent(entityId, 'playerOrder');
        }

        playerOrder.targetPositionX = position.x || 0;
        playerOrder.targetPositionY = position.y || 0;
        playerOrder.targetPositionZ = position.z || 0;
        playerOrder.isMoveOrder = true;
        playerOrder.preventEnemiesInRangeCheck = true;
        playerOrder.completed = false;
        playerOrder.issuedTime = this.game.state.now;
        playerOrder.enabled = true;

        // Clear pathfinding to recalculate
        if (this.game.hasService('clearEntityPath')) {
            this.call.clearEntityPath( entityId);
        }

        const pathfinding = this.game.getComponent(entityId, 'pathfinding');
        if (pathfinding) {
            pathfinding.lastPathRequest = 0;
        }
    }

    getSelectedBeltSlot(entityId) {
        const belt = this.game.getComponent(entityId, 'magicBelt');
        return belt ? belt.selectedSlot : 0;
    }

    setSelectedBeltSlot(entityId, slotIndex) {
        const belt = this.game.getComponent(entityId, 'magicBelt');
        if (!belt) return;

        // Toggle off if pressing the same slot again
        if (belt.selectedSlot === slotIndex) {
            belt.selectedSlot = -1; // Deactivate
        } else {
            belt.selectedSlot = Math.max(0, Math.min(2, slotIndex));
        }
        this.game.triggerEvent('onBeltSelectionChanged', { entityId, slotIndex: belt.selectedSlot });
    }

    getBeltContents(entityId) {
        const belt = this.game.getComponent(entityId, 'magicBelt');
        if (!belt) return [null, null, null];

        return [belt.slot0, belt.slot1, belt.slot2];
    }

    storeBeltItem(entityId, objectType) {
        const belt = this.game.getComponent(entityId, 'magicBelt');
        if (!belt) return false;

        // Convert string objectType to enum index for storage
        const objectTypeIndex = this.enums.worldObjects?.[objectType];
        if (objectTypeIndex === undefined) return false;

        // Initialize nextSlot if not set
        if (belt.nextSlot === undefined) {
            belt.nextSlot = 0;
        }

        // Use the next slot in rotation (overwrites if full)
        const slotIndex = belt.nextSlot;
        const slotKey = `slot${slotIndex}`;
        belt[slotKey] = objectTypeIndex;

        // Advance to next slot (cycles 0 -> 1 -> 2 -> 0)
        belt.nextSlot = (slotIndex + 1) % 3;

        this.game.triggerEvent('onBeltUpdated', { entityId, slotIndex, objectType });
        return true;
    }

    consumeBeltItem(entityId, slotIndex) {
        const belt = this.game.getComponent(entityId, 'magicBelt');
        if (!belt) return null;

        const slotKey = `slot${slotIndex}`;
        const itemIndex = belt[slotKey];

        // null means empty
        if (itemIndex !== null) {
            belt[slotKey] = null;
            // Convert index back to string name
            const reverseEnums = this.game.getReverseEnums();
            const objectType = reverseEnums.worldObjects?.[itemIndex];
            this.game.triggerEvent('onBeltUpdated', { entityId, slotIndex, objectType: null });
            return objectType;
        }

        return null;
    }

    /**
     * Handle E key - toggle collect mode or collect/clone based on target
     */
    handleCollectAbility(entityId) {
        if (this.collectModeActive) {
            // Already in collect mode - check what we're targeting
            if (this.highlightedMirror) {
                // Targeting a mirror - create clone
                this.createCloneFromMirror(entityId);
            } else if (this.highlightedCollectible) {
                // Targeting a collectible - collect it
                this.collectHighlightedItem(entityId);
            }
            // Deactivate collect mode
            this.deactivateCollectMode();
        } else {
            // Activate collect mode
            this.activateCollectMode(entityId);
        }
    }

    activateCollectMode(entityId) {
        this.collectModeActive = true;
        this.highlightedCollectible = null;
        this.highlightedMirror = null;

        // Create the visual beam
        this.createCollectBeam();

        // Play activation sound
        this.call.playSound( 'sounds', 'collect_activate');

        // Notify UI
        this.game.triggerEvent('onCollectModeChanged', { active: true, entityId });
    }

    deactivateCollectMode() {
        if (!this.collectModeActive) return;

        // Clear highlight on previous collectible/mirror
        if (this.highlightedCollectible) {
            this.setCollectibleHighlight(this.highlightedCollectible, false);
        }
        if (this.highlightedMirror) {
            this.setCollectibleHighlight(this.highlightedMirror, false);
        }

        this.collectModeActive = false;
        this.highlightedCollectible = null;
        this.highlightedMirror = null;

        // Remove the visual beam
        this.removeCollectBeam();

        // Notify UI
        this.game.triggerEvent('onCollectModeChanged', { active: false });
    }

    collectHighlightedItem(entityId) {
        if (!this.highlightedCollectible) return;

        const collectible = this.game.getComponent(this.highlightedCollectible, 'collectible');
        if (!collectible) return;

        // Get object type from collectible
        const objectTypeIndex = collectible.objectType;
        const reverseEnums = this.game.getReverseEnums();
        const objectType = reverseEnums.worldObjects?.[objectTypeIndex];

        if (!objectType) return;

        // Store in belt
        const stored = this.call.storeBeltItem( entityId, objectType);
        if (!stored) return;

        // Get collectible position for effects
        const collectibleTransform = this.game.getComponent(this.highlightedCollectible, 'transform');
        const collectiblePos = collectibleTransform?.position;

        // Play collection effect
        if (collectiblePos && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                collectiblePos.x,
                collectiblePos.y + 20,
                collectiblePos.z,
                'sparkle',
                { count: 20, scaleMultiplier: 0.8, speedMultiplier: 1.2 }
            );
        }

        // Play collect sound
        this.call.playSound( 'sounds', 'collect_item');

        this.game.triggerEvent('onCollectibleCollected', {
            entityId,
            objectType,
            collectibleId: this.highlightedCollectible
        });
    }

    /**
     * Store a clone item in the belt when beam hits a mirror
     */
    createCloneFromMirror(entityId) {
        if (!this.highlightedMirror) return;

        // Store "clone" item in belt (like other collectibles)
        const stored = this.call.storeBeltItem( entityId, 'clone');
        if (!stored) {
            console.log('[PlayerControlSystem] Belt full, cannot store clone');
            return;
        }

        // Get mirror position for effects
        const mirrorTransform = this.game.getComponent(this.highlightedMirror, 'transform');
        if (mirrorTransform?.position && this.game.effectsSystem) {
            // Effect at mirror
            this.game.effectsSystem.createParticleEffect(
                mirrorTransform.position.x,
                mirrorTransform.position.y + 20,
                mirrorTransform.position.z,
                'magic',
                { count: 25, scaleMultiplier: 1.0 }
            );
        }

        // Play collect sound
        this.call.playSound( 'sounds', 'collect_item');

        this.game.triggerEvent('onCloneStored', { entityId });
    }

    /**
     * Create the visual collect beam using a cylinder mesh for better visibility
     */
    createCollectBeam() {
        const scene = this.call.getWorldScene();
        if (!scene || typeof THREE === 'undefined') return;

        // Clean up any existing beam
        this.removeCollectBeam();

        // Create a cylinder geometry for the beam (more visible than a line)
        // Cylinder along Y-axis, we'll rotate it to point in the right direction
        this.collectBeamGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);

        // Rotate geometry so it extends along Z-axis instead of Y
        this.collectBeamGeometry.rotateX(Math.PI / 2);

        // Glowing cyan/teal material
        this.collectBeamMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffaa,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });

        this.collectBeamLine = new THREE.Mesh(this.collectBeamGeometry, this.collectBeamMaterial);
        scene.add(this.collectBeamLine);
    }

    /**
     * Remove the visual collect beam
     */
    removeCollectBeam() {
        const scene = this.call.getWorldScene();
        if (this.collectBeamLine && scene) {
            scene.remove(this.collectBeamLine);
        }
        if (this.collectBeamGeometry) {
            this.collectBeamGeometry.dispose();
        }
        if (this.collectBeamMaterial) {
            this.collectBeamMaterial.dispose();
        }
        this.collectBeamLine = null;
        this.collectBeamGeometry = null;
        this.collectBeamMaterial = null;
    }

    /**
     * Update collect beam - find collectible or mirror in beam path and update visual
     */
    updateCollectBeam(entityId) {
        if (!this.collectModeActive) return;

        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        // Get facing angle from camera
        const facingAngle = this.game.hasService('getFacingAngle')
            ? this.call.getFacingAngle()
            : 0;

        const playerPos = transform.position;
        const beamStartY = playerPos.y + 8; // Start beam at hip height
        const beamEndX = playerPos.x + Math.cos(facingAngle) * this.collectBeamMaxRange;
        const beamEndZ = playerPos.z + Math.sin(facingAngle) * this.collectBeamMaxRange;

        // Find collectible or mirror along beam
        const { collectible: newCollectibleHighlight, mirror: newMirrorHighlight } = this.findTargetsAlongBeam(
            playerPos.x, playerPos.z,
            beamEndX, beamEndZ
        );

        // Get the primary target for beam visual (prioritize nearest)
        const primaryTarget = newMirrorHighlight || newCollectibleHighlight;

        // Update beam visual
        this.updateCollectBeamVisual(
            playerPos.x, beamStartY, playerPos.z,
            beamEndX, beamStartY, beamEndZ,
            primaryTarget,
            newMirrorHighlight // Pass mirror specifically for color change
        );

        // Update collectible highlight if changed
        if (newCollectibleHighlight !== this.highlightedCollectible) {
            if (this.highlightedCollectible) {
                this.setCollectibleHighlight(this.highlightedCollectible, false);
            }
            if (newCollectibleHighlight) {
                this.setCollectibleHighlight(newCollectibleHighlight, true);
            }
            this.highlightedCollectible = newCollectibleHighlight;
        }

        // Update mirror highlight if changed
        if (newMirrorHighlight !== this.highlightedMirror) {
            if (this.highlightedMirror) {
                this.setCollectibleHighlight(this.highlightedMirror, false);
            }
            if (newMirrorHighlight) {
                this.setCollectibleHighlight(newMirrorHighlight, true);
            }
            this.highlightedMirror = newMirrorHighlight;
        }

        // Notify for UI update
        this.game.triggerEvent('onCollectHighlightChanged', {
            collectibleId: newCollectibleHighlight,
            mirrorId: newMirrorHighlight
        });
    }

    /**
     * Update the visual beam cylinder
     */
    updateCollectBeamVisual(startX, startY, startZ, endX, endY, endZ, hasTarget, isMirror = false) {
        if (!this.collectBeamLine) return;

        // If we have a target, end beam at that target's position
        let finalEndX = endX;
        let finalEndY = endY;
        let finalEndZ = endZ;

        if (hasTarget) {
            const targetTransform = this.game.getComponent(hasTarget, 'transform');
            if (targetTransform?.position) {
                finalEndX = targetTransform.position.x;
                finalEndY = targetTransform.position.y + 20;
                finalEndZ = targetTransform.position.z;
            }
        }

        // Calculate beam direction and length
        const dx = finalEndX - startX;
        const dy = finalEndY - startY;
        const dz = finalEndZ - startZ;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Position beam at midpoint between start and end
        this.collectBeamLine.position.set(
            startX + dx / 2,
            startY + dy / 2,
            startZ + dz / 2
        );

        // Scale beam to correct length (geometry is unit length along Z)
        this.collectBeamLine.scale.set(1, 1, length);

        // Rotate beam to point from start to end
        this.collectBeamLine.lookAt(finalEndX, finalEndY, finalEndZ);

        // Change beam color based on target type
        if (isMirror) {
            this.collectBeamMaterial.color.setHex(0xff00ff); // Purple/magenta when targeting mirror
            this.collectBeamMaterial.opacity = 0.9;
        } else if (hasTarget) {
            this.collectBeamMaterial.color.setHex(0x00ff00); // Green when targeting collectible
            this.collectBeamMaterial.opacity = 0.8;
        } else {
            this.collectBeamMaterial.color.setHex(0x00ffaa); // Cyan normally
            this.collectBeamMaterial.opacity = 0.5;
        }
    }

    /**
     * Find the nearest collectible and mirror along a beam from start to end
     */
    findTargetsAlongBeam(startX, startZ, endX, endZ) {
        const beamWidth = 30; // Width of beam for collision detection

        let nearestCollectible = null;
        let nearestCollectibleDist = Infinity;
        let nearestMirror = null;
        let nearestMirrorDist = Infinity;

        // Check mirrors first (entities with mirror component)
        const mirrors = this.game.getEntitiesWith('mirror', 'transform');
        for (const entityId of mirrors) {
            const result = this.checkEntityInBeam(entityId, startX, startZ, endX, endZ, beamWidth);
            if (!result) continue;

            if (result.dist < nearestMirrorDist) {
                nearestMirrorDist = result.dist;
                nearestMirror = entityId;
            }
        }

        // Check collectibles (entities with collectible but not mirror component)
        const collectibles = this.game.getEntitiesWith('collectible', 'transform');
        for (const entityId of collectibles) {
            // Skip if this entity is a mirror
            if (this.game.getComponent(entityId, 'mirror')) continue;

            const result = this.checkEntityInBeam(entityId, startX, startZ, endX, endZ, beamWidth);
            if (result && result.dist < nearestCollectibleDist) {
                nearestCollectibleDist = result.dist;
                nearestCollectible = entityId;
            }
        }

        // If mirror is closer than collectible, clear collectible (prioritize mirror)
        if (nearestMirror && nearestMirrorDist <= nearestCollectibleDist) {
            nearestCollectible = null;
        }

        return { collectible: nearestCollectible, mirror: nearestMirror };
    }

    /**
     * Check if an entity is within the beam path
     */
    checkEntityInBeam(entityId, startX, startZ, endX, endZ, beamWidth) {
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!pos) return null;

        // Calculate distance from point to line segment
        const dist = this.pointToLineDistance(
            pos.x, pos.z,
            startX, startZ,
            endX, endZ
        );

        // Check if within beam width
        if (dist < beamWidth) {
            // Calculate distance along beam from start
            const dx = pos.x - startX;
            const dz = pos.z - startZ;
            const distFromStart = Math.sqrt(dx * dx + dz * dz);

            if (distFromStart < this.collectBeamMaxRange) {
                return { dist: distFromStart };
            }
        }

        return null;
    }

    /**
     * Calculate distance from point to line segment
     */
    pointToLineDistance(px, pz, x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lengthSq = dx * dx + dz * dz;

        if (lengthSq === 0) {
            // Line is a point
            return Math.sqrt((px - x1) ** 2 + (pz - z1) ** 2);
        }

        // Project point onto line, clamped to segment
        let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const projX = x1 + t * dx;
        const projZ = z1 + t * dz;

        return Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);
    }

    /**
     * Set visual highlight on a collectible entity
     */
    setCollectibleHighlight(entityId, highlighted) {
        // Add/remove highlight component or set property
        const billboard = this.game.getComponent(entityId, 'billboard');
        if (billboard) {
            billboard.highlighted = highlighted;
        }

        // Also notify for any other highlight systems
        this.game.triggerEvent('onEntityHighlightChanged', {
            entityId,
            highlighted,
            highlightType: 'collect'
        });
    }

    /**
     * Update container highlighting - finds container player is facing and highlights it
     */
    updateContainerHighlight(entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        // Get facing angle from camera
        const facingAngle = this.game.hasService('getFacingAngle')
            ? this.call.getFacingAngle()
            : 0;

        const playerPos = transform.position;
        const endX = playerPos.x + Math.cos(facingAngle) * this.containerHighlightRange;
        const endZ = playerPos.z + Math.sin(facingAngle) * this.containerHighlightRange;

        // Find container player is facing
        const newHighlightedContainer = this.findContainerInFacingDirection(
            playerPos.x, playerPos.z,
            endX, endZ
        );

        // Update highlight if target changed
        if (newHighlightedContainer !== this.highlightedContainer) {
            // Clear previous highlight
            if (this.highlightedContainer) {
                this.setContainerTint(this.highlightedContainer, null); // Reset to normal
            }
            // Set new highlight
            if (newHighlightedContainer) {
                this.setContainerTint(newHighlightedContainer, 0xffff88); // Yellow highlight
            }
            this.highlightedContainer = newHighlightedContainer;
        }
    }

    /**
     * Set tint color on a container entity's sprite
     */
    setContainerTint(entityId, color) {
        const entityRenderer = this.game.renderSystem?.entityRenderer;
        if (!entityRenderer) return;

        entityRenderer.setEntityTint(entityId, color);
    }

    /**
     * Find a container in the direction the player is facing
     */
    findContainerInFacingDirection(startX, startZ, endX, endZ) {
        const beamWidth = 30; // Width for detection
        let nearestContainer = null;
        let nearestDist = Infinity;

        const containers = this.game.getEntitiesWith('container', 'transform');
        for (const containerId of containers) {
            const containerComp = this.game.getComponent(containerId, 'container');
            // Skip already searched containers
            if (containerComp?.isSearched) continue;

            const containerTransform = this.game.getComponent(containerId, 'transform');
            if (!containerTransform?.position) continue;

            const pos = containerTransform.position;

            // Calculate distance from point to line segment (facing direction)
            const dist = this.pointToLineDistance(
                pos.x, pos.z,
                startX, startZ,
                endX, endZ
            );

            // Check if within beam width
            if (dist < beamWidth) {
                // Calculate distance from player
                const dx = pos.x - startX;
                const dz = pos.z - startZ;
                const distFromPlayer = Math.sqrt(dx * dx + dz * dz);

                // Make sure it's in front (dot product positive)
                const dirX = endX - startX;
                const dirZ = endZ - startZ;
                const dotProduct = dx * dirX + dz * dirZ;

                if (dotProduct > 0 && distFromPlayer < this.containerHighlightRange && distFromPlayer < nearestDist) {
                    nearestDist = distFromPlayer;
                    nearestContainer = containerId;
                }
            }
        }

        return nearestContainer;
    }

    triggerCollectAbility(entityId) {
        // Legacy method - now use handleCollectAbility
        this.handleCollectAbility(entityId);
    }

    triggerPlaceIllusionAbility(entityId, targetPosition, itemType) {
        // Use the PlaceIllusionAbility
        if (this.game.hasService('useAbility')) {
            this.call.useAbility( entityId, 'PlaceIllusionAbility', {
                targetPosition,
                itemType
            });
        }
    }

    /**
     * Use an ability assigned to a slot (Q, E, or R)
     */
    useAbilitySlot(entityId, slotKey) {
        const slots = this.game.getComponent(entityId, 'abilitySlots');
        if (!slots) return;

        const abilityId = slots[slotKey];
        if (abilityId) {
            // Special case: CollectAbility uses the beam mode
            if (abilityId === 'CollectAbility') {
                this.handleCollectAbility(entityId);
            } else {
                this.call.useAbility(entityId, abilityId);
            }
        }
    }

    /**
     * Try world interaction - handles containers, sign posts, etc.
     */
    tryWorldInteraction(entityId) {
        // Priority 1: Open container if one is highlighted
        if (this.tryOpenContainer(entityId)) return;

        // Priority 2: Read sign post if one is highlighted
        if (this.tryReadSignPost(entityId)) return;
    }

    /**
     * Try to open the highlighted container. Returns true if container was opened.
     */
    tryOpenContainer(entityId) {
        // Only open the container the player is facing (highlighted)
        if (!this.highlightedContainer) return false;

        const containerComp = this.game.getComponent(this.highlightedContainer, 'container');
        if (!containerComp || containerComp.isSearched) return false;

        const container = this.highlightedContainer;

        // Mark as searched
        containerComp.isSearched = true;

        // Get container position for effects
        const containerTransform = this.game.getComponent(container, 'transform');

        // Play open sound (reusing collect sound)
        this.call.playSound('sounds', 'collect_activate');

        // Create effect at container
        if (containerTransform?.position && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                containerTransform.position.x,
                containerTransform.position.y + 30,
                containerTransform.position.z,
                'sparkle',
                { count: 15, scaleMultiplier: 0.6 }
            );
        }

        // Process contents
        this.processContainerContents(entityId, containerComp.contents);

        // Clear highlight since container is now searched
        this.setContainerTint(this.highlightedContainer, null);
        this.highlightedContainer = null;

        return true;
    }

    /**
     * Find the nearest unopened container within interaction range
     */
    findNearbyContainer(entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        const playerController = this.game.getComponent(entityId, 'playerController');
        if (!transform?.position) return null;

        const interactionRadius = playerController?.interactionRadius || 50;
        const px = transform.position.x;
        const pz = transform.position.z;

        let nearestContainer = null;
        let nearestDist = Infinity;

        // Find all entities with container component
        const containers = this.game.getEntitiesWith('container', 'transform');
        for (const containerId of containers) {
            const containerComp = this.game.getComponent(containerId, 'container');
            // Skip already searched containers
            if (containerComp?.isSearched) continue;

            const containerTransform = this.game.getComponent(containerId, 'transform');
            if (!containerTransform?.position) continue;

            const dx = containerTransform.position.x - px;
            const dz = containerTransform.position.z - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < interactionRadius && dist < nearestDist) {
                nearestDist = dist;
                nearestContainer = containerId;
            }
        }

        return nearestContainer;
    }

    /**
     * Process the contents of a container, granting items to the player
     */
    processContainerContents(entityId, contents) {
        if (!contents || contents.length === 0) {
            // Empty container
            this.game.triggerEvent('onContainerOpened', { entityId, contents: [], message: 'The container is empty.' });
            return;
        }

        const grantedItems = [];
        for (const itemId of contents) {
            const granted = this.grantItem(entityId, itemId);
            if (granted) {
                grantedItems.push(itemId);
            }
        }

        // Notify UI
        this.game.triggerEvent('onContainerOpened', { entityId, contents: grantedItems });
    }

    /**
     * Grant an item to the player, adding it to inventory and granting any abilities
     */
    grantItem(entityId, itemId) {
        // Get item data from collections
        const itemData = this.collections.items?.[itemId];
        if (!itemData) {
            console.warn(`[PlayerControlSystem] Unknown item: ${itemId}`);
            return false;
        }

        // Add to player inventory
        const inventory = this.game.getComponent(entityId, 'playerInventory');
        if (inventory) {
            if (!inventory.items) inventory.items = [];
            inventory.items.push(itemId);
        }

        // Grant component if specified (e.g., magicBelt)
        if (itemData.grantsComponent) {
            if (!this.game.hasComponent(entityId, itemData.grantsComponent)) {
                // Add the component with default values
                const componentSchema = this.collections.components?.[itemData.grantsComponent]?.schema || {};
                this.game.addComponent(entityId, itemData.grantsComponent, JSON.parse(JSON.stringify(componentSchema)));
            }
        }

        // Grant abilities if specified
        if (itemData.grantsAbilities && itemData.grantsAbilities.length > 0) {
            const slots = this.game.getComponent(entityId, 'abilitySlots');

            for (const abilityId of itemData.grantsAbilities) {
                // Add ability to entity's available abilities
                if (this.game.hasService('addAbilitiesToUnit')) {
                    this.call.addAbilitiesToUnit(entityId, [abilityId]);
                }

                // Auto-assign to first empty slot
                if (slots) {
                    const emptySlot = this.getFirstEmptySlot(slots);
                    if (emptySlot) {
                        slots[emptySlot] = abilityId;
                    }
                }
            }

            this.game.triggerEvent('onAbilitySlotsChanged', { entityId });
        }

        // Play item acquired sound (reusing collect sound)
        this.call.playSound('sounds', 'collect_item');

        // Trigger item granted event
        this.game.triggerEvent('onItemGranted', { entityId, itemId, itemData });

        console.log(`[PlayerControlSystem] Granted item ${itemId} to entity ${entityId}`);
        return true;
    }

    /**
     * Get the first empty ability slot (only Q slot now)
     */
    getFirstEmptySlot(slots) {
        if (!slots.slotQ) return 'slotQ';
        return null;
    }

    /**
     * Update sign post highlighting - finds sign post player is facing and highlights it
     */
    updateSignPostHighlight(entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        if (!transform?.position) return;

        // Get facing angle from camera
        const facingAngle = this.game.hasService('getFacingAngle')
            ? this.call.getFacingAngle()
            : 0;

        const playerPos = transform.position;
        const endX = playerPos.x + Math.cos(facingAngle) * this.signPostHighlightRange;
        const endZ = playerPos.z + Math.sin(facingAngle) * this.signPostHighlightRange;

        // Find sign post player is facing
        const newHighlightedSignPost = this.findSignPostInFacingDirection(
            playerPos.x, playerPos.z,
            endX, endZ
        );

        // Update highlight if target changed
        if (newHighlightedSignPost !== this.highlightedSignPost) {
            // Clear previous highlight
            if (this.highlightedSignPost) {
                this.setContainerTint(this.highlightedSignPost, null);
            }
            // Set new highlight (cyan/teal color for sign posts)
            if (newHighlightedSignPost) {
                this.setContainerTint(newHighlightedSignPost, 0x88ffff);
            }
            this.highlightedSignPost = newHighlightedSignPost;
        }
    }

    /**
     * Find a sign post in the direction the player is facing
     */
    findSignPostInFacingDirection(startX, startZ, endX, endZ) {
        const beamWidth = 40; // Width for detection
        let nearestSignPost = null;
        let nearestDist = Infinity;

        const signPosts = this.game.getEntitiesWith('signPost', 'transform');
        for (const signPostId of signPosts) {
            const signPostTransform = this.game.getComponent(signPostId, 'transform');
            if (!signPostTransform?.position) continue;

            const pos = signPostTransform.position;

            // Calculate distance from point to line segment (facing direction)
            const dist = this.pointToLineDistance(
                pos.x, pos.z,
                startX, startZ,
                endX, endZ
            );

            // Check if within beam width
            if (dist < beamWidth) {
                // Calculate distance from player
                const dx = pos.x - startX;
                const dz = pos.z - startZ;
                const distFromPlayer = Math.sqrt(dx * dx + dz * dz);

                // Make sure it's in front (dot product positive)
                const dirX = endX - startX;
                const dirZ = endZ - startZ;
                const dotProduct = dx * dirX + dz * dirZ;

                if (dotProduct > 0 && distFromPlayer < this.signPostHighlightRange && distFromPlayer < nearestDist) {
                    nearestDist = distFromPlayer;
                    nearestSignPost = signPostId;
                }
            }
        }

        return nearestSignPost;
    }

    /**
     * Try to read the highlighted sign post. Returns true if sign was read.
     */
    tryReadSignPost(entityId) {
        // Don't read if message is already displayed
        if (this.signPostMessageVisible) return false;

        if (!this.highlightedSignPost) return false;

        const signPostComp = this.game.getComponent(this.highlightedSignPost, 'signPost');
        if (!signPostComp) return false;

        // Play a sound
        this.call.playSound('sounds', 'collect_activate');

        // Show the message (can be read multiple times)
        this.showSignPostMessage(signPostComp.message);

        return true;
    }

    /**
     * Show a sign post message to the player
     */
    showSignPostMessage(message) {
        // Create or get the sign post message overlay
        let overlay = document.getElementById('signPostOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'signPostOverlay';
            overlay.className = 'sign-post-overlay';
            overlay.innerHTML = `
                <div class="sign-post-content">
                    <div class="sign-post-message" id="signPostMessage"></div>
                    <div class="sign-post-hint">Press E or click to close</div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Add styles
            const style = document.createElement('style');
            style.id = 'sign-post-styles';
            style.textContent = `
                .sign-post-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 3000;
                }
                .sign-post-content {
                    max-width: 600px;
                    padding: 30px 40px;
                    background: linear-gradient(145deg, rgba(40, 35, 30, 0.98), rgba(30, 25, 20, 0.98));
                    border: 3px solid #8b7355;
                    border-radius: 8px;
                    box-shadow: 0 0 30px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(139, 115, 85, 0.1);
                }
                .sign-post-message {
                    color: #e8dcc8;
                    font-size: 20px;
                    line-height: 1.6;
                    text-align: center;
                    font-family: Georgia, serif;
                    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
                    white-space: pre-wrap;
                }
                .sign-post-hint {
                    color: #888;
                    font-size: 12px;
                    text-align: center;
                    margin-top: 20px;
                }
            `;
            document.head.appendChild(style);

            // Close on click
            overlay.addEventListener('click', () => {
                this.hideSignPostMessage();
            });
        }

        // Set the message and show
        document.getElementById('signPostMessage').textContent = message;
        overlay.style.display = 'flex';

        // Store that we're showing a sign post message
        this.signPostMessageVisible = true;

        // Add keydown listener to close on E
        this._signPostKeyHandler = (e) => {
            if (e.code === 'KeyE' || e.code === 'Escape') {
                this.hideSignPostMessage();
            }
        };
        document.addEventListener('keydown', this._signPostKeyHandler);
    }

    /**
     * Hide the sign post message
     */
    hideSignPostMessage() {
        const overlay = document.getElementById('signPostOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        this.signPostMessageVisible = false;

        // Remove the keydown listener
        if (this._signPostKeyHandler) {
            document.removeEventListener('keydown', this._signPostKeyHandler);
            this._signPostKeyHandler = null;
        }
    }
}
