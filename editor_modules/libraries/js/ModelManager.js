class ModelManager {
    constructor(app, config, { ShapeFactory, palette, textures }) {
        this.app = app;
        this.config = config;
        this.models = {};
        this.shapeFactory = new ShapeFactory(palette, textures, null);
        if(location.hostname == "github") {
            this.shapeFactory.setURLRoot("/GUTS/");
        }
        this.textureAtlases = new Map();
        this.uvMappings = new Map();
        this.mergedGeometries = new Map();
        this.assetsLoaded = false;
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
            let meshIndex = 0;
            model.traverse(child => {
                if (child.isMesh && child.material.map) {
                    textures.push(child.material.map);                    
                    textureInfo.push({ modelKey, spawnType, meshIndex });
                    meshIndex++;
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
                    if (animations) {
                        await Promise.all(Object.keys(animations).map(async (animationName) => {
                            const anim = animations[animationName][0];
                            if (!anim) return;
                            
                            const animMainGroup = anim[Object.keys(anim)[0]];
                            if (!animMainGroup) return;
                            
                            let mergedModel = JSON.parse(JSON.stringify(cfg.render.model));
                            if (animMainGroup && animMainGroup.shapes && animMainGroup.shapes[0] && animMainGroup.shapes[0].url) {
                                mergedModel[modelGroupName].shapes[0].url = `${animMainGroup.shapes[0].url}`;
                            }
                            const modelKey = `${prefix}_${type}_${animationName}`;
                            this.models[modelKey] = await this.createModel(prefix, type, mergedModel, true);
                        }));
                    }
                } else {
                    this.models[`${prefix}_${type}`] = await this.createModel(prefix, type, cfg.render.model, false);
                }
            }
        }  

        // Dispose temporary models
        tempModels.forEach(({ model }) => this.shapeFactory.disposeObject(model));

        this.assetsLoaded = true;
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
            this.uvMappings.set(`${textureInfo[i].spawnType}_${textureInfo[i].meshIndex}`, [
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
            let meshIndex = 0;
            modelGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const geometry = child.geometry;
                    if (useAtlas && this.textureAtlases[objectType] && this.uvMappings.has(`${spawnType}_${meshIndex}`) && !geometry.userData.uvsRemapped) {
                        geometry.userData.uvsRemapped = true;
                        // Apply texture atlas material
                        child.material = new THREE.MeshStandardMaterial({
                            map: this.textureAtlases[objectType],
                            metalness: child.material.metalness || 0.5,
                            roughness: child.material.roughness || 0.5
                        });
                        child.material.needsUpdate = true;
                        // Remap UVs
                        const uvMapping = this.uvMappings.get(`${spawnType}_${meshIndex}`);
                        meshIndex++;
                        const [uMin, vMin, uMax, vMax] = uvMapping;
                        const uvAttribute = geometry.attributes.uv;
                        if (uvAttribute) {                   
                            for (let i = 0; i < uvAttribute.count; i++) {
                                let u = uvAttribute.getX(i);
                                let v = uvAttribute.getY(i);
                                // Map UVs to atlas region
                                const uNew = uMin + u * (uMax - uMin);
                                // Flip v to match GLTF (bottom-left) if atlas is top-left
                                const vNew = vMin + v * (vMax - vMin);                              
                                uvAttribute.setXY(i, uNew, vNew);
                            }
                            uvAttribute.needsUpdate = true;
                        }
                    }
                }
            });
        }
        return modelGroup;
    }

    // Updated getModel to create fresh instances
    // Use a more efficient approach: deep clone the prebuilt models
// This maintains the correct UV mapping and materials
getModel(prefix, type) {
    const modelKey = `${prefix}_${type}`;
    const masterModel = this.models[modelKey];
    
    if (!masterModel) {
        console.error(`Model not found for ${modelKey}`);
        return null;
    }
    
    // Create a properly cloned model with correct materials and geometries
    return this.deepCloneModel(masterModel);
}

