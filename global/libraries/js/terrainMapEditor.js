class TerrainMapEditor {
    constructor(gameEditor, config = {}, { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory }) {
        this.gameEditor = gameEditor;
        this.engineClasses = { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory };
        this.defaultConfig = { gridSize: 48, imageSize: 128, canvasWidth: 1536, canvasHeight: 768 };
        this.config = { ...this.defaultConfig, ...config };
    
        this.defaultMapSize = 16;
        this.mapSize = this.defaultMapSize;
        this.currentTerrainId = 3; // Default to grass (index 3)
        this.isMouseDown = false;
        this.objectData = {};
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
            terrainMap: []
        };
        this.environmentObjects = this.tileMap.environmentObjects || [];
        this.selectedEnvironmentType = null;
        this.selectedEnvironmentItem = null;
        this.placementMode = 'terrain'; // can be 'terrain' or 'environment'
        this.worldObjects = [];
        this.terrainTypesContainer = null;
        this.draggedItem = null;
        this.dragOverItem = null; // Track the item being dragged over

        // DOM elements
        this.canvasEl = document.getElementById('grid');
        this.canvasEl.width = this.config.canvasWidth;
        this.canvasEl.height = this.config.canvasHeight;

        // Preview elements for cursor
        this.previewCanvas = null;
        this.currentPreviewImage = null;

        // Managers and renderers
        let palette = this.gameEditor.getPalette();
        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor,  { imageSize: this.config.imageSize, palette: palette}, {ShapeFactory: ShapeFactory});
        this.mapRenderer = null;
        this.mapManager = null;

        this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.tileMap.size, this.gameEditor.getCollections().configs.game.isIsometric);
        this.terrainCanvasBuffer = document.createElement('canvas');
        this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
        this.terrainCanvasBuffer.height =  this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
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
        document.getElementById('terrainMapSize').addEventListener('change', (ev) => {    
            const newGridSize = parseInt(ev.target.value);
            const oldGridSize = this.tileMap.size;
            
            // Create a new map to hold the resized terrain
            const newTerrainMap = [];
            for (let i = 0; i < newGridSize; i++) {
                newTerrainMap.push(new Array(newGridSize));
            }
            
            // Calculate offsets for maintaining center
            const oldOffset = Math.floor(oldGridSize / 2);
            const newOffset = Math.floor(newGridSize / 2);
            
            // Fill the new map
            for (let newI = 0; newI < newGridSize; newI++) {
                for (let newJ = 0; newJ < newGridSize; newJ++) {
                    const absI = newI - newOffset;
                    const absJ = newJ - newOffset;
                    
                    const oldI = absI + oldOffset;
                    const oldJ = absJ + oldOffset;
                    
                    if (oldI >= 0 && oldI < oldGridSize && oldJ >= 0 && oldJ < oldGridSize) {
                        // Copy existing terrain
                        newTerrainMap[newI][newJ] = this.tileMap.terrainMap[oldI][oldJ];
                    } else {
                        // Use nearest edge value for new areas
                        const clampedI = Math.max(0, Math.min(oldGridSize - 1, oldI));
                        const clampedJ = Math.max(0, Math.min(oldGridSize - 1, oldJ));
                        newTerrainMap[newI][newJ] = this.tileMap.terrainMap[clampedI][clampedJ];
                    }
                }
            }
            
            // Update tileMap with new terrain
            this.tileMap.terrainMap = newTerrainMap;
            this.tileMap.size = newGridSize;
            this.translator = new this.engineClasses.CoordinateTranslator(this.config, newGridSize, this.gameEditor.getCollections().configs.game.isIsometric);
            
            this.updateTerrainStyles();
            this.setupTerrainTypesUI();
            this.initGridCanvas();
            this.exportMap();
        });
        document.getElementById('extensionTerrainType').addEventListener('change', (ev) => {    
            const newTerrainType = parseInt(ev.target.value);            
            this.tileMap.extensionTerrainType = newTerrainType;
            this.initGridCanvas();
            this.exportMap();
        });
       
        // Handle mouseup event (stop dragging)
        document.addEventListener('mouseup', () => {
            this.isMouseDown = false;
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
            this.updatePreviewPosition(e);
            
            if (this.isMouseDown) {
                this.handleCanvasInteraction(e);
            }
        });

        // Add translation event listeners
        document.getElementById('translate-left').addEventListener('click', () => this.translateMap(-1, 0));
        document.getElementById('translate-right').addEventListener('click', () => this.translateMap(1, 0));
        document.getElementById('translate-up').addEventListener('click', () => this.translateMap(0, -1));
        document.getElementById('translate-down').addEventListener('click', () => this.translateMap(0, 1));

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
            
            // Update grid size if it's different
            if (this.tileMap.size && this.tileMap.size !== this.mapSize) {
                this.mapSize = this.tileMap.size;
                this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.mapSize, this.gameEditor.getCollections().configs.game.isIsometric);
            } else {
                this.mapSize = this.defaultMapSize;
                this.translator = new this.engineClasses.CoordinateTranslator(this.config, this.mapSize, this.gameEditor.getCollections().configs.game.isIsometric);
            }
            
            document.getElementById('terrainMapSize').value = this.mapSize;
            requestAnimationFrame(() => {
                // Load terrain types if provided
                this.updateTerrainStyles();
                this.setupTerrainTypesUI();
                this.initGridCanvas();
            });
        });

        document.getElementById('terrainsBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.add('active');
            document.getElementById('environmentBtn').classList.remove('active');
            
            document.getElementById('terrainsPanel').style.display = 'block';
            document.getElementById('environmentPanel').style.display = 'none';
            this.placementMode = 'terrain';
            this.previewCanvas.style.display = 'none';
            // Update placement indicator
            this.placementModeIndicator.textContent = 'Placement Mode: Terrain';
            this.placementModeIndicator.style.opacity = '1';
            
            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
        });
        
        document.getElementById('environmentBtn').addEventListener('click', () => {
            document.getElementById('terrainsBtn').classList.remove('active');
            document.getElementById('environmentBtn').classList.add('active');
            document.getElementById('terrainsPanel').style.display = 'none';
            document.getElementById('environmentPanel').style.display = 'block';
            this.placementMode = 'environment';
            
            // Make sure environment panel is set up
            this.setupEnvironmentPanel();
            this.placementModeIndicator.textContent = 'Placement Mode: Environment';
            this.placementModeIndicator.style.opacity = '1';
            
            // Hide indicator after a delay
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                this.placementModeIndicator.style.opacity = '0';
            }, 2000);
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
        await this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap } }, false, false);
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

        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.gameEditor.getCollections().configs.game.gridSize, terrainImages, this.gameEditor.getCollections().configs.game.isIsometric);
        this.game = { state: {}, terrainTileMapper: this.terrainTileMapper, getCollections: this.gameEditor.getCollections.bind(this.gameEditor), translator: this.translator };

        this.mapRenderer = new (this.gameEditor.scriptContext.getRenderer("MapRenderer"))(this.game, null);
        this.mapRenderer.init({ 
                gameConfig: this.config, 
                terrainCanvasBuffer: this.terrainCanvasBuffer, 
                canvasBuffer: this.canvasEl, 
                environment: this.worldObjects, 
                imageManager: this.imageManager, 
                levelName: 'level', 
                level: { tileMap: this.tileMap },
                isEditor: true,
                palette: palette
            });
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
        let mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
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
        posX = e.clientX;
        posY = e.clientY;
        // Center the preview on the cursor
        this.previewCanvas.style.transform = `translate(${posX - this.previewCanvas.width / 2}px, ${posY - this.previewCanvas.height / 2}px)`;
        this.previewCanvas.style.display = 'block';
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
            terrainItem.className = 'terrain-item';
            terrainItem.draggable = true;
            terrainItem.dataset.index = index;
    
            terrainItem.addEventListener('dragstart', this.handleDragStart.bind(this));
            terrainItem.addEventListener('dragover', this.handleDragOver.bind(this));
            terrainItem.addEventListener('drop', this.handleDrop.bind(this));
            terrainItem.addEventListener('dragend', this.handleDragEnd.bind(this));
            terrainItem.addEventListener('dragenter', this.handleDragEnter.bind(this));
            terrainItem.addEventListener('dragleave', this.handleDragLeave.bind(this));
    
            const option = document.createElement('div');
            option.className = 'color-option';
            option.dataset.index = index;
            option.dataset.type = terrain.type;
            option.style.backgroundColor = terrain.color;
    
            if (index === this.currentTerrainId) {
                option.classList.add('active');
            }
    
            option.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('active'));
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
            document.querySelector('.tools').appendChild(panel);
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
        document.querySelector('.grid-container').appendChild(indicator);
        this.placementModeIndicator = indicator;
    
        // Create environment object selector
        if (this.worldObjects) {
            const container = document.createElement('div');
            container.className = 'environment-objects-container';
            
            // Add header
            const header = document.createElement('h3');
            header.textContent = 'Environment Objects';
            container.appendChild(header);
            
            // Create object type list
            for (const type in this.worldObjects) {
                const typeContainer = document.createElement('div');
                typeContainer.className = 'environment-type';
                
                // Count objects of this type
                const objectCount = (this.tileMap.environmentObjects || [])
                    .filter(obj => obj.type === type).length;
                
                const typeHeader = document.createElement('div');
                typeHeader.className = 'environment-type-header';
                typeHeader.textContent = type;
                
                // Add count badge
                const countBadgeContainer = document.createElement('span');
                countBadgeContainer.className = 'object-count-container';
                const countBadge = document.createElement('span');
                countBadge.className = 'object-count';
                countBadge.textContent = objectCount;
                countBadgeContainer.appendChild(countBadge);
                typeHeader.appendChild(countBadgeContainer);
                
                typeHeader.addEventListener('click', () => {
                    const content = typeContainer.querySelector('.environment-items');
                    const isOpen = content.style.display !== 'none';
                    content.style.display = isOpen ? 'none' : 'flex';
                    typeHeader.classList.toggle('open', !isOpen);
                });
                typeContainer.appendChild(typeHeader);
                
                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'environment-items';
                itemsContainer.style.display = 'none';
                
                // Get images for this type
                const images = this.imageManager.getImages("environment", type);
                if (images && images.idle && images.idle[0] && images.idle[0].length > 0) {
                    images.idle[0].forEach((image, imageIndex) => {
                        const item = document.createElement('div');
                        item.className = 'environment-item';
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
                            document.querySelectorAll('.environment-item').forEach(i => i.classList.remove('active'));
                            
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
    deleteEnvironmentObjectAt(e) {
        // Get mouse position and convert to game coordinates
        const rect = this.canvasEl.getBoundingClientRect();
        let mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
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
            const headers = document.querySelectorAll('.environment-type-header');
            // Find the specific header containing the type name
            for (const header of headers) {
                if (header.textContent.includes(type)) {
                    // Get the count badge within this header
                    const countBadge = header.querySelector('.object-count');
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
    
        if (this.draggedItem !== dropTarget && dropTarget.classList.contains('terrain-item')) {
            const allItems = Array.from(this.terrainTypesContainer.querySelectorAll('.terrain-item'));
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
        document.querySelectorAll('.terrain-item').forEach(item => {
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

    updateTerrainStyles() {
        let styleElem = document.getElementById('terrainStyles');
        if (!styleElem) {
            styleElem = document.createElement('style');
            styleElem.id = 'terrainStyles';
            document.head.appendChild(styleElem);
        }
    
        let css = '';
        this.tileMap.terrainTypes.forEach((terrain, index) => {
            css += `#level-editor-container .color-option[data-index="${index}"] { background-color: ${terrain.color}; }\n`;
        });
    
        css += `
            .terrain-item.dragging { opacity: 0.4; }
            .terrain-item.drag-over { border: 2px dashed #666; background-color: rgba(0,0,0,0.1); }
        `;
    
        styleElem.textContent = css;
    }

    translateMap(deltaX, deltaY) {
        const gridSize = this.tileMap.size;
        
        // Create a new map to hold the translated terrain
        const newTerrainMap = [];
        for (let i = 0; i < gridSize; i++) {
            newTerrainMap.push(new Array(gridSize));
        }
        
        // Fill the new map
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                // Calculate source coordinates in old map
                const oldI = i - deltaY;
                const oldJ = j - deltaX;
                
                // Check if source coordinates are within map boundaries
                if (oldI >= 0 && oldI < gridSize && oldJ >= 0 && oldJ < gridSize) {
                    // Copy existing terrain
                    newTerrainMap[i][j] = this.tileMap.terrainMap[oldI][oldJ];
                } else {
                    // For areas that would be outside the original map,
                    // use the nearest edge value (wrap around)
                    const clampedI = Math.max(0, Math.min(gridSize - 1, oldI));
                    const clampedJ = Math.max(0, Math.min(gridSize - 1, oldJ));
                    newTerrainMap[i][j] = this.tileMap.terrainMap[clampedI][clampedJ];
                }
            }
        }
        
        // Update tileMap with new terrain
        this.tileMap.terrainMap = newTerrainMap;
        
        // Update UI and export
        this.updateCanvasWithData();
        this.exportMap();
    }

    async initGridCanvas() {
        // Initialize the canvas with our map renderer

        await this.initImageManager();

        // Render the initial map
        this.updateCanvasWithData();
        
        // Clean up resources
        this.imageManager.dispose();
    }

    handleCanvasInteraction(event) {
        // Get mouse position relative to canvas
        const rect = this.canvasEl.getBoundingClientRect();
        let mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        if(!this.gameEditor.getCollections().configs.game.isIsometric) {
            mouseX -= (this.canvasEl.width - this.mapSize * this.config.gridSize) / 2;
        }
        
        if (this.placementMode === 'terrain') {
            // Original terrain placement logic
            const gridPos = this.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);
            
            // Check if coordinates are within bounds
            if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize && 
                snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {
                
                // Update terrain map with selected terrain ID
                this.tileMap.terrainMap[snappedGrid.y][snappedGrid.x] = this.currentTerrainId;
                
                // Update the map rendering
                this.updateCanvasWithData();
                
                // Export the updated map
                this.exportMap();
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
            
            // Update the map rendering
            this.updateCanvasWithData();
            
            // Export the updated map
            this.exportMap();
        }
    }

    async updateCanvasWithData() {
        if(this.tileMap.terrainMap.length > 0){
            this.mapRenderer.isMapCached = false;
            this.mapRenderer.renderBG(this.tileMap, []);
            this.mapRenderer.renderFG();
        }
    }

    exportMap() {
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveTileMap', {
            detail: { data: this.tileMap, propertyName: this.savePropertyName, refresh: false },
            bubbles: true,
            cancelable: true
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }
}
                   