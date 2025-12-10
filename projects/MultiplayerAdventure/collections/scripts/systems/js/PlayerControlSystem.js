/**
 * PlayerControlSystem - Handles direct player character control
 *
 * Features:
 * - WASD/Arrow key movement
 * - Mouse-based targeting and abilities
 * - Click-to-move option
 * - Action bar/hotkey abilities
 * - Interaction with NPCs and objects
 */
class PlayerControlSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.playerControlSystem = this;

        // Input state
        this.keys = {
            w: false, a: false, s: false, d: false,
            up: false, left: false, down: false, right: false,
            shift: false, space: false,
            1: false, 2: false, 3: false, 4: false, 5: false, 6: false
        };

        // Mouse state
        this.mousePosition = { x: 0, y: 0 };
        this.mouseWorldPosition = { x: 0, y: 0, z: 0 };
        this.isMouseDown = false;
        this.rightMouseDown = false;

        // Movement configuration
        this.moveSpeed = 150;
        this.sprintMultiplier = 1.5;

        // Targeting
        this.currentTarget = null;
        this.hoverTarget = null;

        // Interaction
        this.interactionRange = 60;
        this.nearestInteractable = null;

        // Ability cooldowns
        this.abilityCooldowns = new Map();

        // RaycastHelper for mouse picking
        this.raycastHelper = null;
    }

    init(params) {
        this.params = params || {};
        console.log('[PlayerControlSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        this.game.register('getMouseWorldPosition', () => this.mouseWorldPosition);
        this.game.register('getCurrentTarget', () => this.currentTarget);
        this.game.register('setTarget', this.setTarget.bind(this));
        this.game.register('clearTarget', this.clearTarget.bind(this));
        this.game.register('useAbility', this.useAbility.bind(this));
        this.game.register('isAbilityReady', this.isAbilityReady.bind(this));
        this.game.register('getAbilityCooldown', (abilityId) => this.abilityCooldowns.get(abilityId) || 0);
        this.game.register('showInteractionPrompt', this.showInteractionPrompt.bind(this));
        this.game.register('hideInteractionPrompt', this.hideInteractionPrompt.bind(this));
    }

    onSceneLoad(sceneData) {
        // Initialize controls when entering a gameplay scene
        if (sceneData.title?.includes('Town Hub') || sceneData.title?.includes('Adventure')) {
            this.setupInputListeners();

            // Initialize RaycastHelper
            if (this.game.scene && this.game.camera && !this.raycastHelper) {
                this.raycastHelper = new GUTS.RaycastHelper(this.game.camera, this.game.scene);
            }
        }
    }

    setupInputListeners() {
        // Keyboard events
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', this.handleKeyUp.bind(this));

        // Mouse events on canvas
        const canvas = this.game.canvas;
        if (canvas) {
            canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
            canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
            canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        }
    }

    handleKeyDown(event) {
        const key = event.key.toLowerCase();

        // Movement keys
        if (key === 'w' || key === 'arrowup') this.keys.w = true;
        if (key === 'a' || key === 'arrowleft') this.keys.a = true;
        if (key === 's' || key === 'arrowdown') this.keys.s = true;
        if (key === 'd' || key === 'arrowright') this.keys.d = true;
        if (key === 'shift') this.keys.shift = true;
        if (key === ' ') this.keys.space = true;

        // Ability hotkeys
        if (key >= '1' && key <= '6') {
            this.keys[key] = true;
            this.handleAbilityHotkey(parseInt(key));
        }

        // Interaction key
        if (key === 'e' || key === 'f') {
            this.handleInteraction();
        }

        // Escape to clear target
        if (key === 'escape') {
            this.clearTarget();
        }

        // Tab to cycle targets
        if (key === 'tab') {
            event.preventDefault();
            this.cycleTargets();
        }
    }

    handleKeyUp(event) {
        const key = event.key.toLowerCase();

        if (key === 'w' || key === 'arrowup') this.keys.w = false;
        if (key === 'a' || key === 'arrowleft') this.keys.a = false;
        if (key === 's' || key === 'arrowdown') this.keys.s = false;
        if (key === 'd' || key === 'arrowright') this.keys.d = false;
        if (key === 'shift') this.keys.shift = false;
        if (key === ' ') this.keys.space = false;

        if (key >= '1' && key <= '6') {
            this.keys[key] = false;
        }
    }

    handleMouseMove(event) {
        const rect = this.game.canvas.getBoundingClientRect();
        this.mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast to get world position
        if (this.raycastHelper) {
            const ground = this.game.call('getGroundMesh');
            const worldPos = this.raycastHelper.rayCastGround(
                this.mousePosition.x,
                this.mousePosition.y,
                ground
            );
            if (worldPos) {
                this.mouseWorldPosition = worldPos;
            }

            // Check for hoverable targets
            this.updateHoverTarget();
        }
    }

    handleMouseDown(event) {
        if (event.button === 0) {
            this.isMouseDown = true;
            this.handleLeftClick();
        } else if (event.button === 2) {
            this.rightMouseDown = true;
            this.handleRightClick();
        }
    }

    handleMouseUp(event) {
        if (event.button === 0) {
            this.isMouseDown = false;
        } else if (event.button === 2) {
            this.rightMouseDown = false;
        }
    }

    handleLeftClick() {
        // Try to select a target
        if (this.hoverTarget) {
            this.setTarget(this.hoverTarget);
        } else {
            // Click on ground - could implement click-to-move
            this.clearTarget();
        }
    }

    handleRightClick() {
        // Right click to interact or attack
        if (this.currentTarget) {
            const targetTeam = this.game.getComponent(this.currentTarget, 'team');
            if (targetTeam?.team === 'enemy') {
                // Attack target
                this.attackTarget(this.currentTarget);
            } else {
                // Interact with friendly/neutral
                this.interactWithTarget(this.currentTarget);
            }
        }
    }

    updateHoverTarget() {
        // Simple proximity check for now
        // In a full implementation, would do proper ray-entity intersection
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const playerTransform = this.game.getComponent(localPlayer, 'transform');
        if (!playerTransform) return;

        let closestEntity = null;
        let closestDist = 100; // Max hover distance

        // Check monsters
        const monsters = this.game.call('getMonsterEntities') || [];
        for (const entityId of monsters) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (!transform) continue;

            const dx = this.mouseWorldPosition.x - transform.position.x;
            const dz = this.mouseWorldPosition.z - transform.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < closestDist && dist < 50) { // Within 50 units of mouse
                closestDist = dist;
                closestEntity = entityId;
            }
        }

        // Check other players
        const otherPlayers = this.game.call('getOtherPlayers');
        if (otherPlayers) {
            for (const [playerId, playerData] of otherPlayers) {
                const entityId = playerData.entityId;
                const transform = this.game.getComponent(entityId, 'transform');
                if (!transform) continue;

                const dx = this.mouseWorldPosition.x - transform.position.x;
                const dz = this.mouseWorldPosition.z - transform.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < closestDist && dist < 50) {
                    closestDist = dist;
                    closestEntity = entityId;
                }
            }
        }

        this.hoverTarget = closestEntity;

        // Update cursor
        document.body.style.cursor = this.hoverTarget ? 'pointer' : 'default';
    }

    setTarget(entityId) {
        this.currentTarget = entityId;
        this.updateTargetFrame();
        this.game.triggerEvent('onTargetChanged', { target: entityId });
    }

    clearTarget() {
        this.currentTarget = null;
        this.updateTargetFrame();
        this.game.triggerEvent('onTargetChanged', { target: null });
    }

    cycleTargets() {
        // Get all valid targets
        const monsters = this.game.call('getMonsterEntities') || [];
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const playerTransform = this.game.getComponent(localPlayer, 'transform');
        if (!playerTransform) return;

        // Filter by distance and sort
        const validTargets = monsters.filter(entityId => {
            const transform = this.game.getComponent(entityId, 'transform');
            if (!transform) return false;
            const dx = transform.position.x - playerTransform.position.x;
            const dz = transform.position.z - playerTransform.position.z;
            return Math.sqrt(dx * dx + dz * dz) < 300;
        });

        if (validTargets.length === 0) {
            this.clearTarget();
            return;
        }

        // Find current target index and move to next
        const currentIndex = this.currentTarget ? validTargets.indexOf(this.currentTarget) : -1;
        const nextIndex = (currentIndex + 1) % validTargets.length;
        this.setTarget(validTargets[nextIndex]);
    }

    updateTargetFrame() {
        const targetFrame = document.getElementById('target-frame');
        if (!targetFrame) return;

        if (!this.currentTarget) {
            targetFrame.style.display = 'none';
            return;
        }

        const health = this.game.getComponent(this.currentTarget, 'health');
        const unitType = this.game.getComponent(this.currentTarget, 'unitType');
        const monster = this.game.getComponent(this.currentTarget, 'monster');
        const playerChar = this.game.getComponent(this.currentTarget, 'playerCharacter');

        let name = 'Unknown';
        let level = 1;

        if (monster) {
            name = unitType?.id || 'Monster';
            level = monster.level;
        } else if (playerChar) {
            name = playerChar.playerName;
            level = playerChar.level;
        }

        const healthPercent = health ? (health.current / health.max * 100) : 100;

        targetFrame.style.display = 'block';
        targetFrame.innerHTML = `
            <div class="target-name">${name} (Lv.${level})</div>
            <div class="target-health-bar">
                <div class="health-fill" style="width: ${healthPercent}%"></div>
                <span class="health-text">${health ? Math.floor(health.current) : '?'}/${health ? health.max : '?'}</span>
            </div>
        `;
    }

    attackTarget(targetEntityId) {
        // Basic attack - use ability slot 1
        this.useAbility(1, targetEntityId);
    }

    interactWithTarget(targetEntityId) {
        const interactable = this.game.getComponent(targetEntityId, 'interactable');
        if (interactable) {
            this.handleInteractionWith(targetEntityId, interactable);
        }
    }

    handleAbilityHotkey(slot) {
        if (this.isAbilityReady(slot)) {
            this.useAbility(slot, this.currentTarget);
        }
    }

    useAbility(slot, targetEntityId = null) {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return false;

        // Get ability from player's action bar
        const abilities = this.game.getCollections().abilities;
        const playerAbilities = this.game.call('getPlayerAbilities') || ['basic_attack', 'fireball', 'heal'];

        if (slot < 1 || slot > playerAbilities.length) return false;

        const abilityId = playerAbilities[slot - 1];
        const ability = abilities?.[abilityId];

        if (!ability) return false;

        // Check cooldown
        const cooldownEnd = this.abilityCooldowns.get(abilityId) || 0;
        if (this.game.state.now < cooldownEnd) return false;

        // Check if target is required
        if (ability.requiresTarget && !targetEntityId) {
            this.game.call('showNotification', 'No target selected', 'warning');
            return false;
        }

        // Check range
        if (targetEntityId) {
            const playerTransform = this.game.getComponent(localPlayer, 'transform');
            const targetTransform = this.game.getComponent(targetEntityId, 'transform');

            if (playerTransform && targetTransform) {
                const dx = targetTransform.position.x - playerTransform.position.x;
                const dz = targetTransform.position.z - playerTransform.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > (ability.range || 100)) {
                    this.game.call('showNotification', 'Target out of range', 'warning');
                    return false;
                }
            }
        }

        // Execute ability
        this.game.call('executeAbility', localPlayer, abilityId, targetEntityId || this.mouseWorldPosition);

        // Set cooldown
        this.abilityCooldowns.set(abilityId, this.game.state.now + (ability.cooldown || 1));

        // Sync to server
        this.game.call('syncPlayerAction', {
            type: 'ability',
            abilityId,
            target: targetEntityId,
            position: this.mouseWorldPosition
        });

        return true;
    }

    isAbilityReady(slot) {
        const playerAbilities = this.game.call('getPlayerAbilities') || ['basic_attack', 'fireball', 'heal'];
        if (slot < 1 || slot > playerAbilities.length) return false;

        const abilityId = playerAbilities[slot - 1];
        const cooldownEnd = this.abilityCooldowns.get(abilityId) || 0;
        return this.game.state.now >= cooldownEnd;
    }

    handleInteraction() {
        // Check for nearby interactables
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const playerTransform = this.game.getComponent(localPlayer, 'transform');
        if (!playerTransform) return;

        // Find nearest interactable
        let nearestInteractable = null;
        let nearestDist = this.interactionRange;

        const interactables = this.game.getEntitiesWith('interactable');
        for (const entityId of interactables) {
            const transform = this.game.getComponent(entityId, 'transform');
            const interactable = this.game.getComponent(entityId, 'interactable');
            if (!transform || !interactable) continue;

            const dx = transform.position.x - playerTransform.position.x;
            const dz = transform.position.z - playerTransform.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < nearestDist && dist <= interactable.interactionRadius) {
                nearestDist = dist;
                nearestInteractable = { entityId, interactable };
            }
        }

        if (nearestInteractable) {
            this.handleInteractionWith(nearestInteractable.entityId, nearestInteractable.interactable);
        }
    }

    handleInteractionWith(entityId, interactable) {
        switch (interactable.interactionType) {
            case 'npc':
                this.game.call('openNPCDialog', entityId);
                break;
            case 'portal':
                this.handlePortalInteraction(entityId);
                break;
            case 'loot':
                const loot = this.game.getComponent(entityId, 'loot');
                if (loot) {
                    this.game.call('collectLoot', loot.lootId);
                }
                break;
            case 'shop':
                this.game.call('openShop', entityId);
                break;
            default:
                console.log('[PlayerControlSystem] Unknown interaction type:', interactable.interactionType);
        }
    }

    handlePortalInteraction(entityId) {
        const portal = this.game.getComponent(entityId, 'adventurePortal');
        if (!portal) return;

        // Check if player meets level requirement
        const playerLevel = this.game.state.playerLevel || 1;
        if (playerLevel < portal.minLevel) {
            this.game.call('showNotification', `Requires level ${portal.minLevel}`, 'warning');
            return;
        }

        // Check if in party or solo
        const isInParty = this.game.call('isInParty');
        const isLeader = this.game.call('isPartyLeader');

        if (isInParty && !isLeader) {
            this.game.call('showNotification', 'Only party leader can start adventures', 'warning');
            return;
        }

        // Start adventure
        this.game.call('startAdventure', portal.adventureId, (success, data) => {
            if (success) {
                this.game.call('showNotification', `Entering ${portal.name}...`, 'info');
            } else {
                this.game.call('showNotification', 'Failed to start adventure', 'error');
            }
        });
    }

    showInteractionPrompt(text) {
        let prompt = document.getElementById('interaction-prompt');
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.id = 'interaction-prompt';
            prompt.style.cssText = `
                position: fixed;
                bottom: 150px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #4a9eff;
                border-radius: 8px;
                padding: 10px 20px;
                color: white;
                font-size: 14px;
                z-index: 100;
            `;
            document.body.appendChild(prompt);
        }
        prompt.textContent = `[E] ${text}`;
        prompt.style.display = 'block';
    }

    hideInteractionPrompt() {
        const prompt = document.getElementById('interaction-prompt');
        if (prompt) {
            prompt.style.display = 'none';
        }
    }

    update() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const controllable = this.game.getComponent(localPlayer, 'controllable');
        if (!controllable || !controllable.isControlled) return;

        // Handle movement input
        this.updateMovement(localPlayer);

        // Update target frame
        if (this.currentTarget) {
            this.updateTargetFrame();
        }

        // Update ability cooldown UI
        this.updateAbilityCooldownUI();
    }

    updateMovement(entityId) {
        const velocity = this.game.getComponent(entityId, 'velocity');
        const movement = this.game.getComponent(entityId, 'movement');

        if (!velocity || !movement) return;

        // Calculate movement direction
        let moveX = 0;
        let moveZ = 0;

        if (this.keys.w || this.keys.up) moveZ -= 1;
        if (this.keys.s || this.keys.down) moveZ += 1;
        if (this.keys.a || this.keys.left) moveX -= 1;
        if (this.keys.d || this.keys.right) moveX += 1;

        // Normalize diagonal movement
        if (moveX !== 0 && moveZ !== 0) {
            const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
            moveX /= len;
            moveZ /= len;
        }

        // Apply sprint
        const speed = movement.speed * (this.keys.shift ? this.sprintMultiplier : 1);

        // Set velocity
        velocity.vx = moveX * speed;
        velocity.vz = moveZ * speed;

        // Rotate player to face movement direction
        if (moveX !== 0 || moveZ !== 0) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform) {
                transform.rotation.y = Math.atan2(moveX, moveZ);
            }
        }
    }

    updateAbilityCooldownUI() {
        const playerAbilities = this.game.call('getPlayerAbilities') || ['basic_attack', 'fireball', 'heal'];

        for (let i = 0; i < playerAbilities.length; i++) {
            const slot = i + 1;
            const abilityId = playerAbilities[i];
            const cooldownEnd = this.abilityCooldowns.get(abilityId) || 0;
            const remaining = Math.max(0, cooldownEnd - this.game.state.now);

            const slotElement = document.getElementById(`ability-slot-${slot}`);
            if (slotElement) {
                const cooldownOverlay = slotElement.querySelector('.cooldown-overlay');
                if (cooldownOverlay) {
                    if (remaining > 0) {
                        cooldownOverlay.style.display = 'block';
                        cooldownOverlay.textContent = remaining.toFixed(1);
                    } else {
                        cooldownOverlay.style.display = 'none';
                    }
                }
            }
        }
    }

    onSceneUnload() {
        // Remove event listeners
        document.removeEventListener('keydown', this.handleKeyDown.bind(this));
        document.removeEventListener('keyup', this.handleKeyUp.bind(this));

        // Reset state
        this.currentTarget = null;
        this.hoverTarget = null;
        this.abilityCooldowns.clear();

        // Clean up UI
        this.hideInteractionPrompt();
    }
}
