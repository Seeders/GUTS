class PlayerControllerSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.clickPosition = new THREE.Vector3();

        this.setupInputHandlers();
    }

    setupInputHandlers() {
        // Mouse click handler for movement and attacks
        document.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return; // Only left click
            if (this.game.state.isPaused) return;

            this.handleMouseClick(event);
        });

        // Skill hotkeys
        document.addEventListener('keydown', (event) => {
            if (this.game.state.isPaused) return;

            // Skills mapped to 1-8
            if (event.key >= '1' && event.key <= '8') {
                const skillIndex = parseInt(event.key) - 1;
                this.selectSkill(skillIndex);
            }

            // Health potion - Q
            if (event.key === 'q' || event.key === 'Q') {
                this.useHealthPotion();
            }

            // Mana potion - W
            if (event.key === 'w' || event.key === 'W') {
                this.useManaPotion();
            }
        });

        // Right-click for forced attack
        document.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            if (this.game.state.isPaused) return;

            this.handleRightClick(event);
        });
    }

    handleMouseClick(event) {
        const player = this.getPlayer();
        if (!player) return;

        const clickedEnemy = this.getClickedEnemy(event);
        const controller = this.game.getComponent(player, 'PlayerController');

        if (clickedEnemy) {
            // Attack enemy
            controller.attackTarget = clickedEnemy;
            controller.targetPosition = null;
            controller.isMoving = false;
        } else {
            // Move to position
            const worldPosition = this.getWorldPosition(event);
            if (worldPosition) {
                controller.targetPosition = worldPosition;
                controller.attackTarget = null;
                controller.isMoving = true;
            }
        }
    }

    handleRightClick(event) {
        const player = this.getPlayer();
        if (!player) return;

        const clickedEnemy = this.getClickedEnemy(event);
        const controller = this.game.getComponent(player, 'PlayerController');

        if (clickedEnemy) {
            controller.attackTarget = clickedEnemy;
            controller.targetPosition = null;
            controller.isMoving = false;
        }
    }

    getClickedEnemy(event) {
        // Calculate mouse position in normalized device coordinates
        const canvas = this.game.canvasBuffer;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.game.renderSystem.camera);

        // Check for enemy hits
        const enemies = this.game.getEntitiesWith('EnemyAI', 'Position', 'Collision');

        for (const enemyId of enemies) {
            const position = this.game.getComponent(enemyId, 'Position');
            const collision = this.game.getComponent(enemyId, 'Collision');

            // Create a sphere for intersection test
            const sphere = new THREE.Sphere(
                new THREE.Vector3(position.x, position.y + collision.height / 2, position.z),
                collision.radius
            );

            if (this.raycaster.ray.intersectsSphere(sphere)) {
                return enemyId;
            }
        }

        return null;
    }

    getWorldPosition(event) {
        const canvas = this.game.canvasBuffer;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.game.renderSystem.camera);

        const intersectionPoint = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, intersectionPoint)) {
            return { x: intersectionPoint.x, y: 0, z: intersectionPoint.z };
        }

        return null;
    }

    selectSkill(skillIndex) {
        const player = this.getPlayer();
        if (!player) return;

        const skills = this.game.getComponent(player, 'Skills');
        if (!skills || !skills.skills[skillIndex]) return;

        const controller = this.game.getComponent(player, 'PlayerController');
        controller.selectedSkill = skillIndex;
    }

    useHealthPotion() {
        const player = this.getPlayer();
        if (!player) return;

        const inventory = this.game.getComponent(player, 'Inventory');
        if (!inventory) return;

        // Find health potion in inventory
        const potionIndex = inventory.items.findIndex(item => item && item.itemType === 'healthPotion');
        if (potionIndex === -1) return;

        const health = this.game.getComponent(player, 'Health');
        if (health.current >= health.max) return;

        // Use potion
        const potion = inventory.items[potionIndex];
        health.current = Math.min(health.max, health.current + (potion.stats?.healAmount || 50));

        // Remove from inventory
        if (potion.stackSize > 1) {
            potion.stackSize--;
        } else {
            inventory.items.splice(potionIndex, 1);
        }
    }

    useManaPotion() {
        const player = this.getPlayer();
        if (!player) return;

        const inventory = this.game.getComponent(player, 'Inventory');
        if (!inventory) return;

        const potionIndex = inventory.items.findIndex(item => item && item.itemType === 'manaPotion');
        if (potionIndex === -1) return;

        const mana = this.game.getComponent(player, 'Mana');
        if (mana.current >= mana.max) return;

        const potion = inventory.items[potionIndex];
        mana.current = Math.min(mana.max, mana.current + (potion.stats?.manaAmount || 50));

        if (potion.stackSize > 1) {
            potion.stackSize--;
        } else {
            inventory.items.splice(potionIndex, 1);
        }
    }

    getPlayer() {
        const players = this.game.getEntitiesWith('PlayerController');
        return players.values().next().value;
    }

    update(deltaTime, now) {
        const player = this.getPlayer();
        if (!player) return;

        const controller = this.game.getComponent(player, 'PlayerController');
        const position = this.game.getComponent(player, 'Position');
        const velocity = this.game.getComponent(player, 'Velocity');

        // Handle movement
        if (controller.isMoving && controller.targetPosition) {
            const dx = controller.targetPosition.x - position.x;
            const dz = controller.targetPosition.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < 0.5) {
                // Reached destination
                controller.isMoving = false;
                controller.targetPosition = null;
                velocity.vx = 0;
                velocity.vz = 0;
            } else {
                // Move towards target
                const dirX = dx / distance;
                const dirZ = dz / distance;

                velocity.vx = dirX * controller.moveSpeed;
                velocity.vz = dirZ * controller.moveSpeed;

                // Update facing direction
                const facing = this.game.getComponent(player, 'Facing');
                if (facing) {
                    facing.angle = Math.atan2(dirX, dirZ);
                }
            }
        } else if (!controller.attackTarget) {
            velocity.vx = 0;
            velocity.vz = 0;
        }

        // Handle attacking
        if (controller.attackTarget) {
            const targetPosition = this.game.getComponent(controller.attackTarget, 'Position');
            if (!targetPosition) {
                // Target is dead or gone
                controller.attackTarget = null;
                return;
            }

            const combat = this.game.getComponent(player, 'Combat');
            const dx = targetPosition.x - position.x;
            const dz = targetPosition.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance > combat.range) {
                // Move closer
                const dirX = dx / distance;
                const dirZ = dz / distance;

                velocity.vx = dirX * controller.moveSpeed;
                velocity.vz = dirZ * controller.moveSpeed;

                const facing = this.game.getComponent(player, 'Facing');
                if (facing) {
                    facing.angle = Math.atan2(dirX, dirZ);
                }
            } else {
                // In range, stop and attack
                velocity.vx = 0;
                velocity.vz = 0;

                // Face target
                const facing = this.game.getComponent(player, 'Facing');
                if (facing) {
                    facing.angle = Math.atan2(dx, dz);
                }
            }
        }
    }
}
