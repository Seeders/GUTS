class TerrainImageProcessor {
  //Utility function to convert terrain tile spritesheets to and from base64 encoding
    constructor(app, options = {}) {
        this.app = app;
        // Configurable tile dimensions with defaults
        this.tileWidth = options.tileWidth || 24;
        this.tileHeight = options.tileHeight || 24;
        this.tilesX = options.tilesX || 4;
        this.tilesY = options.tilesY || 1; // Will be auto-detected

        // Bind methods to ensure correct context
        this.convertCanvasToBase64Tiles = this.convertCanvasToBase64Tiles.bind(this);
        this.displayStoredBase64Tiles = this.displayStoredBase64Tiles.bind(this);

        // Element references
        this.output = null;
        this.displayImage = null;
    }

    // Initialize the processor with DOM elements
    initialize(outputElement, displayImageElement) {
        this.output = outputElement;
        this.displayImage = displayImageElement;

        // Optional: Add custom event listener
        document.body.addEventListener('editTerrainImage', this.displayStoredBase64Tiles);
    }

    // Detect if the image is 4x1 or 4x2 based on aspect ratio
    detectSpriteSheetLayout(img) {
        const aspectRatio = img.width / img.height;
        
        // For 4x1 layout: width should be 4x tile width, height should be 1x tile height
        // For 4x2 layout: width should be 4x tile width, height should be 2x tile height
        
        // Calculate expected dimensions
        const expectedWidth4x1 = this.tileWidth * 4;
        const expectedHeight4x1 = this.tileHeight * 1;
        const expectedWidth4x2 = this.tileWidth * 4;
        const expectedHeight4x2 = this.tileHeight * 2;
        
        // Check if dimensions match 4x2 layout
        if (img.width === expectedWidth4x2 && img.height === expectedHeight4x2) {
            return { tilesX: 4, tilesY: 2, layout: '4x2' };
        }
        
        // Check if dimensions match 4x1 layout
        if (img.width === expectedWidth4x1 && img.height === expectedHeight4x1) {
            return { tilesX: 4, tilesY: 1, layout: '4x1' };
        }
        
        // Fallback: determine based on aspect ratio
        // 4x1 should have aspect ratio of 4:1
        // 4x2 should have aspect ratio of 2:1
        if (Math.abs(aspectRatio - 4.0) < Math.abs(aspectRatio - 2.0)) {
            return { tilesX: 4, tilesY: 1, layout: '4x1' };
        } else {
            return { tilesX: 4, tilesY: 2, layout: '4x2' };
        }
    }

    processImage(imageUrl) {
        const img = new Image();
        img.onload = () => {
            // Detect the sprite sheet layout
            const layout = this.detectSpriteSheetLayout(img);
            console.log(`Detected sprite sheet layout: ${layout.layout}`);
            
            // Update internal properties
            this.tilesX = layout.tilesX;
            this.tilesY = layout.tilesY;
            
            // Create a temporary canvas to process the image
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext('2d');
            
            // Set transparent background
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw the uploaded image at original size
            ctx.drawImage(img, 0, 0);

            // Convert to base64 tiles based on detected layout
            const base64Tiles = this.convertCanvasToBase64Tiles(canvas, layout);
            
            // Save base64 tiles to output
            this.output.value = JSON.stringify(base64Tiles);

            // Display the original uploaded image
            this.displayImage.src = imageUrl;
        };
        img.src = imageUrl;
    }

    // Convert canvas to array of base64 tiles with layout detection
    convertCanvasToBase64Tiles(canvas, layout, format = 'png', quality = 1.0) {
        const base64Tiles = [];

        if (layout.layout === '4x2') {
            // Process 4x2 layout: use both provided rows
            
            // First row (top tiles)
            for (let x = 0; x < 4; x++) {
                const tileCanvas = document.createElement('canvas');
                tileCanvas.width = this.tileWidth;
                tileCanvas.height = this.tileHeight;
                const tileCtx = tileCanvas.getContext('2d');

                const srcX = x * this.tileWidth;
                const srcY = 0;

                const imageData = canvas.getContext('2d').getImageData(
                    srcX, srcY, this.tileWidth, this.tileHeight
                );

                tileCtx.putImageData(imageData, 0, 0);
                const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);
                const base64String = dataUrl.split(',')[1];
                base64Tiles.push(base64String);
            }

            // Second row (bottom tiles)
            for (let x = 0; x < 4; x++) {
                const tileCanvas = document.createElement('canvas');
                tileCanvas.width = this.tileWidth;
                tileCanvas.height = this.tileHeight;
                const tileCtx = tileCanvas.getContext('2d');

                const srcX = x * this.tileWidth;
                const srcY = this.tileHeight; // Second row

                const imageData = canvas.getContext('2d').getImageData(
                    srcX, srcY, this.tileWidth, this.tileHeight
                );

                tileCtx.putImageData(imageData, 0, 0);
                const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);
                const base64String = dataUrl.split(',')[1];
                base64Tiles.push(base64String);
            }

        } else {
            // Process 4x1 layout: use first row and create flipped versions
            
            // First row of tiles (normal)
            for (let x = 0; x < 4; x++) {
                const tileCanvas = document.createElement('canvas');
                tileCanvas.width = this.tileWidth;
                tileCanvas.height = this.tileHeight;
                const tileCtx = tileCanvas.getContext('2d');

                const srcX = x * this.tileWidth;
                const srcY = 0;

                const imageData = canvas.getContext('2d').getImageData(
                    srcX, srcY, this.tileWidth, this.tileHeight
                );

                tileCtx.putImageData(imageData, 0, 0);
                const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);
                const base64String = dataUrl.split(',')[1];
                base64Tiles.push(base64String);
            }

            // Create vertically flipped versions of the first row
            for (let x = 0; x < 4; x++) {
                const tileCanvas = document.createElement('canvas');
                tileCanvas.width = this.tileWidth;
                tileCanvas.height = this.tileHeight;
                const tileCtx = tileCanvas.getContext('2d');

                const srcX = x * this.tileWidth;
                const srcY = 0;

                const imageData = canvas.getContext('2d').getImageData(
                    srcX, srcY, this.tileWidth, this.tileHeight
                );

                // Create flipped image data
                const flippedImageData = this.verticallyFlipImageData(imageData);

                tileCtx.putImageData(flippedImageData, 0, 0);
                const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);
                const base64String = dataUrl.split(',')[1];
                base64Tiles.push(base64String);
            }
        }

        return base64Tiles;
    }

    // Helper method to vertically flip ImageData
    verticallyFlipImageData(imageData) {
        const flippedImageData = new ImageData(this.tileWidth, this.tileHeight);
        
        for (let y = 0; y < this.tileHeight; y++) {
            for (let x = 0; x < this.tileWidth; x++) {
                const srcIndex = (y * this.tileWidth + x) * 4;
                const destIndex = ((this.tileHeight - 1 - y) * this.tileWidth + x) * 4;
                
                flippedImageData.data[destIndex] = imageData.data[srcIndex];         // R
                flippedImageData.data[destIndex + 1] = imageData.data[srcIndex + 1]; // G
                flippedImageData.data[destIndex + 2] = imageData.data[srcIndex + 2]; // B
                flippedImageData.data[destIndex + 3] = imageData.data[srcIndex + 3]; // A
            }
        }
        
        return flippedImageData;
    }

    // Display stored base64 tiles
    displayStoredBase64Tiles() {
        // Check if there are stored base64 tiles
        if (!this.output.value) return;

        try {
            // Parse the stored base64 tiles
            const base64Tiles = JSON.parse(this.output.value);

            // Validate the number of tiles
            if (!Array.isArray(base64Tiles) || base64Tiles.length !== 8) {
                console.error('Invalid base64 tiles array - expected 8 tiles, got:', base64Tiles.length);
                return;
            }

            // Create canvas for display - always show as 4x2 for consistency
            const canvas = document.createElement('canvas');
            canvas.width = this.tileWidth * 4;
            canvas.height = this.tileHeight * 2;
            const ctx = canvas.getContext('2d');

            let loadedImages = 0;
            const tileImages = new Array(8).fill(null);

            base64Tiles.forEach((base64String, index) => {
                const tileImg = new Image();
                tileImg.onload = () => {
                    tileImages[index] = tileImg;
                    loadedImages++;

                    // Once all images are loaded, draw them in 4x2 layout
                    if (loadedImages === base64Tiles.length) {
                        // Draw first row of tiles (indices 0-3)
                        for (let x = 0; x < 4; x++) {
                            ctx.drawImage(tileImages[x], x * this.tileWidth, 0);
                        }

                        // Draw second row of tiles (indices 4-7)
                        for (let x = 0; x < 4; x++) {
                            ctx.drawImage(tileImages[x + 4], x * this.tileWidth, this.tileHeight);
                        }

                        // Set the final image
                        this.displayImage.src = canvas.toDataURL('image/png');
                    }
                };

                // Ensure the base64 string has the correct data URL prefix
                let dataUrl = base64String;
                if (!base64String.startsWith('data:image/')) {
                    dataUrl = 'data:image/png;base64,' + base64String;
                }
                tileImg.src = dataUrl;
            });
        } catch (error) {
            console.error('Error parsing stored base64 tiles:', error);
        }
    }

    // Helper method to get layout info for external use
    getLayoutInfo() {
        return {
            tilesX: this.tilesX,
            tilesY: this.tilesY,
            tileWidth: this.tileWidth,
            tileHeight: this.tileHeight
        };
    }

    // Method to manually set layout (useful for testing or specific requirements)
    setLayout(tilesX, tilesY) {
        this.tilesX = tilesX;
        this.tilesY = tilesY;
    }

    // Method to clean up event listeners if needed
    destroy() {
        document.body.removeEventListener('editTerrainImage', this.displayStoredBase64Tiles);
    }
}