class PlayerControlSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.playerControlSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Player entity reference
        this.playerEntityId = null;

        // Movement settings
        this.MOVE_SPEED = 200;
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

        // Network state
        this.isServer = false;
        this.lastInputSendTime = 0;
        this.inputSendInterval = 50; // Send inputs every 50ms
        this.previousKeys = { ...this.keys };
        this.otherPlayers = new Map(); // playerId -> { entityId, keys, clickTarget }
    }

    init() {
        // Check if running on server
        this.isServer = !!this.engine.serverNetworkManager;

        this.game.gameManager.register('setPlayerEntity', this.setPlayerEntity.bind(this));
        this.game.gameManager.register('getPlayerEntity', this.getPlayerEntity.bind(this));
        this.game.gameManager.register('assignAbilityToSlot', this.assignAbilityToSlot.bind(this));
        this.game.gameManager.register('getAbilitySlots', () => this.abilitySlots);
        this.game.gameManager.register('useAbilitySlot', this.useAbilitySlot.bind(this));
        this.game.gameManager.register('setClickMoveTarget', this.setClickMoveTarget.bind(this));
        this.game.gameManager.register('applyPlayerInput', this.applyPlayerInput.bind(this));
        this.game.gameManager.register('registerOtherPlayer', this.registerOtherPlayer.bind(this));

        // Set up input handlers (client only)
        if (!this.isServer) {
            this.setupInputHandlers();
            this.setupNetworkListeners();
        } else {
            this.setupServerEventHandlers();
        }
    }

    setupInputHandlers() {
        // These will be called by the InputManager or KeyboardManager
        this.game.gameManager.register('onKeyDown', this.onKeyDown.bind(this));
        this.game.gameManager.register('onKeyUp', this.onKeyUp.bind(this));
        this.game.gameManager.register('onMouseClick', this.onMouseClick.bind(this));
        this.game.gameManager.register('onRightClick', this.onRightClick.bind(this));
    }

    setupNetworkListeners() {
        // Client listens for other players' inputs
        if (!this.game.clientNetworkManager) return;

        const nm = this.game.clientNetworkManager;

        nm.listen('OTHER_PLAYER_INPUT', (data) => {
            this.handleOtherPlayerInput(data);
        });

        nm.listen('OTHER_PLAYER_ABILITY', (data) => {
            this.handleOtherPlayerAbility(data);
        });

        nm.listen('OTHER_PLAYER_POTION', (data) => {
            this.handleOtherPlayerPotion(data);
        });

        nm.listen('PLAYER_JOINED', (data) => {
            this.registerOtherPlayer(data.playerId, data.entityId);
        });

        nm.listen('PLAYER_LEFT', (data) => {
            this.otherPlayers.delete(data.playerId);
        });
    }

    setupServerEventHandlers() {
        // Server handles incoming player inputs
        if (!this.game.serverEventManager) return;

        this.game.serverEventManager.subscribe('PLAYER_INPUT', this.handlePlayerInputFromClient.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_ABILITY', this.handlePlayerAbilityFromClient.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_POTION', this.handlePlayerPotionFromClient.bind(this));
    }

    // Server: Handle input from a client
    handlePlayerInputFromClient(eventData) {
        const { playerId, data } = eventData;
        const { keys, clickMoveTarget, position } = data;

        // Get or create player data
        let playerData = this.otherPlayers.get(playerId);
        if (!playerData) {
            playerData = { entityId: null, keys: { w: false, a: false, s: false, d: false, shift: false }, clickTarget: null };
            this.otherPlayers.set(playerId, playerData);
        }

        // Update player input state
        playerData.keys = keys;
        playerData.clickTarget = clickMoveTarget;

        // Broadcast to other clients
        const roomId = this.engine.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            this.engine.serverNetworkManager.broadcastToRoom(roomId, 'OTHER_PLAYER_INPUT', {
                playerId: playerId,
                keys: keys,
                clickMoveTarget: clickMoveTarget,
                position: position
            }, playerId); // Exclude sender
        }
    }

    handlePlayerAbilityFromClient(eventData) {
        const { playerId, data } = eventData;
        const { slot, abilityId, targetId, targetPosition } = data;

        const playerData = this.otherPlayers.get(playerId);
        if (!playerData || !playerData.entityId) return;

        // Execute ability on server
        if (this.game.abilitySystem) {
            this.game.gameManager.call('useAbility', playerData.entityId, abilityId, targetId, targetPosition);
        }

        // Broadcast to other clients
        const roomId = this.engine.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            this.engine.serverNetworkManager.broadcastToRoom(roomId, 'OTHER_PLAYER_ABILITY', {
                playerId: playerId,
                entityId: playerData.entityId,
                slot: slot,
                abilityId: abilityId,
                targetId: targetId,
                targetPosition: targetPosition
            }, playerId);
        }
    }

    handlePlayerPotionFromClient(eventData) {
        const { playerId, data } = eventData;
        const { potionType } = data;

        const playerData = this.otherPlayers.get(playerId);
        if (!playerData || !playerData.entityId) return;

        // Use potion on server
        this.game.gameManager.call('usePotion', playerData.entityId, potionType);

        // Broadcast to other clients
        const roomId = this.engine.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            this.engine.serverNetworkManager.broadcastToRoom(roomId, 'OTHER_PLAYER_POTION', {
                playerId: playerId,
                entityId: playerData.entityId,
                potionType: potionType
            }, playerId);
        }
    }

    // Client: Handle other player's input
    handleOtherPlayerInput(data) {
        const { playerId, keys, clickMoveTarget, position } = data;

        let playerData = this.otherPlayers.get(playerId);
        if (!playerData) {
            playerData = { entityId: null, keys: { w: false, a: false, s: false, d: false, shift: false }, clickTarget: null };
            this.otherPlayers.set(playerId, playerData);
        }

        playerData.keys = keys;
        playerData.clickTarget = clickMoveTarget;

        // Correct position if provided
        if (position && playerData.entityId) {
            const pos = this.game.getComponent(playerData.entityId, this.componentTypes.POSITION);
            if (pos) {
                pos.x = position.x;
                pos.z = position.z;
            }
        }
    }

    handleOtherPlayerAbility(data) {
        const { entityId, abilityId, targetId, targetPosition } = data;

        // Execute ability visually for other player
        if (this.game.abilitySystem) {
            this.game.gameManager.call('useAbility', entityId, abilityId, targetId, targetPosition);
        }
    }

    handleOtherPlayerPotion(data) {
        const { entityId, potionType } = data;
        this.game.gameManager.call('usePotion', entityId, potionType);
    }

    registerOtherPlayer(playerId, entityId) {
        this.otherPlayers.set(playerId, {
            entityId: entityId,
            keys: { w: false, a: false, s: false, d: false, shift: false },
            clickTarget: null
        });
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

        if (button === 0) { // Left click - move only
            this.setClickMoveTarget(worldX, worldZ);
        }
    }

    onRightClick(worldX, worldZ) {
        if (!this.playerEntityId) return;

        // Right click = attack in direction of mouse
        this.attackInDirection(worldX, worldZ);
    }

    attackInDirection(worldX, worldZ) {
        if (!this.playerEntityId) return;

        const pos = this.game.getComponent(this.playerEntityId, this.componentTypes.POSITION);
        if (!pos) return;

        // Calculate direction to mouse
        const dx = worldX - pos.x;
        const dz = worldZ - pos.z;
        const angle = Math.atan2(dz, dx);

        // Face the attack direction
        const facing = this.game.getComponent(this.playerEntityId, this.componentTypes.FACING);
        if (facing) {
            facing.angle = angle;
        }

        // Stop movement during attack
        this.cancelClickMove();
        const vel = this.game.getComponent(this.playerEntityId, this.componentTypes.VELOCITY);
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Set AI state to attacking
        const aiState = this.game.getComponent(this.playerEntityId, this.componentTypes.AI_STATE);
        if (aiState) {
            aiState.state = 'attacking';
            // Store attack direction for projectile/melee systems
            aiState.attackDirection = { x: dx, z: dz, angle: angle };
            aiState.targetPosition = { x: worldX, z: worldZ };
        }

        // Perform the attack
        this.performDirectionalAttack(worldX, worldZ, angle);
    }

    performDirectionalAttack(targetX, targetZ, angle) {
        const combat = this.game.getComponent(this.playerEntityId, this.componentTypes.COMBAT);
        if (!combat) return;

        const now = this.game.state.now;
        const attackCooldown = 1000 / (combat.attackSpeed || 1);

        // Check cooldown
        if (now - this.lastAttackTime < attackCooldown) return;
        this.lastAttackTime = now;

        const pos = this.game.getComponent(this.playerEntityId, this.componentTypes.POSITION);
        if (!pos) return;

        // Check if unit has a projectile attack
        if (combat.projectile) {
            // Spawn projectile in attack direction
            this.game.gameManager.call('spawnProjectile',
                this.playerEntityId,
                combat.projectile,
                pos.x, pos.y || 0, pos.z,
                targetX, 0, targetZ,
                combat.damage,
                combat.element || 'physical'
            );
        } else {
            // Melee attack - check for enemies in cone in front of player
            const range = combat.range || 50;
            this.performMeleeAttack(pos, angle, range, combat.damage, combat.element);
        }

        // Play attack animation
        const animation = this.game.getComponent(this.playerEntityId, this.componentTypes.ANIMATION);
        if (animation) {
            animation.currentAnimation = 'attack';
            animation.animationStartTime = now;
        }
    }

    performMeleeAttack(pos, angle, range, damage, element) {
        // Find enemies in a cone in front of the player
        const coneAngle = Math.PI / 4; // 45 degree cone
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.TEAM
        );

        for (const entityId of entities) {
            if (entityId === this.playerEntityId) continue;
            if (!this.isEnemy(entityId)) continue;

            const targetPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > range) continue;

            // Check if in cone
            const targetAngle = Math.atan2(dz, dx);
            let angleDiff = Math.abs(targetAngle - angle);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff <= coneAngle) {
                // Deal damage
                this.game.gameManager.call('dealDamage', this.playerEntityId, entityId, damage, element || 'physical');
            }
        }
    }

    handleClick(event) {
        // Convert screen coordinates to world coordinates
        const rect = event.target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Use raycaster to find world position
        if (!this.raycaster) {
            this.raycaster = new THREE.Raycaster();
        }
        if (!this.mouse) {
            this.mouse = new THREE.Vector2();
        }

        this.mouse.set(mouseX, mouseY);
        this.raycaster.setFromCamera(this.mouse, this.game.camera);

        // Raycast to ground plane at y=0
        const ray = this.raycaster.ray;
        const t = -ray.origin.y / ray.direction.y;

        if (t > 0) {
            const worldX = ray.origin.x + ray.direction.x * t;
            const worldZ = ray.origin.z + ray.direction.z * t;
            this.onMouseClick(worldX, worldZ, event.button);
        }
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

        // Use the ability system to cast locally
        if (this.game.abilitySystem) {
            this.game.gameManager.call('useAbility', this.playerEntityId, abilityId, target);
        }

        // Send to server if client
        if (!this.isServer && this.game.clientNetworkManager) {
            this.game.clientNetworkManager.emit('PLAYER_ABILITY', {
                slot: slot,
                abilityId: abilityId,
                targetId: target,
                targetPosition: aiState?.targetPosition || null
            });
        }
    }

    useHealthPotion() {
        if (!this.playerEntityId) return;
        this.game.gameManager.call('usePotion', this.playerEntityId, 'health');

        // Send to server if client
        if (!this.isServer && this.game.clientNetworkManager) {
            this.game.clientNetworkManager.emit('PLAYER_POTION', {
                potionType: 'health'
            });
        }
    }

    useManaPotion() {
        if (!this.playerEntityId) return;
        this.game.gameManager.call('usePotion', this.playerEntityId, 'mana');

        // Send to server if client
        if (!this.isServer && this.game.clientNetworkManager) {
            this.game.clientNetworkManager.emit('PLAYER_POTION', {
                potionType: 'mana'
            });
        }
    }

    // Apply input state (used by server to apply inputs from client)
    applyPlayerInput(playerId, keys, clickMoveTarget) {
        const playerData = this.otherPlayers.get(playerId);
        if (playerData) {
            playerData.keys = keys;
            playerData.clickTarget = clickMoveTarget;
        }
    }

    sendInputToServer() {
        if (this.isServer || !this.game.clientNetworkManager) return;

        const now = Date.now();
        if (now - this.lastInputSendTime < this.inputSendInterval) return;

        // Check if input changed
        const keysChanged = Object.keys(this.keys).some(k => this.keys[k] !== this.previousKeys[k]);
        const clickChanged = !!this.clickMoveTarget;

        if (!keysChanged && !clickChanged) return;

        // Get current position for sync
        let position = null;
        if (this.playerEntityId) {
            const pos = this.game.getComponent(this.playerEntityId, this.componentTypes.POSITION);
            if (pos) {
                position = { x: pos.x, z: pos.z };
            }
        }

        // Send input state to server
        this.game.clientNetworkManager.emit('PLAYER_INPUT', {
            keys: { ...this.keys },
            clickMoveTarget: this.clickMoveTarget,
            position: position
        });

        this.previousKeys = { ...this.keys };
        this.lastInputSendTime = now;

        // Clear click target after sending
        if (this.clickMoveTarget) {
            // Keep for local processing but mark as sent
        }
    }

    update() {
        // Process local player
        if (this.playerEntityId) {
            this.processPlayerMovement(this.playerEntityId, this.keys, this.clickMoveTarget, true);
        }

        // Process other players (on both client and server)
        for (const [playerId, playerData] of this.otherPlayers) {
            if (playerData.entityId) {
                this.processPlayerMovement(playerData.entityId, playerData.keys, playerData.clickTarget, false);
            }
        }

        // Send input to server (client only)
        if (!this.isServer) {
            this.sendInputToServer();
        }

        // Update camera to follow local player
        if (!this.isServer && this.cameraFollowPlayer && this.playerEntityId) {
            const pos = this.game.getComponent(this.playerEntityId, this.componentTypes.POSITION);
            if (pos) {
                this.updateCamera(pos);
            }
        }
    }

    processPlayerMovement(entityId, keys, clickTarget, isLocal) {
        const CT = this.componentTypes;
        const pos = this.game.getComponent(entityId, CT.POSITION);
        const vel = this.game.getComponent(entityId, CT.VELOCITY);
        const aiState = this.game.getComponent(entityId, CT.AI_STATE);

        if (!pos || !vel) return;

        // WASD movement disabled - use click-to-move with pathfinding instead
        // if (keys.w || keys.a || keys.s || keys.d) {
        //     this.handleWASDMovementFor(entityId, vel, keys);
        //     this.updateFacingFor(entityId, vel);
        //     if (aiState && aiState.state !== 'attacking') {
        //         aiState.state = 'idle';
        //         aiState.targetPosition = null;
        //     }
        // } else
        if (clickTarget) {
            // Handle click-to-move with pathfinding
            if (aiState) {
                // Check if target changed - request new path immediately
                const targetChanged = !aiState.targetPosition ||
                    aiState.targetPosition.x !== clickTarget.x ||
                    aiState.targetPosition.z !== clickTarget.z;

                if (targetChanged) {
                    // Clear old path and request new one
                    aiState.path = null;
                    aiState.pathIndex = 0;
                    aiState.targetPosition = { x: clickTarget.x, z: clickTarget.z };
                    aiState.state = 'chasing';
                    // Request path from pathfinding system
                    this.game.gameManager.call('requestPath', entityId, pos.x, pos.z, clickTarget.x, clickTarget.z, 10);
                }

                // Follow the path if we have one
                if (aiState.path && aiState.path.length > 0) {
                    const reached = this.followPath(entityId, pos, vel, aiState);
                    if (reached && isLocal) {
                        this.cancelClickMove();
                        aiState.path = null;
                        aiState.targetPosition = null;
                    }
                } else {
                    // Move directly while waiting for path
                    const reached = this.handleClickMoveFor(entityId, pos, vel, clickTarget);
                    if (reached && isLocal) {
                        this.cancelClickMove();
                    }
                }
            } else {
                // No AI state, use direct movement
                const reached = this.handleClickMoveFor(entityId, pos, vel, clickTarget);
                if (reached && isLocal) {
                    this.cancelClickMove();
                }
            }
        } else {
            // No input - stop if not attacking
            if (aiState && aiState.state !== 'attacking' && aiState.state !== 'chasing') {
                vel.vx = 0;
                vel.vz = 0;
            }
        }

        // Handle auto-attack
        if (this.autoAttack && aiState && aiState.target) {
            this.handleAutoAttackFor(entityId, aiState);
        }
    }

    handleWASDMovementFor(entityId, vel, keys) {
        let moveX = 0;
        let moveZ = 0;

        if (keys.w) moveZ -= 1;
        if (keys.s) moveZ += 1;
        if (keys.a) moveX -= 1;
        if (keys.d) moveX += 1;

        // Normalize diagonal movement
        const magnitude = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (magnitude > 0) {
            moveX /= magnitude;
            moveZ /= magnitude;
        }

        // Apply speed (with shift for run)
        const speed = keys.shift ? this.MOVE_SPEED * 1.5 : this.MOVE_SPEED;
        vel.vx = moveX * speed;
        vel.vz = moveZ * speed;
    }

    handleClickMoveFor(entityId, pos, vel, clickTarget) {
        const dx = clickTarget.x - pos.x;
        const dz = clickTarget.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= this.CLICK_MOVE_THRESHOLD) {
            // Reached destination
            vel.vx = 0;
            vel.vz = 0;
            return true;
        } else {
            // Move towards target
            vel.vx = (dx / dist) * this.MOVE_SPEED;
            vel.vz = (dz / dist) * this.MOVE_SPEED;

            this.updateFacingFor(entityId, vel);
            return false;
        }
    }

    followPath(entityId, pos, vel, aiState) {
        if (!aiState.path || aiState.path.length === 0) {
            vel.vx = 0;
            vel.vz = 0;
            return true;
        }

        // Initialize path index if needed
        if (aiState.pathIndex === undefined || aiState.pathIndex === null) {
            aiState.pathIndex = 0;
        }

        // Get current waypoint
        const waypoint = aiState.path[aiState.pathIndex];
        if (!waypoint) {
            vel.vx = 0;
            vel.vz = 0;
            return true;
        }

        const dx = waypoint.x - pos.x;
        const dz = waypoint.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Check if reached current waypoint
        if (dist <= this.CLICK_MOVE_THRESHOLD) {
            aiState.pathIndex++;

            // Check if reached end of path
            if (aiState.pathIndex >= aiState.path.length) {
                vel.vx = 0;
                vel.vz = 0;
                return true;
            }
        }

        // Move towards current waypoint
        if (dist > 0.1) {
            vel.vx = (dx / dist) * this.MOVE_SPEED;
            vel.vz = (dz / dist) * this.MOVE_SPEED;
            this.updateFacingFor(entityId, vel);
        }

        return false;
    }

    updateFacingFor(entityId, vel) {
        if (Math.abs(vel.vx) > 0.1 || Math.abs(vel.vz) > 0.1) {
            const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
            if (facing) {
                facing.angle = Math.atan2(vel.vz, vel.vx);
            }
        }
    }

    handleWASDMovement(vel) {
        this.handleWASDMovementFor(this.playerEntityId, vel, this.keys);
    }

    handleClickMove(pos, vel) {
        return this.handleClickMoveFor(this.playerEntityId, pos, vel, this.clickMoveTarget);
    }

    updateFacing(vel) {
        this.updateFacingFor(this.playerEntityId, vel);
    }

    handleAutoAttackFor(entityId, aiState) {
        // Let the CombatAISystem handle the actual attacking
        // Just ensure the player continues to attack the target
        if (aiState.target) {
            const targetHealth = this.game.getComponent(aiState.target, this.componentTypes.HEALTH);
            if (!targetHealth || targetHealth.current <= 0) {
                aiState.target = null;
            }
        }
    }

    handleAutoAttack(aiState) {
        this.handleAutoAttackFor(this.playerEntityId, aiState);
    }

    updateCamera(pos) {
        // This would be called to update camera position
        // Implementation depends on how the camera system works
        if (this.game.gameManager.has('setCameraTarget')) {
            this.game.gameManager.call('setCameraTarget', pos.x, pos.y, pos.z);
        }
    }
}
