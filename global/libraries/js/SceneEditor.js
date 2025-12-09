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
            initialized: false
        };

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

        // Mouse tracking for placement
        this.mouseNDC = { x: 0, y: 0 };
        this.mouseOverCanvas = false;
        this.raycastHelper = null;
        this.placementPreview = null;

        // Editor context - handles all rendering via game systems
        this.editorContext = null;

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
     * Initialize the editor context with game systems
     * @param {Array<string>} systems - Systems to initialize (from scene data)
     */
    async initializeContext(systems) {
        if (this.state.initialized) return;

        // Create editor context (like ECSGame)
        this.editorContext = new GUTS.EditorECSGame(this.gameEditor, this.canvas);

        // Use EditorLoader to load assets and initialize (like GameLoader)
        this.editorLoader = new GUTS.EditorLoader(this.editorContext);
        await this.editorLoader.load({
            systems: systems
        });

        // Initialize gizmo manager (will be configured after scene loads when worldRenderer exists)
        if (this.gizmoManager && this.editorContext.worldSystem?.worldRenderer) {
            this.gizmoManager.init({
                scene: this.editorContext.scene,
                camera: this.editorContext.camera,
                renderer: this.editorContext.renderer,
                canvas: this.canvas
            });
        }

        // Start render loop
        this.editorContext.startRenderLoop();

        this.state.initialized = true;
        console.log('[SceneEditor] Context initialized with systems:', systems);
    }

    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Handle scene data load from editor
        document.body.addEventListener('renderSceneObject', this.handleRenderSceneObject.bind(this));

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
            this.updatePlacementPreview();
        });

        this.canvas?.addEventListener('click', (e) => {
            if (this.placementMode.active) {
                this.placeEntityAtMouse();
            }
        });

        // Right-click to cancel placement
        this.canvas?.addEventListener('contextmenu', (e) => {
            if (this.placementMode.active) {
                e.preventDefault();
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

        for (const [itemId, itemData] of Object.entries(collectionData)) {
            const item = document.createElement('div');
            item.className = 'editor-module__list-item';
            item.dataset.collection = collectionId;
            item.dataset.spawnType = itemId;
            item.textContent = itemData.title || itemId;
            item.addEventListener('click', () => {
                this.activatePlacementMode(collectionId, itemId, itemData);
                // Update selection UI
                this.elements.spawnTypeList.querySelectorAll('.editor-module__list-item').forEach(el => {
                    el.classList.remove('editor-module__list-item--selected');
                });
                item.classList.add('editor-module__list-item--selected');
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
        const terrainSystem = this.editorContext?.terrainSystem;
        const terrainHeight = terrainSystem?.getTerrainHeightAtPosition?.(worldPos.x, worldPos.z) || worldPos.y;

        // Create entity using UnitCreationSystem
        this.createEntityAtPosition(worldPos.x, terrainHeight, worldPos.z);
    }

    /**
     * Create entity at specific position
     */
    createEntityAtPosition(x, y, z) {
        if (!this.editorContext) return;

        const { collection, spawnType, itemData } = this.placementMode;
        if (!collection || !spawnType) return;

        // Use UnitCreationSystem to create the entity with proper components
        const unitCreationSystem = this.editorContext.unitCreationSystem;
        if (!unitCreationSystem) {
            console.error('[SceneEditor] UnitCreationSystem not available');
            return;
        }

        // Create entity using the same code path as runtime
        const entityId = unitCreationSystem.createUnit(
            x, y, z,
            collection,
            spawnType,
            'left', // Default team for editor
            null    // No player ID
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
            position: { x, y, z }
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
        const entities = event.detail.data || [];
        const fullSceneData = event.detail.objectData || { entities };

        // Store both - entities for editing, full scene for context
        this.state.entities = entities;
        this.state.sceneData = fullSceneData;

        // Use editor module systems (from sceneModule.json config), NOT scene data systems
        // The scene editor has its own systems designed for editing, not gameplay
        const systems = this.config.systems || [];

        // Initialize context with editor systems
        await this.initializeContext(systems);

        // Clear existing entities before loading new scene
        if (this.editorContext) {
            this.editorContext.clearAllEntities();
        }

        // Load entities into context - editor systems will render them
        // Pass scene data but our editor systems will handle rendering
        await this.editorContext.loadScene({ ...fullSceneData, systems });

        // Setup camera and controls AFTER scene loads (worldRenderer is created during scene load)
        this.worldRenderer = this.editorContext.worldSystem?.worldRenderer;
        if (this.worldRenderer) {
            // Replace camera with perspective camera (same as TerrainMapEditor)
            const terrainDataManager = this.editorContext.terrainSystem?.terrainDataManager;
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

            // Initialize PlacementPreview
            const gameConfig = this.collections.configs?.game || {};
            this.placementPreview = new GUTS.PlacementPreview({
                scene: this.worldRenderer.getScene(),
                gridSize: gameConfig.gridSize || 48,
                getTerrainHeight: (x, z) => {
                    return this.editorContext?.terrainSystem?.getTerrainHeightAtPosition?.(x, z) || 0;
                }
            });
        }

        // Render UI
        this.renderHierarchy();
        this.handleResize();
    }

    /**
     * Remove the selected entity
     */
    removeSelectedEntity() {
        if (!this.state.selectedEntityId || !this.editorContext) return;

        // Remove from context - systems will update
        this.editorContext.removeEntity(this.state.selectedEntityId);

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

        // Attach gizmo if entity has a 3D representation
        // TODO: Get entity object from render system
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
        if (this.editorContext) {
            const entityComponents = this.editorContext.entities.get(entity.id);
            if (entityComponents) {
                for (const componentType of entityComponents) {
                    components[componentType] = this.editorContext.getComponent(entity.id, componentType);
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
        if (this.editorContext) {
            const currentData = this.editorContext.getComponent(entity.id, componentType);
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
            this.editorContext.triggerEvent('onEntityComponentUpdated', { entityId: entity.id, componentType });
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
        if (this.editorContext?.worldSystem) {
            this.editorContext.worldSystem.onWindowResize?.();
        }
    }

    /**
     * Save scene data
     * Saves entities array with propertyName: "entities" as expected by editor framework
     */
    handleSave(fireSave = false) {
        // Get the entities array to save
        const entitiesToSave = this.state.entities || [];

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
     * Cleanup
     */
    destroy() {
        if (this.editorContext) {
            this.editorContext.destroy();
        }

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
