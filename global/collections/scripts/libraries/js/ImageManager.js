
class ImageManager {
    constructor(app, {imageSize, palette, textures}) {
        this.app = app;
        this.images = {};
        this.imageSize = imageSize || 128;

        // THREE.Texture cache for textures collection
        this.loadedTextures = new Map();
        this.textureLoader = new THREE.TextureLoader();

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

        this.shapeFactory = new GUTS.ShapeFactory(this.app.getResourcesPath(), palette, textures);
        if(location.hostname.indexOf('github') >= 0) {
            this.shapeFactory.setURLRoot("/GUTS/");
        }
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

    clear() {
        images = {};
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
        // Dispose loaded textures
        for (const texture of this.loadedTextures.values()) {
            texture.dispose();
        }
        this.loadedTextures.clear();
        // Dispose of other reusable resources
        this.cameras = [];
        this.scene = null;
        this.lightGroup = null;
        this.ambientLight = null;
    }

    async loadImages(prefix, config, checkCache = true, cacheResult = true) {

        if (!prefix || !config || typeof config !== 'object') {
            throw new Error('Invalid prefix or config provided to loadImages');
        }
        if( checkCache ) {
            // const cachedImages = await this.checkCache(prefix);
            // if (cachedImages) {
            //     this.images = { ...this.images, ...cachedImages };
            //     return;
            // }
        }
        for (const [type, cfg] of Object.entries(config)) {
            //if (cfg.render && cfg.render.animations) {
               // this.images[`${prefix}_${type}`] = await this.createAnimatedPlaceholder(cfg);
            //} else
            if (cfg.tileMap && cfg.tileMap.terrainTypes) {
                this.images[`${prefix}_${type}`] = await this.createTerrainImages(cfg);
            }
        }
       // if(cacheResult) {
         //   await this.cacheImages(prefix);
       // }
    }

    /**
     * Load all textures from the textures collection as THREE.Texture objects
     * @param {Object} texturesCollection - The textures collection object
     */
    async loadTextures(texturesCollection) {
        if (!texturesCollection) return;

        const resourcesPath = this.app.getResourcesPath();
        const loadPromises = [];

        for (const [textureId, textureDef] of Object.entries(texturesCollection)) {
            if (!textureDef?.imagePath) continue;

            // Skip if already loaded
            if (this.loadedTextures.has(textureId)) continue;

            const url = resourcesPath + textureDef.imagePath;

            const loadPromise = new Promise((resolve) => {
                this.textureLoader.load(
                    url,
                    (texture) => {
                        // Apply pixel art settings
                        texture.colorSpace = THREE.SRGBColorSpace;
                        texture.minFilter = THREE.NearestFilter;
                        texture.magFilter = THREE.NearestFilter;
                        this.loadedTextures.set(textureId, texture);
                        resolve();
                    },
                    undefined,
                    (error) => {
                        console.warn(`[ImageManager] Failed to load texture '${textureId}' from ${url}`);
                        resolve(); // Don't fail the whole batch for one texture
                    }
                );
            });
            loadPromises.push(loadPromise);
        }

        await Promise.all(loadPromises);
        console.log(`[ImageManager] Loaded ${this.loadedTextures.size} textures`);
    }

    /**
     * Get a loaded THREE.Texture by its ID
     * @param {string} textureId - The texture identifier from the textures collection
     * @returns {THREE.Texture|null}
     */
    getTexture(textureId) {
        return this.loadedTextures.get(textureId) || null;
    }

    /**
     * Check if a texture is loaded
     * @param {string} textureId - The texture identifier
     * @returns {boolean}
     */
    hasTexture(textureId) {
        return this.loadedTextures.has(textureId);
    }
    
    async checkCache(prefix) {
        try {
            const response = await fetch(`/cache/${prefix}.json`);
            if (response.ok) {
                const cacheData = await response.json();
                // Convert base64 cached images back to canvases
                return await this.convertBase64ToCanvases(cacheData.images);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async convertBase64ToCanvases(cachedImages) {
        const convertedImages = {};
        
        for (const [key, value] of Object.entries(cachedImages)) {
            if (Array.isArray(value)) {
                // Handle terrain tiles
                convertedImages[key] = await Promise.all(value.map(async (terrain) => {
                    const sprites = await Promise.all(terrain.sprites.map(async (base64) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = canvas.height = 24; // Match tileWidth from createTerrainImages
                        const ctx = canvas.getContext('2d');
                        const img = new Image();
                        
                        await new Promise((resolve, reject) => {
                            img.onload = () => {
                                ctx.drawImage(img, 0, 0);
                                resolve();
                            };
                            img.onerror = reject;
                            img.src = base64;
                        });
                        
                        return canvas;
                    }));
                    
                    return {
                        type: terrain.type,
                        sprites
                    };
                }));
            } else if (typeof value === 'object') {
                // Handle animations
                const animations = {};
                for (const [animType, frames] of Object.entries(value)) {
                    animations[animType] = await Promise.all(frames.map(async (frameSet) => {
                        return Promise.all(frameSet.map(async (base64) => {
                            const canvas = document.createElement('canvas');
                            canvas.width = canvas.height = this.imageSize;
                            const ctx = canvas.getContext('2d');
                            const img = new Image();
                            
                            await new Promise((resolve, reject) => {
                                img.onload = () => {
                                    ctx.drawImage(img, 0, 0);
                                    resolve();
                                };
                                img.onerror = reject;
                                img.src = base64;
                            });
                            
                            return canvas;
                        }));
                    }));
                }
                convertedImages[key] = animations;
            }
        }
        
        return convertedImages;
    }
    async cacheImages(prefix) {
        const base64Images = {};
        
        for (const [key, value] of Object.entries(this.images)) {
            if (key.startsWith(prefix)) {
                if (Array.isArray(value) && value[0]?.type && value[0]?.sprites) {
                    // Handle terrain tiles
                    base64Images[key] = value.map(terrain => ({
                        type: terrain.type,
                        sprites: terrain.sprites.map(canvas => canvas.toDataURL('image/png'))
                    }));
                } else if (typeof value === 'object' && value !== null) {
                    // Handle animations
                    const animationData = {};
                    for (const [animType, frames] of Object.entries(value)) {
                        animationData[animType] = frames.map(frameSet => 
                            frameSet.map(canvas => canvas.toDataURL('image/png'))
                        );
                    }
                    base64Images[key] = animationData;
                }
            }
        }

        try {
            await fetch('/api/cache', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prefix,
                    images: base64Images
                })
            });
        } catch (error) {
            console.error('Error caching images:', error);
        }
    }
    // In the ImageManager class
    async createTerrainImages(config) {
        let terrainTiles = [];
        const tileWidth = 24;

        // Get terrain type definitions from collections
        const collections = this.app.getCollections();
        if (!collections || !collections.terrainTypes) {
            console.error('ImageManager: No terrainTypes collection found');
            return terrainTiles;
        }

        // Create a map of terrain type to its image data first
        const terrainMap = {};
        await Promise.all(config.tileMap.terrainTypes.map(async (terrainTypeId, terrainIndex) => {
            // Look up the full terrain type definition from collections
            const terrainType = collections.terrainTypes[terrainTypeId];
            if (!terrainType) {
                console.warn(`ImageManager: Terrain type "${terrainTypeId}" not found in collections`);
                return;
            }

            // Get texture from the textures collection via terrain type's texture reference
            let imageSrc = null;
            if (terrainType.texture && collections.textures && collections.textures[terrainType.texture]) {
                const texture = collections.textures[terrainType.texture];
                if (texture.imagePath) {
                    imageSrc = this.app.getResourcesPath() + texture.imagePath;
                }
            }

            if (imageSrc) {
                const img = new Image();

                img.src = imageSrc;

                await new Promise((resolve, reject) => {
                    img.onload = () => {
                        // Get sprite dimensions from terrain type, default to tile size
                        const spriteWidth = terrainType.spriteWidth || tileWidth;
                        const spriteHeight = terrainType.spriteHeight || tileWidth;

                        // Calculate how many sprites fit in the image
                        const cols = Math.floor(img.width / spriteWidth);
                        const rows = Math.floor(img.height / spriteHeight);
                        const totalSprites = cols * rows;

                        // Extract up to 8 sprites from the sprite sheet
                        const sprites = [];
                        for (let i = 0; i < 8; i++) {
                            const canvas = document.createElement('canvas');
                            canvas.width = tileWidth;
                            canvas.height = tileWidth;
                            const ctx = canvas.getContext('2d');

                            if (i < totalSprites) {
                                // Calculate position in sprite sheet
                                const col = i % cols;
                                const row = Math.floor(i / cols);
                                const sx = col * spriteWidth;
                                const sy = row * spriteHeight;

                                // Draw sprite scaled to tile size
                                ctx.drawImage(img, sx, sy, spriteWidth, spriteHeight, 0, 0, tileWidth, tileWidth);
                            }
                            // If not enough sprites, canvas stays empty/transparent

                            sprites.push(canvas);
                        }

                        terrainTiles[terrainIndex] = {
                            type: terrainType.type,
                            sprites: sprites
                        };
                        resolve();
                    };
                    img.onerror = () => {
                        console.error(`Failed to load texture image for ${terrainType.type}`);
                        // Create empty canvases on error
                        const sprites = new Array(8).fill().map(() => {
                            const canvas = document.createElement('canvas');
                            canvas.width = canvas.height = tileWidth;
                            return canvas;
                        });
                        terrainTiles[terrainIndex] = {
                            type: terrainType.type,
                            sprites: sprites
                        };
                        resolve();
                    };
                });
            } else {
                // Create transparent placeholder for types without images
                // Don't use terrainType.color as it causes color bleed at tile edges
                const sprites = new Array(8).fill().map(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = tileWidth;
                    const ctx = canvas.getContext('2d');
                    // Leave canvas transparent (don't fillRect)
                    // This prevents layer colors from bleeding through at edges
                    return canvas;
                });
                
                terrainTiles[terrainIndex] = {
                    type: terrainType.type,
                    sprites: sprites
                };
            }
        }));

