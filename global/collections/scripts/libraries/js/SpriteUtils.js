/**
 * SpriteUtils - Shared utilities for sprite generation
 * Used by GE_SceneRenderer and GLTF2Sprite
 */
class SpriteUtils {
    /**
     * Create a sprite renderer configured for correct color output
     * @param {THREE} THREE - Three.js module
     * @param {number} size - Sprite size in pixels
     * @returns {THREE.WebGLRenderer} Configured renderer
     */
    static createSpriteRenderer(THREE, size) {
        const renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true,
            preserveDrawingBuffer: true
        });
        renderer.setSize(size, size);
        renderer.setClearColor(0x000000, 0); // Transparent background
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        return renderer;
    }

    /**
     * Render a scene from a camera and return canvas with the result
     * @param {THREE.WebGLRenderer} renderer - The sprite renderer
     * @param {THREE.Scene} scene - Scene to render
     * @param {THREE.Camera} camera - Camera to render from
     * @param {number} size - Sprite size
     * @returns {HTMLCanvasElement} Canvas with rendered sprite
     */
    static renderToCanvas(renderer, scene, camera, size) {
        renderer.clear();
        renderer.render(scene, camera);

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Explicitly specify source and destination sizes to avoid any scaling issues
        ctx.drawImage(renderer.domElement, 0, 0, size, size, 0, 0, size, size);

        return canvas;
    }

    /**
     * Convert hex color string to RGB object
     * @param {string} hex - Hex color string (e.g., "#FF0000")
     * @returns {{r: number, g: number, b: number}|null} RGB object or null
     */
    static hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    /**
     * Find nearest color in palette using Euclidean distance
     * @param {number} r - Red value (0-255)
     * @param {number} g - Green value (0-255)
     * @param {number} b - Blue value (0-255)
     * @param {Array} palette - Array of RGB objects
     * @returns {{r: number, g: number, b: number}} Nearest color
     */
    static findNearestPaletteColor(r, g, b, palette) {
        let minDistance = Infinity;
        let nearestColor = palette[0];

        for (const color of palette) {
            const dist = (r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2;
            if (dist < minDistance) {
                minDistance = dist;
                nearestColor = color;
            }
        }

        return nearestColor;
    }

    /**
     * Apply palette quantization to a canvas
     * @param {HTMLCanvasElement} canvas - Canvas to modify
     * @param {Array} paletteColors - Array of RGB objects
     */
    static applyPaletteToCanvas(canvas, paletteColors) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue; // Skip transparent pixels

            const nearest = SpriteUtils.findNearestPaletteColor(data[i], data[i + 1], data[i + 2], paletteColors);
            data[i] = nearest.r;
            data[i + 1] = nearest.g;
            data[i + 2] = nearest.b;
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Apply outline to a canvas
     * @param {HTMLCanvasElement} canvas - Canvas to modify
     * @param {string} outlineColorHex - Outline color in hex format
     * @param {string} position - 'outset' or 'inset'
     * @param {number} connectivity - 4 or 8 for neighbor checking
     * @param {number} borderSize - Outline thickness
     */
    static applyOutlineToCanvas(canvas, outlineColorHex, position, connectivity, borderSize) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        const outlineColor = SpriteUtils.hexToRgb(outlineColorHex);
        if (!outlineColor) return;

        // Create alpha map
        const alphaMap = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            alphaMap[i / 4] = data[i + 3];
        }

        const outlineData = new Uint8ClampedArray(data.length);
        outlineData.set(data);

        // Calculate neighbor offsets based on connectivity and border size
        const baseOffsets = connectivity === 4
            ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

        const neighborOffsets = [];
        for (const [baseX, baseY] of baseOffsets) {
            for (let i = 0; i < borderSize; i++) {
                neighborOffsets.push([baseX * (i + 1), baseY * (i + 1)]);
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                if (alphaMap[idx] > 0) continue; // Skip non-transparent pixels

                let hasEdgeNeighbor = false;
                for (const [dx, dy] of neighborOffsets) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        if (alphaMap[ny * width + nx] > 0) {
                            hasEdgeNeighbor = true;
                            break;
                        }
                    }
                }

                if (hasEdgeNeighbor) {
                    outlineData[pixelIdx] = outlineColor.r;
                    outlineData[pixelIdx + 1] = outlineColor.g;
                    outlineData[pixelIdx + 2] = outlineColor.b;
                    outlineData[pixelIdx + 3] = 255;
                }
            }
        }

        imageData.data.set(outlineData);
        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Create an array of orthographic cameras for 8 isometric directions
     * @param {THREE} THREE - Three.js module
     * @param {number} frustumSize - Camera frustum size
     * @param {number} distance - Camera distance from origin
     * @param {number} height - Camera height
     * @param {number} lookAtY - Y coordinate to look at
     * @returns {THREE.OrthographicCamera[]} Array of 8 cameras
     */
    static createCameraArray(THREE, frustumSize, distance, height, lookAtY) {
        const cameras = [];
        const aspect = 1;

        for (let i = 0; i < 8; i++) {
            cameras.push(new THREE.OrthographicCamera(
                -frustumSize * aspect, frustumSize * aspect,
                frustumSize, -frustumSize,
                0.1, 10000
            ));
        }

        // Position cameras: Down, DownLeft, Left, UpLeft, Up, UpRight, Right, DownRight
        const positions = [
            [0, height, distance],              // 0: Down (S)
            [distance, height, distance],      // 1: DownLeft (SW)
            [distance, height, 0],             // 2: Left (W)
            [distance, height, -distance],     // 3: UpLeft (NW)
            [0, height, -distance],            // 4: Up (N)
            [-distance, height, -distance],    // 5: UpRight (NE)
            [-distance, height, 0],            // 6: Right (E)
            [-distance, height, distance]      // 7: DownRight (SE)
        ];

        const lookAtTarget = new THREE.Vector3(0, lookAtY, 0);
        cameras.forEach((camera, i) => {
            camera.position.set(positions[i][0], positions[i][1], positions[i][2]);
            camera.lookAt(lookAtTarget);
            camera.updateProjectionMatrix();
        });

        return cameras;
    }

    /**
     * Calculate square grid dimensions for sprite sheet packing
     * Aims for a roughly square layout to avoid WebGL texture size limits
     * @param {number} totalFrames - Total number of sprite frames
     * @param {number} spriteSize - Size of each sprite in pixels
     * @returns {{gridCols: number, gridRows: number, sheetWidth: number, sheetHeight: number}}
     */
    static calculateSquareGridDimensions(totalFrames, spriteSize) {
        const spritesPerSide = Math.ceil(Math.sqrt(totalFrames));
        const gridCols = spritesPerSide;
        const gridRows = Math.ceil(totalFrames / gridCols);

        return {
            gridCols,
            gridRows,
            sheetWidth: gridCols * spriteSize,
            sheetHeight: gridRows * spriteSize
        };
    }

    /**
     * Create a frame position calculator for sequential square packing
     * @param {number} gridCols - Number of columns in the grid
     * @param {number} spriteSize - Size of each sprite in pixels
     * @returns {function(): {x: number, y: number, nextFrame: function}} Position calculator
     */
    static createSquarePackingIterator(gridCols, spriteSize) {
        let currentFrame = 0;
        return {
            getPosition: () => {
                const col = currentFrame % gridCols;
                const row = Math.floor(currentFrame / gridCols);
                return {
                    x: col * spriteSize,
                    y: row * spriteSize
                };
            },
            nextFrame: () => {
                currentFrame++;
            },
            getCurrentFrame: () => currentFrame
        };
    }
}

// Export for GUTS
if (typeof window !== 'undefined') {
    window.SpriteUtils = SpriteUtils;
}
