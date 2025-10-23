class SelectedUnitSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.selectedUnitSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Selection circle configuration
        this.CIRCLE_RADIUS = 25;
        this.CIRCLE_SEGMENTS = 32;
        this.CIRCLE_THICKNESS = 2;
        this.CIRCLE_COLOR = 0x00ff00; // Green selection color
        this.CIRCLE_OFFSET_Y = 1;   // Slightly above ground to prevent z-fighting
        
        // Track selection circles
        this.selectionCircles = new Map(); // entityId -> { circle, group, lastPosition }
        
        // Currently highlighted units
        this.highlightedUnits = new Set();
        
        // Initialize flag
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized || !this.game.scene) return;
        
        this.initialized = true;
        console.log('[SelectedUnitSystem] Initialized');
    }
    
    update(deltaTime = 0.016) {
        // Wait for scene to be available
        if (!this.game.scene || !this.game.camera) {
            return;
        }
        
        // Initialize if not done yet
        if (!this.initialized) {
            this.initialize();
        }
        
        
        // Update all active selection circles
        this.updateSelectionCircles();
        
        // Clean up circles for units that no longer exist or are deselected
        this.cleanupRemovedCircles();
    }
    
    highlightUnits(unitIds) {
        if (!unitIds || !Array.isArray(unitIds)) {
            this.clearAllHighlights();
            return;
        }
        
        // Convert to Set for easy comparison
        const newHighlightSet = new Set(unitIds);
        
        // Remove circles for units no longer selected
        for (const entityId of this.highlightedUnits) {
            if (!newHighlightSet.has(entityId)) {
                this.removeSelectionCircle(entityId);
            }
        }
        
        // Add circles for newly selected units
        for (const entityId of unitIds) {
            if (!this.highlightedUnits.has(entityId)) {
                this.createSelectionCircle(entityId);
            }
        }
        
        // Update tracked set
        this.highlightedUnits = newHighlightSet;
        
        console.log(`[SelectedUnitSystem] Highlighting ${unitIds.length} units`);
    }
    
    clearAllHighlights() {
        // Remove all selection circles
        for (const entityId of this.highlightedUnits) {
            this.removeSelectionCircle(entityId);
        }
        
        this.highlightedUnits.clear();
        console.log('[SelectedUnitSystem] Cleared all highlights');
    }
    
    createSelectionCircle(entityId) {
        // Don't create if already exists
        if (this.selectionCircles.has(entityId)) return;
        
        // Get entity position to determine size
        const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        if (!pos) return;
        
        // Determine radius based on unit type
        const radius = this.getUnitRadius(entityId);
        
        // Create ring geometry (donut shape)
        const geometry = new THREE.RingGeometry(
            radius - this.CIRCLE_THICKNESS / 2,
            radius + this.CIRCLE_THICKNESS / 2,
            this.CIRCLE_SEGMENTS
        );
        
        // Create material
        const material = new THREE.MeshBasicMaterial({
            color: this.CIRCLE_COLOR,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        
        // Create mesh
        const circle = new THREE.Mesh(geometry, material);
        circle.rotation.x = -Math.PI / 2; // Lay flat on ground
        circle.renderOrder = 9998; // Render before health bars
        
        // Create group to hold circle
        const group = new THREE.Group();
        group.add(circle);
        
        // Add to UI scene
        this.game.scene.add(group);
        
        // Store reference
        this.selectionCircles.set(entityId, {
            circle: circle,
            group: group,
            geometry: geometry,
            material: material,
            radius: radius,
            lastPosition: { x: pos.x, y: pos.y, z: pos.z },
            baseOpacity: 0.8
        });
        
        console.log(`[SelectedUnitSystem] Created selection circle for entity ${entityId}`);
    }
    
    updateSelectionCircles() {
        for (const [entityId, circleData] of this.selectionCircles) {
            // Check if entity still exists
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) {
                this.removeSelectionCircle(entityId);
                continue;
            }
            
            // Update position
            circleData.group.position.set(pos.x, pos.y + this.CIRCLE_OFFSET_Y, pos.z);
        }
    }
    
    getUnitRadius(entityId) {
        // Try to get unit type to determine appropriate radius
        const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        
        if (unitType) {
            const collections = this.game.getCollections?.();
            const unitData = (collections && collections[unitType.collection])
                ? collections[unitType.collection][unitType.id]
                : null;
            
            if (unitData && unitData.radius) {
                return unitData.radius + 2; // Slightly larger than unit
            }
            
            if (unitData && unitData.scale) {
                return (unitData.scale * 5) + 2; // Estimate based on scale
            }
        }
        
        // Default radius if no unit data
        return this.CIRCLE_RADIUS;
    }
    
    cleanupRemovedCircles() {
        for (const [entityId] of this.selectionCircles) {
            // Check if entity still exists
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) {
                this.removeSelectionCircle(entityId);
            }
            
            // Check if entity is still highlighted
            if (!this.highlightedUnits.has(entityId)) {
                this.removeSelectionCircle(entityId);
            }
        }
    }
    
    removeSelectionCircle(entityId) {
        const circleData = this.selectionCircles.get(entityId);
        if (!circleData) return;
        
        // Remove from scene
        if (this.game.scene) {
            this.game.scene.remove(circleData.group);
        }
        
        // Dispose of resources
        circleData.geometry.dispose();
        circleData.material.dispose();
        
        // Remove from map
        this.selectionCircles.delete(entityId);
        
        console.log(`[SelectedUnitSystem] Removed selection circle for entity ${entityId}`);
    }
    
    // Configuration methods
    setSelectionColor(color) {
        this.CIRCLE_COLOR = color;
        
        // Update existing circles
        for (const [_, circleData] of this.selectionCircles) {
            circleData.material.color.setHex(color);
        }
    }
    
    
    setCircleThickness(thickness) {
        this.CIRCLE_THICKNESS = thickness;
        
        // Would need to recreate all circles to apply
        // For now, just update the config for future circles
    }
    
    toggleAnimation(enabled) {
        if (!enabled) {
            // Reset all circles to default state
            for (const [_, circleData] of this.selectionCircles) {
                circleData.circle.scale.set(1, 1, 1);
                circleData.circle.rotation.z = 0;
                circleData.material.opacity = circleData.baseOpacity;
            }
        }
    }
    
    // Utility to check if a unit is currently highlighted
    isHighlighted(entityId) {
        return this.highlightedUnits.has(entityId);
    }
    
    // Get all currently highlighted unit IDs
    getHighlightedUnits() {
        return Array.from(this.highlightedUnits);
    }
    
    destroy() {
        // Clean up all selection circles
        for (const [entityId] of this.selectionCircles) {
            this.removeSelectionCircle(entityId);
        }
        
        this.selectionCircles.clear();
        this.highlightedUnits.clear();
        this.initialized = false;
        
        console.log('[SelectedUnitSystem] Destroyed');
    }
}