        // Make sure there are no gaps in the array
        return terrainTiles.filter(Boolean);
    }
    async createAnimatedPlaceholder(config) {
        const animations = {};
        
        if(config.shadows === false) {
            this.ground.receiveShadow = false;
        } else {
            this.ground.receiveShadow = true;
        }
        for (const [animType, frames] of Object.entries(config.render.animations)) {
            animations[animType] = [];
            let i = 0;
            for (const frame of frames) {
                const frameImages = await this.captureObjectImagesFromJSON(config.render.model, frame);
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
    async captureObjectImagesFromJSON(model, frameData) {
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
        const objectGroup = await this.createObjectsFromJSON(model, frameData, this.scene);

        
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
     * @param {Object} frameData - The JSON object containing frame definitions.
     * @returns {THREE.Group} - A group containing all 3D objects.
     */
  
    async createObjectsFromJSON(model, frameData, scene) {
        const rootGroup = new THREE.Group();
        
        for(const groupName in model) {
            const group = await this.shapeFactory.createMergedGroupFromJSON(model, frameData, groupName);
            if(group){
                group.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true; // or set this selectively for objects that should cast shadows
                        child.receiveShadow = true; // for objects that should receive shadows
                    }
                });
                rootGroup.add(group);
            }
        }

        scene.add(rootGroup);
    
        return rootGroup;
    }
   
}
