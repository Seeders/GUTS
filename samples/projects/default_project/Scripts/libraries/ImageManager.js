
class ImageManager {
    constructor(app, {imageSize}, {ShapeFactory}) {
        
        this.app = app;
        this.images = {};
        this.imageSize = imageSize || 128;
        // Create a single reusable renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        this.renderer.setSize(this.imageSize, this.imageSize);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.renderTarget = new THREE.WebGLRenderTarget(this.imageSize, this.imageSize);
        this.renderTarget.texture.flipY = true;
        
        // Create reusable scene
        this.scene = new THREE.Scene();
        
        // Create reusable cameras for different views
        const cameraDistance = 64;
        const frustumSize = cameraDistance + 16;
        const aspect = 1;

        this.shapeFactory = new ShapeFactory();
        // Create 8 cameras for isometric views at 45-degree intervals
        this.cameras = [];
        for (let i = 0; i < 8; i++) {
            this.cameras.push(new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000));
        }
        
        // Position cameras in a circle around the y-axis at isometric angle
        // Standard isometric angle is about 35.264 degrees (arctan(1/sqrt(2)))
        const isoAngle = Math.atan(1 / Math.sqrt(2));
        const horizDistance = cameraDistance * Math.cos(isoAngle);
        const vertDistance = cameraDistance * Math.sin(isoAngle);
        
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI / 4); // 45-degree increments
            const x = horizDistance * Math.sin(angle);
            const z = horizDistance * Math.cos(angle);
            
            this.cameras[i].position.set(x, vertDistance, z);
            this.cameras[i].lookAt(0, 0, 0);
        }
        
        // Create reusable lights
        this.ambientLight = new THREE.AmbientLight(0xffaaff, .25);
        
        // Create a light group that will rotate with each camera view
        this.lightGroup = new THREE.Group();
        
        // Main directional light
        this.directionalLight = new THREE.DirectionalLight(0xffffaa, .7);
        this.directionalLight.position.set(75, 96, 75);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.width = 1024;
        this.directionalLight.shadow.mapSize.height = 1024;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 500;
        this.directionalLight.shadow.bias = -0.0005;
        this.directionalLight.shadow.normalBias = 0.02;
        this.directionalLight.shadow.radius = 1;
        this.lightGroup.add(this.directionalLight);
        
        // Fill light
        this.fillLight = new THREE.DirectionalLight(0xffaaff, .5);
        this.fillLight.position.set(-20, 30, -20);
        this.lightGroup.add(this.fillLight);
        
        // Create ground plane
        const groundGeometry = new THREE.PlaneGeometry(200, 200);
        const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.3 });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = 0;
        this.ground.receiveShadow = true;
    }

    dispose() {
        // Proper cleanup when the manager is no longer needed
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (this.renderTarget) {
            this.renderTarget.dispose();
            this.renderTarget = null;
        }
        if (this.ground && this.ground.geometry) {
            this.ground.geometry.dispose();
            this.ground.material.dispose();
        }
        // Dispose of other reusable resources
        this.cameras = [];
        this.scene = null;
        this.lightGroup = null;
        this.ambientLight = null;
    }

    async loadImages(prefix, config) {
        for (const [type, cfg] of Object.entries(config)) {
            if (cfg.render && cfg.render.animations) {
                this.images[`${prefix}_${type}`] = await this.createAnimatedPlaceholder(cfg);
            } else if (cfg.tileMap && cfg.tileMap.terrainTypes) {
                console.log(`${prefix}_${type}`);
                this.images[`${prefix}_${type}`] = this.createTerrainImages(cfg);
            }
        }
    }

    createTerrainImages(config) {
        let terrainTiles = [];
        config.tileMap.terrainTypes.forEach((terrainType) => {   
            let tileWidth = 24;
            let sprites = [];
            sprites.length = 8;
            const pixelData = terrainType.image; // Single 2D array with all sprites
            if(pixelData){
                // Create 8 sprite canvases from different regions
                for (let spriteIdx = 0; spriteIdx < pixelData.length; spriteIdx++) {
                 
                    let imagePixelData = pixelData[spriteIdx];
                                        // Create an Image object
                    const img = new Image();
                    img.setAttribute("data-index", spriteIdx);
                    // When the image loads, draw it on the canvas
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        canvas.width = canvas.height = tileWidth;
                        let ctx = canvas.getContext('2d');
                        // Set canvas dimensions to match the image
                        canvas.width = img.width;
                        canvas.height = img.height;
                
                        // Draw the image on the canvas
                        ctx.drawImage(img, 0, 0);
                        sprites[parseInt(img.getAttribute("data-index"))] = canvas;
                    };
                
                    // Handle errors in case the Base64 string is invalid
                    img.onerror = function() {
                        console.error("Failed to load image from Base64 string.");
                    };
                
                    // Set the Base64 string as the image source
                    // Add the data URL prefix if it's not already present
                    if (!imagePixelData.startsWith('data:image/')) {
                        imagePixelData = 'data:image/png;base64,' + imagePixelData;
                    }

                    img.src = imagePixelData;
                }
                
                terrainTiles.push({ 
                    type: terrainType.type, 
                    sprites: sprites 
                });
            }
        });
        return terrainTiles;
    }
    async createAnimatedPlaceholder(config) {
        const animations = {};
        for (const [animType, frames] of Object.entries(config.render.animations)) {
            animations[animType] = [];
            let i = 0;
            for (const frame of frames) {
                const frameImages = await this.captureObjectImagesFromJSON(frame);
                const canvases = frameImages.map(img => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = this.imageSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    return canvas;
                });                
                animations[animType].push(canvases); // Array of 8 canvases per frame
            }
        }
        return animations; // { "idle": [[canvas0, canvas1, canvas2, canvas3, ...], ...], "walk": [...] }
    }

    getImages(prefix, type) {
        return this.images[`${prefix}_${type}`]; // Returns animation object
    }
    async captureObjectImagesFromJSON(shapeData) {
        const size = this.imageSize;
        // Clear the scene
        while (this.scene.children.length > 0) {
            const object = this.scene.children[0];
            this.scene.remove(object);
        }
        
        // Add reusable elements to scene
        this.scene.add(this.ground);
        this.scene.add(this.ambientLight);
        this.scene.add(this.lightGroup);
        
        // Create objects from the JSON data
        const objectGroup = this.createObjectsFromJSON(shapeData, this.scene);
        
        
        const images = [];
        
        // For each camera view, rotate the light group to match camera orientation
        for (let i = 0; i < this.cameras.length; i++) {
            const camera = this.cameras[i];
            
            // Reset light group rotation
            this.lightGroup.rotation.set(0, 0, 0);
            
            // Rotate light group to match camera position
            // Calculate angle based on camera index (8 positions at 45-degree intervals)
            // Rotate 45 degrees CLOCKWISE (subtract π/4 instead of adding)
            const angle = (i * Math.PI / 4); 
            this.lightGroup.rotation.y = angle;
            
            // Before rendering with each camera, update shadow camera frustum
            const d = 100;
            this.directionalLight.shadow.camera.left = -d;
            this.directionalLight.shadow.camera.right = d;
            this.directionalLight.shadow.camera.top = d;
            this.directionalLight.shadow.camera.bottom = -d;
            // After rotating lightGroup in the camera loop
            this.directionalLight.shadow.camera.updateProjectionMatrix();
            this.directionalLight.shadow.camera.updateMatrixWorld();
            this.directionalLight.target.position.set(0, 0, 0);
            this.directionalLight.target.updateMatrixWorld();
            // Render and capture the image
            this.renderer.setRenderTarget(this.renderTarget);
            this.renderer.render(this.scene, camera);
            const buffer = new Uint8Array(size * size * 4);
            this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, size, size, buffer);
            
            // Flip the buffer (y-axis)
            const flippedBuffer = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                const srcRowStart = y * size * 4;
                const destRowStart = (size - 1 - y) * size * 4;
                flippedBuffer.set(buffer.subarray(srcRowStart, srcRowStart + size * 4), destRowStart);
            }
            
            const imageData = new ImageData(new Uint8ClampedArray(flippedBuffer), size, size);
            const imageBitmap = await createImageBitmap(imageData);
            images.push(imageBitmap);
        }
        if( this.renderer) this.renderer.setRenderTarget(null);
        
        // Cleanup object geometries and materials
        this.shapeFactory.disposeObject(objectGroup);
        
        // Remove object group from scene
        if( this.scene ) this.scene.remove(objectGroup);
        
        return images;
    }

    /**
     * Creates 3D objects from shape data.
     * @param {Object} shapeData - The JSON object containing shape definitions.
     * @returns {THREE.Group} - A group containing all 3D objects.
     */
  
    createObjectsFromJSON(shapeData, scene) {
        const group = this.shapeFactory.createFromJSON(shapeData);
        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true; // or set this selectively for objects that should cast shadows
                child.receiveShadow = true; // for objects that should receive shadows
            }
        });
        scene.add(group);
        return group;
    }
   
}
