class ShapeFactory {
    constructor(resourcesPath, palette, textures, libraryClasses, gltfModelScale = 32, models = null, animations = null) {
        this.gltfCache = new Map();
        this.gltfLoader = new THREE.GLTFLoader();
        this.palette = palette;
        this.textures = textures;
        this.skeleUtils = THREE.SkeletonUtils;
        this.urlRoot = "/";
        this.resourcesPath = resourcesPath;
        this.gltfModelScale = gltfModelScale;
        this.models = models; // Models collection for resolving model references
        this.animations = animations; // Animations collection for resolving animation references
    }

    /**
     * Set the models collection for resolving model references
     * @param {Object} models - The models collection from getCollections()
     */
    setModels(models) {
        this.models = models;
    }

    /**
     * Set the animations collection for resolving animation references
     * @param {Object} animations - The animations collection from getCollections()
     */
    setAnimations(animations) {
        this.animations = animations;
    }

    /**
     * Resolve a model or animation reference to a URL path
     * @param {Object} shape - The shape object with a model or animation property
     * @returns {string|null} The resolved URL or null
     */
    resolveModelUrl(shape) {
        // Check for animation reference first
        if (shape.animation) {
            if (!this.animations) {
                console.warn(`[ShapeFactory] Animations collection not available`);
                return null;
            }
            const animData = this.animations[shape.animation];
            if (animData && animData.file) {
                return animData.file;
            }
            console.warn(`[ShapeFactory] Animation '${shape.animation}' not found in animations collection`);
            return null;
        }
        // Check for model reference
        if (shape.model) {
            if (!this.models) {
                console.warn(`[ShapeFactory] Models collection not available`);
                return null;
            }
            const modelData = this.models[shape.model];
            if (modelData && modelData.file) {
                return modelData.file;
            }
            console.warn(`[ShapeFactory] Model '${shape.model}' not found in models collection`);
            return null;
        }
        return null;
    }
    
    setURLRoot(root){
        this.urlRoot = root;
    }

    getResourcesPath(shapeUrl){
        // If resourcesPath is absolute (starts with /), don't prepend urlRoot
        const basePath = this.resourcesPath.startsWith('/') ? this.resourcesPath : `${this.urlRoot}${this.resourcesPath}`;
        return `${basePath}${shapeUrl.replace(this.resourcesPath,'')}`;
    }
    
    setGLTFScale(scale) {
        this.gltfModelScale = scale;
    }
    
    async createMergedGroupFromJSON(model, frameData, groupName) {
        let mergedGroup = this.getMergedGroup(model, frameData, groupName);
        if( mergedGroup){
            return await this.createGroupFromJSON(groupName, mergedGroup);
        } else {
            return null;
        }
    }
    
    async createGroupFromJSON(groupName, groupData) {
        const group = new THREE.Group();
        group.name = groupName;
        group.userData = { isGroup: true };

        // Process shapes sequentially to ensure base model loads before animations
        // This prevents race conditions where animation GLBs try to find the base model
        for (let index = 0; index < groupData.shapes.length; index++) {
            const shape = groupData.shapes[index];
            // Check if shape is GLTF by type, model, or animation reference
            const isGLTF = shape.type === 'gltf' || shape.model || shape.animation;

            if (isGLTF) {
                await this.handleGLTFShape(shape, index, group);
            } else {
                await this.handlePrimitiveShape(shape, index, group);
            }
        }
        
        if(groupData.position){            
            group.position.x = groupData.position.x || 0;
            group.position.y = groupData.position.y || 0;
            group.position.z = groupData.position.z || 0;
        }

        if(groupData.rotation){
            group.rotation.x = groupData.rotation.x || 0;
            group.rotation.y = groupData.rotation.y || 0;
            group.rotation.z = groupData.rotation.z || 0;
        }

        if(groupData.scale){
            group.scale.x = groupData.scale.x || 1;
            group.scale.y = groupData.scale.y || 1;
            group.scale.z = groupData.scale.z || 1;
        } 
        return group;
    }

