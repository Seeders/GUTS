class TerrainImageProcessor {
    constructor(app, options = {}) {
        this.app = app;
        // Configurable tile dimensions with defaults
        this.tileWidth = options.tileWidth || 24;
        this.tileHeight = options.tileHeight || 24;

        // Element references
        this.displayImage = null;
    }

    // Initialize the processor with DOM elements
    initialize(outputElement, displayImageElement) {
        // outputElement kept for compatibility but no longer used
        this.displayImage = displayImageElement;
    }

    // Display the texture image
    processImage(imageUrl) {
        if (this.displayImage) {
            this.displayImage.src = imageUrl;
        }
    }

    // Helper method to get layout info for external use
    getLayoutInfo() {
        return {
            tileWidth: this.tileWidth,
            tileHeight: this.tileHeight
        };
    }

    // Method to clean up if needed
    destroy() {
        // No cleanup needed
    }
}
