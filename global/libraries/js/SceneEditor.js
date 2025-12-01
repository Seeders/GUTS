/**
 * SceneEditor - Unity-like scene editor for GUTS
 * Uses SceneEditorContext for real game system rendering
 * Supports prefabs, entities with components, and real-time terrain preview
 */
class SceneEditor {
    constructor(gameEditor, config, { ShapeFactory, SE_GizmoManager, ModelManager, GameState, ImageManager }) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.collections = this.gameEditor.getCollections();

        // DOM elements
        this.canvas = document.getElementById('scene-editor-canvas');

        // Initialize state
        this.state = {
            sceneData: null,
            selectedEntityId: null,
            isDirty: false
        };

        // UI Elements
        this.elements = {
            hierarchy: document.getElementById('scene-hierarchy'),
            inspector: document.getElementById('scene-inspector'),
            noSelection: document.getElementById('scene-noSelection'),
            entityInspector: document.getElementById('scene-entityInspector'),
            components: document.getElementById('scene-components'),
            addPrefabSelect: document.getElementById('scene-addPrefabSelect'),
            addPrefabBtn: document.getElementById('scene-addPrefabBtn'),
            removePrefabBtn: document.getElementById('scene-removePrefabBtn'),
        };

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = new THREE.Clock();

        // Editor context (game-like environment for rendering)
        this.editorContext = null;

        // Rendering components
        this.worldRenderer = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;

        // Gizmo manager for transform manipulation
        this.gizmoManager = new SE_GizmoManager();

        // Root group for editor objects (gizmos, helpers, etc.)
        this.editorGroup = null;

        // Animation frame ID
        this.animationFrameId = null;

