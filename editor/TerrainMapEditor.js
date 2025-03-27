import { MapManager } from "../engine/MapManager.js";
import { MapRenderer } from "../engine/MapRenderer.js";
import { ImageManager } from "../engine/ImageManager.js";
import { CoordinateTranslator } from "../engine/CoordinateTranslator.js";
import { TerrainImageProcessor } from "./TerrainImageProcessor.js";

class TerrainMapEditor {
    constructor(config = {}) {
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
        this.currentTerrainType = 'grass';
        this.isMouseDown = false;
        
        // Terrain map structure
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

        this.environment = [];
        this.terrainTypesContainer = null;
        this.draggedItem = null;

        // DOM elements
        this.canvasEl = document.getElementById('grid');
        
        // Managers and renderers
        this.imageManager = new ImageManager(this.config.imageSize);
        this.mapRenderer = null;
        this.mapManager = null;
        this.translator = new CoordinateTranslator(this.config, this.tileMap.size);

        // Bind methods to maintain correct context
        this.init = this.init.bind(this);
        this.setupTerrainTypesUI = this.setupTerrainTypesUI.bind(this);
        this.handleCanvasInteraction = this.handleCanvasInteraction.bind(this);
        this.exportMap = this.exportMap.bind(this);
        this.updateCanvasWithData = this.updateCanvasWithData.bind(this);
    }

    async init() {
        this.setupTerrainTypesUI();
        this.setupEventListeners();
        this.updateTerrainStyles();
        this.setupTerrainImageProcessor();
    }

    setupTerrainImageProcessor() {
        const processor = new TerrainImageProcessor();
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
            option.dataset.type = terrain.type;
            option.style.backgroundColor = terrain.color;
            
            // Set the first one as active by default (or current selected if updating)
            if (terrain.type === this.currentTerrainType) {
                option.classList.add('active');
            }
            
            // Add click event to select terrain
            option.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                option.classList.add('active');
                this.currentTerrainType = option.dataset.type;
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
            deleteBtn.addEventListener('click', () => this.deleteTerrain(terrain.type));
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
        const form = document.getElementById('terrainForm');
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Add Terrain Type';
        document.getElementById('editingType').value = '';
        document.getElementById('terrainType').value = '';
        document.getElementById('terrainColor').value = '#cccccc';
        document.getElementById('terrainColorText').value = '#cccccc';  
        document.getElementById('terrainImage').value = '[]';        
        document.getElementById('terrainBuildable').checked = false;         
    }

    showTerrainEditForm(terrain) {
        const form = document.getElementById('terrainForm');
        form.classList.add('show');
        document.getElementById('formTitle').textContent = 'Edit Terrain Type';
        document.getElementById('editingType').value = terrain.type;
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
        document.getElementById('terrainForm').classList.remove('show');
    }

