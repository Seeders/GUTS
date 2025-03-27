class CoordinateTranslator {
    constructor(config, mapSize) {
        this.tileWidth = config.gridSize;
        this.tileHeight = config.gridSize * 0.5;
        this.canvasWidth = config.canvasWidth;
        this.canvasHeight = config.canvasHeight;
        this.mapSize = mapSize;
    }

    // Pixel (top-down) to Grid
    pixelToGrid(pixelX, pixelY) {
        return {
            x: pixelX / this.tileWidth,
            y: pixelY / this.tileWidth
        };
    }

    // Grid to Isometric (with vertical centering)
    gridToIso(gridX, gridY) {
        const isoX = (gridX - gridY) * (this.tileWidth / 2) + this.canvasWidth / 2;
        
        // Calculate the height the grid would occupy
        // Assuming ROWS is accessible or passed to the constructor
        const totalGridHeight = this.mapSize * this.tileHeight;
        
        // Center vertically by adding an offset
        const verticalOffset = (this.canvasHeight - totalGridHeight) / 2;
        
        const isoY = (gridX + gridY) * (this.tileHeight / 2) + verticalOffset;
        
        return { x: isoX, y: isoY };
    }

    // Pixel (top-down) to Isometric
    pixelToIso(pixelX, pixelY) {
        const grid = this.pixelToGrid(pixelX, pixelY);
        return this.gridToIso(grid.x, grid.y);
    }

    isoToGrid(isoX, isoY) {
        const adjustedX = isoX - this.canvasWidth / 2;
        
        // Calculate the same vertical offset as in gridToIso
        const totalGridHeight = this.mapSize * this.tileHeight;
        const verticalOffset = (this.canvasHeight - totalGridHeight) / 2;
        
        // Subtract the offset before conversion
        const adjustedY = isoY - verticalOffset;
        
        const gridX = (adjustedX / (this.tileWidth / 2) + adjustedY / (this.tileHeight / 2)) / 2;
        const gridY = (adjustedY / (this.tileHeight / 2) - adjustedX / (this.tileWidth / 2)) / 2;
        
        return { x: gridX, y: gridY };
    }

    isoToPixel(isoX, isoY) {
        const grid = this.isoToGrid(isoX, isoY);
        return {
            x: grid.x * this.tileWidth,
            y: grid.y * this.tileWidth// Double y to match top-down pixel space
        };
    }

    // Snap grid coordinates to nearest integer
    snapToGrid(gridX, gridY) {
        return { x: Math.floor(gridX), y: Math.floor(gridY) };
    }
}

export { CoordinateTranslator };

