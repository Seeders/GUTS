/**
 * LootSystem - Client-side system for rendering loot drops and handling pickup clicks.
 *
 * Renders loot as floating icons/particles and handles player clicking to pick them up.
 */
class LootSystem extends GUTS.BaseSystem {
    static services = [
        'handleLootClick'
    ];

    static serviceDependencies = [
        'pickupLoot',
        'playSound',
        'createParticles'
    ];

    constructor(game) {
        super(game);
        this.game.lootSystem = this;
        this.lootMeshes = new Map(); // entityId -> THREE.Mesh
        this.pickupRange = 200; // Max click distance for pickup
    }

    init() {
    }

    onSceneLoad() {
        // Listen for clicks on loot
        this.setupClickHandler();
    }

    setupClickHandler() {
        // Add click listener to canvas
        const canvas = document.getElementById('renderCanvas');
        if (canvas) {
            canvas.addEventListener('click', (e) => this.onCanvasClick(e));
        }
    }

    onCanvasClick(event) {
        // Get click position and check for loot at that location
        const lootEntities = this.game.getEntitiesWith('loot', 'transform');

        if (lootEntities.length === 0) return;

        // Get mouse position in normalized device coordinates
        const canvas = event.target;
        const rect = canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Use raycasting to find clicked loot
        const camera = this.game.renderSystem?.camera;
        if (!camera) return;

        // Create raycaster
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({ x: mouseX, y: mouseY }, camera);

        // Check each loot entity
        let closestLoot = null;
        let closestDistance = Infinity;

        for (const entityId of lootEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (!transform) continue;

            // Create a point at the loot position
            const lootPos = new THREE.Vector3(transform.x, transform.y + 10, transform.z);

            // Calculate distance from ray to loot position
            const rayPoint = raycaster.ray.closestPointToPoint(lootPos, new THREE.Vector3());
            const distance = rayPoint.distanceTo(lootPos);

            // Check if within pickup range and closer than previous
            if (distance < this.pickupRange && distance < closestDistance) {
                closestLoot = entityId;
                closestDistance = distance;
            }
        }

        // If we found loot to pick up
        if (closestLoot !== null) {
            this.handleLootClick(closestLoot);
        }
    }

    handleLootClick(entityId) {
        console.log('[LootSystem] Attempting to pick up loot:', entityId);

        // Call the hunt mission system to process the pickup
        if (this.game.hasService('pickupLoot')) {
            const success = this.call.pickupLoot( entityId);
            if (success) {
                // Play pickup effect/sound
                this.playPickupEffect(entityId);
                // Remove visual
                this.removeLootVisual(entityId);
            }
        }
    }

    update(deltaTime) {
        // Update loot visuals (floating animation)
        const lootEntities = this.game.getEntitiesWith('loot', 'transform', 'lootVisual');

        for (const entityId of lootEntities) {
            // Create visual if not exists
            if (!this.lootMeshes.has(entityId)) {
                this.createLootVisual(entityId);
            }

            // Update position/animation
            this.updateLootVisual(entityId, deltaTime);
        }

        // Clean up visuals for destroyed entities
        for (const [entityId, mesh] of this.lootMeshes) {
            if (!this.game.hasEntity(entityId)) {
                this.removeLootVisual(entityId);
            }
        }
    }

    createLootVisual(entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        const lootVisual = this.game.getComponent(entityId, 'lootVisual');
        if (!transform || !lootVisual) return;

        const scene = this.game.renderSystem?.scene;
        if (!scene) return;

        // Create a simple glowing sphere for loot
        const geometry = new THREE.SphereGeometry(8, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: lootVisual.color || '#ffd700',
            transparent: true,
            opacity: 0.8
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(transform.x, transform.y + 15, transform.z);

        // Add a point light for glow effect
        const light = new THREE.PointLight(lootVisual.color || '#ffd700', 0.5, 50);
        light.position.set(0, 0, 0);
        mesh.add(light);

        // Store initial Y for bobbing animation
        mesh.userData.baseY = transform.y + 15;
        mesh.userData.time = Math.random() * Math.PI * 2; // Random phase

        scene.add(mesh);
        this.lootMeshes.set(entityId, mesh);

        console.log('[LootSystem] Created loot visual for entity:', entityId);
    }

    updateLootVisual(entityId, deltaTime) {
        const mesh = this.lootMeshes.get(entityId);
        if (!mesh) return;

        // Bobbing animation
        mesh.userData.time += deltaTime * 2;
        const bobHeight = Math.sin(mesh.userData.time) * 5;
        mesh.position.y = mesh.userData.baseY + bobHeight;

        // Rotation
        mesh.rotation.y += deltaTime;
    }

    removeLootVisual(entityId) {
        const mesh = this.lootMeshes.get(entityId);
        if (mesh) {
            const scene = this.game.renderSystem?.scene;
            if (scene) {
                scene.remove(mesh);
            }
            mesh.geometry?.dispose();
            mesh.material?.dispose();
            this.lootMeshes.delete(entityId);
        }
    }

    playPickupEffect(entityId) {
        // Play a pickup sound and particle effect
        if (this.game.hasService('playSound')) {
            this.call.playSound( 'pickup');
        }

        // Could add particle effect here
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform && this.game.hasService('createParticles')) {
            this.call.createParticles( {
                x: transform.x,
                y: transform.y + 20,
                z: transform.z,
                color: '#ffd700',
                count: 10,
                spread: 20,
                lifetime: 0.5
            });
        }
    }

    onSceneUnload() {
        // Clean up all loot visuals
        for (const [entityId, mesh] of this.lootMeshes) {
            this.removeLootVisual(entityId);
        }
        this.lootMeshes.clear();
    }
}
