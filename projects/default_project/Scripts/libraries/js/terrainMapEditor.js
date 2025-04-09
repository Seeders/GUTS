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
    
        // Terrain map structure without explicit IDs
        this.tileMap = {
            size: 16,
            terrainTypes: [
                { type: "start", color: "#ffff00", image: [] },
                { type: "end", color: "#ff0000", image: [] },
                { type: "path", color: "#eeae9e", image: [] },
                { type: "grass", color: "#8bc34a", image: [] },
                { type: "water", color: "#64b5f6", image: [] },
                { type: "rock", color: "#9e9e9e", image: [] }
            ],
            terrainMap: []
        };

        this.environment = this.gameEditor.getCollections().environment;
        this.terrainTypesContainer = null;
        this.draggedItem = null;
        this.dragOverItem = null; // Track the item being dragged over

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
        
            // Strip id from terrainTypes if present, assume order is correct
            this.tileMap.terrainTypes = this.tileMap.terrainTypes.map(terrain => {
                if (terrain.id !== undefined) {
                    const { id, ...rest } = terrain;
                    return rest;
                }
                return terrain;
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
    }

    async initImageManager() {
        this.imageManager = new this.engineClasses.ImageManager(this.gameEditor, { imageSize: this.config.imageSize }, { ShapeFactory: this.engineClasses.ShapeFactory });
        await this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap } }, false);
        if(this.environment){
            await this.imageManager.loadImages("environment", this.environment, false);
        }
        const terrainImages = this.imageManager.getImages("levels", "level");

        this.terrainTileMapper = this.gameEditor.editorModuleInstances.TileMap;
        if(!this.terrainCanvasBuffer) {
            this.terrainCanvasBuffer = document.createElement('canvas');
        }
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
        const existingColorPicker = terrainsPanel.querySelector('.terrain-types-container');
        if (existingColorPicker) {
            terrainsPanel.removeChild(existingColorPicker);
        }
    
        this.terrainTypesContainer = document.createElement('div');
        this.terrainTypesContainer.className = 'terrain-types-container';
    
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
            editBtn.addEventListener('click', () => this.showTerrainEditForm(terrain));
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
    
        const addNewBtn = document.createElement('button');
        addNewBtn.className = 'add-terrain-btn';
        addNewBtn.innerHTML = '+ Add Terrain';
        addNewBtn.addEventListener('click', this.showAddTerrainForm.bind(this));
        this.terrainTypesContainer.appendChild(addNewBtn);
    
        terrainsPanel.appendChild(this.terrainTypesContainer);
    
        document.getElementById('saveTerrainBtn').addEventListener('click', this.saveTerrainType.bind(this));
        document.getElementById('cancelTerrainBtn').addEventListener('click', this.hideTerrainForm.bind(this));
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
            // Editing existing terrain (using index as identifier)
            const index = parseInt(editingId);
            if (index >= 0 && index < this.tileMap.terrainTypes.length) {
                if (this.tileMap.terrainTypes.some((t, i) => t.type === newType && i !== index)) {
                    alert('A terrain type with this name already exists');
                    return;
                }
                this.tileMap.terrainTypes[index] = { type: newType, color: newColor, image: newImage, buildable: newBuildable };
            }
        } else {
            // Adding new terrain
            if (this.tileMap.terrainTypes.some(t => t.type === newType)) {
                alert('A terrain type with this name already exists');
                return;
            }
            this.tileMap.terrainTypes.push({ type: newType, color: newColor, image: newImage, buildable: newBuildable });
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

    async updateCanvasWithData() {
        if(this.tileMap.terrainMap.length > 0){
            this.mapRenderer.isMapCached = false;
            this.mapRenderer.renderBG(this.tileMap, []);
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
                   