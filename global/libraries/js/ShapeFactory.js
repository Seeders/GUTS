class ShapeFactory {
    constructor(palette, textures, libraryClasses, gltfModelScale = 32) {
        this.gltfCache = new Map();
        this.gltfLoader = new THREE_.GLTFLoader();
        this.palette = palette;
        this.textures = textures;
        this.skeleUtils = THREE_.SkeletonUtils;   
        this.urlRoot = "/";
        this.gltfModelScale = gltfModelScale; // Add GLTF scale parameter
    }
    
    setURLRoot(root){
        this.urlRoot = root;
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
        // Use Promise.all with map instead of forEach to properly await all shapes
  
        await Promise.all(groupData.shapes.map(async (shape, index) => {
            if (shape.type === 'gltf') {
                await this.handleGLTFShape(shape, index, group);
            } else {
                await this.handlePrimitiveShape(shape, index, group);
            }
        }));
        
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
        const applyTransformations = (model, gltf) => {
            // Extract animations
            const animations = gltf.animations;
            
            // Apply individual shape transformations first
            model.position.set(
                (shape.position ? shape.position.x : shape.x) || 0, 
                (shape.position ? shape.position.y : shape.y) || 0, 
                (shape.position ? shape.position.z : shape.z) || 0
            );
            
            // Apply shape-specific scale first, then multiply by global GLTF scale
            const shapeScaleX = (shape.scale ? shape.scale.x : shape.scaleX) || 1;
            const shapeScaleY = (shape.scale ? shape.scale.y : shape.scaleY) || 1;
            const shapeScaleZ = (shape.scale ? shape.scale.z : shape.scaleZ) || 1;
            
            model.scale.set(
                shapeScaleX * this.gltfModelScale,
                shapeScaleY * this.gltfModelScale,
                shapeScaleZ * this.gltfModelScale
            );
            
            model.rotation.set(
                ((shape.rotation ? shape.rotation.x : shape.rotationX) || 0) * Math.PI / 180,
                ((shape.rotation ? shape.rotation.y : shape.rotationY) || 0) * Math.PI / 180,
                ((shape.rotation ? shape.rotation.z : shape.rotationZ) || 0) * Math.PI / 180
            );

            // Store reference to all bones for equipment attachment
            const modelBones = new Map();
            let skinnedMesh = null;
            let skeleton = null;

            model.traverse(child => {
                if (child.isMesh) {
                    // Override material with skinning enabled
                    let map = child.material.map;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        metalness: shape.metalness || 0.5,
                        roughness: shape.roughness || 0.5,
                        map: map
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
                    
                    // Update bones map in userData
                    model.userData.bones = modelBones;
                }
            }         
        };
    
        if (shape.url) {
            const cached = this.gltfCache.get(shape.url);
            if (cached) {
                const clonedScene = this.skeleUtils.clone(cached.scene);
                applyTransformations(clonedScene, cached);
            } else if (shape.url && location.hostname !== "") {
                await new Promise((resolve, reject) => {
                    this.gltfLoader.load(
                        `${this.urlRoot}${shape.url}`,
                        (gltf) => {
                            const clonedScene = this.skeleUtils.clone(gltf.scene);
                            this.gltfCache.set(shape.url, gltf);
                            applyTransformations(clonedScene, gltf);
                            resolve();
                        },
                        undefined,
                        (error) => {
                            console.error(`Failed to load GLTF model at ${shape.url}:`, error);
                            reject(error);
                        }
                    );
                });
            }
        } else {
            return null;
        }
    }

    async handlePrimitiveShape(shape, index, group) {
        let geometry, material;

        let colorToUse = shape.color;
        if(shape.color.paletteColor){
            colorToUse = "#ffffff";
            if(this.palette && this.palette[shape.color.paletteColor]){
                colorToUse = this.palette[shape.color.paletteColor];
            }
        }
        if(shape.texture){
            // If a texture is specified, use it instead of the color
            // If a texture is specified, use it instead of the color
            const textureLoader = new THREE.TextureLoader();
                
            const textureData = this.textures[shape.texture];
            
            if( textureData ) {
                const texture = await new Promise((resolve, reject) => {
                    textureLoader.load(
                        textureData.image,
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

        switch (shape.type) {
            case 'sphere':
                geometry = new THREE.SphereGeometry(shape.size / 2, 32, 32);
                break;
            case 'cube':
                geometry = new THREE.BoxGeometry(shape.size, shape.size, shape.size);
                break;
            case 'box':
                geometry = new THREE.BoxGeometry(shape.width, shape.height, shape.depth || shape.width);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(shape.size / 2, shape.size / 2, shape.height, 32);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(shape.size / 2, shape.height, 32);
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(shape.size / 2, shape.tubeSize || shape.size / 6, 16, 100);
                break;
            case 'tetrahedron':
                geometry = new THREE.TetrahedronGeometry(shape.size / 2);
                break;
            default:
                return;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { isShape: true, castShadow: true, index: index };
        
        // Position and rotation for primitive shapes (no global scale applied)
        mesh.position.set(
            (shape.position && shape.position.x ? shape.position.x : shape.x) || 0, 
            (shape.position && shape.position.y ? shape.position.y : shape.y) || 0, 
            (shape.position && shape.position.z ? shape.position.z : shape.z) || 0
        );
        mesh.rotation.set(
            ((shape.rotation && shape.rotation.x ? shape.rotation.x : shape.rotationX) || 0) * Math.PI / 180,
            ((shape.rotation && shape.rotation.y ? shape.rotation.y : shape.rotationY) || 0) * Math.PI / 180,
            ((shape.rotation && shape.rotation.z ? shape.rotation.z : shape.rotationZ) || 0) * Math.PI / 180
        );
        mesh.scale.set(
            (shape.scale && shape.scale.x ? shape.scale.x : shape.scaleX) || 1,
            (shape.scale && shape.scale.y ? shape.scale.y : shape.scaleY) || 1,
            (shape.scale && shape.scale.z ? shape.scale.z : shape.scaleZ) || 1
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
}