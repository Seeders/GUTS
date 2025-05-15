class ModelManager {
    constructor(app, config, { ShapeFactory, palette, textures }) {
        this.app = app;
        this.config = config;
        this.models = {};
        this.shapeFactory = new ShapeFactory(palette, textures, null);
        this.textureAtlases = new Map();
        this.uvMappings = new Map();
        this.mergedGeometries = new Map();
    }

    clear() {
        this.models = {};
        this.uvMappings.clear();
        this.mergedGeometries.clear();
        this.textureAtlases.clear();

    }

    dispose() {
        for (const [key, model] of Object.entries(this.models)) {
            this.disposeModel(model);
        }
        this.models = {};
        this.uvMappings.clear();
        this.mergedGeometries.clear();
        this.textureAtlases.clear();

    }

    disposeModel(model) {
        if (!model) return;
        if (model.animations) {
            for (const [animType, frames] of Object.entries(model.animations)) {
                for (const frame of frames) {
                    if (frame.group) {
                        this.shapeFactory.disposeObject(frame.group);
                        frame.group = null;
                    }
                }
            }
        }
    }

    async loadModels(prefix, config) {
        if (!prefix || !config || typeof config !== 'object') {
            throw new Error('Invalid prefix or config provided to loadModels');
        }

        const textures = [];
        const textureInfo = [];

        // First pass: Load temporary models to collect textures
        const tempModels = [];
        for (const [type, cfg] of Object.entries(config)) {
            if (cfg.render && cfg.render.model) {
                const modelGroupName = Object.keys(cfg.render.model)[0];
                const modelGroup = cfg.render.model[modelGroupName];
                const isGLTF = modelGroup.shapes.length > 0 && modelGroup.shapes[0].type === "gltf";
                if (isGLTF) {
                    const modelKey = `${prefix}_${type}`;
                    const model = await this.createModel(prefix, type, cfg.render.model, false);
                    tempModels.push({ modelKey, model, spawnType: type });
                }
            }
        }

        // Collect textures
        tempModels.forEach(({ modelKey, model, spawnType }) => {
            model.traverse(child => {
                if (child.isMesh && child.material.map) {
                    textures.push(child.material.map);
                    textureInfo.push({ modelKey, spawnType });
                }
            });
        });

        // Generate texture atlas if textures exist
        if (textures.length > 0) {
            await this.generateTextureAtlas(prefix, textures, textureInfo);
        }

        // Second pass: Create final models with atlas and remapped UVs
        for (const [type, cfg] of Object.entries(config)) {
            if (cfg.render && cfg.render.model) {
                const modelGroupName = Object.keys(cfg.render.model)[0];
                const modelGroup = cfg.render.model[modelGroupName];
                const isGLTF = modelGroup.shapes.length > 0 && modelGroup.shapes[0].type === "gltf";
                if (isGLTF) {
                    const modelKey = `${prefix}_${type}`;
                    this.models[modelKey] = await this.createModel(prefix, type, cfg.render.model, true);
                    const animations = cfg.render.animations;
                    await Promise.all(Object.keys(animations).map(async (animationName) => {
                        const anim = animations[animationName][0];
                        const animMainGroup = anim[Object.keys(anim)[0]];
                        let mergedModel = JSON.parse(JSON.stringify(cfg.render.model));
                        if (animMainGroup) {
                            mergedModel[modelGroupName].shapes[0].url = animMainGroup.shapes[0].url;
                        }
                        const modelKey = `${prefix}_${type}_${animationName}`;
                        this.models[modelKey] = await this.createModel(prefix, type, mergedModel, true);
                    }));
                } else {
                    this.models[`${prefix}_${type}`] = await this.createModel(prefix, type, cfg.render.model, false);
                }
            }
        }  
        // if (textures.length > 0) {
        //     this.debugTextureAtlas(config, prefix);
        // }
        // Dispose temporary models
        tempModels.forEach(({ model }) => this.shapeFactory.disposeObject(model));
    }
    debugTextureAtlas(config, prefix) {
        if (!this.textureAtlases[prefix] || this.uvMappings.size === 0) {
            console.warn('No texture atlas or UV mappings available to debug.');
            return;
        }

        // Create a new canvas
        const canvas = document.createElement('canvas');
        canvas.width = this.textureAtlases[prefix].image.width;
        canvas.height = this.textureAtlases[prefix].image.height;
        const ctx = canvas.getContext('2d');

        // Draw the texture atlas
        ctx.drawImage(this.textureAtlases[prefix].image, 0, 0);

        // Draw UV mapping regions (atlas regions per spawnType)
        ctx.lineWidth = 2;
        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
        let index = 0;
        this.uvMappings.forEach((uv, spawnType) => {
            const [uMin, vMin, uMax, vMax] = uv;
            const x = uMin * canvas.width;
            const y = vMin * canvas.height;
            const width = (uMax - uMin) * canvas.width;
            const height = (vMax - vMin) * canvas.height;

            // Draw rectangle for atlas region
            ctx.strokeStyle = colors[index % colors.length];
            ctx.strokeRect(x, y, width, height);

            // Draw label
            ctx.fillStyle = colors[index % colors.length];
            ctx.font = '16px Arial';
            ctx.fillText(spawnType, x + 5, y + 20);

            index++;
        });
        index = 0;
        for (const [type] of Object.entries(config)) {

            const model = this.getModel(prefix, type);
            if (!model) continue;

            model.traverse((child) => {
                
                if (child.isMesh && child.geometry && child.geometry.attributes.uv && child.material.map) {
                    const geometry = child.geometry;
                    const uvAttribute = geometry.attributes.uv;
                    const indexAttribute = geometry.index;
                    const textureWidth = canvas.width;
                    const textureHeight = canvas.height;
                    // Draw UVs as a wireframe (using remapped UVs from createModel)
                    ctx.fillStyle = colors[(index) % colors.length];
                    ctx.strokeStyle = colors[(index) % colors.length];
                    ctx.beginPath();
                    if (indexAttribute) {
                        // Draw lines for each triangle
                        for (let i = 0; i < indexAttribute.count; i += 3) {
                            const a = indexAttribute.getX(i);
                            const b = indexAttribute.getX(i + 1);
                            const c = indexAttribute.getX(i + 2);

                            const uvA = [uvAttribute.getX(a), uvAttribute.getY(a)];
                            const uvB = [uvAttribute.getX(b), uvAttribute.getY(b)];
                            const uvC = [uvAttribute.getX(c), uvAttribute.getY(c)];

                            // Scale UVs to canvas coordinates
                            const xA = uvA[0] * textureWidth;
                            const yA = uvA[1] * textureHeight;
                            const xB = uvB[0] * textureWidth;
                            const yB = uvB[1] * textureHeight;
                            const xC = uvC[0] * textureWidth;
                            const yC = uvC[1] * textureHeight;

                            // Draw triangle edges
                           ctx.moveTo(xA, yA);
                           ctx.lineTo(xB, yB);
                           ctx.lineTo(xC, yC);
                           ctx.lineTo(xA, yA);
                        }
                    } 
                    ctx.stroke();
            index++;
                }
            });
            
        }
        // Style the canvas for visibility
        canvas.style.border = '1px solid black';
        canvas.style.margin = '10px';
        canvas.title = `Texture Atlas with UV Mappings and Geometry UVs (Prefix: ${prefix})`;

        // Append to document body
        document.body.appendChild(canvas);
    }
    async generateTextureAtlas(objectType, textures, textureInfo) {
        const textureSizes = textures.map((texture) => {
            const img = texture.image;
            return { width: img.width, height: img.height };
        });

        const gridSize = Math.ceil(Math.sqrt(textures.length));
        let maxWidth = 0;
        let maxHeight = 0;
        const gridPositions = [];

        textureSizes.forEach((size, i) => {
            const row = Math.floor(i / gridSize);
            const col = i % gridSize;
            const x = col * Math.max(...textureSizes.map(s => s.width));
            const y = row * Math.max(...textureSizes.map(s => s.height));
            gridPositions.push({ x, y });
            maxWidth = Math.max(maxWidth, x + size.width);
            maxHeight = Math.max(maxHeight, y + size.height);
        });

        let atlasWidth = Math.pow(2, Math.ceil(Math.log2(maxWidth)));
        let atlasHeight = Math.pow(2, Math.ceil(Math.log2(maxHeight)));

        const maxTextureSize = 4096;
        let scale = 1;
        if (atlasWidth > maxTextureSize || atlasHeight > maxTextureSize) {
            console.warn('Atlas size exceeds GPU limit. Scaling down textures.');
            scale = Math.min(maxTextureSize / atlasWidth, maxTextureSize / atlasHeight);
            maxWidth = Math.floor(maxWidth * scale);
            maxHeight = Math.floor(maxHeight * scale);
            atlasWidth = Math.pow(2, Math.ceil(Math.log2(maxWidth)));
            atlasHeight = Math.pow(2, Math.ceil(Math.log2(maxHeight)));
            textureSizes.forEach(size => {
                size.width = Math.floor(size.width * scale);
                size.height = Math.floor(size.height * scale);
            });
            gridPositions.forEach(pos => {
                pos.x = Math.floor(pos.x * scale);
                pos.y = Math.floor(pos.y * scale);
            });
        }

        const canvas = document.createElement('canvas');
        canvas.width = atlasWidth;
        canvas.height = atlasHeight;
        const ctx = canvas.getContext('2d');

        this.uvMappings.clear();
        textures.forEach((texture, i) => {
            const img = texture.image;
            const size = textureSizes[i];
            const pos = gridPositions[i];
            ctx.drawImage(img, pos.x, pos.y, size.width, size.height);
            this.uvMappings.set(textureInfo[i].spawnType, [
                pos.x / atlasWidth,
                pos.y / atlasHeight,
                (pos.x + size.width) / atlasWidth,
                (pos.y + size.height) / atlasHeight
            ]);
        });
        this.textureAtlases[objectType] = new THREE.CanvasTexture(canvas);
        this.textureAtlases[objectType].flipY = false;
        this.textureAtlases[objectType].colorSpace = THREE.SRGBColorSpace;
        this.textureAtlases[objectType].needsUpdate = true;
    }

    async createModel(objectType, spawnType, modelData, useAtlas = true) {
        const modelGroup = await this.createObjectsFromJSON(modelData, {}, objectType, spawnType);
        if (modelGroup) {
            modelGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const geometry = child.geometry;
                    if (useAtlas && this.textureAtlases[objectType] && this.uvMappings.has(spawnType) && !geometry.userData.uvsRemapped) {
                        geometry.userData.uvsRemapped = true;
                        // Apply texture atlas material
                        child.material = new THREE.MeshStandardMaterial({
                            map: this.textureAtlases[objectType],
                            metalness: child.material.metalness || 0.5,
                            roughness: child.material.roughness || 0.5
                        });
                        child.material.needsUpdate = true;
                        // Remap UVs
                        const uvMapping = this.uvMappings.get(spawnType);
                        const [uMin, vMin, uMax, vMax] = uvMapping;
                        const uvAttribute = geometry.attributes.uv;
                        if (uvAttribute) {                   
                            for (let i = 0; i < uvAttribute.count; i++) {
                                   
                                let u = uvAttribute.getX(i);
                                let v = uvAttribute.getY(i);
                                // Map UVs to atlas region
                                const uNew = uMin + u * (uMax - uMin);
                                // Flip v to match GLTF (bottom-left) if atlas is top-left
                                const vNew = vMin + v * (vMax - vMin); // Flip vertically                                 
                                uvAttribute.setXY(i,uNew, vNew);
                            }
                            uvAttribute.needsUpdate = true;
                        }
                    }
                }
            });
        }
        return modelGroup;
    }

    getModel(prefix, type) {
        return this.models[`${prefix}_${type}`];
    }

    getAnimation(prefix, type, anim) {
        return this.models[`${prefix}_${type}_${anim}`];
    }

    async createObjectsFromJSON(model, frameData, objectType, spawnType) {
        const rootGroup = new THREE.Group();
        for (const groupName in model) {
            const group = await this.shapeFactory.createMergedGroupFromJSON(model, frameData, groupName, objectType, spawnType);
            if (group) {
                rootGroup.add(group);
            }
        }
        return rootGroup;
    }
}