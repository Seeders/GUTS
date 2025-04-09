class TerrainMapEditor {
    constructor(gameEditor, config = {}, { TileMap, TerrainImageProcessor, CoordinateTranslator, ImageManager, ShapeFactory }) {
        this.gameEditor = gameEditor;

        this.engineClasses = {
            TileMap: TileMap,
            TerrainImageProcessor: TerrainImageProcessor,
            CoordinateTranslator: CoordinateTranslator,
            ImageManager: ImageManager,
            ShapeFactory: ShapeFactory
        }
        // Default configuration
        this.defaultConfig = {
            gridSize: 48,
            imageSize: 128,
            canvasWidth: 1536, 
            canvasHeight: 768
        };
        this.config = { ...this.defaultConfig, ...config };

        // Grid and terrain configuration
        this.defaultMapSize = 16;
        this.mapSize = this.defaultMapSize;
        this.currentTerrainId = 3; // Default to grass (id: 3)
        this.isMouseDown = false;
        
        // Terrain map structure with IDs instead of string types
        this.tileMap = {
            size: 16,
            terrainTypes: [
                { id: 0, type: "start", color: "#ffff00", image: [] },
                { id: 1, type: "end", color: "#ff0000", image: [] },
                { id: 2, type: "path", color: "#eeae9e", image: [] },
                { id: 3, type: "grass", color: "#8bc34a", image: [] },
                { id: 4, type: "water", color: "#64b5f6", image: [] },
                { id: 5, type: "rock", color: "#9e9e9e", image: [] }
            ],
            terrainMap: []
        };

        this.environment = this.gameEditor.getCollections().environment;
        this.terrainTypesContainer = null;
        this.draggedItem = null;

        // DOM elements
        this.canvasEl = document.getElementById('grid');
        this.canvasEl.width = this.config.canvasWidth;
        this.canvasEl.height = this.config.canvasHeight;
        // Managers and renderers

        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor,  { imageSize: this.config.imageSize}, {ShapeFactory: ShapeFactory});
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
        this.setupEventListeners();
        this.updateTerrainStyles();
        this.setupTerrainImageProcessor();
    }

    setupEventListeners() {
        document.getElementById('terrainColor').addEventListener('change', (el) => {                    
            document.getElementById('terrainColorText').value = el.target.value;
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

        document.getElementById('terrainBGColor').addEventListener('change', (ev) => {
            this.tileMap.terrainBGColor = ev.target.value;
            this.canvasEl.backgroundColor = ev.target.value;
            this.exportMap();
        }); 

        // Handle mouseup event (stop dragging)
        document.addEventListener('mouseup', () => {
            this.isMouseDown = false;
        });

        // Add mouse down event for canvas
        this.canvasEl.addEventListener('mousedown', (e) => {
            this.isMouseDown = true;
            this.handleCanvasInteraction(e);
        });
        
        // Add mouse move event for drawing while dragging
        this.canvasEl.addEventListener('mousemove', (e) => {
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
            this.savePropertyName = event.detail.propertyName;
            this.canvasEl.width = this.config.canvasWidth;
            this.canvasEl.height = this.config.canvasHeight;
            let bgColor = this.tileMap.terrainBGColor || "#7aad7b";
            document.getElementById('terrainBGColor').value = bgColor;
            this.canvasEl.backgroundColor = bgColor;
            
            // Ensure terrain types have IDs if they don't already
            this.ensureTerrainIds();
            
            // Convert string-based terrainMap to ID-based if needed
            this.convertTerrainMapToIds();
    
            this.imageManager = new this.engineClasses.ImageManager(this.gameEditor,  { imageSize: this.config.imageSize}, {ShapeFactory: this.engineClasses.ShapeFactory});
          
            await this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap }}, false);

            const terrainImages = this.imageManager.getImages("levels", "level");

            this.terrainTileMapper = this.gameEditor.editorModuleInstances.TileMap;
            this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
            this.terrainCanvasBuffer.height =  this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;

            this.terrainTileMapper.init(this.terrainCanvasBuffer, this.gameEditor.getCollections().configs.game.gridSize, terrainImages, this.gameEditor.getCollections().configs.game.isIsometric);
            this.game = { state: {}, terrainTileMapper: this.terrainTileMapper, config: this.gameEditor.getCollections(), translator: this.translator };

            this.mapRenderer = new (this.gameEditor.scriptContext.getRenderer("MapRenderer"))(this.game, null,
                { 
                    gameConfig: this.config, 
                    terrainCanvasBuffer: this.terrainCanvasBuffer, 
                    canvasBuffer: this.canvasEl, 
                    environment: this.environment, 
                    imageManager: this.imageManager, 
                    levelName: 'level', 
                    level: { tileMap: this.tileMap }
                }
            );
            
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
    }

    // New method to ensure all terrain types have IDs
    ensureTerrainIds() {
        // If terrainTypes doesn't have IDs, add them
        let hasIds = this.tileMap.terrainTypes.every(terrain => terrain.hasOwnProperty('id'));
        
        if (!hasIds) {
            this.tileMap.terrainTypes.forEach((terrain, index) => {
                terrain.id = index;
            });
        }
        
        // Set default terrain ID
        const grassType = this.tileMap.terrainTypes.find(t => t.type === "grass");
        this.currentTerrainId = grassType ? grassType.id : 0;
    }
    
    // New method to convert string-based terrainMap to ID-based
    convertTerrainMapToIds() {
        // Skip if terrainMap is empty
        if (!this.tileMap.terrainMap || this.tileMap.terrainMap.length === 0) {
            return;
        }
        
        // Check if first cell is a string (needs conversion) or already numeric
        const firstCell = this.tileMap.terrainMap[0][0];
        if (typeof firstCell === 'number') {
            return; // Already using IDs
        }
        
        // Create a mapping of type names to IDs
        const typeToIdMap = {};
        this.tileMap.terrainTypes.forEach(terrain => {
            typeToIdMap[terrain.type] = terrain.id;
        });
        
        // Convert all cells from type names to IDs
        for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
            for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                const terrainType = this.tileMap.terrainMap[y][x];
                this.tileMap.terrainMap[y][x] = typeToIdMap[terrainType] || 0;
            }
        }
    }

    setupTerrainImageProcessor() {
        const processor = new this.engineClasses.TerrainImageProcessor();
        processor.initialize(
            document.getElementById('terrainImage'),
            document.getElementById('terrain-image-upload'),
            document.getElementById('terrain-image-display')
        );
        return processor;
    }

    setupTerrainTypesUI() {
        const terrainsPanel = document.getElementById('terrainsPanel');
        
        // Clear existing content
        const existingColorPicker = terrainsPanel.querySelector('.terrain-types-container');
        if (existingColorPicker) {
            terrainsPanel.removeChild(existingColorPicker);
        }
        
        // Create new terrain types container
        this.terrainTypesContainer = document.createElement('div');
        this.terrainTypesContainer.className = 'terrain-types-container';
        
        // Add terrain options from terrainTypes array
        this.tileMap.terrainTypes.forEach(terrain => {
            const terrainItem = document.createElement('div');
            terrainItem.className = 'terrain-item';
            terrainItem.draggable = true;
            
            // Add drag event listeners
            terrainItem.addEventListener('dragstart', this.handleDragStart.bind(this));
            terrainItem.addEventListener('dragover', this.handleDragOver.bind(this));
            terrainItem.addEventListener('drop', this.handleDrop.bind(this));
            terrainItem.addEventListener('dragend', this.handleDragEnd.bind(this));
            
            // Color option
            const option = document.createElement('div');
            option.className = 'color-option';
            option.dataset.id = terrain.id;
            option.dataset.type = terrain.type;
            option.style.backgroundColor = terrain.color;
            
            // Set the first one as active by default (or current selected if updating)
            if (terrain.id === this.currentTerrainId) {
                option.classList.add('active');
            }
            
            // Add click event to select terrain
            option.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                option.classList.add('active');
                this.currentTerrainId = parseInt(option.dataset.id);
            });
            
            // Label for the terrain type
            const label = document.createElement('div');
            label.className = 'terrain-label';
            label.textContent = terrain.type;
            
            // Button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'terrain-buttons';
            
            // Add edit button
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-terrain-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit terrain';
            editBtn.addEventListener('click', () => this.showTerrainEditForm(terrain));
            buttonContainer.appendChild(editBtn);
            
            // Add delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-terrain-btn';
            deleteBtn.innerHTML = '❌';
            deleteBtn.title = 'Delete terrain';
            deleteBtn.addEventListener('click', () => this.deleteTerrain(terrain.id));
            buttonContainer.appendChild(deleteBtn);
            
            // Assemble the terrain item
            terrainItem.appendChild(option);
            terrainItem.appendChild(label);
            terrainItem.appendChild(buttonContainer);
            
            this.terrainTypesContainer.appendChild(terrainItem);
        });
        
        // Add "Add New Terrain" button
        const addNewBtn = document.createElement('button');
        addNewBtn.className = 'add-terrain-btn';
        addNewBtn.innerHTML = '+ Add Terrain';
        addNewBtn.addEventListener('click', this.showAddTerrainForm.bind(this));
        this.terrainTypesContainer.appendChild(addNewBtn);
        
        terrainsPanel.appendChild(this.terrainTypesContainer);
        
        // Create or update the terrain form event listeners
        document.getElementById('saveTerrainBtn').addEventListener('click', this.saveTerrainType.bind(this));
        document.getElementById('cancelTerrainBtn').addEventListener('click', this.hideTerrainForm.bind(this));
    }

    handleDragStart(e) {
        this.draggedItem = e.target;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.target.innerHTML);
        e.target.style.opacity = '0.4';
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }
    
    handleDrop(e) {
        e.preventDefault();
        if (this.draggedItem !== e.target) {
            // Swap the positions in the DOM
            const allItems = Array.from(this.terrainTypesContainer.querySelectorAll('.terrain-item'));
            const draggedIndex = allItems.indexOf(this.draggedItem);
            const dropIndex = allItems.indexOf(e.target);
    
            // Update the terrainTypes array
            const temp = this.tileMap.terrainTypes[draggedIndex];
            this.tileMap.terrainTypes[draggedIndex] = this.tileMap.terrainTypes[dropIndex];
            this.tileMap.terrainTypes[dropIndex] = temp;
    
            // Update the DOM
            if (draggedIndex < dropIndex) {
                e.target.parentNode.insertBefore(this.draggedItem, e.target.nextSibling);
            } else {
                e.target.parentNode.insertBefore(this.draggedItem, e.target);
            }
            this.exportMap();
        }
        return false;
    }
    
    handleDragEnd(e) {
        e.target.style.opacity = '1';
        this.draggedItem = null;
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

    showTerrainEditForm(terrain) {
        const form = document.getElementById(this.modalId);
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Edit Terrain Type';
        document.getElementById('editingId').value = terrain.id; // Use ID instead of type
        document.getElementById('terrainType').value = terrain.type;
        document.getElementById('terrainColor').value = terrain.color;
        document.getElementById('terrainColorText').value = terrain.color;
        document.getElementById('terrainImage').value = JSON.stringify(terrain.image || []);   
        document.getElementById('terrainBuildable').checked = terrain.buildable;
        
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
        const editingId = document.getElementById('editingId').value;
        const newType = document.getElementById('terrainType').value.trim();
        const newColor = document.getElementById('terrainColorText').value;
        const newImage = JSON.parse(document.getElementById('terrainImage').value);
        const newBuildable = document.getElementById('terrainBuildable').checked;
        
        if (!newType) {
            alert('Terrain type cannot be empty');
            return;
        }
        
        if (editingId !== '') {
            // Editing existing terrain
            const id = parseInt(editingId);
            const index = this.tileMap.terrainTypes.findIndex(t => t.id === id);
            if (index !== -1) {
                // Check if new type name already exists (but not this one)
                const duplicateType = this.tileMap.terrainTypes.find(t => t.type === newType && t.id !== id);
                if (duplicateType) {
                    alert('A terrain type with this name already exists');
                    return;
                }
                
                // Update the terrain type
                this.tileMap.terrainTypes[index] = { 
                    id: id, 
                    type: newType, 
                    color: newColor, 
                    image: newImage, 
                    buildable: newBuildable 
                };
            }
        } else {
            // Adding new terrain - find next available ID
            const maxId = Math.max(...this.tileMap.terrainTypes.map(t => t.id), -1);
            const newId = maxId + 1;
            
            // Check if type already exists
            if (this.tileMap.terrainTypes.some(t => t.type === newType)) {
                alert('A terrain type with this name already exists');
                return;
            }
            
            // Add new terrain type
            this.tileMap.terrainTypes.push({ 
                id: newId, 
                type: newType, 
                color: newColor, 
                image: newImage, 
                buildable: newBuildable 
            });
        }
        
        // Update UI and CSS
        this.updateTerrainStyles();
        this.setupTerrainTypesUI();
        this.hideTerrainForm();        

        // Update canvas rendering
        this.updateCanvasWithData();
        
        // Export updated map
        this.exportMap();
    }

    deleteTerrain(idToDelete) {
        // Don't allow deleting if it's the last terrain type
        if (this.tileMap.terrainTypes.length <= 1) {
            alert('Cannot delete the last terrain type');
            return;
        }
        
        // Find the terrain by ID
        const terrainToDelete = this.tileMap.terrainTypes.find(t => t.id === idToDelete);
        if (!terrainToDelete) return;
        
        // Confirm deletion
        if (!confirm(`Are you sure you want to delete the "${terrainToDelete.type}" terrain type? All instances will be converted to the default terrain.`)) {
            return;
        }
        
        // Find the default terrain ID to replace with (grass or first available)
        const defaultTerrainId = this.tileMap.terrainTypes.find(t => t.type === 'grass')?.id || 
                               this.tileMap.terrainTypes[0].id;
        
        // Remove from terrainTypes array
        const index = this.tileMap.terrainTypes.findIndex(t => t.id === idToDelete);
        if (index !== -1) {
            this.tileMap.terrainTypes.splice(index, 1);
        }
        
        // Update terrainMap - replace all instances with defaultTerrainId
        for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
            for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                if (this.tileMap.terrainMap[y][x] === idToDelete) {
                    this.tileMap.terrainMap[y][x] = defaultTerrainId;
                }
            }
        }
        
        // Update current terrain ID if selected
        if (this.currentTerrainId === idToDelete) {
            this.currentTerrainId = defaultTerrainId;
        }
        
        // Update UI and CSS
        this.updateTerrainStyles();
        this.setupTerrainTypesUI();
        
        // Update canvas rendering
        this.updateCanvasWithData();
        
        // Export updated map
        this.exportMap();
    }

    updateTerrainStyles() {
        // Create or update the style element for terrain colors
        let styleElem = document.getElementById('terrainStyles');
        if (!styleElem) {
            styleElem = document.createElement('style');
            styleElem.id = 'terrainStyles';
            document.head.appendChild(styleElem);
        }
        
        // Generate CSS for each terrain type
        let css = '';
        this.tileMap.terrainTypes.forEach(terrain => {
            css += `#level-editor-container .color-option[data-id="${terrain.id}"] { background-color: ${terrain.color}; }\n`;
        });
        
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
        this.initGridCanvas();
        this.exportMap();
    }

    async initGridCanvas() {
        // Initialize the canvas with our map renderer
        if(this.environment){
            await this.imageManager.loadImages("environment", this.environment);
        }
        await this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap }});
        
        // Initialize the map renderer
        if (!this.mapRenderer) {
            this.terrainCanvasBuffer = document.createElement('canvas');
            this.terrainCanvasBuffer.width = this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
            this.terrainCanvasBuffer.height =  this.tileMap.size * this.gameEditor.getCollections().configs.game.gridSize;
            this.mapRenderer = new (this.gameEditor.scriptContext.getRenderer("MapRenderer"))(this.game, null,
                { 
                    gameConfig: this.config, 
                    terrainCanvasBuffer: this.terrainCanvasBuffer, 
                    canvasBuffer: this.canvasEl, 
                    environment: [], 
                    imageManager: this.imageManager, 
                    levelName: 'level', 
                    level: { tileMap: this.tileMap }
                }
            );
        }
      
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
        
        if(!this.gameEditor.getCollections().configs.game.isIsometric ) {
            mouseX -= ( this.canvasEl.width - this.mapSize *  this.config.gridSize) / 2;
        }
        // Convert from isometric to grid coordinates
        const gridPos = this.translator.isoToGrid(mouseX, mouseY);
        
        // Snap to grid
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
    }

    updateCanvasWithData() {
        if(this.tileMap.terrainMap.length > 0){
            // Make a copy of the tileMap for rendering that translates IDs to types
            const displayTileMap = this.prepareDisplayTileMap();
            
            this.mapManager = new (this.gameEditor.scriptContext.getComponent("MapManager"))(this.game, null, { level: { tileMap: displayTileMap } });
            this.mapRenderer.isMapCached = false;
            let map = this.mapManager.generateMap(displayTileMap);
            this.mapRenderer.renderBG(this.tileMap, []);
        }
    }
    
    // Helper method to create a display version of the tileMap for rendering
    prepareDisplayTileMap() {
        // Create a mapping of IDs to types
        const idToTypeMap = {};
        this.tileMap.terrainTypes.forEach(terrain => {
            idToTypeMap[terrain.id] = terrain.type;
        });
        
        // Create a deep copy of the tileMap
        const displayTileMap = JSON.parse(JSON.stringify(this.tileMap));
        
        // For display purposes, we need the MapRenderer to have type strings not IDs
        if (displayTileMap.terrainMap && displayTileMap.terrainMap.length > 0) {
            // Convert all cells from IDs to type names for display
            for (let y = 0; y < displayTileMap.terrainMap.length; y++) {
                for (let x = 0; x < displayTileMap.terrainMap[y].length; x++) {
                    const terrainId = displayTileMap.terrainMap[y][x];
                    displayTileMap.terrainMap[y][x] = idToTypeMap[terrainId] || idToTypeMap[0];
                }
            }
        }
        
        return displayTileMap;
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