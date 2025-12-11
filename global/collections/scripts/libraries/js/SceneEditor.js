/**
 * SceneEditor - Unity-like scene editor for GUTS
 * Delegates all rendering to EditorECSGame which uses actual game systems
 * Entities with components drive everything - no hardcoded rendering
 */
class SceneEditor {
    constructor(gameEditor, config, libs = {}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.collections = this.gameEditor.getCollections();

        // DOM elements
        this.canvas = document.getElementById('scene-editor-canvas');

        // State
        this.state = {
            entities: [],         // Entities array (what gets saved)
            sceneData: null,      // Full scene object with title, systems, etc.
            selectedEntityId: null,
            isDirty: false,
            initialized: false,
            cameraMode: 'scene'   // 'scene' (perspective) or 'game' (orthographic)
        };

        // Camera configurations storage
        this.sceneCameraState = null;  // Store perspective camera state
        this.gameCameraState = null;   // Store orthographic camera state

        // UI Elements
        this.elements = {
            hierarchy: document.getElementById('scene-hierarchy'),
            inspector: document.getElementById('scene-inspector'),
            noSelection: document.getElementById('scene-noSelection'),
            entityInspector: document.getElementById('scene-entityInspector'),
            components: document.getElementById('scene-components'),
            collectionSelect: document.getElementById('scene-collectionSelect'),
            spawnTypeList: document.getElementById('scene-spawnTypeList'),
            removePrefabBtn: document.getElementById('scene-removePrefabBtn'),
        };

        // Get collections that are in the "prefabs" objectTypeCategory
        this.prefabCollections = this.getPrefabCollections();

        // Placement mode state
        this.placementMode = {
            active: false,
            collection: null,
            spawnType: null,
            itemData: null
        };

        // Gizmo helper object - represents selected entity position for gizmo attachment
        this.gizmoHelper = null;

        // Mouse tracking for placement
        this.mouseNDC = { x: 0, y: 0 };
        this.mouseOverCanvas = false;
        this.raycastHelper = null;
        this.placementPreview = null;

        // Editor game instance - handles all rendering via game systems
        this.editorGameInstance = null;

        // Gizmo manager - use GUTS global or passed lib
        const GizmoManager = libs.SE_GizmoManager || GUTS.SE_GizmoManager;
        this.gizmoManager = GizmoManager ? new GizmoManager() : null;

        // Initialize
        this.initEventListeners();
        this.populateCollectionSelect();
    }

    /**
     * Get all collections that have objectTypeCategory: "prefabs"
     */
    getPrefabCollections() {
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};
        const prefabCollections = [];

        for (const [typeId, typeDef] of Object.entries(objectTypeDefinitions)) {
            if (typeDef.objectTypeCategory === 'prefabs') {
                prefabCollections.push({
                    id: typeId,
                    name: typeDef.name || typeId,
                    singular: typeDef.singular || typeId
                });
            }
        }

