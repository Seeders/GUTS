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
        this.needsRender = false;
        this.exportDebounceTimer = null;
        this.renderAnimationFrame = null;
        this.previewAnimationFrame = null;
        this.pendingPreviewEvent = null;
        this.isInitializing = false;
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

        // DOM elements
        this.canvasEl = document.getElementById('grid');
        this.canvasEl.width = this.config.canvasWidth;
        this.canvasEl.height = this.config.canvasHeight;

        // Clear any inline styles to ensure CSS controls the display size
        this.canvasEl.style.width = '';
        this.canvasEl.style.height = '';

        // Preview elements for cursor
        this.previewCanvas = null;
        this.currentPreviewImage = null;
        this.hoverGridPosition = null; // Track mouse position for brush preview

        // Managers and renderers
        let palette = this.gameEditor.getPalette();
        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor,  { imageSize: this.config.imageSize, palette: palette}, {ShapeFactory: ShapeFactory});
        this.mapRenderer = null;
        this.mapManager = null;

        this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);
        this.terrainCanvasBuffer = document.createElement('canvas');
        this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
        this.terrainCanvasBuffer.height =  this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;

        console.log(this.tileMap.size, this.terrainCanvasBuffer.width, this.terrainCanvasBuffer.height);
        this.modalId = 'modal-addTerrainType';
        // Bind methods to maintain correct context
        this.init();
    }

    init() {
        this.setupTerrainTypesUI();
        this.setupTerrainImageProcessor();
        this.setupEnvironmentPanel();
        this.createPreviewCanvas();
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
                this.tileMap.terrainTypes[this.currentTerrainId].texture = textureName;
                this.terrainImageProcessor.processImage(this.gameEditor.getCollections().textures[textureName].image);
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
            
            // Ensure final render happens (no auto-save)
            if (this.needsRender) {
                this.updateCanvasWithData();
                this.needsRender = false;
            }
        });

        // Add mouse down event for canvas
        this.canvasEl.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                if (this.deleteMode && this.tileMap.environmentObjects) {
                    this.deleteEnvironmentObjectAt(e);
                } else {
                    this.isMouseDown = true;
                    this.handleCanvasInteraction(e);
                }
            }
        });
        
        // Add mouse move event for drawing while dragging
        this.canvasEl.addEventListener('mousemove', (e) => {
            // Throttle preview position updates using requestAnimationFrame
            this.pendingPreviewEvent = e;
            if (!this.previewAnimationFrame) {
                this.previewAnimationFrame = requestAnimationFrame(() => {
                    this.updatePreviewPosition(this.pendingPreviewEvent);
                    this.updateBrushPreview(this.pendingPreviewEvent);
                    this.previewAnimationFrame = null;
                });
            }

            if (this.isMouseDown) {
                this.handleCanvasInteraction(e);
            }
        });

        // Add mouse leave event to clear brush preview
        this.canvasEl.addEventListener('mouseleave', () => {
            this.hoverGridPosition = null;
            if (this.placementMode === 'terrain' || this.placementMode === 'height') {
                this.needsRender = true;
                this.scheduleRender();
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
            if(this.tileMap.extensionTerrainType){
                this.canvasEl.backgroundColor = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType].color;
            } else {
                this.canvasEl.backgroundColor = this.tileMap.terrainTypes[4].color;
                this.tileMap.extensionTerrainType = 4; // Default to grass if not set
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
            // Strip id from terrainTypes if present, assume order is correct
            this.tileMap.terrainTypes.forEach((terrain, index) => {
                const newOption = document.createElement('option');
                newOption.value = index;
                newOption.textContent = terrain.type;
                if (index === this.tileMap.extensionTerrainType) {
                    newOption.selected = true;
                }
                extensionTerrainTypeSelector.appendChild(newOption);
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
            this.previewCanvas.style.display = 'none';

            // Trigger re-render to hide height overlay
            this.needsRender = true;
            this.scheduleRender();

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
            this.previewCanvas.style.display = 'none';

            // Setup height levels UI
            this.setupHeightLevelsUI();

            // Trigger re-render to show height overlay
            this.needsRender = true;
            this.scheduleRender();

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
            this.needsRender = true;
            this.scheduleRender();

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
            this.previewCanvas.style.display = 'none';

            // Update ramp count display
            this.updateRampCount();

            // Trigger re-render to show height overlay
            this.needsRender = true;
            this.scheduleRender();

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
                this.previewCanvas.style.display = 'none';

                // Setup placements panel
                this.setupPlacementsPanel();

                // Trigger re-render
                this.needsRender = true;
                this.scheduleRender();

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
                this.needsRender = true;
                this.scheduleRender();
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
            this.currentPreviewImage = null;
            return;
        }
        
        const images = this.imageManager.getImages("environment", this.selectedEnvironmentType);
        if (!images || !images.idle || !images.idle[0] || !images.idle[0][this.selectedEnvironmentItem]) {
            this.currentPreviewImage = null;
            return;
        }
        
        const image = images.idle[0][this.selectedEnvironmentItem];
        this.currentPreviewImage = image;
        
        // Resize preview canvas if needed
        const maxDimension = Math.max(image.width, image.height);
        const scale = this.config.imageSize / maxDimension;
        
        this.previewCanvas.width = image.width * scale;
        this.previewCanvas.height = image.height * scale;
        
        const ctx = this.previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        ctx.drawImage(image, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }
    updatePreviewPosition(e) {
        if (this.placementMode !== 'environment' ||
            !this.selectedEnvironmentType ||
            this.selectedEnvironmentItem === null ||
            this.deleteMode ||
            !this.currentPreviewImage) {
            this.previewCanvas.style.display = 'none';
            return;
        }

        // Get mouse position relative to canvas
        const rect = this.canvasEl.getBoundingClientRect();
        // Account for CSS scaling of the canvas
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;
        let mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        if (!this.gameEditor.getCollections().configs.game.isIsometric) {
            mouseX -= (this.canvasEl.width - this.mapSize * this.config.gridSize) / 2;
        }

        // For isometric view, we need to convert cursor position to actual object position
        let posX, posY;
        if (this.gameEditor.getCollections().configs.game.isIsometric) {
            const isoPos = { x: mouseX, y: mouseY };
            const pixelPos = this.translator.isoToPixel(isoPos.x, isoPos.y);

            // Convert back to screen coordinates
            const screenPos = this.translator.pixelToIso(pixelPos.x, pixelPos.y);
            posX = screenPos.x + rect.left;
            posY = screenPos.y + rect.top;
        } else {
            // For non-isometric, just use the mouse position
            posX = e.clientX;
            posY = e.clientY;
        }
        posX = e.clientX + window.scrollX;
        posY = e.clientY + window.scrollY;
        // Center the preview on the cursor
        this.previewCanvas.style.transform = `translate(${posX - this.previewCanvas.width / 2}px, ${posY - this.previewCanvas.height / 2}px)`;
        this.previewCanvas.style.display = 'block';
    }

    updateBrushPreview(e) {
        // Only show preview in terrain or height mode
        if (this.placementMode !== 'terrain' && this.placementMode !== 'height') {
            if (this.hoverGridPosition !== null) {
                this.hoverGridPosition = null;
                this.needsRender = true;
                this.scheduleRender();
            }
            return;
        }

        // Get mouse position relative to canvas
        const rect = this.canvasEl.getBoundingClientRect();
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;
        let mouseX = (e.clientX - rect.left) * scaleX;
        let mouseY = (e.clientY - rect.top) * scaleY;

        if (!this.gameEditor.getCollections().configs.game.isIsometric) {
            mouseX -= (this.canvasEl.width - this.mapSize * this.config.gridSize) / 2;
            mouseY -= (this.canvasEl.height - this.mapSize * this.config.gridSize) / 2;
        }

        // Convert to grid coordinates
        const gridPos = this.translator.isoToGrid(mouseX, mouseY);
        const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);

        // Update hover position if it changed
        if (!this.hoverGridPosition ||
            this.hoverGridPosition.x !== snappedGrid.x ||
            this.hoverGridPosition.y !== snappedGrid.y) {
            this.hoverGridPosition = { x: snappedGrid.x, y: snappedGrid.y };
            this.needsRender = true;
            this.scheduleRender();
        }
    }
    setupTerrainImageProcessor() {
        this.terrainImageProcessor = new this.engineClasses.TerrainImageProcessor();
        this.terrainImageProcessor.initialize(
            document.getElementById('terrainImage'),
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
        this.tileMap.terrainTypes.forEach((terrain, index) => {
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
    
    createPreviewCanvas() {
        if (this.previewCanvas) {
            document.body.removeChild(this.previewCanvas);
        }
        
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.id = 'object-preview-canvas';
        this.previewCanvas.width = this.config.imageSize;
        this.previewCanvas.height = this.config.imageSize;
        this.previewCanvas.style.display = 'none'; // Hidden by default
        
        document.body.prepend(this.previewCanvas);

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
                this.previewCanvas.style.display = 'none';
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
                this.updateCanvasWithData();
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
                this.needsRender = true;
                this.scheduleRender();
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
                this.needsRender = true;
                this.scheduleRender();
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
                this.updateCanvasWithData();
                
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
                oldTerrainTypes.forEach((terrain, oldIndex) => {
                    const newIndex = this.tileMap.terrainTypes.findIndex(t => t.type === terrain.type);
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
        document.getElementById('terrainImage').value = '[]';        
        document.getElementById('terrainBuildable').checked = false;         
    }

    showTerrainEditForm(index) {
        const terrain = this.tileMap.terrainTypes[index];
        this.currentTerrainId = index; // Set current terrain ID for later use
        const form = document.getElementById(this.modalId);
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Edit Terrain Type';
        document.getElementById('terrainType').value = terrain.type;
        document.getElementById('terrainColor').value = terrain.color;
        document.getElementById('terrainColorText').value = terrain.color;
        document.getElementById('terrainImage').value = JSON.stringify(terrain.image || []);   
        document.getElementById('terrainBuildable').checked = terrain.buildable;
        const terrainTextureEl = document.getElementById('terrainTexture');
        terrainTextureEl.innerHTML = ''; // Clear existing options

        for(let textureName in this.gameEditor.getCollections().textures){
            const texture = this.gameEditor.getCollections().textures[textureName];
            const option = document.createElement('option');
            option.value = textureName;
            option.textContent = texture.title;

            if( textureName === terrain.texture) {
                option.selected = true; // Set the current terrain texture as selected
            }
            terrainTextureEl.appendChild(option);
        }
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('editTerrainImage', {
            bubbles: true,
            cancelable: true
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }

    hideTerrainForm() {
        document.getElementById(this.modalId).classList.remove('show');
    }

    saveTerrainType() {
        const newType = document.getElementById('terrainType').value.trim();
        const newColor = document.getElementById('terrainColorText').value;
        const newTexture = document.getElementById('terrainTexture').value;
        const newImage = JSON.parse(document.getElementById('terrainImage').value);
        const newBuildable = document.getElementById('terrainBuildable').checked;
    
        if (!newType) {
            alert('Terrain type cannot be empty');
            return;
        }
    
        if (this.currentTerrainId !== '') {
            // Editing existing terrain (using index as identifier)
            const index = this.currentTerrainId;
            if (index >= 0 && index < this.tileMap.terrainTypes.length) {
                if (this.tileMap.terrainTypes.some((t, i) => t.type === newType && i !== index)) {
                    alert('A terrain type with this name already exists');
                    return;
                }
                this.tileMap.terrainTypes[index] = { type: newType, texture: newTexture, color: newColor, image: newImage, buildable: newBuildable };
            }
        } else {
            // Adding new terrain
            if (this.tileMap.terrainTypes.some(t => t.type === newType)) {
                alert('A terrain type with this name already exists');
                return;
            }
            this.tileMap.terrainTypes.push({ type: newType, texture: newTexture, color: newColor, image: newImage, buildable: newBuildable });
        }
    
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
    
        const terrainToDelete = this.tileMap.terrainTypes[indexToDelete];
        if (!terrainToDelete) return;
    
        if (!confirm(`Are you sure you want to delete the "${terrainToDelete.type}" terrain type? All instances will be converted to the default terrain.`)) {
            return;
        }
    
        const defaultTerrainIndex = this.tileMap.terrainTypes.findIndex(t => t.type === 'grass') || 0;
    
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
        // Load environment images but keep fast tile rendering
        this.isInitializing = true;
        
        try {
            // Load environment images if we have environment objects
            if (this.worldObjects && Object.keys(this.worldObjects).length > 0) {
                let palette = this.gameEditor.getPalette();
                this.imageManager = new this.engineClasses.ImageManager(
                    this.gameEditor, 
                    { imageSize: this.config.imageSize, palette: palette}, 
                    {ShapeFactory: this.engineClasses.ShapeFactory}
                );
                await this.imageManager.loadImages("environment", this.worldObjects, false, false);
            }
            
            // Render with fast renderer
            this.updateCanvasWithData();
        } finally {
            this.isInitializing = false;
        }
    }


    // Performance optimization: schedule render with requestAnimationFrame
    scheduleRender() {
        if (this.renderAnimationFrame) {
            return; // Already scheduled
        }
        
        this.renderAnimationFrame = requestAnimationFrame(() => {
            this.renderAnimationFrame = null;
            if (this.needsRender) {
                this.updateCanvasWithData(); // Now synchronous and fast
                this.needsRender = false;
            }
        });
    }

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

    // Paint with brush on terrain map
    paintBrushTerrain(centerX, centerY, terrainId) {
        const radius = Math.floor(this.brushSize / 2);
        let painted = false;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;

                // Check bounds
                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    // Check if within brush radius (circular brush)
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius + 0.5) {
                        if (this.tileMap.terrainMap[y][x] !== terrainId) {
                            this.tileMap.terrainMap[y][x] = terrainId;
                            painted = true;
                        }
                    }
                }
            }
        }

        return painted;
    }

    // Paint with brush on height map
    paintBrushHeight(centerX, centerY, heightLevel) {
        const radius = Math.floor(this.brushSize / 2);
        let painted = false;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;

                // Check bounds
                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    // Check if within brush radius (circular brush)
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance <= radius + 0.5) {
                        if (this.tileMap.heightMap[y][x] !== heightLevel) {
                            this.tileMap.heightMap[y][x] = heightLevel;
                            painted = true;
                        }
                    }
                }
            }
        }

        return painted;
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

        // Use a queue-based flood fill to avoid stack overflow
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

            // Mark as visited and paint
            visited.add(key);
            this.tileMap.terrainMap[y][x] = newTerrainId;

            // Add neighbors to queue
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
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

        // Use a queue-based flood fill to avoid stack overflow
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

            // Mark as visited and paint
            visited.add(key);
            this.tileMap.heightMap[y][x] = newHeightLevel;

            // Add neighbors to queue
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        }

        return true;
    }

    handleCanvasInteraction(event) {
        // Get mouse position relative to canvas
        const offsetY = (this.canvasEl.height - this.mapSize * this.config.gridSize) / 2;
        const rect = this.canvasEl.getBoundingClientRect();
        // Account for CSS scaling of the canvas
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;
        let mouseX = (event.clientX - rect.left) * scaleX;
        let mouseY = (event.clientY - rect.top) * scaleY;


        if(!this.gameEditor.getCollections().configs.game.isIsometric) {
            mouseX -= (this.canvasEl.width - this.mapSize * this.config.gridSize) / 2;
            mouseY -= (this.canvasEl.height - this.mapSize * this.config.gridSize) / 2;
        }
        
        if (this.placementMode === 'terrain') {
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);

            // Check if coordinates are within bounds
            if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize &&
                snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {

                let painted = false;

                if (this.terrainTool === 'brush') {
                    // Brush tool: paint with variable size
                    const tileKey = `${snappedGrid.x},${snappedGrid.y}`;

                    // Only paint if we're on a new tile or haven't painted here yet
                    if (this.lastPaintedTile !== tileKey || this.brushSize > 1) {
                        painted = this.paintBrushTerrain(snappedGrid.x, snappedGrid.y, this.currentTerrainId);
                        this.lastPaintedTile = tileKey;
                    }
                } else if (this.terrainTool === 'fill') {
                    // Flood fill tool: fill contiguous area (only on click, not drag)
                    if (!this.isMouseDown || this.lastPaintedTile === null) {
                        painted = this.floodFillTerrain(snappedGrid.x, snappedGrid.y, this.currentTerrainId);
                        this.lastPaintedTile = `${snappedGrid.x},${snappedGrid.y}`;
                    }
                }

                if (painted) {
                    // Schedule render instead of immediate render
                    this.needsRender = true;
                    this.scheduleRender();
                }
            }
        } else if (this.placementMode === 'environment' && this.selectedEnvironmentType &&
                   this.selectedEnvironmentItem !== null) {
            // Environment object placement logic
            const isoPos = { x: mouseX, y: mouseY };
            const pixelPos = this.translator.isoToPixel(isoPos.x, isoPos.y);

            // Get the image to calculate its size
            const images = this.imageManager.getImages("environment", this.selectedEnvironmentType);
            const image = images.idle[0][this.selectedEnvironmentItem];

            // Create new environment object
            const newObject = {
                type: this.selectedEnvironmentType,
                imageIndex: this.selectedEnvironmentItem,
                x: pixelPos.x,
                y: pixelPos.y
            };

            // Add to environment objects array
            if (!this.tileMap.environmentObjects) {
                this.tileMap.environmentObjects = [];
            }
            this.tileMap.environmentObjects.push(newObject);

            // Schedule render instead of immediate render
            this.needsRender = true;
            this.scheduleRender();

            // Debounce export to reduce frequency
        } else if (this.placementMode === 'ramp') {
            // Ramp placement logic
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);
            console.log('clicked');
            // Check if coordinates are within bounds
            if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize &&
                snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {

                // Initialize ramps array if needed
                if (!this.tileMap.ramps) {
                    this.tileMap.ramps = [];
                }

                // Check if ramp already exists at this position
                const rampIndex = this.tileMap.ramps.findIndex(r => r.x === snappedGrid.x && r.z === snappedGrid.y);

                if (rampIndex >= 0) {
                    // Remove existing ramp (toggle off)
                    this.tileMap.ramps.splice(rampIndex, 1);
                } else {
                    // Add new ramp (toggle on)
                    this.tileMap.ramps.push({ x: snappedGrid.x, z: snappedGrid.y });
                }

                // Update ramp count display
                this.updateRampCount();

                // Schedule render to show ramps
                this.needsRender = true;
                this.scheduleRender();
            }
        } else if (this.placementMode === 'height') {
            // Height map editing logic
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);

            // Check if coordinates are within bounds
            if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize &&
                snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {

                let painted = false;

                if (this.terrainTool === 'brush') {
                    // Brush tool: paint with variable size
                    const tileKey = `${snappedGrid.x},${snappedGrid.y}`;

                    // Only paint if we're on a new tile or haven't painted here yet
                    if (this.lastPaintedTile !== tileKey || this.brushSize > 1) {
                        painted = this.paintBrushHeight(snappedGrid.x, snappedGrid.y, this.currentHeightLevel);
                        this.lastPaintedTile = tileKey;

                        // Apply terrain type 0 / height 0 coupling rule for brush strokes
                        if (painted && this.currentHeightLevel === 0) {
                            const radius = Math.floor(this.brushSize / 2);
                            for (let dy = -radius; dy <= radius; dy++) {
                                for (let dx = -radius; dx <= radius; dx++) {
                                    const x = snappedGrid.x + dx;
                                    const y = snappedGrid.y + dy;
                                    if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                                        const distance = Math.sqrt(dx * dx + dy * dy);
                                        if (distance <= radius + 0.5 && this.tileMap.heightMap[y][x] === 0) {
                                            this.tileMap.terrainMap[y][x] = 0;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if (this.terrainTool === 'fill') {
                    // Flood fill tool: fill contiguous area (only on click, not drag)
                    if (!this.isMouseDown || this.lastPaintedTile === null) {
                        painted = this.floodFillHeight(snappedGrid.x, snappedGrid.y, this.currentHeightLevel);
                        this.lastPaintedTile = `${snappedGrid.x},${snappedGrid.y}`;

                        // Apply terrain type 0 / height 0 coupling rule for filled area
                        if (painted && this.currentHeightLevel === 0) {
                            for (let y = 0; y < this.mapSize; y++) {
                                for (let x = 0; x < this.mapSize; x++) {
                                    if (this.tileMap.heightMap[y][x] === 0) {
                                        this.tileMap.terrainMap[y][x] = 0;
                                    }
                                }
                            }
                        }
                    }
                }

                if (painted) {
                    // Schedule render instead of immediate render
                    this.needsRender = true;
                    this.scheduleRender();
                }
            }
        } else if (this.placementMode === 'placements' && this.selectedPlacementType) {
            // Entity placement logic - uses PLACEMENT GRID coordinates (2x terrain grid)
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);

            // Check if coordinates are within bounds (terrain grid)
            if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize &&
                snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {

                // Convert terrain grid to placement grid (multiply by 2)
                const placementGridX = snappedGrid.x * 2;
                const placementGridZ = snappedGrid.y * 2;

                if (this.selectedPlacementType === 'startingLocation') {
                    // Place starting location
                    const side = this.selectedEntityType;

                    // Remove existing starting location for this side
                    this.startingLocations = this.startingLocations.filter(loc => loc.side !== side);

                    // Add new starting location (using placement grid coordinates)
                    this.startingLocations.push({
                        side: side,
                        gridPosition: { x: placementGridX, z: placementGridZ }
                    });

                    // Update UI list
                    this.updateStartingLocationsList(document.getElementById('startingLocationsList'));

                    this.placementModeIndicator.textContent = `Placed ${side} team start at placement grid (${placementGridX}, ${placementGridZ})`;
                    this.placementModeIndicator.style.opacity = '1';

                    clearTimeout(this.indicatorTimeout);
                    this.indicatorTimeout = setTimeout(() => {
                        this.placementModeIndicator.style.opacity = '0';
                    }, 2000);

                    this.needsRender = true;
                    this.scheduleRender();
                    this.exportMap();

                } else if (this.selectedPlacementType === 'building' || this.selectedPlacementType === 'unit') {
                    // Place building or unit (using placement grid coordinates)
                    const placement = {
                        type: this.selectedPlacementType,
                        entityType: this.selectedEntityType,
                        gridPosition: { x: placementGridX, z: placementGridZ }
                    };

                    // For gold mines, validate placement on gold veins (if we have that data)
                    if (this.selectedEntityType === 'goldMine') {
                        // TODO: Add validation for gold vein placement when gold vein data is available
                        this.placementModeIndicator.textContent = `Note: Ensure this is placed on a gold vein!`;
                    }

                    this.entityPlacements.push(placement);

                    this.placementModeIndicator.textContent = `Placed ${this.selectedEntityType} at placement grid (${placementGridX}, ${placementGridZ})`;
                    this.placementModeIndicator.style.opacity = '1';

                    clearTimeout(this.indicatorTimeout);
                    this.indicatorTimeout = setTimeout(() => {
                        this.placementModeIndicator.style.opacity = '0';
                    }, 2000);

                    this.needsRender = true;
                    this.scheduleRender();
                    this.exportMap();
                }
            }
        }
    }

    // Fast rendering method - draws simple colored squares
    renderMap() {
        if (!this.tileMap.terrainMap || this.tileMap.terrainMap.length === 0) {
            return;
        }

        const ctx = this.canvasEl.getContext('2d');
        const gridSize = this.config.gridSize;
        const isIsometric = this.gameEditor.getCollections().configs.game.isIsometric;
        
        // Clear canvas
        ctx.fillStyle = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType || 3].color;
        ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        
        if (isIsometric) {
            // Isometric rendering
            for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
                for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                    const terrainId = this.tileMap.terrainMap[y][x];
                    const terrain = this.tileMap.terrainTypes[terrainId];
                    
                    if (!terrain) continue;
                    
                    const isoCoords = this.translator.gridToIso(x, y);
                    const tileWidth = gridSize;
                    const tileHeight = gridSize * 0.5;
                    
                    ctx.fillStyle = terrain.color;
                    ctx.beginPath();
                    ctx.moveTo(isoCoords.x, isoCoords.y);
                    ctx.lineTo(isoCoords.x + tileWidth / 2, isoCoords.y + tileHeight / 2);
                    ctx.lineTo(isoCoords.x, isoCoords.y + tileHeight);
                    ctx.lineTo(isoCoords.x - tileWidth / 2, isoCoords.y + tileHeight / 2);
                    ctx.closePath();
                    ctx.fill();
                    
                    // Optional: draw borders
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        } else {
            // Non-isometric rendering (simple squares)
            const offsetX = (this.canvasEl.width - this.mapSize * gridSize) / 2;
            const offsetY = (this.canvasEl.height - this.mapSize * gridSize) / 2;

            for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
                for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                    const terrainId = this.tileMap.terrainMap[y][x];
                    const terrain = this.tileMap.terrainTypes[terrainId];

                    if (!terrain) continue;

                    const drawX = offsetX + x * gridSize;
                    const drawY = offsetY + y * gridSize;

                    ctx.fillStyle = terrain.color;
                    ctx.fillRect(drawX, drawY, gridSize, gridSize);

                    // Optional: draw grid lines
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(drawX, drawY, gridSize, gridSize);
                }
            }
        }

        // Height mode overlay - show height levels in both height and ramp modes
        if ((this.placementMode === 'height' || this.placementMode === 'ramp') && this.tileMap.heightMap && this.tileMap.heightMap.length > 0) {
            const offsetX = isIsometric ? 0 : (this.canvasEl.width - this.mapSize * gridSize) / 2;
            const offsetY = isIsometric ? 0 : (this.canvasEl.height - this.mapSize * gridSize) / 2;

            for (let y = 0; y < this.tileMap.heightMap.length; y++) {
                for (let x = 0; x < this.tileMap.heightMap[y].length; x++) {
                    const heightLevel = this.tileMap.heightMap[y][x];

                    if (isIsometric) {
                        const isoCoords = this.translator.gridToIso(x, y);
                        const tileWidth = gridSize;
                        const tileHeight = gridSize * 0.5;

                        // Semi-transparent height overlay
                        const alpha = 0.6;
                        const intensity = Math.min(heightLevel / 10, 1);
                        ctx.fillStyle = `rgba(${255 * intensity}, ${100}, ${255 * (1 - intensity)}, ${alpha})`;

                        ctx.beginPath();
                        ctx.moveTo(isoCoords.x, isoCoords.y);
                        ctx.lineTo(isoCoords.x + tileWidth / 2, isoCoords.y + tileHeight / 2);
                        ctx.lineTo(isoCoords.x, isoCoords.y + tileHeight);
                        ctx.lineTo(isoCoords.x - tileWidth / 2, isoCoords.y + tileHeight / 2);
                        ctx.closePath();
                        ctx.fill();

                        // Draw height number
                        ctx.fillStyle = 'white';
                        ctx.font = 'bold 12px monospace';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(heightLevel, isoCoords.x, isoCoords.y + tileHeight / 2);
                    } else {
                        const drawX = offsetX + x * gridSize;
                        const drawY = offsetY + y * gridSize;

                        // Color gradient from blue (low) to red (high)
                        const alpha = 0.6;
                        const intensity = Math.min(heightLevel / 10, 1);
                        ctx.fillStyle = `rgba(${255 * intensity}, ${100}, ${255 * (1 - intensity)}, ${alpha})`;
                        ctx.fillRect(drawX, drawY, gridSize, gridSize);

                        // Draw height number
                        ctx.fillStyle = 'white';
                        ctx.font = 'bold 14px monospace';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.strokeStyle = 'black';
                        ctx.lineWidth = 3;
                        ctx.strokeText(heightLevel, drawX + gridSize / 2, drawY + gridSize / 2);
                        ctx.fillText(heightLevel, drawX + gridSize / 2, drawY + gridSize / 2);
                    }
                }
            }
        }

        // Render environment objects with their actual images
        if (this.tileMap.environmentObjects && this.tileMap.environmentObjects.length > 0 && this.imageManager) {
            for (const obj of this.tileMap.environmentObjects) {
                if (!obj || obj.x === undefined || obj.y === undefined) continue;
                
                // Get the image for this object
                const images = this.imageManager.getImages("environment", obj.type);
                if (!images || !images.idle || !images.idle[0] || !images.idle[0][obj.imageIndex]) {
                    continue;
                }
                
                const image = images.idle[0][obj.imageIndex];
                if (!image) continue;
                
                let screenX, screenY;
                
                if (isIsometric) {
                    // Convert pixel coordinates to isometric screen coordinates
                    const isoPos = this.translator.pixelToIso(obj.x, obj.y);
                    screenX = isoPos.x;
                    screenY = isoPos.y;
                } else {
                    // Convert pixel coordinates to screen coordinates
                    const offsetX = (this.canvasEl.width - this.mapSize * gridSize) / 2;
                    const offsetY = (this.canvasEl.height - this.mapSize * gridSize) / 2;
                    screenX = offsetX + obj.x;
                    screenY = offsetY + obj.y;
                }
                
                // Draw the image centered at the position
                ctx.drawImage(
                    image,
                    screenX - image.width / 2,
                    screenY - image.height / 2,
                    image.width,
                    image.height
                );
            }
        }

        // Render ramps as visual indicators
        if (this.tileMap.ramps && this.tileMap.ramps.length > 0) {
            for (const ramp of this.tileMap.ramps) {
                if (isIsometric) {
                    // Isometric rendering for ramps
                    const isoCoords = this.translator.gridToIso(ramp.x, ramp.z);
                    const tileWidth = gridSize;
                    const tileHeight = gridSize * 0.5;

                    // Draw ramp indicator (triangle pointing up)
                    ctx.fillStyle = 'rgba(139, 115, 85, 0.7)'; // Semi-transparent brown
                    ctx.beginPath();
                    ctx.moveTo(isoCoords.x, isoCoords.y + tileHeight / 4);
                    ctx.lineTo(isoCoords.x + tileWidth / 4, isoCoords.y + tileHeight / 2);
                    ctx.lineTo(isoCoords.x - tileWidth / 4, isoCoords.y + tileHeight / 2);
                    ctx.closePath();
                    ctx.fill();

                    // Add border
                    ctx.strokeStyle = 'rgba(101, 84, 63, 1)'; // Darker brown
                    ctx.lineWidth = 2;
                    ctx.stroke();
                } else {
                    // Non-isometric rendering for ramps
                    const offsetX = (this.canvasEl.width - this.mapSize * gridSize) / 2;
                    const offsetY = (this.canvasEl.height - this.mapSize * gridSize) / 2;

                    const drawX = offsetX + ramp.x * gridSize;
                    const drawY = offsetY + ramp.z * gridSize;

                    // Draw ramp indicator (triangle or arrow)
                    ctx.fillStyle = 'rgba(139, 115, 85, 0.7)'; // Semi-transparent brown
                    ctx.beginPath();
                    ctx.moveTo(drawX + gridSize / 2, drawY + gridSize / 4);
                    ctx.lineTo(drawX + 3 * gridSize / 4, drawY + 3 * gridSize / 4);
                    ctx.lineTo(drawX + gridSize / 4, drawY + 3 * gridSize / 4);
                    ctx.closePath();
                    ctx.fill();

                    // Add border
                    ctx.strokeStyle = 'rgba(101, 84, 63, 1)'; // Darker brown
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Optional: Add "R" text to clearly mark it as a ramp
                    ctx.fillStyle = 'white';
                    ctx.font = `${gridSize / 3}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('R', drawX + gridSize / 2, drawY + gridSize / 2);
                }
            }
        }

        // Render entity placements
        if (this.placementMode === 'placements' || this.placementMode === 'terrain') {
            const offsetX = isIsometric ? 0 : (this.canvasEl.width - this.mapSize * gridSize) / 2;
            const offsetY = isIsometric ? 0 : (this.canvasEl.height - this.mapSize * gridSize) / 2;

            // Render starting locations
            this.startingLocations.forEach(loc => {
                // Convert placement grid coordinates to terrain grid for display
                const terrainGridX = Math.floor(loc.gridPosition.x / 2);
                const terrainGridZ = Math.floor(loc.gridPosition.z / 2);

                if (isIsometric) {
                    const isoCoords = this.translator.gridToIso(terrainGridX, terrainGridZ);
                    const tileWidth = gridSize;
                    const tileHeight = gridSize * 0.5;

                    // Draw starting location marker
                    ctx.fillStyle = loc.side === 'left' ? 'rgba(0, 100, 255, 0.6)' : 'rgba(255, 100, 0, 0.6)';
                    ctx.beginPath();
                    ctx.arc(isoCoords.x, isoCoords.y + tileHeight / 2, gridSize / 3, 0, 2 * Math.PI);
                    ctx.fill();

                    // Draw border
                    ctx.strokeStyle = loc.side === 'left' ? 'rgba(0, 100, 255, 1)' : 'rgba(255, 100, 0, 1)';
                    ctx.lineWidth = 3;
                    ctx.stroke();

                    // Draw label
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 12px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(loc.side.charAt(0).toUpperCase(), isoCoords.x, isoCoords.y + tileHeight / 2);
                } else {
                    const drawX = offsetX + terrainGridX * gridSize;
                    const drawY = offsetY + terrainGridZ * gridSize;

                    // Draw starting location marker
                    ctx.fillStyle = loc.side === 'left' ? 'rgba(0, 100, 255, 0.6)' : 'rgba(255, 100, 0, 0.6)';
                    ctx.beginPath();
                    ctx.arc(drawX + gridSize / 2, drawY + gridSize / 2, gridSize / 3, 0, 2 * Math.PI);
                    ctx.fill();

                    // Draw border
                    ctx.strokeStyle = loc.side === 'left' ? 'rgba(0, 100, 255, 1)' : 'rgba(255, 100, 0, 1)';
                    ctx.lineWidth = 3;
                    ctx.stroke();

                    // Draw label
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 14px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 3;
                    ctx.strokeText(loc.side.charAt(0).toUpperCase(), drawX + gridSize / 2, drawY + gridSize / 2);
                    ctx.fillText(loc.side.charAt(0).toUpperCase(), drawX + gridSize / 2, drawY + gridSize / 2);
                }
            });

            // Render entity placements (buildings and units)
            this.entityPlacements.forEach(placement => {
                // Convert placement grid coordinates to terrain grid for display
                const terrainGridX = Math.floor(placement.gridPosition.x / 2);
                const terrainGridZ = Math.floor(placement.gridPosition.z / 2);

                const color = placement.type === 'building' ? 'rgba(139, 69, 19, 0.7)' : 'rgba(0, 200, 0, 0.7)';
                const label = placement.entityType === 'goldMine' ? 'GM' :
                              placement.entityType === 'townHall' ? 'TH' :
                              placement.entityType.charAt(0).toUpperCase();

                if (isIsometric) {
                    const isoCoords = this.translator.gridToIso(terrainGridX, terrainGridZ);
                    const tileWidth = gridSize;
                    const tileHeight = gridSize * 0.5;

                    // Draw placement marker
                    ctx.fillStyle = color;
                    ctx.fillRect(
                        isoCoords.x - gridSize / 4,
                        isoCoords.y + tileHeight / 4,
                        gridSize / 2,
                        gridSize / 2
                    );

                    // Draw border
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(
                        isoCoords.x - gridSize / 4,
                        isoCoords.y + tileHeight / 4,
                        gridSize / 2,
                        gridSize / 2
                    );

                    // Draw label
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 10px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, isoCoords.x, isoCoords.y + tileHeight / 2);
                } else {
                    const drawX = offsetX + terrainGridX * gridSize;
                    const drawY = offsetY + terrainGridZ * gridSize;

                    // Draw placement marker
                    ctx.fillStyle = color;
                    ctx.fillRect(
                        drawX + gridSize / 4,
                        drawY + gridSize / 4,
                        gridSize / 2,
                        gridSize / 2
                    );

                    // Draw border
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(
                        drawX + gridSize / 4,
                        drawY + gridSize / 4,
                        gridSize / 2,
                        gridSize / 2
                    );

                    // Draw label
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 12px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 2;
                    ctx.strokeText(label, drawX + gridSize / 2, drawY + gridSize / 2);
                    ctx.fillText(label, drawX + gridSize / 2, drawY + gridSize / 2);
                }
            });
        }

        // Render brush/fill preview overlay
        if (this.hoverGridPosition &&
            (this.placementMode === 'terrain' || this.placementMode === 'height')) {

            if (this.terrainTool === 'brush') {
                // Brush tool preview - show all affected tiles
                const centerX = this.hoverGridPosition.x;
                const centerY = this.hoverGridPosition.y;
                const radius = Math.floor(this.brushSize / 2);

                // Render each tile in the brush area
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const x = centerX + dx;
                        const y = centerY + dy;

                        // Check bounds
                        if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                            // Check if within brush radius (circular brush)
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance <= radius + 0.5) {
                                if (isIsometric) {
                                    // Isometric preview
                                    const isoCoords = this.translator.gridToIso(x, y);
                                    const tileWidth = gridSize;
                                    const tileHeight = gridSize * 0.5;

                                    // Draw semi-transparent overlay
                                    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                                    ctx.beginPath();
                                    ctx.moveTo(isoCoords.x, isoCoords.y);
                                    ctx.lineTo(isoCoords.x + tileWidth / 2, isoCoords.y + tileHeight / 2);
                                    ctx.lineTo(isoCoords.x, isoCoords.y + tileHeight);
                                    ctx.lineTo(isoCoords.x - tileWidth / 2, isoCoords.y + tileHeight / 2);
                                    ctx.closePath();
                                    ctx.fill();

                                    // Draw border
                                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                                    ctx.lineWidth = 2;
                                    ctx.stroke();
                                } else {
                                    // Non-isometric preview
                                    const offsetX = (this.canvasEl.width - this.mapSize * gridSize) / 2;
                                    const offsetY = (this.canvasEl.height - this.mapSize * gridSize) / 2;

                                    const drawX = offsetX + x * gridSize;
                                    const drawY = offsetY + y * gridSize;

                                    // Draw semi-transparent overlay
                                    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                                    ctx.fillRect(drawX, drawY, gridSize, gridSize);

                                    // Draw border
                                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                                    ctx.lineWidth = 2;
                                    ctx.strokeRect(drawX, drawY, gridSize, gridSize);
                                }
                            }
                        }
                    }
                }
            } else if (this.terrainTool === 'fill') {
                // Fill tool preview - show single tile with different color
                const x = this.hoverGridPosition.x;
                const y = this.hoverGridPosition.y;

                if (x >= 0 && x < this.mapSize && y >= 0 && y < this.mapSize) {
                    if (isIsometric) {
                        // Isometric preview
                        const isoCoords = this.translator.gridToIso(x, y);
                        const tileWidth = gridSize;
                        const tileHeight = gridSize * 0.5;

                        // Draw semi-transparent overlay with blue tint for fill
                        ctx.fillStyle = 'rgba(100, 200, 255, 0.4)';
                        ctx.beginPath();
                        ctx.moveTo(isoCoords.x, isoCoords.y);
                        ctx.lineTo(isoCoords.x + tileWidth / 2, isoCoords.y + tileHeight / 2);
                        ctx.lineTo(isoCoords.x, isoCoords.y + tileHeight);
                        ctx.lineTo(isoCoords.x - tileWidth / 2, isoCoords.y + tileHeight / 2);
                        ctx.closePath();
                        ctx.fill();

                        // Draw border
                        ctx.strokeStyle = 'rgba(100, 200, 255, 0.9)';
                        ctx.lineWidth = 3;
                        ctx.stroke();
                    } else {
                        // Non-isometric preview
                        const offsetX = (this.canvasEl.width - this.mapSize * gridSize) / 2;
                        const offsetY = (this.canvasEl.height - this.mapSize * gridSize) / 2;

                        const drawX = offsetX + x * gridSize;
                        const drawY = offsetY + y * gridSize;

                        // Draw semi-transparent overlay with blue tint for fill
                        ctx.fillStyle = 'rgba(100, 200, 255, 0.4)';
                        ctx.fillRect(drawX, drawY, gridSize, gridSize);

                        // Draw border
                        ctx.strokeStyle = 'rgba(100, 200, 255, 0.9)';
                        ctx.lineWidth = 3;
                        ctx.strokeRect(drawX, drawY, gridSize, gridSize);
                    }
                }
            }
        }
    }
    async updateCanvasWithData() {
        // Use fast rendering for instant feedback
        this.renderMap();
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