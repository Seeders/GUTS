class TerrainImageProcessor {
    constructor(options = {}) {
        // Configurable tile dimensions with defaults
        this.tileWidth = options.tileWidth || 24;
        this.tileHeight = options.tileHeight || 24;
        this.tilesX = options.tilesX || 4;
        this.tilesY = options.tilesY || 1;

        // Bind methods to ensure correct context
        this.handleImageUpload = this.handleImageUpload.bind(this);
        this.convertCanvasToBase64Tiles = this.convertCanvasToBase64Tiles.bind(this);
        this.displayStoredBase64Tiles = this.displayStoredBase64Tiles.bind(this);

        // Element references
        this.output = null;
        this.fileInput = null;
        this.displayImage = null;
    }

    // Initialize the processor with DOM elements
    initialize(outputElement, fileInputElement, displayImageElement) {
        this.output = outputElement;
        this.fileInput = fileInputElement;
        this.displayImage = displayImageElement;

        // Add event listeners
        this.fileInput.addEventListener('change', this.handleImageUpload);

        // Optional: Add custom event listener
        document.body.addEventListener('editTerrainImage', this.displayStoredBase64Tiles);
    }

    // Handle image upload and conversion
    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Create a temporary canvas to process the image
                const canvas = document.createElement('canvas');
                canvas.width = this.tileWidth * this.tilesX;
                canvas.height = this.tileHeight * this.tilesY;

                const ctx = canvas.getContext('2d');
                
                // Set transparent background
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Draw the uploaded image, scaling to fit the canvas
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Convert to base64 tiles with vertical flips
                const base64Tiles = this.convertCanvasToBase64Tiles(canvas);
                
                // Save base64 tiles to output
                this.output.value = JSON.stringify(base64Tiles);

                // Display the original uploaded image
                this.displayImage.src = e.target.result;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // Convert canvas to array of base64 tiles with vertical flips
    convertCanvasToBase64Tiles(canvas, format = 'png', quality = 1.0) {
        const base64Tiles = [];

        // First, process the first row of tiles normally
        for (let x = 0; x < this.tilesX; x++) {
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = this.tileWidth;
            tileCanvas.height = this.tileHeight;
            const tileCtx = tileCanvas.getContext('2d');

            // Calculate the source position on the main canvas
            const srcX = x * this.tileWidth;
            const srcY = 0;

            // Get the image data for this tile
            const imageData = canvas.getContext('2d').getImageData(
                srcX, srcY, this.tileWidth, this.tileHeight
            );

            // Put the image data on the tile canvas
            tileCtx.putImageData(imageData, 0, 0);

            // Convert the tile canvas to a data URL
            const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);

            // Extract the Base64 string (remove the prefix)
            const base64String = dataUrl.split(',')[1];

            // Add to the array
            base64Tiles.push(base64String);
        }

        // Now create vertically flipped versions of the first row
        for (let x = 0; x < this.tilesX; x++) {
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = this.tileWidth;
            tileCanvas.height = this.tileHeight;
            const tileCtx = tileCanvas.getContext('2d');

            // Calculate the source position on the main canvas
            const srcX = x * this.tileWidth;
            const srcY = 0;

            // Get the image data for this tile
            const imageData = canvas.getContext('2d').getImageData(
                srcX, srcY, this.tileWidth, this.tileHeight
            );

            // Create a new ImageData for the flipped tile
            const flippedImageData = new ImageData(this.tileWidth, this.tileHeight);
            for (let y = 0; y < this.tileHeight; y++) {
                for (let x = 0; x < this.tileWidth; x++) {
                    const srcIndex = (y * this.tileWidth + x) * 4;
                    const destIndex = ((this.tileHeight - 1 - y) * this.tileWidth + x) * 4;
                    
                    flippedImageData.data[destIndex] = imageData.data[srcIndex];     // R
                    flippedImageData.data[destIndex + 1] = imageData.data[srcIndex + 1]; // G
                    flippedImageData.data[destIndex + 2] = imageData.data[srcIndex + 2]; // B
                    flippedImageData.data[destIndex + 3] = imageData.data[srcIndex + 3]; // A
                }
            }

            // Put the flipped image data on the tile canvas
            tileCtx.putImageData(flippedImageData, 0, 0);

            // Convert the tile canvas to a data URL
            const dataUrl = tileCanvas.toDataURL(`image/${format}`, quality);

            // Extract the Base64 string (remove the prefix)
            const base64String = dataUrl.split(',')[1];

            // Add to the array
            base64Tiles.push(base64String);
        }

        return base64Tiles;
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
                console.error('Invalid base64 tiles array');
                return;
            }

            const img = new Image();
            const canvas = document.createElement('canvas');
            canvas.width = this.tileWidth * this.tilesX;
            canvas.height = this.tileHeight * this.tilesY;
            const ctx = canvas.getContext('2d');

            let loadedImages = 0;
            const tileImages = new Array(8).fill(null);

            base64Tiles.forEach((base64String, index) => {
                const tileImg = new Image();
                tileImg.onload = () => {
                    tileImages[index] = tileImg;
                    loadedImages++;

                    // Once all images are loaded, draw them
                    if (loadedImages === base64Tiles.length) {
                        // Draw first row of tiles
                        for (let x = 0; x < this.tilesX; x++) {
                            ctx.drawImage(tileImages[x], x * this.tileWidth, 0);
                        }

                        // Set the final image
                        this.displayImage.src = canvas.toDataURL('image/png');
                    }
                };

                // Ensure the base64 string has the correct data URL prefix
                if (!base64String.startsWith('data:image/')) {
                    base64String = 'data:image/png;base64,' + base64String;
                }
                tileImg.src = base64String;
            });
        } catch (error) {
            console.error('Error parsing stored base64 tiles:', error);
        }
    }

    // Method to clean up event listeners if needed
    destroy() {
        if (this.fileInput) {
            this.fileInput.removeEventListener('change', this.handleImageUpload);
        }
        document.body.removeEventListener('editTerrainImage', this.displayStoredBase64Tiles);
    }
}

// Usage example

export { TerrainImageProcessor };