class PlayerControlSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.playerControlSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Player entity reference
        this.playerEntityId = null;

        // Movement settings
        this.MOVE_SPEED = 150;
        this.CLICK_MOVE_THRESHOLD = 5;

        // Input state
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
            shift: false
        };

        // Click-to-move state
        this.clickMoveTarget = null;
        this.isClickMoving = false;

        // Ability hotkeys (1-4 and Q, E, R, F)
        this.abilitySlots = {
            1: null,
            2: null,
            3: null,
            4: null,
            q: null,
            e: null,
            r: null,
            f: null
        };

        // Attack state
        this.autoAttack = true;
        this.lastAttackTime = 0;

        // Camera follow settings
        this.cameraFollowPlayer = true;
        this.cameraOffset = { x: 0, y: 300, z: 400 };
    }

    init() {
        this.game.gameManager.register('setPlayerEntity', this.setPlayerEntity.bind(this));
        this.game.gameManager.register('getPlayerEntity', this.getPlayerEntity.bind(this));
        this.game.gameManager.register('assignAbilityToSlot', this.assignAbilityToSlot.bind(this));
        this.game.gameManager.register('getAbilitySlots', () => this.abilitySlots);
        this.game.gameManager.register('useAbilitySlot', this.useAbilitySlot.bind(this));
        this.game.gameManager.register('setClickMoveTarget', this.setClickMoveTarget.bind(this));

        // Set up input handlers
        this.setupInputHandlers();
    }

    setupInputHandlers() {
        // These will be called by the InputManager or KeyboardManager
        this.game.gameManager.register('onKeyDown', this.onKeyDown.bind(this));
        this.game.gameManager.register('onKeyUp', this.onKeyUp.bind(this));
        this.game.gameManager.register('onMouseClick', this.onMouseClick.bind(this));
        this.game.gameManager.register('onRightClick', this.onRightClick.bind(this));
    }

    setPlayerEntity(entityId) {
        this.playerEntityId = entityId;

        // Add player-controlled marker component
        const CT = this.componentTypes;

        // Ensure player has necessary components
        if (!this.game.hasComponent(entityId, CT.RESOURCE_POOL)) {
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(entityId, CT.RESOURCE_POOL, Components.ResourcePool(100, 100, 5, 100, 100, 10));
        }

        // Set player team
        const team = this.game.getComponent(entityId, CT.TEAM);
        if (team) {
            team.team = 'player';
        }

        // Initialize ability slots from unit abilities
        this.initializeAbilitySlots(entityId);
    }

    getPlayerEntity() {
        return this.playerEntityId;
    }

    initializeAbilitySlots(entityId) {
        if (!this.game.abilitySystem) return;

        const abilities = this.game.gameManager.call('getEntityAbilities', entityId);
        if (!abilities) return;

        let slotIndex = 1;
        for (const abilityId of abilities) {
            if (slotIndex <= 4) {
                this.abilitySlots[slotIndex] = abilityId;
                slotIndex++;
            }
        }
    }

    assignAbilityToSlot(slot, abilityId) {
        if (this.abilitySlots.hasOwnProperty(slot)) {
            this.abilitySlots[slot] = abilityId;
        }
    }

    onKeyDown(key) {
        const lowerKey = key.toLowerCase();

        // Movement keys
        if (this.keys.hasOwnProperty(lowerKey)) {
            this.keys[lowerKey] = true;
            // Cancel click-move when using WASD
            if (['w', 'a', 's', 'd'].includes(lowerKey)) {
                this.cancelClickMove();
            }
        }

        // Ability hotkeys
        if (this.abilitySlots.hasOwnProperty(lowerKey) || this.abilitySlots.hasOwnProperty(parseInt(key))) {
            const slot = isNaN(parseInt(key)) ? lowerKey : parseInt(key);
            this.useAbilitySlot(slot);
        }

        // Potion hotkeys
        if (key === '5') {
            this.useHealthPotion();
        } else if (key === '6') {
            this.useManaPotion();
        }

        // Stop/Hold position
        if (lowerKey === 'h' || lowerKey === ' ') {
            this.stopMovement();
        }
    }

    onKeyUp(key) {
        const lowerKey = key.toLowerCase();
        if (this.keys.hasOwnProperty(lowerKey)) {
            this.keys[lowerKey] = false;
        }
    }

    onMouseClick(worldX, worldZ, button) {
        if (!this.playerEntityId) return;

        if (button === 0) { // Left click
            // Check if clicking on enemy
            const clickedEntity = this.getEntityAtPosition(worldX, worldZ);
            if (clickedEntity && this.isEnemy(clickedEntity)) {
                this.attackTarget(clickedEntity);
            } else {
                // Move to position
                this.setClickMoveTarget(worldX, worldZ);
            }
        }
    }

    onRightClick(worldX, worldZ) {
        if (!this.playerEntityId) return;

        // Right click = force move (no attack)
        this.setClickMoveTarget(worldX, worldZ);
    }

    setClickMoveTarget(worldX, worldZ) {
        this.clickMoveTarget = { x: worldX, z: worldZ };
        this.isClickMoving = true;

        // Clear current attack target
        const aiState = this.game.getComponent(this.playerEntityId, this.componentTypes.AI_STATE);
        if (aiState) {
            aiState.target = null;
            aiState.state = 'chasing';
            aiState.targetPosition = { x: worldX, y: 0, z: worldZ };
        }
    }

    cancelClickMove() {
        this.clickMoveTarget = null;
        this.isClickMoving = false;
    }

    stopMovement() {
        this.cancelClickMove();
        this.keys.w = false;
        this.keys.a = false;
        this.keys.s = false;
        this.keys.d = false;

        if (this.playerEntityId) {
            const vel = this.game.getComponent(this.playerEntityId, this.componentTypes.VELOCITY);
            if (vel) {
                vel.vx = 0;
                vel.vz = 0;
            }
        }
    }

    attackTarget(targetId) {
        if (!this.playerEntityId) return;

        const aiState = this.game.getComponent(this.playerEntityId, this.componentTypes.AI_STATE);
        if (aiState) {
            aiState.target = targetId;
            aiState.state = 'chasing';
        }

        this.cancelClickMove();
    }

    getEntityAtPosition(worldX, worldZ) {
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.COLLISION
        );

        for (const entityId of entities) {
            if (entityId === this.playerEntityId) continue;

            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);

            const radius = collision?.radius || 25;
            const dx = worldX - pos.x;
            const dz = worldZ - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                return entityId;
            }
        }

        return null;
    }

    isEnemy(entityId) {
        const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
        return team && team.team !== 'player' && team.team !== 'neutral';
    }

    useAbilitySlot(slot) {
        if (!this.playerEntityId) return;

        const abilityId = this.abilitySlots[slot];
        if (!abilityId) return;

        // Get current target or mouse position for targeting
        const aiState = this.game.getComponent(this.playerEntityId, this.componentTypes.AI_STATE);
        const target = aiState?.target || null;

        // Use the ability system to cast
        if (this.game.abilitySystem) {
            this.game.gameManager.call('useAbility', this.playerEntityId, abilityId, target);
        }
    }

    useHealthPotion() {
        if (!this.playerEntityId) return;
        this.game.gameManager.call('usePotion', this.playerEntityId, 'health');
    }

    useManaPotion() {
        if (!this.playerEntityId) return;
        this.game.gameManager.call('usePotion', this.playerEntityId, 'mana');
    }

    update() {
        if (!this.playerEntityId) return;

        const CT = this.componentTypes;
        const pos = this.game.getComponent(this.playerEntityId, CT.POSITION);
        const vel = this.game.getComponent(this.playerEntityId, CT.VELOCITY);
        const aiState = this.game.getComponent(this.playerEntityId, CT.AI_STATE);

        if (!pos || !vel) return;

        // Handle WASD movement
        if (this.keys.w || this.keys.a || this.keys.s || this.keys.d) {
            this.handleWASDMovement(vel);

            // Update facing direction
            this.updateFacing(vel);

            // Set AI state to idle to prevent AI from taking over
            if (aiState && aiState.state !== 'attacking') {
                aiState.state = 'idle';
                aiState.targetPosition = null;
            }
        } else if (this.isClickMoving && this.clickMoveTarget) {
            // Handle click-to-move
            this.handleClickMove(pos, vel);
        } else {
            // No input - stop if not attacking
            if (aiState && aiState.state !== 'attacking' && aiState.state !== 'chasing') {
                vel.vx = 0;
                vel.vz = 0;
            }
        }

        // Handle auto-attack
        if (this.autoAttack && aiState && aiState.target) {
            this.handleAutoAttack(aiState);
        }

        // Update camera to follow player
        if (this.cameraFollowPlayer) {
            this.updateCamera(pos);
        }
    }

    handleWASDMovement(vel) {
        let moveX = 0;
        let moveZ = 0;

        if (this.keys.w) moveZ -= 1;
        if (this.keys.s) moveZ += 1;
        if (this.keys.a) moveX -= 1;
        if (this.keys.d) moveX += 1;

        // Normalize diagonal movement
        const magnitude = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (magnitude > 0) {
            moveX /= magnitude;
            moveZ /= magnitude;
        }

        // Apply speed (with shift for run)
        const speed = this.keys.shift ? this.MOVE_SPEED * 1.5 : this.MOVE_SPEED;
        vel.vx = moveX * speed;
        vel.vz = moveZ * speed;
    }

    handleClickMove(pos, vel) {
        const dx = this.clickMoveTarget.x - pos.x;
        const dz = this.clickMoveTarget.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= this.CLICK_MOVE_THRESHOLD) {
            // Reached destination
            this.cancelClickMove();
            vel.vx = 0;
            vel.vz = 0;
        } else {
            // Move towards target
            vel.vx = (dx / dist) * this.MOVE_SPEED;
            vel.vz = (dz / dist) * this.MOVE_SPEED;

            this.updateFacing(vel);
        }
    }

    updateFacing(vel) {
        if (Math.abs(vel.vx) > 0.1 || Math.abs(vel.vz) > 0.1) {
            const facing = this.game.getComponent(this.playerEntityId, this.componentTypes.FACING);
            if (facing) {
                facing.angle = Math.atan2(vel.vz, vel.vx);
            }
        }
    }

    handleAutoAttack(aiState) {
        // Let the CombatAISystem handle the actual attacking
        // Just ensure the player continues to attack the target
        if (aiState.target) {
            const targetHealth = this.game.getComponent(aiState.target, this.componentTypes.HEALTH);
            if (!targetHealth || targetHealth.current <= 0) {
                aiState.target = null;
            }
        }
    }

    updateCamera(pos) {
        // This would be called to update camera position
        // Implementation depends on how the camera system works
        if (this.game.gameManager.has('setCameraTarget')) {
            this.game.gameManager.call('setCameraTarget', pos.x, pos.y, pos.z);
        }
    }
}
