/**
 * PlayerControlSystem - Handles direct player input for the illusionist character
 *
 * Controls:
 * - W/S: Move forward/backward relative to facing direction
 * - A/D: Strafe left/right relative to facing direction
 * - Mouse: Control facing direction (via CameraControlSystem)
 * - E: Collect nearby object (triggers CollectAbility)
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

        // Handle WASD movement
        if (this.isWASDMoving) {
            // Set walk animation only when starting to move
            if (!this._wasMoving && this.game.hasService('setBillboardAnimation')) {
                this.game.call('setBillboardAnimation', playerEntity, this.enums.animationType.walk, true);
            }
            this.updateWASDMovement(playerEntity);
        } else if (this._wasMoving) {
            // Just stopped moving - set idle animation
            if (this.game.hasService('setBillboardAnimation')) {
                this.game.call('setBillboardAnimation', playerEntity, this.enums.animationType.idle, true);
            }
        }
        this._wasMoving = this.isWASDMoving;
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

            transform.position.x += moveX;
            transform.position.z += moveZ;

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
