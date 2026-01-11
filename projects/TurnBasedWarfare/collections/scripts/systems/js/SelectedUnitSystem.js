class SelectedUnitSystem extends GUTS.BaseSystem {
    static services = [
        'getSelectedSquads',
        'deselectAllUnits',
        'selectEntity',
        'selectMultipleEntities',
        'configureSelectionSystem'
    ];

    constructor(game) {
        super(game);
        this.game.selectedUnitSystem = this;
        this.canvas = this.game.canvas;

        // Selection configuration - can be overridden via configure()
        // Defaults are for game mode; terrain editor will override
        this.config = {
            enableTeamFilter: true,                     // Only select player's team
            excludeCollections: ['worldObjects'],       // Collections to exclude
            includeCollections: null,                   // null = allow all (minus excludes)
            showSelectionIndicators: true,
            prioritizeUnitsOverBuildings: true,         // In box selection, return only units if any found
            showGameUI: true,                           // Show game-specific UI (portrait, action panel)
            camera: null                                // Optional camera override (uses game.camera if null)
        };

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
    }

    /**
     * Configure the selection system behavior
     * Call this after the system is instantiated to override defaults
     * @param {Object} options - Configuration options
     */
    configure(options = {}) {
        this.config = { ...this.config, ...options };
        if (options.circleColor !== undefined) {
            this.CIRCLE_COLOR = options.circleColor;
        }
    }

    /**
     * Determine the collection for an entity by checking marker components
     * @param {number} entityId - The entity ID
     * @returns {string|null} The collection name or null
     */
    getEntityCollection(entityId) {
        // Check marker components first (most reliable)
        const hasWorldObject = this.game.getComponent(entityId, 'worldObject');
        if (hasWorldObject !== undefined && hasWorldObject !== null) {
            return 'worldObjects';
        }

        const hasBuilding = this.game.getComponent(entityId, 'building');
        if (hasBuilding !== undefined && hasBuilding !== null) {
            return 'buildings';
        }

        const hasUnit = this.game.getComponent(entityId, 'unit');
        if (hasUnit !== undefined && hasUnit !== null) {
            return 'units';
        }

        // Fallback: check unitType component
        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        if (unitType?.collection) {
            return unitType.collection;
        }

        return null;
    }

    /**
     * Check if an entity's collection is selectable based on config
     * @param {string|null} collection - The collection name (null if entity has no marker component)
     * @returns {boolean} True if selectable
     */
    isEntitySelectableByCollection(collection) {
        // If collection is null (entity has no marker), allow it only if no filters are set
        if (collection === null) {
            const hasExcludes = this.config.excludeCollections?.length > 0;
            const hasIncludes = this.config.includeCollections?.length > 0;
            // If no filters are configured, allow entities without markers
            return !hasExcludes && !hasIncludes;
        }

        // Exclude takes precedence
        if (this.config.excludeCollections?.includes(collection)) {
            return false;
        }

        // If include list specified, only those collections are allowed
        if (this.config.includeCollections && this.config.includeCollections.length > 0) {
            return this.config.includeCollections.includes(collection);
        }

        return true;
    }

    // Alias for service name
    deselectAllUnits() {
        return this.deselectAll();
    }

    /**
     * Service method to select a single entity
     * Clears existing selection and selects the specified entity
     */
    selectEntity(entityId) {
        this.deselectAll();
        if (entityId) {
            this.selectedUnitIds.add(entityId);
            this.selectEntityDirectly(entityId);
        }
    }

    /**
     * Service method to select multiple entities
     * Clears existing selection and selects all specified entities
     * @param {Array|Set} entityIds - Array or Set of entity IDs to select
     */
    selectMultipleEntities(entityIds) {
        this.deselectAll();

        const ids = Array.isArray(entityIds) ? entityIds : Array.from(entityIds);
        if (!ids || ids.length === 0) return;

        // Add all entities to selection
        for (const entityId of ids) {
            this.selectedUnitIds.add(entityId);
        }

        // Set the first entity as the "current" selected entity
        this.currentSelectedIndex = 0;
        const primaryId = ids[0];
        this.setSelectedEntity(primaryId);

        // Create selection circles for all selected entities
        this.highlightUnits(ids);

        // Single event pipeline - always use onMultipleUnitsSelected for all selection cases
        this.game.triggerEvent("onMultipleUnitsSelected", this.selectedUnitIds);
    }

    /**
     * Service method to configure selection system behavior
     * Alias for configure() to expose as a service
     */
    configureSelectionSystem(options) {
        return this.configure(options);
    }

    initialize() {
        if (this.initialized || !this.game.scene) return;

        // Update canvas reference (may not have been available in constructor)
        this.canvas = this.game.canvas;
        if (!this.canvas) {
            console.warn('[SelectedUnitSystem] Canvas not available, deferring initialization');
            return;
        }

        this.initialized = true;
        this.setupBoxSelectionListeners();
        this.createBoxSelectionElement();

        // Skip game-specific UI setup when showGameUI is disabled
        if (!this.config.showGameUI) return;

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
        if (!this.config.showGameUI) return;
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
        // Store handlers for cleanup
        this._mousedownHandler = (event) => {
            // Only left click, and not clicking on UI elements
            if (event.button !== 0) return;

            this.boxSelection.startX = event.clientX;
            this.boxSelection.startY = event.clientY;
            this.boxSelection.currentX = event.clientX;
            this.boxSelection.currentY = event.clientY;
            this.boxSelection.active = true;

            // Don't show box immediately - wait for drag
        };
        this.canvas.addEventListener('mousedown', this._mousedownHandler);

        // Mouse move - update box selection
        this._mousemoveHandler = (event) => {
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
        };
        this.canvas.addEventListener('mousemove', this._mousemoveHandler);

        // Mouse up - complete box selection
        this._mouseupHandler = (event) => {
            if (!this.boxSelection.active) return;

            const dx = this.boxSelection.currentX - this.boxSelection.startX;
            const dy = this.boxSelection.currentY - this.boxSelection.startY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // If dragged significantly, do box selection
            // Single clicks are handled by InputSystem -> GameInterfaceSystem -> onInputResult
            if (distance > 5) {
                requestAnimationFrame(() => {
                    this.completeBoxSelection(event);
                });
            }
            // Single clicks (distance <= 5) are handled by InputSystem forwarding to GameInterfaceSystem

            // Reset box selection state
            this.boxSelection.active = false;
            if (this.boxSelection.element) {
                this.boxSelection.element.style.display = 'none';
            }
        };
        this.canvas.addEventListener('mouseup', this._mouseupHandler);

        // Prevent browser context menu on canvas, cancel box selection if active
        this._contextmenuHandler = (event) => {
            event.preventDefault();
            if (this.boxSelection.active) {
                this.cancelBoxSelection();
            }
        };
        this.canvas.addEventListener('contextmenu', this._contextmenuHandler);

        this._keydownHandler = (event) => {
            if (event.key === 'Escape' && this.boxSelection.active) {
                this.cancelBoxSelection();
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    cleanupBoxSelectionListeners() {
        if (this.canvas) {
            if (this._mousedownHandler) {
                this.canvas.removeEventListener('mousedown', this._mousedownHandler);
            }
            if (this._mousemoveHandler) {
                this.canvas.removeEventListener('mousemove', this._mousemoveHandler);
            }
            if (this._mouseupHandler) {
                this.canvas.removeEventListener('mouseup', this._mouseupHandler);
            }
            if (this._contextmenuHandler) {
                this.canvas.removeEventListener('contextmenu', this._contextmenuHandler);
            }
        }
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        this._mousedownHandler = null;
        this._mousemoveHandler = null;
        this._mouseupHandler = null;
        this._contextmenuHandler = null;
        this._keydownHandler = null;
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

        // Find all units within the selection box (screen-based)
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

    /**
     * Apply selection to entity IDs (internal helper)
     */
    _applySelection(entityIds, isAdditive) {
        if (!isAdditive) {
            this.selectedUnitIds.clear();
        }
        entityIds.forEach((unitId) => {
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
            // Apply team filter if enabled
            if (this.config.enableTeamFilter) {
                const team = this.game.getComponent(entityId, "team");
                if (!team) return;

                const unitTeam = team.team || team.side || team.teamId;
                const myTeam = this.game.call('getActivePlayerTeam');

                if (unitTeam !== myTeam) return;
            }

            // Get position component
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const renderable = this.game.getComponent(entityId, "renderable");

            // Must have position and be renderable
            if (!pos) return;
            if (!renderable) return;

            // Use consistent collection detection via marker components
            const collection = this.getEntityCollection(entityId);

            // Apply collection filter
            if (!this.isEntitySelectableByCollection(collection)) {
                return;
            }

            // Convert world position to screen position
            const screenPos = this.worldToScreen(pos.x, pos.y, pos.z);
            if (!screenPos) return;

            // Convert normalized screen coords (0-1) to client coordinates
            const screenX = screenPos.x * rect.width + rect.left;
            const screenY = screenPos.y * rect.height + rect.top;

            // Check if within selection box (in client coordinates)
            if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
                // When prioritizeUnitsOverBuildings is false, all entities go to selectedUnits
                // When true (default), separate units from buildings to prioritize units
                if (!this.config.prioritizeUnitsOverBuildings) {
                    selectedUnits.push(entityId);
                } else if (collection == 'units') {
                    selectedUnits.push(entityId);
                } else {
                    selectedBuildings.push(entityId);
                }
            }
        });

        // When prioritizing, return units if any, otherwise buildings
        // When not prioritizing, all entities are in selectedUnits
        return selectedUnits.length > 0 ? selectedUnits : selectedBuildings;
    }
    /**
     * Get the camera to use for projections
     * Uses config.camera if provided, falls back to game.camera
     */
    getCamera() {
        return this.config.camera || this.game.camera;
    }

    worldToScreen(x, y, z) {
        const camera = this.getCamera();
        if (!camera || !this.game.canvas) return null;

        try {
            // Ensure camera matrices are up to date before projection
            // This is critical for perspective cameras where the matrices may not be auto-updated
            camera.updateMatrixWorld();
            camera.updateProjectionMatrix();

            // Create a 3D vector
            const vector = new THREE.Vector3(x, y, z);

            // Project to screen space
            vector.project(camera);

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
        // Single event pipeline - always use onMultipleUnitsSelected for all selection cases
        this.game.triggerEvent("onMultipleUnitsSelected", this.selectedUnitIds);
    }
    
    
    cancelBoxSelection() {
        this.boxSelection.active = false;
        if (this.boxSelection.element) {
            this.boxSelection.element.style.display = 'none';
        }
    }

    /**
     * Handle input results from GameInterfaceSystem
     * Called via game event 'onInputResult'
     */
    onInputResult(result) {
        if (!result) return;

        if (result.action === 'select_entity') {
            const { entityId, additive } = result.data;

            if (additive) {
                // Toggle selection
                if (this.selectedUnitIds.has(entityId)) {
                    this.selectedUnitIds.delete(entityId);
                } else {
                    this.selectedUnitIds.add(entityId);
                }
                this.updateMultipleSquadSelection();
            } else {
                // Replace selection
                this.deselectAll();
                this.selectedUnitIds.add(entityId);
                this.selectEntityDirectly(entityId);
            }
        } else if (result.action === 'select_multiple') {
            const { entityIds, additive } = result.data;

            if (!additive) {
                this.selectedUnitIds.clear();
            }

            for (const entityId of entityIds) {
                this.selectedUnitIds.add(entityId);
            }

            this.currentSelectedIndex = 0;
            if (this.selectedUnitIds.size > 0) {
                this.updateMultipleSquadSelection();
            } else {
                this.deselectAll();
            }
        } else if (result.action === 'deselect') {
            this.deselectAll();
        }
    }

    /**
     * Get entity at world position
     * Respects config.enableTeamFilter and config.excludeCollections/includeCollections
     */
    getEntityAtWorldPosition(worldPos) {
        const clickRadius = 50;
        let closestEntityId = null;
        let closestDistance = clickRadius;

        const entities = this.game.getEntitiesWith("transform");

        entities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const renderable = this.game.getComponent(entityId, "renderable");

            // Must have position and be renderable
            if (!pos) return;
            if (!renderable) return;

            // Get collection using marker components (may be null if entity has no marker)
            const collection = this.getEntityCollection(entityId);
            if (!this.isEntitySelectableByCollection(collection)) return;

            // Apply team filter if enabled
            if (this.config.enableTeamFilter) {
                const team = this.game.getComponent(entityId, "team");
                if (!team) return;

                const unitTeam = team.team || team.side || team.teamId;
                const myTeam = this.game.call('getActivePlayerTeam');

                if (unitTeam !== myTeam) return;
            }

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            let distance = Math.sqrt(dx * dx + dz * dz);

            // Adjust distance based on unit/building size
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
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
        // Single event pipeline - always use onMultipleUnitsSelected for all selection cases
        this.game.triggerEvent("onMultipleUnitsSelected", this.selectedUnitIds);
    }
    
    deselectAll() {
        this.clearAllHighlights();
        this.selectedUnitIds.clear();

        if (this.game.state.selectedEntity) {
            this.game.state.selectedEntity.entityId = null;
            this.game.state.selectedEntity.collection = null;
        }

        // Update game UI when enabled
        if (this.config.showGameUI) {
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
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!pos || !placement) return;

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            let distance = Math.sqrt(dx * dx + dz * dz);

            // Adjust distance based on unit/building size
            if (unitType && unitType.size) {
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
            const placements = this.game.call('getPlacementsForSide', this.game.call('getActivePlayerTeam'));
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

            // Populate selectedUnitIds with the squad units
            this.selectedUnitIds.clear();
            if (placement.squadUnits) {
                for (const unitId of placement.squadUnits) {
                    this.selectedUnitIds.add(unitId);
                }
            } else {
                this.selectedUnitIds.add(entityId);
            }

            this.setSelectedEntity(entityId);
            this.highlightUnits(placement.squadUnits);
            // Single event pipeline - always use onMultipleUnitsSelected for all selection cases
            this.game.triggerEvent("onMultipleUnitsSelected", this.selectedUnitIds);
        }
    }

    setSelectedEntity(entityId){
        if (this.game.state.selectedEntity) {
            this.game.state.selectedEntity.entityId = entityId;
            this.game.state.selectedEntity.collection = this.getEntityCollection(entityId);
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

        // Wait for scene before creating visual elements
        if (!this.game.scene) {
            console.warn('[SelectedUnitSystem] highlightUnits called before scene ready, deferring...');
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

        // Update game UI when enabled
        if (this.config.showGameUI && document) {
            const container = document.getElementById('unitPortrait');
            if (container) {
                container.innerHTML = ``;
                const selectedEntityId = unitIds[this.currentSelectedIndex];
                const portrait = this.createPortrait(selectedEntityId);
                if(portrait){
                    container.append(portrait);
                }
                // Add stats overlay
                const statsOverlay = this.createUnitStatsOverlay(selectedEntityId);
                if (statsOverlay) {
                    container.append(statsOverlay);
                }
                // Update follow indicator
                const followTarget = this.game.call('getCameraFollowTarget');
                if (followTarget === selectedEntityId) {
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
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const icon = unitType ? this.collections.icons[unitType.icon] : null;

            if (icon) {
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                return img;
            }
        }
        return null;
    }

    createUnitStatsOverlay(entityId) {
        const container = document.createElement('div');
        container.className = 'unit-stats-overlay';

        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        const health = this.game.getComponent(entityId, "health");
        const placement = this.game.getComponent(entityId, "placement");

        // Get experience/level data
        let squadData = null;
        if (placement?.placementId && this.game.squadExperienceSystem) {
            squadData = this.game.squadExperienceSystem.getSquadExperience(placement.placementId);
        }

        // Unit name
        const nameEl = document.createElement('div');
        nameEl.className = 'unit-stats-name';
        nameEl.textContent = unitType?.title || 'Unknown';
        container.appendChild(nameEl);

        // Level and experience
        if (squadData) {
            const levelEl = document.createElement('div');
            levelEl.className = 'unit-stats-level';
            levelEl.textContent = `Lv ${squadData.level}`;
            container.appendChild(levelEl);

            const expEl = document.createElement('div');
            expEl.className = 'unit-stats-exp';
            const expPercent = Math.min(100, (squadData.experience / squadData.experienceToNextLevel) * 100);
            expEl.innerHTML = `<div class="exp-bar"><div class="exp-fill" style="width: ${expPercent}%"></div></div>`;
            expEl.title = `${squadData.experience}/${squadData.experienceToNextLevel} XP`;
            container.appendChild(expEl);
        }

        // Stats row
        const statsRow = document.createElement('div');
        statsRow.className = 'unit-stats-row';

        // Health
        if (health) {
            const healthEl = document.createElement('span');
            healthEl.className = 'unit-stat';
            healthEl.innerHTML = `<span class="stat-icon">❤️</span>${Math.ceil(health.current)}`;
            statsRow.appendChild(healthEl);
        }

        // Damage
        if (unitType?.damage) {
            const dmgEl = document.createElement('span');
            dmgEl.className = 'unit-stat';
            dmgEl.innerHTML = `<span class="stat-icon">⚔️</span>${unitType.damage}`;
            statsRow.appendChild(dmgEl);
        }

        // Value (gold cost)
        if (unitType?.value) {
            const valueEl = document.createElement('span');
            valueEl.className = 'unit-stat';
            valueEl.innerHTML = `<span class="stat-icon">💰</span>${unitType.value}`;
            statsRow.appendChild(valueEl);
        }

        container.appendChild(statsRow);

        return container;
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

        // Need scene to add circles
        if (!this.game.scene) {
            console.warn('[SelectedUnitSystem] Cannot create selection circle - scene not available');
            return;
        }

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
        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitData = this.game.call('getUnitTypeDef', unitTypeComp);

        if (unitData && unitData.size) {
            return unitData.size + 2; // Slightly larger than unit
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
        // Clean up box selection listeners
        this.cleanupBoxSelectionListeners();

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
        this.canvas = null;
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

    }
}