    saveTerrainType() {
        const editingType = document.getElementById('editingType').value;
        const newType = document.getElementById('terrainType').value.trim();
        const newColor = document.getElementById('terrainColorText').value;
        const newImage = JSON.parse(document.getElementById('terrainImage').value);
        const newBuildable = document.getElementById('terrainBuildable').checked;
        
        if (!newType) {
            alert('Terrain type cannot be empty');
            return;
        }
        
        if (editingType) {
            // Editing existing terrain
            const index = this.tileMap.terrainTypes.findIndex(t => t.type === editingType);
            if (index !== -1) {
                // If type name is changing, update all map references
                if (editingType !== newType) {
                    // Check if new type name already exists
                    if (this.tileMap.terrainTypes.some(t => t.type === newType)) {
                        alert('A terrain type with this name already exists');
                        return;
                    }
                    
                    // Update terrainMap
                    for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
                        for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                            if (this.tileMap.terrainMap[y][x] === editingType) {
                                this.tileMap.terrainMap[y][x] = newType;
                            }
                        }
                    }
                    
                    // Update current terrain type if selected
                    if (this.currentTerrainType === editingType) {
                        this.currentTerrainType = newType;
                    }
                }
                
                // Update the terrain type
                this.tileMap.terrainTypes[index] = { type: newType, color: newColor, image: newImage, buildable: newBuildable };
            }
        } else {
            // Adding new terrain
            // Check if type already exists
            if (this.tileMap.terrainTypes.some(t => t.type === newType)) {
                alert('A terrain type with this name already exists');
                return;
            }
            
            // Add new terrain type
            this.tileMap.terrainTypes.push({ type: newType, color: newColor, image: newImage, buildable: newBuildable });
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

    deleteTerrain(typeToDelete) {
        // Don't allow deleting if it's the last terrain type
        if (this.tileMap.terrainTypes.length <= 1) {
            alert('Cannot delete the last terrain type');
            return;
        }
        
        // Confirm deletion
        if (!confirm(`Are you sure you want to delete the "${typeToDelete}" terrain type? All instances will be converted to grass.`)) {
            return;
        }
        
        // Find the default terrain to replace with (grass or first available)
        const defaultType = this.tileMap.terrainTypes.find(t => t.type === 'grass') || this.tileMap.terrainTypes[0];
        
        // Remove from terrainTypes array
        const index = this.tileMap.terrainTypes.findIndex(t => t.type === typeToDelete);
        if (index !== -1) {
            this.tileMap.terrainTypes.splice(index, 1);
        }
        
        // Update terrainMap - replace all instances with defaultType
        for (let y = 0; y < this.tileMap.terrainMap.length; y++) {
            for (let x = 0; x < this.tileMap.terrainMap[y].length; x++) {
                if (this.tileMap.terrainMap[y][x] === typeToDelete) {
                    this.tileMap.terrainMap[y][x] = defaultType.type;
                }
            }
        }
        
        // Update current terrain type if selected
        if (this.currentTerrainType === typeToDelete) {
            this.currentTerrainType = defaultType.type;
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
            css += `#level-editor-container .color-option.${terrain.type} { background-color: ${terrain.color}; }\n`;
        });
        
        styleElem.textContent = css;
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
            this.translator = new CoordinateTranslator(this.config, newGridSize);
            
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
        document.body.addEventListener('editTileMap', (event) => {
            this.config = event.detail.config;
            this.canvasEl.width = event.detail.config.canvasWidth;
            this.canvasEl.height = event.detail.config.canvasHeight;
            this.environment = event.detail.environment;
            this.tileMap = event.detail.tileMap;
            let bgColor = this.tileMap.terrainBGColor || "#7aad7b";
            document.getElementById('terrainBGColor').value = bgColor;
            this.canvasEl.backgroundColor = bgColor;
            this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap }});
            
            this.mapRenderer = new MapRenderer(
                this.canvasEl, 
                this.environment, 
                this.imageManager, 
                'level', 
                event.detail.config, 
                bgColor
            );

            // Update grid size if it's different
            if (this.tileMap.size && this.tileMap.size !== this.mapSize) {
                this.mapSize = this.tileMap.size;
                this.translator = new CoordinateTranslator(this.config, this.mapSize);
            } else {
                this.mapSize = this.defaultMapSize;
                this.translator = new CoordinateTranslator(this.config, this.mapSize);
            }
            
            document.getElementById('terrainMapSize').value = this.mapSize;
            
            // Load terrain types if provided
            this.updateTerrainStyles();
            this.setupTerrainTypesUI();
            this.initGridCanvas();
        });
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
        this.imageManager = new ImageManager(this.config.imageSize);
      
        await this.imageManager.loadImages("environment", this.environment);
        await this.imageManager.loadImages("levels", { level: { tileMap: this.tileMap }});
        
        // Initialize the map renderer
        if (!this.mapRenderer) {
            this.mapRenderer = new MapRenderer(
                this.canvasEl, 
                this.environment, 
                this.imageManager, 
                'level', 
                this.config, 
                this.tileMap.terrainBGColor
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
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        // Convert from isometric to grid coordinates
        const gridPos = this.translator.isoToGrid(mouseX, mouseY);
        
        // Snap to grid
        const snappedGrid = this.translator.snapToGrid(gridPos.x, gridPos.y);
        
        // Check if coordinates are within bounds
        if (snappedGrid.x >= 0 && snappedGrid.x < this.mapSize && 
            snappedGrid.y >= 0 && snappedGrid.y < this.mapSize) {
            
            // Update terrain map with selected terrain type
            this.tileMap.terrainMap[snappedGrid.y][snappedGrid.x] = this.currentTerrainType;
            
            // Update the map rendering
            this.updateCanvasWithData();
            
            // Export the updated map
            this.exportMap();
        }
    }

    updateCanvasWithData() {
        if(this.tileMap.terrainMap.length > 0){
            this.mapManager = new MapManager();
            this.mapRenderer.isMapCached = false;
            let map = this.mapManager.generateMap(this.tileMap);
            this.mapRenderer.renderBG({}, this.tileMap, map.tileMap, [], true);
        }
    }

    exportMap() {
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveTileMap', {
            detail: this.tileMap,
            bubbles: true,
            cancelable: true
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }

}


export { TerrainMapEditor };