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
        this.environmentObjectSpawner = null; // Shared spawner for environment objects
        this.placementPreview = null; // Placement preview for tile editing
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
        this.selectedEnvironmentType = null;
        this.selectedEnvironmentItem = null;
        this.placementMode = 'terrain'; // can be 'terrain', 'environment', 'ramp', 'height', or 'placements'
        this.terrainTool = 'brush'; // can be 'brush' or 'fill'
        this.brushSize = 1; // Default brush size (1x1)

        // Entity placements (starting locations, units, buildings)
        this.startingLocations = [];
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
        this.setupEnvironmentPanel();
        this.setupEventListeners();
        this.updateTerrainStyles();
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
                if (this.deleteMode && this.tileMap.worldObjects) {
                    this.deleteEnvironmentObjectAt(e);
                } else {
                    this.isMouseDown = true;
                    // Immediately trigger raycast and painting for instant click response
                    // The raycast interval will continue handling during drag operations
                    this.updateGridPositionFromRaycast();
                }
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

        // Add keyboard shortcuts for undo/redo
        document.addEventListener('keydown', (event) => {
            // Undo: Ctrl+Z (or Cmd+Z on Mac)
            if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
                event.preventDefault();
                this.undo();
            }
            // Redo: Ctrl+Shift+Z or Ctrl+Y (or Cmd+Shift+Z / Cmd+Y on Mac)
            else if ((event.ctrlKey || event.metaKey) && (event.shiftKey && event.key === 'z' || event.key === 'y')) {
                event.preventDefault();
                this.redo();
            }
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

            if (!this.tileMap.worldObjects) {
                this.tileMap.worldObjects = [];
            }

            // Load placements data
            this.startingLocations = this.tileMap.startingLocations || [];
            this.entityPlacements = this.tileMap.entityPlacements || [];

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

        document.getElementById('terrainsBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.add('active');
            document.getElementById('heightsBtn').classList.remove('active');
            document.getElementById('environmentBtn').classList.remove('active');
            document.getElementById('rampsBtn').classList.remove('active');

            document.getElementById('terrainsPanel').style.display = 'block';
            document.getElementById('heightsPanel').style.display = 'none';
            document.getElementById('environmentPanel').style.display = 'none';
            document.getElementById('rampsPanel').style.display = 'none';
            this.placementMode = 'terrain';

            // Update placement indicator
            this.placementModeIndicator.textContent = 'Placement Mode: Terrain';
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });

        document.getElementById('heightsBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.remove('active');
            document.getElementById('heightsBtn').classList.add('active');
            document.getElementById('environmentBtn').classList.remove('active');
            document.getElementById('rampsBtn').classList.remove('active');

            document.getElementById('terrainsPanel').style.display = 'none';
            document.getElementById('heightsPanel').style.display = 'block';
            document.getElementById('environmentPanel').style.display = 'none';
            document.getElementById('rampsPanel').style.display = 'none';
            this.placementMode = 'height';

            // Setup height levels UI
            this.setupHeightLevelsUI();

            this.placementModeIndicator.textContent = 'Placement Mode: Heights';
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });

        document.getElementById('environmentBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.remove('active');
            document.getElementById('heightsBtn').classList.remove('active');
            document.getElementById('environmentBtn').classList.add('active');
            document.getElementById('rampsBtn').classList.remove('active');
            document.getElementById('terrainsPanel').style.display = 'none';
            document.getElementById('heightsPanel').style.display = 'none';
            document.getElementById('environmentPanel').style.display = 'block';
            document.getElementById('rampsPanel').style.display = 'none';
            this.placementMode = 'environment';

            // Make sure environment panel is set up
            this.setupEnvironmentPanel();

            // Trigger re-render to hide height overlay

            this.placementModeIndicator.textContent = 'Placement Mode: Environment';
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });

        document.getElementById('rampsBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.remove('active');
            document.getElementById('heightsBtn').classList.remove('active');
            document.getElementById('environmentBtn').classList.remove('active');
            document.getElementById('rampsBtn').classList.add('active');
            if (document.getElementById('placementsBtn')) {
                document.getElementById('placementsBtn').classList.remove('active');
            }
            document.getElementById('terrainsPanel').style.display = 'none';
            document.getElementById('heightsPanel').style.display = 'none';
            document.getElementById('environmentPanel').style.display = 'none';
            document.getElementById('rampsPanel').style.display = 'block';
            if (document.getElementById('placementsPanel')) {
                document.getElementById('placementsPanel').style.display = 'none';
            }
            this.placementMode = 'ramp';

            // Update ramp count display
            this.updateRampCount();

            this.placementModeIndicator.textContent = 'Placement Mode: Ramps';
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });

        // Placements button
        if (document.getElementById('placementsBtn')) {
            document.getElementById('placementsBtn').addEventListener('click', () => {
                document.getElementById('terrainsBtn').classList.remove('active');
                document.getElementById('heightsBtn').classList.remove('active');
                document.getElementById('environmentBtn').classList.remove('active');
                document.getElementById('rampsBtn').classList.remove('active');
                document.getElementById('placementsBtn').classList.add('active');
                document.getElementById('terrainsPanel').style.display = 'none';
                document.getElementById('heightsPanel').style.display = 'none';
                document.getElementById('environmentPanel').style.display = 'none';
                document.getElementById('rampsPanel').style.display = 'none';
                document.getElementById('placementsPanel').style.display = 'block';
                this.placementMode = 'placements';

                // Setup placements panel
                this.setupPlacementsPanel();

                this.placementModeIndicator.textContent = 'Placement Mode: Entity Placements';
                this.placementModeIndicator.style.opacity = '1';

                // Hide indicator after a delay
                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 2000);
            });
        }

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

            if (this.placementMode === 'environment' && this.tileMap.worldObjects) {
                this.deleteEnvironmentObjectAt(e);
            }
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
    

    setupEnvironmentPanel() {
        const environmentPanel = document.getElementById('environmentPanel');
        if (!environmentPanel) {
            // Create the panel if it doesn't exist
            const panel = document.createElement('div');
            panel.id = 'environmentPanel';
            panel.style.display = 'none'; // Hidden by default
            document.querySelector('.editor-module__scroll-y').appendChild(panel);
        } else {
            // Clear existing content
            environmentPanel.innerHTML = '';
        }
    
        // Create object controls
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'object-controls';
        
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-btn';
        deleteButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M10 11v6M14 11v6"/></svg> Delete Mode';
        deleteButton.addEventListener('click', () => {
            deleteButton.classList.toggle('delete-mode');
            document.body.classList.toggle('delete-mode-active');
            this.deleteMode = deleteButton.classList.contains('delete-mode');
        });
        
        const clearButton = document.createElement('button');
        clearButton.className = 'clear-all-btn';
        clearButton.innerHTML = 'Clear All Objects';
        clearButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to remove all environment objects?')) {
                this.tileMap.worldObjects = [];
                this.updateWorldObjects();
                this.exportMap();
                this.updateObjectCounts();
            }
        });
        
        controlsDiv.appendChild(deleteButton);
        controlsDiv.appendChild(clearButton);
        environmentPanel.appendChild(controlsDiv);
        
        // Create placement mode indicator (hidden by default)
        const indicator = document.createElement('div');
        indicator.className = 'placement-mode-indicator';
        indicator.style.opacity = '0';
        indicator.textContent = 'Placement Mode: Terrain';
        document.querySelector('.editor-module__canvas-area').appendChild(indicator);
        this.placementModeIndicator = indicator;
    
        // Create environment object selector
        if (this.worldObjects) {
            const container = document.createElement('div');
            container.className = 'terrain-editor__environment-objects-container';

            // Add header
            const header = document.createElement('h3');
            header.textContent = 'Environment Objects';
            container.appendChild(header);

            // Create object type list
            for (const type in this.worldObjects) {
                const typeContainer = document.createElement('div');
                typeContainer.className = 'terrain-editor__environment-type';
                
                // Count objects of this type
                const objectCount = (this.tileMap.worldObjects || [])
                    .filter(obj => obj.type === type).length;
                
                const typeHeader = document.createElement('div');
                typeHeader.className = 'terrain-editor__environment-type-header';
                typeHeader.textContent = type;

                // Add count badge
                const countBadgeContainer = document.createElement('span');
                countBadgeContainer.className = 'terrain-editor__object-count-container';
                const countBadge = document.createElement('span');
                countBadge.className = 'terrain-editor__object-count';
                countBadge.textContent = objectCount;
                countBadgeContainer.appendChild(countBadge);
                typeHeader.appendChild(countBadgeContainer);

                typeHeader.addEventListener('click', () => {
                    const content = typeContainer.querySelector('.terrain-editor__environment-items');
                    const isOpen = content.style.display !== 'none';
                    content.style.display = isOpen ? 'none' : 'flex';
                    typeHeader.classList.toggle('open', !isOpen);
                });
                typeContainer.appendChild(typeHeader);

                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'terrain-editor__environment-items';
                itemsContainer.style.display = 'none';

                // Get images for this type
                const images = this.imageManager.getImages("environment", type);
                if (images && images.idle && images.idle[0] && images.idle[0].length > 0) {
                    images.idle[0].forEach((image, imageIndex) => {
                        const item = document.createElement('div');
                        item.className = 'terrain-editor__environment-item';
                        item.dataset.name = `${type} ${imageIndex + 1}`;

                        const preview = document.createElement('canvas');
                        preview.width = this.editorSettings.imageSize;
                        preview.height = this.editorSettings.imageSize;
                        const ctx = preview.getContext('2d');

                        // Draw scaled down version of the image for preview with proper centering
                        const scale = Math.min(this.editorSettings.imageSize / image.width, this.editorSettings.imageSize / image.height);
                        ctx.drawImage(
                            image,
                            (this.editorSettings.imageSize - image.width * scale) / 2,
                            (this.editorSettings.imageSize - image.height * scale) / 2,
                            image.width * scale,
                            image.height * scale
                        );

                        item.appendChild(preview);

                        item.addEventListener('click', () => {
                            // Deselect any previously selected items
                            document.querySelectorAll('.terrain-editor__environment-item').forEach(i => i.classList.remove('active'));

                            // Select this item
                            item.classList.add('active');
                            this.selectedObjectType = type;
                            this.selectedEnvironmentItem = imageIndex;
                            this.placementMode = 'environment';

                            // Update placement indicator
                            this.placementModeIndicator.textContent = `Placing: ${type} ${imageIndex + 1}`;
                            this.placementModeIndicator.style.opacity = '1';

                            // Auto-disable delete mode when selecting an object
                            if (this.deleteMode) {
                                deleteButton.classList.remove('delete-mode');
                                document.body.classList.remove('delete-mode-active');
                                this.deleteMode = false;
                            }

                            // Hide indicator after a delay
                            clearTimeout(this.indicatorTimeout);
                            this.indicatorTimeout = setTimeout(() => {
                                this.placementModeIndicator.style.opacity = '0';
                            }, 2000);
                        });

                        itemsContainer.appendChild(item);
                    });
                } else {
                    // No images available - create a simple text button for this world object type
                    const item = document.createElement('div');
                    item.className = 'terrain-editor__environment-item terrain-editor__environment-item--text';
                    item.dataset.name = type;

                    const label = document.createElement('span');
                    label.className = 'terrain-editor__environment-item-label';
                    label.textContent = this.worldObjects[type]?.title || type;
                    item.appendChild(label);

                    item.addEventListener('click', () => {
                        // Deselect any previously selected items
                        document.querySelectorAll('.terrain-editor__environment-item').forEach(i => i.classList.remove('active'));

                        // Select this item
                        item.classList.add('active');
                        this.selectedObjectType = type;
                        this.selectedEnvironmentItem = 0;
                        this.placementMode = 'environment';

                        // Update placement indicator
                        this.placementModeIndicator.textContent = `Placing: ${type}`;
                        this.placementModeIndicator.style.opacity = '1';

                        // Auto-disable delete mode when selecting an object
                        if (this.deleteMode) {
                            deleteButton.classList.remove('delete-mode');
                            document.body.classList.remove('delete-mode-active');
                            this.deleteMode = false;
                        }

                        // Hide indicator after a delay
                        clearTimeout(this.indicatorTimeout);
                        this.indicatorTimeout = setTimeout(() => {
                            this.placementModeIndicator.style.opacity = '0';
                        }, 2000);
                    });

                    itemsContainer.appendChild(item);
                }

                typeContainer.appendChild(itemsContainer);

                // Add delete all button for this type
                const deleteAllBtn = document.createElement('button');
                deleteAllBtn.className = 'editor-module__btn editor-module__btn--danger editor-module__btn--small';
                deleteAllBtn.textContent = `Delete All ${type}`;
                deleteAllBtn.style.marginTop = '8px';
                deleteAllBtn.style.width = '100%';
                deleteAllBtn.addEventListener('click', () => {
                    if (confirm(`Are you sure you want to delete all ${type} objects?`)) {
                        // Remove all objects of this type
                        if (this.tileMap.worldObjects) {
                            this.tileMap.worldObjects = this.tileMap.worldObjects.filter(obj => obj.type !== type);
                            this.updateWorldObjects();
                            this.exportMap();

                            // Update count badge
                            countBadge.textContent = '0';

                            // Show feedback
                            this.placementModeIndicator.textContent = `Deleted all ${type} objects`;
                            this.placementModeIndicator.style.opacity = '1';
                            setTimeout(() => {
                                this.placementModeIndicator.style.opacity = '0';
                            }, 2000);
                        }
                    }
                });
                typeContainer.appendChild(deleteAllBtn);

                container.appendChild(typeContainer);
            }
            
            environmentPanel.appendChild(container);
        } else {
            const message = document.createElement('p');
            message.textContent = 'No environment objects available.';
            environmentPanel.appendChild(message);
        }
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

    setupPlacementsPanel() {
        const placementsPanel = document.getElementById('placementsPanel');
        if (!placementsPanel) return;

        // Clear existing content
        placementsPanel.innerHTML = '';

        // Create Starting Locations section
        const startingLocSection = document.createElement('div');
        startingLocSection.className = 'editor-module__section';

        const startingLocHeader = document.createElement('h3');
        startingLocHeader.className = 'editor-module__section-title';
        startingLocHeader.textContent = 'Starting Locations';
        startingLocSection.appendChild(startingLocHeader);

        const startingLocInfo = document.createElement('div');
        startingLocInfo.className = 'editor-module__info-box';
        startingLocInfo.innerHTML = '<p>Click on the map to place starting locations for each team.</p>';
        startingLocSection.appendChild(startingLocInfo);

        // Starting location buttons
        const startingLocButtons = document.createElement('div');
        startingLocButtons.className = 'terrain-editor__placement-buttons';

        ['left', 'right'].forEach(side => {
            const btn = document.createElement('button');
            btn.className = 'editor-module__btn editor-module__btn--small';
            btn.textContent = `${side.charAt(0).toUpperCase() + side.slice(1)} Team Start`;
            btn.dataset.placementType = 'startingLocation';
            btn.dataset.side = side;

            btn.addEventListener('click', () => {
                // Deselect all placement buttons
                document.querySelectorAll('.terrain-editor__placement-buttons button').forEach(b => b.classList.remove('active'));

                btn.classList.add('active');
                this.selectedPlacementType = 'startingLocation';
                this.selectedEntityType = side;

                this.placementModeIndicator.textContent = `Placing: ${side} team starting location`;
                this.placementModeIndicator.style.opacity = '1';

                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 2000);
            });

            startingLocButtons.appendChild(btn);
        });

        startingLocSection.appendChild(startingLocButtons);

        // Display current starting locations
        const startingLocList = document.createElement('div');
        startingLocList.className = 'terrain-editor__placement-list';
        startingLocList.id = 'startingLocationsList';
        this.updateStartingLocationsList(startingLocList);
        startingLocSection.appendChild(startingLocList);

        placementsPanel.appendChild(startingLocSection);

        // Buildings section
        const buildingsSection = document.createElement('div');
        buildingsSection.className = 'editor-module__section';

        const buildingsHeader = document.createElement('h3');
        buildingsHeader.className = 'editor-module__section-title';
        buildingsHeader.textContent = 'Buildings';
        buildingsSection.appendChild(buildingsHeader);

        const buildingsInfo = document.createElement('div');
        buildingsInfo.className = 'editor-module__info-box';
        buildingsInfo.innerHTML = '<p>Place buildings like Gold Mines on the map. Gold Mines must be placed on gold veins.</p>';
        buildingsSection.appendChild(buildingsInfo);

        // Building type buttons
        const buildingButtons = document.createElement('div');
        buildingButtons.className = 'terrain-editor__placement-buttons';

        const buildingTypes = ['goldMine', 'townHall'];
        buildingTypes.forEach(buildingType => {
            const btn = document.createElement('button');
            btn.className = 'editor-module__btn editor-module__btn--small';
            btn.textContent = buildingType === 'goldMine' ? 'Gold Mine' : 'Town Hall';
            btn.dataset.placementType = 'building';
            btn.dataset.buildingType = buildingType;

            btn.addEventListener('click', () => {
                // Deselect all placement buttons
                document.querySelectorAll('.terrain-editor__placement-buttons button').forEach(b => b.classList.remove('active'));

                btn.classList.add('active');
                this.selectedPlacementType = 'building';
                this.selectedEntityType = buildingType;

                this.placementModeIndicator.textContent = `Placing: ${buildingType}`;
                this.placementModeIndicator.style.opacity = '1';

                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 2000);
            });

            buildingButtons.appendChild(btn);
        });

        buildingsSection.appendChild(buildingButtons);
        placementsPanel.appendChild(buildingsSection);

        // Units section
        const unitsSection = document.createElement('div');
        unitsSection.className = 'editor-module__section';

        const unitsHeader = document.createElement('h3');
        unitsHeader.className = 'editor-module__section-title';
        unitsHeader.textContent = 'Units';
        unitsSection.appendChild(unitsHeader);

        const unitsInfo = document.createElement('div');
        unitsInfo.className = 'editor-module__info-box';
        unitsInfo.innerHTML = '<p>Place starting units on the map.</p>';
        unitsSection.appendChild(unitsInfo);

        // Unit type buttons
        const unitButtons = document.createElement('div');
        unitButtons.className = 'terrain-editor__placement-buttons';

        const unitTypes = ['peasant'];
        unitTypes.forEach(unitType => {
            const btn = document.createElement('button');
            btn.className = 'editor-module__btn editor-module__btn--small';
            btn.textContent = unitType.charAt(0).toUpperCase() + unitType.slice(1);
            btn.dataset.placementType = 'unit';
            btn.dataset.unitType = unitType;

            btn.addEventListener('click', () => {
                // Deselect all placement buttons
                document.querySelectorAll('.terrain-editor__placement-buttons button').forEach(b => b.classList.remove('active'));

                btn.classList.add('active');
                this.selectedPlacementType = 'unit';
                this.selectedEntityType = unitType;

                this.placementModeIndicator.textContent = `Placing: ${unitType}`;
                this.placementModeIndicator.style.opacity = '1';

                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 2000);
            });

            unitButtons.appendChild(btn);
        });

        unitsSection.appendChild(unitButtons);
        placementsPanel.appendChild(unitsSection);

        // Clear all placements button
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'editor-module__btn editor-module__btn--danger';
        clearAllBtn.textContent = 'Clear All Placements';
        clearAllBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all entity placements?')) {
                this.startingLocations = [];
                this.entityPlacements = [];
                this.updateStartingLocationsList(document.getElementById('startingLocationsList'));
                this.exportMap();
            }
        });
        placementsPanel.appendChild(clearAllBtn);
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

    deleteEnvironmentObjectAt(e) {
        // Use cached grid position from raycasting
        if (!this.cachedGridPosition) {
            return;
        }

        const gridX = this.cachedGridPosition.x;
        const gridZ = this.cachedGridPosition.z;
        const radius = Math.floor(this.brushSize / 2);

        // Calculate brush area in grid coordinates
        const objectsToDelete = [];

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const targetGridX = gridX + dx;
                const targetGridZ = gridZ + dy;

                // Check bounds
                if (targetGridX >= 0 && targetGridX < this.mapSize &&
                    targetGridZ >= 0 && targetGridZ < this.mapSize) {

                    // Check if within brush radius (circular brush)
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius + 0.5) {
                        // Find any environment objects at this grid position
                        for (let i = this.tileMap.worldObjects.length - 1; i >= 0; i--) {
                            const obj = this.tileMap.worldObjects[i];

                            // Check if object is at this grid position
                            if (obj.gridX === targetGridX && obj.gridZ === targetGridZ) {
                                objectsToDelete.push(i);
                            }
                        }
                    }
                }
            }
        }

        // Delete all found objects
        if (objectsToDelete.length > 0) {
            // Sort indices in descending order to remove from end first
            objectsToDelete.sort((a, b) => b - a);

            for (const index of objectsToDelete) {
                this.tileMap.worldObjects.splice(index, 1);
            }

            // Show feedback
            this.placementModeIndicator.textContent = `Deleted ${objectsToDelete.length} object(s)`;
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 1500);

            // Update object counts
            this.updateObjectCounts();

            // Update 3D spawned environment objects
            this.updateWorldObjects();

            // Export the updated map
            this.exportMap();
        } else if (this.deleteMode) {
            // Show feedback if no objects were found
            this.placementModeIndicator.textContent = 'No objects found in brush area';
            this.placementModeIndicator.style.opacity = '1';

            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 1500);
        }
    }
    updateObjectCounts() {
        if (!document.getElementById('environmentPanel')) return;
        
        // Update count badges
        for (const type in this.worldObjects) {
            const objectCount = (this.tileMap.worldObjects || [])
                .filter(obj => obj.type === type).length;

            // Find all headers first
            const headers = document.querySelectorAll('.terrain-editor__environment-type-header');
            // Find the specific header containing the type name
            for (const header of headers) {
                if (header.textContent.includes(type)) {
                    // Get the count badge within this header
                    const countBadge = header.querySelector('.terrain-editor__object-count');
                    if (countBadge) {
                        countBadge.textContent = objectCount;
                    }
                    break; // Found the right header, no need to continue
                }
            }
        }
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

        // Load scene with terrain entity (components must be array format)
        await this.editorContext.loadScene({
            systems: editorSystems,
            entities: [{
                id: 'terrain_entity',
                components: [{
                    terrain: {
                        level: levelName,
                        world: this.objectData.world,
                        shadowsEnabled: true,
                        fogEnabled: false,
                        grassEnabled: false,
                        cliffsEnabled: true
                    }
                }]
            }]
        });

        // Get references from systems for editor functionality
        this.worldRenderer = this.editorContext.worldSystem?.worldRenderer;
        this.entityRenderer = this.editorContext.renderSystem?.entityRenderer;
        this.terrainDataManager = this.editorContext.terrainSystem?.terrainDataManager;
        this.environmentObjectSpawner = this.editorContext.terrainSystem?.environmentObjectSpawner;

        // Replace camera with perspective camera for editor
        if (this.worldRenderer) {
            const terrainSize = this.terrainDataManager?.terrainSize || 1536;
            const canvas = this.canvasEl;
            const width = canvas.clientWidth || window.innerWidth;
            const height = canvas.clientHeight || window.innerHeight;

            // Map is centered at 0,0 - so corners are at +/- terrainSize/2
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

        console.log('3D terrain editor initialized with ECS systems');
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

        } else if (this.placementMode === 'environment') {
            // Place environment object(s) with brush size support
            if (this.selectedObjectType && this.lastPaintedTile === null) {
                if (!this.tileMap.worldObjects) {
                    this.tileMap.worldObjects = [];
                }

                const radius = Math.floor(this.brushSize / 2);
                let objectsPlaced = 0;

                // Place objects in circular brush pattern
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const targetGridX = gridX + dx;
                        const targetGridZ = gridZ + dy;

                        // Check bounds
                        if (targetGridX >= 0 && targetGridX < this.mapSize &&
                            targetGridZ >= 0 && targetGridZ < this.mapSize) {

                            // Check if within brush radius (circular brush)
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance <= radius + 0.5) {
                                // Check if object already exists at this grid position
                                const existingIndex = this.tileMap.worldObjects.findIndex(
                                    obj => obj.gridX === targetGridX && obj.gridZ === targetGridZ
                                );

                                if (existingIndex === -1) {
                                    // Add new environment object with grid coordinates
                                    this.tileMap.worldObjects.push({
                                        type: this.selectedObjectType,
                                        gridX: targetGridX,
                                        gridZ: targetGridZ
                                    });
                                    objectsPlaced++;
                                }
                            }
                        }
                    }
                }

                // Respawn all environment objects if any were placed
                if (objectsPlaced > 0) {
                    this.updateWorldObjects();
                }

                this.lastPaintedTile = `${gridX},${gridZ}`;
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
        // Add placements to tileMap before saving
        this.tileMap.startingLocations = this.startingLocations;
        this.tileMap.entityPlacements = this.entityPlacements;

        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveTileMap', {
            detail: {
                data: this.tileMap,  // tileMap now includes heightMap array, startingLocations, and entityPlacements
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

        // Clear world renderer reference
        this.worldRenderer = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;
        this.environmentObjectSpawner = null;

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

        // Reset initialization flag so next load starts fresh
        this.isInitializing = false;

        // Clear canvas buffers
        this.terrainCanvasBuffer = null;

        // Clear undo/redo history
        this.undoStack = [];
        this.redoStack = [];
    }
}