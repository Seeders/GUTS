class SelectedUnitSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.selectedUnitSystem = this;
        this.canvas = this.game.canvas;

        // Editor mode flag - skip game-specific UI features
        this.isEditorMode = this.game.isEditor || false;

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
        
        this.currentSelectedIndex = 0;
        // Initialize flag
        this.initialized = false;
    }

    init() {
        this.game.register('getSelectedSquads', this.getSelectedSquads.bind(this));
    }

    initialize() {
        if (this.initialized || !this.game.scene) return;

        this.initialized = true;
        this.setupBoxSelectionListeners();
        this.createBoxSelectionElement();

        // Skip game-specific UI setup in editor mode
        if (this.isEditorMode) return;

        const unitPortrait = document.getElementById('unitPortrait');
        if(unitPortrait){
            unitPortrait.addEventListener('click', () => {
                if(this.game.state.selectedEntity?.entityId){
                    const isFollowing = this.game.call('toggleCameraFollow', this.game.state.selectedEntity.entityId);
                    // Update visual indicator
                    if (isFollowing) {
                        unitPortrait.classList.add('following');
                    } else {
                        unitPortrait.classList.remove('following');
                    }
                }
            });
        }
    }
    
    onUnFollowEntity(){
        if (this.isEditorMode) return;
        const unitPortrait = document.getElementById('unitPortrait');
        if (unitPortrait) {
            unitPortrait.classList.remove('following');
        }
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

        // Append to canvas parent if it exists and has relative/absolute positioning
        // Otherwise append to body
        const canvasParent = this.canvas?.parentElement;
        if (canvasParent) {
            // Ensure parent has positioning context
            const parentStyle = window.getComputedStyle(canvasParent);
            if (parentStyle.position === 'static') {
                canvasParent.style.position = 'relative';
            }
            canvasParent.appendChild(boxElement);
            this.boxSelection.useCanvasRelative = true;
        } else {
            document.body.appendChild(boxElement);
            this.boxSelection.useCanvasRelative = false;
        }
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
                requestAnimationFrame(() => {
                    this.completeBoxSelection(event);
                });
            } else {
                // Single click selection

                requestAnimationFrame(() => {
                    this.checkUnitSelectionClick(event);
                });
            }

            // Reset box selection state
            this.boxSelection.active = false;
            if (this.boxSelection.element) {
                this.boxSelection.element.style.display = 'none';
            }
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
        if (!element) return;

        // Calculate box dimensions in client coordinates
        let left = Math.min(box.startX, box.currentX);
        let top = Math.min(box.startY, box.currentY);
        const width = Math.abs(box.currentX - box.startX);
        const height = Math.abs(box.currentY - box.startY);

        // If using canvas-relative positioning, convert from client coords to parent-relative
        if (box.useCanvasRelative && this.canvas?.parentElement) {
            const parentRect = this.canvas.parentElement.getBoundingClientRect();
            left -= parentRect.left;
            top -= parentRect.top;
        }

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
        this.currentSelectedIndex = 0;
        if (this.selectedUnitIds.size > 0) {
            this.updateMultipleSquadSelection();
        } else {            
            this.deselectAll();
        }
        
    }


    getUnitsInScreenBox(left, top, right, bottom) {
        const selectedUnits = [];
        const selectedBuildings = [];
        const rect = this.canvas.getBoundingClientRect();

        // Get all entities with transform component
        const entities = this.game.getEntitiesWith("transform");

        entities.forEach(entityId => {
            // In editor mode, select any entity with transform and unitType/renderable
            // In game mode, only select units on player's team
            if (!this.isEditorMode) {
                const team = this.game.getComponent(entityId, "team");
                if (!team) return;

                // Try multiple ways to check team
                const unitTeam = team.team || team.side || team.teamId;
                const myTeam = this.game.state.mySide || this.game.state.playerSide || this.game.state.team;

                if (unitTeam !== myTeam) {
                    return;
                }
            }

            // Get position component
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const unitType = this.game.getComponent(entityId, "unitType");
            const renderable = this.game.getComponent(entityId, "renderable");

            // In editor mode, allow selection of any entity with position and renderable
            if (!pos) return;
            if (!unitType && !renderable) return;

            // Skip world objects (environment objects from level data) in scene editor
            // These should only be editable in terrain map editor
            if (this.isEditorMode && unitType?.collection === 'worldObjects') return;

            // Convert world position to screen position
            const screenPos = this.worldToScreen(pos.x, pos.y, pos.z);
            if (!screenPos) return;

            // Convert normalized screen coords (0-1) to client coordinates
            const screenX = screenPos.x * rect.width + rect.left;
            const screenY = screenPos.y * rect.height + rect.top;

            // Check if within selection box (in client coordinates)
            if (screenX >= left && screenX <= right &&
                screenY >= top && screenY <= bottom) {
                const collection = unitType?.collection || renderable?.collection;
                if(collection == 'units'){
                    selectedUnits.push(entityId);
                } else {
                    selectedBuildings.push(entityId);
                }
            }
        });

        return selectedUnits.length > 0 ? selectedUnits : selectedBuildings;
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
        const placement = this.game.getComponent(entityId, "placement");
        return placement?.placementId || null;
    }
    updateMultipleSquadSelection() {        
        this.currentSelectedIndex = 0;
        const unitId = Array.from(this.selectedUnitIds)[this.currentSelectedIndex];
    
        this.setSelectedEntity(unitId);         
        this.highlightUnits(Array.from(this.selectedUnitIds)); 
        this.game.triggerEvent("onMultipleUnitsSelected", this.selectedUnitIds);
        if(this.selectedUnitIds.size > 0){
            let unitId = Array.from(this.selectedUnitIds)[this.currentSelectedIndex];
            this.game.triggerEvent("onUnitSelected", unitId);
        }
    }
    
    
    cancelBoxSelection() {
        this.boxSelection.active = false;
        if (this.boxSelection.element) {
            this.boxSelection.element.style.display = 'none';
        }
    }

    checkUnitSelectionClick(event) {
        const worldPos = this.game.call('getWorldPositionFromMouse');

        if (!worldPos) return;

        // Use direct entity selection based on team component (works for both editor and game mode)
        const entityId = this.getEntityAtWorldPosition(worldPos);

        if (entityId) {
            if (event.shiftKey) {
                if (this.selectedUnitIds.has(entityId)) {
                    this.selectedUnitIds.delete(entityId);
                } else {
                    this.selectedUnitIds.add(entityId);
                }
                this.updateMultipleSquadSelection();
            } else {
                this.deselectAll();
                this.selectedUnitIds.add(entityId);
                this.selectEntityDirectly(entityId);
            }
        } else {
            if (!event.shiftKey) {
                this.deselectAll();
            }
        }
    }

    /**
     * Get entity at world position
     * In game mode, only returns entities on player's team
     * In editor mode, returns any selectable entity
     */
    getEntityAtWorldPosition(worldPos) {
        const clickRadius = 50;
        let closestEntityId = null;
        let closestDistance = clickRadius;

        const entities = this.game.getEntitiesWith("transform");

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const unitType = this.game.getComponent(entityId, "unitType");
            const renderable = this.game.getComponent(entityId, "renderable");

            // Must have position and be renderable
            if (!pos) return;
            if (!unitType && !renderable) return;

            // Skip world objects (environment objects from level data)
            if (unitType?.collection === 'worldObjects') return;

            // In game mode, only select units on player's team
            if (!this.isEditorMode) {
                const team = this.game.getComponent(entityId, "team");
                if (!team) return;

                const unitTeam = team.team || team.side || team.teamId;
                const myTeam = this.game.state.mySide || this.game.state.playerSide || this.game.state.team;

                if (unitTeam !== myTeam) return;
            }

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            let distance = Math.sqrt(dx * dx + dz * dz);

            // Adjust distance based on unit/building size
            const size = unitType?.size || 20;
            distance -= size;

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntityId = entityId;
            }
        });

        return closestEntityId;
    }

    /**
     * Select entity directly (for editor mode - no placement/squad)
     */
    selectEntityDirectly(entityId) {
        if (!entityId) return;

        this.setSelectedEntity(entityId);
        this.highlightUnits([entityId]);
        this.game.triggerEvent("onUnitSelected", entityId);
    }
    
    deselectAll() {
        this.clearAllHighlights();
        this.selectedUnitIds.clear();

        if (this.game.state.selectedEntity) {
            this.game.state.selectedEntity.entityId = null;
            this.game.state.selectedEntity.collection = null;
        }

        // Skip game UI updates in editor mode
        if (!this.isEditorMode) {
            const actionPanel = document.getElementById('actionPanel');
            if(actionPanel) {
                actionPanel.innerHTML = "";
            }

            const selectedUnits = document.getElementById('selectedUnits');
            if(selectedUnits) {
                selectedUnits.innerHTML = "";
            }

            const unitPortrait = document.getElementById('unitPortrait');
            if(unitPortrait){
                unitPortrait.innerHTML = "";
                unitPortrait.classList.remove('following');
            }

            // Stop camera following
            this.game.call('toggleCameraFollow', null);
        }

        this.game.triggerEvent('onDeSelectAll');
    }

    getPlacementAtWorldPosition(worldPos) {
        const clickRadius = 50; // Increased for better building selection
        let closestPlacementId = null;
        let closestEntityId = null;
        let closestDistance = clickRadius;

        const entities = this.game.getEntitiesWith(
            "transform",
            "placement"
        );

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const placement = this.game.getComponent(entityId, "placement");
            const unitType = this.game.getComponent(entityId, "unitType");

            if (!pos || !placement) return;

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            let distance = Math.sqrt(dx * dx + dz * dz);

            // Adjust distance based on unit/building size
            if(unitType && unitType.size) {
                distance -= unitType.size;
            }

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntityId = entityId;
                // Use placementId if available, otherwise construct from entity's placement
                closestPlacementId = placement.placementId;
            }
        });

        // If we found an entity but no placementId, try to find it from playerPlacements
        if (closestEntityId && !closestPlacementId) {
            const placements = this.game.call('getPlacementsForSide', this.game.state.mySide);
            if (placements) {
                for (const placement of placements) {
                    if (placement.squadUnits && placement.squadUnits.includes(closestEntityId)) {
                        closestPlacementId = placement.placementId;
                        break;
                    }
                }
            }
        }

        return closestPlacementId;
    }

    selectUnit(entityId, placementId) {
        if (!entityId) return;
        
        const squadData = this.game.call('getSquadInfo', placementId);
        
        if (squadData) {
            const placement = this.game.call('getPlacementById', placementId);
            squadData.unitIds = placement.squadUnits;
            this.setSelectedEntity(entityId);
            this.highlightUnits(placement.squadUnits);              
            this.game.triggerEvent("onUnitSelected", entityId)
        }
    }

    setSelectedEntity(entityId){
        const unitType = this.game.getComponent(entityId, "unitType");
        const renderable = this.game.getComponent(entityId, "renderable");

        if (this.game.state.selectedEntity) {
            this.game.state.selectedEntity.entityId = entityId;
            this.game.state.selectedEntity.collection = unitType?.collection || renderable?.collection || null;
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

        // Skip game UI updates in editor mode
        if (!this.isEditorMode && document) {
            const container = document.getElementById('unitPortrait');
            if (container) {
                container.innerHTML = ``;
                const portrait = this.createPortrait(unitIds[this.currentSelectedIndex]);
                if(portrait){
                    container.append(portrait);
                }
                // Update follow indicator
                const followTarget = this.game.call('getCameraFollowTarget');
                if (followTarget === unitIds[this.currentSelectedIndex]) {
                    container.classList.add('following');
                } else {
                    container.classList.remove('following');
                }
            }
            const selectedUnitsContainer = document.getElementById('selectedUnits');
            if (selectedUnitsContainer) {
                selectedUnitsContainer.innerHTML = ``;

                unitIds.forEach((unitId, index) => {
                    const selectedPortrait = this.createPortrait(unitId);
                    if(selectedPortrait){
                        const selectedUnitIconContainer = document.createElement('div');
                        if(index == this.currentSelectedIndex){
                            selectedUnitIconContainer.classList.add('selected');
                        }
                        selectedUnitIconContainer.append(selectedPortrait);
                        selectedUnitsContainer.append(selectedUnitIconContainer);
                        selectedUnitIconContainer.addEventListener('click', () => {
                            this.deselectAll();
                            this.selectedUnitIds.add(unitId);
                            this.selectEntityDirectly(unitId);
                        });
                    }
                });
            }
        }
        // Update tracked set
        this.highlightedUnits = newHighlightSet;

    }

    createPortrait(entityId){
        if(document) {
            const unitType = this.game.getComponent(entityId, "unitType");
            const icon = this.game.getCollections().icons[unitType.icon];

            if(icon){
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                return img;
            }
        }
        return null;
    }
    
    clearAllHighlights() {
        // Remove all selection circles
        for (const entityId of this.highlightedUnits) {
            this.removeSelectionCircle(entityId);
        }
        
        this.currentSelectedIndex = 0;
        this.highlightedUnits.clear();
    }
    
    createSelectionCircle(entityId) {
        // Don't create if already exists
        if (this.selectionCircles.has(entityId)) return;

        // Get entity position to determine size
        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
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
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
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
        const unitType = this.game.getComponent(entityId, "unitType");
        
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
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
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
    
    // Get all currently selected squad/placement IDs (if they have placement component)
    getSelectedSquads() {
        let placementIds = new Set();
        Array.from(this.selectedUnitIds).forEach((unitId) => {
            const placement = this.game.getComponent(unitId, "placement");
            if (placement?.placementId) {
                placementIds.add(placement.placementId);
            }
        });
        return [...placementIds];
    }
    getSelectedUnits() {
        return Array.from(this.selectedUnitIds);
    }

    
    onBattleStart() {
        // Do not deselect units on phase transition
        // Keep the user's selection intact between placement and battle phases
    }
    onKeyDown(key) {
        if (key === 'Escape') {
            this.deselectAll();
        }
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

    onSceneUnload() {
        this.destroy();

        // Reset box selection state
        this.boxSelection.active = false;
        this.boxSelection.startX = 0;
        this.boxSelection.startY = 0;
        this.boxSelection.currentX = 0;
        this.boxSelection.currentY = 0;
        this.boxSelection.element = null;

        this.currentSelectedIndex = 0;

        console.log('[SelectedUnitSystem] Scene unloaded - resources cleaned up');
    }
}