    async handleGLTFShape(shape, index, group) {
        // If shape has both model and animation, load model first then apply animation from separate GLB
        if (shape.model && shape.animation) {
            // First load the model
            await this.handleGLTFShape({ ...shape, animation: undefined }, index, group);
            // Then load animation GLB and apply to the model (without adding to scene)
            await this.applyAnimationToGroup(shape.animation, group);
            return;
        }

        // Resolve the model URL (supports both model references and direct URLs)
        const resolvedUrl = this.resolveModelUrl(shape);

        const applyTransformations = async (model, gltf) => {
            // Extract animations
            const animations = gltf.animations;

            // Check if this is an animation-only GLB (from animations folder, no mesh)
            const isAnimationOnly = resolvedUrl && resolvedUrl.includes('animations/');
            let hasMesh = false;

            model.traverse(child => {
                if (child.isMesh) {
                    hasMesh = true;
                }
            });

            // If animation-only, find existing base model and apply animation to it
            if (isAnimationOnly && !hasMesh && animations && animations.length > 0) {
                // Find any existing model with a skeleton (the character mesh)
                let baseModel = null;
                group.children.forEach(child => {
                    if (child.userData && child.userData.isGLTFRoot && child.userData.skeleton && !baseModel) {
                        baseModel = child;
                    }
                });

                if (baseModel && baseModel.userData.skeleton) {
                    // Apply animation to existing model
                    if (!baseModel.userData.mixer) {
                        baseModel.userData.mixer = new THREE.AnimationMixer(baseModel);
                    }
                    const mixer = baseModel.userData.mixer;

                    // Stop any existing actions
                    mixer.stopAllAction();

                    // Play the new animation
                    const action = mixer.clipAction(animations[0]);
                    action.play();
                }

                // Store animation clips on the group for ModelManager to retrieve
                // This is needed when loading animations separately from the base model
                if (!group.userData.animations) {
                    group.userData.animations = [];
                }
                group.userData.animations.push(...animations);

                // Don't add the animation-only model to the scene
                return;
            }

            // Apply individual shape transformations
            model.position.set(
                shape.position?.x ?? 0,
                shape.position?.y ?? 0,
                shape.position?.z ?? 0
            );

            // Apply shape-specific scale, then multiply by global GLTF scale
            model.scale.set(
                (shape.scale?.x ?? 1) * this.gltfModelScale,
                (shape.scale?.y ?? 1) * this.gltfModelScale,
                (shape.scale?.z ?? 1) * this.gltfModelScale
            );

            model.rotation.set(
                (shape.rotation?.x ?? 0) * Math.PI / 180,
                (shape.rotation?.y ?? 0) * Math.PI / 180,
                (shape.rotation?.z ?? 0) * Math.PI / 180
            );

            // Store reference to all bones for equipment attachment
            const modelBones = new Map();
            let skinnedMesh = null;
            let skeleton = null;

            model.traverse(child => {
                if (child.isMesh) {
                    // Store original material properties
                    const originalMaterial = child.material;
                    let map = originalMaterial.map;

                    // Ensure texture has correct color space
                    if (map) {
                        map.colorSpace = THREE.SRGBColorSpace;
                    }

                    // Remove vertex colors from geometry if present
                    // Vertex colors can darken the texture
                    if (child.geometry && child.geometry.attributes.color) {
                        child.geometry.deleteAttribute('color');
                    }

                    // Use white color instead of preserving original to prevent darkening
                    // Original GLTF materials might have gray colors that darken textures
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        metalness: shape.metalness !== undefined ? shape.metalness : (originalMaterial.metalness || 0.5),
                        roughness: shape.roughness !== undefined ? shape.roughness : (originalMaterial.roughness || 0.5),
                        map: map,
                        aoMap: null,  // Don't use AO map
                        aoMapIntensity: 0,  // Disable AO
                        vertexColors: false
                    });
                    child.material.alphaTest = 0.1;
                    child.material.needsUpdate = true;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.userData = {
                        isShape: true,
                        index: index,
                        isGLTFChild: true
                    };
                    
                    // Check if this is a skinned mesh
                    if (child.isSkinnedMesh) {
                        skinnedMesh = child;
                        skeleton = child.skeleton;
                    }
                }
                
                // Collect all bones for equipment attachment
                if (child.isBone) {
                    modelBones.set(child.name, child);
                    // Mark bone with special userData for identification
                    child.userData.isCharacterBone = true;
                    child.userData.modelIndex = index;
                }
            });