getAnimation(prefix, type, anim) {
    const modelKey = `${prefix}_${type}_${anim}`;
    const masterModel = this.models[modelKey];
    
    if (!masterModel) {
        console.error(`Animation model not found for ${modelKey}`);
        return null;
    }
    
    // Create a properly cloned model with correct materials and geometries
    return this.deepCloneModel(masterModel);
}

// Helper method to properly clone a THREE.js model with all its properties
deepCloneModel(sourceModel) {
    // First create a new empty group to hold our cloned content
    const clonedModel = new THREE.Group();
    
    // Copy basic properties
    clonedModel.name = sourceModel.name;
    clonedModel.position.copy(sourceModel.position);
    clonedModel.quaternion.copy(sourceModel.quaternion);
    clonedModel.scale.copy(sourceModel.scale);
    
    // Safely clone userData without using JSON.parse/stringify
    clonedModel.userData = this.safeCloneUserData(sourceModel.userData || {});
    
    // Clone children recursively
    sourceModel.children.forEach(child => {
        const clonedChild = this.cloneObject3D(child);
        if (clonedChild) {
            clonedModel.add(clonedChild);
        }
    });
    
    return clonedModel;
}

// Helper method to clone different types of Object3D objects
cloneObject3D(source) {
    // Skip if null
    if (!source) return null;
    
    let cloned;
    
    if (source.isMesh) {
        // For meshes, we need to clone both geometry and material
        const geometry = source.geometry.clone();
        
        // Clone the material(s)
        let material;
        if (Array.isArray(source.material)) {
            material = source.material.map(mat => mat.clone());
        } else {
            material = source.material.clone();
            
            // Make sure to clone the texture atlas reference correctly
            if (material.map) {
                material.map = source.material.map;
                material.needsUpdate = true;
            }
        }
        
        // Create a new mesh with the cloned geometry and material
        cloned = new THREE.Mesh(geometry, material);
    } else if (source.isGroup) {
        // For groups, create a new group
        cloned = new THREE.Group();
    } else {
        // For any other Object3D type, create a base Object3D
        cloned = new THREE.Object3D();
    }
    
    // Copy common properties
    cloned.name = source.name;
    cloned.position.copy(source.position);
    cloned.quaternion.copy(source.quaternion);
    cloned.scale.copy(source.scale);
    
    // Safely clone userData without using JSON.parse/stringify
    cloned.userData = this.safeCloneUserData(source.userData || {});
    
    // Important: Copy shadow properties
    cloned.castShadow = source.castShadow;
    cloned.receiveShadow = source.receiveShadow;
    
    // Clone children recursively
    source.children.forEach(child => {
        const clonedChild = this.cloneObject3D(child);
        if (clonedChild) {
            cloned.add(clonedChild);
        }
    });
    
    return cloned;
}
safeCloneUserData(userData) {
    const result = {};
    
    // Only copy primitive values and simple objects
    for (const key in userData) {
        const value = userData[key];
        
        // Skip functions, DOM nodes, and other non-serializable objects
        if (value === null || value === undefined) {
            result[key] = value;
        }
        else if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            result[key] = value;
        }
        else if (value instanceof Array) {
            // For arrays, create a shallow copy
            // This avoids deep recursion while still preserving arrays of primitives
            result[key] = [...value];
        }
        else if (typeof value === 'object') {
            // For objects, create a shallow copy to avoid circular references
            // Only include if it's a plain object (not a class instance like THREE.Vector3)
            if (Object.getPrototypeOf(value) === Object.prototype) {
                result[key] = { ...value };
            }
            // For THREE.js specific objects that have a .clone() method
            else if (typeof value.clone === 'function') {
                try {
                    result[key] = value.clone();
                } catch (e) {
                    // If cloning fails, skip this property
                    console.warn(`Failed to clone userData property ${key}`, e);
                }
            }
            // Skip other complex objects
        }
    }
    
    return result;
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