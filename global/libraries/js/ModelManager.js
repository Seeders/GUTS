class ModelManager {
    constructor(app, config, { ShapeFactory, palette, textures }) {
        this.app = app;
        this.config = config;
        this.models = {};
        this.gltfModelScale = 1;
        // Pass the GLTF scale to ShapeFactory
        this.shapeFactory = new ShapeFactory(palette, textures, null, this.gltfModelScale);
        
        if(location.hostname.indexOf('github') >= 0) {
            this.shapeFactory.setURLRoot("/GUTS/");
        }
        this.textureAtlases = new Map();
        this.uvMappings = new Map();
        this.mergedGeometries = new Map();
        // Store original UV mappings before atlas remapping
        this.originalUVMappings = new Map();
        this.assetsLoaded = false;
        this.app.modelManager = this;
    }

    clear() {
        this.models = {};
        this.uvMappings.clear();
        this.originalUVMappings.clear();
        this.mergedGeometries.clear();
        this.textureAtlases.clear();
    }

    dispose() {
        for (const [key, model] of Object.entries(this.models)) {
            this.disposeModel(model);
        }
        this.models = {};
        this.uvMappings.clear();
        this.originalUVMappings.clear();
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
                    
                    const model = await this.createModel(prefix, type, cfg.render.model, false, true); // Pass isGLTF flag
                    tempModels.push({ modelKey, model, spawnType: type });
                }
            }
        }

        // Collect textures and store original UV mappings
        tempModels.forEach(({ modelKey, model, spawnType }) => {
            let meshIndex = 0;
            model.traverse(child => {
                if (child.isMesh && child.material.map) {
                    textures.push(child.material.map);                    
                    textureInfo.push({ modelKey, spawnType, meshIndex });
                    
                    // Store original UV mapping for this mesh
                    const uvKey = `${spawnType}_${meshIndex}`;
                    this.storeOriginalUVMapping(child.geometry, uvKey);
                    
                    meshIndex++;
                }
            });
        });

        // Generate texture atlas if textures exist
        if (textures.length > 0) {
            await this.generateTextureAtlas(prefix, textures, textureInfo);
        }

        // Second pass: Create final models WITHOUT applying atlas UVs yet
        for (const [type, cfg] of Object.entries(config)) {
            if (cfg.render && cfg.render.model) {
                const modelGroupName = Object.keys(cfg.render.model)[0];
                const modelGroup = cfg.render.model[modelGroupName];
                const isGLTF = modelGroup.shapes.length > 0 && modelGroup.shapes[0].type === "gltf";
                
                if (isGLTF) {
                    const modelKey = `${prefix}_${type}`;
                    
                    // Create master model without UV remapping
                    this.models[modelKey] = await this.createModel(prefix, type, cfg.render.model, false, true); // Pass isGLTF flag
                    
                    const animations = cfg.render.animations;
                    if (animations) {
                        await Promise.all(Object.keys(animations).map(async (animationName) => {
                            const animVariants = animations[animationName];
                            
                            // Load all variants of this animation
                            await Promise.all(animVariants.map(async (anim, variantIndex) => {
                                let mergedModel = JSON.parse(JSON.stringify(cfg.render.model));
                                let animMainGroup = mergedModel[Object.keys(mergedModel)[0]]; 
                                
                                if (anim && Object.keys(anim).length > 0) {
                                    animMainGroup = anim[Object.keys(anim)[0]];                                
                                }
                                if (!animMainGroup) return;
                                
                                if (animMainGroup && animMainGroup.shapes && animMainGroup.shapes[0] && animMainGroup.shapes[0].url) {
                                    mergedModel[modelGroupName].shapes[0].url = `${animMainGroup.shapes[0].url}`;
                                }
                                
                                // Create unique key for each variant
                                const modelKey = variantIndex === 0 
                                    ? `${prefix}_${type}_${animationName}` 
                                    : `${prefix}_${type}_${animationName}_${variantIndex}`;
                                    
                                this.models[modelKey] = await this.createModel(prefix, type, mergedModel, false, true);
                            }));
                        }));
                    }
                } else {
                    // Non-GLTF model
                    this.models[`${prefix}_${type}`] = await this.createModel(prefix, type, cfg.render.model, false, false); // Pass isGLTF as false
                }
            }
        }  

        // Dispose temporary models
        tempModels.forEach(({ model }) => this.shapeFactory.disposeObject(model));

        this.assetsLoaded = true;
    }

    storeOriginalUVMapping(geometry, uvKey) {
        if (geometry.attributes.uv) {
            const uvAttribute = geometry.attributes.uv;
            const originalUVs = new Float32Array(uvAttribute.array.length);
            originalUVs.set(uvAttribute.array);
            this.originalUVMappings.set(uvKey, {
                uvs: originalUVs,
                itemSize: uvAttribute.itemSize,
                count: uvAttribute.count
            });
        }
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

    async createModel(objectType, spawnType, modelData, useAtlas = false) {
        const modelGroup = await this.createObjectsFromJSON(modelData, {}, objectType, spawnType);
        if (modelGroup && !useAtlas) {
            // For master models, just set up basic properties
            modelGroup.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            // Scale is now handled in ShapeFactory for GLTF models automatically
        }
        return modelGroup;
    }

    // Apply UV remapping to a specific geometry instance
    applyAtlasUVMapping(geometry, spawnType, meshIndex, objectType) {
        const uvKey = `${spawnType}_${meshIndex}`;
        const originalMapping = this.originalUVMappings.get(uvKey);
        const atlasMapping = this.uvMappings.get(uvKey);
        
        if (!originalMapping || !atlasMapping || !this.textureAtlases[objectType]) {
            return false;
        }

        const [uMin, vMin, uMax, vMax] = atlasMapping;
        const uvAttribute = geometry.attributes.uv;
        
        if (uvAttribute && originalMapping.uvs) {
            // Create new UV array from original UVs
            const newUVArray = new Float32Array(originalMapping.uvs.length);
            
            for (let i = 0; i < originalMapping.count; i++) {
                const u = originalMapping.uvs[i * 2];
                const v = originalMapping.uvs[i * 2 + 1];
                
                // Map original UVs to atlas region
                const uNew = uMin + u * (uMax - uMin);
                const vNew = vMin + v * (vMax - vMin);
                
                newUVArray[i * 2] = uNew;
                newUVArray[i * 2 + 1] = vNew;
            }
            
            // Replace the UV attribute with the remapped version
            geometry.setAttribute('uv', new THREE.BufferAttribute(newUVArray, originalMapping.itemSize));
            return true;
        }
        
        return false;
    }

    // Updated getModel to create fresh instances with atlas UVs applied
    getModel(prefix, type) {
        const modelKey = `${prefix}_${type}`;
        const masterModel = this.models[modelKey];
        
        if (!masterModel) {
            console.error(`Model not found for ${modelKey}`);
            return null;
        }
        
        // Create a properly cloned model and apply atlas UVs
        let model = this.deepCloneModel(masterModel, prefix, type);
        
        return model;
    }

    getAnimation(prefix, type, anim, variantIndex = 0) {
        // Create the model key based on variant index
        const modelKey = variantIndex === 0 
            ? `${prefix}_${type}_${anim}` 
            : `${prefix}_${type}_${anim}_${variantIndex}`;
            
        const masterModel = this.models[modelKey];
        
        if (!masterModel) {
            console.error(`Animation model not found for ${modelKey}`);
            return null;
        }
        
        // Create a properly cloned model and apply atlas UVs
        let model = this.deepCloneModel(masterModel, prefix, type);
        
        return model;
    }

    // Helper method to properly clone a THREE.js model with deferred UV remapping
    deepCloneModel(sourceRoot, prefix, type) {
        // Create a new root group to hold all cloned children
        const clonedRoot = new THREE.Group();
        clonedRoot.name = sourceRoot.name;
        clonedRoot.position.copy(sourceRoot.position);
        clonedRoot.quaternion.copy(sourceRoot.quaternion);
        clonedRoot.scale.copy(sourceRoot.scale);
        clonedRoot.userData = this.safeCloneUserData(sourceRoot.userData || {});

        // Clone all children of the sourceRoot
        sourceRoot.children.forEach(sourceModel => {
            const clonedModel = new THREE.Group();
            clonedModel.name = sourceModel.name;
            clonedModel.position.copy(sourceModel.position);
            clonedModel.quaternion.copy(sourceModel.quaternion);
            clonedModel.scale.copy(sourceModel.scale);
            clonedModel.userData = this.safeCloneUserData(sourceModel.userData || {});

            let meshIndex = 0;
            // Clone children of the current sourceModel
            sourceModel.children.forEach(child => {
                const clonedChild = this.cloneObject3D(child, type, meshIndex, prefix);
                if (clonedChild) {
                    clonedModel.add(clonedChild);
                    
                    // Increment mesh index for UV mapping
                    if (child.isMesh || child.isSkinnedMesh) {
                        meshIndex++;
                    }
                }

                // Handle animations for this child if it has them
                if (clonedChild.userData.isGLTFRoot && clonedChild.userData.animations && clonedChild.userData.animations.length > 0) {
                    // Create a map of original bone UUIDs to cloned bones
                    const boneMap = new Map();
                    sourceModel.traverse(src => {
                        if (src.isBone) {
                            clonedChild.traverse(cloned => {
                                if (cloned.isBone && cloned.name === src.name) {
                                    boneMap.set(src.uuid, cloned);
                                }
                            });
                        }
                    });

                    // Remap AnimationClip tracks to cloned bones
                    clonedChild.userData.animations = clonedChild.userData.animations.map(clip => {
                        const newTracks = clip.tracks.map(track => {
                            const [uuid, property] = track.name.split('.');
                            const newBone = boneMap.get(uuid);
                            if (newBone) {
                                return new THREE[track.constructor.name](`${newBone.uuid}.${property}`, track.times, track.values);
                            }
                            return track;
                        });
                        return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
                    });

                    // Create new AnimationMixer
                    const mixer = new THREE.AnimationMixer(clonedChild);
                    const action = mixer.clipAction(clonedChild.userData.animations[0]);
                    clonedChild.userData.mixer = mixer;
                    clonedChild.userData.action = action;
                } 
            });

            // Add the cloned model to the root
            clonedRoot.add(clonedModel);
        });

        return clonedRoot;
    }

    cloneObject3D(source, spawnType, meshIndex, objectType) {
        if (!source) return null;

        let cloned;

        if (source.isSkinnedMesh) {
            // Clone geometry with complete independence
            const geometry = this.deepCloneGeometry(source.geometry);
            
            // Apply atlas UV mapping to this instance
            if (this.applyAtlasUVMapping(geometry, spawnType, meshIndex, objectType)) {
                // Create material with atlas texture
                const material = new THREE.MeshStandardMaterial({
                    map: this.textureAtlases[objectType],
                    metalness: source.material.metalness || 0.5,
                    roughness: source.material.roughness || 0.5
                });
                material.needsUpdate = true;
                cloned = new THREE.SkinnedMesh(geometry, material);
            } else {
                // Fallback to original material
                let material;
                if (Array.isArray(source.material)) {
                    material = source.material.map(mat => mat.clone());
                } else {
                    material = source.material.clone();
                }
                cloned = new THREE.SkinnedMesh(geometry, material);
            }

            // Clone skeleton and preserve bone hierarchy
            if (source.skeleton) {
                // Create a map to track cloned bones
                const boneMap = new Map();
                const clonedBones = [];

                // Clone bones and preserve hierarchy
                source.skeleton.bones.forEach(bone => {
                    const clonedBone = bone.clone(false); // Clone without children
                    boneMap.set(bone.uuid, clonedBone);
                    clonedBones.push(clonedBone);
                });

                // Rebuild bone hierarchy
                source.skeleton.bones.forEach(bone => {
                    const clonedBone = boneMap.get(bone.uuid);
                    if (bone.parent && bone.parent.isBone) {
                        const clonedParent = boneMap.get(bone.parent.uuid);
                        if (clonedParent) {
                            clonedParent.add(clonedBone);
                        }
                    } else {
                        // Root bones are added to the SkinnedMesh or its parent group
                        cloned.add(clonedBone);
                    }
                });

                // Create new skeleton
                const clonedSkeleton = new THREE.Skeleton(clonedBones, source.skeleton.boneInverses.map(m => m.clone()));

                // Bind skeleton to the cloned mesh
                cloned.bind(clonedSkeleton, source.bindMatrix.clone());

                // Store skeleton in userData
                cloned.userData.skeleton = clonedSkeleton;
            }
        } else if (source.isMesh) {
            // Clone geometry with complete independence
            const geometry = this.deepCloneGeometry(source.geometry);
            
            // Apply atlas UV mapping to this instance
            if (this.applyAtlasUVMapping(geometry, spawnType, meshIndex, objectType)) {
                // Create material with atlas texture
                const material = new THREE.MeshStandardMaterial({
                    map: this.textureAtlases[objectType],
                    metalness: source.material.metalness || 0.5,
                    roughness: source.material.roughness || 0.5
                });
                material.needsUpdate = true;
                cloned = new THREE.Mesh(geometry, material);
            } else {
                // Fallback to original material
                let material;
                if (Array.isArray(source.material)) {
                    material = source.material.map(mat => mat.clone());
                } else {
                    material = source.material.clone();
                }
                cloned = new THREE.Mesh(geometry, material);
            }
        } else if (source.isGroup) {
            cloned = new THREE.Group();
        } else {
            cloned = new THREE.Object3D();
        }

        // Copy common properties
        cloned.name = source.name;
        cloned.position.copy(source.position);
        cloned.quaternion.copy(source.quaternion);
        cloned.scale.copy(source.scale);
        cloned.castShadow = source.castShadow;
        cloned.receiveShadow = source.receiveShadow;

        // Clone userData
        cloned.userData = this.safeCloneUserData(source.userData || {});

        // Clone children recursively
        let childMeshIndex = meshIndex;
        source.children.forEach(child => {
            const clonedChild = this.cloneObject3D(child, spawnType, childMeshIndex, objectType);
            if (clonedChild) {
                cloned.add(clonedChild);
                if (child.isMesh || child.isSkinnedMesh) {
                    childMeshIndex++;
                }
            }
        });

        return cloned;
    }

    // Ensure complete geometry independence with proper UV handling
    deepCloneGeometry(sourceGeometry) {
        const clonedGeometry = new THREE.BufferGeometry();
        
        // Clone all attributes
        for (const attributeName in sourceGeometry.attributes) {
            const sourceAttribute = sourceGeometry.attributes[attributeName];
            const newArray = new sourceAttribute.array.constructor(sourceAttribute.array.length);
            newArray.set(sourceAttribute.array);
            
            clonedGeometry.setAttribute(
                attributeName, 
                new THREE.BufferAttribute(newArray, sourceAttribute.itemSize, sourceAttribute.normalized)
            );
        }
        
        // Clone index if it exists
        if (sourceGeometry.index) {
            const sourceIndex = sourceGeometry.index;
            const newIndexArray = new sourceIndex.array.constructor(sourceIndex.array.length);
            newIndexArray.set(sourceIndex.array);
            clonedGeometry.setIndex(new THREE.BufferAttribute(newIndexArray, 1));
        }
        
        // Copy other properties
        clonedGeometry.name = sourceGeometry.name;
        if (sourceGeometry.userData) {
            clonedGeometry.userData = { ...sourceGeometry.userData };
        }
        
        return clonedGeometry;
    }

    safeCloneUserData(userData) {
        const result = {};

        for (const key in userData) {
            const value = userData[key];

            if (value === null || value === undefined) {
                result[key] = value;
            } else if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
                result[key] = value;
            } else if (value instanceof Array) {
                if (value.length > 0 && value[0] instanceof THREE.AnimationClip) {
                    result[key] = value.map(clip => clip.clone());
                } else {
                    result[key] = [...value];
                }
            } else if (typeof value === 'object') {
                if (key === 'mixer' || key === 'skeleton') {
                    continue; // Skip mixer and skeleton
                }
                if (Object.getPrototypeOf(value) === Object.prototype) {
                    result[key] = { ...value };
                } else if (typeof value.clone === 'function') {
                    try {
                        result[key] = value.clone();
                    } catch (e) {
                        console.warn(`Failed to clone userData property ${key}`, e);
                    }
                }
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