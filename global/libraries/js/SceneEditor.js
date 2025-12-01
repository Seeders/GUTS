/**
 * SceneEditor - Unity-like scene editor for GUTS
 * Delegates all rendering to SceneEditorContext which uses actual game systems
 * Entities with components drive everything - no hardcoded rendering
 */
class SceneEditor {
    constructor(gameEditor, config, { ShapeFactory, SE_GizmoManager, ModelManager, GameState, ImageManager }) {
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
            addPrefabSelect: document.getElementById('scene-addPrefabSelect'),
            addPrefabBtn: document.getElementById('scene-addPrefabBtn'),
            removePrefabBtn: document.getElementById('scene-removePrefabBtn'),
        };

        // Editor context - handles all rendering via game systems
        this.editorContext = null;

        // Gizmo manager
        this.gizmoManager = new SE_GizmoManager();

        // Initialize
        this.initEventListeners();
        this.populatePrefabSelect();
    }

    /**
     * Initialize the editor context with game systems
     */
    async initializeContext() {
        if (this.state.initialized) return;

        // Create editor context
        this.editorContext = new GUTS.SceneEditorContext(this.gameEditor, this.canvas);

        // Initialize with systems needed for scene rendering
        await this.editorContext.initialize([
            'GridSystem',
            'TerrainSystem',
            'WorldSystem',
            'RenderSystem'
        ]);

        // Initialize gizmo manager with the editor context's scene/camera
        if (this.editorContext.worldSystem?.worldRenderer) {
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
        console.log('[SceneEditor] Context initialized');
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
     * Populate the prefab select dropdown
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

        // Initialize context if needed
        await this.initializeContext();

        // Load full scene into context - systems will detect entities and render
        await this.editorContext.loadScene(fullSceneData);

        // Render UI
        this.renderHierarchy();
        this.handleResize();
    }

    /**
     * Add a prefab to the scene
     */
    addPrefabToScene() {
        if (!this.editorContext) return;

        const prefabName = this.elements.addPrefabSelect?.value;
        if (!prefabName) return;

        const prefab = this.collections.prefabs?.[prefabName];
        if (!prefab) return;

        // Generate entity ID
        const entityId = `entity_${Date.now()}`;

        // Add entity via context - systems will render it
        this.editorContext.addEntityFromPrefab(prefabName, {
            id: entityId,
            name: prefab.title || prefabName
        });

        // Update entities array
        if (!this.state.entities) {
            this.state.entities = [];
        }

        const newEntity = {
            id: entityId,
            prefab: prefabName,
            name: prefab.title || prefabName,
            components: {}
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

        // Select the new entity
        this.selectEntity(entityId);
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
