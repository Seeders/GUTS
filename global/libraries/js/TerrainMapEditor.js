class TerrainMapEditor {
    constructor(gameEditor, config = {}, { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory }) {
        this.gameEditor = gameEditor;
        this.engineClasses = { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory };
        this.defaultConfig = { gridSize: 48, imageSize: 128, canvasWidth: 1536, canvasHeight: 768 };
        this.config = { ...this.defaultConfig, ...config };

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
        // Terrain map structure without explicit IDs
        this.tileMap = {
            size: 16,
            terrainBGColor: "#7aad7b",
            terrainTypes: [
                { type: "start", color: "#ffff00", image: [] },
                { type: "end", color: "#ff0000", image: [] },
                { type: "path", color: "#eeae9e", image: [] },
                { type: "grass", color: "#7aad7b", image: [] },
                { type: "water", color: "#64b5f6", image: [] },
                { type: "rock", color: "#9e9e9e", image: [] }
            ],
            terrainMap: [],
            heightMap: [],  // Height levels independent of terrain types
            extensionHeight: 0  // Height for extension area
        };
        this.environmentObjects = this.tileMap.environmentObjects || [];
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
        this.canvasEl.width = this.config.canvasWidth;
        this.canvasEl.height = this.config.canvasHeight;

        // Clear any inline styles to ensure CSS controls the display size
        this.canvasEl.style.width = '';
        this.canvasEl.style.height = '';

        // Managers and renderers
        let palette = this.gameEditor.getPalette();
        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor,  { imageSize: this.config.imageSize, palette: palette}, {ShapeFactory: ShapeFactory});
        this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);
        this.modalId = 'modal-addTerrainType';
        // Bind methods to maintain correct context
        this.init();
    }

    init() {
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
            this.translator = new this.engineClasses.CoordinateTranslator(this.config, newGridSize, this.gameEditor.getCollections().configs.game.isIsometric);
            
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

        // Handle mouseup event (stop dragging)
        document.addEventListener('mouseup', () => {
            this.isMouseDown = false;
            this.lastPaintedTile = null; // Reset for next paint operation
        });

        // Add mouse down event for canvas
        this.canvasEl.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                if (this.deleteMode && this.tileMap.environmentObjects) {
                    this.deleteEnvironmentObjectAt(e);
                } else {
                    this.isMouseDown = true;
                    this.handle3DCanvasInteraction(e);
                }
            }
        });

        // Add mouse move event for drawing while dragging
        this.canvasEl.addEventListener('mousemove', (e) => {
            if (this.isMouseDown) {
                this.handle3DCanvasInteraction(e);
            }
        });

        // Add mouse leave event to clear placement preview
        this.canvasEl.addEventListener('mouseleave', () => {
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

        // Handle editTileMap event
        document.body.addEventListener('editTileMap', async (event) => {
            this.config = event.detail.config;
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
            this.canvasEl.width = this.config.canvasWidth;
            this.canvasEl.height = this.config.canvasHeight;

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

            if (!this.tileMap.environmentObjects) {
                this.tileMap.environmentObjects = [];
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
            this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.mapSize, this.gameEditor.getCollections().configs.game.isIsometric);

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

        // Terrain tool buttons
        document.getElementById('terrainBrushBtn').addEventListener('click', () => {
            this.terrainTool = 'brush';
            document.getElementById('terrainBrushBtn').classList.add('editor-module__btn--active');
            document.getElementById('terrainFillBtn').classList.remove('editor-module__btn--active');
            document.getElementById('terrainBrushSizeRow').style.display = 'flex';
        });

        document.getElementById('terrainFillBtn').addEventListener('click', () => {
            this.terrainTool = 'fill';
            document.getElementById('terrainFillBtn').classList.add('editor-module__btn--active');
            document.getElementById('terrainBrushBtn').classList.remove('editor-module__btn--active');
            document.getElementById('terrainBrushSizeRow').style.display = 'none';
        });

        // Terrain brush size
        document.getElementById('terrainBrushSize').addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            document.getElementById('terrainBrushSizeValue').textContent = this.brushSize;
        });

        // Height tool buttons
        document.getElementById('heightBrushBtn').addEventListener('click', () => {
            this.terrainTool = 'brush';
            document.getElementById('heightBrushBtn').classList.add('editor-module__btn--active');
            document.getElementById('heightFillBtn').classList.remove('editor-module__btn--active');
            document.getElementById('heightBrushSizeRow').style.display = 'flex';
        });

        document.getElementById('heightFillBtn').addEventListener('click', () => {
            this.terrainTool = 'fill';
            document.getElementById('heightFillBtn').classList.add('editor-module__btn--active');
            document.getElementById('heightBrushBtn').classList.remove('editor-module__btn--active');
            document.getElementById('heightBrushSizeRow').style.display = 'none';
        });

        // Height brush size
        document.getElementById('heightBrushSize').addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            document.getElementById('heightBrushSizeValue').textContent = this.brushSize;
        });

        this.canvasEl.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Prevent default context menu

            if (this.placementMode === 'environment' && this.tileMap.environmentObjects) {
                this.deleteEnvironmentObjectAt(e);
            }
        });
    }

    async initImageManager() {
        let palette = this.gameEditor.getPalette();
        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor, { imageSize: this.config.imageSize, palette: palette}, {ShapeFactory: this.engineClasses.ShapeFactory});
        await this.imageManager.loadImages("levels", { level: this.objectData }, false, false);
        if(this.worldObjects){
            await this.imageManager.loadImages("environment", this.worldObjects, false, false);
        }
        const terrainImages = this.imageManager.getImages("levels", "level");

        this.terrainTileMapper = this.gameEditor.editorModuleInstances.TileMap;
        if(!this.terrainCanvasBuffer) {
            this.terrainCanvasBuffer = document.createElement('canvas');
        }
        this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
        this.terrainCanvasBuffer.height =  this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
        if(!this.gameEditor.modelManager.assetsLoaded){
            let collections = this.gameEditor.getCollections();
            for(let objectType in collections) {            
                await this.gameEditor.modelManager.loadModels(objectType, collections[objectType]);
            }  
        } 
        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.gameEditor.getCollections().configs.game.gridSize, terrainImages, this.gameEditor.getCollections().configs.game.isIsometric);
        
        // Ensure translator is up to date before creating game object
        this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);
        
        this.game = { 
            state: {}, 
            modelManager: this.gameEditor.modelManager, 
            imageManager: this.imageManager, 
            canvasBuffer: this.canvasEl, 
            terrainCanvasBuffer: this.terrainCanvasBuffer, 
            terrainTileMapper: this.terrainTileMapper, 
            getCollections: this.gameEditor.getCollections.bind(this.gameEditor), 
            translator: this.translator
        };

        this.mapRenderer = new (this.gameEditor.scriptContext.getRenderer("MapRenderer"))(this.game, null);
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
    updatePreviewImage() {
        if (!this.selectedEnvironmentType || this.selectedEnvironmentItem === null) {
            return;
        }
        
        const images = this.imageManager.getImages("environment", this.selectedEnvironmentType);
        if (!images || !images.idle || !images.idle[0] || !images.idle[0][this.selectedEnvironmentItem]) {
            return;
        }
        
        const image = images.idle[0][this.selectedEnvironmentItem];
        
        // Resize preview canvas if needed
        const maxDimension = Math.max(image.width, image.height);
        const scale = this.config.imageSize / maxDimension;
        
        this.previewCanvas.width = image.width * scale;
        this.previewCanvas.height = image.height * scale;
        
        const ctx = this.previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        ctx.drawImage(image, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }


    setupTerrainImageProcessor() {
        this.terrainImageProcessor = new this.engineClasses.TerrainImageProcessor();
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
            if (this.deleteMode) {
            } else if (this.placementMode === 'environment' && 
                      this.selectedEnvironmentType && 
                      this.selectedEnvironmentItem !== null) {
                this.updatePreviewImage();
            }
        });
        
        const clearButton = document.createElement('button');
        clearButton.className = 'clear-all-btn';
        clearButton.innerHTML = 'Clear All Objects';
        clearButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to remove all environment objects?')) {
                this.tileMap.environmentObjects = [];
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
                const objectCount = (this.tileMap.environmentObjects || [])
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
                        preview.width = this.config.imageSize;
                        preview.height = this.config.imageSize;
                        const ctx = preview.getContext('2d');
                        
                        // Draw scaled down version of the image for preview with proper centering
                        const scale = Math.min(this.config.imageSize / image.width, this.config.imageSize / image.height);
                        ctx.drawImage(
                            image, 
                            (this.config.imageSize - image.width * scale) / 2, 
                            (this.config.imageSize - image.height * scale) / 2, 
                            image.width * scale, 
                            image.height * scale
                        );
                        
                        item.appendChild(preview);
                        
                        item.addEventListener('click', () => {
                            // Deselect any previously selected items
                            document.querySelectorAll('.terrain-editor__environment-item').forEach(i => i.classList.remove('active'));
                            
                            // Select this item
                            item.classList.add('active');
                            this.selectedEnvironmentType = type;
                            this.selectedEnvironmentItem = imageIndex;
                            this.placementMode = 'environment';
                              // Update preview image for cursor
                            this.updatePreviewImage();
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
                    // Empty state
                    itemsContainer.classList.add('empty');
                    const emptyMsg = document.createElement('div');
                    emptyMsg.textContent = 'No objects available for this type';
                    itemsContainer.appendChild(emptyMsg);
                }
                
                typeContainer.appendChild(itemsContainer);
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
                <span>${loc.side} team at (${loc.gridPosition.x}, ${loc.gridPosition.z})</span>
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
        // Get mouse position and convert to game coordinates
        let offsetY = (this.canvasEl.height - this.mapSize * this.config.gridSize) / 2;//48*4;
        const rect = this.canvasEl.getBoundingClientRect();
        // Account for CSS scaling of the canvas
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;
        let mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY - offsetY;

        if(!this.gameEditor.getCollections().configs.game.isIsometric) {
            mouseX -= (this.canvasEl.width - this.mapSize * this.config.gridSize) / 2;
        }
        
        const isoPos = { x: mouseX, y: mouseY };
        const pixelPos = this.translator.isoToPixel(isoPos.x, isoPos.y);
        
        // Find and remove any environment object near the click position
        const clickRadius = 30; // Radius for detecting objects to delete (in pixels)
        let deletedObject = false;
        
        for (let i = this.tileMap.environmentObjects.length - 1; i >= 0; i--) {
            const obj = this.tileMap.environmentObjects[i];
            const dx = obj.x - pixelPos.x;
            const dy = obj.y - pixelPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < clickRadius) {
                // Remove this object
                const deleted = this.tileMap.environmentObjects.splice(i, 1)[0];
                deletedObject = true;
                
                // Show feedback
                this.placementModeIndicator.textContent = `Deleted: ${deleted.type}`;
                this.placementModeIndicator.style.opacity = '1';
                
                // Hide indicator after a delay
                clearTimeout(this.indicatorTimeout);
                this.indicatorTimeout = setTimeout(() => {
                    this.placementModeIndicator.style.opacity = '0';
                }, 1500);
                
                // Update the map rendering
                
                // Update object counts
                this.updateObjectCounts();
                
                // Export the updated map
                this.exportMap();
                break; // Only remove one object at a time
            }
        }
        
        // Show feedback if no object was found to delete
        if (!deletedObject && this.deleteMode) {
            this.placementModeIndicator.textContent = 'No object found at this location';
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
            const objectCount = (this.tileMap.environmentObjects || [])
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
        const isIsometric = this.gameEditor.getCollections().configs.game.isIsometric;
        const gridSize = this.config.gridSize;

        if (isIsometric) {
            // For isometric: width needs to accommodate the diamond shape
            // Height is roughly half the width for isometric projection
            const requiredWidth = (this.mapSize * gridSize) + gridSize;
            const requiredHeight = (this.mapSize * gridSize * 0.5) + (gridSize * 0.5);

            // Add some padding
            this.config.canvasWidth = Math.max(1536, requiredWidth + 200);
            this.config.canvasHeight = Math.max(768, requiredHeight + 200);
        } else {
            // For non-isometric: simple square grid
            const requiredSize = this.mapSize * gridSize;

            // Add padding for centering
            this.config.canvasWidth = Math.max(1536, requiredSize + 400);
            this.config.canvasHeight = Math.max(768, requiredSize + 400);
        }

        // Set canvas internal resolution (bitmap size)
        this.canvasEl.width = this.config.canvasWidth;
        this.canvasEl.height = this.config.canvasHeight;

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
            let palette = this.gameEditor.getPalette();
            this.imageManager = new this.engineClasses.ImageManager(
                this.gameEditor,
                { imageSize: this.config.imageSize, palette: palette},
                {ShapeFactory: this.engineClasses.ShapeFactory}
            );

            // Load terrain sprite sheets for in-game graphics rendering
            await this.imageManager.loadImages("levels", { level: this.objectData }, false, false);
            const terrainImages = this.imageManager.getImages("levels", "level");

            // Load environment images if we have environment objects
            if (this.worldObjects && Object.keys(this.worldObjects).length > 0) {
                await this.imageManager.loadImages("environment", this.worldObjects, false, false);
            }

            // Initialize TileMap with actual sprite sheets
            this.terrainTileMapper = this.gameEditor.editorModuleInstances.TileMap;
            if (!this.terrainCanvasBuffer) {
                this.terrainCanvasBuffer = document.createElement('canvas');
            }
            this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
            this.terrainCanvasBuffer.height = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;

            // Init TileMap (for both 2D and 3D - 3D uses it for texture generation)
            this.terrainTileMapper.init(
                this.terrainCanvasBuffer,
                this.gameEditor.getCollections().configs.game.gridSize,
                terrainImages,
                this.gameEditor.getCollections().configs.game.isIsometric,
                { skipCliffTextures: false } // Enable cliffs for 3D
            );

            // Initialize 3D rendering
            await this.init3DRendering();
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Initialize 3D rendering system
     */
    async init3DRendering() {
        const collections = this.gameEditor.getCollections();
        const gameConfig = collections.configs.game;

        // Initialize TerrainDataManager
        if (!this.terrainDataManager) {
            this.terrainDataManager = new TerrainDataManager();
        }

        // Create a mock level structure for the editor
        const editorLevel = {
            world: this.objectData.world,
            tileMap: this.tileMap
        };

        // Temporarily add editor level to collections
        const tempLevelId = '__editor_level__';
        collections.levels = collections.levels || {};
        collections.levels[tempLevelId] = editorLevel;

        // Initialize terrain data
        this.terrainDataManager.init(collections, gameConfig, tempLevelId);

        // Initialize WorldRenderer
        if (!this.worldRenderer) {
            this.worldRenderer = new WorldRenderer({
                enableShadows: true,
                enableFog: false,
                enablePostProcessing: false,
                enableGrass: false,
                enableLiquidSurfaces: false,
                enableCliffs: true
            });
        }

        // Get world and camera settings
        const world = collections.worlds?.[this.objectData.world];
        const cameraSettings = world ? collections.cameras?.[world.camera] : {
            position: { x: 0, y: 600, z: 600 },
            lookAt: { x: 0, y: 0, z: 0 },
            zoom: 1,
            near: 0.1,
            far: 30000
        };

        // Initialize Three.js scene
        this.worldRenderer.initializeThreeJS(this.canvasEl, cameraSettings, true);

        // Set background
        this.worldRenderer.setBackgroundColor(world?.backgroundColor || '#87CEEB');

        // Setup lighting
        this.worldRenderer.setupLighting(
            world?.lighting,
            world?.shadows,
            this.terrainDataManager.extendedSize
        );

        // Setup ground with terrain data
        this.worldRenderer.setupGround(
            this.terrainDataManager,
            this.terrainTileMapper,
            this.terrainDataManager.heightMapSettings
        );

        // Render terrain
        this.worldRenderer.renderTerrain();

        // Create extension planes
        this.worldRenderer.createExtensionPlanes();

        // Initialize RaycastHelper
        if (!this.raycastHelper) {
            this.raycastHelper = new RaycastHelper(
                this.worldRenderer.getCamera(),
                this.worldRenderer.getScene()
            );
        }

        // Initialize PlacementPreview for tile preview
        if (!this.placementPreview) {
            this.placementPreview = new PlacementPreview({
                scene: this.worldRenderer.getScene(),
                gridSize: gameConfig.gridSize,
                getTerrainHeight: (x, z) => this.terrainDataManager.getTerrainHeightAtPosition(x, z)
            });

            // Configure for editor use
            this.placementPreview.updateConfig({
                cellOpacity: 0.5,
                borderOpacity: 0.9,
                elevationOffset: 1.0 // Slightly above terrain
            });
        }

        // Start render loop
        this.start3DRenderLoop();

        console.log('3D terrain editor initialized');
    }

    /**
     * Start the 3D render loop
     */
    start3DRenderLoop() {
        const render = () => {
            if (false || !this.worldRenderer) return;

            const deltaTime = this.worldRenderer.clock.getDelta();
            this.worldRenderer.update(deltaTime);
            this.worldRenderer.render();

            this.animationFrameId = requestAnimationFrame(render);
        };

        render();
    }

    /**
     * Stop the 3D render loop
     */
    stop3DRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
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

        return modifiedTiles;
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
        }

        return true;
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

        return true;
    }

    /**
     * Handle mouse interaction in 3D mode using raycasting
     */
    handle3DCanvasInteraction(event) {
        if (!this.raycastHelper || !this.worldRenderer || !this.terrainDataManager) return;

        // Get normalized device coordinates
        const rect = this.canvasEl.getBoundingClientRect();
        this.mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast to get world position
        const worldPos = this.raycastHelper.rayCastGround(
            this.mouseNDC.x,
            this.mouseNDC.y,
            this.worldRenderer.getGroundMesh()
        );

        if (!worldPos) {
            // Hide preview if raycast fails
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
            if (this.placementPreview) {
                this.placementPreview.hide();
            }
            return;
        }

        // Show preview for affected tiles (based on brush size)
        this.showTilePreview(gridX, gridZ);

        // Handle painting when mouse is down
        if (!this.isMouseDown) return;

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
                    this.floodFillTerrain(gridX, gridZ, this.currentTerrainId);
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
                if (!this.isMouseDown || this.lastPaintedTile === null) {
                    this.floodFillHeight(gridX, gridZ, this.currentHeightLevel);
                    this.lastPaintedTile = `${gridX},${gridZ}`;
                }
            }

            if (modifiedTiles.length > 0) {
                // Update 3D height mesh for modified tiles
                this.update3DHeightRegion(modifiedTiles);
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

        // Check if any tiles would actually be modified
        const wouldModify = this.wouldModifyTiles(affectedTiles);

        // Show preview (green if would modify, yellow/orange if no change)
        this.placementPreview.showAtWorldPositions(worldPositions, wouldModify, true);
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
}