            // Store skeleton and bone information in model userData
            model.userData = {
                isShape: true,
                index: index,
                isGLTFRoot: true,
                castShadow: true,
                animations: animations,
                bones: modelBones,
                skeleton: skeleton,
                skinnedMesh: skinnedMesh
            };
            group.add(model);

            if (animations && animations.length > 0) {
                const mixer = new THREE.AnimationMixer(model);
                const action = mixer.clipAction(animations[0]);
                action.play();

                model.userData.mixer = mixer;
                
                if (skeleton) {
                    model.userData.skeleton = skeleton;
                    // Ensure bones are accessible for equipment attachment
                    skeleton.bones.forEach(bone => {
                        if (!modelBones.has(bone.name)) {
                            modelBones.set(bone.name, bone);
                            bone.userData.isCharacterBone = true;
                            bone.userData.modelIndex = index;
                        }
                    });
                    if (skeleton && animations && animations.length > 0) {
                        const baked = await this.bakeGpuAnimFromModel(model, animations, skeleton, { fps: 30 });
                        model.userData.gpuAnim = baked; // stash VAT + meta on the GLTF root
                    }
                    
                    // Update bones map in userData
                    model.userData.bones = modelBones;
                }
            }         
        };

        if (resolvedUrl) {
            const cached = this.gltfCache.get(resolvedUrl);
            if (cached) {
                const clonedScene = this.skeleUtils.clone(cached.scene);
                await applyTransformations(clonedScene, cached);
            } else if (resolvedUrl && location.hostname !== "") {
                await new Promise((resolve, reject) => {
                    this.gltfLoader.load(
                        this.getResourcesPath(resolvedUrl),
                        async (gltf) => {
                            const clonedScene = this.skeleUtils.clone(gltf.scene);
                            this.gltfCache.set(resolvedUrl, gltf);
                            await applyTransformations(clonedScene, gltf);
                            resolve();
                        },
                        undefined,
                        (error) => {
                            console.error(`Failed to load GLTF model at ${resolvedUrl}:`, error);
                            reject(error);
                        }
                    );
                });
            }

        } else {
            return null;
        }
    }

    /**
     * Load animation from GLB and apply to existing model in group (without adding mesh to scene)
     */
    async applyAnimationToGroup(animationName, group) {
        const animUrl = this.resolveModelUrl({ animation: animationName });
        if (!animUrl) return;

        // Find the base model with skeleton
        let baseModel = null;
        group.children.forEach(child => {
            if (child.userData && child.userData.isGLTFRoot && child.userData.skeleton && !baseModel) {
                baseModel = child;
            }
        });

        if (!baseModel) return;

        const cached = this.gltfCache.get(animUrl);
        const applyAnim = (gltf) => {
            if (gltf.animations && gltf.animations.length > 0) {
                if (!baseModel.userData.mixer) {
                    baseModel.userData.mixer = new THREE.AnimationMixer(baseModel);
                }
                const mixer = baseModel.userData.mixer;
                mixer.stopAllAction();
                const action = mixer.clipAction(gltf.animations[0]);
                action.play();
            }
        };

        if (cached) {
            applyAnim(cached);
        } else {
            await new Promise((resolve) => {
                this.gltfLoader.load(
                    this.getResourcesPath(animUrl),
                    (gltf) => {
                        this.gltfCache.set(animUrl, gltf);
                        applyAnim(gltf);
                        resolve();
                    },
                    undefined,
                    () => resolve()
                );
            });
        }
    }

    async handlePrimitiveShape(shape, index, group) {
        let geometry, material;

        let colorToUse = shape.color;
        if(shape.color?.paletteColor){
            colorToUse = "#ffffff";
            if(this.palette && this.palette[shape.color.paletteColor]){
                colorToUse = this.palette[shape.color.paletteColor];
            }
        }
        // Default to white if color is undefined or an empty object
        if (!colorToUse || (typeof colorToUse === 'object' && Object.keys(colorToUse).length === 0)) {
            colorToUse = 0xffffff;
        }
        if(shape.texture){
            // If a texture is specified, use it instead of the color
            // If a texture is specified, use it instead of the color
            const textureLoader = new THREE.TextureLoader();

            const textureData = this.textures[shape.texture];

            if( textureData && textureData.imagePath ) {
                // File path - use relative path from resources
                const textureSrc = this.resourcesPath + textureData.imagePath;

                const texture = await new Promise((resolve, reject) => {
                    textureLoader.load(
                        textureSrc,
                        (loadedTexture) => {
                            loadedTexture.wrapS = THREE.RepeatWrapping; // Use ClampToEdge instead of RepeatWrapping
                            loadedTexture.wrapT = THREE.RepeatWrapping; // Use RepeatWrapping for vertical repeat
                            loadedTexture.magFilter = THREE.NearestFilter;
                            loadedTexture.minFilter = THREE.NearestFilter;
                            loadedTexture.generateMipmaps = false;
                            loadedTexture.anisotropy = 1;
                            loadedTexture.needsUpdate = true;

                            const meshWidth = shape.width || 1; // Mesh width in world units
                            const meshHeight = shape.height || 1; // Mesh height in world units
            
                            const textureWidth = loadedTexture.image.width;
                            const textureHeight = loadedTexture.image.height;
                            const pixelsPerUnit = 2;
                            const repeatX = Math.ceil((meshWidth * pixelsPerUnit) / textureWidth);
                            const repeatY = Math.ceil((meshHeight * pixelsPerUnit) / textureHeight);
                            loadedTexture.repeat.set(repeatX, repeatY);
 
                            resolve(loadedTexture);
                        },
                        undefined,
                        (error) => reject(error)
                    );
                });
                material = new THREE.MeshStandardMaterial({ map: texture, color: colorToUse });
            } else {                
                material = new THREE.MeshStandardMaterial({ color: colorToUse });
            }
        } else {            
            // Create material with specified color
            material = new THREE.MeshStandardMaterial({ color: colorToUse });
        }
        const shapeSize = shape.size / 32;
        switch (shape.type) {
            case 'sphere':
                geometry = new THREE.SphereGeometry(shapeSize / 2, 32, 32);
                break;
            case 'cube':
                geometry = new THREE.BoxGeometry(shapeSize, shapeSize, shapeSize);
                break;
            case 'box':
                geometry = new THREE.BoxGeometry(shape.width, shape.height, shape.depth || shape.width);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(shapeSize / 2, shapeSize / 2, shape.height, 32);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(shapeSize / 2, shape.height, 32);
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(shapeSize / 2, shape.tubeSize || shapeSize / 6, 16, 100);
                break;
            case 'tetrahedron':
                geometry = new THREE.TetrahedronGeometry(shapeSize / 2);
                break;
            default:
                return;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { isShape: true, castShadow: true, index: index };

        // Position, rotation, and scale for primitive shapes
        mesh.position.set(
            shape.position?.x ?? 0,
            shape.position?.y ?? 0,
            shape.position?.z ?? 0
        );
        mesh.rotation.set(
            (shape.rotation?.x ?? 0) * Math.PI / 180,
            (shape.rotation?.y ?? 0) * Math.PI / 180,
            (shape.rotation?.z ?? 0) * Math.PI / 180
        );
        mesh.scale.set(
            shape.scale?.x ?? 1,
            shape.scale?.y ?? 1,
            shape.scale?.z ?? 1
        );

        group.add(mesh);
    }

    disposeObject(object) {
        object.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    getMergedGroup(model, frameData, groupName) {
        const modelGroup = model[groupName];
        if (!modelGroup) {
            delete frameData?.[groupName];
            return null;
        }
    
        frameData = frameData || {};
        let frameGroup = this.initializeFrameGroup(frameData, modelGroup, groupName);
        
        this.cleanupMatchingTransforms(modelGroup, frameGroup);
        const mergedShapes = this.mergeShapes(modelGroup, frameGroup);
        
        this.cleanupEmptyShapes(frameGroup);
        
        const mergedGroup = {
            ...modelGroup,
            ...frameGroup,
            shapes: mergedShapes
        };
    
        if (modelGroup.shapes.length === 0) {
            frameGroup.shapes = [];
        }
    
        const returnVal = JSON.parse(JSON.stringify(mergedGroup));
        this.cleanupFrameData(frameData, frameGroup, groupName);
        
        return returnVal;
    }
    
    initializeFrameGroup(frameData, modelGroup, groupName) {
        if (!frameData[groupName]) {
            frameData[groupName] = JSON.parse(JSON.stringify(modelGroup));
            const frameGroup = frameData[groupName];
            frameGroup.shapes.forEach((shape, index) => {
                shape.id = index;
            });
            return frameGroup;
        }
        return frameData[groupName];
    }
    
    cleanupMatchingTransforms(modelGroup, frameGroup) {
        const properties = ['position', 'rotation', 'scale'];
        properties.forEach(prop => {
            if (JSON.stringify(modelGroup[prop]) === JSON.stringify(frameGroup[prop])) {
                delete frameGroup[prop];
            }
        });
    }
    
    mergeShapes(modelGroup, frameGroup) {
        return modelGroup.shapes.map((modelShape, i) => {
            if (!frameGroup.shapes) {
                return JSON.parse(JSON.stringify(modelShape));
            }
    
            let frameShape = frameGroup.shapes.find(shape => shape.id === i) || { id: i };
            if (!frameGroup.shapes.includes(frameShape)) {
                frameGroup.shapes.push(frameShape);
            }
    
            const mergedShape = this.mergeShapeProperties(modelShape, frameShape);
            this.cleanupMatchingShapeTransforms(modelShape, frameShape);
            
            return JSON.parse(JSON.stringify(mergedShape));
        });
    }
    
    mergeShapeProperties(modelShape, frameShape) {
        const mergedShape = {};
        
        for (const key in modelShape) {
            if (key === 'id') continue;
            
            if (frameShape && frameShape[key] !== undefined && modelShape[key] === frameShape[key]) {
                delete frameShape[key];
                mergedShape[key] = modelShape[key];
            } else if (!frameShape || frameShape[key] === undefined) {
                mergedShape[key] = modelShape[key];
            } else {
                mergedShape[key] = frameShape[key];
            }
        }
    
        return { ...mergedShape, ...frameShape };
    }
    
    cleanupMatchingShapeTransforms(modelShape, frameShape) {
        const transforms = [
            { prop: 'scale', defaultVal: 1, axes: ['X', 'Y', 'Z'] },
            { prop: 'rotation', defaultVal: 0, axes: ['X', 'Y', 'Z'] }
        ];
    
        transforms.forEach(({ prop, defaultVal, axes }) => {
            axes.forEach(axis => {
                const propName = `${prop}${axis}`;
                if (frameShape[propName] === modelShape[propName] || 
                   (frameShape[propName] === defaultVal && modelShape[propName] === undefined)) {
                    delete frameShape[propName];
                }
            });
        });
    }
    
    cleanupEmptyShapes(frameGroup) {
        if (frameGroup.shapes) {
            frameGroup.shapes = frameGroup.shapes.filter(shape => 
                Object.keys(shape).length > 0
            );
            
            if (frameGroup.shapes.length === 0) {
                delete frameGroup.shapes;
            }
        }
    }
    
    cleanupFrameData(frameData, frameGroup, groupName) {
        if (Object.keys(frameGroup).length === 0) {
            delete frameData[groupName];
        }
    }
        // ---- GPU Animation Bake (VAT) ----
    async bakeGpuAnimFromModel(model, animations, skeleton, opts = {}) {
        // opts: { fps=30, useDualQuat=false }  // keep simple: matrices
        const fps = opts.fps ?? 30;
        if (!skeleton || !animations || animations.length === 0) return null;

        const clips = animations; // THREE.AnimationClip[]
        const bones = skeleton.bones;
        const boneCount = bones.length;

        // Build meta per clip: {name, frames, duration}
        const perClipMeta = clips.map(clip => {
            const frames = Math.max(1, Math.ceil((clip.duration || 0) * fps));
            return { name: clip.name, duration: clip.duration, frames };
        });

        // Layout: one big atlas: rows = sum(frames over clips), columns = boneCount * 4 (mat4)
        const totalFrames = perClipMeta.reduce((a, c) => a + c.frames, 0);
        const cols = boneCount * 4;   // 4 texels per bone (mat4 rows)
        const rows = totalFrames;

        // R32F/RGBA32F: we’ll pack mat4 rows into RGBA floats per texel
        const floatCount = rows * cols * 4; // 4 channels per texel
        const data = new Float32Array(floatCount);

        const mixer = new THREE.AnimationMixer(model);
        const tmpQuat = new THREE.Quaternion();
        const tmpPos = new THREE.Vector3();
        const tmpScl = new THREE.Vector3();
        const boneM = new THREE.Matrix4();
        const bindI = skeleton.boneInverses;

        let rowOffset = 0;
        for (let c = 0; c < clips.length; c++) {
            const clip = clips[c];
            const { frames } = perClipMeta[c];
            const action = mixer.clipAction(clip);
            action.play();

            for (let f = 0; f < frames; f++) {
                const t = (f / Math.max(1, frames - 1)) * (clip.duration || 0);
                mixer.setTime(t);

                // ensure world/bone matrices are fresh
                model.updateMatrixWorld(true);
                bones.forEach((b) => b.updateMatrixWorld(true));

                // For each bone: final palette matrix = world * bindInverse (classic skinning)
                for (let b = 0; b < boneCount; b++) {
                    boneM.copy(bones[b].matrixWorld).multiply(bindI[b]);

                    // write 4 rows (vec4 each) into data
                    // column-major three.js Matrix4 elements
                    const e = boneM.elements; // [n11,n12, ... n44], column-major
                    const baseTexel = ((rowOffset + f) * cols + (b * 4)) * 4;
                    // Row0
                    data[baseTexel + 0] = e[0]; data[baseTexel + 1] = e[4]; data[baseTexel + 2] = e[8];  data[baseTexel + 3] = e[12];
                    // Row1
                    data[baseTexel + 4] = e[1]; data[baseTexel + 5] = e[5]; data[baseTexel + 6] = e[9];  data[baseTexel + 7] = e[13];
                    // Row2
                    data[baseTexel + 8] = e[2]; data[baseTexel + 9] = e[6]; data[baseTexel +10] = e[10]; data[baseTexel +11] = e[14];
                    // Row3
                    data[baseTexel +12] = e[3]; data[baseTexel +13] = e[7]; data[baseTexel +14] = e[11]; data[baseTexel +15] = e[15];
                }
            }

            rowOffset += frames;
            action.stop();
        }

        const tex = new THREE.DataTexture(
            data, cols, rows, THREE.RGBAFormat, THREE.FloatType
        );
        tex.needsUpdate = true;
        tex.flipY = false;

        // clip row ranges
        let acc = 0;
        const clipRows = perClipMeta.map(m => {
            const start = acc;
            const end = acc + m.frames; // exclusive
            acc = end;
            return { name: m.name, start, end, frames: m.frames, duration: m.duration };
        });

        return {
            texture: tex,
            bones: boneCount,
            rows, cols,
            fps,
            clips: clipRows
        };
    }

}