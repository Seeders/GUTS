class UnitRadiusSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.unitRadiusSystem = this;        
        this.debugCircles = new Map(); // entityId -> { sizeCircle, attackCircle }
        this.enabled = false; // Toggle this to show/hide circles
        
        // Visual configuration
        this.SIZE_CIRCLE_COLOR = 0x00ff00;      // Green for unit size
        this.ATTACK_CIRCLE_COLOR = 0xff0000;    // Red for attack range
        this.CIRCLE_OPACITY = 0.3;
        this.CIRCLE_LINE_WIDTH = 2;
    }
    
    update() {
        if (!this.enabled ) return;
        if(this.game.state.phase !== 'battle') {
            this.hideAllCircles();
            return;
        }

        const entities = this.game.getEntitiesWith(
            "transform",
            "unitType"
        );

        entities.forEach(entityId => {
            this.updateEntityCircles(entityId);
        });

        // Clean up circles for destroyed entities
        this.cleanupDestroyedEntities(entities);
    }

    updateEntityCircles(entityId) {
        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
        const collision = this.game.getComponent(entityId, "collision");
        const combat = this.game.getComponent(entityId, "combat");

        if (!pos || !collision) return;
        
        // Get or create debug circles for this entity
        let circles = this.debugCircles.get(entityId);
        if (!circles) {
            circles = this.createDebugCircles(entityId);
            this.debugCircles.set(entityId, circles);
        }
        
        if (!circles.sizeCircle || !circles.attackCircle) {
            return;
        }
        
        // Update positions
        circles.sizeCircle.position.set(pos.x, pos.y + 50, pos.z); // y=1 to avoid z-fighting
        circles.attackCircle.position.set(pos.x, pos.y + 60, pos.z); // y=2 to be above size circle
        
        // Update sizes
        const unitRadius = this.getUnitRadius(collision);
        const attackRange = this.getAttackRange(combat, collision);
        
        //console.log(`Entity ${entityId}: unitRadius=${unitRadius}, attackRange=${attackRange}, pos=(${pos.x}, ${pos.y})`);
        
        // Scale the circles - base circle is 50 units radius, so scale accordingly
        circles.sizeCircle.scale.setScalar(unitRadius / 50);
        circles.attackCircle.scale.setScalar(attackRange / 50);
        
        // Always show size circle
        circles.sizeCircle.visible = true;

        // Show/hide attack circle based on entity action
        const aiState = this.game.getComponent(entityId, "aiState");
        const isAttacking = aiState && aiState.currentAction && (aiState.currentAction === 'AttackEnemyBehaviorAction' || aiState.currentAction === 'CombatBehaviorAction');
        const isChasing = aiState && aiState.currentAction && (aiState.shared || (aiState.shared && aiState.shared.targetPosition));

        if (isAttacking) {
            circles.attackCircle.visible = true;
            circles.attackCircle.material.color.setHex(0xff0000); // Bright red when attacking
        } else if (isChasing) {
            circles.attackCircle.visible = true;
            circles.attackCircle.material.color.setHex(0xffaa00); // Orange when chasing
        } else {
            circles.attackCircle.visible = true; // Show it anyway for debugging
            circles.attackCircle.material.color.setHex(0x0000ff); // Blue when idle
        }
    }
    
    createDebugCircles(entityId) {
        const scene = this.game.gameManager.call('getWorldScene');
        if (!scene) {
            console.error('No scene found!');
            return { sizeCircle: null, attackCircle: null };
        }

        // Create size circle (unit radius)
        const sizeGeometry = new THREE.RingGeometry(48, 50, 32); // Thin ring
        const sizeMaterial = new THREE.MeshBasicMaterial({
            color: this.SIZE_CIRCLE_COLOR,
            transparent: true,
            opacity: this.CIRCLE_OPACITY,
            side: THREE.DoubleSide
        });
        const sizeCircle = new THREE.Mesh(sizeGeometry, sizeMaterial);
        sizeCircle.rotation.x = -Math.PI / 2; // Lay flat on ground

        // Create attack range circle
        const attackGeometry = new THREE.RingGeometry(48, 50, 32); // Thin ring
        const attackMaterial = new THREE.MeshBasicMaterial({
            color: this.ATTACK_CIRCLE_COLOR,
            transparent: true,
            opacity: this.CIRCLE_OPACITY,
            side: THREE.DoubleSide
        });
        const attackCircle = new THREE.Mesh(attackGeometry, attackMaterial);
        attackCircle.rotation.x = -Math.PI / 2; // Lay flat on ground

        // Add to scene
        scene.add(sizeCircle);
        scene.add(attackCircle);

        return { sizeCircle, attackCircle };
    }
    
    getUnitRadius(collision) {
        // Use the same logic as your MovementSystem
        if (collision && collision.radius) {
            return collision.radius; 
        }
        
        return 0.1;
    }
    
    getAttackRange(combat, collision) {
        if (!combat) return 0;
        
        const unitRadius = this.getUnitRadius(collision);
        const attackRange = Math.max(combat.range, unitRadius);
        
        return attackRange;
    }
    
    cleanupDestroyedEntities(activeEntities) {
        const activeIds = new Set(activeEntities);
        const scene = this.game.gameManager.call('getWorldScene');

        for (const [entityId, circles] of this.debugCircles) {
            if (!activeIds.has(entityId)) {
                // Remove from scene
                if (circles.sizeCircle && scene) {
                    scene.remove(circles.sizeCircle);
                    circles.sizeCircle.geometry.dispose();
                    circles.sizeCircle.material.dispose();
                }
                if (circles.attackCircle && scene) {
                    scene.remove(circles.attackCircle);
                    circles.attackCircle.geometry.dispose();
                    circles.attackCircle.material.dispose();
                }

                // Remove from map
                this.debugCircles.delete(entityId);
            }
        }
    }
    
    hideAllCircles() {
        for (const [entityId, circles] of this.debugCircles) {
            if (circles.sizeCircle) circles.sizeCircle.visible = false;
            if (circles.attackCircle) circles.attackCircle.visible = false;
        }
    }
    
    showAllCircles() {
        for (const [entityId, circles] of this.debugCircles) {
            if (circles.sizeCircle) circles.sizeCircle.visible = true;
            if (circles.attackCircle) circles.attackCircle.visible = true;
        }
    }
    
    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this.showAllCircles();
        } else {
            this.hideAllCircles();
        }
        console.log(`Unit debug circles ${this.enabled ? 'enabled' : 'disabled'}`);
    }
    
    cleanup() {
        this.hideAllCircles();
        this.cleanupDestroyedEntities([]);
    }
}