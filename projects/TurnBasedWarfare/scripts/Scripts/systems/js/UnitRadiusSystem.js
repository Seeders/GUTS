class UnitRadiusSystem {
    constructor(game) {
        this.game = game;
        this.game.unitRadiusSystem = this;        
        this.componentTypes = this.game.componentManager.getComponentTypes();
        this.debugCircles = new Map(); // entityId -> { sizeCircle, attackCircle }
        this.enabled = false; // Toggle this to show/hide circles
        
        // Visual configuration
        this.SIZE_CIRCLE_COLOR = 0x00ff00;      // Green for unit size
        this.ATTACK_CIRCLE_COLOR = 0xff0000;    // Red for attack range
        this.CIRCLE_OPACITY = 0.3;
        this.CIRCLE_LINE_WIDTH = 2;
    }
    
    update(deltaTime) {
        if (!this.enabled || this.game.state.phase !== 'battle') {
            this.hideAllCircles();
            return;
        }
        
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.UNIT_TYPE
        );
        
        entities.forEach(entityId => {
            this.updateEntityCircles(entityId);
        });
        
        // Clean up circles for destroyed entities
        this.cleanupDestroyedEntities(entities);
    }
    
    updateEntityCircles(entityId) {
        const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        const collision = this.game.getComponent(entityId, this.componentTypes.COLLISION);
        const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
        
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
        
        // Show/hide attack circle based on entity state
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        if (aiState && (aiState.state === 'attacking' || aiState.state === 'chasing')) {
            circles.attackCircle.visible = true;
            if (aiState.state === 'attacking') {
                circles.attackCircle.material.color.setHex(0xff0000); // Bright red when attacking
            } else {
                circles.attackCircle.material.color.setHex(0xffaa00); // Orange when chasing
            }
        } else {
            circles.attackCircle.visible = true; // Show it anyway for debugging
            circles.attackCircle.material.color.setHex(0x0000ff); // Blue when idle
        }
    }
    
    createDebugCircles(entityId) {
        if (!this.game.worldSystem || !this.game.worldSystem.scene) {
            console.error('No scene found! worldSystem:', this.game.worldSystem);
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
        this.game.worldSystem.scene.add(sizeCircle);
        this.game.worldSystem.scene.add(attackCircle);
        
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
        
        for (const [entityId, circles] of this.debugCircles) {
            if (!activeIds.has(entityId)) {
                // Remove from scene
                if (circles.sizeCircle && this.game.worldSystem.scene) {
                    this.game.worldSystem.scene.remove(circles.sizeCircle);
                    circles.sizeCircle.geometry.dispose();
                    circles.sizeCircle.material.dispose();
                }
                if (circles.attackCircle && this.game.worldSystem.scene) {
                    this.game.worldSystem.scene.remove(circles.attackCircle);
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