        // Initialize
        this.initThreeJS();
        this.gizmoManager.init(this);
        this.initEventListeners();
        this.populatePrefabSelect();
        this.startRenderLoop();
    }

    /**
     * Initialize Three.js scene, camera, and renderer
     */
    initThreeJS() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);

        // Editor group for helpers and gizmos
        this.editorGroup = new THREE.Group();
        this.editorGroup.name = 'editorGroup';
        this.scene.add(this.editorGroup);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            60,
            this.canvas.clientWidth / this.canvas.clientHeight,
            1,
            50000
        );
        this.camera.position.set(500, 800, 500);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Expose to gameEditor for compatibility
        this.gameEditor.scene = this.scene;
        this.gameEditor.camera = this.camera;
        this.gameEditor.renderer = this.renderer;

        // Add grid helper
        const gridHelper = new THREE.GridHelper(2000, 40, 0x444444, 0x888888);
        this.editorGroup.add(gridHelper);

        // Add axes helper
        const axesHelper = new THREE.AxesHelper(100);
        this.editorGroup.add(axesHelper);

        // Orbit controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.maxPolarAngle = Math.PI / 2.1;

        // Basic lighting for editor preview
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(500, 1000, 500);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
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

        // Add prefab button
        this.elements.addPrefabBtn?.addEventListener('click', () => {
            this.addPrefabToScene();
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
    }

    /**
     * Populate the prefab select dropdown with available prefabs
     */
    populatePrefabSelect() {
        if (!this.elements.addPrefabSelect) return;

        this.elements.addPrefabSelect.innerHTML = '';

        const prefabs = this.collections.prefabs || {};

        for (const [prefabName, prefabData] of Object.entries(prefabs)) {
            const option = document.createElement('option');
            option.value = prefabName;
            option.textContent = prefabData.title || prefabName;
            this.elements.addPrefabSelect.appendChild(option);
        }
    }

    /**
     * Handle scene data load event
     */
    async handleRenderSceneObject(event) {
        const sceneData = event.detail.data;
        this.state.sceneData = sceneData;

        // Resize canvas
        this.handleResize();

        // Load models if needed
        await this.loadAssets();

        // Clear and render scene
        await this.renderScene(sceneData);

        // Render hierarchy
        this.renderHierarchy();
    }

    /**
     * Load required assets (models, textures, etc.)
     */
    async loadAssets() {
        if (!this.gameEditor.modelManager) {
            const palette = this.gameEditor.getPalette();
            this.gameEditor.modelManager = new GUTS.ModelManager(
                this.gameEditor,
                {},
                { ShapeFactory: GUTS.ShapeFactory, palette, textures: this.collections.textures }
            );
        }

        if (!this.gameEditor.modelManager.assetsLoaded) {
            for (const objectType in this.collections) {
                await this.gameEditor.modelManager.loadModels(objectType, this.collections[objectType]);
            }
        }
    }

    /**
     * Render the scene with terrain and entities
     */
    async renderScene(sceneData) {
        // Clear existing world rendering
        this.clearWorldRendering();

        if (!sceneData || !sceneData.entities) return;

        // Check for terrain entity
        const terrainEntity = sceneData.entities.find(e => {
            const prefab = this.collections.prefabs?.[e.prefab];
            return prefab?.components?.terrain || e.components?.terrain;
        });

        if (terrainEntity) {
            await this.initTerrainRendering(terrainEntity);
        }

        // Render other entities
        for (const entityDef of sceneData.entities) {
            if (entityDef === terrainEntity) continue; // Skip terrain, already rendered
            await this.renderEntity(entityDef);
        }
    }

    /**
     * Initialize terrain rendering using WorldRenderer
     */
    async initTerrainRendering(terrainEntity) {
        // Get terrain component data
        const prefab = this.collections.prefabs?.[terrainEntity.prefab];
        const terrainConfig = {
            ...(prefab?.components?.terrain || {}),
            ...(terrainEntity.components?.terrain || {})
        };

        if (!terrainConfig.level) {
            console.warn('[SceneEditor] Terrain entity missing level reference');
            return;
        }

        const gameConfig = this.collections.configs.game;

        // Initialize TerrainDataManager
        this.terrainDataManager = new GUTS.TerrainDataManager();
        this.terrainDataManager.init(this.collections, gameConfig, terrainConfig.level);

        // Initialize TileMapper for terrain textures
        if (!this.gameEditor.terrainTileMapper) {
            const palette = this.gameEditor.getPalette();
            const imageManager = new GUTS.ImageManager(
                this.gameEditor,
                { imageSize: gameConfig.imageSize, palette },
                { ShapeFactory: GUTS.ShapeFactory }
            );

            await imageManager.loadImages("levels", { level: this.collections.levels[terrainConfig.level] }, false, false);
            const terrainImages = imageManager.getImages("levels", "level");

            const terrainCanvasBuffer = document.createElement('canvas');
            terrainCanvasBuffer.width = this.terrainDataManager.terrainSize;
            terrainCanvasBuffer.height = this.terrainDataManager.terrainSize;

            this.gameEditor.terrainTileMapper = new GUTS.TileMap({});
            this.gameEditor.terrainTileMapper.init(
                terrainCanvasBuffer,
                gameConfig.gridSize,
                terrainImages,
                gameConfig.isIsometric,
                { skipCliffTextures: false }
            );
        }

        // Initialize WorldRenderer
        this.worldRenderer = new GUTS.WorldRenderer({
            enableShadows: terrainConfig.enableShadows !== false,
            enableFog: false, // Disable fog in editor for visibility
            enablePostProcessing: false,
            enableGrass: terrainConfig.enableGrass || false,
            enableLiquidSurfaces: terrainConfig.enableLiquids !== false,
            enableCliffs: terrainConfig.enableCliffs !== false
        });

        // Get world config
        const level = this.collections.levels?.[terrainConfig.level];
        const world = this.collections.worlds?.[terrainConfig.world || level?.world];

        // Initialize with editor camera settings
        const cameraSettings = {
            position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
            lookAt: { x: 0, y: 0, z: 0 },
            zoom: 1,
            near: 1,
            far: 50000
        };

        this.worldRenderer.initializeThreeJS(this.canvas, cameraSettings, true);

        // Use the editor's scene and camera
        this.worldRenderer.scene = this.scene;
        this.worldRenderer.camera = this.camera;
        this.worldRenderer.renderer = this.renderer;

        // Set background color
        if (world?.backgroundColor) {
            this.scene.background = new THREE.Color(world.backgroundColor);
        }

        // Setup lighting from world config
        const lightingSettings = this.collections.lightings?.[world?.lighting];
        const shadowSettings = this.collections.shadows?.[world?.shadow];
        this.worldRenderer.setupLighting(lightingSettings, shadowSettings, this.terrainDataManager.extendedSize);

        // Setup ground
        this.worldRenderer.setupGround(
            this.terrainDataManager,
            this.gameEditor.terrainTileMapper,
            this.terrainDataManager.heightMapSettings
        );

        // Render terrain
        this.worldRenderer.renderTerrain();

        // Create extension planes
        this.worldRenderer.createExtensionPlanes();

        // Initialize EntityRenderer for spawning cliffs and entities
        this.entityRenderer = new GUTS.EntityRenderer({
            scene: this.scene,
            collections: this.collections,
            projectName: this.gameEditor.getCurrentProject(),
            modelManager: this.gameEditor.modelManager,
            getPalette: () => this.gameEditor.getPalette()
        });

        // Spawn cliffs
        await this.worldRenderer.spawnCliffs(this.entityRenderer, false);

        console.log('[SceneEditor] Terrain rendering initialized');
    }

    /**
     * Render a single entity
     */
    async renderEntity(entityDef) {
        // Get prefab data
        const prefab = this.collections.prefabs?.[entityDef.prefab];
        if (!prefab) return;

        // Merge components
        const components = {
            ...(prefab.components || {}),
            ...(entityDef.components || {})
        };

        // Skip terrain entities (handled separately)
        if (components.terrain) return;

        // Check for renderable component
        if (components.renderable && this.entityRenderer) {
            const transform = components.transform || { position: { x: 0, y: 0, z: 0 } };
            const renderable = components.renderable;

            // Spawn entity using EntityRenderer
            await this.entityRenderer.spawnEntity(entityDef.id, {
                objectType: renderable.objectType,
                spawnType: renderable.spawnType,
                position: transform.position,
                rotation: transform.rotation,
                scale: transform.scale
            });
        }
    }

    /**
     * Clear world rendering
     */
    clearWorldRendering() {
        // Dispose WorldRenderer
        if (this.worldRenderer) {
            // Remove terrain meshes from scene but keep scene intact
            if (this.worldRenderer.groundMesh) {
                this.scene.remove(this.worldRenderer.groundMesh);
            }
            this.worldRenderer = null;
        }

        // Dispose EntityRenderer
        if (this.entityRenderer) {
            this.entityRenderer.dispose();
            this.entityRenderer = null;
        }

        this.terrainDataManager = null;
    }

    /**
     * Add a prefab to the scene
     */
    addPrefabToScene() {
        const prefabName = this.elements.addPrefabSelect?.value;
        if (!prefabName) return;

        const prefab = this.collections.prefabs?.[prefabName];
        if (!prefab) return;

        // Generate entity ID
        const entityId = `entity_${Date.now()}`;

        // Create entity definition
        const entityDef = {
            id: entityId,
            prefab: prefabName,
            name: prefab.title || prefabName,
            components: {}
        };

        // Add default transform if prefab has one
        if (prefab.components?.transform) {
            entityDef.components.transform = JSON.parse(JSON.stringify(prefab.components.transform));
        }

        // Add to scene data
        if (!this.state.sceneData) {
            this.state.sceneData = { entities: [] };
        }
        if (!this.state.sceneData.entities) {
            this.state.sceneData.entities = [];
        }

        this.state.sceneData.entities.push(entityDef);

        // Render the entity
        this.renderEntity(entityDef);

        // Update hierarchy
        this.renderHierarchy();

        // Mark as dirty and save
        this.state.isDirty = true;
        this.handleSave(false);

        // Select the new entity
        this.selectEntity(entityId);
    }

    /**
     * Remove the selected entity
     */
    removeSelectedEntity() {
        if (!this.state.selectedEntityId || !this.state.sceneData?.entities) return;

        const index = this.state.sceneData.entities.findIndex(e => e.id === this.state.selectedEntityId);
        if (index === -1) return;

        // Remove from scene data
        this.state.sceneData.entities.splice(index, 1);

        // Remove from 3D scene
        if (this.entityRenderer) {
            this.entityRenderer.removeEntity(this.state.selectedEntityId);
        }

        // Clear selection
        this.state.selectedEntityId = null;
        this.gizmoManager.detach();

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

        const entities = this.state.sceneData?.entities || [];

        for (const entity of entities) {
            const itemEl = document.createElement('div');
            itemEl.className = 'scene-editor__hierarchy-item';
            itemEl.dataset.entityId = entity.id;

            if (this.state.selectedEntityId === entity.id) {
                itemEl.classList.add('selected');
            }

            // Entity icon based on type
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
        // Update selection
        this.state.selectedEntityId = entityId;

        // Update hierarchy UI
        const prevSelected = this.elements.hierarchy?.querySelector('.selected');
        if (prevSelected) prevSelected.classList.remove('selected');

        const entityEl = this.elements.hierarchy?.querySelector(`[data-entity-id="${entityId}"]`);
        if (entityEl) entityEl.classList.add('selected');

        // Update inspector
        this.renderInspector();

        // Attach gizmo to entity's 3D object
        if (this.entityRenderer && entityId) {
            const entityObject = this.entityRenderer.getEntityObject(entityId);
            if (entityObject) {
                this.gizmoManager.attach(entityObject);
            } else {
                this.gizmoManager.detach();
            }
        } else {
            this.gizmoManager.detach();
        }
    }

    /**
     * Render the inspector panel for the selected entity
     */
    renderInspector() {
        if (!this.state.selectedEntityId) {
            if (this.elements.noSelection) this.elements.noSelection.style.display = 'block';
            if (this.elements.entityInspector) this.elements.entityInspector.style.display = 'none';
            return;
        }

        if (this.elements.noSelection) this.elements.noSelection.style.display = 'none';
        if (this.elements.entityInspector) this.elements.entityInspector.style.display = 'block';

        const entity = this.state.sceneData?.entities?.find(e => e.id === this.state.selectedEntityId);
        if (!entity) return;

        // Get merged components (prefab + overrides)
        const prefab = this.collections.prefabs?.[entity.prefab];
        const components = {
            ...(prefab?.components || {}),
            ...(entity.components || {})
        };

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

        // Render component fields
        this.renderComponentFields(componentEl, componentType, componentData, entity);

        this.elements.components.appendChild(componentEl);
    }

    /**
     * Render component fields recursively
     */
    renderComponentFields(container, componentType, data, entity, path = '') {
        if (typeof data !== 'object' || data === null) {
            // Primitive value
            this.renderPropertyField(container, path || componentType, data, (newValue) => {
                this.updateEntityComponent(entity, componentType, path, newValue);
            });
            return;
        }

        for (const [key, value] of Object.entries(data)) {
            const fieldPath = path ? `${path}.${key}` : key;

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Nested object (like position, rotation, scale)
                if ('x' in value || 'y' in value || 'z' in value) {
                    // Vector3 field
                    this.renderVector3Field(container, key, value, (newValue) => {
                        this.updateEntityComponent(entity, componentType, fieldPath, newValue);
                    });
                } else {
                    // Other nested objects
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
                // Primitive or array
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

        if (typeof value === 'boolean') {
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
     * Render a Vector3 field (position, rotation, scale)
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
     * Update an entity's component data
     */
    updateEntityComponent(entity, componentType, path, newValue) {
        // Ensure entity has component overrides
        if (!entity.components) entity.components = {};
        if (!entity.components[componentType]) {
            // Copy from prefab
            const prefab = this.collections.prefabs?.[entity.prefab];
            entity.components[componentType] = JSON.parse(JSON.stringify(prefab?.components?.[componentType] || {}));
        }

        // Update the value at the path
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

        // Update 3D representation
        this.updateEntity3D(entity);

        // Mark dirty and save
        this.state.isDirty = true;
        this.handleSave(false);
    }

    /**
     * Update an entity's 3D representation
     */
    updateEntity3D(entity) {
        if (!this.entityRenderer) return;

        const entityObject = this.entityRenderer.getEntityObject(entity.id);
        if (!entityObject) return;

        // Get merged transform
        const prefab = this.collections.prefabs?.[entity.prefab];
        const transform = {
            ...(prefab?.components?.transform || {}),
            ...(entity.components?.transform || {})
        };

        // Update position
        if (transform.position) {
            entityObject.position.set(
                transform.position.x || 0,
                transform.position.y || 0,
                transform.position.z || 0
            );
        }

        // Update rotation
        if (transform.rotation) {
            entityObject.rotation.set(
                transform.rotation.x || 0,
                transform.rotation.y || 0,
                transform.rotation.z || 0
            );
        }

        // Update scale
        if (transform.scale) {
            entityObject.scale.set(
                transform.scale.x || 1,
                transform.scale.y || 1,
                transform.scale.z || 1
            );
        }

        // Update gizmo
        if (this.state.selectedEntityId === entity.id) {
            this.gizmoManager.updateGizmoTransform();
        }
    }

    /**
     * Start the render loop
     */
    startRenderLoop() {
        const render = () => {
            this.animationFrameId = requestAnimationFrame(render);

            const delta = this.clock.getDelta();

            // Update controls
            if (this.controls) {
                this.controls.update();
            }

            // Update WorldRenderer if available
            if (this.worldRenderer) {
                this.worldRenderer.update(delta);
            }

            // Update gizmo
            if (this.gizmoManager?.targetObject) {
                this.gizmoManager.updateGizmoTransform();
            }

            // Render
            this.renderer.render(this.scene, this.camera);
        };

        render();
    }

    /**
     * Handle window/canvas resize
     */
    handleResize() {
        if (!this.canvas || !this.camera || !this.renderer) return;

        this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    }

    /**
     * Save scene data
     */
    handleSave(fireSave = false) {
        if (fireSave) {
            const saveEvent = new CustomEvent('saveSceneObject', {
                detail: {
                    data: this.state.sceneData,
                    propertyName: 'sceneData'
                },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(saveEvent);
        } else {
            // Update the JSON value in the editor
            const valueElement = this.gameEditor.elements?.editor?.querySelector('#sceneData-value');
            if (valueElement) {
                valueElement.value = JSON.stringify(this.state.sceneData, null, 2);
            }
        }
    }

    /**
     * Refresh scene rendering
     */
    async refreshScene(fireEvent = false) {
        await this.renderScene(this.state.sceneData);
        this.renderHierarchy();
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
     * Format a name for display
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
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        this.clearWorldRendering();

        if (this.gizmoManager) {
            this.gizmoManager.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
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