        return prefabCollections;
    }

    /**
     * Get camera height from main camera settings in collections
     * Falls back to 512 if not found
     */
    getCameraHeight() {
        if (this._cameraHeight !== undefined) {
            return this._cameraHeight;
        }

        const cameraSettings = this.collections?.cameras?.main;

        this._cameraHeight = cameraSettings?.position?.y || 512;

        return this._cameraHeight;
    }

    /**
     * Initialize the editor context with game systems
     * @param {Array<string>} systems - Systems to initialize (from scene data)
     */
    async initializeContext(systems) {
        if (this.state.initialized) return;

        // Create editor context (like ECSGame)
        this.editorGameInstance = new GUTS.EditorECSGame(this.gameEditor, this.canvas);

        // Use EditorLoader to load assets and initialize (like GameLoader)
        this.editorLoader = new GUTS.EditorLoader(this.editorGameInstance);
        await this.editorLoader.load({
            systems: systems
        });

        // Note: gizmoManager is initialized in handleRenderSceneObject after worldRenderer exists

        // Start render loop
        this.editorGameInstance.startRenderLoop();

        this.state.initialized = true;
        console.log('[SceneEditor] Context initialized with systems:', systems);
    }

    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Handle scene data load from editor
        document.body.addEventListener('renderSceneObject', this.handleRenderSceneObject.bind(this));

        // Handle scene data unload when switching away from this editor
        document.body.addEventListener('unloadSceneObject', this.handleUnloadSceneObject.bind(this));

        // Handle editor resize
        document.body.addEventListener('resizedEditor', () => {
            this.handleResize();
        });

        // Collection select change - update spawn type list
        this.elements.collectionSelect?.addEventListener('change', () => {
            this.populateSpawnTypeList();
            this.cancelPlacementMode();
        });

        // Remove entity button
        this.elements.removePrefabBtn?.addEventListener('click', () => {
            this.removeSelectedEntity();
        });

        // Gizmo mode buttons
        document.getElementById('scene-translate-tool')?.addEventListener('click', () => {
            this.setGizmoMode('translate');
            this.updateGizmoToolbarUI('scene-translate-tool');
        });

        document.getElementById('scene-rotate-tool')?.addEventListener('click', () => {
            this.setGizmoMode('rotate');
            this.updateGizmoToolbarUI('scene-rotate-tool');
        });

        document.getElementById('scene-scale-tool')?.addEventListener('click', () => {
            this.setGizmoMode('scale');
            this.updateGizmoToolbarUI('scene-scale-tool');
        });

        // Camera toggle button
        document.getElementById('scene-camera-toggle')?.addEventListener('click', () => {
            this.toggleCamera();
        });

        // Camera rotation buttons (only visible in game camera mode)
        document.getElementById('scene-camera-rotate-left')?.addEventListener('click', () => {
            this.rotateGameCamera('left');
        });
        document.getElementById('scene-camera-rotate-right')?.addEventListener('click', () => {
            this.rotateGameCamera('right');
        });

        // Window resize
        window.addEventListener('resize', this.handleResize.bind(this));

        // Canvas mouse events for placement
        this.canvas?.addEventListener('mouseenter', () => {
            this.mouseOverCanvas = true;
        });

        this.canvas?.addEventListener('mouseleave', () => {
            this.mouseOverCanvas = false;
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
        });

        this.canvas?.addEventListener('mousemove', (e) => {
            this.updateMouseNDC(e);
            this.updateMouseWorldPos();
            this.updatePlacementPreview();
        });

        this.canvas?.addEventListener('click', (e) => {
            if (this.placementMode.active) {
                this.placeEntityAtMouse();
            }
        });

        // Disable context menu on canvas, and cancel placement mode if active
        this.canvas?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.placementMode.active) {
                this.cancelPlacementMode();
            }
        });

        // Escape key to cancel placement
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.placementMode.active) {
                this.cancelPlacementMode();
            }
        });
    }

    /**
     * Populate the collection select dropdown with prefab collections
     */
    populateCollectionSelect() {
        if (!this.elements.collectionSelect) return;

        this.elements.collectionSelect.innerHTML = '';

        for (const collection of this.prefabCollections) {
            const option = document.createElement('option');
            option.value = collection.id;
            option.textContent = collection.name;
            this.elements.collectionSelect.appendChild(option);
        }

        // Populate spawn types for the first collection
        this.populateSpawnTypeList();
    }

    /**
     * Populate the spawn type list based on selected collection
     */
    populateSpawnTypeList() {
        if (!this.elements.spawnTypeList) return;

        this.elements.spawnTypeList.innerHTML = '';

        const collectionId = this.elements.collectionSelect?.value;
        if (!collectionId) return;

        const collectionData = this.collections[collectionId] || {};
        const icons = this.collections.icons || {};

        for (const [itemId, itemData] of Object.entries(collectionData)) {
            const item = document.createElement('div');
            item.className = 'editor-module__grid-item';
            item.dataset.collection = collectionId;
            item.dataset.spawnType = itemId;
            item.title = itemData.title || itemId;

            // Try to get the icon for this item
            const iconId = itemData.icon;
            const iconData = iconId ? icons[iconId] : null;

            if (iconData && iconData.imagePath) {
                const img = document.createElement('img');
                img.src = `./projects/TurnBasedWarfare/resources/${iconData.imagePath}`;
                img.alt = itemData.title || itemId;
                item.appendChild(img);
            } else {
                // Fallback to text if no icon
                const label = document.createElement('span');
                label.className = 'editor-module__grid-item-label';
                label.textContent = (itemData.title || itemId).substring(0, 3);
                item.appendChild(label);
            }

            item.addEventListener('click', () => {
                this.activatePlacementMode(collectionId, itemId, itemData);
                // Update selection UI
                this.elements.spawnTypeList.querySelectorAll('.editor-module__grid-item').forEach(el => {
                    el.classList.remove('editor-module__grid-item--selected');
                });
                item.classList.add('editor-module__grid-item--selected');
            });
            this.elements.spawnTypeList.appendChild(item);
        }
    }

    /**
     * Activate placement mode for a specific entity type
     */
    activatePlacementMode(collection, spawnType, itemData) {
        this.placementMode = {
            active: true,
            collection: collection,
            spawnType: spawnType,
            itemData: itemData
        };
        console.log(`[SceneEditor] Placement mode activated: ${collection}/${spawnType}`);
    }

    /**
     * Cancel placement mode
     */
    cancelPlacementMode() {
        this.placementMode = {
            active: false,
            collection: null,
            spawnType: null,
            itemData: null
        };

        // Clear selection UI
        this.elements.spawnTypeList?.querySelectorAll('.editor-module__list-item').forEach(el => {
            el.classList.remove('editor-module__list-item--selected');
        });

        // Hide preview
        if (this.placementPreview) {
            this.placementPreview.hide();
        }

        console.log('[SceneEditor] Placement mode cancelled');
    }

    /**
     * Update mouse normalized device coordinates
     */
    updateMouseNDC(event) {
        if (!this.canvas) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    /**
     * Update mouse world position for SelectedUnitSystem
     */
    updateMouseWorldPos() {
        if (!this.raycastHelper || !this.worldRenderer) {
            this.mouseWorldPos = null;
            return;
        }

        const groundMesh = this.worldRenderer.getGroundMesh();
        if (groundMesh) {
            this.mouseWorldPos = this.raycastHelper.rayCastGround(
                this.mouseNDC.x,
                this.mouseNDC.y,
                groundMesh
            );
        } else {
            // Fallback to flat plane at y=0
            this.mouseWorldPos = this.raycastHelper.rayCastFlatPlane(
                this.mouseNDC.x,
                this.mouseNDC.y,
                0
            );
        }
    }

    /**
     * Update placement preview based on mouse position
     */
    updatePlacementPreview() {
        if (!this.placementMode.active || !this.mouseOverCanvas) {
            return;
        }

        if (!this.raycastHelper || !this.worldRenderer) {
            return;
        }

        // Raycast to get world position
        const groundMesh = this.worldRenderer.getGroundMesh();
        if (!groundMesh) return;

        const worldPos = this.raycastHelper.rayCastGround(
            this.mouseNDC.x,
            this.mouseNDC.y,
            groundMesh
        );

        if (!worldPos) {
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
            return;
        }

        // Show placement preview at position
        if (this.placementPreview) {
            const isBuilding = this.placementMode.collection === 'buildings';
            this.placementPreview.showAtWorldPositions([worldPos], true, isBuilding);
        }
    }

    /**
     * Place entity at current mouse position
     */
    placeEntityAtMouse() {
        if (!this.placementMode.active) return;

        if (!this.raycastHelper || !this.worldRenderer) {
            console.error('[SceneEditor] RaycastHelper or WorldRenderer not available');
            return;
        }

        // Raycast to get world position
        const groundMesh = this.worldRenderer.getGroundMesh();
        if (!groundMesh) return;

        const worldPos = this.raycastHelper.rayCastGround(
            this.mouseNDC.x,
            this.mouseNDC.y,
            groundMesh
        );

        if (!worldPos) return;

        // Get terrain height at position
        const terrainSystem = this.editorGameInstance?.terrainSystem;
        const terrainHeight = terrainSystem?.getTerrainHeightAtPosition?.(worldPos.x, worldPos.z) || worldPos.y;

        // Create entity using UnitCreationSystem
        this.createEntityAtPosition(worldPos.x, terrainHeight, worldPos.z);
    }

    /**
     * Create entity at specific position
     */
    createEntityAtPosition(x, y, z) {
        if (!this.editorGameInstance) return;

        const { collection, spawnType, itemData } = this.placementMode;
        if (!collection || !spawnType) return;

        // Use UnitCreationSystem to create the entity with proper components
        const unitCreationSystem = this.editorGameInstance.unitCreationSystem;
        if (!unitCreationSystem) {
            console.error('[SceneEditor] UnitCreationSystem not available');
            return;
        }

        // Create entity using the same code path as runtime
        const transform = {
            position: { x, y, z }
        };
        const entityId = unitCreationSystem.createUnit(
            collection,
            spawnType,
            transform,
            'left' // Default team for editor
        );

        if (!entityId) {
            console.error('[SceneEditor] Failed to create entity');
            return;
        }

        // Update entities array with scene-serializable format
        if (!this.state.entities) {
            this.state.entities = [];
        }

        const newEntity = {
            id: entityId,
            collection: collection,
            spawnType: spawnType,
            name: itemData?.title || spawnType,
            components: {
                transform: {
                    position: { x, y, z }
                }
            }
        };

        this.state.entities.push(newEntity);

        // Keep sceneData.entities in sync
        if (this.state.sceneData) {
            this.state.sceneData.entities = this.state.entities;
        }

        // Update UI
        this.renderHierarchy();
        this.state.isDirty = true;
        this.handleSave(false);

        console.log(`[SceneEditor] Created entity ${entityId} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
    }

    /**
     * Handle scene data load event
     * event.detail.data = entities array (from propertyName)
     * event.detail.objectData = full scene object (title, systems, entities)
     */
    async handleRenderSceneObject(event) {
        // Get entities array and full scene object
        // We intentionally keep a reference to the editor framework's data
        // so that edits (gizmo transforms, etc.) persist for saving
        const entities = event.detail.data || [];
        const fullSceneData = event.detail.objectData || { entities };

        // Use editor module systems (from sceneModule.json config), NOT scene data systems
        // The scene editor has its own systems designed for editing, not gameplay
        const systems = this.config.systems || [];

        // Initialize context with editor systems
        await this.initializeContext(systems);

        // Store scene data reference
        this.state.sceneData = fullSceneData;

        // Reset camera states so cameras start fresh for each scene load
        this.sceneCameraState = null;
        this.gameCameraState = null;
        this.state.cameraMode = 'scene';

        // Clear existing entities before loading new scene
        // This also resets the entity ID counter
        if (this.editorGameInstance) {
            this.editorGameInstance.clearAllEntities();
        }

        // Strip any stale IDs and assign fresh ones
        // IDs are runtime-only and must match the ECS counter
        for (const entity of entities) {
            delete entity.id;
            entity.id = this.editorGameInstance.getEntityId();
        }

        // Store entities for editing
        this.state.entities = entities;

        // Load entities into context - editor systems will render them
        await this.editorGameInstance.loadScene({ ...this.state.sceneData, systems });

        // Setup camera and controls AFTER scene loads (worldRenderer is created during scene load)
        this.worldRenderer = this.editorGameInstance.worldSystem?.worldRenderer;
        if (this.worldRenderer) {
            // Replace camera with perspective camera (same as TerrainMapEditor)
            const terrainDataManager = this.editorGameInstance.terrainSystem?.terrainDataManager;
            const terrainSize = terrainDataManager?.terrainSize || 1536;
            const canvas = this.canvas;

            const width = canvas.clientWidth || canvas.width;
            const height = canvas.clientHeight || canvas.height;

            const halfSize = terrainSize / 2;
            const targetPos = { x: 0, y: 0, z: 0 };

            // Position camera in SW corner (-X, +Z) looking NE toward center
            const cameraHeight = halfSize;

            const camera = new THREE.PerspectiveCamera(60, width / height, 1, 30000);
            camera.position.set(-halfSize, cameraHeight, halfSize);
            camera.lookAt(0, 0, 0);

            // Replace the camera in WorldRenderer
            this.worldRenderer.camera = camera;

            // Setup orbit controls
            this.worldRenderer.setupOrbitControls(targetPos);

            // Force initial camera rotation sync
            this.worldRenderer.updateCameraRotation();

            // Initialize RaycastHelper for placement
            this.raycastHelper = new GUTS.RaycastHelper(
                this.worldRenderer.getCamera(),
                this.worldRenderer.getScene()
            );

            // Track mouse world position for SelectedUnitSystem
            this.mouseWorldPos = null;

            // Register getWorldPositionFromMouse for SelectedUnitSystem
            this.editorGameInstance.register('getWorldPositionFromMouse', () => this.mouseWorldPos);

            // Initialize PlacementPreview
            const gameConfig = this.collections.configs?.game || {};
            this.placementPreview = new GUTS.PlacementPreview({
                scene: this.worldRenderer.getScene(),
                gridSize: gameConfig.gridSize || 48,
                getTerrainHeight: (x, z) => {
                    return this.editorGameInstance?.terrainSystem?.getTerrainHeightAtPosition?.(x, z) || 0;
                }
            });

            // Initialize gizmo manager now that worldRenderer exists
            this.initializeGizmoManager();
        }

        // Listen for unit selection events from SelectedUnitSystem
        this.editorGameInstance.on('onUnitSelected', (entityId) => {
            this.selectEntity(entityId);
        });

        this.editorGameInstance.on('onDeSelectAll', () => {
            this.state.selectedEntityId = null;
            this.gizmoManager?.detach();
            this.renderHierarchy();
            this.renderInspector();
        });

        // Render UI
        this.renderHierarchy();
        this.handleResize();
    }

    /**
     * Remove the selected entity
     */
    removeSelectedEntity() {
        if (!this.state.selectedEntityId || !this.editorGameInstance) return;

        // Remove from context - systems will update
        this.editorGameInstance.removeEntity(this.state.selectedEntityId);

        // Remove from entities array
        if (this.state.entities) {
            const index = this.state.entities.findIndex(e => e.id === this.state.selectedEntityId);
            if (index !== -1) {
                this.state.entities.splice(index, 1);
            }
        }

        // Keep sceneData.entities in sync
        if (this.state.sceneData) {
            this.state.sceneData.entities = this.state.entities;
        }

        // Clear selection
        this.state.selectedEntityId = null;
        this.gizmoManager?.detach();

        // Update UI
        this.renderHierarchy();
        this.renderInspector();
        this.handleSave(false);
    }

    /**
     * Render the entity hierarchy panel
     */
    renderHierarchy() {
        if (!this.elements.hierarchy) return;

        this.elements.hierarchy.innerHTML = '';

        const entities = this.state.entities || [];

        for (const entity of entities) {
            const itemEl = document.createElement('div');
            itemEl.className = 'scene-editor__hierarchy-item';
            itemEl.dataset.entityId = entity.id;

            if (this.state.selectedEntityId === entity.id) {
                itemEl.classList.add('selected');
            }

            // Entity icon based on prefab type
            const prefab = this.collections.prefabs?.[entity.prefab];
            let icon = '📦';
            if (prefab?.components?.terrain) icon = '🏔️';
            else if (prefab?.components?.camera) icon = '📷';
            else if (prefab?.components?.renderable) icon = '🎮';

            const nameEl = document.createElement('span');
            nameEl.textContent = `${icon} ${entity.name || entity.prefab || entity.id}`;
            itemEl.appendChild(nameEl);

            // Click to select
            itemEl.addEventListener('click', () => {
                this.selectEntity(entity.id);
            });

            this.elements.hierarchy.appendChild(itemEl);
        }
    }

    /**
     * Select an entity
     */
    selectEntity(entityId) {
        this.state.selectedEntityId = entityId;

        // Update hierarchy UI
        const prevSelected = this.elements.hierarchy?.querySelector('.selected');
        if (prevSelected) prevSelected.classList.remove('selected');

        const entityEl = this.elements.hierarchy?.querySelector(`[data-entity-id="${entityId}"]`);
        if (entityEl) entityEl.classList.add('selected');

        // Update inspector
        this.renderInspector();

        // Attach gizmo to the selected entity
        this.attachGizmoToEntity(entityId);
    }

    /**
     * Render the inspector panel
     */
    renderInspector() {
        if (!this.state.selectedEntityId) {
            if (this.elements.noSelection) this.elements.noSelection.style.display = 'block';
            if (this.elements.entityInspector) this.elements.entityInspector.style.display = 'none';
            return;
        }

        if (this.elements.noSelection) this.elements.noSelection.style.display = 'none';
        if (this.elements.entityInspector) this.elements.entityInspector.style.display = 'block';

        // Find entity in entities array
        const entity = this.state.entities?.find(e => e.id === this.state.selectedEntityId);
        if (!entity) return;

        // Get components from context (merged prefab + overrides)
        const components = {};
        if (this.editorGameInstance) {
            const entityComponents = this.editorGameInstance.entities.get(entity.id);
            if (entityComponents) {
                for (const componentType of entityComponents) {
                    components[componentType] = this.editorGameInstance.getComponent(entity.id, componentType);
                }
            }
        }

        // Clear and render components
        if (this.elements.components) {
            this.elements.components.innerHTML = '';

            for (const [componentType, componentData] of Object.entries(components)) {
                this.renderComponentInspector(componentType, componentData, entity);
            }
        }
    }

    /**
     * Render a component in the inspector
     */
    renderComponentInspector(componentType, componentData, entity) {
        const componentEl = document.createElement('div');
        componentEl.className = 'component-section';

        // Header
        const headerEl = document.createElement('h3');
        headerEl.className = 'component-header';
        headerEl.textContent = this.formatName(componentType);
        componentEl.appendChild(headerEl);

        // Render fields
        this.renderComponentFields(componentEl, componentType, componentData, entity);

        this.elements.components.appendChild(componentEl);
    }

    /**
     * Render component fields
     */
    renderComponentFields(container, componentType, data, entity, path = '') {
        if (typeof data !== 'object' || data === null) {
            this.renderPropertyField(container, path || componentType, data, (newValue) => {
                this.updateEntityComponent(entity, componentType, path, newValue);
            });
            return;
        }

        for (const [key, value] of Object.entries(data)) {
            const fieldPath = path ? `${path}.${key}` : key;

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                if ('x' in value || 'y' in value || 'z' in value) {
                    this.renderVector3Field(container, key, value, (newValue) => {
                        this.updateEntityComponent(entity, componentType, fieldPath, newValue);
                    });
                } else {
                    const nestedContainer = document.createElement('div');
                    nestedContainer.className = 'nested-component';

                    const nestedLabel = document.createElement('label');
                    nestedLabel.textContent = this.formatName(key);
                    nestedLabel.className = 'nested-label';
                    nestedContainer.appendChild(nestedLabel);

                    this.renderComponentFields(nestedContainer, componentType, value, entity, fieldPath);
                    container.appendChild(nestedContainer);
                }
            } else {
                this.renderPropertyField(container, key, value, (newValue) => {
                    this.updateEntityComponent(entity, componentType, fieldPath, newValue);
                });
            }
        }
    }

    /**
     * Render a property field
     */
    renderPropertyField(container, key, value, onChange) {
        const propEl = document.createElement('div');
        propEl.className = 'property';

        const labelEl = document.createElement('label');
        labelEl.textContent = this.formatName(key);
        propEl.appendChild(labelEl);

        let inputEl;

        // Check if this property should be a collection dropdown
        const { matchingTypePlural, matchingTypeSingular } = this.findMatchingCollectionTypes(key);

        if (matchingTypeSingular || matchingTypePlural) {
            // Render as collection dropdown
            inputEl = this.createCollectionDropdown(value, matchingTypeSingular, matchingTypePlural, onChange);
        } else if (typeof value === 'boolean') {
            inputEl = document.createElement('input');
            inputEl.type = 'checkbox';
            inputEl.checked = value;
            inputEl.addEventListener('change', () => onChange(inputEl.checked));
        } else if (typeof value === 'number') {
            inputEl = document.createElement('input');
            inputEl.type = 'number';
            inputEl.value = value;
            inputEl.step = '0.1';
            inputEl.addEventListener('change', () => onChange(parseFloat(inputEl.value)));
        } else if (typeof value === 'string') {
            inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.value = value;
            inputEl.addEventListener('change', () => onChange(inputEl.value));
        } else {
            inputEl = document.createElement('span');
            inputEl.textContent = JSON.stringify(value);
        }

        propEl.appendChild(inputEl);
        container.appendChild(propEl);
    }

    /**
     * Find matching collection types for a property key
     * Similar to EditorModel.findMatchingTypes
     * @param {string} key - Property key to check
     * @returns {Object} matchingTypePlural and matchingTypeSingular
     */
    findMatchingCollectionTypes(key) {
        const keyLower = key.toLowerCase();
        const collectionDefs = this.gameEditor.getCollectionDefs?.() || [];

        // Check for exact matches first, fall back to endsWith if no exact match
        const matchingTypePlural = collectionDefs.find(t =>
            keyLower === t.id.toLowerCase()) ||
            collectionDefs.find(t =>
                keyLower.endsWith(t.id.toLowerCase()));

        const matchingTypeSingular = collectionDefs.find(t =>
            keyLower === t.singular.replace(/ /g,'').toLowerCase()) ||
            collectionDefs.find(t =>
                keyLower.endsWith(t.singular.replace(/ /g,'').toLowerCase()));

        return { matchingTypePlural, matchingTypeSingular };
    }

    /**
     * Create a dropdown for collection selection
     * @param {string} value - Current value
     * @param {Object} matchingTypeSingular - Singular type match (e.g., "level" -> levels collection)
     * @param {Object} matchingTypePlural - Plural type match (e.g., "levels" -> levels collection)
     * @param {Function} onChange - Callback when value changes
     * @returns {HTMLSelectElement} The dropdown element
     */
    createCollectionDropdown(value, matchingTypeSingular, matchingTypePlural, onChange) {
        const selectEl = document.createElement('select');
        selectEl.className = 'property-value ref-select';

        // Determine which type we're referencing
        const typeId = matchingTypePlural ? matchingTypePlural.id : matchingTypeSingular.id;
        const typeSingular = matchingTypePlural ? matchingTypePlural.singular : matchingTypeSingular.singular;

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = `-- Select ${typeSingular} --`;
        selectEl.appendChild(defaultOption);

        // Populate with collection items
        const collection = this.collections[typeId] || {};

        // Sort objects alphabetically by title
        const sortedObjectIds = Object.keys(collection).sort((a, b) => {
            const titleA = (collection[a].title || a).toLowerCase();
            const titleB = (collection[b].title || b).toLowerCase();
            return titleA.localeCompare(titleB);
        });

        for (const objId of sortedObjectIds) {
            const option = document.createElement('option');
            option.value = objId;
            option.textContent = collection[objId].title || objId;
            selectEl.appendChild(option);
        }

        // Set current value
        selectEl.value = value || '';

        // Handle change
        selectEl.addEventListener('change', () => onChange(selectEl.value));

        return selectEl;
    }

    /**
     * Render a Vector3 field
     */
    renderVector3Field(container, key, value, onChange) {
        const propEl = document.createElement('div');
        propEl.className = 'property vector3-property';

        const labelEl = document.createElement('label');
        labelEl.textContent = this.formatName(key);
        propEl.appendChild(labelEl);

        const inputsEl = document.createElement('div');
        inputsEl.className = 'vector3-input';

        const axes = ['x', 'y', 'z'];
        const inputs = {};

        for (const axis of axes) {
            if (axis in value) {
                const axisInput = document.createElement('input');
                axisInput.type = 'number';
                axisInput.value = value[axis];
                axisInput.step = '0.1';
                axisInput.placeholder = axis.toUpperCase();
                axisInput.title = axis.toUpperCase();

                inputs[axis] = axisInput;

                axisInput.addEventListener('change', () => {
                    const newValue = { ...value };
                    for (const a of axes) {
                        if (inputs[a]) {
                            newValue[a] = parseFloat(inputs[a].value) || 0;
                        }
                    }
                    onChange(newValue);
                });

                inputsEl.appendChild(axisInput);
            }
        }

        propEl.appendChild(inputsEl);
        container.appendChild(propEl);
    }

    /**
     * Update an entity's component
     */
    updateEntityComponent(entity, componentType, path, newValue) {
        // Update in context
        if (this.editorGameInstance) {
            const currentData = this.editorGameInstance.getComponent(entity.id, componentType);
            if (currentData && path) {
                const parts = path.split('.');
                let target = currentData;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!target[parts[i]]) target[parts[i]] = {};
                    target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = newValue;
            }

            // Trigger systems to update
            this.editorGameInstance.triggerEvent('onEntityComponentUpdated', { entityId: entity.id, componentType });
        }

        // Update in scene data
        if (!entity.components) entity.components = {};
        if (!entity.components[componentType]) {
            const prefab = this.collections.prefabs?.[entity.prefab];
            entity.components[componentType] = JSON.parse(JSON.stringify(prefab?.components?.[componentType] || {}));
        }

        if (path) {
            const parts = path.split('.');
            let target = entity.components[componentType];
            for (let i = 0; i < parts.length - 1; i++) {
                if (!target[parts[i]]) target[parts[i]] = {};
                target = target[parts[i]];
            }
            target[parts[parts.length - 1]] = newValue;
        } else {
            entity.components[componentType] = newValue;
        }

        this.state.isDirty = true;
        this.handleSave(false);
    }

    /**
     * Handle resize
     */
    handleResize() {
        // WorldSystem handles its own resize if initialized
        if (this.editorGameInstance?.worldSystem) {
            this.editorGameInstance.worldSystem.onWindowResize?.();
        }
    }

    /**
     * Save scene data
     * Saves entities array with propertyName: "entities" as expected by editor framework
     * Entity IDs are stripped - they should be assigned at runtime by load order
     */
    handleSave(fireSave = false) {
        // Get the entities array to save, stripping internal 'id' field
        // Entity IDs should be assigned deterministically at load time
        const entitiesToSave = (this.state.entities || []).map(entity => {
            const { id, ...entityWithoutId } = entity;
            return entityWithoutId;
        });

        if (fireSave) {
            const saveEvent = new CustomEvent('saveSceneObject', {
                detail: {
                    data: entitiesToSave,
                    propertyName: 'entities'
                },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(saveEvent);
        } else {
            // Update the textarea if visible
            const valueElement = this.gameEditor.elements?.editor?.querySelector('textarea');
            if (valueElement) {
                valueElement.value = JSON.stringify(entitiesToSave, null, 2);
            }
        }
    }

    /**
     * Set gizmo mode
     */
    setGizmoMode(mode) {
        if (this.gizmoManager) {
            this.gizmoManager.setMode(mode);
        }
    }

    /**
     * Initialize the gizmo manager with scene/camera/renderer from worldRenderer
     */
    initializeGizmoManager() {
        if (!this.gizmoManager || !this.worldRenderer) return;

        const scene = this.worldRenderer.getScene();
        const camera = this.worldRenderer.getCamera();
        const renderer = this.worldRenderer.renderer;
        const controls = this.worldRenderer.controls;

        if (!scene || !camera || !renderer) {
            console.warn('[SceneEditor] Cannot init gizmo manager - missing scene/camera/renderer');
            return;
        }

        // Create a helper object for gizmo attachment (since entities are instanced/batched)
        this.gizmoHelper = new THREE.Object3D();
        this.gizmoHelper.name = 'gizmoHelper';
        scene.add(this.gizmoHelper);

        // Initialize gizmo manager with the proper references
        this.gizmoManager.init({
            scene: scene,
            camera: camera,
            renderer: renderer,
            controls: controls,
            // Provide callbacks for transform sync
            onTransformChange: (position, rotation, scale) => {
                this.syncGizmoToEntity(position, rotation, scale);
            }
        });

        console.log('[SceneEditor] Gizmo manager initialized');
    }

    /**
     * Attach gizmo to selected entity by positioning helper at entity location
     */
    attachGizmoToEntity(entityId) {
        if (!this.gizmoManager || !this.gizmoHelper || !this.editorGameInstance) {
            return;
        }

        // Get entity's transform component
        const transform = this.editorGameInstance.getComponent(entityId, 'transform');
        if (!transform) {
            console.warn('[SceneEditor] Entity has no transform component:', entityId);
            this.gizmoManager.detach();
            return;
        }

        // Position helper at entity location
        const pos = transform.position || { x: 0, y: 0, z: 0 };
        const rot = transform.rotation || { x: 0, y: 0, z: 0 };
        const scl = transform.scale || { x: 1, y: 1, z: 1 };

        this.gizmoHelper.position.set(pos.x, pos.y, pos.z);
        this.gizmoHelper.rotation.set(rot.x, rot.y, rot.z);
        this.gizmoHelper.scale.set(scl.x, scl.y, scl.z);

        // Attach gizmo to helper
        this.gizmoManager.attach(this.gizmoHelper);

        console.log('[SceneEditor] Gizmo attached to entity:', entityId, 'at position:', pos);
    }

    /**
     * Sync gizmo helper transform back to entity component
     */
    syncGizmoToEntity(position, rotation, scale) {
        if (!this.state.selectedEntityId || !this.editorGameInstance) return;

        const entityId = this.state.selectedEntityId;

        // Get current transform
        const transform = this.editorGameInstance.getComponent(entityId, 'transform');
        if (!transform) return;

        // Update transform component
        if (position) {
            transform.position = { x: position.x, y: position.y, z: position.z };
        }
        if (rotation) {
            transform.rotation = { x: rotation.x, y: rotation.y, z: rotation.z };
        }
        if (scale) {
            transform.scale = { x: scale.x, y: scale.y, z: scale.z };
        }

        // Update component in ECS
        this.editorGameInstance.addComponent(entityId, 'transform', transform);

        // Update visual representation via RenderSystem
        const renderSystem = this.editorGameInstance.renderSystem;
        if (renderSystem) {
            // Calculate rotation angle from y-axis rotation for 2D sprites
            const angle = rotation ? rotation.y : 0;
            renderSystem.updateEntity(entityId, {
                position: transform.position,
                rotation: angle,
                transform: transform
            });
        }

        // Update entity overrides in state.entities for saving
        const entityData = this.state.entities?.find(e => e.id === entityId);
        if (entityData) {
            if (!entityData.components) entityData.components = {};
            entityData.components.transform = {
                position: transform.position,
                rotation: transform.rotation,
                scale: transform.scale
            };
        }

        // Mark as dirty and save
        this.state.isDirty = true;
        this.handleSave(false);

        // Update inspector to reflect changes
        this.renderInspector();
    }

    /**
     * Update gizmo toolbar UI
     */
    updateGizmoToolbarUI(activeButtonId) {
        ['scene-translate-tool', 'scene-rotate-tool', 'scene-scale-tool'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.remove('active');
        });

        const activeBtn = document.getElementById(activeButtonId);
        if (activeBtn) activeBtn.classList.add('active');
    }

    /**
     * Format name for display
     */
    formatName(name) {
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

    /**
     * Toggle between scene camera (perspective) and game camera (orthographic)
     */
    toggleCamera() {
        if (!this.worldRenderer) {
            console.warn('[SceneEditor] WorldRenderer not available for camera toggle');
            return;
        }

        const newMode = this.state.cameraMode === 'scene' ? 'game' : 'scene';
        this.setCameraMode(newMode);
    }

    /**
     * Set the camera mode
     * @param {string} mode - 'scene' or 'game'
     */
    setCameraMode(mode) {
        if (!this.worldRenderer) return;

        const canvas = this.canvas;
        const width = canvas.clientWidth || canvas.width;
        const height = canvas.clientHeight || canvas.height;

        // Save current camera state before switching
        this.saveCameraState();

        // Store selected entity to reattach gizmo after camera switch
        const selectedEntityId = this.state.selectedEntityId;

        // Detach and dispose gizmo before switching cameras
        if (this.gizmoManager) {
            this.gizmoManager.detach();
            this.gizmoManager.dispose();
        }

        // Remove old gizmo helper from scene
        if (this.gizmoHelper && this.worldRenderer.getScene()) {
            this.worldRenderer.getScene().remove(this.gizmoHelper);
            this.gizmoHelper = null;
        }

        if (mode === 'game') {
            // Switch to orthographic (game) camera
            this.setupGameCamera(width, height);
        } else {
            // Switch to perspective (scene) camera
            this.setupSceneCamera(width, height);
        }

        this.state.cameraMode = mode;

        // Update raycast helper with new camera
        if (this.raycastHelper) {
            this.raycastHelper = new GUTS.RaycastHelper(
                this.worldRenderer.getCamera(),
                this.worldRenderer.getScene()
            );
        }

        // Reinitialize gizmo manager with new camera
        this.initializeGizmoManager();

        // Reattach gizmo to selected entity if there was one
        if (selectedEntityId) {
            this.attachGizmoToEntity(selectedEntityId);
        }

        // Update button text and show/hide rotation buttons
        const toggleBtn = document.getElementById('scene-camera-toggle');
        if (toggleBtn) {
            toggleBtn.querySelector('span').textContent = mode === 'scene' ? 'Scene Cam' : 'Game Cam';
            toggleBtn.classList.toggle('editor-module__btn--active', mode === 'game');
        }

        const rotateLeftBtn = document.getElementById('scene-camera-rotate-left');
        const rotateRightBtn = document.getElementById('scene-camera-rotate-right');
        if (rotateLeftBtn) rotateLeftBtn.style.display = mode === 'game' ? '' : 'none';
        if (rotateRightBtn) rotateRightBtn.style.display = mode === 'game' ? '' : 'none';

        console.log(`[SceneEditor] Camera mode switched to: ${mode}`);
    }

    /**
     * Save the current camera state based on mode
     */
    saveCameraState() {
        if (!this.worldRenderer?.camera) return;

        const camera = this.worldRenderer.camera;
        const controls = this.worldRenderer.controls;

        if (this.state.cameraMode === 'scene') {
            this.sceneCameraState = {
                position: camera.position.clone(),
                target: controls?.target?.clone() || new THREE.Vector3(0, 0, 0),
                rotationX: this.worldRenderer.cameraRotationX,
                rotationY: this.worldRenderer.cameraRotationY
            };
        } else {
            this.gameCameraState = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
                zoom: camera.zoom,
                lookAt: camera.userData?.lookAt?.clone()
            };
        }
    }

    /**
     * Setup perspective camera for scene editing
     */
    setupSceneCamera(width, height) {
        const terrainDataManager = this.editorGameInstance?.terrainSystem?.terrainDataManager;
        const terrainSize = terrainDataManager?.terrainSize || 1536;
        const halfSize = terrainSize / 2;

        // Create perspective camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 1, 30000);

        // Restore saved state or use default position
        if (this.sceneCameraState) {
            camera.position.copy(this.sceneCameraState.position);
        } else {
            // Default: Position in SW corner looking NE
            camera.position.set(-halfSize, halfSize, halfSize);
        }

        // Set camera in WorldRenderer
        this.worldRenderer.camera = camera;

        // Clean up game camera wheel handler if it exists
        if (this.gameCameraWheelHandler) {
            this.canvas.removeEventListener('wheel', this.gameCameraWheelHandler);
            this.gameCameraWheelHandler = null;
        }

        // Dispose old controls and their event handlers
        this.cleanupWorldRendererControls();

        // Setup orbit controls for scene editing
        const targetPos = this.sceneCameraState?.target || { x: 0, y: 0, z: 0 };
        this.worldRenderer.setupOrbitControls(targetPos);

        // Restore rotation state
        if (this.sceneCameraState) {
            this.worldRenderer.cameraRotationX = this.sceneCameraState.rotationX || 0;
            this.worldRenderer.cameraRotationY = this.sceneCameraState.rotationY || 0;
        }

        camera.lookAt(targetPos.x || 0, targetPos.y || 0, targetPos.z || 0);
    }

    /**
     * Clean up WorldRenderer controls and their event handlers
     */
    cleanupWorldRendererControls() {
        if (!this.worldRenderer) return;

        // Clean up keyboard handlers
        if (this.worldRenderer.controlsKeyHandlers) {
            window.removeEventListener('keydown', this.worldRenderer.controlsKeyHandlers.handleKeyDown);
            window.removeEventListener('keyup', this.worldRenderer.controlsKeyHandlers.handleKeyUp);
            this.worldRenderer.controlsKeyHandlers = null;
        }

        // Clean up mouse handlers
        if (this.worldRenderer.controlsMouseHandlers && this.worldRenderer.renderer?.domElement) {
            const element = this.worldRenderer.renderer.domElement;
            element.removeEventListener('mousedown', this.worldRenderer.controlsMouseHandlers.handleMouseDown);
            element.removeEventListener('mousemove', this.worldRenderer.controlsMouseHandlers.handleMouseMove);
            element.removeEventListener('mouseup', this.worldRenderer.controlsMouseHandlers.handleMouseUp);
            element.removeEventListener('wheel', this.worldRenderer.controlsMouseHandlers.handleWheel);
            this.worldRenderer.controlsMouseHandlers = null;
        }

        // Dispose orbit controls
        if (this.worldRenderer.controls) {
            this.worldRenderer.controls.dispose();
            this.worldRenderer.controls = null;
        }
    }

    /**
     * Setup orthographic camera for game-view
     */
    setupGameCamera(width, height) {
        // Create orthographic camera like the game uses
        const camera = new THREE.OrthographicCamera(
            width / -2,
            width / 2,
            height / 2,
            height / -2,
            0.1,
            50000
        );

        // Restore saved state or use default
        if (this.gameCameraState) {
            camera.position.copy(this.gameCameraState.position);
            camera.zoom = this.gameCameraState.zoom || 1;
            // Restore quaternion to preserve exact rotation (important after camera rotations)
            if (this.gameCameraState.quaternion) {
                camera.quaternion.copy(this.gameCameraState.quaternion);
            } else if (this.gameCameraState.lookAt) {
                // Fallback for old saved state without quaternion
                camera.lookAt(this.gameCameraState.lookAt.x, this.gameCameraState.lookAt.y, this.gameCameraState.lookAt.z);
            }
            if (this.gameCameraState.lookAt) {
                camera.userData.lookAt = this.gameCameraState.lookAt.clone();
            }
        } else {
            // Default game camera position (isometric view)
            // Use the same setup as CameraControlSystem.lookAt()
            const pitch = 35.264 * Math.PI / 180;
            const yaw = 135 * Math.PI / 180;
            const distance = this.getCameraHeight();

            const worldX = 0;
            const worldZ = 0;

            const cdx = Math.sin(yaw) * Math.cos(pitch);
            const cdz = Math.cos(yaw) * Math.cos(pitch);

            camera.position.set(
                worldX - cdx * distance,
                distance,
                worldZ - cdz * distance
            );
            camera.zoom = 1;
            camera.lookAt(worldX, 0, worldZ);
            camera.userData.lookAt = new THREE.Vector3(worldX, 0, worldZ);
        }

        camera.updateProjectionMatrix();

        // Set camera in WorldRenderer
        this.worldRenderer.camera = camera;

        // Dispose orbit controls for game camera (it uses edge panning instead)
        if (this.worldRenderer.controls) {
            this.worldRenderer.controls.dispose();
            this.worldRenderer.controls = null;
        }

        // Setup mouse wheel zoom for game camera
        this.setupGameCameraControls(camera);
    }

    /**
     * Setup simple controls for game camera (zoom + optional pan)
     */
    setupGameCameraControls(camera) {
        // Remove any existing game camera handlers
        if (this.gameCameraWheelHandler) {
            this.canvas.removeEventListener('wheel', this.gameCameraWheelHandler);
        }
        if (this.gameCameraMouseDownHandler) {
            this.canvas.removeEventListener('mousedown', this.gameCameraMouseDownHandler);
            this.canvas.removeEventListener('mousemove', this.gameCameraMouseMoveHandler);
            this.canvas.removeEventListener('mouseup', this.gameCameraMouseUpHandler);
            this.canvas.removeEventListener('mouseleave', this.gameCameraMouseUpHandler);
        }

        // Mouse wheel zoom
        this.gameCameraWheelHandler = (e) => {
            if (this.state.cameraMode !== 'game') return;
            e.preventDefault();

            if (e.deltaY > 0) {
                camera.zoom *= 0.9;
            } else {
                camera.zoom *= 1.1;
            }
            camera.zoom = Math.max(0.1, Math.min(5, camera.zoom));
            camera.updateProjectionMatrix();
        };

        // Right-click drag to pan
        let isPanning = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        this.gameCameraMouseDownHandler = (e) => {
            if (this.state.cameraMode !== 'game') return;
            if (e.button === 2) {
                // Don't start panning if the gizmo is being hovered - let gizmo handle the drag
                // Pass the event so gizmo can update mouse position before checking
                if (this.gizmoManager && this.gizmoManager.isMouseOverGizmo(e)) {
                    return;
                }
                isPanning = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                e.preventDefault();
            }
        };

        this.gameCameraMouseMoveHandler = (e) => {
            if (!isPanning || this.state.cameraMode !== 'game') return;

            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            // Pan speed adjusted for orthographic camera
            const panSpeed = 1 / camera.zoom;

            // Get camera's right and up vectors
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

            // Move camera position
            camera.position.x -= right.x * deltaX * panSpeed;
            camera.position.y -= right.y * deltaX * panSpeed;
            camera.position.z -= right.z * deltaX * panSpeed;

            camera.position.x += up.x * deltaY * panSpeed;
            camera.position.y += up.y * deltaY * panSpeed;
            camera.position.z += up.z * deltaY * panSpeed;
        };

        this.gameCameraMouseUpHandler = () => {
            isPanning = false;
        };

        this.canvas.addEventListener('wheel', this.gameCameraWheelHandler, { passive: false });
        this.canvas.addEventListener('mousedown', this.gameCameraMouseDownHandler);
        this.canvas.addEventListener('mousemove', this.gameCameraMouseMoveHandler);
        this.canvas.addEventListener('mouseup', this.gameCameraMouseUpHandler);
        this.canvas.addEventListener('mouseleave', this.gameCameraMouseUpHandler);
    }

    /**
     * Rotate the game camera 45 degrees around the look-at point
     * @param {string} direction - 'left' or 'right'
     */
    rotateGameCamera(direction) {
        if (this.state.cameraMode !== 'game') return;

        const camera = this.worldRenderer?.camera;
        if (!camera) return;

        // Raycast from center of screen to find ground point
        const raycaster = new THREE.Raycaster();
        const centerScreen = new THREE.Vector2(0, 0); // NDC center
        raycaster.setFromCamera(centerScreen, camera);

        // Find the ground mesh
        const ground = this.editorGameInstance?.call('getGroundMesh');
        if (!ground) return;

        const intersects = raycaster.intersectObject(ground, true);
        if (intersects.length === 0) return;

        const groundPoint = intersects[0].point;

        const rotationAngle = direction === 'left' ? Math.PI / 4 : -Math.PI / 4;

        // Calculate current offset from ground point
        const offset = new THREE.Vector3().subVectors(camera.position, groundPoint);

        // Rotate offset around Y axis
        const cosA = Math.cos(rotationAngle);
        const sinA = Math.sin(rotationAngle);
        const newX = offset.x * cosA - offset.z * sinA;
        const newZ = offset.x * sinA + offset.z * cosA;

        // Apply new position
        camera.position.x = groundPoint.x + newX;
        camera.position.z = groundPoint.z + newZ;

        // Update camera to look at the ground point
        camera.lookAt(groundPoint);
        camera.userData.lookAt = groundPoint.clone();
    }

    /**
     * Handle unload event when switching away from this editor
     * Cleans up data and instances while keeping HTML around
     */
    handleUnloadSceneObject() {
        console.log('[SceneEditor] Unloading scene data');

        // Cancel any active placement mode
        this.cancelPlacementMode();

        // Detach and clean up gizmo
        if (this.gizmoManager) {
            this.gizmoManager.detach();
        }

        // Remove gizmo helper from scene
        if (this.gizmoHelper && this.worldRenderer) {
            const scene = this.worldRenderer.getScene();
            if (scene) {
                scene.remove(this.gizmoHelper);
            }
            this.gizmoHelper = null;
        }

        // Clean up placement preview
        if (this.placementPreview) {
            this.placementPreview.dispose();
            this.placementPreview = null;
        }

        // Clean up raycast helper
        this.raycastHelper = null;

        // Destroy the ECS game instance (clears all entities and systems)
        if (this.editorGameInstance) {
            this.editorGameInstance.destroy();
            this.editorGameInstance = null;
        }

        // Clear world renderer reference
        this.worldRenderer = null;

        // Reset state but keep HTML structure
        this.state.entities = [];
        this.state.sceneData = null;
        this.state.selectedEntityId = null;
        this.state.isDirty = false;
        this.state.initialized = false;

        // Clean up game camera handlers
        if (this.gameCameraWheelHandler) {
            this.canvas?.removeEventListener('wheel', this.gameCameraWheelHandler);
            this.gameCameraWheelHandler = null;
        }
        if (this.gameCameraMouseDownHandler) {
            this.canvas?.removeEventListener('mousedown', this.gameCameraMouseDownHandler);
            this.canvas?.removeEventListener('mousemove', this.gameCameraMouseMoveHandler);
            this.canvas?.removeEventListener('mouseup', this.gameCameraMouseUpHandler);
            this.canvas?.removeEventListener('mouseleave', this.gameCameraMouseUpHandler);
            this.gameCameraMouseDownHandler = null;
            this.gameCameraMouseMoveHandler = null;
            this.gameCameraMouseUpHandler = null;
        }
    }

    /**
     * Cleanup (full destruction)
     */
    destroy() {
        // Use unload to clean up data first
        this.handleUnloadSceneObject();

        if (this.gizmoManager) {
            this.gizmoManager.dispose?.();
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneEditor;
}

if (typeof GUTS !== 'undefined') {
    GUTS.SceneEditor = SceneEditor;
}
