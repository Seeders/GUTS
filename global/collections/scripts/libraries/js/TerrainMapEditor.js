class TerrainMapEditor {
    constructor(gameEditor, config = {}, { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory }) {
        this.gameEditor = gameEditor;
        this.engineClasses = { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory };
        this.defaultEditorSettings = { gridSize: 48, imageSize: 128, canvasWidth: 1536, canvasHeight: 768 };
        this.editorSettings = { ...this.defaultEditorSettings, ...config };

        this.defaultMapSize = 16;
        this.mapSize = this.defaultMapSize;
        this.currentTerrainId = 3; // Default to grass (index 3)
        this.currentHeightLevel = 0; // Default to height level 0
        this.isMouseDown = false;
        this.objectData = {};

        // Performance optimization: track last painted tile and debounce operations
        this.lastPaintedTile = null;
        this.exportDebounceTimer = null;
        this.isInitializing = false;

        // 3D Rendering Components
        this.worldRenderer = null;
        this.terrainDataManager = null;
        this.raycastHelper = null;
        this.mouseNDC = { x: 0, y: 0 }; // Normalized device coordinates
        this.animationFrameId = null;
        this.raycastIntervalId = null; // Interval for periodic raycasting
        this.cachedGridPosition = null; // Cached grid position from raycast
        this.mouseOverCanvas = false; // Track if mouse is over canvas
        this.isCameraControlActive = false; // Track if camera is being controlled
        this.entityRenderer = null; // Shared EntityRenderer for spawning cliffs and other entities
        this.placementPreview = null; // Placement preview for tile editing

        // Camera system (dual mode: scene/game)
        this.cameraMode = 'scene'; // 'scene' (perspective) or 'game' (orthographic)
        this.sceneCameraState = null; // Store perspective camera state
        this.gameCameraState = null; // Store orthographic camera state
        this.gameCameraWheelHandler = null; // Game camera zoom handler
        this.gameCameraMouseDownHandler = null;
        this.gameCameraMouseMoveHandler = null;
        this.gameCameraMouseUpHandler = null;

        // Gizmo system for entity manipulation
        this.gizmoManager = null;
        this.gizmoHelper = null; // Helper Object3D for gizmo attachment
        this.selectedEntityId = null; // Currently selected entity for gizmo manipulation

        // Level entities (unified array replacing worldObjects and entityPlacements)
        this.levelEntities = [];
        // Terrain map structure without explicit IDs
        this.tileMap = {
            size: 16,
            terrainBGColor: "#7aad7b",
            terrainTypes: [],
            terrainMap: [],
            heightMap: [],  // Height levels independent of terrain types
            extensionHeight: 0  // Height for extension area
        };
        this.worldObjects = this.tileMap.worldObjects || [];
        this.placementMode = 'terrain'; // can be 'terrain', 'ramp', 'height', or 'placements'
        this.terrainTool = 'brush'; // can be 'brush' or 'fill'
        this.brushSize = 1; // Default brush size (1x1)

        // Entity placements (starting locations, units, buildings)
        this.startingLocations = [];

        // Entity placement mode state (starts inactive)
        this.entityPlacementMode = {
            active: false,
            prefab: null,
            collection: null,
            spawnType: null
        };

        // Box selection state for entity selection
        this.boxSelection = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            element: null,
            useCanvasRelative: false
        };
        this.selectedEntities = []; // Array of selected entity IDs for multi-select

        this.entityPlacements = [];
        this.selectedPlacementType = null; // 'startingLocation', 'unit', 'building'
        this.selectedEntityType = null; // Specific unit/building type
        this.worldObjects = [];
        this.terrainTypesContainer = null;
        this.draggedItem = null;
        this.dragOverItem = null; // Track the item being dragged over

        // Undo/Redo functionality
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 50; // Limit undo history to prevent memory issues

        // DOM elements
        this.canvasEl = document.getElementById('grid');
        this.canvasEl.width = this.editorSettings.canvasWidth;
        this.canvasEl.height = this.editorSettings.canvasHeight;

        // Clear any inline styles to ensure CSS controls the display size
        this.canvasEl.style.width = '';
        this.canvasEl.style.height = '';

        // Managers and renderers - initialized by EditorLoader in initGridCanvas
        this.imageManager = null;
        this.modelManager = null;
        this.editorContext = null;
        this.editorLoader = null;

        this.translator = new GUTS.CoordinateTranslator(this.editorSettings, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);
        this.modalId = 'modal-addTerrainType';

        this.collections = this.gameEditor.getCollections();
        // Bind methods to maintain correct context
        this.init();
    }

    async init() {
        // Managers are now created by EditorLoader in initGridCanvas/init3DRendering
        this.setupTerrainTypesUI();
        this.setupTerrainImageProcessor();
        this.setupEventListeners();
        this.updateTerrainStyles();
        this.setupPlacementModeIndicator();
    }

    /**
     * Get collection ID from prefab name using objectTypeDefinitions
     * Maps singular prefab name (e.g., "worldObject") to collection ID (e.g., "worldObjects")
     * @param {string} prefabId - The prefab name (singular form)
     * @returns {string|null} The collection ID or null if not found
     */
    getCollectionFromPrefab(prefabId) {
        if (!prefabId) return null;
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};
        for (const [id, typeDef] of Object.entries(objectTypeDefinitions)) {
            if (typeDef.singular === prefabId) {
                return id;
            }
        }
        return null;
    }

    setupPlacementModeIndicator() {
        // Create placement mode indicator (hidden by default)
        const indicator = document.createElement('div');
        indicator.className = 'placement-mode-indicator';
        indicator.style.opacity = '0';
        indicator.textContent = 'Placement Mode: Terrain';
        document.querySelector('.editor-module__canvas-area').appendChild(indicator);
        this.placementModeIndicator = indicator;
    }

    setupEventListeners() {

        document.getElementById('terrainColor').addEventListener('change', (el) => {                    
            document.getElementById('terrainColorText').value = el.target.value;
        });
        document.getElementById('terrainTexture').addEventListener('change', (ev) => {
            const textureName = ev.target.value;
            if (textureName) {
                // Get terrain type ID and update in collections
                const terrainTypeId = this.tileMap.terrainTypes[this.currentTerrainId];
                const collections = this.gameEditor.getCollections();
                if (collections.terrainTypes && collections.terrainTypes[terrainTypeId]) {
                    collections.terrainTypes[terrainTypeId].texture = textureName;
                    const texture = this.gameEditor.getCollections().textures[textureName];
                    if (texture && texture.imagePath) {
                        const projectName = this.gameEditor.getCurrentProject();
                        const imageSrc = `/projects/${projectName}/resources/${texture.imagePath}`;
                        this.terrainImageProcessor.processImage(imageSrc);
                    }
                }
            }
        });
        document.getElementById('terrainMapSize').addEventListener('change', async (ev) => {    
            const newGridSize = parseInt(ev.target.value);
            const oldGridSize = this.tileMap.size;
            
            // Create a new map to hold the resized terrain
            const newTerrainMap = [];
            
            // Default terrain for new tiles (grass = index 3, or extension terrain type)
            const defaultTerrainId = this.tileMap.extensionTerrainType || 3;
            
            // Initialize with default terrain
            for (let i = 0; i < newGridSize; i++) {
                newTerrainMap.push(new Array(newGridSize).fill(defaultTerrainId));
            }
            
            // Copy existing terrain data if it exists
            if (this.tileMap.terrainMap && this.tileMap.terrainMap.length > 0) {
                // Simple approach: copy from top-left, expanding to the right and down
                for (let y = 0; y < Math.min(oldGridSize, newGridSize); y++) {
                    for (let x = 0; x < Math.min(oldGridSize, newGridSize); x++) {
                        if (this.tileMap.terrainMap[y] && this.tileMap.terrainMap[y][x] !== undefined) {
                            newTerrainMap[y][x] = this.tileMap.terrainMap[y][x];
                        }
                    }
                }
            }
            
            // Update tileMap with new terrain
            this.tileMap.terrainMap = newTerrainMap;
            this.tileMap.size = newGridSize;
            this.mapSize = newGridSize;
            this.translator = new GUTS.CoordinateTranslator(this.editorSettings, newGridSize, this.gameEditor.getCollections().configs.game.isIsometric);
            
            // Resize canvas to fit new map size
            this.updateCanvasSize();
            
            this.updateTerrainStyles();
            this.setupTerrainTypesUI();
            await this.initGridCanvas();
            this.exportMap();
        });
        document.getElementById('extensionTerrainType').addEventListener('change', (ev) => {    
            const newTerrainType = parseInt(ev.target.value);            
            this.tileMap.extensionTerrainType = newTerrainType;
            this.initGridCanvas();
            this.exportMap();
        });
        
        // Save button - manual save only
        document.getElementById('saveMapBtn').addEventListener('click', () => {
            this.exportMap();
            // Show feedback
            const btn = document.getElementById('saveMapBtn');
            const originalText = btn.textContent;
            btn.textContent = '✅ Saved!';
            btn.style.backgroundColor = '#10b981';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = 'var(--secondary)';
            }, 1500);
        });

        // Handle mouseup event (stop dragging and camera control)
        document.addEventListener('mouseup', (e) => {
            this.isMouseDown = false;
            this.lastPaintedTile = null; // Reset for next paint operation

            // Reset camera control flag for any button release
            if (e.button === 1 || e.button === 2) {
                this.isCameraControlActive = false;
            }
        });

        // Add mouse down event for canvas
        this.canvasEl.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                // Check if entity placement mode is active
                if (this.entityPlacementMode?.active) {
                    this.placeEntityAtMouse();
                    return;
                }

                // In placements mode without active placement, start box selection
                if (this.placementMode === 'placements') {
                    this.startBoxSelection(e);
                    return;
                }

                this.isMouseDown = true;
                // Immediately trigger raycast and painting for instant click response
                // The raycast interval will continue handling during drag operations
                this.updateGridPositionFromRaycast();
            } else if (e.button === 1 || e.button === 2) { // Middle or right click - camera controls
                this.isCameraControlActive = true;
                // Hide preview during camera movement
                if (this.placementPreview) {
                    this.placementPreview.hide();
                }
            }
        });

        // Add mouse move event to update NDC coordinates
        this.canvasEl.addEventListener('mousemove', (e) => {
            // Just update normalized device coordinates - raycasting happens on interval
            const rect = this.canvasEl.getBoundingClientRect();
            this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.mouseOverCanvas = true;

            // Update box selection if active
            if (this.boxSelection.active) {
                this.updateBoxSelection(e);
            }
        });

        // Add mouse up event to complete box selection
        this.canvasEl.addEventListener('mouseup', (e) => {
            if (e.button === 0 && this.boxSelection.active) {
                this.completeBoxSelection(e);
            }
        });

        // Add mouse leave event to clear placement preview
        this.canvasEl.addEventListener('mouseleave', () => {
            this.mouseOverCanvas = false;
            this.cachedGridPosition = null;
            // Hide 3D placement preview
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
        });

        // Add keyboard shortcuts for undo/redo and escape
        document.addEventListener('keydown', (event) => {
            // Escape - cancel box selection or entity placement
            if (event.key === 'Escape') {
                if (this.boxSelection.active) {
                    this.cancelBoxSelection();
                } else if (this.entityPlacementMode?.active) {
                    this.cancelEntityPlacementMode();
                } else if (this.selectedEntityId) {
                    this.deselectEntity();
                }
            }
            // Undo: Ctrl+Z (or Cmd+Z on Mac)
            else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
                event.preventDefault();
                this.undo();
            }
            // Redo: Ctrl+Shift+Z or Ctrl+Y (or Cmd+Shift+Z / Cmd+Y on Mac)
            else if ((event.ctrlKey || event.metaKey) && (event.shiftKey && event.key === 'z' || event.key === 'y')) {
                event.preventDefault();
                this.redo();
            }
        });

        // Gizmo mode buttons
        document.getElementById('te-translate-tool')?.addEventListener('click', () => {
            this.setGizmoMode('translate');
            this.updateGizmoToolbarUI('te-translate-tool');
        });
        document.getElementById('te-rotate-tool')?.addEventListener('click', () => {
            this.setGizmoMode('rotate');
            this.updateGizmoToolbarUI('te-rotate-tool');
        });
        document.getElementById('te-scale-tool')?.addEventListener('click', () => {
            this.setGizmoMode('scale');
            this.updateGizmoToolbarUI('te-scale-tool');
        });

        // Camera toggle and rotation buttons
        document.getElementById('te-camera-toggle')?.addEventListener('click', () => {
            this.toggleCamera();
        });
        document.getElementById('te-camera-rotate-left')?.addEventListener('click', () => {
            this.rotateGameCamera('left');
        });
        document.getElementById('te-camera-rotate-right')?.addEventListener('click', () => {
            this.rotateGameCamera('right');
        });

        // Remove entity button
        document.getElementById('te-remove-entity-btn')?.addEventListener('click', () => {
            this.removeSelectedEntity();
        });

        // Handle unloadTileMap event when switching away from this editor
        document.body.addEventListener('unloadTileMap', () => {
            this.handleUnload();
        });

        // Handle editTileMap event
        document.body.addEventListener('editTileMap', async (event) => {
            this.tileMap = event.detail.data;
            this.objectData = event.detail.objectData;
            this.savePropertyName = event.detail.propertyName;
            const world = this.objectData.world ? this.gameEditor.getCollections().worlds[this.objectData.world] : null;
            this.worldObjects = {};
            if(world){
                const worldObjectNames = world.worldObjects || [];
                worldObjectNames.forEach((objectName) => {
                    this.worldObjects[objectName] = this.gameEditor.getCollections().worldObjects[objectName];
                });
            }
            this.canvasEl.width = this.editorSettings.canvasWidth;
            this.canvasEl.height = this.editorSettings.canvasHeight;

            // Clear any inline styles to ensure CSS controls the display size
            this.canvasEl.style.width = '';
            this.canvasEl.style.height = '';

            //this.gameEditor.setColorValue(document.getElementById('terrainBGColorContainer'), this.tileMap.terrainBGColor || "#7aad7b");
            const collections = this.gameEditor.getCollections();
            if(this.tileMap.extensionTerrainType !== undefined){
                const terrainTypeId = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType];
                const terrainType = collections.terrainTypes?.[terrainTypeId];
                this.canvasEl.backgroundColor = terrainType?.color || "#7aad7b";
            } else {
                const defaultIndex = 4; // Default to grass if not set
                const terrainTypeId = this.tileMap.terrainTypes[defaultIndex];
                const terrainType = collections.terrainTypes?.[terrainTypeId];
                this.canvasEl.backgroundColor = terrainType?.color || "#7aad7b";
                this.tileMap.extensionTerrainType = defaultIndex;
            }

            // Load placements data
            this.startingLocations = this.tileMap.startingLocations || [];

            // Note: levelEntities are synced from ECS in init3DRendering via syncLevelEntitiesFromECS()
            // The ECS entities are spawned by TerrainSystem, we just track references to them

            // Load or initialize heightMap from objectData
            if (this.objectData.heightMap) {
                this.tileMap.heightMap = this.objectData.heightMap;
                this.tileMap.extensionHeight = this.objectData.extensionHeight || 0;
            } else if (!this.tileMap.heightMap) {
                // Initialize heightMap if it doesn't exist
                this.tileMap.heightMap = [];
                this.tileMap.extensionHeight = this.tileMap.extensionTerrainType || 0;
            }
            const extensionTerrainTypeSelector = document.getElementById('extensionTerrainType');
            // Build extension terrain type dropdown from terrain type IDs
            this.tileMap.terrainTypes.forEach((terrainTypeId, index) => {
                const terrainType = collections.terrainTypes?.[terrainTypeId];
                if (terrainType) {
                    const newOption = document.createElement('option');
                    newOption.value = index;
                    newOption.textContent = terrainType.type;
                    if (index === this.tileMap.extensionTerrainType) {
                        newOption.selected = true;
                    }
                    extensionTerrainTypeSelector.appendChild(newOption);
                }
            });
        
            // No need to remap terrainMap; assume it already uses indices matching the order
            // If terrainMap has invalid indices, clamp them to valid range
            if (this.tileMap.terrainMap && this.tileMap.terrainMap.length > 0) {
                const maxIndex = this.tileMap.terrainTypes.length - 1;
                for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
                    for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                        const currentValue = this.tileMap.terrainMap[y][x];
                        if (currentValue > maxIndex || currentValue < 0) {
                            this.tileMap.terrainMap[y][x] = 0; // Clamp invalid values to 0
                        }
                    }
                }
            }
            
            // Update grid size from tilemap data
            if (this.tileMap.size) {
                this.mapSize = this.tileMap.size;
            } else {
                this.mapSize = this.defaultMapSize;
            }

            // Initialize heightMap data if empty
            if (!this.tileMap.heightMap || this.tileMap.heightMap.length === 0) {
                this.tileMap.heightMap = [];
                for (let y = 0; y < this.mapSize; y++) {
                    this.tileMap.heightMap[y] = [];
                    for (let x = 0; x < this.mapSize; x++) {
                        // Default to deriving height from terrain type (backwards compatibility)
                        if (this.tileMap.terrainMap && this.tileMap.terrainMap[y] && this.tileMap.terrainMap[y][x] !== undefined) {
                            this.tileMap.heightMap[y][x] = this.tileMap.terrainMap[y][x];
                        } else {
                            this.tileMap.heightMap[y][x] = 0;
                        }
                    }
                }
            }

            // Always recreate translator with current map size
            this.translator = new GUTS.CoordinateTranslator(this.editorSettings, this.mapSize, this.gameEditor.getCollections().configs.game.isIsometric);

            document.getElementById('terrainMapSize').value = this.mapSize;
            
            // Resize canvas to fit map size
            this.updateCanvasSize();
            
            // Load terrain types if provided
            this.updateTerrainStyles();
            this.setupTerrainTypesUI();
            
            // Wait for next frame to ensure DOM is updated, then initialize
            await new Promise(resolve => requestAnimationFrame(resolve));
            await this.initGridCanvas();
        });

        // Mode dropdown handler
        const modeSelect = document.getElementById('te-mode-select');
        if (modeSelect) {
            modeSelect.addEventListener('change', (e) => {
                this.setEditorMode(e.target.value);
            });
        }

        // Initialize to default mode
        this.setEditorMode('entities');

        // Clear all ramps button
        document.getElementById('clear-all-ramps-btn').addEventListener('click', () => {
            if (this.tileMap.ramps) {
                this.tileMap.ramps = [];
                this.updateRampCount();
            }
        });

        // Height level input
        document.getElementById('heightLevel').addEventListener('change', (e) => {
            this.currentHeightLevel = parseInt(e.target.value);
            this.placementModeIndicator.textContent = `Painting Height Level: ${this.currentHeightLevel}`;
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });

        // Global brush size slider
        document.getElementById('globalBrushSize').addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            document.getElementById('globalBrushSizeValue').textContent = this.brushSize;
        });

        // Global tool buttons
        document.getElementById('globalBrushBtn').addEventListener('click', () => {
            this.terrainTool = 'brush';
            document.getElementById('globalBrushBtn').classList.add('editor-module__btn--active');
            document.getElementById('globalFillBtn').classList.remove('editor-module__btn--active');
        });

        document.getElementById('globalFillBtn').addEventListener('click', () => {
            this.terrainTool = 'fill';
            document.getElementById('globalFillBtn').classList.add('editor-module__btn--active');
            document.getElementById('globalBrushBtn').classList.remove('editor-module__btn--active');
        });

        this.canvasEl.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Prevent default context menu

        });
    }

    async initImageManager() {
        let palette = this.gameEditor.getPalette();

        // Use the editorContext's imageManager (created by EditorLoader)
        // If editorContext doesn't exist yet, initGridCanvas will create it
        if (!this.imageManager && this.editorContext) {
            this.imageManager = this.editorContext.imageManager;
            this.modelManager = this.editorContext.modelManager;
        }

        // Reload terrain images
        await this.imageManager.loadImages("levels", { level: this.objectData }, false, false);
        if (this.worldObjects) {
            await this.imageManager.loadImages("environment", this.worldObjects, false, false);
        }
        const terrainImages = this.imageManager.getImages("levels", "level");

        this.terrainTileMapper = new GUTS.TileMap({});
        if (!this.terrainCanvasBuffer) {
            this.terrainCanvasBuffer = document.createElement('canvas');
        }
        this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
        this.terrainCanvasBuffer.height = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;

        // Models are already loaded by EditorLoader
        const terrainTypeNames = this.tileMap.terrainTypes || [];
        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.gameEditor.getCollections().configs.game.gridSize, terrainImages, this.gameEditor.getCollections().configs.game.isIsometric, { terrainTypeNames });

        // Ensure translator is up to date before creating game object
        this.translator = new GUTS.CoordinateTranslator(this.editorSettings, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);

        this.game = {
            state: {},
            modelManager: this.modelManager,
            imageManager: this.imageManager,
            canvasBuffer: this.canvasEl,
            terrainCanvasBuffer: this.terrainCanvasBuffer,
            terrainTileMapper: this.terrainTileMapper,
            getCollections: this.gameEditor.getCollections.bind(this.gameEditor),
            translator: this.translator
        };

        this.mapRenderer = new GUTS.MapRenderer(this.game, null);
        this.mapRenderer.init({
            environment: this.worldObjects,
            level: 'level',
            levelData: this.objectData,
            isEditor: true,
            palette: palette,
            canvas: this.canvasEl
        });

        // Give the renderer a moment to fully initialize
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    setupTerrainImageProcessor() {
        this.terrainImageProcessor = new GUTS.TerrainImageProcessor();
        this.terrainImageProcessor.initialize(
            document.getElementById('terrain-image-display')
        );
    }

    setupTerrainTypesUI() {
        const terrainsPanel = document.getElementById('terrainsPanel');
        const existingColorPicker = terrainsPanel.querySelector('.terrain-types-container');
        if (existingColorPicker) {
            terrainsPanel.removeChild(existingColorPicker);
        }
    
        this.terrainTypesContainer = document.createElement('div');
        this.terrainTypesContainer.className = 'terrain-types-container';
        const addNewBtn = document.createElement('button');
        addNewBtn.className = 'add-terrain-btn';
        addNewBtn.innerHTML = '+ Add Layer';
        addNewBtn.addEventListener('click', this.showAddTerrainForm.bind(this));
        this.terrainTypesContainer.appendChild(addNewBtn);

        // Get terrain type definitions from collections
        const collections = this.gameEditor.getCollections();

        this.tileMap.terrainTypes.forEach((terrainTypeId, index) => {
            // Look up terrain type definition from collections
            const terrain = collections.terrainTypes?.[terrainTypeId];
            if (!terrain) {
                console.warn(`Terrain type ${terrainTypeId} not found in collections`);
                return;
            }

            const terrainItem = document.createElement('div');
            terrainItem.className = 'terrain-editor__terrain-item';
            terrainItem.draggable = true;
            terrainItem.dataset.index = index;

            terrainItem.addEventListener('dragstart', this.handleDragStart.bind(this));
            terrainItem.addEventListener('dragover', this.handleDragOver.bind(this));
            terrainItem.addEventListener('drop', this.handleDrop.bind(this));
            terrainItem.addEventListener('dragend', this.handleDragEnd.bind(this));
            terrainItem.addEventListener('dragenter', this.handleDragEnter.bind(this));
            terrainItem.addEventListener('dragleave', this.handleDragLeave.bind(this));

            const option = document.createElement('div');
            option.className = 'terrain-editor__color-option';
            option.dataset.index = index;
            option.dataset.type = terrain.type;
            option.style.backgroundColor = terrain.color;

            if (index === this.currentTerrainId) {
                option.classList.add('active');
            }

            option.addEventListener('click', () => {
                document.querySelectorAll('.terrain-editor__color-option').forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                this.currentTerrainId = parseInt(option.dataset.index);
            });

            const label = document.createElement('div');
            label.className = 'terrain-label';
            label.textContent = terrain.type;
    
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'terrain-buttons';
    
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-terrain-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit terrain';
            editBtn.addEventListener('click', () => this.showTerrainEditForm(index));
            buttonContainer.appendChild(editBtn);
    
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-terrain-btn';
            deleteBtn.innerHTML = '❌';
            deleteBtn.title = 'Delete terrain';
            deleteBtn.addEventListener('click', () => this.deleteTerrain(index));
            buttonContainer.appendChild(deleteBtn);
    
            terrainItem.appendChild(option);
            terrainItem.appendChild(label);
            terrainItem.appendChild(buttonContainer);
    
            this.terrainTypesContainer.appendChild(terrainItem);
        });
    

    
        terrainsPanel.appendChild(this.terrainTypesContainer);
    
        document.getElementById('saveTerrainBtn').addEventListener('click', this.saveTerrainType.bind(this));
        document.getElementById('cancelTerrainBtn').addEventListener('click', this.hideTerrainForm.bind(this));
    }

    setupHeightLevelsUI() {
        const buttonsContainer = document.getElementById('heightLevelButtons');
        if (!buttonsContainer) return;

        // Clear existing buttons
        buttonsContainer.innerHTML = '';

        // Create height level buttons (0-10)
        for (let level = 0; level <= 10; level++) {
            const button = document.createElement('button');
            button.className = 'editor-module__btn editor-module__btn--small terrain-editor__height-btn';
            button.textContent = `Level ${level}`;
            button.dataset.heightLevel = level;

            // Highlight current level
            if (level === this.currentHeightLevel) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                this.currentHeightLevel = level;
                document.getElementById('heightLevel').value = level;

                // Update active states
                buttonsContainer.querySelectorAll('.terrain-editor__height-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                button.classList.add('active');

                // Update indicator
                this.placementModeIndicator.textContent = `Painting Height Level: ${level}`;
                this.placementModeIndicator.style.opacity = '1';

                // Hide indicator after a delay
                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 2000);
            });

            buttonsContainer.appendChild(button);
        }
    }

    /**
     * Get available prefabs by finding objectTypeDefinitions with objectTypeCategory: "prefabs"
     * Then match each to its prefab via the singular name
     */
    getAvailablePrefabs() {
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};
        const prefabs = this.collections.prefabs || {};
        const availablePrefabs = [];

        for (const [typeId, typeDef] of Object.entries(objectTypeDefinitions)) {
            // Only include collections marked as "prefabs" category
            if (typeDef.objectTypeCategory !== 'prefabs') continue;

            // The singular name should match a prefab name (e.g., "unit" matches prefab "unit")
            const prefabId = typeDef.singular;
            const prefabData = prefabs[prefabId];

            // Verify the prefab exists
            if (!prefabData) continue;

            availablePrefabs.push({
                id: prefabId,
                title: typeDef.name || prefabId,
                collection: typeId
            });
        }

        return availablePrefabs;
    }

    /**
     * Setup the entity placements panel with prefab-based UI
     */
    setupPlacementsPanel() {
        // Get available prefabs
        this.availablePrefabs = this.getAvailablePrefabs();

        // Setup prefab select dropdown
        const collectionSelect = document.getElementById('te-collection-select');
        if (collectionSelect) {
            collectionSelect.innerHTML = '';

            for (const prefab of this.availablePrefabs) {
                const option = document.createElement('option');
                option.value = prefab.id;
                option.textContent = prefab.title;
                option.dataset.collection = prefab.collection;
                collectionSelect.appendChild(option);
            }

            // Listen for changes
            collectionSelect.addEventListener('change', () => {
                this.populateSpawnTypeGrid();
                this.cancelEntityPlacementMode();
                this.updateEntityHierarchy(); // Refresh filtered entity list
            });
        }

        // Populate spawn type grid for the first prefab
        this.populateSpawnTypeGrid();

        // Update the entity hierarchy list
        this.updateEntityHierarchy();
    }

    /**
     * Populate the spawn type grid based on selected prefab's collection
     */
    populateSpawnTypeGrid() {
        const spawnTypeGrid = document.getElementById('te-spawn-type-grid');
        if (!spawnTypeGrid) return;

        spawnTypeGrid.innerHTML = '';

        const collectionSelect = document.getElementById('te-collection-select');
        const prefabId = collectionSelect?.value;
        if (!prefabId) return;

        // Get the collection name from objectTypeDefinitions (singular -> id mapping)
        const collectionId = this.getCollectionFromPrefab(prefabId);
        if (!collectionId) return;

        const collectionData = this.collections[collectionId] || {};
        const icons = this.collections.icons || {};

        for (const [itemId, itemData] of Object.entries(collectionData)) {
            const item = document.createElement('div');
            item.className = 'editor-module__grid-item';
            item.dataset.prefab = prefabId;
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
                this.activateEntityPlacementMode(prefabId, collectionId, itemId);
                // Update selection UI
                spawnTypeGrid.querySelectorAll('.editor-module__grid-item').forEach(el => {
                    el.classList.remove('editor-module__grid-item--selected');
                });
                item.classList.add('editor-module__grid-item--selected');
            });

            spawnTypeGrid.appendChild(item);
        }
    }

    /**
     * Update the entity hierarchy list with placed entities
     */
    updateEntityHierarchy() {
        const hierarchyList = document.getElementById('te-entity-hierarchy');
        if (!hierarchyList) return;

        hierarchyList.innerHTML = '';

        // Get the currently selected prefab's collection to filter by
        const collectionSelect = document.getElementById('te-collection-select');
        const selectedPrefabId = collectionSelect?.value;
        const filterCollection = this.getCollectionFromPrefab(selectedPrefabId);

        // Filter entities by selected collection
        const filteredEntities = filterCollection
            ? (this.levelEntities || []).filter(e => e.collection === filterCollection)
            : (this.levelEntities || []);

        // Update entity count badge (show filtered count)
        const countEl = document.getElementById('te-entity-count');
        if (countEl) {
            countEl.textContent = filteredEntities.length;
        }

        if (filteredEntities.length === 0) {
            const noEntitiesMsg = filterCollection
                ? `No ${filterCollection} placed`
                : 'No entities placed';
            hierarchyList.innerHTML = `<div class="te-hint" style="padding: 8px;">${noEntitiesMsg}</div>`;
            return;
        }

        // Group entities by spawnType + collection
        const groups = {};
        for (const entity of filteredEntities) {
            const key = `${entity.spawnType || 'Unknown'}|${entity.collection || ''}`;
            if (!groups[key]) {
                groups[key] = {
                    spawnType: entity.spawnType || 'Unknown',
                    collection: entity.collection || '',
                    entities: []
                };
            }
            groups[key].entities.push(entity);
        }

        // Sort groups by count (descending)
        const sortedGroups = Object.values(groups).sort((a, b) => b.entities.length - a.entities.length);

        // Render grouped hierarchy
        for (const group of sortedGroups) {
            const groupKey = `${group.spawnType}|${group.collection}`;
            const isExpanded = this.expandedEntityGroups?.[groupKey] ?? false;

            // Group header (folder)
            const folder = document.createElement('div');
            folder.className = 'te-entity-folder';
            folder.innerHTML = `
                <span class="te-entity-folder__toggle">${isExpanded ? '▼' : '▶'}</span>
                <span class="te-entity-folder__name">${group.spawnType}</span>
                <span class="te-entity-folder__collection">(${group.collection})</span>
                <span class="te-entity-folder__count">${group.entities.length}</span>
            `;
            folder.addEventListener('click', () => {
                this.toggleEntityGroup(groupKey);
            });
            hierarchyList.appendChild(folder);

            // Group contents (entities) - only if expanded
            if (isExpanded) {
                const contents = document.createElement('div');
                contents.className = 'te-entity-folder__contents';

                for (const entity of group.entities) {
                    const item = document.createElement('div');
                    item.className = 'editor-module__item te-entity-item';
                    item.dataset.entityId = entity.id;

                    // Highlight if selected
                    if (this.selectedLevelEntity && this.selectedLevelEntity.id === entity.id) {
                        item.classList.add('editor-module__item--selected');
                    }

                    // Show position as identifier
                    const pos = entity.components?.transform?.position;
                    const posStr = pos ? `(${Math.round(pos.x)}, ${Math.round(pos.z)})` : '';
                    item.innerHTML = `<span class="te-entity-item__pos">${posStr}</span>`;

                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectLevelEntity(entity);
                    });

                    contents.appendChild(item);
                }

                hierarchyList.appendChild(contents);
            }
        }
    }

    /**
     * Toggle entity group expanded/collapsed state
     */
    toggleEntityGroup(groupKey) {
        if (!this.expandedEntityGroups) {
            this.expandedEntityGroups = {};
        }
        this.expandedEntityGroups[groupKey] = !this.expandedEntityGroups[groupKey];
        this.updateEntityHierarchy();
    }

    /**
     * Cancel entity placement mode
     */
    cancelEntityPlacementMode() {
        this.entityPlacementMode = {
            active: false,
            prefab: null,
            collection: null,
            spawnType: null
        };

        // Clear selection UI
        const spawnTypeGrid = document.getElementById('te-spawn-type-grid');
        spawnTypeGrid?.querySelectorAll('.editor-module__grid-item').forEach(el => {
            el.classList.remove('editor-module__grid-item--selected');
        });

        // Hide preview if any
        if (this.placementPreview) {
            this.placementPreview.hide();
        }

        console.log('[TerrainMapEditor] Entity placement mode cancelled');
    }

    /**
     * Set the editor mode (terrains, heights, ramps, entities)
     * @param {string} mode - The mode to switch to
     */
    setEditorMode(mode) {
        // Hide all panels
        const panels = ['terrainsPanel', 'heightsPanel', 'rampsPanel', 'placementsPanel'];
        panels.forEach(panelId => {
            const panel = document.getElementById(panelId);
            if (panel) panel.style.display = 'none';
        });

        // Show/hide tool section based on mode
        const toolSection = document.getElementById('te-tool-section');
        if (toolSection) {
            // Tool section is relevant for terrains, heights modes
            toolSection.style.display = ['terrains', 'heights'].includes(mode) ? 'block' : 'none';
        }

        // Handle mode-specific logic
        switch (mode) {
            case 'terrains':
                document.getElementById('terrainsPanel').style.display = 'block';
                this.placementMode = 'terrain';
                break;

            case 'heights':
                document.getElementById('heightsPanel').style.display = 'block';
                this.placementMode = 'height';
                this.setupHeightLevelsUI();
                break;

            case 'ramps':
                document.getElementById('rampsPanel').style.display = 'block';
                this.placementMode = 'ramp';
                this.updateRampCount();
                break;

            case 'entities':
                document.getElementById('placementsPanel').style.display = 'block';
                this.placementMode = 'placements';
                this.setupPlacementsPanel();
                break;
        }

        // Update dropdown to match (in case called programmatically)
        const modeSelect = document.getElementById('te-mode-select');
        if (modeSelect && modeSelect.value !== mode) {
            modeSelect.value = mode;
        }

        // Show mode indicator briefly
        if (this.placementModeIndicator) {
            const modeNames = {
                terrains: 'Terrain',
                heights: 'Heights',
                ramps: 'Ramps',
                entities: 'Entities'
            };
            this.placementModeIndicator.textContent = `Mode: ${modeNames[mode] || mode}`;
            this.placementModeIndicator.style.opacity = '1';

            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        }
    }

    updateStartingLocationsList(listElement) {
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.startingLocations.length === 0) {
            listElement.innerHTML = '<p class="editor-module__info-text">No starting locations placed</p>';
            return;
        }

        this.startingLocations.forEach((loc, index) => {
            const item = document.createElement('div');
            item.className = 'terrain-editor__placement-item';
            item.innerHTML = `
                <span>${loc.side} team at (${loc.gridX}, ${loc.gridZ})</span>
                <button class="editor-module__btn editor-module__btn--small editor-module__btn--danger" data-index="${index}">Remove</button>
            `;

            item.querySelector('button').addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.startingLocations.splice(idx, 1);
                this.updateStartingLocationsList(listElement);
                this.exportMap();
            });

            listElement.appendChild(item);
        });
    }

    // Improved drag and drop handlers
    handleDragStart(e) {
        this.draggedItem = e.currentTarget;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.draggedItem.outerHTML);
        this.draggedItem.classList.add('dragging');
        this.draggedTerrainId = parseInt(this.draggedItem.dataset.index);
    }
    
    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const dropTarget = e.currentTarget;
        dropTarget.classList.remove('drag-over');
    
        if (this.draggedItem !== dropTarget && dropTarget.classList.contains('terrain-editor__terrain-item')) {
            const allItems = Array.from(this.terrainTypesContainer.querySelectorAll('.terrain-editor__terrain-item'));
            const draggedIndex = allItems.indexOf(this.draggedItem);
            const dropIndex = allItems.indexOf(dropTarget);
    
            if (draggedIndex !== -1 && dropIndex !== -1) {
                // Store a copy of the original terrain types for reference
                const oldTerrainTypes = [...this.tileMap.terrainTypes];

                // Reorder terrain types
                const draggedTerrain = this.tileMap.terrainTypes[draggedIndex];
                this.tileMap.terrainTypes.splice(draggedIndex, 1);
                this.tileMap.terrainTypes.splice(dropIndex, 0, draggedTerrain);

                // Create mapping between old and new indices
                const indexMap = {};
                oldTerrainTypes.forEach((terrainTypeId, oldIndex) => {
                    const newIndex = this.tileMap.terrainTypes.findIndex(t => t === terrainTypeId);
                    indexMap[oldIndex] = newIndex;
                });
    
                // Update terrain map with new indices
                if (this.tileMap.terrainMap && this.tileMap.terrainMap.length > 0) {
                    const maxIndex = this.tileMap.terrainTypes.length - 1;
                    for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
                        for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                            const oldIndex = this.tileMap.terrainMap[y][x];
                            const newIndex = indexMap[oldIndex] !== undefined ? indexMap[oldIndex] : 0;
                            this.tileMap.terrainMap[y][x] = Math.min(newIndex, maxIndex);
                        }
                    }
                }
    
                // Update UI order
                if (draggedIndex < dropIndex) {
                    dropTarget.parentNode.insertBefore(this.draggedItem, dropTarget.nextSibling);
                } else {
                    dropTarget.parentNode.insertBefore(this.draggedItem, dropTarget);
                }
    
                // Update current terrain ID if needed
                if (this.currentTerrainId === draggedIndex) {
                    this.currentTerrainId = dropIndex;
                } else if (this.currentTerrainId === dropIndex) {
                    this.currentTerrainId = draggedIndex;
                }
    
                // Force a complete refresh of the rendering pipeline
                // Clear any cached images or renderers
                this.terrainTileMapper = null;
                this.mapRenderer = null;
                this.imageManager = null;
                this.updateTerrainStyles();
                this.setupTerrainTypesUI();

                await this.initImageManager();
                this.exportMap();
            }
        }
        return false;
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }
    
    // Add visual feedback when dragging over items
    handleDragEnter(e) {
        e.preventDefault();
        // Only add highlight if dragging over another terrain item (not itself)
        if (e.currentTarget !== this.draggedItem) {
            e.currentTarget.classList.add('drag-over');
            this.dragOverItem = e.currentTarget;
        }
    }
    
    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        if (this.dragOverItem === e.currentTarget) {
            this.dragOverItem = null;
        }
    }
   
    
    handleDragEnd(e) {
        // Clean up all drag-related classes
        this.draggedItem.classList.remove('dragging');
        document.querySelectorAll('.terrain-editor__terrain-item').forEach(item => {
            item.classList.remove('drag-over');
        });
        this.draggedItem = null;
        this.dragOverItem = null;
    }

    showAddTerrainForm() {
        const form = document.getElementById(this.modalId);
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Add Terrain Type';
        document.getElementById('editingId').value = ''; // New form field for ID
        document.getElementById('terrainType').value = '';
        document.getElementById('terrainColor').value = '#cccccc';
        document.getElementById('terrainColorText').value = '#cccccc';
        document.getElementById('terrainBuildable').checked = false;
        document.getElementById('terrainWalkable').checked = true;
    }

    showTerrainEditForm(index) {
        const terrainTypeId = this.tileMap.terrainTypes[index];
        const collections = this.gameEditor.getCollections();
        const terrain = collections.terrainTypes?.[terrainTypeId];

        if (!terrain) {
            alert('Terrain type not found in collections');
            return;
        }

        this.currentTerrainId = index; // Set current terrain ID for later use
        const form = document.getElementById(this.modalId);
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Edit Terrain Type';
        document.getElementById('terrainType').value = terrain.type;
        document.getElementById('terrainColor').value = terrain.color;
        document.getElementById('terrainColorText').value = terrain.color;
        document.getElementById('terrainBuildable').checked = terrain.buildable;
        document.getElementById('terrainWalkable').checked = terrain.walkable !== false;
        const terrainTextureEl = document.getElementById('terrainTexture');
        terrainTextureEl.innerHTML = ''; // Clear existing options

        for(let textureName in collections.textures){
            const texture = collections.textures[textureName];
            const option = document.createElement('option');
            option.value = textureName;
            option.textContent = texture.title;

            if( textureName === terrain.texture) {
                option.selected = true; // Set the current terrain texture as selected
            }
            terrainTextureEl.appendChild(option);
        }

        // Load the current texture image if the terrain has a texture assigned
        if (terrain.texture && collections.textures[terrain.texture]) {
            const texture = collections.textures[terrain.texture];
            if (texture.imagePath) {
                const projectName = this.gameEditor.getCurrentProject();
                const imageSrc = `/projects/${projectName}/resources/${texture.imagePath}`;
                this.terrainImageProcessor.processImage(imageSrc);
            }
        }
    }

    hideTerrainForm() {
        document.getElementById(this.modalId).classList.remove('show');
    }

    saveTerrainType() {
        const newType = document.getElementById('terrainType').value.trim();
        const newColor = document.getElementById('terrainColorText').value;
        const newTexture = document.getElementById('terrainTexture').value;
        const newBuildable = document.getElementById('terrainBuildable').checked;
        const newWalkable = document.getElementById('terrainWalkable').checked;

        if (!newType) {
            alert('Terrain type cannot be empty');
            return;
        }

        // Get or create collections.terrainTypes
        const collections = this.gameEditor.getCollections();
        if (!collections.terrainTypes) {
            collections.terrainTypes = {};
        }

        if (this.currentTerrainId !== '') {
            // Editing existing terrain (using index as identifier)
            const index = this.currentTerrainId;
            const oldTypeId = this.tileMap.terrainTypes[index];

            if (index >= 0 && index < this.tileMap.terrainTypes.length) {
                // Check if changing to a different type name that already exists
                if (newType !== oldTypeId && this.tileMap.terrainTypes.includes(newType)) {
                    alert('A terrain type with this name already exists');
                    return;
                }

                // If type name changed, update the ID in the array
                this.tileMap.terrainTypes[index] = newType;

                // Delete old entry if name changed
                if (newType !== oldTypeId) {
                    delete collections.terrainTypes[oldTypeId];
                }
            }
        } else {
            // Adding new terrain
            if (this.tileMap.terrainTypes.includes(newType)) {
                alert('A terrain type with this name already exists');
                return;
            }
            this.tileMap.terrainTypes.push(newType);
        }

        // Save the full terrain type definition to collections
        collections.terrainTypes[newType] = {
            type: newType,
            texture: newTexture,
            color: newColor,
            buildable: newBuildable,
            walkable: newWalkable
        };

        this.updateTerrainStyles();
        this.setupTerrainTypesUI();
        this.hideTerrainForm();
        this.initGridCanvas();
        this.exportMap();
    }

    deleteTerrain(indexToDelete) {
        if (this.tileMap.terrainTypes.length <= 1) {
            alert('Cannot delete the last terrain type');
            return;
        }

        const terrainTypeId = this.tileMap.terrainTypes[indexToDelete];
        if (!terrainTypeId) return;

        if (!confirm(`Are you sure you want to delete the "${terrainTypeId}" terrain type? All instances will be converted to the default terrain.`)) {
            return;
        }

        const defaultTerrainIndex = this.tileMap.terrainTypes.indexOf('grass') >= 0 ? this.tileMap.terrainTypes.indexOf('grass') : 0;

        // Delete from collections
        const collections = this.gameEditor.getCollections();
        if (collections.terrainTypes && collections.terrainTypes[terrainTypeId]) {
            delete collections.terrainTypes[terrainTypeId];
        }
    
        // Remove from terrainTypes array
        this.tileMap.terrainTypes.splice(indexToDelete, 1);
    
        // Update terrainMap - replace all instances with defaultTerrainIndex
        for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
            for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                if (this.tileMap.terrainMap[y][x] === indexToDelete) {
                    this.tileMap.terrainMap[y][x] = defaultTerrainIndex;
                } else if (this.tileMap.terrainMap[y][x] > indexToDelete) {
                    this.tileMap.terrainMap[y][x]--; // Adjust indices after deleted item
                }
            }
        }
    
        if (this.currentTerrainId === indexToDelete) {
            this.currentTerrainId = defaultTerrainIndex;
        } else if (this.currentTerrainId > indexToDelete) {
            this.currentTerrainId--;
        }
    
        this.updateTerrainStyles();
        this.setupTerrainTypesUI();
        this.initGridCanvas();
        this.exportMap();
    }


    updateCanvasSize() {
        const gameConfig = this.gameEditor.getCollections().configs.game;
        const isIsometric = gameConfig.isIsometric;
        const gridSize = gameConfig.gridSize;

        if (isIsometric) {
            // For isometric: width needs to accommodate the diamond shape
            // Height is roughly half the width for isometric projection
            const requiredWidth = (this.mapSize * gridSize) + gridSize;
            const requiredHeight = (this.mapSize * gridSize * 0.5) + (gridSize * 0.5);

            // Add some padding
            this.editorSettings.canvasWidth = Math.max(1536, requiredWidth + 200);
            this.editorSettings.canvasHeight = Math.max(768, requiredHeight + 200);
        } else {
            // For non-isometric: simple square grid
            const requiredSize = this.mapSize * gridSize;

            // Add padding for centering
            this.editorSettings.canvasWidth = Math.max(1536, requiredSize + 400);
            this.editorSettings.canvasHeight = Math.max(768, requiredSize + 400);
        }

        // Set canvas internal resolution (bitmap size)
        this.canvasEl.width = this.editorSettings.canvasWidth;
        this.canvasEl.height = this.editorSettings.canvasHeight;

        // Clear any inline styles to ensure CSS controls the display size
        this.canvasEl.style.width = '';
        this.canvasEl.style.height = '';
    }
    updateTerrainStyles() {
        let styleElem = document.getElementById('terrainStyles');
        if (!styleElem) {
            styleElem = document.createElement('style');
            styleElem.id = 'terrainStyles';
            document.head.appendChild(styleElem);
        }
    
        let css = '';
        this.tileMap.terrainTypes.forEach((terrain, index) => {
            css += `#level-editor-container .terrain-editor__color-option[data-index="${index}"] { background-color: ${terrain.color}; }\n`;
        });
    
        css += `
            .terrain-editor__terrain-item.dragging { opacity: 0.4; }
            .terrain-editor__terrain-item.drag-over { border: 2px dashed #666; background-color: rgba(0,0,0,0.1); }
        `;
    
        styleElem.textContent = css;
    }

    async initGridCanvas() {
        // Load terrain and environment images for sprite rendering
        this.isInitializing = true;

        try {
            // Initialize 3D rendering first - this creates editorContext with imageManager and modelManager via EditorLoader
            await this.init3DRendering();

            // Use the editorContext's imageManager (created by EditorLoader)
            this.imageManager = this.editorContext.imageManager;
            this.modelManager = this.editorContext.modelManager;

            // Load terrain sprite sheets for in-game graphics rendering
            await this.imageManager.loadImages("levels", { level: this.objectData }, false, false);
            const terrainImages = this.imageManager.getImages("levels", "level");

            // Load environment images if we have environment objects
            if (this.worldObjects && Object.keys(this.worldObjects).length > 0) {
                await this.imageManager.loadImages("environment", this.worldObjects, false, false);
            }

            // Initialize TileMap with actual sprite sheets
            this.terrainTileMapper = new GUTS.TileMap({});
            if (!this.terrainCanvasBuffer) {
                this.terrainCanvasBuffer = document.createElement('canvas');
            }
            this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
            this.terrainCanvasBuffer.height = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;

            // Init TileMap (for both 2D and 3D - 3D uses it for texture generation)
            const terrainTypeNames = this.tileMap.terrainTypes || [];
            this.terrainTileMapper.init(
                this.terrainCanvasBuffer,
                this.gameEditor.getCollections().configs.game.gridSize,
                terrainImages,
                this.gameEditor.getCollections().configs.game.isIsometric,
                { skipCliffTextures: false, terrainTypeNames } // Enable cliffs for 3D
            );
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Initialize 3D rendering system using EditorLoader + EditorECSGame
     */
    async init3DRendering() {
        const collections = this.gameEditor.getCollections();
        const gameConfig = collections.configs.game;

        // Find the level name by looking up this.objectData in collections
        const levelName = Object.keys(collections.levels || {}).find(
            key => collections.levels[key] === this.objectData
        );

        // Create editor context (like ECSGame)
        this.editorContext = new GUTS.EditorECSGame(this.gameEditor, this.canvasEl);

        // Get editor-specific systems from terrainModule.json
        const editorSystems = this.editorSettings.systems;

        // Use EditorLoader to load assets and initialize (like GameLoader)
        this.editorLoader = new GUTS.EditorLoader(this.editorContext);
        await this.editorLoader.load({
            systems: editorSystems,
            levelName: levelName
        });

        // Get enum index for level (TerrainSystem reads from game.state.level)
        const enums = this.editorContext.getEnums();
        const levelIndex = enums.levels?.[levelName] ?? 0;

        // Set level in game state before loading scene
        // TerrainSystem will read this and create the terrain entity
        this.editorContext.state.level = levelIndex;

        // Load scene - TerrainSystem will create terrain entity from game.state.level
        await this.editorContext.loadScene({
            systems: editorSystems,
            entities: []
        });

        // Get references from systems for editor functionality
        this.worldRenderer = this.editorContext.worldSystem?.worldRenderer;
        this.entityRenderer = this.editorContext.renderSystem?.entityRenderer;
        this.terrainDataManager = this.editorContext.terrainSystem?.terrainDataManager;

        // Setup scene camera (perspective) for editor - default mode
        if (this.worldRenderer) {
            const canvas = this.canvasEl;
            const width = canvas.clientWidth || window.innerWidth;
            const height = canvas.clientHeight || window.innerHeight;
            this.setupSceneCamera(width, height);
        }

        // Only setup 3D helpers if worldRenderer was successfully created
        if (!this.worldRenderer) {
            console.error('[TerrainMapEditor] WorldRenderer not initialized - 3D rendering will be unavailable');
            return;
        }

        // Recreate RaycastHelper to ensure fresh camera/scene references
        this.raycastHelper = new GUTS.RaycastHelper(
            this.worldRenderer.getCamera(),
            this.worldRenderer.getScene()
        );

        // Recreate PlacementPreview for each level to ensure correct scene and grid size
        if (this.placementPreview) {
            this.placementPreview.dispose();
        }

        this.placementPreview = new GUTS.PlacementPreview({
            scene: this.worldRenderer.getScene(),
            gridSize: gameConfig.gridSize,
            getTerrainHeight: (x, z) => this.terrainDataManager.getTerrainHeightAtPosition(x, z)
        });

        // Configure for editor use
        this.placementPreview.updateConfig({
            cellOpacity: 0.7,
            borderOpacity: 1.0,
            elevationOffset: 5.0 // Higher above terrain for visibility
        });

        // Start render loop with ECS system updates
        this.editorContext.startRenderLoop();

        // Start raycast interval for mouse position updates
        this.startRaycastInterval();

        // Initialize gizmo manager for entity manipulation
        if (GUTS.SE_GizmoManager) {
            this.gizmoManager = new GUTS.SE_GizmoManager();
            this.initializeGizmoManager();
        }

        // Sync with existing ECS entities (spawned by TerrainSystem)
        this.syncLevelEntitiesFromECS();

        console.log('3D terrain editor initialized with ECS systems');
    }

    /**
     * Sync levelEntities array with existing entities in the ECS
     * Entities are already spawned by TerrainSystem, we just need to track them
     */
    syncLevelEntitiesFromECS() {
        if (!this.editorContext) return;

        // Get all entities from ECS
        const allEntities = this.editorContext.getAllEntities?.() || [];

        // Clear existing levelEntities - we'll rebuild from ECS
        this.levelEntities = [];

        console.log(`[TerrainMapEditor] Syncing with ${allEntities.length} ECS entities...`);

        // Get reverse enums for converting numeric indices back to strings
        const reverseEnums = this.editorContext.call?.('getReverseEnums') || {};

        for (const entityId of allEntities) {
            // Check if this entity belongs to a tracked collection
            // We identify entities by their marker components (worldObject, unit, building)
            // and get the type from unitType component

            let collection = null;
            let spawnType = null;

            // Check for marker components to determine collection
            // Order matters: check more specific first
            const hasWorldObject = this.editorContext.getComponent(entityId, 'worldObject');
            const hasBuilding = this.editorContext.getComponent(entityId, 'building');
            const hasUnit = this.editorContext.getComponent(entityId, 'unit');

            if (hasWorldObject !== undefined && hasWorldObject !== null) {
                collection = 'worldObjects';
            } else if (hasBuilding !== undefined && hasBuilding !== null) {
                collection = 'buildings';
            } else if (hasUnit !== undefined && hasUnit !== null) {
                collection = 'units';
            }

            // Skip entities that aren't level entities (e.g., terrain, camera, etc.)
            if (!collection) continue;

            // Get the type from unitType component (shared by units, buildings, and worldObjects)
            // unitType.type is a numeric index, convert it to string name using reverseEnums
            const unitType = this.editorContext.getComponent(entityId, 'unitType');
            if (unitType?.type === undefined || unitType?.type === null) continue;

            // Convert numeric type index to string name
            spawnType = reverseEnums[collection]?.[unitType.type];
            if (!spawnType) {
                console.warn(`[TerrainMapEditor] Could not resolve type index ${unitType.type} for collection ${collection}`);
                continue;
            }

            // Get transform for this entity
            const transform = this.editorContext.getComponent(entityId, 'transform');

            // Add to levelEntities
            this.levelEntities.push({
                id: entityId,
                collection: collection,
                spawnType: spawnType,
                components: {
                    transform: transform ? {
                        position: { ...transform.position },
                        rotation: transform.rotation ? { ...transform.rotation } : { x: 0, y: 0, z: 0 },
                        scale: transform.scale ? { ...transform.scale } : { x: 1, y: 1, z: 1 }
                    } : null
                }
            });
        }

        console.log(`[TerrainMapEditor] Synced ${this.levelEntities.length} level entities from ECS`);

        // Update the entity hierarchy UI
        this.updateEntityHierarchy();
    }

    /**
     * Start the 3D render loop with ECS system updates
     */
    start3DRenderLoop() {
        if (this.editorContext) {
            this.editorContext.startRenderLoop();
        }
    }

    /**
     * Stop the 3D render loop
     */
    stop3DRenderLoop() {
        if (this.editorContext) {
            this.editorContext.stopRenderLoop();
        }
        // Also stop raycast interval
        this.stopRaycastInterval();
    }

    /**
     * Start the raycast interval for mouse position updates
     * Runs at ~60fps to update grid position based on mouse NDC
     */
    startRaycastInterval() {
        // Clear any existing interval
        this.stopRaycastInterval();

        // Run raycast at ~60fps (16ms)
        this.raycastIntervalId = setInterval(() => {
            this.updateGridPositionFromRaycast();
        }, 500);
    }

    /**
     * Stop the raycast interval
     */
    stopRaycastInterval() {
        if (this.raycastIntervalId) {
            clearInterval(this.raycastIntervalId);
            this.raycastIntervalId = null;
        }
    }

    // ============ CAMERA SYSTEM ============

    /**
     * Toggle between scene (perspective) and game (orthographic) camera
     */
    toggleCamera() {
        if (!this.worldRenderer) {
            console.warn('[TerrainMapEditor] WorldRenderer not available for camera toggle');
            return;
        }

        const newMode = this.cameraMode === 'scene' ? 'game' : 'scene';
        this.setCameraMode(newMode);
    }

    /**
     * Set the camera mode
     * @param {string} mode - 'scene' or 'game'
     */
    setCameraMode(mode) {
        if (!this.worldRenderer) return;

        const canvas = this.canvasEl;
        const width = canvas.clientWidth || canvas.width;
        const height = canvas.clientHeight || canvas.height;

        // Save current camera state before switching
        this.saveCameraState();

        // Store selected entity to reattach gizmo after camera switch
        const selectedEntityId = this.selectedEntityId;

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

        this.cameraMode = mode;

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
        const toggleBtn = document.getElementById('te-camera-toggle');
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = mode === 'scene' ? 'Scene Cam' : 'Game Cam';
            toggleBtn.classList.toggle('editor-module__btn--active', mode === 'game');
        }

        const rotateLeftBtn = document.getElementById('te-camera-rotate-left');
        const rotateRightBtn = document.getElementById('te-camera-rotate-right');
        if (rotateLeftBtn) rotateLeftBtn.style.display = mode === 'game' ? '' : 'none';
        if (rotateRightBtn) rotateRightBtn.style.display = mode === 'game' ? '' : 'none';

        console.log(`[TerrainMapEditor] Camera mode switched to: ${mode}`);
    }

    /**
     * Save the current camera state based on mode
     */
    saveCameraState() {
        if (!this.worldRenderer?.camera) return;

        const camera = this.worldRenderer.camera;
        const controls = this.worldRenderer.controls;

        if (this.cameraMode === 'scene') {
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
        const terrainSize = this.terrainDataManager?.terrainSize || 1536;
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
            this.canvasEl.removeEventListener('wheel', this.gameCameraWheelHandler);
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

        // Force initial camera rotation sync
        if (this.worldRenderer.updateCameraRotation) {
            this.worldRenderer.updateCameraRotation();
        }
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

        // Get camera height from collections
        const cameraSettings = this.collections?.cameras?.main;
        const cameraHeight = cameraSettings?.position?.y || 512;

        // Restore saved state or use default
        if (this.gameCameraState) {
            camera.position.copy(this.gameCameraState.position);
            camera.zoom = this.gameCameraState.zoom || 1;
            if (this.gameCameraState.quaternion) {
                camera.quaternion.copy(this.gameCameraState.quaternion);
            } else if (this.gameCameraState.lookAt) {
                camera.lookAt(this.gameCameraState.lookAt.x, this.gameCameraState.lookAt.y, this.gameCameraState.lookAt.z);
            }
            if (this.gameCameraState.lookAt) {
                camera.userData.lookAt = this.gameCameraState.lookAt.clone();
            }
        } else {
            // Default game camera position (isometric view)
            const pitch = 35.264 * Math.PI / 180;
            const yaw = 135 * Math.PI / 180;
            const distance = cameraHeight;

            const worldX = 0;
            const worldZ = 0;

            const cdx = Math.sin(yaw) * Math.cos(pitch);
            const cdz = Math.cos(yaw) * Math.cos(pitch);

            camera.position.set(
                worldX - cdx * distance,
                distance,
                worldZ - cdz * distance
            );

            const lookAtPoint = new THREE.Vector3(worldX, 0, worldZ);
            camera.lookAt(lookAtPoint);
            camera.userData.lookAt = lookAtPoint.clone();
        }

        camera.updateProjectionMatrix();

        // Set camera in WorldRenderer
        this.worldRenderer.camera = camera;

        // Dispose orbit controls (not used in game mode)
        this.cleanupWorldRendererControls();

        // Setup game camera controls (zoom + pan)
        this.setupGameCameraControls(camera);
    }

    /**
     * Setup simple controls for game camera (zoom + optional pan)
     */
    setupGameCameraControls(camera) {
        // Remove any existing game camera handlers
        if (this.gameCameraWheelHandler) {
            this.canvasEl.removeEventListener('wheel', this.gameCameraWheelHandler);
        }
        if (this.gameCameraMouseDownHandler) {
            this.canvasEl.removeEventListener('mousedown', this.gameCameraMouseDownHandler);
            this.canvasEl.removeEventListener('mousemove', this.gameCameraMouseMoveHandler);
            this.canvasEl.removeEventListener('mouseup', this.gameCameraMouseUpHandler);
            this.canvasEl.removeEventListener('mouseleave', this.gameCameraMouseUpHandler);
        }

        // Mouse wheel zoom
        this.gameCameraWheelHandler = (e) => {
            if (this.cameraMode !== 'game') return;
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
            if (this.cameraMode !== 'game') return;
            if (e.button === 2) {
                isPanning = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                this.isCameraControlActive = true;
            }
        };

        this.gameCameraMouseMoveHandler = (e) => {
            if (!isPanning || this.cameraMode !== 'game') return;

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

        this.gameCameraMouseUpHandler = (e) => {
            if (e.button === 2) {
                isPanning = false;
                this.isCameraControlActive = false;
            }
        };

        this.canvasEl.addEventListener('wheel', this.gameCameraWheelHandler, { passive: false });
        this.canvasEl.addEventListener('mousedown', this.gameCameraMouseDownHandler);
        this.canvasEl.addEventListener('mousemove', this.gameCameraMouseMoveHandler);
        this.canvasEl.addEventListener('mouseup', this.gameCameraMouseUpHandler);
        this.canvasEl.addEventListener('mouseleave', this.gameCameraMouseUpHandler);
    }

    /**
     * Rotate the game camera by 45 degrees around the current look-at point
     * @param {string} direction - 'left' or 'right'
     */
    rotateGameCamera(direction) {
        if (this.cameraMode !== 'game') return;

        const camera = this.worldRenderer?.camera;
        if (!camera) return;

        // Raycast from center of screen to find ground point
        const raycaster = new THREE.Raycaster();
        const centerScreen = new THREE.Vector2(0, 0);
        raycaster.setFromCamera(centerScreen, camera);

        // Find the ground mesh
        const ground = this.worldRenderer.getGroundMesh();
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

        // Update camera position
        camera.position.set(
            groundPoint.x + newX,
            camera.position.y,
            groundPoint.z + newZ
        );

        // Rotate camera to face the ground point
        camera.lookAt(groundPoint);

        // Store look-at point for panning
        camera.userData.lookAt = groundPoint.clone();
    }

    // ============ GIZMO SYSTEM ============

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
            console.warn('[TerrainMapEditor] Cannot init gizmo manager - missing scene/camera/renderer');
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
            onTransformChange: (position, rotation, scale) => {
                this.syncGizmoToEntity(position, rotation, scale);
            }
        });

        console.log('[TerrainMapEditor] Gizmo manager initialized');
    }

    /**
     * Set the gizmo mode (translate, rotate, scale)
     */
    setGizmoMode(mode) {
        if (this.gizmoManager) {
            this.gizmoManager.setMode(mode);
        }
    }

    /**
     * Update gizmo toolbar UI to show active mode
     */
    updateGizmoToolbarUI(activeButtonId) {
        const buttons = ['te-translate-tool', 'te-rotate-tool', 'te-scale-tool'];
        buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.toggle('editor-module__btn--active', id === activeButtonId);
            }
        });
    }

    /**
     * Attach gizmo to selected entity by positioning helper at entity location
     */
    attachGizmoToEntity(entityId) {
        if (!this.gizmoManager || !this.gizmoHelper || !this.editorContext) {
            return;
        }

        // Get entity's transform component
        const transform = this.editorContext.getComponent(entityId, 'transform');
        if (!transform) {
            console.warn('[TerrainMapEditor] Entity has no transform component:', entityId);
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

        console.log('[TerrainMapEditor] Gizmo attached to entity:', entityId, 'at position:', pos);
    }

    /**
     * Sync gizmo helper transform back to entity component
     */
    syncGizmoToEntity(position, rotation, scale) {
        if (!this.selectedEntityId || !this.editorContext) return;

        const entityId = this.selectedEntityId;

        // Get current transform
        const transform = this.editorContext.getComponent(entityId, 'transform');
        if (!transform) return;

        // Update transform values in-place (don't replace the objects)
        if (position) {
            if (!transform.position) transform.position = { x: 0, y: 0, z: 0 };
            transform.position.x = position.x;
            transform.position.y = position.y;
            transform.position.z = position.z;
        }
        if (rotation) {
            if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
            transform.rotation.x = rotation.x;
            transform.rotation.y = rotation.y;
            transform.rotation.z = rotation.z;
        }
        if (scale) {
            if (!transform.scale) transform.scale = { x: 1, y: 1, z: 1 };
            transform.scale.x = scale.x;
            transform.scale.y = scale.y;
            transform.scale.z = scale.z;
        }

        // Update visual representation via RenderSystem
        const renderSystem = this.editorContext.renderSystem;
        if (renderSystem) {
            const angle = transform.rotation ? transform.rotation.y : 0;
            renderSystem.updateEntity(entityId, {
                position: transform.position,
                rotation: angle,
                transform: transform
            });
        }

        // Update the corresponding levelEntity data
        const levelEntity = this.levelEntities.find(e => e.id === entityId);
        if (levelEntity) {
            if (!levelEntity.components) levelEntity.components = {};
            if (!levelEntity.components.transform) levelEntity.components.transform = {};
            if (position) {
                levelEntity.components.transform.position = {
                    x: position.x,
                    y: position.y,
                    z: position.z
                };
            }
            if (rotation) {
                levelEntity.components.transform.rotation = {
                    x: rotation.x,
                    y: rotation.y,
                    z: rotation.z
                };
            }
            if (scale) {
                levelEntity.components.transform.scale = {
                    x: scale.x,
                    y: scale.y,
                    z: scale.z
                };
            }
        }

        // Update inspector if visible
        this.updateInspector();
    }

    /**
     * Select an entity and attach gizmo
     */
    selectEntity(entityId) {
        this.selectedEntityId = entityId;
        if (entityId) {
            this.attachGizmoToEntity(entityId);
        } else {
            this.gizmoManager?.detach();
        }
        this.updateInspector();
        this.updateHierarchy();
    }

    /**
     * Deselect current entity
     */
    deselectEntity() {
        this.selectedEntityId = null;
        this.selectedLevelEntity = null;
        this.gizmoManager?.detach();
        this.updateInspector();
        this.updateHierarchy();
    }

    /**
     * Update inspector panel - shows selected entity's transform
     */
    updateInspector() {
        const sidebar = document.getElementById('te-inspector-sidebar');
        const content = document.getElementById('te-inspector-content');

        if (!sidebar || !content) return;

        if (!this.selectedEntityId) {
            // Hide inspector when nothing selected
            sidebar.style.display = 'none';
            return;
        }

        // Show inspector
        sidebar.style.display = 'block';

        // Find the selected entity data
        const levelEntity = this.levelEntities.find(e => e.id === this.selectedEntityId);
        if (!levelEntity) {
            content.innerHTML = '<p class="editor-module__info-text">Entity not found</p>';
            return;
        }

        // Get current transform from ECS
        const transform = this.editorContext?.getComponent(this.selectedEntityId, 'transform') || {};
        const pos = transform.position || { x: 0, y: 0, z: 0 };
        const rot = transform.rotation || { x: 0, y: 0, z: 0 };
        const scl = transform.scale || { x: 1, y: 1, z: 1 };

        content.innerHTML = `
            <div class="editor-module__info-box" style="margin-bottom: 10px;">
                <strong>${levelEntity.collection}</strong> / ${levelEntity.spawnType}
            </div>
            <div class="editor-module__section">
                <h4 class="editor-module__section-title">Position</h4>
                <div class="editor-module__form-row">
                    <label class="editor-module__label">X:</label>
                    <input type="number" class="editor-module__input te-transform-input" data-prop="position.x" value="${pos.x.toFixed(2)}" step="1">
                </div>
                <div class="editor-module__form-row">
                    <label class="editor-module__label">Y:</label>
                    <input type="number" class="editor-module__input te-transform-input" data-prop="position.y" value="${pos.y.toFixed(2)}" step="1">
                </div>
                <div class="editor-module__form-row">
                    <label class="editor-module__label">Z:</label>
                    <input type="number" class="editor-module__input te-transform-input" data-prop="position.z" value="${pos.z.toFixed(2)}" step="1">
                </div>
            </div>
            <div class="editor-module__section">
                <h4 class="editor-module__section-title">Rotation (Y)</h4>
                <div class="editor-module__form-row">
                    <label class="editor-module__label">Y:</label>
                    <input type="number" class="editor-module__input te-transform-input" data-prop="rotation.y" value="${(rot.y * 180 / Math.PI).toFixed(1)}" step="15">
                </div>
            </div>
        `;

        // Add input listeners for transform editing
        content.querySelectorAll('.te-transform-input').forEach(input => {
            input.addEventListener('change', (e) => {
                this.handleInspectorInputChange(e.target.dataset.prop, parseFloat(e.target.value));
            });
        });
    }

    /**
     * Handle transform input change from inspector
     */
    handleInspectorInputChange(prop, value) {
        if (!this.selectedEntityId || !this.editorContext) return;

        const transform = this.editorContext.getComponent(this.selectedEntityId, 'transform');
        if (!transform) return;

        // Parse property path (e.g., "position.x")
        const [component, axis] = prop.split('.');

        if (component === 'position') {
            if (!transform.position) transform.position = { x: 0, y: 0, z: 0 };
            transform.position[axis] = value;
        } else if (component === 'rotation') {
            if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
            // Convert degrees to radians for Y rotation
            transform.rotation[axis] = value * Math.PI / 180;
        }

        // Update visual representation
        const renderSystem = this.editorContext.renderSystem;
        if (renderSystem) {
            renderSystem.updateEntity(this.selectedEntityId, {
                position: transform.position,
                rotation: transform.rotation?.y || 0,
                transform: transform
            });
        }

        // Update gizmo helper position
        if (this.gizmoHelper) {
            const pos = transform.position;
            const rot = transform.rotation;
            this.gizmoHelper.position.set(pos.x, pos.y, pos.z);
            if (rot) this.gizmoHelper.rotation.set(rot.x, rot.y, rot.z);
        }

        // Update levelEntity data
        const levelEntity = this.levelEntities.find(e => e.id === this.selectedEntityId);
        if (levelEntity) {
            if (!levelEntity.components) levelEntity.components = {};
            if (!levelEntity.components.transform) levelEntity.components.transform = {};
            // Deep copy position/rotation/scale
            if (transform.position) {
                levelEntity.components.transform.position = {
                    x: transform.position.x,
                    y: transform.position.y,
                    z: transform.position.z
                };
            }
            if (transform.rotation) {
                levelEntity.components.transform.rotation = {
                    x: transform.rotation.x,
                    y: transform.rotation.y,
                    z: transform.rotation.z
                };
            }
            if (transform.scale) {
                levelEntity.components.transform.scale = {
                    x: transform.scale.x,
                    y: transform.scale.y,
                    z: transform.scale.z
                };
            }
        }
    }

    /**
     * Update hierarchy panel - shows list of placed entities
     */
    updateHierarchy() {
        this.updateEntityHierarchy();
    }

    /**
     * Select a level entity from the hierarchy list
     * @param {Object} entity - The level entity object from this.levelEntities
     */
    selectLevelEntity(entity) {
        if (!entity || !entity.id) return;

        // Store reference for hierarchy highlighting
        this.selectedLevelEntity = entity;

        // Use the existing selectEntity method which handles gizmo and inspector
        this.selectEntity(entity.id);
    }

    // ============ ENTITY PLACEMENT SYSTEM ============

    /**
     * Activate entity placement mode
     * @param {string} collection - Collection name (e.g., 'worldObjects', 'units', 'buildings')
     * @param {string} spawnType - Spawn type name within the collection
     */
    activateEntityPlacementMode(prefab, collection, spawnType) {
        this.entityPlacementMode = {
            active: true,
            prefab: prefab,
            collection: collection,
            spawnType: spawnType
        };

        console.log(`[TerrainMapEditor] Entity placement mode activated: ${prefab}/${spawnType}`);
    }

    /**
     * Place entity at current mouse position
     */
    placeEntityAtMouse() {
        if (!this.entityPlacementMode?.active) return;

        if (!this.raycastHelper || !this.worldRenderer) {
            console.error('[TerrainMapEditor] RaycastHelper or WorldRenderer not available');
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
        const terrainHeight = this.terrainDataManager?.getTerrainHeightAtPosition?.(worldPos.x, worldPos.z) || worldPos.y;

        // Create entity
        this.createEntityAtPosition(worldPos.x, terrainHeight, worldPos.z);
    }

    /**
     * Create entity at specific position using prefab-driven system
     */
    createEntityAtPosition(x, y, z) {
        if (!this.editorContext) return;

        const { prefab, collection, spawnType } = this.entityPlacementMode || {};
        if (!prefab || !spawnType) return;

        // Get enums for team
        const enums = this.editorContext.call?.('getEnums');
        const neutralTeam = enums?.team?.neutral ?? 0;

        // Create entity using prefab-driven system
        const componentOverrides = {
            transform: {
                position: { x, y, z }
            }
        };

        const entityId = this.editorContext.call('createEntityFromPrefab', {
            prefab: prefab,
            type: spawnType,
            collection: collection,
            team: neutralTeam,
            componentOverrides: componentOverrides
        });

        if (!entityId) {
            console.error('[TerrainMapEditor] Failed to create entity');
            return;
        }

        // Add to levelEntities array for save/export (internal format: collection, spawnType)
        // Get the actual transform from ECS to ensure we have the full data (position, rotation, scale)
        const createdTransform = this.editorContext.getComponent(entityId, 'transform');
        this.levelEntities.push({
            id: entityId,
            collection: collection,
            spawnType: spawnType,
            components: {
                transform: createdTransform ? {
                    position: { ...createdTransform.position },
                    rotation: createdTransform.rotation ? { ...createdTransform.rotation } : { x: 0, y: 0, z: 0 },
                    scale: createdTransform.scale ? { ...createdTransform.scale } : { x: 1, y: 1, z: 1 }
                } : {
                    position: { x, y, z },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                }
            }
        });

        // Select the newly created entity
        this.selectEntity(entityId);

        // Update hierarchy list
        this.updateEntityHierarchy();

        console.log(`[TerrainMapEditor] Created entity ${entityId} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
    }

    /**
     * Remove the currently selected entity
     */
    removeSelectedEntity() {
        if (!this.selectedEntityId || !this.editorContext) return;

        // Remove from ECS context
        this.editorContext.removeEntity(this.selectedEntityId);

        // Remove from levelEntities array
        const index = this.levelEntities.findIndex(e => e.id === this.selectedEntityId);
        if (index !== -1) {
            this.levelEntities.splice(index, 1);
        }

        // Clear selection
        this.deselectEntity();

        // Update hierarchy list
        this.updateEntityHierarchy();

        console.log('[TerrainMapEditor] Removed entity:', this.selectedEntityId);
    }

    /**
     * Handle click on canvas for entity selection
     */
    handleEntityClick(e) {
        // Skip if in placement mode or if camera is being controlled
        if (this.entityPlacementMode?.active || this.isCameraControlActive) return;
        if (!this.editorContext || !this.raycastHelper) return;

        // Raycast to find clicked entity
        const entityId = this.raycastForEntity(e);

        if (entityId) {
            this.selectEntity(entityId);
        } else {
            this.deselectEntity();
        }
    }

    /**
     * Raycast to find entity at mouse position
     * @returns {number|null} Entity ID or null if no entity found
     */
    raycastForEntity(e) {
        // Get the currently selected prefab's collection to filter by
        const collectionSelect = document.getElementById('te-collection-select');
        const selectedPrefabId = collectionSelect?.value;
        const filterCollection = this.getCollectionFromPrefab(selectedPrefabId);

        // Get world position from raycast first (only need to do this once)
        const groundMesh = this.worldRenderer?.getGroundMesh();
        if (!groundMesh) return null;

        const worldPos = this.raycastHelper.rayCastGround(
            this.mouseNDC.x,
            this.mouseNDC.y,
            groundMesh
        );

        if (!worldPos) return null;

        // Find closest entity within selection radius
        let closestEntity = null;
        let closestDistSq = Infinity;

        for (const levelEntity of this.levelEntities) {
            // Filter by collection if one is selected
            if (filterCollection && levelEntity.collection !== filterCollection) {
                continue;
            }

            const transform = this.editorContext.getComponent(levelEntity.id, 'transform');
            if (!transform) continue;

            const pos = transform.position;
            const collision = this.editorContext.getComponent(levelEntity.id, 'collision');
            const radius = collision?.radius || 25;

            const dx = worldPos.x - pos.x;
            const dz = worldPos.z - pos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < radius * radius && distSq < closestDistSq) {
                closestDistSq = distSq;
                closestEntity = levelEntity;
            }
        }

        return closestEntity?.id || null;
    }

    /**
     * Create the visual box selection element
     */
    createBoxSelectionElement() {
        if (this.boxSelection.element) return;

        const boxElement = document.createElement('div');
        boxElement.id = 'te-selection-box';
        boxElement.style.cssText = `
            position: absolute;
            border: 2px solid rgba(99, 102, 241, 0.8);
            background: rgba(99, 102, 241, 0.15);
            pointer-events: none;
            display: none;
            z-index: 10000;
        `;

        // Append to canvas parent
        const canvasParent = this.canvasEl?.parentElement;
        if (canvasParent) {
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

    /**
     * Start box selection on mouse down
     */
    startBoxSelection(e) {
        this.createBoxSelectionElement();

        this.boxSelection.startX = e.clientX;
        this.boxSelection.startY = e.clientY;
        this.boxSelection.currentX = e.clientX;
        this.boxSelection.currentY = e.clientY;
        this.boxSelection.active = true;
    }

    /**
     * Update box selection visual during mouse move
     */
    updateBoxSelection(e) {
        this.boxSelection.currentX = e.clientX;
        this.boxSelection.currentY = e.clientY;

        const dx = this.boxSelection.currentX - this.boxSelection.startX;
        const dy = this.boxSelection.currentY - this.boxSelection.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only show box if dragged more than 5 pixels
        if (distance > 5) {
            this.updateBoxSelectionVisual();
        }
    }

    /**
     * Update the visual appearance of the selection box
     */
    updateBoxSelectionVisual() {
        const box = this.boxSelection;
        const element = box.element;
        if (!element) return;

        let left = Math.min(box.startX, box.currentX);
        let top = Math.min(box.startY, box.currentY);
        const width = Math.abs(box.currentX - box.startX);
        const height = Math.abs(box.currentY - box.startY);

        // Convert to canvas-relative coordinates
        if (box.useCanvasRelative && this.canvasEl?.parentElement) {
            const parentRect = this.canvasEl.parentElement.getBoundingClientRect();
            left -= parentRect.left;
            top -= parentRect.top;
        }

        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.display = 'block';
    }

    /**
     * Complete box selection on mouse up
     */
    completeBoxSelection(e) {
        const box = this.boxSelection;
        const dx = box.currentX - box.startX;
        const dy = box.currentY - box.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            // Box selection - select all entities in box
            this.selectEntitiesInBox();
        } else {
            // Single click - select one entity
            this.handleEntityClick(e);
        }

        // Reset box selection state
        box.active = false;
        if (box.element) {
            box.element.style.display = 'none';
        }
    }

    /**
     * Select all entities within the selection box
     */
    selectEntitiesInBox() {
        const box = this.boxSelection;
        const canvasRect = this.canvasEl.getBoundingClientRect();

        // Get box bounds in client coordinates
        const boxLeft = Math.min(box.startX, box.currentX);
        const boxRight = Math.max(box.startX, box.currentX);
        const boxTop = Math.min(box.startY, box.currentY);
        const boxBottom = Math.max(box.startY, box.currentY);

        // Get the currently selected prefab's collection to filter by
        const collectionSelect = document.getElementById('te-collection-select');
        const selectedPrefabId = collectionSelect?.value;
        const filterCollection = this.getCollectionFromPrefab(selectedPrefabId);

        const selectedIds = [];

        for (const levelEntity of this.levelEntities) {
            // Filter by collection
            if (filterCollection && levelEntity.collection !== filterCollection) {
                continue;
            }

            const transform = this.editorContext.getComponent(levelEntity.id, 'transform');
            if (!transform) continue;

            // Project entity world position to screen coordinates
            const pos = transform.position;
            const screenPos = this.worldToScreen(pos.x, pos.y, pos.z);
            if (!screenPos) continue;

            // Convert to client coordinates
            const clientX = canvasRect.left + screenPos.x;
            const clientY = canvasRect.top + screenPos.y;

            // Check if within box
            if (clientX >= boxLeft && clientX <= boxRight &&
                clientY >= boxTop && clientY <= boxBottom) {
                selectedIds.push(levelEntity.id);
            }
        }

        // Update selection
        this.selectedEntities = selectedIds;

        if (selectedIds.length === 1) {
            // Single entity - use normal selection with gizmo
            this.selectEntity(selectedIds[0]);
        } else if (selectedIds.length > 1) {
            // Multiple entities - just track selection (no gizmo for now)
            this.deselectEntity();
            console.log(`[TerrainMapEditor] Selected ${selectedIds.length} entities`);
        } else {
            this.deselectEntity();
        }
    }

    /**
     * Convert world coordinates to screen coordinates
     */
    worldToScreen(x, y, z) {
        if (!this.worldRenderer?.camera) return null;

        const camera = this.worldRenderer.camera;
        const vector = new THREE.Vector3(x, y, z);
        vector.project(camera);

        const canvasRect = this.canvasEl.getBoundingClientRect();
        return {
            x: (vector.x * 0.5 + 0.5) * canvasRect.width,
            y: (-vector.y * 0.5 + 0.5) * canvasRect.height
        };
    }

    /**
     * Cancel box selection
     */
    cancelBoxSelection() {
        this.boxSelection.active = false;
        if (this.boxSelection.element) {
            this.boxSelection.element.style.display = 'none';
        }
    }

    /**
     * Update cached grid position from raycast
     * Called periodically by raycast interval
     */
    updateGridPositionFromRaycast() {
        // Skip raycasting if camera is being controlled (panning/rotating)
        if (this.isCameraControlActive) {
            return;
        }

        if (!this.mouseOverCanvas || !this.raycastHelper || !this.worldRenderer || !this.terrainDataManager) {
            this.cachedGridPosition = null;
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
            return;
        }

        // Raycast to get world position
        const worldPos = this.raycastHelper.rayCastGround(
            this.mouseNDC.x,
            this.mouseNDC.y,
            this.worldRenderer.getGroundMesh()
        );

        if (!worldPos) {
            this.cachedGridPosition = null;
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
            return;
        }

        // Convert world position to grid coordinates
        const gridSize = this.terrainDataManager.gridSize;
        const terrainSize = this.terrainDataManager.terrainSize;

        const gridX = Math.floor((worldPos.x + terrainSize / 2) / gridSize);
        const gridZ = Math.floor((worldPos.z + terrainSize / 2) / gridSize);

        // Check bounds
        if (gridX < 0 || gridX >= this.mapSize || gridZ < 0 || gridZ >= this.mapSize) {
            this.cachedGridPosition = null;
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
            return;
        }

        // Update cached position
        this.cachedGridPosition = { x: gridX, z: gridZ };

        // Update preview
        this.showTilePreview(gridX, gridZ);

        // Handle painting if mouse is down
        if (this.isMouseDown) {
            this.handlePainting(gridX, gridZ);
        }
    }


    /**
     * Spawn cliff entities based on height map analysis
     * Uses shared EntityRenderer library
     */
    async spawnCliffEntities() {
        if (!this.worldRenderer || !this.entityRenderer) {
            console.warn('[TerrainMapEditor] Cannot spawn cliffs: missing dependencies');
            return;
        }

        // Delegate to WorldRenderer which uses CliffSpawner
        await this.worldRenderer.spawnCliffs(this.entityRenderer);
    }

    /**
     * Spawn environment objects (trees, rocks, etc.)
     * Uses shared EnvironmentObjectSpawner library
     */
    async spawnWorldObjects() {
        if (!this.environmentObjectSpawner || !this.terrainDataManager) {
            console.warn('[TerrainMapEditor] Cannot spawn environment objects: missing dependencies');
            return;
        }

        // Use the shared spawner in editor mode
        await this.environmentObjectSpawner.spawnWorldObjects(
            this.tileMap,
            this.terrainDataManager
        );
    }

    /**
     * Update environment objects (respawn all)
     * Called when environment objects are added/removed through the UI
     */
    async updateWorldObjects() {
        if (!this.environmentObjectSpawner || !this.terrainDataManager) {
            return;
        }

        // Respawn all environment objects
        await this.environmentObjectSpawner.updateWorldObjects(
            this.tileMap,
            this.terrainDataManager
        );
    }

    /**
     * Update cliffs in a region after height map changes
     * @param {Array} modifiedTiles - Array of {x, y} tiles that were modified
     */
    async updateCliffsInRegion(modifiedTiles) {
        if (!modifiedTiles || modifiedTiles.length === 0) return;

        // Respawn all cliffs (EntityRenderer handles cleanup)
        await this.spawnCliffEntities();
    }


    // Performance optimization: schedule render with requestAnimationFrame

    // Performance optimization: debounce export to reduce save frequency
    debouncedExport() {
        if (this.exportDebounceTimer) {
            clearTimeout(this.exportDebounceTimer);
        }
        
        this.exportDebounceTimer = setTimeout(() => {
            this.exportMap();
            this.exportDebounceTimer = null;
        }, 300); // Export 300ms after last change
    }

    /**
     * Save current state to undo stack before making changes
     * @param {string} type - 'terrain' or 'height'
     * @param {Array} tiles - Array of {x, y} tiles that will be modified
     */
    saveUndoState(type, tiles) {
        if (!tiles || tiles.length === 0) return;

        const state = {
            type: type,
            tiles: tiles.map(tile => ({
                x: tile.x,
                y: tile.y,
                value: type === 'terrain'
                    ? this.tileMap.terrainMap[tile.y][tile.x]
                    : this.tileMap.heightMap[tile.y][tile.x]
            }))
        };

        this.undoStack.push(state);

        // Limit undo stack size
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }

        // Clear redo stack when new action is performed
        this.redoStack = [];

        console.log(`Undo state saved: ${type}, ${tiles.length} tiles`);
    }

    /**
     * Undo the last action
     */
    undo() {
        if (this.undoStack.length === 0) {
            console.log('Nothing to undo');
            return;
        }

        const state = this.undoStack.pop();

        // Save current state to redo stack
        const redoState = {
            type: state.type,
            tiles: state.tiles.map(tile => ({
                x: tile.x,
                y: tile.y,
                value: state.type === 'terrain'
                    ? this.tileMap.terrainMap[tile.y][tile.x]
                    : this.tileMap.heightMap[tile.y][tile.x]
            }))
        };
        this.redoStack.push(redoState);

        // Restore previous state
        const modifiedTiles = [];
        state.tiles.forEach(tile => {
            if (state.type === 'terrain') {
                this.tileMap.terrainMap[tile.y][tile.x] = tile.value;
            } else {
                this.tileMap.heightMap[tile.y][tile.x] = tile.value;
            }
            modifiedTiles.push({ x: tile.x, y: tile.y });
        });

        // Update rendering
        if (state.type === 'terrain') {
            this.update3DTerrainRegion(modifiedTiles);
        } else {
            this.update3DHeightRegion(modifiedTiles);
        }

        this.exportMap();
        console.log(`Undo: restored ${modifiedTiles.length} tiles (${state.type})`);
    }

    /**
     * Redo the last undone action
     */
    redo() {
        if (this.redoStack.length === 0) {
            console.log('Nothing to redo');
            return;
        }

        const state = this.redoStack.pop();

        // Save current state to undo stack
        const undoState = {
            type: state.type,
            tiles: state.tiles.map(tile => ({
                x: tile.x,
                y: tile.y,
                value: state.type === 'terrain'
                    ? this.tileMap.terrainMap[tile.y][tile.x]
                    : this.tileMap.heightMap[tile.y][tile.x]
            }))
        };
        this.undoStack.push(undoState);

        // Apply redo state
        const modifiedTiles = [];
        state.tiles.forEach(tile => {
            if (state.type === 'terrain') {
                this.tileMap.terrainMap[tile.y][tile.x] = tile.value;
            } else {
                this.tileMap.heightMap[tile.y][tile.x] = tile.value;
            }
            modifiedTiles.push({ x: tile.x, y: tile.y });
        });

        // Update rendering
        if (state.type === 'terrain') {
            this.update3DTerrainRegion(modifiedTiles);
        } else {
            this.update3DHeightRegion(modifiedTiles);
        }

        this.exportMap();
        console.log(`Redo: applied ${modifiedTiles.length} tiles (${state.type})`);
    }

    // Paint with brush on terrain map
    paintBrushTerrain(centerX, centerY, terrainId) {
        const radius = Math.floor(this.brushSize / 2);
        const tilesToCheck = [];
        const modifiedTiles = [];

        // First, collect all tiles that would be affected
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;

                // Check bounds
                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    // Check if within brush radius (circular brush)
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius + 0.5) {
                        tilesToCheck.push({ x, y });
                    }
                }
            }
        }

        // Save undo state before modifying
        if (tilesToCheck.length > 0) {
            this.saveUndoState('terrain', tilesToCheck);
        }

        // Now modify the tiles
        tilesToCheck.forEach(tile => {
            if (this.tileMap.terrainMap[tile.y][tile.x] !== terrainId) {
                this.tileMap.terrainMap[tile.y][tile.x] = terrainId;
                modifiedTiles.push(tile);
            }
        });

        // Auto-adjust height for liquid tiles to prevent overflow
        if (modifiedTiles.length > 0 && this.isLiquidTerrainType(terrainId)) {
            const heightAdjustedTiles = this.adjustWaterTileHeights(modifiedTiles);

            // Update 3D height mesh if heights were adjusted
            if (heightAdjustedTiles.length > 0) {
                this.update3DHeightRegion(heightAdjustedTiles);
            }
        }

        return modifiedTiles;
    }

    /**
     * Check if a terrain type is a liquid (water, lava, etc.)
     */
    isLiquidTerrainType(terrainId) {
        const terrainTypeName = this.tileMap.terrainTypes?.[terrainId];
        if (!terrainTypeName) return false;

        return terrainTypeName.toLowerCase().includes('water') ||
               terrainTypeName.toLowerCase().includes('lava') ||
               terrainTypeName.toLowerCase().includes('liquid');
    }

    /**
     * Adjust water tile heights to be at least 1 level lower than non-water neighbors
     * This prevents water from overflowing cliffs
     * @returns {Array} Array of tiles that had their heights adjusted
     */
    adjustWaterTileHeights(waterTiles) {
        if (!this.tileMap.heightMap) return [];

        const adjustedTiles = [];

        waterTiles.forEach(tile => {
            const { x, y } = tile;
            const currentTerrainId = this.tileMap.terrainMap[y][x];

            // Find minimum height of non-water neighbors
            let minNonWaterNeighborHeight = Infinity;
            const neighbors = [
                { dx: 0, dy: -1 },  // North
                { dx: 0, dy: 1 },   // South
                { dx: -1, dy: 0 },  // West
                { dx: 1, dy: 0 }    // East
            ];

            neighbors.forEach(({ dx, dy }) => {
                const nx = x + dx;
                const ny = y + dy;

                // Check bounds
                if (nx >= 0 && nx < this.mapSize && ny >= 0 && ny < this.mapSize) {
                    const neighborTerrainId = this.tileMap.terrainMap[ny][nx];

                    // Only consider non-water neighbors
                    if (!this.isLiquidTerrainType(neighborTerrainId)) {
                        const neighborHeight = this.tileMap.heightMap[ny][nx];
                        minNonWaterNeighborHeight = Math.min(minNonWaterNeighborHeight, neighborHeight);
                    }
                }
            });

            // If there are non-water neighbors, ensure water is at least 1 level lower
            if (minNonWaterNeighborHeight !== Infinity) {
                const requiredHeight = minNonWaterNeighborHeight - 1;
                const currentHeight = this.tileMap.heightMap[y][x];

                // Only adjust if current height is too high
                if (currentHeight >= minNonWaterNeighborHeight) {
                    this.tileMap.heightMap[y][x] = Math.max(0, requiredHeight);
                    adjustedTiles.push(tile);
                    console.log(`Adjusted water tile at (${x}, ${y}) from height ${currentHeight} to ${this.tileMap.heightMap[y][x]}`);
                }
            }
        });

        return adjustedTiles;
    }

    // Paint with brush on height map
    paintBrushHeight(centerX, centerY, heightLevel) {
        const radius = Math.floor(this.brushSize / 2);
        const tilesToCheck = [];
        const modifiedTiles = [];

        // First, collect all tiles that would be affected
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;

                // Check bounds
                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    // Check if within brush radius (circular brush)
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius + 0.5) {
                        tilesToCheck.push({ x, y });
                    }
                }
            }
        }

        // Save undo state before modifying
        if (tilesToCheck.length > 0) {
            this.saveUndoState('height', tilesToCheck);
        }

        // Now modify the tiles
        tilesToCheck.forEach(tile => {
            if (this.tileMap.heightMap[tile.y][tile.x] !== heightLevel) {
                this.tileMap.heightMap[tile.y][tile.x] = heightLevel;
                modifiedTiles.push(tile);
            }
        });

        return modifiedTiles;
    }

    // Flood fill terrain map
    floodFillTerrain(startX, startY, newTerrainId) {
        if (startX < 0 || startX >= this.mapSize || startY < 0 || startY >= this.mapSize) {
            return false;
        }

        const oldTerrainId = this.tileMap.terrainMap[startY][startX];

        // If the target color is the same as the replacement, nothing to do
        if (oldTerrainId === newTerrainId) {
            return false;
        }

        // First pass: collect all tiles that will be modified
        const tilesToModify = [];
        const queue = [[startX, startY]];
        const visited = new Set();

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;

            // Skip if already visited or out of bounds
            if (visited.has(key) || x < 0 || x >= this.mapSize || y < 0 || y >= this.mapSize) {
                continue;
            }

            // Skip if not the target terrain
            if (this.tileMap.terrainMap[y][x] !== oldTerrainId) {
                continue;
            }

            // Mark as visited and collect tile
            visited.add(key);
            tilesToModify.push({ x, y });

            // Add neighbors to queue
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        }

        // Save undo state before modifying
        if (tilesToModify.length > 0) {
            this.saveUndoState('terrain', tilesToModify);

            // Second pass: apply the modifications
            tilesToModify.forEach(tile => {
                this.tileMap.terrainMap[tile.y][tile.x] = newTerrainId;
            });

            // Auto-adjust height for liquid tiles to prevent overflow
            if (this.isLiquidTerrainType(newTerrainId)) {
                const heightAdjustedTiles = this.adjustWaterTileHeights(tilesToModify);

                // Update 3D height mesh if heights were adjusted
                if (heightAdjustedTiles.length > 0) {
                    this.update3DHeightRegion(heightAdjustedTiles);
                }
            }
        }

        return tilesToModify;
    }

    // Flood fill height map
    floodFillHeight(startX, startY, newHeightLevel) {
        if (startX < 0 || startX >= this.mapSize || startY < 0 || startY >= this.mapSize) {
            return false;
        }

        const oldHeightLevel = this.tileMap.heightMap[startY][startX];

        // If the target height is the same as the replacement, nothing to do
        if (oldHeightLevel === newHeightLevel) {
            return false;
        }

        // First pass: collect all tiles that will be modified
        const tilesToModify = [];
        const queue = [[startX, startY]];
        const visited = new Set();

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;

            // Skip if already visited or out of bounds
            if (visited.has(key) || x < 0 || x >= this.mapSize || y < 0 || y >= this.mapSize) {
                continue;
            }

            // Skip if not the target height
            if (this.tileMap.heightMap[y][x] !== oldHeightLevel) {
                continue;
            }

            // Mark as visited and collect tile
            visited.add(key);
            tilesToModify.push({ x, y });

            // Add neighbors to queue
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        }

        // Save undo state before modifying
        if (tilesToModify.length > 0) {
            this.saveUndoState('height', tilesToModify);

            // Second pass: apply the modifications
            tilesToModify.forEach(tile => {
                this.tileMap.heightMap[tile.y][tile.x] = newHeightLevel;
            });
        }

        return tilesToModify;
    }

    /**
     * Handle painting at grid position
     * Called when mouse is down and cached grid position is available
     */
    handlePainting(gridX, gridZ) {
        if (this.placementMode === 'terrain') {
            let modifiedTiles = [];

            if (this.terrainTool === 'brush') {
                const tileKey = `${gridX},${gridZ}`;
                if (this.lastPaintedTile !== tileKey || this.brushSize > 1) {
                    modifiedTiles = this.paintBrushTerrain(gridX, gridZ, this.currentTerrainId);
                    this.lastPaintedTile = tileKey;
                }
            } else if (this.terrainTool === 'fill') {
                if (this.lastPaintedTile === null) {
                    modifiedTiles = this.floodFillTerrain(gridX, gridZ, this.currentTerrainId);
                    this.lastPaintedTile = `${gridX},${gridZ}`;
                }
            }

            if (modifiedTiles.length > 0) {
                // Update 3D terrain mesh for modified tiles
                this.update3DTerrainRegion(modifiedTiles);
            }

        } else if (this.placementMode === 'height') {
            let modifiedTiles = [];

            if (this.terrainTool === 'brush') {
                const tileKey = `${gridX},${gridZ}`;
                if (this.lastPaintedTile !== tileKey || this.brushSize > 1) {
                    modifiedTiles = this.paintBrushHeight(gridX, gridZ, this.currentHeightLevel);
                    this.lastPaintedTile = tileKey;
                }
            } else if (this.terrainTool === 'fill') {
                if (this.lastPaintedTile === null) {
                    modifiedTiles = this.floodFillHeight(gridX, gridZ, this.currentHeightLevel);
                    this.lastPaintedTile = `${gridX},${gridZ}`;
                }
            }

            if (modifiedTiles.length > 0) {
                // Update 3D height mesh for modified tiles
                this.update3DHeightRegion(modifiedTiles);
            }
        } else if (this.placementMode === 'placements') {
            // Place entities (starting locations, units, buildings)
            if (this.selectedPlacementType && this.lastPaintedTile === null) {
                if (this.selectedPlacementType === 'startingLocation') {
                    // Check if starting location already exists for this side
                    const existingIndex = this.startingLocations.findIndex(
                        loc => loc.side === this.selectedEntityType
                    );

                    if (existingIndex !== -1) {
                        // Update existing starting location
                        this.startingLocations[existingIndex] = {
                            side: this.selectedEntityType,
                            gridX: gridX,
                            gridZ: gridZ
                        };
                    } else {
                        // Add new starting location
                        this.startingLocations.push({
                            side: this.selectedEntityType,
                            gridX: gridX,
                            gridZ: gridZ
                        });
                    }

                    // Update the starting locations list display
                    const listElement = document.getElementById('startingLocationsList');
                    if (listElement) {
                        this.updateStartingLocationsList(listElement);
                    }

                } else if (this.selectedPlacementType === 'building' || this.selectedPlacementType === 'unit') {
                    // Add entity placement
                    this.entityPlacements.push({
                        type: this.selectedPlacementType,
                        entityType: this.selectedEntityType,
                        gridPosition: { x: gridX, z: gridZ }
                    });
                }

                // Save the map with updated placements
                this.exportMap();

                this.lastPaintedTile = `${gridX},${gridZ}`;
            }

        } else if (this.placementMode === 'ramp') {
            // Place or remove ramps - ramps apply to ALL edges of a tile with height differences
            if (this.lastPaintedTile === null) {
                if (!this.tileMap.ramps) {
                    this.tileMap.ramps = [];
                }

                const heightMap = this.tileMap.heightMap;
                if (!heightMap || heightMap.length === 0) {
                    console.warn('TerrainMapEditor: Cannot place ramps without height map');
                    return;
                }

                const currentHeight = heightMap[gridZ]?.[gridX];
                if (currentHeight === undefined) return;

                const mapSize = this.tileMap.size;

                // Check if ramp already exists at this tile
                const existingRampIndex = this.tileMap.ramps.findIndex(
                    r => r.gridX === gridX && r.gridZ === gridZ
                );

                if (existingRampIndex !== -1) {
                    // Remove existing ramp
                    this.tileMap.ramps.splice(existingRampIndex, 1);
                } else {
                    // Validate: ramps can only be placed on tiles with exactly one lower cardinal neighbor
                    // (topless, botless, leftless, or rightless)
                    if (!this.isValidRampPlacement(gridX, gridZ)) {
                        console.warn('TerrainMapEditor: Cannot place ramp - tile must have exactly one lower cardinal neighbor');
                        this.lastPaintedTile = `${gridX},${gridZ}`;
                        return;
                    }

                    // Add new ramp (applies to all edges with height differences)
                    this.tileMap.ramps.push({ gridX: gridX, gridZ: gridZ });
                }

                // Update ramp count display
                this.updateRampCount();

                // Pass updated ramps data to tileMapper
                if (this.worldRenderer && this.worldRenderer.tileMapper) {
                    this.worldRenderer.tileMapper.setRamps(this.tileMap.ramps);
                }

                // Redraw the tile and neighbors to remove/update cliff supporting textures
                if (this.worldRenderer) {
                    this.worldRenderer.updateTerrainTiles([{ x: gridX, y: gridZ }]);
                }

                // Respawn cliffs to reflect ramp changes
                if (this.worldRenderer && this.entityRenderer) {
                    this.worldRenderer.spawnCliffs(this.entityRenderer, false);
                }

                // Update terrain mesh to show ramp slopes
                if (this.worldRenderer) {
                    this.worldRenderer.updateHeightMap();
                }

                // Save the map
                this.exportMap();

                this.lastPaintedTile = `${gridX},${gridZ}`;
            }
        }
    }

    /**
     * Show preview for tiles that will be affected by current tool
     */
    showTilePreview(gridX, gridZ) {
        if (!this.placementPreview) return;

        // In entity/placements mode, only show preview if entity placement is active
        if (this.placementMode === 'placements') {
            if (!this.entityPlacementMode?.active) {
                this.placementPreview.hide();
                return;
            }
        }

        const affectedTiles = this.getAffectedTiles(gridX, gridZ);
        if (affectedTiles.length === 0) {
            this.placementPreview.hide();
            return;
        }

        // Convert grid positions to world positions for preview
        const gridSize = this.terrainDataManager.gridSize;
        const terrainSize = this.terrainDataManager.terrainSize;
        const halfSize = terrainSize / 2;

        const worldPositions = affectedTiles.map(tile => ({
            x: (tile.x * gridSize) - halfSize + (gridSize / 2),
            y: 0,
            z: (tile.y * gridSize) - halfSize + (gridSize / 2)
        }));

        // Check if placement is valid
        let isValid = true;

        if (this.placementMode === 'ramp') {
            // For ramp placement, validate that tile has exactly one lower adjacent neighbor
            isValid = this.isValidRampPlacement(gridX, gridZ);
        } else {
            // For other modes, check if any tiles would actually be modified
            isValid = this.wouldModifyTiles(affectedTiles);
        }

        // Show preview (green if valid, red if invalid)
        this.placementPreview.showAtWorldPositions(worldPositions, isValid, true);
    }

    /**
     * Get all tiles affected by current brush settings
     */
    getAffectedTiles(centerX, centerZ) {
        const tiles = [];
        const radius = Math.floor(this.brushSize / 2);

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerZ + dy;

                // Check bounds
                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    // For circular brush
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius) {
                        tiles.push({ x, y });
                    }
                }
            }
        }

        return tiles;
    }

    /**
     * Check if any of the affected tiles would actually be modified
     */
    /**
     * Check if a ramp can be validly placed at the given position
     * Valid placement requires exactly one lower adjacent neighbor (topless, botless, leftless, or rightless)
     */
    isValidRampPlacement(gridX, gridZ) {
        const heightMap = this.tileMap.heightMap;
        if (!heightMap || heightMap.length === 0) {
            return false;
        }

        const currentHeight = heightMap[gridZ]?.[gridX];
        if (currentHeight === undefined) {
            return false;
        }

        const mapSize = this.tileMap.size;

        // Count lower adjacent neighbors (cardinal directions only)
        let lowerNeighborCount = 0;

        // North
        if (gridZ > 0 && heightMap[gridZ - 1][gridX] < currentHeight) {
            lowerNeighborCount++;
        }
        // South
        if (gridZ < mapSize - 1 && heightMap[gridZ + 1][gridX] < currentHeight) {
            lowerNeighborCount++;
        }
        // West
        if (gridX > 0 && heightMap[gridZ][gridX - 1] < currentHeight) {
            lowerNeighborCount++;
        }
        // East
        if (gridX < mapSize - 1 && heightMap[gridZ][gridX + 1] < currentHeight) {
            lowerNeighborCount++;
        }

        // Valid ramp placement requires exactly one lower neighbor
        return lowerNeighborCount === 1;
    }

    wouldModifyTiles(tiles) {
        if (this.placementMode === 'terrain') {
            return tiles.some(tile =>
                this.tileMap.terrainMap[tile.y][tile.x] !== this.currentTerrainId
            );
        } else if (this.placementMode === 'height') {
            return tiles.some(tile =>
                this.tileMap.heightMap[tile.y][tile.x] !== this.currentHeightLevel
            );
        }
        return true;
    }

    /**
     * Update 3D terrain texture for modified tiles
     */
    update3DTerrainRegion(modifiedTiles) {
        if (!this.worldRenderer) return;

        // Update only the modified tiles (localized update for performance)
        this.worldRenderer.updateTerrainTiles(modifiedTiles);
    }

    /**
     * Update 3D height mesh for modified tiles
     */
    update3DHeightRegion(modifiedTiles) {
        if (!this.worldRenderer || !this.terrainDataManager) return;

        // Update terrain data manager's height map
        this.terrainDataManager.processHeightMapFromData();

        // Batch update the mesh for all modified tiles
        if (modifiedTiles.length > 1) {
            const changes = modifiedTiles.map(tile => ({
                gridX: tile.x,
                gridZ: tile.y,
                heightLevel: this.tileMap.heightMap[tile.y][tile.x]
            }));
            this.worldRenderer.batchUpdateHeights(changes);
        } else if (modifiedTiles.length === 1) {
            const tile = modifiedTiles[0];
            this.worldRenderer.setHeightAtGridPosition(
                tile.x,
                tile.y,
                this.tileMap.heightMap[tile.y][tile.x]
            );
        }

        // Update cliff entities to reflect new height configuration
        this.updateCliffsInRegion(modifiedTiles);
    }

    updateRampCount() {
        const rampCountEl = document.getElementById('rampCount');
        if (rampCountEl) {
            const count = this.tileMap.ramps ? this.tileMap.ramps.length : 0;
            rampCountEl.textContent = count;
        }
    }

    exportMap() {
        // Add starting locations to tileMap
        this.tileMap.startingLocations = this.startingLocations;

        // Prepare levelEntities for save (strip runtime IDs)
        // Use prefab format: { prefab: "unit", type: "soldier", components }
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};

        const levelEntitiesForSave = this.levelEntities.map(entity => {
            // Get prefab name from objectTypeDefinition's singular field
            const typeDef = objectTypeDefinitions[entity.collection];
            const prefabName = typeDef?.singular;
            if (!prefabName) {
                console.warn('[TerrainMapEditor] Unknown collection:', entity.collection);
                return null;
            }
            return {
                prefab: prefabName,
                type: entity.spawnType,
                components: entity.components
            };
        }).filter(e => e !== null);

        // Add levelEntities inside tileMap (alongside startingLocations)
        this.tileMap.levelEntities = levelEntitiesForSave;

        // Create level data from tileMap
        const levelData = {
            ...this.tileMap
        };

        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveTileMap', {
            detail: {
                data: levelData,
                propertyName: this.savePropertyName,
                refresh: false
            },
            bubbles: true,
            cancelable: true
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }

    /**
     * Handle unload event when switching away from this editor
     * Cleans up data and instances while keeping HTML around
     */
    handleUnload() {
        console.log('[TerrainMapEditor] Unloading terrain data');

        // Clean up placement preview
        if (this.placementPreview) {
            this.placementPreview.dispose();
            this.placementPreview = null;
        }

        // Clean up raycast helper
        this.raycastHelper = null;

        // Destroy the ECS editor context (clears all entities and systems)
        if (this.editorContext) {
            this.editorContext.destroy();
            this.editorContext = null;
        }

        // Clean up gizmo manager
        if (this.gizmoManager) {
            this.gizmoManager.detach();
            this.gizmoManager.dispose();
            this.gizmoManager = null;
        }
        this.gizmoHelper = null;

        // Clear world renderer reference
        this.worldRenderer = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;

        // Clear editor loader
        this.editorLoader = null;

        // Clear terrain tile mapper
        this.terrainTileMapper = null;

        // Clear image/model managers (they're from editorContext)
        this.imageManager = null;
        this.modelManager = null;

        // Clear data references
        this.tileMap = null;
        this.objectData = null;
        this.worldObjects = {};
        this.levelEntities = [];
        this.selectedEntityId = null;

        // Reset initialization flag so next load starts fresh
        this.isInitializing = false;

        // Clear canvas buffers
        this.terrainCanvasBuffer = null;

        // Clear undo/redo history
        this.undoStack = [];
        this.redoStack = [];
    }
}