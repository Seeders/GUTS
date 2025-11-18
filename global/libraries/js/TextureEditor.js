class TextureEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.canvas = null;
        this.ctx = null;
        this.currentColor = '#000000FF'; // Added alpha component (FF = fully opaque)
        this.brushSize = 1;
        this.isDrawing = false;
        this.history = [];
        this.historyIndex = -1;
        this.colorPalette = [];
        if (this.gameEditor.getCollections().palettes && this.gameEditor.getCollections().configs.game.palette) {
            const palette = this.gameEditor.getCollections().palettes[this.gameEditor.getCollections().configs.game.palette];

            if (palette) {
                for(let key in palette) {
                    if(key.toLowerCase().endsWith('color')){
                        this.colorPalette.push(palette[key]);
                    }
                }
            }
        }
        this.activeTool = 'brush'; // Default active tool
        
        // Transparency checker pattern properties
        this.transparencyCheckerSize = 10;
        this.transparencyCheckerColors = ['#DDDDDD', '#FFFFFF'];
        
        // Zoom related properties
        this.zoomLevel = 1;
        this.maxZoomLevel = 16;
        this.minZoomLevel = 0.25;
        this.imageWidth = 0;
        this.imageHeight = 0;
        
        this.setupUI();
        this.setupEventListeners();
    }

    setupUI() {
        const container = document.getElementById('texture-editor-container');
        if (!container) return;
        
        // Setup color palette
        const paletteEl = container.querySelector('#color-palette');
        this.colorPalette.forEach(color => {
            const colorBtn = document.createElement('div');
            colorBtn.className = 'texture-editor__color-btn';
            colorBtn.style.backgroundColor = this.hexToRgbaString(color);
            colorBtn.dataset.color = color;
            paletteEl.appendChild(colorBtn);
        });

        // Initialize canvas
        this.canvas = document.getElementById('texture-canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        
        // Set initial UI state
        document.getElementById('noTextureMessage').style.display = 'block';
        this.canvas.style.display = 'none';

        // Create a container for the canvas if it doesn't exist
        let canvasContainer = this.canvas.parentElement;

        // Add zoom controls to the canvas area
        if (canvasContainer) {
            this.addZoomControls(canvasContainer);
        }

        if (canvasContainer) {
            
            // Add transparency checker pattern background to container
            this.setupTransparencyChecker(canvasContainer);

        }
    }
    
    addZoomControls(container) {
        // Create zoom controls container
        const zoomControlsContainer = document.createElement('div');
        zoomControlsContainer.className = 'texture-editor__zoom-controls editor-module__status-bar';
        zoomControlsContainer.style.display = 'flex';
        zoomControlsContainer.style.alignItems = 'center';
        zoomControlsContainer.style.gap = '12px';
        zoomControlsContainer.style.position = 'absolute';
        zoomControlsContainer.style.bottom = '0';
        zoomControlsContainer.style.left = '0';
        zoomControlsContainer.style.right = '0';
        
        // Zoom out button
        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.id = 'zoom-out-btn';
        zoomOutBtn.innerText = '-';
        zoomOutBtn.className = 'editor-module__btn editor-module__btn--small';
        zoomOutBtn.title = 'Zoom Out';

        // Zoom display
        const zoomDisplay = document.createElement('span');
        zoomDisplay.id = 'zoom-display';
        zoomDisplay.innerText = '100%';

        // Zoom in button
        const zoomInBtn = document.createElement('button');
        zoomInBtn.id = 'zoom-in-btn';
        zoomInBtn.innerText = '+';
        zoomInBtn.className = 'editor-module__btn editor-module__btn--small';
        zoomInBtn.title = 'Zoom In';

        // Reset zoom button
        const resetZoomBtn = document.createElement('button');
        resetZoomBtn.id = 'reset-zoom-btn';
        resetZoomBtn.innerText = 'Reset';
        resetZoomBtn.className = 'editor-module__btn editor-module__btn--small';
        resetZoomBtn.title = 'Reset Zoom to 100%';

        // Dimensions display
        const dimensionsDisplay = document.createElement('span');
        dimensionsDisplay.id = 'dimensions-display';
        dimensionsDisplay.innerText = 'Dimensions: 0 x 0';
        
        // Add all controls to container
        zoomControlsContainer.appendChild(zoomOutBtn);
        zoomControlsContainer.appendChild(zoomDisplay);
        zoomControlsContainer.appendChild(zoomInBtn);
        zoomControlsContainer.appendChild(resetZoomBtn);
        zoomControlsContainer.appendChild(dimensionsDisplay);
        
        // Add container to the editor UI
        container.appendChild(zoomControlsContainer);
    }

    setupEventListeners() {
        const container = document.getElementById('texture-editor-container');
        if (!container) return;

        // Global events
        document.body.addEventListener('editTexture', (event) => {
            this.updateUIFromSettings(event.detail.data);
        });

        // Tool selection
        container.querySelectorAll('.editor-module__btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                container.querySelectorAll('.editor-module__btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.setActiveTool(e.target.id);
            });
        });

        // Brush size
        const brushSizeInput = container.querySelector('#brush-size');
        const brushSizeDisplay = container.querySelector('#brush-size-display');
        brushSizeInput.addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            brushSizeDisplay.textContent = `${this.brushSize}px`;
        });

        // Color palette
        container.querySelectorAll('.texture-editor__color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                container.querySelectorAll('.texture-editor__color-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentColor = e.target.dataset.color;
                // Update both color and transparency inputs
                const colorValue = this.currentColor.substring(0, 7);
                const alphaValue = parseInt(this.currentColor.substring(7, 9), 16) || 255;
                
                container.querySelector('#custom-color-picker').value = colorValue;
                const transparencySlider = container.querySelector('#transparency-slider');
                if (transparencySlider) {
                    transparencySlider.value = alphaValue;
                    document.getElementById('transparency-display').textContent = 
                        `${Math.round((alphaValue / 255) * 100)}%`;
                }
            });
        });

        // Custom color picker
        const customColorPicker = container.querySelector('#custom-color-picker');
        customColorPicker.addEventListener('input', (e) => {
            // Preserve alpha when changing color
            const alpha = this.currentColor.substring(7, 9) || 'FF';
            this.currentColor = e.target.value + alpha;
            container.querySelectorAll('.texture-editor__color-btn').forEach(b => b.classList.remove('active'));
        });
        
        // Transparency slider
        const transparencySlider = container.querySelector('#transparency-slider');
        transparencySlider.addEventListener('input', (e) => {
            const alphaValue = parseInt(e.target.value);
            const alphaHex = alphaValue.toString(16).padStart(2, '0').toUpperCase();
            
            // Update alpha in the current color
            this.currentColor = this.currentColor.substring(0, 7) + alphaHex;
            
            // Update display
            document.getElementById('transparency-display').textContent = 
                `${Math.round((alphaValue / 255) * 100)}%`;
        });

        // Canvas drawing events
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click                
                this.startDrawing(e);
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDrawing) {
                this.draw(e);
            }
        });
        
        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) { // Left click
                if (this.isDrawing) {
                    this.stopDrawing();
                }
            } 
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            this.stopDrawing();
        });
        
        // Zoom with mouse wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Calculate zoom point relative to canvas
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Calculate zoom direction
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            
            // Calculate new zoom level
            let newZoom = this.zoomLevel * zoomFactor;
            
            // Constrain zoom level
            newZoom = Math.max(this.minZoomLevel, Math.min(this.maxZoomLevel, newZoom));
            
            // Calculate zoom point in image coordinates
            const imageX = mouseX / this.zoomLevel;
            const imageY = mouseY / this.zoomLevel;
            
            // Update zoom level
            this.zoomLevel = newZoom;            
            
            // Update display
            this.updateZoomDisplay();
            this.renderCanvas();
        });
        
        // Zoom control buttons
        container.querySelector('#zoom-in-btn').addEventListener('click', () => {
            this.zoom(1.25);
        });
        
        container.querySelector('#zoom-out-btn').addEventListener('click', () => {
            this.zoom(0.8);
        });
        
        container.querySelector('#reset-zoom-btn').addEventListener('click', () => {
            this.resetZoom();
        });

        // Action buttons
        container.querySelector('#new-btn').addEventListener('click', () => this.newImage());
        container.querySelector('#undo-btn').addEventListener('click', () => this.undo());
        container.querySelector('#redo-btn').addEventListener('click', () => this.redo());
        container.querySelector('#clear-btn').addEventListener('click', () => this.clear());
        container.querySelector('.export-btn').addEventListener('click', () => {
            this.saveTexture(this.getCurrentTexture());
        });

        // File upload
        container.querySelector('input[type="file"]').addEventListener('change', (e) => {
            this.handleImageUpload(e);
        });
    }

    zoom(factor) {
        // Calculate new zoom level
        let newZoom = this.zoomLevel * factor;
        
        // Constrain zoom level
        newZoom = Math.max(this.minZoomLevel, Math.min(this.maxZoomLevel, newZoom));
        
        // Calculate center point of the viewport
        const viewportWidth = this.canvas.clientWidth;
        const viewportHeight = this.canvas.clientHeight;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;
        
        // Calculate zoom point in image coordinates
        const imageX = centerX / this.zoomLevel;
        const imageY = centerY / this.zoomLevel;
        
        // Update zoom level
        this.zoomLevel = newZoom;
        
        // Update display
        this.updateZoomDisplay();
        this.renderCanvas();
        // Update canvas display size
        this.updateCanvasDisplaySize();
    }
    
    updateCanvasDisplaySize() {

        
        // Set the canvas display size based on zoom
        const displayWidth = Math.ceil(this.imageWidth * this.zoomLevel);
        const displayHeight = Math.ceil(this.imageHeight * this.zoomLevel);
        
        this.canvas.style.width = `${displayWidth}px`;
        this.canvas.style.height = `${displayHeight}px`;
        this.transparencyChecker.style.width = `${displayWidth}px`;
        this.transparencyChecker.style.height = `${displayHeight}px`;
        
        // Update the cursor based on the active tool
        this.canvas.style.cursor = this.getToolCursor();
    }
    
    setupTransparencyChecker(container) {
        const displayWidth = Math.ceil(this.imageWidth * this.zoomLevel);
        const displayHeight = Math.ceil(this.imageHeight * this.zoomLevel);
        // Create and add transparency checker background
        this.transparencyChecker = document.createElement('div');
        this.transparencyChecker.className = 'transparency-checker';
        this.transparencyChecker.style.position = 'absolute';
        this.transparencyChecker.style.top = '0';
        this.transparencyChecker.style.left = '0';
        this.transparencyChecker.style.bottom = '0';
        this.transparencyChecker.style.right = '0';        
        this.transparencyChecker.style.margin = 'auto';
        this.transparencyChecker.style.width = `${displayWidth}px`;
        this.transparencyChecker.style.height = `${displayHeight}px`;
        this.transparencyChecker.style.backgroundImage = 'linear-gradient(45deg, #ffffff10 25%, transparent 25%), linear-gradient(-45deg, #ffffff10 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ffffff10 75%), linear-gradient(-45deg, transparent 75%, #ffffff10 75%)';
        this.transparencyChecker.style.backgroundSize = '10px 10px';
        this.transparencyChecker.style.backgroundPosition = '0 0, 0 10px, 10px -10px, -10px 0px';
        this.transparencyChecker.style.pointerEvents = 'none'; // Make it non-interactive
        this.transparencyChecker.style.zIndex = '-1';
        
        container.appendChild(this.transparencyChecker);
    }
    
    resetZoom() {
        // Reset zoom level
        this.zoomLevel = 1;

        // Update display
        this.updateZoomDisplay();
        this.renderCanvas();

        // Update canvas display size to match zoom
        this.updateCanvasDisplaySize();
    }
    
    updateZoomDisplay() {
        const zoomDisplay = document.getElementById('zoom-display');
        if (zoomDisplay) {
            zoomDisplay.innerText = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }
    
    getToolCursor() {
        switch (this.activeTool) {
            case 'brush': return 'crosshair';
            case 'eraser': return 'cell';
            case 'fill': return 'pointer';
            case 'eyedropper': return 'copy';
            default: return 'crosshair';
        }
    }

    setActiveTool(toolId) {
        switch (toolId) {
            case 'brush-tool':
                this.activeTool = 'brush';
                this.canvas.style.cursor = 'crosshair';
                break;
            case 'eraser-tool':
                this.activeTool = 'eraser';
                this.canvas.style.cursor = 'cell';
                break;
            case 'fill-tool':
                this.activeTool = 'fill';
                this.canvas.style.cursor = 'pointer';
                break;
            case 'eyedropper-tool':
                this.activeTool = 'eyedropper';
                this.canvas.style.cursor = 'copy';
                break;
            default:
                this.activeTool = 'brush';
                this.canvas.style.cursor = 'crosshair';
        }
    }

    updateUIFromSettings(textureData) {
        // Expect object with imagePath property
        if (!textureData || !textureData.imagePath) {
            document.getElementById('noTextureMessage').style.display = 'block';
            this.canvas.style.display = 'none';
            return;
        }

        // File path - construct full path
        const projectName = this.gameEditor.getCurrentProject();
        const imageSrc = `/projects/${projectName}/resources/${textureData.imagePath}`;

        // Load image onto canvas
        const img = new Image();
        img.onload = () => {
            // Set canvas dimensions to match image dimensions
            this.imageWidth = img.width;
            this.imageHeight = img.height;

            // Update canvas size to match image size
            this.canvas.width = this.imageWidth;
            this.canvas.height = this.imageHeight;

            // Update dimensions display
            this.updateDimensionsDisplay();

            // Show canvas and hide message
            document.getElementById('noTextureMessage').style.display = 'none';
            this.canvas.style.display = 'block';

            // Draw image on canvas with proper alpha support
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, 0, 0, this.imageWidth, this.imageHeight);

            // Reset zoom
            this.resetZoom();

            // Save initial state to history
            this.saveToHistory();

            // Apply initial render
            this.renderCanvas();
        };
        img.src = imageSrc;
    }
    
    updateDimensionsDisplay() {
        const dimensionsDisplay = document.getElementById('dimensions-display');
        if (dimensionsDisplay) {
            dimensionsDisplay.innerText = `Dimensions: ${this.imageWidth} x ${this.imageHeight}`;
        }
    }
    
    renderCanvas() {
        // Store the current state
        const currentState = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        // Clear the canvas
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Set up the transformation for zoom
        this.ctx.setTransform(
            this.zoomLevel, 0, 
            0, this.zoomLevel, 
            this.zoomLevel, 
            this.zoomLevel
        );
        
        // Draw the image data
        this.ctx.putImageData(currentState, 0, 0);
        
        // Reset the transformation for UI elements
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    startDrawing(e) {
        this.isDrawing = true;
        
        // Save state before drawing
        this.saveToHistory();
        
        const pos = this.getCanvasCoordinates(e);
        
        switch (this.activeTool) {
            case 'brush':
                this.drawPixel(pos.x, pos.y);
                break;
            case 'eraser':
                this.erasePixel(pos.x, pos.y);
                break;
            case 'fill':
                this.fillArea(pos.x, pos.y);
                break;
            case 'eyedropper':
                this.pickColor(pos.x, pos.y);
                break;
        }
    }

    draw(e) {
        if (!this.isDrawing) return;
        
        const pos = this.getCanvasCoordinates(e);
        
        switch (this.activeTool) {
            case 'brush':
                this.drawPixel(pos.x, pos.y);
                break;
            case 'eraser':
                this.erasePixel(pos.x, pos.y);
                break;
        }
    }

    stopDrawing() {
        this.isDrawing = false;
    }

    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        
        // Calculate the mouse position relative to the canvas
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Convert to image coordinates considering zoom
        const x = Math.floor(mouseX / this.zoomLevel);
        const y = Math.floor(mouseY / this.zoomLevel);
        
        return { x, y };
    }

    drawPixel(x, y) {
        // Save current transform
        this.ctx.save();
        
        // Reset transform for accurate drawing
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // Use RGBA for colors with transparency
        this.ctx.fillStyle = this.hexToRgbaString(this.currentColor);
        
        if (this.brushSize === 1) {
            this.ctx.fillRect(x, y, 1, 1);
        } else {
            const offset = Math.floor(this.brushSize / 2);
            for (let i = -offset; i < this.brushSize - offset; i++) {
                for (let j = -offset; j < this.brushSize - offset; j++) {
                    const posX = x + i;
                    const posY = y + j;
                    if (posX >= 0 && posX < this.canvas.width && posY >= 0 && posY < this.canvas.height) {
                        this.ctx.fillRect(posX, posY, 1, 1);
                    }
                }
            }
        }
        
        // Restore transform
        this.ctx.restore();
        
        // Reapply zoom
        this.renderCanvas();
    }
    erasePixel(x, y) {
        // Save current transform
        this.ctx.save();
        
        // Reset transform for accurate erasing
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // Get current image data
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        
        // Apply eraser to pixels
        if (this.brushSize === 1) {
            const index = (y * this.canvas.width + x) * 4;
            // Set all channels (RGB and Alpha) to 0 for full transparency
            data[index] = 0;     // R
            data[index + 1] = 0; // G
            data[index + 2] = 0; // B
            data[index + 3] = 0; // A
        } else {
            const offset = Math.floor(this.brushSize / 2);
            for (let i = -offset; i < this.brushSize - offset; i++) {
                for (let j = -offset; j < this.brushSize - offset; j++) {
                    const posX = x + i;
                    const posY = y + j;
                    if (posX >= 0 && posX < this.canvas.width && posY >= 0 && posY < this.canvas.height) {
                        const index = (posY * this.canvas.width + posX) * 4;
                        // Set all channels to 0
                        data[index] = 0;     // R
                        data[index + 1] = 0; // G
                        data[index + 2] = 0; // B
                        data[index + 3] = 0; // A
                    }
                }
            }
        }
        
        // Put the modified image data back
        this.ctx.putImageData(imageData, 0, 0);
        
        // Restore transform
        this.ctx.restore();
        
        // Reapply zoom
        this.renderCanvas();
    }

    fillArea(x, y) {
        if (x < 0 || x >= this.imageWidth || y < 0 || y >= this.imageHeight) {
            return; // Out of bounds
        }
        
        // Save current transform
        this.ctx.save();
        
        // Reset transform for accurate fill
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // Get the pixel color at the clicked position
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        
        // Get the index of the clicked pixel
        const index = (y * this.canvas.width + x) * 4;
        const targetR = data[index];
        const targetG = data[index + 1];
        const targetB = data[index + 2];
        const targetA = data[index + 3];
        
        // Don't fill if clicking on the same color
        const fillColor = this.hexToRgba(this.currentColor);
        if (targetR === fillColor.r && targetG === fillColor.g && targetB === fillColor.b && targetA === fillColor.a) {
            this.ctx.restore();
            return;
        }
        
        // Flood fill algorithm
        const stack = [{x, y}];
        const visited = new Set();
        
        while (stack.length > 0) {
            const pixel = stack.pop();
            const px = pixel.x;
            const py = pixel.y;
            
            // Skip if outside canvas or already visited
            if (px < 0 || px >= this.canvas.width || py < 0 || py >= this.canvas.height ||
                visited.has(`${px},${py}`)) {
                continue;
            }
            
            // Get current pixel index
            const currentIndex = (py * this.canvas.width + px) * 4;
            
            // Check if the pixel has the target color
            if (data[currentIndex] === targetR && 
                data[currentIndex + 1] === targetG && 
                data[currentIndex + 2] === targetB && 
                data[currentIndex + 3] === targetA) {
                
                // Set the new color
                data[currentIndex] = fillColor.r;
                data[currentIndex + 1] = fillColor.g;
                data[currentIndex + 2] = fillColor.b;
                data[currentIndex + 3] = fillColor.a;
                
                // Mark as visited
                visited.add(`${px},${py}`);
                
                // Add neighbors to stack
                stack.push({x: px + 1, y: py});
                stack.push({x: px - 1, y: py});
                stack.push({x: px, y: py + 1});
                stack.push({x: px, y: py - 1});
            }
        }
        
        // Update the canvas with the new image data
        this.ctx.putImageData(imageData, 0, 0);
        
        // Restore transform
        this.ctx.restore();
        
        // Reapply zoom
        this.renderCanvas();
    }

    pickColor(x, y) {
        if (x < 0 || x >= this.imageWidth || y < 0 || y >= this.imageHeight) {
            return; // Out of bounds
        }
        
        // Save current transform
        this.ctx.save();
        
        // Reset transform for accurate color picking
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        const pixel = this.ctx.getImageData(x, y, 1, 1).data;
        
        // Create hex color including alpha
        const hexColor = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}${pixel[3].toString(16).padStart(2, '0')}`;
        
        this.currentColor = hexColor;
        
        // Update UI to show selected color
        const customColorPicker = document.querySelector('#custom-color-picker');
        if (customColorPicker) {
            customColorPicker.value = hexColor.substring(0, 7);
        }
        
        // Update transparency slider
        const transparencySlider = document.querySelector('#transparency-slider');
        if (transparencySlider) {
            transparencySlider.value = pixel[3];
            document.getElementById('transparency-display').textContent = 
                `${Math.round((pixel[3] / 255) * 100)}%`;
        }
        
        // Deselect any color in the palette
        document.querySelectorAll('.texture-editor__color-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.color === hexColor) {
                btn.classList.add('active');
            }
        });
        
        // Restore transform
        this.ctx.restore();
    }

    hexToRgba(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const a = parseInt(hex.slice(7, 9) || 'FF', 16);
        return { r, g, b, a };
    }
    
    hexToRgbaString(hex) {
        const { r, g, b, a } = this.hexToRgba(hex);
        return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    }

    saveToHistory() {
        // Trim history if we're not at the end
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Save current state - we need to reset transform to get the actual image data
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        
        // Save to history
        this.history.push(imageData);
        this.historyIndex = this.history.length - 1;
        
        // Update undo/redo buttons
        this.updateUndoRedoButtons();
    }

    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) {
            undoBtn.disabled = this.historyIndex <= 0;
        }
        
        if (redoBtn) {
            redoBtn.disabled = this.historyIndex >= this.history.length - 1;
        }
    }

    newImage() {
        // Prompt user for dimensions
        const width = prompt('Enter width for new texture (1-2048):', '64');
        const height = prompt('Enter height for new texture (1-2048):', '64');
    
        // Validate input
        const newWidth = parseInt(width);
        const newHeight = parseInt(height);
    
        if (isNaN(newWidth) || isNaN(newHeight) || newWidth < 1 || newWidth > 2048 || newHeight < 1 || newHeight > 2048) {
            alert('Invalid dimensions. Please enter values between 1 and 2048.');
            return;
        }
    
        // Save current state before creating a new texture
        this.saveToHistory();
    
        // Set canvas dimensions
        this.imageWidth = newWidth;
        this.imageHeight = newHeight;
        this.canvas.width = this.imageWidth;
        this.canvas.height = this.imageHeight;
    
        // Clear canvas with full transparency
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
        // Update dimensions display
        this.updateDimensionsDisplay();
    
        // Show canvas and hide no texture message
        document.getElementById('noTextureMessage').style.display = 'none';
        this.canvas.style.display = 'block';
    
        // Reset zoom
        this.resetZoom();
    
        // Save initial state to history
        this.saveToHistory();
    
        // Render canvas with zoom
        this.renderCanvas();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            
            // Reset transform to apply image data
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.putImageData(this.history[this.historyIndex], 0, 0);
            
            // Update buttons and rerender
            this.updateUndoRedoButtons();
            this.renderCanvas();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            
            // Reset transform to apply image data
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.putImageData(this.history[this.historyIndex], 0, 0);
            
            // Update buttons and rerender
            this.updateUndoRedoButtons();
            this.renderCanvas();
        }
    }

    clear() {
        // Save state before clearing
        this.saveToHistory();
        
        // Clear canvas with full transparency
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Reapply zoom
        this.renderCanvas();
    }

    getCurrentTexture() {
        // Save current state
        this.ctx.save();

        // Reset transform to get the actual image data
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Make sure to use PNG format to preserve transparency
        const dataURL = this.canvas.toDataURL('image/png');

        // Restore transform
        this.ctx.restore();

        return dataURL;
    }

    async saveTexture(data) {
        try {
            // Get the current project name
            const projectName = this.gameEditor.getCurrentProject();

            // Get the current texture name (selected object ID)
            const textureName = this.gameEditor.getSelectedObject();

            if (!projectName || !textureName) {
                console.error('Cannot save texture: missing project name or texture name');
                return;
            }

            // Send the texture to the server to save as a file
            const response = await fetch('/api/save-texture', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    projectName: projectName,
                    textureName: textureName,
                    imageData: data
                })
            });

            const result = await response.json();

            if (result.success) {
                // Dispatch event with the filepath instead of base64 data
                document.body.dispatchEvent(new CustomEvent('saveTexture', {
                    detail: { data: result.filePath, propertyName: 'imagePath' },
                }));
            } else {
                console.error('Failed to save texture:', result.error);
            }
        } catch (error) {
            console.error('Error saving texture:', error);
        }
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Set canvas dimensions to match image dimensions
                this.imageWidth = img.width;
                this.imageHeight = img.height;
                this.canvas.width = this.imageWidth;
                this.canvas.height = this.imageHeight;
                
                // Update dimensions display
                this.updateDimensionsDisplay();
                
                // Clear canvas
                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                
                // Draw image on canvas - this will preserve transparency
                this.ctx.drawImage(img, 0, 0, this.imageWidth, this.imageHeight);
                
                // Show canvas
                document.getElementById('noTextureMessage').style.display = 'none';
                this.canvas.style.display = 'block';
                
                // Reset zoom
                this.resetZoom();
                
                // Save state to history
                this.saveToHistory();
                
                // Render canvas with zoom
                this.renderCanvas();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}
