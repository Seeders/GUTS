class DungeonEditor {
    constructor(gameEditor, config = {}, { TileMap, CoordinateTranslator, ImageManager, ShapeFactory }) {
        this.gameEditor = gameEditor;
        this.engineClasses = { TileMap, CoordinateTranslator, ImageManager, ShapeFactory };
        this.defaultConfig = { gridSize: 48, imageSize: 128, canvasWidth: 800, canvasHeight: 600 };
        this.config = { ...this.defaultConfig, ...config };

        // Current tile being edited
        this.currentTile = this.createDefaultTile();

        // Tile set for preview generation
        this.tileSet = [];

        // Editor state
        this.paintMode = 'floor'; // floor, wall, door
        this.contentMode = 'enemy'; // enemy, prop
        this.brushSize = 1;
        this.isMouseDown = false;
        this.lastPaintedCell = null;

        // Canvas elements
        this.canvasEl = document.getElementById('dungeonCanvas');
        if (this.canvasEl) {
            this.canvasEl.width = this.config.canvasWidth;
            this.canvasEl.height = this.config.canvasHeight;
            this.ctx = this.canvasEl.getContext('2d');
        }

        // Grid settings for tile interior
        this.cellSize = 32; // Size of each cell in pixels
        this.gridOffsetX = 50;
        this.gridOffsetY = 50;

        // Connection types
        this.CONNECTION_TYPES = ['wall', 'open', 'door', 'secret', 'wide'];

        // Terrain type colors
        this.terrainColors = {
            0: '#4a4a4a', // Wall
            1: '#8b7355', // Floor
            2: '#6b4423'  // Door
        };

        // Content markers
        this.enemyMarkers = [];
        this.propMarkers = [];

        this.init();
    }

    createDefaultTile() {
        const width = 2;
        const height = 2;
        const cellsPerUnit = 4; // 4x4 cells per grid unit

        return {
            id: 'new_tile',
            name: 'New Tile',
            width: width,
            height: height,
            weight: 10,
            category: 'room',
            // Interior terrain (4 cells per unit)
            terrainMap: this.createEmptyGrid(width * cellsPerUnit, height * cellsPerUnit, 1),
            heightMap: this.createEmptyGrid(width * cellsPerUnit, height * cellsPerUnit, 0),
            // Edge connections
            connections: {
                north: this.createConnectionArray(width, 'wall'),
                east: this.createConnectionArray(height, 'wall'),
                south: this.createConnectionArray(width, 'wall'),
                west: this.createConnectionArray(height, 'wall')
            },
            // Content
            content: {
                enemies: [],
                props: [],
                loot: 'none'
            }
        };
    }

    createEmptyGrid(width, height, defaultValue) {
        const grid = [];
        for (let y = 0; y < height; y++) {
            grid[y] = [];
            for (let x = 0; x < width; x++) {
                grid[y][x] = defaultValue;
            }
        }
        return grid;
    }

    createConnectionArray(size, defaultType) {
        return new Array(size).fill(defaultType);
    }

    init() {
        this.setupEventListeners();
        this.setupPanelEventListeners();
        this.render();
    }

    setupEventListeners() {
        // Listen for editDungeonTile event
        document.body.addEventListener('editDungeonTile', (event) => {
            if (event.detail.data) {
                this.currentTile = event.detail.data;
            }
            this.objectData = event.detail.objectData;
            this.savePropertyName = event.detail.propertyName;
            this.updateUIFromTile();
            this.render();
        });

        // Canvas mouse events
        if (this.canvasEl) {
            this.canvasEl.addEventListener('mousedown', (e) => {
                this.isMouseDown = true;
                this.handleCanvasClick(e);
            });

            this.canvasEl.addEventListener('mousemove', (e) => {
                if (this.isMouseDown) {
                    this.handleCanvasClick(e);
                }
                this.updateStatusBar(e);
            });

            this.canvasEl.addEventListener('mouseup', () => {
                this.isMouseDown = false;
                this.lastPaintedCell = null;
            });

            this.canvasEl.addEventListener('mouseleave', () => {
                this.isMouseDown = false;
                this.lastPaintedCell = null;
            });
        }
    }

    setupPanelEventListeners() {
        // Panel buttons
        const tileEditorBtn = document.getElementById('tileEditorBtn');
        const connectionsBtn = document.getElementById('connectionsBtn');
        const contentBtn = document.getElementById('contentBtn');
        const previewBtn = document.getElementById('previewBtn');

        if (tileEditorBtn) {
            tileEditorBtn.addEventListener('click', () => this.showPanel('tileEditorPanel'));
        }
        if (connectionsBtn) {
            connectionsBtn.addEventListener('click', () => this.showPanel('connectionsPanel'));
        }
        if (contentBtn) {
            contentBtn.addEventListener('click', () => this.showPanel('contentPanel'));
        }
        if (previewBtn) {
            previewBtn.addEventListener('click', () => this.showPanel('previewPanel'));
        }

        // Paint mode buttons
        const paintFloorBtn = document.getElementById('paintFloorBtn');
        const paintWallBtn = document.getElementById('paintWallBtn');
        const paintDoorBtn = document.getElementById('paintDoorBtn');

        if (paintFloorBtn) {
            paintFloorBtn.addEventListener('click', () => {
                this.paintMode = 'floor';
                this.updatePaintButtons();
            });
        }
        if (paintWallBtn) {
            paintWallBtn.addEventListener('click', () => {
                this.paintMode = 'wall';
                this.updatePaintButtons();
            });
        }
        if (paintDoorBtn) {
            paintDoorBtn.addEventListener('click', () => {
                this.paintMode = 'door';
                this.updatePaintButtons();
            });
        }

        // Tile property inputs
        const tileId = document.getElementById('tileId');
        const tileName = document.getElementById('tileName');
        const tileWidth = document.getElementById('tileWidth');
        const tileHeight = document.getElementById('tileHeight');
        const tileWeight = document.getElementById('tileWeight');
        const tileCategory = document.getElementById('tileCategory');

        if (tileId) tileId.addEventListener('change', (e) => this.currentTile.id = e.target.value);
        if (tileName) tileName.addEventListener('change', (e) => this.currentTile.name = e.target.value);
        if (tileWeight) tileWeight.addEventListener('change', (e) => this.currentTile.weight = parseInt(e.target.value));
        if (tileCategory) tileCategory.addEventListener('change', (e) => this.currentTile.category = e.target.value);

        if (tileWidth) {
            tileWidth.addEventListener('change', (e) => {
                this.resizeTile(parseInt(e.target.value), this.currentTile.height);
            });
        }
        if (tileHeight) {
            tileHeight.addEventListener('change', (e) => {
                this.resizeTile(this.currentTile.width, parseInt(e.target.value));
            });
        }

        // Brush size
        const brushSize = document.getElementById('interiorBrushSize');
        const brushSizeValue = document.getElementById('interiorBrushSizeValue');
        if (brushSize) {
            brushSize.addEventListener('input', (e) => {
                this.brushSize = parseInt(e.target.value);
                if (brushSizeValue) brushSizeValue.textContent = this.brushSize;
            });
        }

        // Save/Clear buttons
        const saveTileBtn = document.getElementById('saveTileBtn');
        const clearTileBtn = document.getElementById('clearTileBtn');

        if (saveTileBtn) {
            saveTileBtn.addEventListener('click', () => this.saveTile());
        }
        if (clearTileBtn) {
            clearTileBtn.addEventListener('click', () => this.clearTile());
        }

        // Preview buttons
        const generatePreviewBtn = document.getElementById('generatePreviewBtn');
        const randomSeedBtn = document.getElementById('randomSeedBtn');
        const addCurrentTileBtn = document.getElementById('addCurrentTileBtn');

        if (generatePreviewBtn) {
            generatePreviewBtn.addEventListener('click', () => this.generatePreview());
        }
        if (randomSeedBtn) {
            randomSeedBtn.addEventListener('click', () => {
                const seedInput = document.getElementById('previewSeed');
                if (seedInput) seedInput.value = Math.floor(Math.random() * 100000);
            });
        }
        if (addCurrentTileBtn) {
            addCurrentTileBtn.addEventListener('click', () => this.addCurrentTileToSet());
        }

        // Loot tier
        const lootTier = document.getElementById('lootTier');
        if (lootTier) {
            lootTier.addEventListener('change', (e) => {
                this.currentTile.content.loot = e.target.value;
            });
        }
    }

    showPanel(panelId) {
        const panels = ['tileEditorPanel', 'connectionsPanel', 'contentPanel', 'previewPanel'];
        const buttons = ['tileEditorBtn', 'connectionsBtn', 'contentBtn', 'previewBtn'];

        panels.forEach((id, index) => {
            const panel = document.getElementById(id);
            const btn = document.getElementById(buttons[index]);
            if (panel) {
                panel.style.display = id === panelId ? 'block' : 'none';
            }
            if (btn) {
                if (id === panelId) {
                    btn.classList.add('editor-module__btn--active');
                } else {
                    btn.classList.remove('editor-module__btn--active');
                }
            }
        });

        // Update connections panel if showing it
        if (panelId === 'connectionsPanel') {
            this.updateConnectionsPanel();
        }

        this.render();
    }

    updatePaintButtons() {
        const buttons = {
            floor: document.getElementById('paintFloorBtn'),
            wall: document.getElementById('paintWallBtn'),
            door: document.getElementById('paintDoorBtn')
        };

        Object.keys(buttons).forEach(mode => {
            if (buttons[mode]) {
                if (mode === this.paintMode) {
                    buttons[mode].classList.add('editor-module__btn--active');
                } else {
                    buttons[mode].classList.remove('editor-module__btn--active');
                }
            }
        });
    }

    updateUIFromTile() {
        const tileId = document.getElementById('tileId');
        const tileName = document.getElementById('tileName');
        const tileWidth = document.getElementById('tileWidth');
        const tileHeight = document.getElementById('tileHeight');
        const tileWeight = document.getElementById('tileWeight');
        const tileCategory = document.getElementById('tileCategory');
        const lootTier = document.getElementById('lootTier');

        if (tileId) tileId.value = this.currentTile.id;
        if (tileName) tileName.value = this.currentTile.name;
        if (tileWidth) tileWidth.value = this.currentTile.width;
        if (tileHeight) tileHeight.value = this.currentTile.height;
        if (tileWeight) tileWeight.value = this.currentTile.weight;
        if (tileCategory) tileCategory.value = this.currentTile.category;
        if (lootTier) lootTier.value = this.currentTile.content?.loot || 'none';

        this.updateConnectionsPanel();
    }

    updateConnectionsPanel() {
        const directions = ['north', 'east', 'south', 'west'];

        directions.forEach(dir => {
            const container = document.getElementById(`${dir}Connections`);
            if (!container) return;

            container.innerHTML = '';
            const connections = this.currentTile.connections[dir];

            connections.forEach((type, index) => {
                const slot = document.createElement('div');
                slot.className = 'dungeon-editor__connection-slot';

                const select = document.createElement('select');
                select.className = 'editor-module__select';

                this.CONNECTION_TYPES.forEach(connType => {
                    const option = document.createElement('option');
                    option.value = connType;
                    option.textContent = connType.charAt(0).toUpperCase() + connType.slice(1);
                    if (connType === type) option.selected = true;
                    select.appendChild(option);
                });

                select.addEventListener('change', (e) => {
                    this.currentTile.connections[dir][index] = e.target.value;
                    this.render();
                });

                const label = document.createElement('span');
                label.className = 'editor-module__label';
                label.textContent = `Slot ${index + 1}:`;

                slot.appendChild(label);
                slot.appendChild(select);
                container.appendChild(slot);
            });
        });
    }

    resizeTile(newWidth, newHeight) {
        const oldWidth = this.currentTile.width;
        const oldHeight = this.currentTile.height;
        const cellsPerUnit = 4;

        // Resize terrain and height maps
        const newTerrainWidth = newWidth * cellsPerUnit;
        const newTerrainHeight = newHeight * cellsPerUnit;

        const newTerrainMap = this.createEmptyGrid(newTerrainWidth, newTerrainHeight, 1);
        const newHeightMap = this.createEmptyGrid(newTerrainWidth, newTerrainHeight, 0);

        // Copy existing data
        const copyWidth = Math.min(oldWidth * cellsPerUnit, newTerrainWidth);
        const copyHeight = Math.min(oldHeight * cellsPerUnit, newTerrainHeight);

        for (let y = 0; y < copyHeight; y++) {
            for (let x = 0; x < copyWidth; x++) {
                if (this.currentTile.terrainMap[y] && this.currentTile.terrainMap[y][x] !== undefined) {
                    newTerrainMap[y][x] = this.currentTile.terrainMap[y][x];
                }
                if (this.currentTile.heightMap[y] && this.currentTile.heightMap[y][x] !== undefined) {
                    newHeightMap[y][x] = this.currentTile.heightMap[y][x];
                }
            }
        }

        this.currentTile.width = newWidth;
        this.currentTile.height = newHeight;
        this.currentTile.terrainMap = newTerrainMap;
        this.currentTile.heightMap = newHeightMap;

        // Resize connection arrays
        this.currentTile.connections.north = this.resizeConnectionArray(this.currentTile.connections.north, newWidth);
        this.currentTile.connections.south = this.resizeConnectionArray(this.currentTile.connections.south, newWidth);
        this.currentTile.connections.east = this.resizeConnectionArray(this.currentTile.connections.east, newHeight);
        this.currentTile.connections.west = this.resizeConnectionArray(this.currentTile.connections.west, newHeight);

        this.updateConnectionsPanel();
        this.render();
    }

    resizeConnectionArray(array, newSize) {
        if (array.length === newSize) return array;
        if (array.length < newSize) {
            return [...array, ...new Array(newSize - array.length).fill('wall')];
        }
        return array.slice(0, newSize);
    }

    handleCanvasClick(e) {
        const rect = this.canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if clicking on tile interior
        const cellX = Math.floor((x - this.gridOffsetX) / this.cellSize);
        const cellY = Math.floor((y - this.gridOffsetY) / this.cellSize);

        const maxX = this.currentTile.width * 4;
        const maxY = this.currentTile.height * 4;

        if (cellX >= 0 && cellX < maxX && cellY >= 0 && cellY < maxY) {
            // Skip if same cell as last paint
            if (this.lastPaintedCell && this.lastPaintedCell.x === cellX && this.lastPaintedCell.y === cellY) {
                return;
            }
            this.lastPaintedCell = { x: cellX, y: cellY };

            // Paint with brush
            this.paintCell(cellX, cellY);
        }
    }

    paintCell(centerX, centerY) {
        const terrainValue = this.paintMode === 'wall' ? 0 : this.paintMode === 'floor' ? 1 : 2;
        const maxX = this.currentTile.width * 4;
        const maxY = this.currentTile.height * 4;

        const half = Math.floor(this.brushSize / 2);

        for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;

                if (x >= 0 && x < maxX && y >= 0 && y < maxY) {
                    this.currentTile.terrainMap[y][x] = terrainValue;
                }
            }
        }

        this.render();
    }

    clearTile() {
        const cellsPerUnit = 4;
        const width = this.currentTile.width * cellsPerUnit;
        const height = this.currentTile.height * cellsPerUnit;

        this.currentTile.terrainMap = this.createEmptyGrid(width, height, 1);
        this.currentTile.heightMap = this.createEmptyGrid(width, height, 0);
        this.currentTile.content.enemies = [];
        this.currentTile.content.props = [];

        this.render();
    }

    saveTile() {
        // Dispatch save event
        const event = new CustomEvent('saveDungeonTile', {
            detail: {
                propertyName: this.savePropertyName,
                data: this.currentTile
            }
        });
        document.body.dispatchEvent(event);

        // Also update through gameEditor if available
        if (this.gameEditor && this.objectData) {
            this.objectData[this.savePropertyName] = this.currentTile;
            this.gameEditor.saveObject(this.objectData);
        }

        // Show feedback
        const btn = document.getElementById('saveTileBtn');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Saved!';
            btn.style.backgroundColor = '#10b981';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = '';
            }, 1500);
        }
    }

    updateStatusBar(e) {
        const rect = this.canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const cellX = Math.floor((x - this.gridOffsetX) / this.cellSize);
        const cellY = Math.floor((y - this.gridOffsetY) / this.cellSize);

        const statusText = document.getElementById('dungeonStatusText');
        if (statusText) {
            statusText.textContent = `Mode: ${this.paintMode} | Cell: ${cellX}, ${cellY}`;
        }
    }

    addCurrentTileToSet() {
        // Clone current tile and add to set
        const tileCopy = JSON.parse(JSON.stringify(this.currentTile));
        this.tileSet.push(tileCopy);
        this.updateTileSetList();
    }

    updateTileSetList() {
        const container = document.getElementById('tileSetList');
        if (!container) return;

        container.innerHTML = '';

        this.tileSet.forEach((tile, index) => {
            const item = document.createElement('div');
            item.className = 'dungeon-editor__tile-item';
            item.innerHTML = `
                <span>${tile.name} (${tile.width}x${tile.height})</span>
                <button class="editor-module__btn editor-module__btn--small editor-module__btn--danger" data-index="${index}">X</button>
            `;

            item.querySelector('button').addEventListener('click', () => {
                this.tileSet.splice(index, 1);
                this.updateTileSetList();
            });

            container.appendChild(item);
        });
    }

    generatePreview() {
        if (this.tileSet.length === 0) {
            alert('Add tiles to the set first');
            return;
        }

        const width = parseInt(document.getElementById('previewWidth')?.value || 8);
        const height = parseInt(document.getElementById('previewHeight')?.value || 8);
        const seed = parseInt(document.getElementById('previewSeed')?.value || 12345);
        const minRooms = parseInt(document.getElementById('previewMinRooms')?.value || 6);
        const maxRooms = parseInt(document.getElementById('previewMaxRooms')?.value || 12);

        // Generate level using simple algorithm
        const level = this.generateLevel(width, height, seed, minRooms, maxRooms);
        this.renderPreview(level);
    }

    generateLevel(width, height, seed, minRooms, maxRooms) {
        // Simple seeded random
        const random = this.mulberry32(seed);

        // Initialize grid
        const grid = [];
        for (let y = 0; y < height; y++) {
            grid[y] = new Array(width).fill(null);
        }

        const placedTiles = [];
        const targetRooms = minRooms + Math.floor(random() * (maxRooms - minRooms + 1));

        // Place first tile at center
        const startX = Math.floor(width / 2);
        const startY = Math.floor(height / 2);

        const firstTile = this.tileSet[Math.floor(random() * this.tileSet.length)];
        if (this.canPlaceTile(grid, startX, startY, firstTile, width, height)) {
            this.placeTile(grid, startX, startY, firstTile, placedTiles);
        }

        // Growing tree algorithm
        const frontier = [...placedTiles];
        let attempts = 0;
        const maxAttempts = 1000;

        while (placedTiles.length < targetRooms && frontier.length > 0 && attempts < maxAttempts) {
            attempts++;

            // Pick from frontier (mix of newest and random)
            const index = random() < 0.5 ? frontier.length - 1 : Math.floor(random() * frontier.length);
            const current = frontier[index];

            // Try to place adjacent tile
            const directions = this.shuffleArray(['north', 'east', 'south', 'west'], random);
            let placed = false;

            for (const dir of directions) {
                const newPos = this.getAdjacentPosition(current.x, current.y, current.tile.width, current.tile.height, dir);

                // Try each tile in random order
                const shuffledTiles = this.shuffleArray([...this.tileSet], random);

                for (const tile of shuffledTiles) {
                    if (this.canPlaceTile(grid, newPos.x, newPos.y, tile, width, height)) {
                        if (this.connectionsMatch(current.tile, tile, dir)) {
                            this.placeTile(grid, newPos.x, newPos.y, tile, placedTiles);
                            frontier.push(placedTiles[placedTiles.length - 1]);
                            placed = true;
                            break;
                        }
                    }
                }
                if (placed) break;
            }

            // Remove from frontier if no valid placements
            if (!placed) {
                frontier.splice(index, 1);
            }
        }

        return { grid, placedTiles, width, height };
    }

    mulberry32(seed) {
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    shuffleArray(array, random) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    canPlaceTile(grid, x, y, tile, gridWidth, gridHeight) {
        if (x < 0 || y < 0 || x + tile.width > gridWidth || y + tile.height > gridHeight) {
            return false;
        }

        for (let dy = 0; dy < tile.height; dy++) {
            for (let dx = 0; dx < tile.width; dx++) {
                if (grid[y + dy][x + dx] !== null) {
                    return false;
                }
            }
        }
        return true;
    }

    placeTile(grid, x, y, tile, placedTiles) {
        const placed = { x, y, tile: tile };

        for (let dy = 0; dy < tile.height; dy++) {
            for (let dx = 0; dx < tile.width; dx++) {
                grid[y + dy][x + dx] = placed;
            }
        }

        placedTiles.push(placed);
    }

    getAdjacentPosition(x, y, width, height, direction) {
        switch (direction) {
            case 'north': return { x, y: y - 1 };
            case 'south': return { x, y: y + height };
            case 'east': return { x: x + width, y };
            case 'west': return { x: x - 1, y };
        }
    }

    connectionsMatch(tile1, tile2, direction) {
        // Get opposite direction
        const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
        const conn1 = tile1.connections[direction];
        const conn2 = tile2.connections[opposite[direction]];

        // Check if connections are compatible
        if (conn1.length !== conn2.length) return false;

        for (let i = 0; i < conn1.length; i++) {
            if (!this.connectionTypesCompatible(conn1[i], conn2[conn2.length - 1 - i])) {
                return false;
            }
        }
        return true;
    }

    connectionTypesCompatible(type1, type2) {
        // Same types always match
        if (type1 === type2) return true;

        // Door matches door or open
        if ((type1 === 'door' && type2 === 'open') || (type1 === 'open' && type2 === 'door')) return true;

        // Wide matches open or wide
        if ((type1 === 'wide' && type2 === 'open') || (type1 === 'open' && type2 === 'wide')) return true;

        return false;
    }

    render() {
        if (!this.ctx) return;

        // Clear canvas
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);

        // Check which panel is active
        const previewPanel = document.getElementById('previewPanel');
        if (previewPanel && previewPanel.style.display !== 'none') {
            // Preview mode - render generated level
            return;
        }

        // Render tile interior
        this.renderTileInterior();

        // Render edge connections
        this.renderEdgeConnections();

        // Render content markers
        this.renderContentMarkers();
    }

    renderTileInterior() {
        const width = this.currentTile.width * 4;
        const height = this.currentTile.height * 4;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const terrainType = this.currentTile.terrainMap[y]?.[x] ?? 1;
                const color = this.terrainColors[terrainType] || '#8b7355';

                this.ctx.fillStyle = color;
                this.ctx.fillRect(
                    this.gridOffsetX + x * this.cellSize,
                    this.gridOffsetY + y * this.cellSize,
                    this.cellSize - 1,
                    this.cellSize - 1
                );
            }
        }

        // Draw grid lines
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 1;

        for (let x = 0; x <= width; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.gridOffsetX + x * this.cellSize, this.gridOffsetY);
            this.ctx.lineTo(this.gridOffsetX + x * this.cellSize, this.gridOffsetY + height * this.cellSize);
            this.ctx.stroke();
        }

        for (let y = 0; y <= height; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.gridOffsetX, this.gridOffsetY + y * this.cellSize);
            this.ctx.lineTo(this.gridOffsetX + width * this.cellSize, this.gridOffsetY + y * this.cellSize);
            this.ctx.stroke();
        }

        // Draw tile unit boundaries
        this.ctx.strokeStyle = '#666';
        this.ctx.lineWidth = 2;

        for (let x = 0; x <= this.currentTile.width; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.gridOffsetX + x * this.cellSize * 4, this.gridOffsetY);
            this.ctx.lineTo(this.gridOffsetX + x * this.cellSize * 4, this.gridOffsetY + height * this.cellSize);
            this.ctx.stroke();
        }

        for (let y = 0; y <= this.currentTile.height; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.gridOffsetX, this.gridOffsetY + y * this.cellSize * 4);
            this.ctx.lineTo(this.gridOffsetX + width * this.cellSize, this.gridOffsetY + y * this.cellSize * 4);
            this.ctx.stroke();
        }
    }

    renderEdgeConnections() {
        const width = this.currentTile.width * 4 * this.cellSize;
        const height = this.currentTile.height * 4 * this.cellSize;

        const connectionColors = {
            wall: '#666',
            open: '#4CAF50',
            door: '#FFC107',
            secret: '#9C27B0',
            wide: '#2196F3'
        };

        // North edge
        this.currentTile.connections.north.forEach((type, i) => {
            const x = this.gridOffsetX + (i + 0.5) * (width / this.currentTile.width);
            const y = this.gridOffsetY - 10;
            this.ctx.fillStyle = connectionColors[type] || '#666';
            this.ctx.fillRect(x - 8, y - 4, 16, 8);
        });

        // South edge
        this.currentTile.connections.south.forEach((type, i) => {
            const x = this.gridOffsetX + (i + 0.5) * (width / this.currentTile.width);
            const y = this.gridOffsetY + height + 10;
            this.ctx.fillStyle = connectionColors[type] || '#666';
            this.ctx.fillRect(x - 8, y - 4, 16, 8);
        });

        // East edge
        this.currentTile.connections.east.forEach((type, i) => {
            const x = this.gridOffsetX + width + 10;
            const y = this.gridOffsetY + (i + 0.5) * (height / this.currentTile.height);
            this.ctx.fillStyle = connectionColors[type] || '#666';
            this.ctx.fillRect(x - 4, y - 8, 8, 16);
        });

        // West edge
        this.currentTile.connections.west.forEach((type, i) => {
            const x = this.gridOffsetX - 10;
            const y = this.gridOffsetY + (i + 0.5) * (height / this.currentTile.height);
            this.ctx.fillStyle = connectionColors[type] || '#666';
            this.ctx.fillRect(x - 4, y - 8, 8, 16);
        });
    }

    renderContentMarkers() {
        // Render enemy spawn points
        this.currentTile.content.enemies.forEach(enemy => {
            const x = this.gridOffsetX + enemy.x * this.cellSize + this.cellSize / 2;
            const y = this.gridOffsetY + enemy.y * this.cellSize + this.cellSize / 2;

            this.ctx.fillStyle = '#ff4444';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 6, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Render prop placements
        this.currentTile.content.props.forEach(prop => {
            const x = this.gridOffsetX + prop.x * this.cellSize + this.cellSize / 2;
            const y = this.gridOffsetY + prop.y * this.cellSize + this.cellSize / 2;

            this.ctx.fillStyle = '#44ff44';
            this.ctx.fillRect(x - 4, y - 4, 8, 8);
        });
    }

    renderPreview(level) {
        if (!this.ctx || !level) return;

        // Clear canvas
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);

        const cellSize = Math.min(
            (this.canvasEl.width - 100) / level.width,
            (this.canvasEl.height - 100) / level.height
        );

        const offsetX = (this.canvasEl.width - level.width * cellSize) / 2;
        const offsetY = (this.canvasEl.height - level.height * cellSize) / 2;

        // Draw grid
        this.ctx.strokeStyle = '#333';
        for (let x = 0; x <= level.width; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(offsetX + x * cellSize, offsetY);
            this.ctx.lineTo(offsetX + x * cellSize, offsetY + level.height * cellSize);
            this.ctx.stroke();
        }
        for (let y = 0; y <= level.height; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(offsetX, offsetY + y * cellSize);
            this.ctx.lineTo(offsetX + level.width * cellSize, offsetY + y * cellSize);
            this.ctx.stroke();
        }

        // Draw placed tiles
        const drawnTiles = new Set();

        level.placedTiles.forEach(placed => {
            const key = `${placed.x},${placed.y}`;
            if (drawnTiles.has(key)) return;
            drawnTiles.add(key);

            // Draw tile background
            this.ctx.fillStyle = '#4a6741';
            this.ctx.fillRect(
                offsetX + placed.x * cellSize + 2,
                offsetY + placed.y * cellSize + 2,
                placed.tile.width * cellSize - 4,
                placed.tile.height * cellSize - 4
            );

            // Draw tile name
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '10px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(
                placed.tile.name.substring(0, 8),
                offsetX + (placed.x + placed.tile.width / 2) * cellSize,
                offsetY + (placed.y + placed.tile.height / 2) * cellSize + 4
            );
        });

        // Status
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Rooms: ${level.placedTiles.length}`, 10, 20);
    }
}
