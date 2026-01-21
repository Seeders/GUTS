/**
 * PlayerControlSystem - Handles direct player input for the illusionist character
 *
 * Controls:
 * - W/S: Move forward/backward relative to facing direction
 * - A/D: Strafe left/right relative to facing direction
 * - Mouse: Control facing direction (via CameraControlSystem)
 * - E: Collect nearby object (triggers CollectAbility)
 * - Q: Create clone / toggle control between player and clone
 * - 1/2/3: Select belt slot
 * - Click with item selected: Place illusion (triggers PlaceIllusionAbility)
 */
class PlayerControlSystem extends GUTS.BaseSystem {
    static services = [
        'getPlayerEntity',
        'setPlayerMoveTarget',
        'getSelectedBeltSlot',
        'setSelectedBeltSlot',
        'getBeltContents',
        'storeBeltItem',
        'consumeBeltItem'
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
    }

    init() {
        // Keyboard controls are set up in onSceneLoad when canvas is ready
    }

    onSceneLoad(sceneData) {
        // Clean up any existing listeners first to prevent duplicates
        this.cleanupEventListeners();
        this.setupKeyboardControls();
        this.setupCanvasClickHandler();
    }

    onSceneUnload() {
        this.cleanupEventListeners();
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
            case 'KeyE':
                this.triggerCollectAbility(playerEntity);
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
            case 'KeyQ':
                this.handleCloneAbility(playerEntity);
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

        const worldPos = this.game.call('getWorldPositionFromMouse', event.clientX, event.clientY);
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
            targetPos = this.game.call('getPreviewPosition');
        }

        if (!targetPos || (targetPos.x === 0 && targetPos.z === 0)) {
            // Fallback: calculate position in front of player
            const transform = this.game.getComponent(playerEntity, 'transform');
            if (!transform || !transform.position) return;

            const facingAngle = this.game.hasService('getFacingAngle')
                ? this.game.call('getFacingAngle')
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
                this.game.call('setBillboardAnimation', controlledEntity, this.enums.animationType.walk, true);
            }
            this.updateWASDMovement(controlledEntity);
            this.playFootstepSound();
        } else if (this._wasMoving) {
            // Just stopped moving - set idle animation
            if (this.game.hasService('setBillboardAnimation')) {
                this.game.call('setBillboardAnimation', controlledEntity, this.enums.animationType.idle, true);
            }
        }
        this._wasMoving = this.isWASDMoving;

        // Update camera to follow controlled entity
        this.updateCameraTarget(controlledEntity);
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
                this.game.call('setFollowTarget', entityId);
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
     * Handle Q key - create clone or toggle control
     */
    handleCloneAbility(playerEntity) {
        const playerController = this.game.getComponent(playerEntity, 'playerController');
        if (!playerController) return;

        // If clone exists, toggle control
        if (playerController.activeCloneId && this.game.hasEntity(playerController.activeCloneId)) {
            playerController.controllingClone = !playerController.controllingClone;

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
            return;
        }

        // No clone - create one
        if (this.game.hasService('useAbility')) {
            this.game.call('useAbility', playerEntity, 'ProjectCloneAbility', {});
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
            if (!this.game.call('canMoveToPosition', fromX, fromZ, point.x, point.z)) {
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
            ? this.game.call('getFacingAngle')
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
                const terrainHeight = this.game.call('getTerrainHeightAtPosition', finalX, finalZ);
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
            const camera = this.game.hasService('getCamera') ? this.game.call('getCamera') : null;
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
        const audioManager = this.game.audioManager;
        if (audioManager) {
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
                audioManager.playSynthSound(`footstep_${Date.now()}`, config, { volume: finalVolume });
            }
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
            this.game.call('setBillboardAnimationDirection', entityId, direction);
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
            this.game.call('clearEntityPath', entityId);
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

        // Find first empty slot (null means empty)
        for (let i = 0; i < 3; i++) {
            const slotKey = `slot${i}`;
            if (belt[slotKey] === null) {
                belt[slotKey] = objectTypeIndex;
                this.game.triggerEvent('onBeltUpdated', { entityId, slotIndex: i, objectType });
                return true;
            }
        }

        return false; // Belt full
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

    triggerCollectAbility(entityId) {
        // Use the CollectAbility
        if (this.game.hasService('useAbility')) {
            this.game.call('useAbility', entityId, 'CollectAbility', { target: null });
        }
    }

    triggerPlaceIllusionAbility(entityId, targetPosition, itemType) {
        // Use the PlaceIllusionAbility
        if (this.game.hasService('useAbility')) {
            this.game.call('useAbility', entityId, 'PlaceIllusionAbility', {
                targetPosition,
                itemType
            });
        }
    }
}
