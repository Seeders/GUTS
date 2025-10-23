class SelectedUnitSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.selectedUnitSystem = this;
        this.canvas = this.game.canvas;
        
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
        
        // Box selection state
        this.boxSelection = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            element: null
        };
        
        // Selection mode tracking
        this.selectedUnitIds = new Set(); // Track multiple selected squads
        
        // Initialize flag
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized || !this.game.scene) return;
        
        this.initialized = true;
        this.createBoxSelectionElement();
        this.setupBoxSelectionListeners();
        console.log('[SelectedUnitSystem] Initialized with box selection');
    }
    
    createBoxSelectionElement() {
        // Create the visual selection box element
        const boxElement = document.createElement('div');
        boxElement.id = 'unitSelectionBox';
        boxElement.style.cssText = `
            position: absolute;
            border: 2px solid rgba(0, 255, 0, 0.8);
            background: rgba(0, 255, 0, 0.1);
            pointer-events: none;
            display: none;
            z-index: 10000;
        `;
        document.body.appendChild(boxElement);
        this.boxSelection.element = boxElement;
    }
    
    setupBoxSelectionListeners() {
        // Mouse down - start box selection
        this.canvas.addEventListener('mousedown', (event) => {
            // Only left click, and not clicking on UI elements
            if (event.button !== 0) return;
            
            const rect = this.canvas.getBoundingClientRect();
            this.boxSelection.startX = event.clientX;
            this.boxSelection.startY = event.clientY;
            this.boxSelection.currentX = event.clientX;
            this.boxSelection.currentY = event.clientY;
            this.boxSelection.active = true;
            
            // Don't show box immediately - wait for drag
        });
        
        // Mouse move - update box selection
        this.canvas.addEventListener('mousemove', (event) => {
            if (!this.boxSelection.active) return;
            
            this.boxSelection.currentX = event.clientX;
            this.boxSelection.currentY = event.clientY;
            
            // Calculate distance dragged
            const dx = this.boxSelection.currentX - this.boxSelection.startX;
            const dy = this.boxSelection.currentY - this.boxSelection.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Only show box if dragged more than 5 pixels (prevents accidental box on click)
            if (distance > 5) {
                this.updateBoxSelectionVisual();
            }
        });
        
        // Mouse up - complete box selection
        this.canvas.addEventListener('mouseup', (event) => {
            if (!this.boxSelection.active) return;
            
            const dx = this.boxSelection.currentX - this.boxSelection.startX;
            const dy = this.boxSelection.currentY - this.boxSelection.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // If dragged significantly, do box selection
            if (distance > 5) {
                this.completeBoxSelection(event);
            } else if(!this.game.unitOrderSystem.isTargeting){
                // Single click selection
                this.checkUnitSelectionClick(event);
            }
            
            // Reset box selection state
            this.boxSelection.active = false;
            this.boxSelection.element.style.display = 'none';
        });
        
        // Cancel box selection on context menu or escape
        this.canvas.addEventListener('contextmenu', (event) => {
            if (this.boxSelection.active) {
                event.preventDefault();
                this.cancelBoxSelection();
            }
        });
        
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.boxSelection.active) {
                this.cancelBoxSelection();
            }
        });
    }
    
    updateBoxSelectionVisual() {
        const box = this.boxSelection;
        const element = box.element;
        
        // Calculate box dimensions
        const left = Math.min(box.startX, box.currentX);
        const top = Math.min(box.startY, box.currentY);
        const width = Math.abs(box.currentX - box.startX);
        const height = Math.abs(box.currentY - box.startY);
        
        // Update element
        element.style.left = left + 'px';
        element.style.top = top + 'px';
        element.style.width = width + 'px';
        element.style.height = height + 'px';
        element.style.display = 'block';
    }
        
    completeBoxSelection(event) {
        const box = this.boxSelection;
        
        // Get box boundaries in screen space (client coordinates)
        const left = Math.min(box.startX, box.currentX);
        const right = Math.max(box.startX, box.currentX);
        const top = Math.min(box.startY, box.currentY);
        const bottom = Math.max(box.startY, box.currentY);
        
        // Find all units within the selection box
        const selectedUnits = this.getUnitsInScreenBox(left, top, right, bottom);
        
        // Check if shift is held for additive selection
        const isAdditive = event.shiftKey;
        
        if (!isAdditive) {
            this.selectedUnitIds.clear();
        }
        selectedUnits.forEach((unitId) => {
            this.selectedUnitIds.add(unitId);
        });

        const currentUnit = selectedUnits[0];
        if(currentUnit){
            const team = this.game.getComponent(currentUnit, this.componentTypes.TEAM );
            const unitType = this.game.getComponent(currentUnit, this.componentTypes.UNIT_TYPE );
            if(team){
                const placementId = team.placementId;
                if(unitType.collection == 'units'){
                    const squadData = this.game.squadExperienceSystem?.getSquadInfo(placementId);                
                    if (squadData) {
                        const displayName = this.game.squadExperienceSystem.getSquadDisplayName(placementId);
                        this.game.unitOrderSystem.showSquadActionPanel(placementId, displayName, squadData);
                    }
                } else {
                    const placement = this.game.placementSystem.getPlacementById(placementId);
                    this.game.shopSystem.renderBuildingActions(placement);
                }
            }
        }
        // Update the UI and highlights for all selected squads
        if (this.selectedUnitIds.size > 0) {
            this.updateMultipleSquadSelection();
        }
        
    }


    getUnitsInScreenBox(left, top, right, bottom) {
        const selectedUnits = [];
        const rect = this.canvas.getBoundingClientRect();
        
        // Get all entities with position component
        const entities = this.game.getEntitiesWith(this.componentTypes.POSITION);
        
        entities.forEach(entityId => {
            // Only select units on player's team
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            if (!team) return;
            
            // Try multiple ways to check team
            const unitTeam = team.team || team.side || team.teamId;
            const myTeam = this.game.state.mySide || this.game.state.playerSide || this.game.state.team;
            
            if (unitTeam !== myTeam) {
                return;
            }
            
            // Get position component
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            if (!pos) return;
            
            // Convert world position to screen position
            const screenPos = this.worldToScreen(pos.x, pos.y, pos.z);
            if (!screenPos) return;
            
            // Convert normalized screen coords (0-1) to client coordinates
            const screenX = screenPos.x * rect.width + rect.left;
            const screenY = screenPos.y * rect.height + rect.top;
            
            // Check if within selection box (in client coordinates)
            if (screenX >= left && screenX <= right && 
                screenY >= top && screenY <= bottom) {
                selectedUnits.push(entityId);
            }
        });
        
        return selectedUnits;
    }
    worldToScreen(x, y, z) {
        if (!this.game.camera || !this.game.canvas) return null;
        
        try {
            // Create a 3D vector
            const vector = new THREE.Vector3(x, y, z);
            
            // Project to screen space
            vector.project(this.game.camera);
            
            // Check if behind camera
            if (vector.z > 1) return null;
            
            // Convert to screen coordinates (0 to 1 range)
            // (0,0) is top-left, (1,1) is bottom-right
            return {
                x: (vector.x + 1) / 2,
                y: (-vector.y + 1) / 2
            };
        } catch (error) {
            console.warn('[SelectedUnitSystem] worldToScreen error:', error);
            return null;
        }
    }
    findSquadForUnit(entityId) {           
        const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
        return team?.placementId || null;
    }
    updateMultipleSquadSelection() {
        // Highlight all units
        this.highlightUnits(Array.from(this.selectedUnitIds));
        
        // Update UI to show multi-selection
        if (this.selectedUnitIds.size === 1) {
            // Single squad selected - show normal panel
            const unitId = Array.from(this.selectedUnitIds)[0];
            this.selectUnit(unitId);
        } else if (this.selectedUnitIds.size > 1) {
            // Multiple squads selected - show multi-selection panel
            this.showMultiSelectionPanel();
        }
    }
    
    showMultiSelectionPanel() {
        // Create a custom UI panel for multiple selection
        const panel = document.getElementById('squadActionsPanel') || 
                     document.getElementById('buildingActionsPanel');
        
        if (!panel) return;
        
        panel.innerHTML = `
            <div class="multi-selection-panel">
                <h3>Multiple Units Selected</h3>
                <p>${this.selectedUnitIds.size} squads selected</p>
                <div class="multi-actions">
                    <button id="deselectAllBtn" class="action-btn">Deselect All</button>
                </div>
            </div>
        `;
        
        panel.style.display = 'block';
        
        // Setup deselect button
        const deselectBtn = document.getElementById('deselectAllBtn');
        if (deselectBtn) {
            deselectBtn.addEventListener('click', () => {
                this.clearAllHighlights();
                this.selectedUnitIds.clear();
                panel.style.display = 'none';
            });
        }
    }
    
    cancelBoxSelection() {
        this.boxSelection.active = false;
        this.boxSelection.element.style.display = 'none';
    }

    checkUnitSelectionClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const worldPos = this.game.placementSystem.getWorldPositionFromMouse(event, mouseX, mouseY);
    
        if (!worldPos) return;
    
        const placementId = this.game.placementSystem.getPlacementAtWorldPosition(worldPos);
    
        if (placementId) {
            const placement = this.game.placementSystem.getPlacementById(placementId);
            if (placement && placement.team === this.game.state.mySide) {
                let entityId = placement.squadUnits[0].entityId;
                // Check if shift is held for additive selection
                if (event.shiftKey) {
                    if (this.selectedUnitIds.has(entityId)) {
                        // Deselect if already selected
                        this.selectedUnitIds.delete(entityId);
                    } else {
                        // Add to selection
                        this.selectedUnitIds.add(entityId);
                    }
                    this.updateMultipleSquadSelection();
                } else {
                    // Single selection (clear others)
                    this.selectedUnitIds.clear();
                    this.selectedUnitIds.add(entityId);
                    this.selectUnit(entityId, placementId);
                }
            }
        } else {
            // Clicked on empty space - deselect all
            if (!event.shiftKey) {
                this.clearAllHighlights();
                this.selectedUnitIds.clear();
            }
        }
    }
    
    selectUnit(entityId, placementId) {
        if (!entityId) return;
        
        this.game.state.selectedEntity.entityId = entityId;
        this.game.state.selectedEntity.type = 'unit';
        const squadData = this.game.squadExperienceSystem?.getSquadInfo(placementId);
        
        if (squadData) {
            const placement = this.game.placementSystem.getPlacementById(placementId);
            if(placement.collection == "units"){
                const displayName = this.game.squadExperienceSystem.getSquadDisplayName(placementId);
                this.game.unitOrderSystem.showSquadActionPanel(placementId, displayName, squadData);
            } else {
                this.game.shopSystem.renderBuildingActions(placement);
            }
            this.game.selectedUnitSystem.highlightUnits(squadData.unitIds);
        }
    }

    update() {
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
            
            if (unitData && unitData.size) {
                return unitData.size + 2; // Slightly larger than unit
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
    
    // Get all currently selected squad IDs
    getSelectedSquads() {
        let placementIds = new Set();
        const CT = this.game.componentManager.getComponentTypes();
        Array.from(this.selectedUnitIds).forEach((unitId) => {
            const team = this.game.getComponent(unitId, CT.TEAM);
            placementIds.add(team.placementId);
        });
        return [...placementIds];
    }
    getSelectedUnits() {
        return Array.from(this.selectedUnitIds);
    }
    destroy() {
        // Clean up box selection element
        if (this.boxSelection.element && this.boxSelection.element.parentElement) {
            this.boxSelection.element.parentElement.removeChild(this.boxSelection.element);
        }
        
        // Clean up all selection circles
        for (const [entityId] of this.selectionCircles) {
            this.removeSelectionCircle(entityId);
        }
        
        this.selectionCircles.clear();
        this.highlightedUnits.clear();
        this.selectedUnitIds.clear();
        this.initialized = false;
        
        console.log('[SelectedUnitSystem] Destroyed');
    }
}